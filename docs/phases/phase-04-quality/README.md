# Phase 4: Quality Layer

> **Timeline**: Weeks 10-11 | **Status**: Planned
> **Dependencies**: Phase 3 (API & SDK) must be complete for integration points

---

## Overview

Phase 4 adds the intelligence layer that differentiates ContextInject from basic RAG implementations. While Phase 1-3 delivers a functional retrieval pipeline, Phase 4 transforms it into a **quality-optimized** pipeline that reranks results for precision, compresses context for cost efficiency, caches semantically similar queries for latency reduction, and scores every response with a composite quality metric.

This phase implements four packages — `@ci/reranker`, `@ci/compressor`, `@ci/cache`, and `@ci/evaluator` — each conforming to interfaces defined in `@ci/types` and plugging directly into the `RetrievalPipeline` class from `@ci/core`.

---

## Objectives

1. **Improve retrieval precision by 8-11%** via Cohere Rerank 3.5 with a self-hosted BGE fallback
2. **Reduce token costs by 50-80%** via LLMLingua-2 context compression with question-aware optimization
3. **Achieve 65x latency reduction** on repeated queries via Redis-backed semantic caching with cosine similarity matching
4. **Ship a composite Context Quality Score** that surfaces retrieval confidence, context sufficiency, diversity, and estimated faithfulness as first-class API fields
5. **Enable A/B testing** of retrieval strategies with measurable quality metrics

---

## Deliverables

| Deliverable       | Package          | Key Feature                                                      |
| ----------------- | ---------------- | ---------------------------------------------------------------- |
| Reranker          | `@ci/reranker`   | Cohere Rerank 3.5 + BGE-reranker-v2-m3 fallback                  |
| Compressor        | `@ci/compressor` | LLMLingua-2 + LongLLMLingua question-aware compression           |
| Semantic Cache    | `@ci/cache`      | Redis + cosine similarity, 0.90 threshold, per-project isolation |
| Quality Evaluator | `@ci/evaluator`  | RAGAS-style metrics, CRAG adaptive routing, DeepEval CI/CD       |

---

## Architecture

The quality layer sits in the middle of the retrieval pipeline, after vector search and before context assembly:

```
Query Embedding
      |
      v
  Semantic Cache -----> Cache Hit? -----> Return cached result
      |                                    (65x faster)
      | (cache miss)
      v
  Vector Search (top-100)
      |
      v
  +------------------+
  | RERANKER          |
  | Stage 1: ColBERT  |  top-20 (~10-20ms)
  | Stage 2: Cohere   |  top-5  (~50-100ms)
  +------------------+
      |
      v
  +------------------+
  | COMPRESSOR        |
  | LLMLingua-2      |  50% token reduction
  | Model-aware fmt  |  XML/MD/raw
  +------------------+
      |
      v
  Context Assembly
      |
      v
  +------------------+
  | QUALITY SCORER    |
  | Retrieval conf.  |
  | Sufficiency      |
  | Diversity        |
  | Faithfulness est.|
  +------------------+
      |
      v
  +------------------+
  | CRAG ROUTER       |
  | Correct -> use   |
  | Ambiguous -> refine|
  | Incorrect -> search|
  +------------------+
      |
      v
  Final QueryResult
```

---

## Parallel Execution Strategy

All four packages can be built in parallel since they implement independent interfaces:

```
Week 10:
  +---> @ci/reranker    (IRerankProvider interface)
  +---> @ci/compressor  (ICompressor interface)
  +---> @ci/cache       (ISemanticCache interface)
  +---> @ci/evaluator   (IQualityEvaluator interface)

Week 11:
  Integration into RetrievalPipeline
  Quality dashboard data feeds (-> Phase 5)
  A/B testing framework
  End-to-end quality benchmarks
```

---

## Critical Files

```
packages/
├── reranker/
│   ├── src/
│   │   ├── index.ts              # IRerankProvider interface + factory
│   │   ├── cohere.ts             # Cohere Rerank 3.5 implementation
│   │   ├── bge.ts                # BGE-reranker-v2-m3 self-hosted fallback
│   │   └── multi-stage.ts        # ColBERT -> Cohere multi-stage pipeline
│   ├── package.json
│   └── tsconfig.json
├── compressor/
│   ├── src/
│   │   ├── index.ts              # ICompressor interface + factory
│   │   ├── llmlingua.ts          # LLMLingua-2 implementation
│   │   ├── longllmlingua.ts      # LongLLMLingua question-aware
│   │   ├── extractive.ts         # Sentence importance fallback
│   │   └── formatter.ts          # Model-specific context formatting
│   ├── package.json
│   └── tsconfig.json
├── cache/
│   ├── src/
│   │   ├── index.ts              # ISemanticCache interface
│   │   ├── redis-cache.ts        # Redis-backed semantic cache
│   │   ├── similarity.ts         # Cosine similarity computation
│   │   └── invalidation.ts       # TTL + document version tracking
│   ├── package.json
│   └── tsconfig.json
├── evaluator/
│   ├── src/
│   │   ├── index.ts              # IQualityEvaluator interface
│   │   ├── scorer.ts             # Composite ContextQualityScore
│   │   ├── ragas.ts              # RAGAS-style reference-free metrics
│   │   ├── crag.ts               # CRAG adaptive retrieval router
│   │   └── ab-testing.ts         # A/B testing framework
│   ├── package.json
│   └── tsconfig.json
```

---

## Dependencies on Prior Phases

| Dependency                                       | Source  | Used By                                  |
| ------------------------------------------------ | ------- | ---------------------------------------- |
| `@ci/types` (IRerankProvider, ICompressor, etc.) | Phase 1 | All Phase 4 packages                     |
| `@ci/core` (RetrievalPipeline)                   | Phase 1 | Integration point for all quality layers |
| `@ci/embeddings` (Cohere Embed v4)               | Phase 2 | Cache embedding for similarity matching  |
| `@ci/vector-store` (Qdrant)                      | Phase 2 | Cache storage, ColBERT index             |
| Redis (via `@ci/config`)                         | Phase 2 | Semantic cache backing store             |
| `@ci/db` (query_logs table)                      | Phase 1 | Quality score storage, A/B test results  |
| `apps/api` (routes)                              | Phase 3 | Quality scores in QueryResult response   |

---

## Testing Requirements

### Unit Tests (Vitest)

- Reranker: verify score ordering, batch processing, fallback from Cohere to BGE
- Compressor: verify compression ratio within target, content preservation
- Cache: verify similarity threshold matching, TTL expiry, invalidation on document update
- Evaluator: verify composite score calculation, CRAG routing decisions

### Integration Tests

- Full pipeline with reranker: query -> vector search -> rerank -> verify improved ordering
- Compression roundtrip: original -> compressed -> verify token reduction + content fidelity
- Cache hit/miss: query -> cache miss -> store -> same query -> cache hit
- Quality scoring: query -> score -> verify all 4 sub-scores are populated

### Quality Benchmarks

- Maintain a benchmark dataset of 100 query-document pairs with human-rated relevance
- Run reranker A/B tests: with vs. without, measure nDCG@5 improvement
- Measure compression: compare LLM answer quality at 2x, 5x, 10x compression ratios
- Cache accuracy: measure false positive rate at 0.85, 0.90, 0.95 similarity thresholds

### Performance Tests

- Reranker latency: p99 <150ms for top-5 from top-100 candidates
- Compressor latency: p99 <200ms for 5 chunks at 0.5 compression ratio
- Cache lookup latency: p99 <10ms for cosine similarity check
- Quality scoring: p99 <50ms for composite score calculation

---

## Risk Assessment

| Risk                                     | Likelihood | Impact | Mitigation                                                      |
| ---------------------------------------- | ---------- | ------ | --------------------------------------------------------------- |
| Cohere Rerank 3.5 API latency spikes     | Medium     | High   | BGE-reranker-v2-m3 self-hosted fallback with automatic failover |
| LLMLingua-2 Python dependency in Node.js | High       | Medium | Run as a sidecar microservice with gRPC, or use ONNX runtime    |
| Semantic cache false positives           | Medium     | High   | Conservative 0.90 threshold, per-project isolation, monitoring  |
| Quality score calibration drift          | Medium     | Medium | Weekly benchmark runs, alerting on score distribution changes   |
| CRAG routing causing latency increase    | Low        | Medium | Latency budget enforcement, skip CRAG under time pressure       |

---

## Success Criteria

1. Reranker improves nDCG@5 by at least 8% on the benchmark dataset
2. Compressor achieves 50% token reduction with <2% quality loss on benchmark answers
3. Semantic cache achieves >25% hit rate on production-like query distributions
4. Quality scorer produces scores correlated (Pearson r >0.7) with human relevance judgments
5. All quality layers combined add <200ms to p99 pipeline latency
6. CRAG routing correctly identifies "incorrect" retrievals >80% of the time on adversarial queries

---

## Related Documentation

- [01-reranker.md](./01-reranker.md) — Reranking system details
- [02-compressor.md](./02-compressor.md) — Context compression
- [03-semantic-cache.md](./03-semantic-cache.md) — Semantic caching layer
- [04-quality-scoring.md](./04-quality-scoring.md) — Quality evaluation and CRAG
- [Phase 3: API & SDK](../phase-03-api-sdk/README.md) — Previous phase
- [Phase 5: Production](../phase-05-production/README.md) — Next phase
