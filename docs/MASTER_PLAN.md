# ContextInject: Master Plan

> **The Stripe for RAG** — Intelligent context middleware between any data source and any AI model.

---

## Vision Statement

ContextInject is open-source middleware that provides a complete, developer-first RAG pipeline as a single API. One SDK install, one API key, one line of code to go from raw documents to production-grade context injection. We occupy the structural "missing middle" between $100K+ enterprise platforms (Contextual AI, Vectara, Glean) and low-level components requiring extensive assembly (Pinecone, LangChain, Unstructured.io).

**Target experience:** Time to first RAG query under 3 minutes.

```typescript
import { ContextInject } from "contextinject";
const ci = new ContextInject({ apiKey: "ci_live_..." });
await ci.uploadText(projectId, "Your knowledge base content...");
const result = await ci.query(projectId, "What is our refund policy?");
// result.context.text — ready to inject into any LLM
// result.quality.overall — 0.87 confidence score
```

---

## Problem Statement

The RAG infrastructure market is fragmented into four inadequate categories:

| Category             | Examples                      | Limitation                                                        |
| -------------------- | ----------------------------- | ----------------------------------------------------------------- |
| Component-layer      | Pinecone, Qdrant, Weaviate    | Vector storage only; no parsing, chunking, reranking, or assembly |
| Enterprise monoliths | Contextual AI, Vectara, Glean | $100K+/year minimum; no self-serve                                |
| Cloud-locked         | AWS Bedrock, Azure AI Search  | Ecosystem prison; hidden costs ($350/mo floor on OpenSearch)      |
| Frameworks           | LangChain, LlamaIndex         | Orchestration code only; bring every component yourself           |

**No single player owns the developer-accessible, full-pipeline RAG middleware position.** ContextInject fills this gap.

---

## Market Opportunity

- **TAM:** $1.94B (2025) growing to $9.86B by 2030 at **38.4% CAGR** (MarketsandMarkets)
- **GitHub ecosystem signals:** 150K+ stars across LangChain (50K), LlamaIndex (36K), Milvus (35K)
- **Enterprise adoption:** 71% of organizations use GenAI regularly, but only 17% attribute >5% EBIT to it — massive gap between pilot and production
- **Funding climate:** Q1 2025 was the strongest quarter for AI funding ever ($59.6B globally)
- **Closest competitor:** Ragie ($5.5M seed, 8 employees) validates demand but lacks resources for comprehensive platform

---

## 6-Phase Timeline

### Dependency Graph

```
Phase 1: Foundation (Weeks 1-3)
    ├── Project Setup ──────────┐
    ├── Type System ────────────┤
    ├── Database Layer ─────────┤── All feed into Phase 2
    ├── Auth System ────────────┤
    └── Error Handling ─────────┘
            │
            ▼
Phase 2: Core Pipeline (Weeks 4-6)
    ├── Vector Store ───────────┐
    ├── Embeddings ─────────────┤
    ├── Chunking & Parsing ─────┤── All feed into Ingestion/Retrieval
    ├── Ingestion Pipeline ─────┤
    └── Retrieval Pipeline ─────┘
            │
            ▼
Phase 3: API & SDK (Weeks 7-9)
    ├── Express 5 API ──────────┐
    ├── TypeScript SDK ─────────┤
    ├── MCP Server ─────────────┤── Developer-facing layer
    └── Connectors (Notion, GDrive) ┘
            │
            ▼
Phase 4: Quality & Intelligence (Weeks 10-11)
    ├── Reranker (Cohere 3.5) ──┐
    ├── Compressor (LLMLingua-2)┤
    ├── Evaluator (RAGAS) ──────┤── Quality scoring + optimization
    └── Semantic Cache ─────────┘
            │
            ▼
Phase 5: Production Hardening (Weeks 12-14)
    ├── Dashboard (Next.js 16) ─┐
    ├── Billing (Stripe) ───────┤
    ├── Security Audit ─────────┤── Enterprise readiness
    ├── Load Testing (k6) ──────┤
    └── Monitoring (OpenTelemetry) ┘
            │
            ▼
Phase 6: Launch (Weeks 15-16)
    ├── Alpha (20 users) ───────┐
    ├── Documentation ──────────┤
    ├── Show HN ────────────────┤── GTM execution
    └── Product Hunt ───────────┘
```

### Phase Summary Table

| Phase             | Weeks | Objective                                   | Key Deliverables                                                                 | Exit Criteria                                                                       |
| ----------------- | ----- | ------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1 — Foundation    | 1-3   | Monorepo, types, DB, auth, error handling   | 8 packages scaffolded, Docker Compose running, DB migrations applied             | `pnpm build` passes; DB + Redis + Qdrant healthy; auth middleware validates keys    |
| 2 — Core Pipeline | 4-6   | End-to-end ingestion and retrieval          | Vector store, embeddings, chunker, parser, ingestion + retrieval pipelines       | Upload PDF, chunk, embed, store, query — all working end-to-end in integration test |
| 3 — API & SDK     | 7-9   | Developer-facing HTTP API + SDK + MCP       | Express 5 API (7 routes), TypeScript SDK, MCP server, Notion + GDrive connectors | SDK query returns results; MCP server responds to Claude; API docs generated        |
| 4 — Quality       | 10-11 | Reranking, compression, evaluation, caching | Cohere Rerank, LLMLingua-2, RAGAS evaluator, Redis semantic cache                | Quality score >0.7 on test corpus; cache hit rate >20%; compression ratio 2-3x      |
| 5 — Production    | 12-14 | Dashboard, billing, security, monitoring    | Next.js 16 dashboard, Stripe billing, k6 load tests, OpenTelemetry traces        | p99 retrieval <200ms; no critical security findings; billing metering accurate      |
| 6 — Launch        | 15-16 | Alpha users, public launch                  | 20 alpha users onboarded, Show HN post, Product Hunt launch                      | 20+ users active; >50 GitHub stars; <5min onboarding time                           |

---

## Success Metrics Per Phase

### Phase 1 — Foundation

- All packages compile with zero TypeScript errors
- Docker Compose starts all services in <30s
- Database migrations run idempotently
- API key authentication validates in <5ms (cached)
- Unit test coverage >80% on auth and error packages

### Phase 2 — Core Pipeline

- Ingestion pipeline processes 100 documents without failure
- Embedding generation: <100ms per document (batched)
- Vector search returns results in <50ms (p95)
- Hybrid search (dense + sparse RRF) outperforms dense-only by >5% on test queries
- Chunking produces consistent results across document types

### Phase 3 — API & SDK

- SDK installs and first query completes in <3 minutes
- API handles 100 concurrent requests without errors
- MCP server passes Claude integration test
- OpenAPI spec auto-generated and accurate
- Notion connector syncs 1000 pages without failure

### Phase 4 — Quality

- Reranking improves retrieval accuracy by >8% (measured on test corpus)
- Compression achieves 2-3x ratio with <5% quality degradation
- Context Quality Score correlates with human judgments (r > 0.7)
- Semantic cache hit rate >20% on repeated query patterns

### Phase 5 — Production

- p99 retrieval latency <200ms
- Load test: sustain 100 QPS for 10 minutes without degradation
- Zero critical/high security findings in audit
- Billing metering accurate to within 0.1%
- Dashboard renders all pages in <2s (LCP)

### Phase 6 — Launch

- 20+ alpha users provide feedback
- Time to first RAG query <5 minutes for new users
- > 50 GitHub stars in first week
- <0.1% error rate in production

---

## Risk Register

| Risk                                         | Impact   | Probability | Mitigation                                                                                                 |
| -------------------------------------------- | -------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| Cohere API rate limits throttle ingestion    | High     | Medium      | Implement exponential backoff; batch embedding (96/request); queue-based throttling; OpenAI fallback chain |
| Qdrant performance degrades at scale         | High     | Low         | pgvector 0.8+ as fallback; benchmark at 1M, 10M, 50M vectors early; HNSW tuning guide                      |
| Docling parsing accuracy on edge cases       | Medium   | Medium      | Fallback to raw text extraction; user-configurable parser selection; test against 500 diverse documents    |
| Multi-tenant data leakage                    | Critical | Low         | RLS policies tested per migration; integration tests verify isolation; security audit in Phase 5           |
| Developer adoption slower than projected     | High     | Medium      | Focus on documentation quality; "time to first query" <3 min; free tier generous enough for full POC       |
| Competitor ships similar product             | Medium   | Medium      | Moat via quality scoring (proprietary), speed of execution, open-source community                          |
| Key dependency deprecated or breaking change | Medium   | Low         | Pin versions strictly; monitor changelogs; abstraction layers for all external services                    |
| Cost overrun on embedding/vector APIs        | Medium   | Medium      | Matryoshka dims (256 for cache, 1024 for index); BGE-M3 self-hosted fallback; cost monitoring alerts       |

---

## Infrastructure Cost Estimates

### Launch Scale (~1K documents, ~10K queries/month)

| Service                                 | Monthly Cost       |
| --------------------------------------- | ------------------ |
| Qdrant Cloud (1GB free, then $25/mo)    | $0 - $25           |
| PostgreSQL 17 (Railway/Supabase)        | $25 - $50          |
| Redis 7.2 (Upstash/Railway)             | $10 - $25          |
| Cohere Embed v4 ($0.12/M tokens)        | $5 - $20           |
| Cohere Rerank 3.5 ($2/1K searches)      | $20 - $50          |
| Compute (Railway/Fly.io — API + Worker) | $50 - $150         |
| Docling (self-hosted, compute cost)     | $25 - $75          |
| Monitoring (Langfuse cloud free tier)   | $0                 |
| Domain + DNS + CDN                      | $10 - $20          |
| **Total**                               | **$145 - $415/mo** |

### Growth Scale (~100K documents, ~1M queries/month)

| Service                        | Monthly Cost           |
| ------------------------------ | ---------------------- |
| Qdrant Cloud (dedicated)       | $200 - $500            |
| PostgreSQL 17 (managed, 100GB) | $100 - $300            |
| Redis 7.2 (managed, 4GB)       | $50 - $100             |
| Cohere APIs                    | $300 - $800            |
| Compute (3-5 instances)        | $500 - $1,500          |
| Docling (GPU instance)         | $200 - $500            |
| Monitoring (Langfuse Pro)      | $50 - $100             |
| CDN + WAF                      | $50 - $100             |
| **Total**                      | **$1,450 - $3,900/mo** |

### Enterprise Scale (~1M+ documents, ~10M queries/month)

| Service                                 | Monthly Cost           |
| --------------------------------------- | ---------------------- |
| Infrastructure (self-hosted K8s)        | $3,000 - $7,200        |
| Embedding (self-hosted BGE-M3 + Cohere) | $500 - $1,500          |
| Additional services                     | $500 - $1,000          |
| **Total**                               | **$4,000 - $9,700/mo** |

---

## Licensing Model

| Component                                                      | License     | Rationale                                                    |
| -------------------------------------------------------------- | ----------- | ------------------------------------------------------------ |
| SDKs (`@ci/sdk`)                                               | MIT         | Maximum adoption; developers expect MIT for client libraries |
| Connectors (`@ci/connectors/*`)                                | MIT         | Community contributions; ecosystem growth                    |
| CLI tools                                                      | MIT         | Developer tooling should be friction-free                    |
| Core packages (`@ci/core`, `@ci/db`, `@ci/vector-store`, etc.) | Apache 2.0  | Patent protection; standard for infrastructure OSS           |
| Quality scoring (`@ci/evaluator`)                              | Proprietary | Competitive moat; revenue driver                             |
| Multi-tenant infrastructure                                    | Proprietary | Enterprise value; managed cloud revenue                      |
| Dashboard (`apps/dashboard`)                                   | Proprietary | Commercial product                                           |

---

## Pricing Tiers

| Tier       | Price   | Documents           | Retrievals/mo        | Projects  | Users     | Key Features                           |
| ---------- | ------- | ------------------- | -------------------- | --------- | --------- | -------------------------------------- |
| Free       | $0      | 1K docs / 10K pages | 5,000                | 1         | 1         | Basic RAG pipeline, community support  |
| Starter    | $99/mo  | 25K pages           | 50,000               | 3         | 3         | Email support, reranking               |
| Pro        | $499/mo | 100K pages          | Unlimited (fair use) | Unlimited | 10        | Analytics, compression, hybrid search  |
| Enterprise | $2K+/mo | Unlimited           | Unlimited            | Unlimited | Unlimited | SSO, RBAC, audit logs, dedicated infra |

---

## Revenue Projections

| Year   | ARR Target    | Customers        | Key Milestones                                     |
| ------ | ------------- | ---------------- | -------------------------------------------------- |
| Year 1 | $500K - $1.5M | 50-100 paying    | 5,000+ free tier users; 2-5% conversion            |
| Year 2 | $3M - $8M     | 200-500 paying   | 5-10 enterprise contracts ($50-200K/yr); 130%+ NRR |
| Year 3 | $10M - $25M   | 500-1,500 paying | 20-50 enterprise contracts; Series B readiness     |

---

## Phase Documentation References

| Phase                   | Overview                                            | Sub-documents                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 1 — Foundation    | [README](./phases/phase-01-foundation/README.md)    | [Project Setup](./phases/phase-01-foundation/01-project-setup.md), [Type System](./phases/phase-01-foundation/02-type-system.md), [Database](./phases/phase-01-foundation/03-database-layer.md), [Auth](./phases/phase-01-foundation/04-auth-system.md), [Error Handling](./phases/phase-01-foundation/05-error-handling.md)                                       |
| Phase 2 — Core Pipeline | [README](./phases/phase-02-core-pipeline/README.md) | [Vector Store](./phases/phase-02-core-pipeline/01-vector-store.md), [Embeddings](./phases/phase-02-core-pipeline/02-embeddings.md), [Chunking & Parsing](./phases/phase-02-core-pipeline/03-chunking-and-parsing.md), [Ingestion](./phases/phase-02-core-pipeline/04-ingestion-pipeline.md), [Retrieval](./phases/phase-02-core-pipeline/05-retrieval-pipeline.md) |

### Additional Documentation

- [Tech Stack](./TECH_STACK.md) — Every technology choice with justification
- [Architecture](./ARCHITECTURE.md) — System design, data flows, multi-tenancy

---

## Appendix: Comparable Company Valuations

| Company  | Raised | Valuation | Position                              |
| -------- | ------ | --------- | ------------------------------------- |
| Pinecone | $138M  | $750M     | Vector DB (component)                 |
| Weaviate | $67.7M | $200M     | Vector DB (component)                 |
| Qdrant   | $28M   | $50M+     | Vector DB (component)                 |
| Mem0     | $24M   | N/A       | AI memory (niche)                     |
| Ragie    | $5.5M  | N/A       | RAG-as-a-service (closest competitor) |
| Cognee   | EUR 9M | N/A       | Knowledge graph memory                |

AI infrastructure companies trade at ~23x revenue for fundraising. Median seed is ~$10M valuation with $0.5-3M rounds.

---

_Last updated: 2026-02-23_
_Next review: Phase 1 completion (Week 3)_
