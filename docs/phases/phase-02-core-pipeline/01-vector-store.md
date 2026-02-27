# Phase 2.01: Vector Store

> `@ci/vector-store` — Qdrant primary + pgvector fallback with unified IVectorStore interface.

---

## Objectives

1. Define the `IVectorStore` abstraction interface
2. Implement Qdrant adapter with HNSW tuning and hybrid search (dense + sparse with RRF)
3. Implement pgvector 0.8+ fallback for single-database architecture
4. Namespace-per-tenant isolation in Qdrant
5. Batch upsert strategy for efficient indexing

## Deliverables

- `packages/vector-store/src/index.ts` — IVectorStore interface + types
- `packages/vector-store/src/qdrant.ts` — Qdrant implementation
- `packages/vector-store/src/pgvector.ts` — pgvector fallback implementation
- `packages/vector-store/src/factory.ts` — Factory function for provider selection

---

## Package Structure

```
packages/vector-store/
├── src/
│   ├── index.ts           # IVectorStore interface, types, factory
│   ├── qdrant.ts          # Qdrant implementation
│   ├── pgvector.ts        # pgvector 0.8+ fallback
│   └── factory.ts         # createVectorStore factory
├── tests/
│   ├── qdrant.test.ts
│   └── pgvector.test.ts
├── package.json
└── tsconfig.json
```

---

## IVectorStore Interface

```typescript
// packages/vector-store/src/index.ts

export interface VectorPoint {
  id: string;
  vector: number[];
  sparseVector?: SparseVector;
  payload: Record<string, unknown>;
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface VectorSearchParams {
  vector: number[];
  sparseVector?: SparseVector;
  topK: number;
  filter?: VectorFilter;
  withPayload?: boolean;
  scoreThreshold?: number;
}

export interface VectorFilter {
  must?: FilterCondition[];
  should?: FilterCondition[];
  mustNot?: FilterCondition[];
}

export interface FilterCondition {
  key: string;
  match?: { value: unknown };
  range?: { gte?: number; lte?: number };
  values?: { any: unknown[] };
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface CollectionInfo {
  vectorsCount: number;
  status: "green" | "yellow" | "red";
}

export interface IVectorStore {
  // Collection management
  createCollection(name: string, dimensions: number, options?: CollectionOptions): Promise<void>;
  deleteCollection(name: string): Promise<void>;
  getCollectionInfo(name: string): Promise<CollectionInfo>;
  collectionExists(name: string): Promise<boolean>;

  // Point operations
  upsertPoints(collectionName: string, points: VectorPoint[]): Promise<void>;
  deletePoints(collectionName: string, ids: string[]): Promise<void>;

  // Search
  search(collectionName: string, params: VectorSearchParams): Promise<VectorSearchResult[]>;

  // Batch operations
  batchUpsert(collectionName: string, points: VectorPoint[], batchSize?: number): Promise<void>;
}

export interface CollectionOptions {
  hnswM?: number; // HNSW graph degree (default: 16)
  hnswEfConstruct?: number; // Construction quality (default: 200)
  onDisk?: boolean; // Store vectors on disk (default: true for >100K vectors)
  quantization?: "scalar" | "binary" | "product" | "none";
  shardNumber?: number; // Number of shards (default: auto)
}
```

---

## Qdrant Implementation

### `qdrant.ts`

```typescript
import { QdrantClient } from "@qdrant/js-client-rest";
import { CircuitBreaker, withRetry, isRetryableError } from "@ci/errors";
import { logger } from "@ci/logger";
import type {
  IVectorStore,
  VectorPoint,
  VectorSearchParams,
  VectorSearchResult,
  CollectionInfo,
  CollectionOptions,
} from "./index.js";

export class QdrantVectorStore implements IVectorStore {
  private client: QdrantClient;
  private breaker: CircuitBreaker;

  constructor(url: string, apiKey?: string) {
    this.client = new QdrantClient({ url, apiKey });
    this.breaker = new CircuitBreaker({
      name: "qdrant",
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      monitorWindowMs: 60_000,
    });
  }

  async createCollection(
    name: string,
    dimensions: number,
    options: CollectionOptions = {},
  ): Promise<void> {
    const { hnswM = 16, hnswEfConstruct = 200, onDisk = true, quantization = "none" } = options;

    await this.breaker.execute(() =>
      this.client.createCollection(name, {
        vectors: {
          dense: {
            size: dimensions,
            distance: "Cosine",
            on_disk: onDisk,
          },
        },
        sparse_vectors: {
          sparse: {
            index: { on_disk: true },
          },
        },
        hnsw_config: {
          m: hnswM,
          ef_construct: hnswEfConstruct,
        },
        optimizers_config: {
          default_segment_number: 4,
          memmap_threshold: 20000,
        },
        ...(quantization === "scalar" && {
          quantization_config: {
            scalar: { type: "int8", quantile: 0.99, always_ram: true },
          },
        }),
      }),
    );

    // Create payload indexes for filtering performance
    await this.client.createPayloadIndex(name, {
      field_name: "tenantId",
      field_schema: "keyword",
    });
    await this.client.createPayloadIndex(name, {
      field_name: "projectId",
      field_schema: "keyword",
    });
    await this.client.createPayloadIndex(name, {
      field_name: "isDeleted",
      field_schema: "bool",
    });

    logger.info(
      { collection: name, dimensions, hnswM, hnswEfConstruct },
      "Qdrant collection created",
    );
  }

  async search(collectionName: string, params: VectorSearchParams): Promise<VectorSearchResult[]> {
    return this.breaker.execute(async () => {
      // Run dense and sparse search in parallel
      const [denseResults, sparseResults] = await Promise.all([
        this.client.search(collectionName, {
          vector: { name: "dense", vector: params.vector },
          limit: params.topK,
          filter: this.buildFilter(params.filter),
          with_payload: params.withPayload ?? true,
          score_threshold: params.scoreThreshold,
        }),
        params.sparseVector
          ? this.client.search(collectionName, {
              vector: {
                name: "sparse",
                vector: {
                  indices: params.sparseVector.indices,
                  values: params.sparseVector.values,
                },
              },
              limit: params.topK,
              filter: this.buildFilter(params.filter),
              with_payload: false,
            })
          : Promise.resolve([]),
      ]);

      // If no sparse results, return dense only
      if (sparseResults.length === 0) {
        return denseResults.map((r) => ({
          id: String(r.id),
          score: r.score,
          payload: (r.payload ?? {}) as Record<string, unknown>,
        }));
      }

      // Reciprocal Rank Fusion (RRF)
      return this.reciprocalRankFusion(denseResults, sparseResults, params.topK);
    });
  }

  async upsertPoints(collectionName: string, points: VectorPoint[]): Promise<void> {
    await this.batchUpsert(collectionName, points, 100);
  }

  async batchUpsert(collectionName: string, points: VectorPoint[], batchSize = 100): Promise<void> {
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      const qdrantPoints = batch.map((p) => ({
        id: p.id,
        vector: {
          dense: p.vector,
          ...(p.sparseVector && {
            sparse: {
              indices: p.sparseVector.indices,
              values: p.sparseVector.values,
            },
          }),
        },
        payload: p.payload,
      }));

      await withRetry(
        () =>
          this.breaker.execute(() =>
            this.client.upsert(collectionName, { wait: true, points: qdrantPoints }),
          ),
        { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000, shouldRetry: isRetryableError },
      );
    }
  }

  async deletePoints(collectionName: string, ids: string[]): Promise<void> {
    await this.breaker.execute(() =>
      this.client.delete(collectionName, { wait: true, points: ids }),
    );
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name);
  }

  async getCollectionInfo(name: string): Promise<CollectionInfo> {
    const info = await this.client.getCollection(name);
    return {
      vectorsCount: info.vectors_count ?? 0,
      status: info.status === "green" ? "green" : info.status === "yellow" ? "yellow" : "red",
    };
  }

  async collectionExists(name: string): Promise<boolean> {
    try {
      await this.client.getCollection(name);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Private Helpers ─────────────────────────────────────

  private reciprocalRankFusion(
    denseResults: any[],
    sparseResults: any[],
    topK: number,
    k = 60,
  ): VectorSearchResult[] {
    const scores = new Map<string, number>();

    denseResults.forEach((result, rank) => {
      const id = String(result.id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });

    sparseResults.forEach((result, rank) => {
      const id = String(result.id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });

    const payloadMap = new Map(
      denseResults.map((r) => [String(r.id), (r.payload ?? {}) as Record<string, unknown>]),
    );

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => ({
        id,
        score,
        payload: payloadMap.get(id) ?? {},
      }));
  }

  private buildFilter(filter?: any) {
    if (!filter) return undefined;
    const qdrantFilter: any = {};
    if (filter.must) qdrantFilter.must = filter.must.map(this.mapCondition);
    if (filter.should) qdrantFilter.should = filter.should.map(this.mapCondition);
    if (filter.mustNot) qdrantFilter.must_not = filter.mustNot.map(this.mapCondition);
    return qdrantFilter;
  }

  private mapCondition(cond: any): any {
    if (cond.match) return { key: cond.key, match: cond.match };
    if (cond.range) return { key: cond.key, range: cond.range };
    if (cond.values) return { key: cond.key, match: { any: cond.values.any } };
    return cond;
  }
}
```

---

## Namespace-per-Tenant Isolation

Qdrant collections are named using the tenant ID:

```
Collection naming: ci_{tenantId}_{projectId}
Example: ci_a1b2c3d4_e5f6g7h8
```

For free/starter tenants, a single collection per tenant is used with `projectId` in the payload filter. For pro/enterprise tenants, dedicated collections per project provide better isolation and independent scaling.

```typescript
// Collection naming helper
export function getCollectionName(tenantId: string, projectId?: string): string {
  const base = `ci_${tenantId.replace(/-/g, "").slice(0, 12)}`;
  if (projectId) {
    return `${base}_${projectId.replace(/-/g, "").slice(0, 12)}`;
  }
  return base;
}
```

---

## Performance Tuning

### HNSW Parameters

| Parameter      | Default | High Recall | Low Latency | Notes                                                   |
| -------------- | ------- | ----------- | ----------- | ------------------------------------------------------- |
| `m`            | 16      | 32          | 8           | Graph connectivity; higher = better recall, more memory |
| `ef_construct` | 200     | 400         | 100         | Build quality; higher = better recall, slower indexing  |
| `ef` (search)  | 128     | 256         | 64          | Search quality; set at query time                       |

**Recommended starting configuration:**

- Small collections (<100K vectors): `m=16, ef_construct=200`
- Medium collections (100K-1M): `m=16, ef_construct=200, quantization=scalar`
- Large collections (>1M): `m=32, ef_construct=400, on_disk=true, quantization=scalar`

### Batch Upsert Strategy

- Batch size: 100 points per upsert call (Qdrant recommended)
- Parallel batches: up to 3 concurrent upsert calls
- Wait for acknowledgment: `wait: true` ensures durability
- Total throughput: ~1000 points/second per collection

---

## pgvector Fallback Implementation

The pgvector implementation uses the `chunks` table's `embedding` column (added conditionally for pgvector tenants). See `packages/vector-store/src/pgvector.ts`.

Key differences from Qdrant:

- Uses PostgreSQL HNSW index (pgvector 0.8+ — 9x faster than 0.7)
- No native sparse vector support — BM25 via `pg_trgm` full-text search
- RLS provides tenant isolation (no need for payload filters)
- Same `IVectorStore` interface — transparent to calling code

```typescript
// pgvector search uses SQL
const results = await db.execute(sql`
  SELECT id, 1 - (embedding <=> ${queryVector}::vector) as score, payload
  FROM chunks
  WHERE project_id = ${projectId}
    AND (payload->>'isDeleted')::boolean = false
  ORDER BY embedding <=> ${queryVector}::vector
  LIMIT ${topK}
`);
```

---

## Testing Requirements

- Qdrant: create collection, upsert 1000 points, search returns relevant results
- Qdrant: hybrid search (dense + sparse) returns fused results via RRF
- Qdrant: filter by tenantId and projectId excludes other tenants
- Qdrant: delete points removes them from search results
- Qdrant: batch upsert handles 10,000 points without timeout
- pgvector: HNSW index created successfully
- pgvector: cosine similarity search returns correct ordering
- pgvector: RLS prevents cross-tenant access
- Both: IVectorStore interface compliance (same test suite, different implementations)
- Circuit breaker: opens after 5 failures, rejects calls when open

---

## Critical File Paths

| File                                    | Purpose                            |
| --------------------------------------- | ---------------------------------- |
| `packages/vector-store/src/index.ts`    | IVectorStore interface + all types |
| `packages/vector-store/src/qdrant.ts`   | Qdrant implementation with RRF     |
| `packages/vector-store/src/pgvector.ts` | pgvector 0.8+ fallback             |
| `packages/vector-store/src/factory.ts`  | Provider selection factory         |

---

_Related: [Phase 2 Overview](./README.md) | [Embeddings](./02-embeddings.md)_
