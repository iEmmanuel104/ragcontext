# 02 — Context Compressor

> **Package**: `packages/compressor` | **Namespace**: `@ci/compressor`
> **Entry Point**: `packages/compressor/src/index.ts`

---

## Overview

The compressor package reduces the token count of retrieved context before injection into the target LLM. This directly translates to lower API costs (tokens are the primary cost driver) and faster LLM response times (fewer input tokens = faster processing).

Three compression strategies are supported:

1. **LLMLingua-2** (Microsoft Research) — Up to 20x compression with only 1.5% performance loss, 3-6x faster than the original LLMLingua
2. **LongLLMLingua** — Question-aware compression that combats the "lost in the middle" problem, achieving 21.4% improvement at 4x compression with 94% cost reduction
3. **Extractive fallback** — Sentence importance scoring without LLM dependency, for environments where external API calls are restricted

The compressor also handles **model-agnostic context formatting**: XML-structured for Claude, markdown for GPT, raw text for Gemini at long contexts.

---

## Interface

```typescript
// packages/compressor/src/index.ts
import type { RankedChunk, AssembledContext } from "@ci/types";

export interface ICompressor {
  /**
   * Compress a set of ranked chunks into a smaller context.
   *
   * @param chunks - Reranked chunks to compress
   * @param query - The original user query (for question-aware compression)
   * @param targetRatio - Target compression ratio (0.5 = 50% token reduction)
   * @returns Assembled context with compressed text
   */
  compress(chunks: RankedChunk[], query: string, targetRatio?: number): Promise<AssembledContext>;

  /**
   * Return the provider name for telemetry.
   */
  getProviderName(): string;
}
```

---

## LLMLingua-2 Implementation

LLMLingua-2 runs as a Python sidecar service since the core library is Python-based. The Node.js package communicates with it via HTTP.

```typescript
// packages/compressor/src/llmlingua.ts
import type { RankedChunk, AssembledContext } from "@ci/types";
import type { ICompressor } from "./index";
import { logger } from "@ci/logger";
import { buildCitations } from "./utils";

export class LLMLinguaCompressor implements ICompressor {
  private endpoint: string;

  constructor(endpoint?: string) {
    // LLMLingua-2 runs as a Python FastAPI sidecar
    this.endpoint = endpoint ?? process.env.LLMLINGUA_ENDPOINT ?? "http://localhost:8081";
  }

  async compress(
    chunks: RankedChunk[],
    query: string,
    targetRatio = 0.5,
  ): Promise<AssembledContext> {
    if (chunks.length === 0) {
      return { text: "", tokenCount: 0, chunks: [], citations: [] };
    }

    const startTime = performance.now();
    const originalText = chunks.map((c) => c.content).join("\n\n---\n\n");

    const response = await fetch(`${this.endpoint}/compress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: originalText,
        instruction: query,
        target_ratio: targetRatio,
        model: "llmlingua-2",
        // LLMLingua-2 specific options
        force_tokens: ["\\n", "---", "[Source:", "]"], // Preserve structure markers
        drop_consecutive: true,
      }),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "LLMLingua compression failed, falling back to uncompressed",
      );
      return this.assembleUncompressed(chunks);
    }

    const data = (await response.json()) as {
      compressed_text: string;
      original_tokens: number;
      compressed_tokens: number;
      ratio: number;
    };

    const latencyMs = performance.now() - startTime;
    logger.info(
      {
        latencyMs: Math.round(latencyMs),
        originalTokens: data.original_tokens,
        compressedTokens: data.compressed_tokens,
        ratio: data.ratio,
      },
      "LLMLingua-2 compression complete",
    );

    return {
      text: data.compressed_text,
      tokenCount: data.compressed_tokens,
      chunks,
      citations: buildCitations(chunks),
      compressionRatio: data.ratio,
    };
  }

  private assembleUncompressed(chunks: RankedChunk[]): AssembledContext {
    const text = chunks
      .map((c) => `[Source: ${c.metadata.documentTitle ?? "Unknown"}]\n${c.content}`)
      .join("\n\n---\n\n");

    const tokenCount = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
    return { text, tokenCount, chunks, citations: buildCitations(chunks) };
  }

  getProviderName(): string {
    return "llmlingua-2";
  }
}
```

### LLMLingua-2 Python Sidecar

```python
# infra/services/llmlingua/main.py
from fastapi import FastAPI
from pydantic import BaseModel
from llmlingua import PromptCompressor

app = FastAPI()
compressor = PromptCompressor(
    model_name="microsoft/llmlingua-2-xlm-roberta-large-meetingbank",
    use_llmlingua2=True,
)

class CompressRequest(BaseModel):
    context: str
    instruction: str
    target_ratio: float = 0.5
    force_tokens: list[str] = []
    drop_consecutive: bool = True

class CompressResponse(BaseModel):
    compressed_text: str
    original_tokens: int
    compressed_tokens: int
    ratio: float

@app.post("/compress", response_model=CompressResponse)
async def compress(req: CompressRequest):
    result = compressor.compress_prompt(
        context=[req.context],
        instruction=req.instruction,
        rate=req.target_ratio,
        force_tokens=req.force_tokens,
        drop_consecutive=req.drop_consecutive,
    )
    return CompressResponse(
        compressed_text=result["compressed_prompt"],
        original_tokens=result["origin_tokens"],
        compressed_tokens=result["compressed_tokens"],
        ratio=result["ratio"],
    )
```

---

## LongLLMLingua (Question-Aware Compression)

LongLLMLingua extends LLMLingua with question-aware coarse-to-fine compression. It is particularly effective for RAG because it:

- Dynamically adjusts compression per-chunk based on relevance to the query
- Combats the "lost in the middle" problem by preserving key information regardless of position
- Achieves 21.4% improvement at 4x compression on RAG benchmarks

```typescript
// packages/compressor/src/longllmlingua.ts
import type { RankedChunk, AssembledContext } from "@ci/types";
import type { ICompressor } from "./index";
import { logger } from "@ci/logger";
import { buildCitations } from "./utils";

export class LongLLMLinguaCompressor implements ICompressor {
  private endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint ?? process.env.LLMLINGUA_ENDPOINT ?? "http://localhost:8081";
  }

  async compress(
    chunks: RankedChunk[],
    query: string,
    targetRatio = 0.25, // More aggressive default for LongLLMLingua
  ): Promise<AssembledContext> {
    if (chunks.length === 0) {
      return { text: "", tokenCount: 0, chunks: [], citations: [] };
    }

    const startTime = performance.now();

    // LongLLMLingua processes each chunk separately for question-aware scoring
    const contexts = chunks.map((c) => c.content);

    const response = await fetch(`${this.endpoint}/compress-long`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contexts,
        question: query,
        target_ratio: targetRatio,
        // LongLLMLingua specific: reorder chunks by relevance to question
        reorder_context: true,
        // Dynamic compression: more aggressive on less relevant chunks
        dynamic_context_compression: true,
        // Preserve key entities and numbers
        condition_in_question: "after",
      }),
    });

    if (!response.ok) {
      logger.warn("LongLLMLingua failed, falling back to LLMLingua-2");
      // Fallback to standard LLMLingua-2
      const fallback = new (await import("./llmlingua")).LLMLinguaCompressor(this.endpoint);
      return fallback.compress(chunks, query, targetRatio);
    }

    const data = (await response.json()) as {
      compressed_text: string;
      original_tokens: number;
      compressed_tokens: number;
      ratio: number;
    };

    const latencyMs = performance.now() - startTime;
    logger.info(
      {
        latencyMs: Math.round(latencyMs),
        originalTokens: data.original_tokens,
        compressedTokens: data.compressed_tokens,
        ratio: data.ratio,
      },
      "LongLLMLingua compression complete",
    );

    return {
      text: data.compressed_text,
      tokenCount: data.compressed_tokens,
      chunks,
      citations: buildCitations(chunks),
      compressionRatio: data.ratio,
    };
  }

  getProviderName(): string {
    return "longllmlingua";
  }
}
```

---

## Extractive Fallback

For environments where external services are unavailable or when the LLMLingua sidecar is down, the extractive compressor uses sentence importance scoring without any LLM dependency.

```typescript
// packages/compressor/src/extractive.ts
import type { RankedChunk, AssembledContext } from "@ci/types";
import type { ICompressor } from "./index";
import { buildCitations } from "./utils";

export class ExtractiveCompressor implements ICompressor {
  async compress(
    chunks: RankedChunk[],
    query: string,
    targetRatio = 0.5,
  ): Promise<AssembledContext> {
    if (chunks.length === 0) {
      return { text: "", tokenCount: 0, chunks: [], citations: [] };
    }

    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
    const targetTokens = Math.ceil(totalTokens * targetRatio);

    // Split each chunk into sentences
    const scoredSentences: Array<{ text: string; score: number; chunkIdx: number }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const sentences = this.splitSentences(chunks[i].content);
      for (const sentence of sentences) {
        const score = this.scoreSentence(sentence, query, chunks[i].score);
        scoredSentences.push({ text: sentence, score, chunkIdx: i });
      }
    }

    // Sort by score, take top sentences until we hit the token budget
    scoredSentences.sort((a, b) => b.score - a.score);

    const selectedSentences: typeof scoredSentences = [];
    let currentTokens = 0;

    for (const sentence of scoredSentences) {
      const sentenceTokens = Math.ceil(sentence.text.split(/\s+/).length * 1.3);
      if (currentTokens + sentenceTokens > targetTokens) break;
      selectedSentences.push(sentence);
      currentTokens += sentenceTokens;
    }

    // Restore original order within each chunk
    selectedSentences.sort((a, b) => a.chunkIdx - b.chunkIdx);
    const text = selectedSentences.map((s) => s.text).join(" ");

    return {
      text,
      tokenCount: currentTokens,
      chunks,
      citations: buildCitations(chunks),
      compressionRatio: currentTokens / totalTokens,
    };
  }

  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);
  }

  private scoreSentence(sentence: string, query: string, chunkScore: number): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const sentenceLower = sentence.toLowerCase();

    // Term overlap with query
    const termOverlap =
      queryTerms.filter((t) => sentenceLower.includes(t)).length / queryTerms.length;

    // Position bias (sentences at the start of chunks are often more important)
    const positionScore = 0.8; // Simplified; would use actual position in production

    // Length penalty (very short sentences are less informative)
    const lengthScore = Math.min(sentence.length / 200, 1);

    // Weighted combination
    return termOverlap * 0.4 + chunkScore * 0.3 + positionScore * 0.1 + lengthScore * 0.2;
  }

  getProviderName(): string {
    return "extractive";
  }
}
```

---

## Model-Agnostic Context Formatting

Different LLMs perform best with different context formats. The formatter optimizes context structure per target model:

```typescript
// packages/compressor/src/formatter.ts
import type { RankedChunk, AssembledContext } from "@ci/types";

export type TargetModel = "claude" | "gpt" | "gemini" | "generic";

export function formatContextForModel(context: AssembledContext, targetModel: TargetModel): string {
  switch (targetModel) {
    case "claude":
      return formatXML(context);
    case "gpt":
      return formatMarkdown(context);
    case "gemini":
      return formatRaw(context);
    default:
      return formatMarkdown(context);
  }
}

function formatXML(context: AssembledContext): string {
  let xml = "<context>\n";
  for (const chunk of context.chunks) {
    xml += `  <source title="${escapeXml(String(chunk.metadata.documentTitle ?? "Unknown"))}" `;
    xml += `score="${chunk.score.toFixed(3)}">\n`;
    xml += `    ${escapeXml(chunk.content)}\n`;
    xml += `  </source>\n`;
  }
  xml += "</context>";
  return xml;
}

function formatMarkdown(context: AssembledContext): string {
  return context.chunks
    .map((chunk, i) => {
      const title = chunk.metadata.documentTitle ?? "Unknown";
      return `### Source ${i + 1}: ${title}\n\n${chunk.content}`;
    })
    .join("\n\n---\n\n");
}

function formatRaw(context: AssembledContext): string {
  return context.text;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

---

## Token Budget Management

```typescript
// packages/compressor/src/budget.ts

// Model context windows and pricing (input tokens)
const MODEL_BUDGETS: Record<string, { maxContext: number; costPer1KTokens: number }> = {
  "claude-sonnet-4": { maxContext: 200_000, costPer1KTokens: 0.003 },
  "claude-opus-4": { maxContext: 200_000, costPer1KTokens: 0.015 },
  "gpt-4o": { maxContext: 128_000, costPer1KTokens: 0.0025 },
  "gpt-4o-mini": { maxContext: 128_000, costPer1KTokens: 0.00015 },
  "gemini-2.0-flash": { maxContext: 1_000_000, costPer1KTokens: 0.0001 },
};

export function calculateTargetRatio(
  currentTokens: number,
  targetModel: string,
  maxBudgetUSD?: number,
): number {
  const budget = MODEL_BUDGETS[targetModel];
  if (!budget) return 0.5; // Default 50% compression

  // Ratio from context window (leave 50% for generation)
  const contextLimit = budget.maxContext * 0.5;
  const windowRatio = currentTokens > contextLimit ? contextLimit / currentTokens : 1.0;

  // Ratio from cost budget
  let costRatio = 1.0;
  if (maxBudgetUSD) {
    const maxTokens = (maxBudgetUSD / budget.costPer1KTokens) * 1000;
    costRatio = currentTokens > maxTokens ? maxTokens / currentTokens : 1.0;
  }

  return Math.min(windowRatio, costRatio);
}
```

---

## Compressor Factory

```typescript
// packages/compressor/src/factory.ts
import type { ICompressor } from "./index";
import type { CompressionConfig } from "@ci/types";
import { LLMLinguaCompressor } from "./llmlingua";
import { LongLLMLinguaCompressor } from "./longllmlingua";
import { ExtractiveCompressor } from "./extractive";

export function createCompressor(config: CompressionConfig): ICompressor {
  if (!config.enabled) {
    return new NoOpCompressor();
  }

  switch (config.method) {
    case "llmlingua":
      return new LLMLinguaCompressor();
    case "longllmlingua":
      return new LongLLMLinguaCompressor();
    case "extractive":
      return new ExtractiveCompressor();
    default:
      return new LLMLinguaCompressor();
  }
}

class NoOpCompressor implements ICompressor {
  async compress(chunks: RankedChunk[], _query: string): Promise<AssembledContext> {
    const text = chunks.map((c) => c.content).join("\n\n---\n\n");
    const tokenCount = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
    return { text, tokenCount, chunks, citations: buildCitations(chunks) };
  }
  getProviderName() {
    return "noop";
  }
}
```

---

## Testing Requirements

- LLMLingua-2: verify compression ratio is within 10% of target
- LLMLingua-2: verify content fidelity (key facts preserved after compression)
- LongLLMLingua: verify question-aware compression preserves query-relevant sentences
- Extractive: verify sentence scoring produces reasonable rankings
- Formatter: verify XML output for Claude, markdown for GPT, raw for Gemini
- Budget: verify target ratio calculation for different model/cost combinations
- Fallback: verify graceful degradation when LLMLingua sidecar is unavailable
- Performance: compression latency p99 <200ms for 5 chunks at 0.5 ratio

---

## Related Documentation

- [Phase 4 README](./README.md) — Phase overview
- [01-reranker.md](./01-reranker.md) — Reranking (previous pipeline stage)
- [03-semantic-cache.md](./03-semantic-cache.md) — Semantic caching
