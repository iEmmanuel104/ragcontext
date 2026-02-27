# 01 — Reranker

> **Package**: `packages/reranker` | **Namespace**: `@ci/reranker`
> **Entry Point**: `packages/reranker/src/index.ts`

---

## Overview

The reranker package implements a multi-stage reranking pipeline that improves retrieval precision by 8-11% over baseline vector search. It sits between vector search (which returns top-100 candidates) and context assembly (which receives top-5 refined results).

The primary provider is **Cohere Rerank 3.5** ($2/1K searches, 100+ languages, ~600ms avg latency). The self-hosted fallback is **BGE-reranker-v2-m3** (GPU, $0.50-2/hour). A multi-stage pipeline combines fast ColBERT/PLAID late interaction (top-20 in 10-20ms) with precise Cohere cross-encoder scoring (top-5 in 50-100ms).

---

## Interface

```typescript
// packages/reranker/src/index.ts
import type { RankedChunk } from "@ci/types";

export interface IRerankProvider {
  /**
   * Rerank a set of chunks against a query.
   * Returns the top N chunks sorted by relevance.
   *
   * @param query - The user's query
   * @param chunks - Chunks to rerank (from vector search)
   * @param topN - Number of chunks to return after reranking
   * @returns Reranked chunks with updated scores
   */
  rerank(query: string, chunks: RankedChunk[], topN: number): Promise<RankedChunk[]>;

  /**
   * Return the provider name for telemetry and logging.
   */
  getProviderName(): string;
}
```

---

## Cohere Rerank 3.5 Implementation

```typescript
// packages/reranker/src/cohere.ts
import { CohereClient } from "cohere-ai";
import type { RankedChunk } from "@ci/types";
import type { IRerankProvider } from "./index";
import { logger } from "@ci/logger";

export class CohereRerankProvider implements IRerankProvider {
  private client: CohereClient;
  private model: string;

  constructor(apiKey: string, model = "rerank-v3.5") {
    this.client = new CohereClient({ token: apiKey });
    this.model = model;
  }

  async rerank(query: string, chunks: RankedChunk[], topN: number): Promise<RankedChunk[]> {
    if (chunks.length === 0) return [];
    if (chunks.length <= topN) return chunks;

    const startTime = performance.now();

    const response = await this.client.rerank({
      model: this.model,
      query,
      documents: chunks.map((c) => ({ text: c.content })),
      topN,
      returnDocuments: false,
    });

    const latencyMs = performance.now() - startTime;
    logger.debug(
      { latencyMs, inputCount: chunks.length, outputCount: topN },
      "Cohere rerank complete",
    );

    // Map Cohere results back to our RankedChunk type
    return response.results.map((result) => {
      const originalChunk = chunks[result.index];
      return {
        ...originalChunk,
        rerankScore: result.relevanceScore,
        score: result.relevanceScore, // Override vector score with rerank score
      };
    });
  }

  getProviderName(): string {
    return `cohere/${this.model}`;
  }
}
```

### Cohere Rerank 3.5 Specifications

| Property            | Value                             |
| ------------------- | --------------------------------- |
| Model               | `rerank-v3.5`                     |
| Cost                | $2 per 1,000 searches             |
| Improvement         | 8-11% over baseline vector search |
| Languages           | 100+                              |
| Max documents       | 1,000 per request                 |
| Max document length | 4,096 tokens                      |
| Average latency     | ~600ms (cross-encoder scoring)    |

---

## BGE-reranker-v2-m3 Self-Hosted Fallback

```typescript
// packages/reranker/src/bge.ts
import type { RankedChunk } from "@ci/types";
import type { IRerankProvider } from "./index";
import { logger } from "@ci/logger";

export class BGERerankProvider implements IRerankProvider {
  private endpoint: string;

  constructor(endpoint: string) {
    // BGE reranker runs as a separate service (Python FastAPI + GPU)
    // Endpoint format: http://bge-reranker:8080/rerank
    this.endpoint = endpoint;
  }

  async rerank(query: string, chunks: RankedChunk[], topN: number): Promise<RankedChunk[]> {
    if (chunks.length === 0) return [];
    if (chunks.length <= topN) return chunks;

    const startTime = performance.now();

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        passages: chunks.map((c) => c.content),
        top_n: topN,
      }),
    });

    if (!response.ok) {
      throw new Error(`BGE reranker error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { results: Array<{ index: number; score: number }> };
    const latencyMs = performance.now() - startTime;
    logger.debug(
      { latencyMs, inputCount: chunks.length, outputCount: topN },
      "BGE rerank complete",
    );

    return data.results.map((result) => {
      const originalChunk = chunks[result.index];
      return {
        ...originalChunk,
        rerankScore: result.score,
        score: result.score,
      };
    });
  }

  getProviderName(): string {
    return "bge-reranker-v2-m3";
  }
}
```

### BGE Self-Hosted Specifications

| Property     | Value                             |
| ------------ | --------------------------------- |
| Model        | BAAI/bge-reranker-v2-m3           |
| License      | Apache 2.0                        |
| Cost         | $0.50-2/hour (GPU instance)       |
| Languages    | 100+ (same as BGE-M3)             |
| Latency      | 20-80ms per batch (GPU-dependent) |
| Requirements | CUDA-capable GPU, 4GB+ VRAM       |

---

## Multi-Stage Reranking Pipeline

The production pipeline uses a two-stage approach to balance speed and accuracy:

```typescript
// packages/reranker/src/multi-stage.ts
import type { RankedChunk } from "@ci/types";
import type { IRerankProvider } from "./index";
import { logger } from "@ci/logger";

export class MultiStageRerankProvider implements IRerankProvider {
  constructor(
    private stage1: IRerankProvider, // Fast: ColBERT/PLAID or BGE, top-20
    private stage2: IRerankProvider, // Precise: Cohere Rerank 3.5, top-5
    private stage1TopN: number = 20,
  ) {}

  async rerank(query: string, chunks: RankedChunk[], topN: number): Promise<RankedChunk[]> {
    const startTime = performance.now();

    // Stage 1: Fast narrowing (top-100 -> top-20)
    const stage1Start = performance.now();
    const narrowed = await this.stage1.rerank(query, chunks, this.stage1TopN);
    const stage1Ms = performance.now() - stage1Start;

    // Stage 2: Precise scoring (top-20 -> top-N)
    const stage2Start = performance.now();
    const reranked = await this.stage2.rerank(query, narrowed, topN);
    const stage2Ms = performance.now() - stage2Start;

    const totalMs = performance.now() - startTime;
    logger.info(
      {
        stage1Ms: Math.round(stage1Ms),
        stage2Ms: Math.round(stage2Ms),
        totalMs: Math.round(totalMs),
        inputCount: chunks.length,
        stage1Output: narrowed.length,
        finalOutput: reranked.length,
      },
      "Multi-stage rerank complete",
    );

    return reranked;
  }

  getProviderName(): string {
    return `multi-stage(${this.stage1.getProviderName()}->${this.stage2.getProviderName()})`;
  }
}
```

### Pipeline Latency Budgets

```
Vector Search (top-100)     20-50ms
    |
Stage 1: ColBERT/BGE        10-20ms   (top-100 -> top-20)
    |
Stage 2: Cohere Rerank 3.5  50-100ms  (top-20 -> top-5)
    |
Total Reranking Budget:      60-120ms
```

---

## Reranker Factory

```typescript
// packages/reranker/src/factory.ts
import type { IRerankProvider } from "./index";
import { CohereRerankProvider } from "./cohere";
import { BGERerankProvider } from "./bge";
import { MultiStageRerankProvider } from "./multi-stage";
import type { RerankingConfig } from "@ci/types";

export function createRerankProvider(config: RerankingConfig): IRerankProvider {
  if (!config.enabled) {
    return new NoOpRerankProvider();
  }

  switch (config.provider) {
    case "cohere":
      return new CohereRerankProvider(process.env.COHERE_API_KEY!, config.model || "rerank-v3.5");

    case "bgereranker":
      return new BGERerankProvider(process.env.BGE_RERANKER_ENDPOINT!);

    case "multi-stage":
      return new MultiStageRerankProvider(
        new BGERerankProvider(process.env.BGE_RERANKER_ENDPOINT!),
        new CohereRerankProvider(process.env.COHERE_API_KEY!, config.model),
        20,
      );

    default:
      return new CohereRerankProvider(process.env.COHERE_API_KEY!);
  }
}

// No-op provider for when reranking is disabled
class NoOpRerankProvider implements IRerankProvider {
  async rerank(_query: string, chunks: RankedChunk[], topN: number): Promise<RankedChunk[]> {
    return chunks.slice(0, topN);
  }
  getProviderName(): string {
    return "noop";
  }
}
```

---

## A/B Testing Framework

```typescript
// packages/reranker/src/ab-testing.ts
import type { IRerankProvider } from "./index";
import type { RankedChunk } from "@ci/types";
import { logger } from "@ci/logger";

export class ABTestRerankProvider implements IRerankProvider {
  constructor(
    private controlProvider: IRerankProvider,
    private treatmentProvider: IRerankProvider,
    private treatmentPercentage: number = 10, // 10% of traffic
  ) {}

  async rerank(query: string, chunks: RankedChunk[], topN: number): Promise<RankedChunk[]> {
    const useTreatment = Math.random() * 100 < this.treatmentPercentage;
    const provider = useTreatment ? this.treatmentProvider : this.controlProvider;

    const result = await provider.rerank(query, chunks, topN);

    // Log which variant was used for later analysis
    logger.info(
      {
        variant: useTreatment ? "treatment" : "control",
        provider: provider.getProviderName(),
        topScore: result[0]?.score,
      },
      "A/B test rerank",
    );

    return result;
  }

  getProviderName(): string {
    return `ab-test(${this.controlProvider.getProviderName()}|${this.treatmentProvider.getProviderName()})`;
  }
}
```

The A/B testing framework allows comparing reranking strategies in production. Results are logged to the `query_logs` table and can be analyzed through the analytics dashboard to measure nDCG@5 improvements.

---

## Batch Processing

For ingestion-time reranking or batch evaluation, the reranker supports processing multiple queries in parallel:

```typescript
// packages/reranker/src/batch.ts
import type { IRerankProvider } from "./index";
import type { RankedChunk } from "@ci/types";

export async function batchRerank(
  provider: IRerankProvider,
  queries: Array<{ query: string; chunks: RankedChunk[]; topN: number }>,
  concurrency = 5,
): Promise<RankedChunk[][]> {
  const results: RankedChunk[][] = [];
  for (let i = 0; i < queries.length; i += concurrency) {
    const batch = queries.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((q) => provider.rerank(q.query, q.chunks, q.topN)),
    );
    results.push(...batchResults);
  }
  return results;
}
```

---

## Testing Requirements

```typescript
// packages/reranker/src/__tests__/cohere.test.ts
import { describe, it, expect, vi } from "vitest";
import { CohereRerankProvider } from "../cohere";

describe("CohereRerankProvider", () => {
  it("reranks chunks and returns topN results", async () => {
    // Mock Cohere API
    const provider = new CohereRerankProvider("test-key");
    const chunks = createMockChunks(20);
    const result = await provider.rerank("test query", chunks, 5);
    expect(result).toHaveLength(5);
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
  });

  it("returns all chunks if fewer than topN", async () => {
    const provider = new CohereRerankProvider("test-key");
    const chunks = createMockChunks(3);
    const result = await provider.rerank("test query", chunks, 5);
    expect(result).toHaveLength(3);
  });

  it("handles empty chunks array", async () => {
    const provider = new CohereRerankProvider("test-key");
    const result = await provider.rerank("test query", [], 5);
    expect(result).toHaveLength(0);
  });
});

describe("MultiStageRerankProvider", () => {
  it("narrows through two stages", async () => {
    // Verify stage 1 receives full set, stage 2 receives narrowed set
  });

  it("logs latencies for both stages", async () => {
    // Verify logging output
  });
});

describe("ABTestRerankProvider", () => {
  it("routes traffic according to percentage", async () => {
    // Run 1000 iterations, verify ~10% go to treatment
  });
});
```

---

## Related Documentation

- [Phase 4 README](./README.md) — Phase overview
- [02-compressor.md](./02-compressor.md) — Context compression (next pipeline stage)
- [04-quality-scoring.md](./04-quality-scoring.md) — Quality evaluation
- [Phase 3: API Server](../phase-03-api-sdk/01-api-server.md) — Pipeline integration point
