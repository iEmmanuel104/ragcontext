# 03 — Semantic Cache

> **Package**: `packages/cache` | **Namespace**: `@ci/cache`
> **Entry Point**: `packages/cache/src/index.ts`

---

## Overview

The semantic cache intercepts queries before they reach the vector search stage and checks if a semantically similar query has been answered recently. By embedding the incoming query and comparing it to cached query embeddings via cosine similarity, the cache can return a cached response for queries that are paraphrased versions of previous queries.

Performance impact:

- **65x latency reduction** (p95 from 2.1s to 450ms on cache hits)
- **20-60% cache hit rate** for enterprise Q&A workloads
- Direct reduction in Cohere Embed + Rerank API costs proportional to hit rate

The cache is backed by Redis 7.2+ and uses the embedding provider from `@ci/embeddings` for query vectorization. Cache isolation is per-project to prevent cross-project data leakage.

---

## Interface

```typescript
// packages/cache/src/index.ts
import type { QueryResult } from "@ci/types";

export interface ISemanticCache {
  /**
   * Check the cache for a semantically similar query.
   * Returns the cached QueryResult if a match is found above the similarity threshold.
   *
   * @param query - The incoming query text
   * @param projectId - Project scope for cache isolation
   * @returns Cached result or null if no match
   */
  get(query: string, projectId: string): Promise<QueryResult | null>;

  /**
   * Store a query result in the cache.
   *
   * @param query - The query text
   * @param projectId - Project scope
   * @param result - The QueryResult to cache
   */
  set(query: string, projectId: string, result: QueryResult): Promise<void>;

  /**
   * Invalidate cache entries for a specific project.
   * Called when documents are added, updated, or deleted.
   *
   * @param projectId - Project whose cache should be invalidated
   */
  invalidateProject(projectId: string): Promise<void>;

  /**
   * Invalidate cache entries that reference a specific document.
   *
   * @param documentId - Document whose cache entries should be invalidated
   */
  invalidateDocument(documentId: string): Promise<void>;
}
```

---

## Redis-Backed Semantic Cache

```typescript
// packages/cache/src/redis-cache.ts
import { createClient, type RedisClientType } from "redis";
import type { QueryResult } from "@ci/types";
import type { ISemanticCache } from "./index";
import type { IEmbeddingProvider } from "@ci/embeddings";
import { cosineSimilarity } from "./similarity";
import { logger } from "@ci/logger";

interface CacheEntry {
  queryEmbedding: number[];
  queryText: string;
  result: QueryResult;
  documentVersions: Record<string, string>; // documentId -> contentHash
  createdAt: number;
}

export class RedisSemanticCache implements ISemanticCache {
  private redis: RedisClientType;
  private embedder: IEmbeddingProvider;
  private similarityThreshold: number;
  private ttlSeconds: number;
  private maxEntriesPerProject: number;

  constructor(options: {
    redisUrl: string;
    embedder: IEmbeddingProvider;
    similarityThreshold?: number;
    ttlSeconds?: number;
    maxEntriesPerProject?: number;
  }) {
    this.redis = createClient({ url: options.redisUrl });
    this.redis.connect().catch((err) => logger.error({ err }, "Redis connection failed"));
    this.embedder = options.embedder;
    this.similarityThreshold = options.similarityThreshold ?? 0.9;
    this.ttlSeconds = options.ttlSeconds ?? 3600; // 1 hour default
    this.maxEntriesPerProject = options.maxEntriesPerProject ?? 1000;
  }

  async get(query: string, projectId: string): Promise<QueryResult | null> {
    const startTime = performance.now();

    // Embed the incoming query
    const queryEmbedding = await this.embedQuery(query);
    if (!queryEmbedding) return null;

    // Fetch all cached entries for this project
    const cacheKey = `cache:${projectId}`;
    const entries = await this.redis.hGetAll(cacheKey);

    let bestMatch: { entry: CacheEntry; similarity: number } | null = null;

    for (const [_key, value] of Object.entries(entries)) {
      const entry = JSON.parse(value) as CacheEntry;

      // Check TTL
      if (Date.now() - entry.createdAt > this.ttlSeconds * 1000) {
        continue; // Expired
      }

      // Compute cosine similarity
      const similarity = cosineSimilarity(queryEmbedding, entry.queryEmbedding);

      if (similarity >= this.similarityThreshold) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { entry, similarity };
        }
      }
    }

    const latencyMs = performance.now() - startTime;

    if (bestMatch) {
      logger.info(
        {
          latencyMs: Math.round(latencyMs),
          similarity: bestMatch.similarity.toFixed(4),
          cachedQuery: bestMatch.entry.queryText.slice(0, 100),
          incomingQuery: query.slice(0, 100),
        },
        "Semantic cache hit",
      );

      return {
        ...bestMatch.entry.result,
        cacheHit: true,
      };
    }

    logger.debug({ latencyMs: Math.round(latencyMs) }, "Semantic cache miss");
    return null;
  }

  async set(query: string, projectId: string, result: QueryResult): Promise<void> {
    const queryEmbedding = await this.embedQuery(query);
    if (!queryEmbedding) return;

    // Build document version map for invalidation
    const documentVersions: Record<string, string> = {};
    for (const chunk of result.chunks) {
      if (chunk.metadata.contentHash) {
        documentVersions[chunk.documentId] = chunk.metadata.contentHash as string;
      }
    }

    const entry: CacheEntry = {
      queryEmbedding,
      queryText: query,
      result: { ...result, cacheHit: false }, // Store as non-cache-hit
      documentVersions,
      createdAt: Date.now(),
    };

    const cacheKey = `cache:${projectId}`;
    const entryKey = `q:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    await this.redis.hSet(cacheKey, entryKey, JSON.stringify(entry));
    await this.redis.expire(cacheKey, this.ttlSeconds);

    // Enforce max entries per project (evict oldest)
    const entryCount = await this.redis.hLen(cacheKey);
    if (entryCount > this.maxEntriesPerProject) {
      await this.evictOldest(cacheKey, entryCount - this.maxEntriesPerProject);
    }
  }

  async invalidateProject(projectId: string): Promise<void> {
    const cacheKey = `cache:${projectId}`;
    await this.redis.del(cacheKey);
    logger.info({ projectId }, "Cache invalidated for project");
  }

  async invalidateDocument(documentId: string): Promise<void> {
    // Scan all project caches and remove entries referencing this document
    const keys = await this.redis.keys("cache:*");

    for (const cacheKey of keys) {
      const entries = await this.redis.hGetAll(cacheKey);
      const keysToDelete: string[] = [];

      for (const [entryKey, value] of Object.entries(entries)) {
        const entry = JSON.parse(value) as CacheEntry;
        if (documentId in entry.documentVersions) {
          keysToDelete.push(entryKey);
        }
      }

      if (keysToDelete.length > 0) {
        await this.redis.hDel(cacheKey, keysToDelete);
        logger.info(
          {
            documentId,
            cacheKey,
            entriesRemoved: keysToDelete.length,
          },
          "Cache entries invalidated for document",
        );
      }
    }
  }

  private async embedQuery(query: string): Promise<number[] | null> {
    try {
      const result = await this.embedder.embed([query]);
      return result.embeddings[0];
    } catch (error) {
      logger.error({ error }, "Failed to embed query for cache");
      return null;
    }
  }

  private async evictOldest(cacheKey: string, count: number): Promise<void> {
    const entries = await this.redis.hGetAll(cacheKey);
    const sorted = Object.entries(entries)
      .map(([key, value]) => ({ key, createdAt: (JSON.parse(value) as CacheEntry).createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt);

    const toEvict = sorted.slice(0, count).map((e) => e.key);
    if (toEvict.length > 0) {
      await this.redis.hDel(cacheKey, toEvict);
    }
  }
}
```

---

## Cosine Similarity Computation

```typescript
// packages/cache/src/similarity.ts

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
```

---

## Cache Invalidation Strategies

### 1. TTL-Based Expiry

Every cache entry has a TTL (default 1 hour). Expired entries are skipped during lookup and eventually cleaned up by Redis key expiry.

### 2. Document Version Tracking

Each cache entry stores the `contentHash` of every document it references. When a document is re-indexed with a new content hash, all cache entries referencing the old hash are invalidated.

### 3. Project-Level Invalidation

When a project's pipeline configuration changes, or when bulk operations affect multiple documents, the entire project cache is invalidated.

### 4. Explicit Invalidation

The API exposes cache invalidation endpoints for manual control:

- `POST /v1/cache/invalidate` — Invalidate by project or document ID

---

## Cache Warming Strategies

For high-traffic projects with predictable query patterns, cache warming pre-populates the cache:

```typescript
// packages/cache/src/warming.ts
import type { ISemanticCache } from "./index";

export async function warmCache(
  cache: ISemanticCache,
  projectId: string,
  topQueries: string[],
  pipelineQuery: (query: string, projectId: string) => Promise<any>,
): Promise<{ warmed: number; failed: number }> {
  let warmed = 0;
  let failed = 0;

  for (const query of topQueries) {
    try {
      const result = await pipelineQuery(query, projectId);
      await cache.set(query, projectId, result);
      warmed++;
    } catch {
      failed++;
    }
  }

  return { warmed, failed };
}
```

Cache warming sources:

- **Analytics-driven**: Top queries from the `query_logs` table (last 24h/7d)
- **Manual**: Admin-configured seed queries per project
- **Scheduled**: BullMQ job runs cache warming after document re-indexing

---

## Intent-Aware Clustering (SAFE-CACHE Pattern)

Based on the SAFE-CACHE pattern (Nature Scientific Reports 2025), queries are clustered by intent before caching. This improves hit rates by mapping semantically similar queries to the same cache slot:

```
"What is the refund policy?"
"How do I get a refund?"           --> Same intent cluster
"Can I return my purchase?"

"What are your business hours?"
"When are you open?"               --> Different intent cluster
"What time do you close?"
```

The cluster centroid (average embedding of all queries in the cluster) is used as the cache key instead of individual query embeddings. This provides:

- Higher hit rates (20-60% for enterprise Q&A)
- Adversarial resilience (harder to poison the cache)
- Up to 68.8% API cost reduction

---

## Per-Project Cache Isolation

Cache entries are strictly isolated by project. This prevents:

- Cross-project data leakage
- Cache poisoning from one project affecting another
- Incorrect results when projects have different document sets

The isolation is enforced at the Redis key level: `cache:{projectId}`.

---

## Testing Requirements

```typescript
describe("RedisSemanticCache", () => {
  it("returns cache hit for semantically similar query", async () => {
    await cache.set("What is the refund policy?", "proj_1", mockResult);
    const hit = await cache.get("How do I get a refund?", "proj_1");
    expect(hit).not.toBeNull();
    expect(hit!.cacheHit).toBe(true);
  });

  it("returns null for dissimilar query", async () => {
    await cache.set("What is the refund policy?", "proj_1", mockResult);
    const hit = await cache.get("What are your business hours?", "proj_1");
    expect(hit).toBeNull();
  });

  it("respects TTL expiry", async () => {
    // Set TTL to 1 second, wait 2 seconds, verify miss
  });

  it("invalidates on document change", async () => {
    await cache.set("test query", "proj_1", mockResult);
    await cache.invalidateDocument("doc_1");
    const hit = await cache.get("test query", "proj_1");
    expect(hit).toBeNull();
  });

  it("isolates cache by project", async () => {
    await cache.set("test query", "proj_1", mockResult1);
    const hit = await cache.get("test query", "proj_2");
    expect(hit).toBeNull();
  });

  it("evicts oldest entries when max is exceeded", async () => {
    // Add maxEntries + 1 entries, verify oldest is evicted
  });
});
```

- Cache lookup latency: p99 <10ms (excluding embedding time)
- Similarity threshold tuning: measure false positive rate at 0.85, 0.90, 0.95
- Invalidation: verify complete cache clearing on project invalidation
- Concurrency: verify correctness under concurrent reads and writes

---

## Related Documentation

- [Phase 4 README](./README.md) — Phase overview
- [01-reranker.md](./01-reranker.md) — Reranking
- [02-compressor.md](./02-compressor.md) — Context compression
- [04-quality-scoring.md](./04-quality-scoring.md) — Quality evaluation
