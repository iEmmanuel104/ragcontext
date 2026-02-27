# Phase 2.05: Retrieval Pipeline

> `@ci/core` retrieval pipeline — The complete 10-stage flow from query to assembled context.

---

## Objectives

1. Implement the full 10-stage retrieval pipeline with latency targets
2. Hybrid search combining dense vectors and sparse BM25 with Reciprocal Rank Fusion
3. Permission-aware pre-filtering (not post-filtering)
4. Chunk hydration from PostgreSQL with metadata enrichment
5. Context assembly with citations
6. Query logging for analytics
7. Cursor-based pagination for result navigation

## Deliverables

- `packages/core/src/pipeline/retrieval-pipeline.ts` — Full retrieval orchestration
- `packages/core/src/pipeline/context-assembler.ts` — Context formatting + citations
- `packages/core/src/pipeline/query-logger.ts` — Async query log insertion
- Integration with `@ci/vector-store`, `@ci/embeddings`, `@ci/cache`, `@ci/db`

---

## 10-Stage Retrieval Flow

```
Query ──► [1] Cache Check ──hit──► Return cached result (2-5ms)
               │ miss
               ▼
          [2] Query Embedding ──► Cohere Embed v4 search_query (15-50ms)
               │
               ▼
          [3] Permission Filter ──► Build ACL pre-filter (<1ms)
               │
               ├─────────────────────────────┐
               ▼                             ▼
          [4a] Dense Search          [4b] Sparse Search
          Qdrant HNSW (10-30ms)     Qdrant BM25 (10-20ms)
               │                             │
               └──────────┬──────────────────┘
                          ▼
          [5] Reciprocal Rank Fusion (RRF) ──► Merged top-K (<1ms)
               │
               ▼
          [6] Chunk Hydration ──► PostgreSQL batch SELECT (5-15ms)
               │
               ▼
          [7] Reranking ──► Cohere Rerank 3.5, top-5 (30-80ms)
               │               [Phase 4 — stubbed initially]
               ▼
          [8] Compression ──► LLMLingua-2 (10-30ms)
               │               [Phase 4 — stubbed initially]
               ▼
          [9] Context Assembly ──► Format + citations (<1ms)
               │
               ▼
          [10] Quality Score + Cache Store + Log ──► async, fire-and-forget
               │
               ▼
          QueryResult response
```

### Latency Budget

| Stage                | Target p50 | Target p99 | Notes                         |
| -------------------- | ---------- | ---------- | ----------------------------- |
| 1. Cache check       | 2ms        | 5ms        | Redis GET + cosine comparison |
| 2. Query embedding   | 15ms       | 50ms       | Cohere API (single text)      |
| 3. Permission filter | <1ms       | <1ms       | In-memory filter construction |
| 4. Hybrid search     | 15ms       | 40ms       | Dense + sparse in parallel    |
| 5. RRF fusion        | <1ms       | <1ms       | In-memory computation         |
| 6. Chunk hydration   | 5ms        | 15ms       | Batch SELECT by vectorId      |
| 7. Reranking         | 30ms       | 80ms       | Cohere Rerank API (Phase 4)   |
| 8. Compression       | 10ms       | 30ms       | LLMLingua-2 (Phase 4)         |
| 9. Context assembly  | <1ms       | <1ms       | String operations             |
| 10. Async logging    | 0ms        | 0ms        | Fire-and-forget               |
| **Total**            | **~70ms**  | **~200ms** | **Full pipeline, cache miss** |

---

## Retrieval Pipeline Implementation

### `packages/core/src/pipeline/retrieval-pipeline.ts`

```typescript
import { randomUUID } from "node:crypto";
import { db } from "@ci/db";
import { chunks, documents, queryLogs } from "@ci/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import type { IVectorStore } from "@ci/vector-store";
import type { IEmbeddingProvider } from "@ci/embeddings";
import type {
  QueryRequest,
  QueryResult,
  RankedChunk,
  AssembledContext,
  ContextQualityScore,
  UsageMetrics,
} from "@ci/types";
import { logger } from "@ci/logger";
import { assembleContext } from "./context-assembler.js";
import { logQuery } from "./query-logger.js";

// Interfaces for optional Phase 4 components
export interface IRerankProvider {
  rerank(query: string, chunks: RankedChunk[], topN: number): Promise<RankedChunk[]>;
}

export interface ICompressor {
  compress(chunks: RankedChunk[], query: string): Promise<AssembledContext>;
}

export interface ISemanticCache {
  get(query: string, projectId: string): Promise<QueryResult | null>;
  set(query: string, projectId: string, result: QueryResult): Promise<void>;
}

export interface IQualityEvaluator {
  score(params: {
    query: string;
    chunks: RankedChunk[];
    context: AssembledContext;
  }): Promise<ContextQualityScore>;
}

export class RetrievalPipeline {
  constructor(
    private vectorStore: IVectorStore,
    private embedder: IEmbeddingProvider,
    private collectionName: string,
    // Phase 4 components — optional, stubbed initially
    private reranker?: IRerankProvider,
    private compressor?: ICompressor,
    private cache?: ISemanticCache,
    private evaluator?: IQualityEvaluator,
  ) {}

  async query(request: QueryRequest): Promise<QueryResult> {
    const startTime = Date.now();
    const requestId = randomUUID();
    const log = logger.child({ requestId, projectId: request.projectId });

    // ── Stage 1: Semantic Cache Check ──────────────────────────
    if (this.cache) {
      const cached = await this.cache.get(request.query, request.projectId);
      if (cached) {
        log.debug("Cache hit");
        return { ...cached, requestId, cacheHit: true, latencyMs: Date.now() - startTime };
      }
    }

    // ── Stage 2: Query Embedding ───────────────────────────────
    const embeddingResult = await this.embedder.embed([request.query], "search_query");
    const queryVector = embeddingResult.embeddings[0];

    // ── Stage 3: Build Permission-Aware Filter ─────────────────
    const filter = this.buildAccessFilter(request);

    // ── Stage 4: Hybrid Vector Search (Dense + Sparse parallel) ─
    const topK = request.config?.retrieval?.topK ?? request.topK ?? 100;
    const searchResults = await this.vectorStore.search(this.collectionName, {
      vector: queryVector,
      topK,
      filter,
      withPayload: true,
    });

    if (searchResults.length === 0) {
      log.info("No results found");
      return this.emptyResult(requestId, request.query, startTime, embeddingResult.tokensUsed);
    }

    // ── Stage 5 (RRF): Already handled inside vectorStore.search ──

    // ── Stage 6: Hydrate Chunk Metadata from PostgreSQL ────────
    const vectorIds = searchResults.map((r) => r.id);
    const hydratedChunks = await this.hydrateChunks(vectorIds, searchResults);

    // ── Stage 7: Reranking (Phase 4 — pass-through if not available) ──
    const rerankTopN = request.config?.reranking?.topN ?? 5;
    const rerankedChunks = this.reranker
      ? await this.reranker.rerank(request.query, hydratedChunks, rerankTopN)
      : hydratedChunks.slice(0, rerankTopN);

    // ── Stage 8: Compression (Phase 4 — pass-through if not available) ──
    const context =
      this.compressor && request.config?.compression?.enabled
        ? await this.compressor.compress(rerankedChunks, request.query)
        : assembleContext(rerankedChunks);

    // ── Stage 9: Quality Scoring (Phase 4 — default score if not available) ──
    const quality: ContextQualityScore = this.evaluator
      ? await this.evaluator.score({ query: request.query, chunks: rerankedChunks, context })
      : this.defaultQualityScore(rerankedChunks);

    // ── Stage 10: Build Result ─────────────────────────────────
    const usage: UsageMetrics = {
      documentsScanned: searchResults.length,
      chunksRetrieved: searchResults.length,
      chunksAfterRerank: rerankedChunks.length,
      tokensBeforeCompression: hydratedChunks.reduce((s, c) => s + c.tokenCount, 0),
      tokensAfterCompression: context.tokenCount,
      embeddingTokens: embeddingResult.tokensUsed,
    };

    const result: QueryResult = {
      requestId,
      query: request.query,
      chunks: rerankedChunks,
      context,
      quality,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
      usage,
    };

    // ── Async: Cache Store + Query Log (fire-and-forget) ───────
    Promise.all([
      this.cache?.set(request.query, request.projectId, result),
      logQuery(request, result),
    ]).catch((err) => log.error({ err }, "Async post-query tasks failed"));

    log.info(
      { latencyMs: result.latencyMs, chunks: rerankedChunks.length, cacheHit: false },
      "Query complete",
    );

    return result;
  }

  // ─── Private Helpers ──────────────────────────────────────

  private buildAccessFilter(request: QueryRequest) {
    const must: any[] = [
      { key: "projectId", match: { value: request.projectId } },
      { key: "isDeleted", match: { value: false } },
    ];

    // Additional user-provided filters
    if (request.filters) {
      for (const f of request.filters) {
        if (f.operator === "eq") {
          must.push({ key: f.field, match: { value: f.value } });
        } else if (f.operator === "in") {
          must.push({ key: f.field, values: { any: f.value as unknown[] } });
        }
      }
    }

    return { must };
  }

  private async hydrateChunks(
    vectorIds: string[],
    searchResults: { id: string; score: number; payload: Record<string, unknown> }[],
  ): Promise<RankedChunk[]> {
    if (vectorIds.length === 0) return [];

    const scoreMap = new Map(searchResults.map((r) => [r.id, r.score]));

    // Batch fetch chunk metadata from PostgreSQL
    const dbChunks = await db.select().from(chunks).where(inArray(chunks.vectorId, vectorIds));

    // Map and sort by score
    return dbChunks
      .map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        tenantId: chunk.tenantId,
        projectId: chunk.projectId,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        chunkIndex: chunk.chunkIndex,
        vectorId: chunk.vectorId,
        metadata: chunk.metadata as any,
        createdAt: chunk.createdAt,
        score: scoreMap.get(chunk.vectorId) ?? 0,
        vectorScore: scoreMap.get(chunk.vectorId) ?? 0,
        bm25Score: 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  private defaultQualityScore(chunks: RankedChunk[]): ContextQualityScore {
    const avgScore = chunks.reduce((s, c) => s + c.score, 0) / (chunks.length || 1);
    return {
      overall: Math.min(avgScore * 1.2, 1),
      retrievalConfidence: avgScore,
      contextSufficiency: chunks.length >= 3 ? 0.8 : 0.5,
      diversityScore: this.calculateDiversity(chunks),
      estimatedFaithfulness: avgScore * 0.9,
      ...(avgScore < 0.3 && { warning: "Low confidence — consider rephrasing your query" }),
    };
  }

  private calculateDiversity(chunks: RankedChunk[]): number {
    const uniqueDocs = new Set(chunks.map((c) => c.documentId));
    return Math.min(uniqueDocs.size / (chunks.length || 1), 1);
  }

  private emptyResult(
    requestId: string,
    query: string,
    startTime: number,
    embeddingTokens: number,
  ): QueryResult {
    return {
      requestId,
      query,
      chunks: [],
      context: { text: "", tokenCount: 0, chunks: [], citations: [] },
      quality: {
        overall: 0,
        retrievalConfidence: 0,
        contextSufficiency: 0,
        diversityScore: 0,
        estimatedFaithfulness: 0,
        warning: "No relevant documents found for this query",
      },
      latencyMs: Date.now() - startTime,
      cacheHit: false,
      usage: {
        documentsScanned: 0,
        chunksRetrieved: 0,
        chunksAfterRerank: 0,
        tokensBeforeCompression: 0,
        tokensAfterCompression: 0,
        embeddingTokens,
      },
    };
  }
}
```

---

## Context Assembly

### `packages/core/src/pipeline/context-assembler.ts`

```typescript
import type { RankedChunk, AssembledContext, Citation } from "@ci/types";

export function assembleContext(chunks: RankedChunk[]): AssembledContext {
  const contextParts: string[] = [];
  const citations: Citation[] = [];
  let totalTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sourceLabel = chunk.metadata.documentTitle ?? "Unknown Source";
    const pageInfo = chunk.metadata.pageNumber ? ` (p. ${chunk.metadata.pageNumber})` : "";

    contextParts.push(`[Source ${i + 1}: ${sourceLabel}${pageInfo}]\n${chunk.content}`);
    totalTokens += chunk.tokenCount;

    citations.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: String(chunk.metadata.documentTitle ?? "Untitled"),
      sourceUrl: chunk.metadata.sourceUrl as string | undefined,
      pageNumber: chunk.metadata.pageNumber as number | undefined,
      sectionTitle: chunk.metadata.sectionTitle as string | undefined,
      excerpt: chunk.content.slice(0, 200) + (chunk.content.length > 200 ? "..." : ""),
    });
  }

  return {
    text: contextParts.join("\n\n---\n\n"),
    tokenCount: totalTokens,
    chunks,
    citations,
  };
}
```

---

## Permission-Aware Filtering

Filters are applied **before** vector search (pre-filtering), not after. This is critical for security — users must never see results from documents they cannot access.

### Filter Construction

```typescript
// For a query from user in groups ["engineering", "platform"]:
const filter = {
  must: [
    { key: "projectId", match: { value: "project-uuid" } },
    { key: "isDeleted", match: { value: false } },
  ],
  should: [
    // Document is public
    { key: "accessControl.isPublic", match: { value: true } },
    // User is the document owner
    { key: "accessControl.ownerId", match: { value: "user-123" } },
    // User is in an allowed group
    { key: "accessControl.groupIds", values: { any: ["engineering", "platform"] } },
  ],
};
```

Qdrant applies `should` filters with OR semantics and `must` with AND — matching the required behavior: user sees documents that are public OR owned by them OR shared with their groups.

---

## Cursor-Based Pagination

The retrieval API uses **cursor-based pagination** instead of OFFSET-based. This is a critical improvement over the original plan:

### Why Cursor > OFFSET

| Feature              | Cursor-based                  | OFFSET-based                    |
| -------------------- | ----------------------------- | ------------------------------- |
| Performance at depth | O(1)                          | O(n) — scans all preceding rows |
| Consistency          | Stable across inserts/deletes | Results shift when data changes |
| Scalability          | Constant time at any page     | Degrades linearly with offset   |

### Implementation

```typescript
// Cursor is an opaque base64-encoded string containing:
// { score: number, id: string }

interface PaginatedQueryRequest extends QueryRequest {
  cursor?: string;
  limit?: number; // Default 5, max 20
}

function decodeCursor(cursor: string): { score: number; id: string } {
  return JSON.parse(Buffer.from(cursor, "base64url").toString());
}

function encodeCursor(score: number, id: string): string {
  return Buffer.from(JSON.stringify({ score, id })).toString("base64url");
}

// In search: use score_threshold from cursor to get "next page"
// Qdrant supports offset-based internally, but we wrap with cursor for API
```

### API Response Shape

```typescript
{
  success: true,
  data: {
    requestId: "...",
    chunks: [...],         // Current page results
    context: {...},        // Assembled context from current page
    quality: {...},
    pagination: {
      nextCursor: "eyJzY29yZSI6MC43NSwiaSI6ImFiYy0xMjMifQ==",
      hasMore: true,
    },
  },
}
```

---

## Query Logging

### `packages/core/src/pipeline/query-logger.ts`

```typescript
import { db } from "@ci/db";
import { queryLogs } from "@ci/db/schema";
import type { QueryRequest, QueryResult } from "@ci/types";
import { logger } from "@ci/logger";

export async function logQuery(request: QueryRequest, result: QueryResult): Promise<void> {
  try {
    await db.insert(queryLogs).values({
      tenantId: "", // Set from request context (middleware sets this)
      projectId: request.projectId,
      conversationId: request.conversationId,
      query: request.query,
      chunksRetrieved: result.chunks.length,
      cacheHit: result.cacheHit,
      latencyMs: result.latencyMs,
      qualityScore: result.quality.overall,
      tokensInput: result.usage.tokensBeforeCompression,
      tokensOutput: result.usage.tokensAfterCompression,
      metadata: {
        requestId: result.requestId,
        embeddingTokens: result.usage.embeddingTokens,
        documentsScanned: result.usage.documentsScanned,
      },
    });
  } catch (err) {
    // Never fail the query because of logging
    logger.error({ err }, "Failed to log query");
  }
}
```

---

## Hybrid Search Details

### Reciprocal Rank Fusion (RRF)

RRF merges ranked lists from dense and sparse search without requiring score normalization:

```
RRF_score(doc) = sum over search_methods ( 1 / (k + rank(doc)) )
```

Where `k=60` (standard constant that balances head vs tail results).

### Example

| Document | Dense Rank | Sparse Rank | RRF Score                              |
| -------- | ---------- | ----------- | -------------------------------------- |
| Doc A    | 1          | 3           | 1/61 + 1/63 = 0.0164 + 0.0159 = 0.0323 |
| Doc B    | 3          | 1           | 1/63 + 1/61 = 0.0159 + 0.0164 = 0.0323 |
| Doc C    | 2          | 5           | 1/62 + 1/65 = 0.0161 + 0.0154 = 0.0315 |
| Doc D    | 5          | 2           | 1/65 + 1/62 = 0.0154 + 0.0161 = 0.0315 |

RRF ensures documents that rank well in both dense and sparse search are promoted.

---

## Testing Requirements

- Full retrieval: query returns relevant chunks with score > 0.5
- Empty result: query with no matching documents returns empty with warning
- Permission filter: tenant A cannot see tenant B documents
- Permission filter: non-public documents filtered for unauthorized users
- Hybrid search: RRF fusion produces merged ranking
- Chunk hydration: all returned chunks have content and metadata
- Context assembly: formatted text includes citations
- Cursor pagination: nextCursor allows fetching next page
- Cache: second identical query returns cacheHit=true
- Quality score: composite score between 0 and 1
- Query log: query_logs table has entry after query
- Latency: full pipeline completes in <200ms p99 (1M vectors, cached embedding)

---

## Critical File Paths

| File                                               | Purpose                                  |
| -------------------------------------------------- | ---------------------------------------- |
| `packages/core/src/pipeline/retrieval-pipeline.ts` | Full 10-stage retrieval orchestration    |
| `packages/core/src/pipeline/context-assembler.ts`  | Context formatting + citation generation |
| `packages/core/src/pipeline/query-logger.ts`       | Async query log insertion                |
| `packages/core/src/index.ts`                       | Package entry point, re-exports          |

---

## Risk Assessment

| Risk                                  | Impact | Mitigation                                                    |
| ------------------------------------- | ------ | ------------------------------------------------------------- |
| Qdrant search latency spike           | High   | Circuit breaker; pgvector fallback; cache reduces load        |
| Chunk hydration N+1 query             | Medium | Batch SELECT with `IN` clause; denormalized fields in payload |
| RRF fusion quality vs. learned fusion | Low    | RRF is robust baseline; learned fusion in Phase 4+            |
| Cache staleness after document update | Medium | Invalidate cache on document re-index; short TTL (1 hour)     |
| Large result set memory pressure      | Low    | Limit topK to 100; stream results for >20 chunks              |

---

_Related: [Phase 2 Overview](./README.md) | [Ingestion Pipeline](./04-ingestion-pipeline.md) | [Architecture](../../ARCHITECTURE.md)_
