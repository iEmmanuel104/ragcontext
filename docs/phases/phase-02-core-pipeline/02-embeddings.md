# Phase 2.02: Embeddings

> `@ci/embeddings` — Cohere Embed v4 primary, OpenAI fallback, BGE-M3 self-hosted option.

---

## Objectives

1. Define the `IEmbeddingProvider` interface
2. Implement Cohere Embed v4 as the primary provider (multimodal, Matryoshka dims)
3. Implement OpenAI text-embedding-3-large as the fallback provider
4. Support BGE-M3 for self-hosted deployments
5. Batch processing optimized for each provider's limits
6. Fallback chain with automatic provider switching

## Deliverables

- `packages/embeddings/src/index.ts` — IEmbeddingProvider interface
- `packages/embeddings/src/cohere.ts` — Cohere Embed v4 implementation
- `packages/embeddings/src/openai.ts` — OpenAI text-embedding-3-large
- `packages/embeddings/src/bgem3.ts` — BGE-M3 self-hosted adapter
- `packages/embeddings/src/fallback.ts` — Fallback chain orchestrator

---

## Package Structure

```
packages/embeddings/
├── src/
│   ├── index.ts           # IEmbeddingProvider + types + factory
│   ├── cohere.ts          # Cohere Embed v4
│   ├── openai.ts          # OpenAI text-embedding-3-large
│   ├── bgem3.ts           # BGE-M3 self-hosted
│   └── fallback.ts        # Fallback chain
├── tests/
│   ├── cohere.test.ts
│   ├── openai.test.ts
│   └── fallback.test.ts
├── package.json
└── tsconfig.json
```

---

## IEmbeddingProvider Interface

```typescript
// packages/embeddings/src/index.ts

export interface EmbeddingResult {
  embeddings: number[][];
  tokensUsed: number;
  model: string;
  dimensions: number;
}

export interface IEmbeddingProvider {
  // Core embedding function
  embed(texts: string[], inputType?: EmbeddingInputType): Promise<EmbeddingResult>;

  // Provider metadata
  getDimensions(): number;
  getModel(): string;
  getMaxBatchSize(): number;
  getProvider(): string;

  // Health check
  isAvailable(): Promise<boolean>;
}

export type EmbeddingInputType = "search_document" | "search_query";

export interface EmbeddingProviderConfig {
  provider: "cohere" | "openai" | "bgem3";
  apiKey?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string; // For self-hosted providers
}
```

---

## Cohere Embed v4 Implementation

### Key Specifications

| Property          | Value                                  |
| ----------------- | -------------------------------------- |
| Model             | `embed-v4.0`                           |
| Dimensions        | 256, 512, 768, 1024, 1536 (Matryoshka) |
| Default dimension | 1024                                   |
| Max batch size    | 96 texts per request                   |
| Cost              | $0.12/M tokens                         |
| Input types       | `search_document`, `search_query`      |
| Multimodal        | Text + images in same embedding space  |
| Languages         | 100+                                   |

### `cohere.ts`

```typescript
import { CohereClient } from "cohere-ai";
import { CircuitBreaker, withRetry, isRetryableError } from "@ci/errors";
import { logger } from "@ci/logger";
import type { IEmbeddingProvider, EmbeddingResult, EmbeddingInputType } from "./index.js";

export class CohereEmbeddingProvider implements IEmbeddingProvider {
  private client: CohereClient;
  private model: string;
  private dimensions: number;
  private breaker: CircuitBreaker;
  private readonly MAX_BATCH_SIZE = 96;

  constructor(apiKey: string, model = "embed-v4.0", dimensions = 1024) {
    this.client = new CohereClient({ token: apiKey });
    this.model = model;
    this.dimensions = dimensions;
    this.breaker = new CircuitBreaker({
      name: "cohere-embed",
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      monitorWindowMs: 60_000,
    });
  }

  async embed(
    texts: string[],
    inputType: EmbeddingInputType = "search_document",
  ): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { embeddings: [], tokensUsed: 0, model: this.model, dimensions: this.dimensions };
    }

    const allEmbeddings: number[][] = [];
    let totalTokens = 0;

    // Process in batches of 96
    for (let i = 0; i < texts.length; i += this.MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + this.MAX_BATCH_SIZE);

      const response = await withRetry(
        () =>
          this.breaker.execute(() =>
            this.client.embed({
              texts: batch,
              model: this.model,
              inputType,
              embeddingTypes: ["float"],
              truncate: "END",
            }),
          ),
        { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000, shouldRetry: isRetryableError },
      );

      const embeddings = response.embeddings?.float ?? [];
      allEmbeddings.push(...(embeddings as number[][]));

      // Track token usage (Cohere returns billed tokens in meta)
      if (response.meta?.billedUnits?.inputTokens) {
        totalTokens += response.meta.billedUnits.inputTokens;
      }
    }

    // Validate dimensions
    if (allEmbeddings.length > 0 && allEmbeddings[0].length !== this.dimensions) {
      logger.warn(
        {
          expected: this.dimensions,
          actual: allEmbeddings[0].length,
        },
        "Embedding dimension mismatch",
      );
    }

    return {
      embeddings: allEmbeddings,
      tokensUsed: totalTokens,
      model: this.model,
      dimensions: this.dimensions,
    };
  }

  getDimensions(): number {
    return this.dimensions;
  }
  getModel(): string {
    return this.model;
  }
  getMaxBatchSize(): number {
    return this.MAX_BATCH_SIZE;
  }
  getProvider(): string {
    return "cohere";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.embed({
        texts: ["health check"],
        model: this.model,
        inputType: "search_query",
        embeddingTypes: ["float"],
      });
      return true;
    } catch {
      return false;
    }
  }
}
```

### Matryoshka Dimension Strategy

Cohere Embed v4 supports Matryoshka representation learning — embeddings can be truncated to smaller dimensions with minimal quality loss:

| Dimension | Use Case               | Quality (MTEB) | Storage per 1M vectors |
| --------- | ---------------------- | -------------- | ---------------------- |
| 256       | Semantic cache lookups | ~95% of full   | ~1 GB                  |
| 512       | Cost-optimized search  | ~97% of full   | ~2 GB                  |
| 1024      | **Default production** | ~99% of full   | ~4 GB                  |
| 1536      | Maximum accuracy       | 100% baseline  | ~6 GB                  |

**Strategy:** Use 1024-dim for primary index, 256-dim for semantic cache lookups (faster cosine comparison in Redis).

---

## OpenAI Fallback Implementation

### `openai.ts`

```typescript
import OpenAI from "openai";
import { CircuitBreaker, withRetry, isRetryableError } from "@ci/errors";
import type { IEmbeddingProvider, EmbeddingResult, EmbeddingInputType } from "./index.js";

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private dimensions: number;
  private breaker: CircuitBreaker;
  private readonly MAX_BATCH_SIZE = 2048; // OpenAI supports larger batches

  constructor(apiKey: string, model = "text-embedding-3-large", dimensions = 1024) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = dimensions;
    this.breaker = new CircuitBreaker({
      name: "openai-embed",
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      monitorWindowMs: 60_000,
    });
  }

  async embed(
    texts: string[],
    _inputType: EmbeddingInputType = "search_document",
  ): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { embeddings: [], tokensUsed: 0, model: this.model, dimensions: this.dimensions };
    }

    const allEmbeddings: number[][] = [];
    let totalTokens = 0;

    for (let i = 0; i < texts.length; i += this.MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + this.MAX_BATCH_SIZE);

      const response = await withRetry(
        () =>
          this.breaker.execute(() =>
            this.client.embeddings.create({
              input: batch,
              model: this.model,
              dimensions: this.dimensions,
            }),
          ),
        { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000, shouldRetry: isRetryableError },
      );

      allEmbeddings.push(...response.data.map((d) => d.embedding));
      totalTokens += response.usage?.total_tokens ?? 0;
    }

    return {
      embeddings: allEmbeddings,
      tokensUsed: totalTokens,
      model: this.model,
      dimensions: this.dimensions,
    };
  }

  getDimensions(): number {
    return this.dimensions;
  }
  getModel(): string {
    return this.model;
  }
  getMaxBatchSize(): number {
    return this.MAX_BATCH_SIZE;
  }
  getProvider(): string {
    return "openai";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.embeddings.create({
        input: ["health check"],
        model: this.model,
        dimensions: this.dimensions,
      });
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## BGE-M3 Self-Hosted Option

### `bgem3.ts`

BGE-M3 generates dense, sparse, and ColBERT representations in a single model:

```typescript
import type { IEmbeddingProvider, EmbeddingResult, EmbeddingInputType } from "./index.js";

// BGE-M3 runs as a separate HTTP service (Python FastAPI or ONNX runtime)
export class BgeM3EmbeddingProvider implements IEmbeddingProvider {
  private baseUrl: string;
  private readonly MAX_BATCH_SIZE = 32;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async embed(
    texts: string[],
    _inputType: EmbeddingInputType = "search_document",
  ): Promise<EmbeddingResult> {
    const response = await fetch(`${this.baseUrl}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, return_dense: true, return_sparse: true }),
    });

    if (!response.ok) throw new Error(`BGE-M3 error: ${response.status}`);

    const data = await response.json();
    return {
      embeddings: data.dense_embeddings,
      tokensUsed: data.tokens_used ?? 0,
      model: "bge-m3",
      dimensions: 1024,
    };
  }

  getDimensions(): number {
    return 1024;
  }
  getModel(): string {
    return "BAAI/bge-m3";
  }
  getMaxBatchSize(): number {
    return this.MAX_BATCH_SIZE;
  }
  getProvider(): string {
    return "bgem3";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
```

---

## Fallback Chain

### `fallback.ts`

```typescript
import { logger } from "@ci/logger";
import type { IEmbeddingProvider, EmbeddingResult, EmbeddingInputType } from "./index.js";

export class FallbackEmbeddingProvider implements IEmbeddingProvider {
  private providers: IEmbeddingProvider[];
  private activeIndex = 0;

  constructor(providers: IEmbeddingProvider[]) {
    if (providers.length === 0) throw new Error("At least one provider is required");
    this.providers = providers;
  }

  async embed(
    texts: string[],
    inputType: EmbeddingInputType = "search_document",
  ): Promise<EmbeddingResult> {
    for (let i = 0; i < this.providers.length; i++) {
      const idx = (this.activeIndex + i) % this.providers.length;
      const provider = this.providers[idx];

      try {
        const result = await provider.embed(texts, inputType);
        this.activeIndex = idx; // Stick with working provider
        return result;
      } catch (error) {
        logger.warn(
          {
            provider: provider.getProvider(),
            error: error instanceof Error ? error.message : String(error),
          },
          "Embedding provider failed, trying fallback",
        );

        if (i === this.providers.length - 1) {
          throw error; // All providers failed
        }
      }
    }

    throw new Error("All embedding providers failed");
  }

  getDimensions(): number {
    return this.providers[this.activeIndex].getDimensions();
  }
  getModel(): string {
    return this.providers[this.activeIndex].getModel();
  }
  getMaxBatchSize(): number {
    return this.providers[this.activeIndex].getMaxBatchSize();
  }
  getProvider(): string {
    return `fallback(${this.providers.map((p) => p.getProvider()).join(",")})`;
  }

  async isAvailable(): Promise<boolean> {
    for (const p of this.providers) {
      if (await p.isAvailable()) return true;
    }
    return false;
  }
}
```

**Default fallback chain:** Cohere Embed v4 -> OpenAI text-embedding-3-large

Important: All providers in a fallback chain **must use the same dimensions** (1024 default). Mixing dimensions corrupts the vector index.

---

## Embedding Quality Benchmarks (MTEB)

| Model                         | Retrieval (NDCG@10) | Classification | STS   | Dims     | Cost        |
| ----------------------------- | ------------------- | -------------- | ----- | -------- | ----------- |
| Cohere Embed v4               | 0.592               | 0.842          | 0.867 | 256-1536 | $0.12/M     |
| OpenAI text-embedding-3-large | 0.588               | 0.839          | 0.870 | 256-3072 | $0.13/M     |
| BGE-M3                        | 0.571               | 0.821          | 0.843 | 1024     | Self-hosted |
| Cohere Embed v3 (previous)    | 0.554               | 0.827          | 0.852 | 1024     | $0.10/M     |

Cohere v4 provides the best retrieval quality per dollar. OpenAI is nearly equivalent and serves as the ideal fallback.

---

## Testing Requirements

- Cohere: embed single text returns correct dimensions (1024)
- Cohere: batch of 96 texts processes in single API call
- Cohere: batch of 200 texts splits into correct number of batches
- Cohere: empty input returns empty result
- Cohere: `search_document` vs `search_query` input types work correctly
- OpenAI: embed with custom dimensions (1024) returns correct size
- OpenAI: large batch (2048 texts) processes without error
- Fallback: primary failure triggers fallback provider
- Fallback: all providers failing throws error
- Fallback: recovery sticks with working provider
- Circuit breaker: 5 failures opens the circuit
- All providers: health check endpoint works

---

## Critical File Paths

| File                                  | Purpose                              |
| ------------------------------------- | ------------------------------------ |
| `packages/embeddings/src/index.ts`    | IEmbeddingProvider interface + types |
| `packages/embeddings/src/cohere.ts`   | Cohere Embed v4 (primary)            |
| `packages/embeddings/src/openai.ts`   | OpenAI (fallback)                    |
| `packages/embeddings/src/bgem3.ts`    | BGE-M3 (self-hosted)                 |
| `packages/embeddings/src/fallback.ts` | Fallback chain orchestrator          |

---

## Risk Assessment

| Risk                                | Impact   | Mitigation                                                           |
| ----------------------------------- | -------- | -------------------------------------------------------------------- |
| Cohere API rate limit (100 req/min) | High     | Queue-based throttling; batch 96 texts/request; backoff              |
| Dimension mismatch in fallback      | Critical | Validate all providers use same dimensions; fail fast on mismatch    |
| BGE-M3 service unavailable          | Low      | Optional provider; Cohere + OpenAI cover production needs            |
| Token counting accuracy             | Low      | Approximate with `text.length / 4`; Cohere returns exact in response |

---

_Related: [Phase 2 Overview](./README.md) | [Vector Store](./01-vector-store.md) | [Chunking & Parsing](./03-chunking-and-parsing.md)_
