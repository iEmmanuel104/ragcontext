# 04 — Quality Scoring

> **Package**: `packages/evaluator` | **Namespace**: `@ci/evaluator`
> **Entry Point**: `packages/evaluator/src/index.ts`

---

## Overview

The evaluator package implements a composite **Context Quality Score** that is returned with every query response. This transforms quality from an opaque internal metric into a first-class product feature — users see exactly how confident the system is in its retrieval, enabling trust, debugging, and optimization.

The package implements:

1. **Composite ContextQualityScore** — 4 sub-scores: retrievalConfidence, contextSufficiency, diversityScore, estimatedFaithfulness
2. **RAGAS-style metrics** — Reference-free, LLM-as-judge decomposition
3. **DeepEval CI/CD integration** — Automated quality regression testing
4. **CRAG adaptive retrieval routing** — Correct/Ambiguous/Incorrect routing with automatic remediation

---

## Interface

```typescript
// packages/evaluator/src/index.ts
import type { RankedChunk, AssembledContext, ContextQualityScore } from "@ci/types";

export interface QualityInput {
  query: string;
  chunks: RankedChunk[];
  context: AssembledContext;
}

export interface IQualityEvaluator {
  /**
   * Score the quality of a retrieval result.
   */
  score(input: QualityInput): Promise<ContextQualityScore>;

  /**
   * Determine if the retrieval is correct, ambiguous, or incorrect.
   * Used by CRAG for adaptive routing.
   */
  classifyRetrieval(input: QualityInput): Promise<CRAGClassification>;
}

export interface CRAGClassification {
  classification: "correct" | "ambiguous" | "incorrect";
  confidence: number;
  action: CRAGAction;
}

export type CRAGAction =
  | { type: "use_retrieved" }
  | { type: "decompose_and_recompose"; subQueries: string[] }
  | { type: "supplemental_search"; searchQuery: string };
```

---

## Composite Quality Scorer

The scorer computes four independent sub-scores and combines them with a weighted average:

```typescript
// packages/evaluator/src/scorer.ts
import type { ContextQualityScore, RankedChunk, AssembledContext } from "@ci/types";
import type { QualityInput } from "./index";
import { logger } from "@ci/logger";

export class CompositeQualityScorer {
  /**
   * Compute the composite ContextQualityScore.
   * All sub-scores are in the range [0, 1].
   */
  async score(input: QualityInput): Promise<ContextQualityScore> {
    const startTime = performance.now();

    const [retrievalConfidence, contextSufficiency, diversityScore, estimatedFaithfulness] =
      await Promise.all([
        this.computeRetrievalConfidence(input.chunks),
        this.computeContextSufficiency(input.query, input.context),
        this.computeDiversityScore(input.chunks),
        this.computeEstimatedFaithfulness(input.query, input.chunks),
      ]);

    // Weighted composite score
    const overall =
      retrievalConfidence * 0.3 +
      contextSufficiency * 0.3 +
      diversityScore * 0.15 +
      estimatedFaithfulness * 0.25;

    // Generate warning if quality is low
    let warning: string | undefined;
    if (overall < 0.3) {
      warning =
        "Very low retrieval confidence. Consider rephrasing your query or adding more documents.";
    } else if (overall < 0.5) {
      warning = "Moderate retrieval confidence. Results may be incomplete.";
    } else if (diversityScore < 0.2) {
      warning = "Low source diversity. Results are heavily concentrated in a single document.";
    }

    const latencyMs = performance.now() - startTime;
    logger.debug(
      {
        latencyMs: Math.round(latencyMs),
        overall: overall.toFixed(3),
      },
      "Quality score computed",
    );

    return {
      overall,
      retrievalConfidence,
      contextSufficiency,
      diversityScore,
      estimatedFaithfulness,
      warning,
    };
  }

  /**
   * Retrieval Confidence: How relevant are the retrieved chunks?
   * Based on vector similarity scores and rerank scores.
   */
  private async computeRetrievalConfidence(chunks: RankedChunk[]): Promise<number> {
    if (chunks.length === 0) return 0;

    const scores = chunks.map((c) => c.rerankScore ?? c.score);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

    // Score distribution: penalize if scores drop off sharply
    const topScore = scores[0] ?? 0;
    const bottomScore = scores[scores.length - 1] ?? 0;
    const scoreSpread = topScore > 0 ? bottomScore / topScore : 0;

    return avgScore * 0.7 + scoreSpread * 0.3;
  }

  /**
   * Context Sufficiency: Does the context contain enough information?
   * Heuristic: ratio of query terms covered by context.
   */
  private async computeContextSufficiency(
    query: string,
    context: AssembledContext,
  ): Promise<number> {
    if (!context.text) return 0;

    const queryTerms = this.extractQueryTerms(query);
    if (queryTerms.length === 0) return 0.5;

    const contextLower = context.text.toLowerCase();
    const coveredTerms = queryTerms.filter((t) => contextLower.includes(t));
    const termCoverage = coveredTerms.length / queryTerms.length;

    // Token density: penalize very short contexts relative to query complexity
    const queryComplexity = queryTerms.length;
    const contextLength = context.tokenCount;
    const densityScore = Math.min(contextLength / (queryComplexity * 50), 1);

    return termCoverage * 0.6 + densityScore * 0.4;
  }

  /**
   * Diversity Score: Are results from diverse sources?
   * Prevents "echo chamber" results from a single document.
   */
  private async computeDiversityScore(chunks: RankedChunk[]): Promise<number> {
    if (chunks.length <= 1) return 0;

    const uniqueDocIds = new Set(chunks.map((c) => c.documentId));
    const documentDiversity = uniqueDocIds.size / chunks.length;

    const uniqueSections = new Set(
      chunks.map((c) => (c.metadata.sectionTitle as string) ?? c.documentId),
    );
    const sectionDiversity = uniqueSections.size / chunks.length;

    return documentDiversity * 0.6 + sectionDiversity * 0.4;
  }

  /**
   * Estimated Faithfulness: Pre-generation prediction of groundability.
   * Higher score = the context is more likely to support a faithful answer.
   */
  private async computeEstimatedFaithfulness(
    query: string,
    chunks: RankedChunk[],
  ): Promise<number> {
    if (chunks.length === 0) return 0;

    const allContent = chunks.map((c) => c.content).join(" ");

    // Count factual indicators (numbers, dates, proper nouns)
    const numberCount = (allContent.match(/\d+/g) || []).length;
    const datePattern = /\d{4}[-/]\d{2}[-/]\d{2}|\w+ \d{1,2},? \d{4}/g;
    const dateCount = (allContent.match(datePattern) || []).length;
    const properNounPattern = /[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g;
    const properNounCount = (allContent.match(properNounPattern) || []).length;

    const wordCount = allContent.split(/\s+/).length;
    const factualDensity = Math.min(
      ((numberCount + dateCount * 2 + properNounCount) / (wordCount / 100)) * 0.1,
      1,
    );

    const topScore = chunks[0]?.score ?? 0;
    const scoreConfidence = Math.min(topScore * 1.5, 1);

    return factualDensity * 0.4 + scoreConfidence * 0.6;
  }

  private extractQueryTerms(query: string): string[] {
    const STOP_WORDS = new Set([
      "the",
      "is",
      "at",
      "which",
      "on",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "with",
      "to",
      "for",
      "of",
      "not",
      "no",
      "can",
      "had",
      "has",
      "have",
      "it",
      "that",
      "this",
      "was",
      "are",
      "be",
      "been",
      "from",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "what",
      "how",
      "when",
      "where",
      "who",
      "why",
    ]);

    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .filter((t) => !STOP_WORDS.has(t));
  }
}
```

---

## RAGAS-Style Metrics

RAGAS (Retrieval Augmented Generation Assessment) provides reference-free metrics using LLM-as-judge decomposition. These are used for **offline benchmarking and CI/CD quality gates**, not for real-time scoring (too slow and expensive for per-request use).

```typescript
// packages/evaluator/src/ragas.ts
import type { QualityInput } from "./index";

export interface RAGASScores {
  contextPrecision: number; // How many retrieved chunks are relevant?
  contextRecall: number; // Are all relevant chunks retrieved?
  faithfulness: number; // Is the answer grounded in context?
  answerRelevancy: number; // Is the answer relevant to the query?
}
```

### Context Precision

For each retrieved chunk, an LLM judge answers: "Is this chunk relevant to answering the query?" The score is the ratio of relevant chunks to total chunks.

### Faithfulness

Extract factual claims from the generated answer, then check each claim against the retrieved context. The score is the ratio of supported claims to total claims.

### Answer Relevancy

An LLM judge rates the answer's relevance to the query on a 0-1 scale.

### Context Recall

Requires ground-truth answers (not available in production). Used only in benchmark datasets where expected answers are provided.

---

## CRAG Adaptive Retrieval Routing

CRAG (Corrective RAG, arXiv:2401.15884) introduces a lightweight retrieval evaluator that assesses document quality before generation and takes corrective action:

```typescript
// packages/evaluator/src/crag.ts
import type { QualityInput, CRAGClassification } from "./index";
import { CompositeQualityScorer } from "./scorer";
import { logger } from "@ci/logger";

export class CRAGRouter {
  private scorer: CompositeQualityScorer;
  private correctThreshold = 0.7;
  private incorrectThreshold = 0.3;

  constructor() {
    this.scorer = new CompositeQualityScorer();
  }

  async classifyRetrieval(input: QualityInput): Promise<CRAGClassification> {
    const score = await this.scorer.score(input);

    if (score.overall >= this.correctThreshold) {
      // CORRECT: Retrieved documents are relevant and sufficient
      logger.debug({ score: score.overall }, "CRAG: Correct retrieval");
      return {
        classification: "correct",
        confidence: score.overall,
        action: { type: "use_retrieved" },
      };
    }

    if (score.overall <= this.incorrectThreshold) {
      // INCORRECT: Retrieved documents are not relevant
      logger.info(
        { score: score.overall },
        "CRAG: Incorrect retrieval, triggering supplemental search",
      );
      return {
        classification: "incorrect",
        confidence: 1 - score.overall,
        action: {
          type: "supplemental_search",
          searchQuery: this.reformulateQuery(input.query),
        },
      };
    }

    // AMBIGUOUS: Partially relevant, needs refinement
    logger.info({ score: score.overall }, "CRAG: Ambiguous retrieval, decomposing query");
    const subQueries = this.decomposeQuery(input.query);
    return {
      classification: "ambiguous",
      confidence: score.overall,
      action: {
        type: "decompose_and_recompose",
        subQueries,
      },
    };
  }

  private decomposeQuery(query: string): string[] {
    // Split compound questions into atomic parts
    const parts = query.split(/\b(and|or|also|additionally)\b/i);
    if (parts.length > 1) {
      return parts.map((p) => p.trim()).filter((p) => p.length > 10);
    }
    // If not decomposable, create variant phrasings
    return [
      query,
      `What information exists about: ${query}`,
      query.replace(/\?$/, "") + " details and specifics",
    ];
  }

  private reformulateQuery(query: string): string {
    return query
      .replace(/^(what|how|when|where|who|why|is|are|can|do|does)\s+/i, "")
      .replace(/\?$/, "")
      .trim();
  }
}
```

### CRAG Flow Diagram

```
Query + Retrieved Chunks
        |
   Quality Score
        |
   +----+----+
   |    |    |
  >0.7  |  <0.3
   |    |    |
CORRECT |  INCORRECT
   |    |    |
  Use   |  Supplemental
  docs  |  search
        |
    AMBIGUOUS
        |
    Decompose into sub-queries
        |
    Retrieve for each
        |
    Recompose results
```

---

## A/B Testing for Retrieval Strategies

The evaluator supports A/B testing by logging which retrieval variant was used for each query and comparing quality distributions:

```typescript
// packages/evaluator/src/ab-testing.ts
import type { ContextQualityScore } from "@ci/types";

export interface ABTestResult {
  variant: "control" | "treatment";
  queryId: string;
  qualityScore: ContextQualityScore;
  latencyMs: number;
  timestamp: number;
}

export function analyzeABTest(results: ABTestResult[]): ABTestAnalysis {
  const control = results.filter((r) => r.variant === "control");
  const treatment = results.filter((r) => r.variant === "treatment");

  const controlAvg = average(control.map((r) => r.qualityScore.overall));
  const treatmentAvg = average(treatment.map((r) => r.qualityScore.overall));

  const controlLatencyAvg = average(control.map((r) => r.latencyMs));
  const treatmentLatencyAvg = average(treatment.map((r) => r.latencyMs));

  return {
    controlSampleSize: control.length,
    treatmentSampleSize: treatment.length,
    controlAvgQuality: controlAvg,
    treatmentAvgQuality: treatmentAvg,
    qualityImprovement: (treatmentAvg - controlAvg) / controlAvg,
    controlAvgLatency: controlLatencyAvg,
    treatmentAvgLatency: treatmentLatencyAvg,
    latencyChange: (treatmentLatencyAvg - controlLatencyAvg) / controlLatencyAvg,
    isSignificant: control.length >= 100 && treatment.length >= 100,
  };
}

interface ABTestAnalysis {
  controlSampleSize: number;
  treatmentSampleSize: number;
  controlAvgQuality: number;
  treatmentAvgQuality: number;
  qualityImprovement: number;
  controlAvgLatency: number;
  treatmentAvgLatency: number;
  latencyChange: number;
  isSignificant: boolean;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
```

---

## DeepEval CI/CD Integration

DeepEval provides automated quality regression testing:

```typescript
// tests/quality/retrieval-quality.test.ts
import { describe, it, expect } from "vitest";
import { CompositeQualityScorer } from "@ci/evaluator";
import benchmarkDataset from "./fixtures/benchmark-100.json";

const scorer = new CompositeQualityScorer();

describe("Retrieval Quality Benchmarks", () => {
  it("maintains average quality score above 0.65", async () => {
    const scores = await Promise.all(
      benchmarkDataset.map((item) =>
        scorer.score({
          query: item.query,
          chunks: item.expectedChunks,
          context: item.expectedContext,
        }),
      ),
    );
    const avgScore = scores.reduce((sum, s) => sum + s.overall, 0) / scores.length;
    expect(avgScore).toBeGreaterThan(0.65);
  });

  it("no query scores below 0.3 (hard floor)", async () => {
    const scores = await Promise.all(
      benchmarkDataset.map((item) =>
        scorer.score({
          query: item.query,
          chunks: item.expectedChunks,
          context: item.expectedContext,
        }),
      ),
    );
    const belowFloor = scores.filter((s) => s.overall < 0.3);
    expect(belowFloor.length).toBe(0);
  });
});
```

---

## Quality Alerts and Degradation Detection

```typescript
// packages/evaluator/src/alerts.ts
export interface QualityAlert {
  type: "degradation" | "anomaly" | "threshold";
  severity: "warning" | "critical";
  message: string;
  metric: string;
  currentValue: number;
  threshold: number;
}

export function checkQualityAlerts(recentScores: number[], baselineAvg: number): QualityAlert[] {
  const alerts: QualityAlert[] = [];
  const currentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

  // Degradation: average dropped >15% from baseline
  if (currentAvg < baselineAvg * 0.85) {
    alerts.push({
      type: "degradation",
      severity: "warning",
      message: `Quality score degraded from baseline`,
      metric: "quality_score_avg",
      currentValue: currentAvg,
      threshold: baselineAvg * 0.85,
    });
  }

  // Critical: average below 0.4
  if (currentAvg < 0.4) {
    alerts.push({
      type: "threshold",
      severity: "critical",
      message: "Average quality score critically low",
      metric: "quality_score_avg",
      currentValue: currentAvg,
      threshold: 0.4,
    });
  }

  return alerts;
}
```

---

## Testing Requirements

- Composite scorer: verify weighted combination produces correct overall score
- Each sub-score: verify range is [0, 1] for all inputs including edge cases
- CRAG router: verify correct classification at boundary thresholds (0.3, 0.7)
- CRAG decomposition: verify compound queries are split into meaningful sub-queries
- Quality alerts: verify degradation detection triggers at correct thresholds
- Benchmark dataset: maintain 100 query-document pairs with human-rated relevance
- CI gate: quality tests must pass before merge to main branch
- Performance: quality scoring p99 <50ms for composite score calculation

---

## Related Documentation

- [Phase 4 README](./README.md) — Phase overview
- [01-reranker.md](./01-reranker.md) — Reranking (feeds quality scores)
- [02-compressor.md](./02-compressor.md) — Compression (context input)
- [03-semantic-cache.md](./03-semantic-cache.md) — Caching
- [Phase 5: Dashboard](../phase-05-production/01-dashboard.md) — Quality dashboard
