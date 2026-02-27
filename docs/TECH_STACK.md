# ContextInject: Tech Stack Decisions

> Every technology choice with justification, version pinning, and comparison analysis.

---

## Runtime & Language

### Node.js 22 LTS

**Version:** `>=22.x LTS`
**Justification:** Node 22 LTS (active LTS since October 2024) provides native ESM stability, `--experimental-strip-types` for TypeScript execution, improved `fetch` API, and the latest V8 engine with better performance for async workloads. The RAG pipeline is I/O-bound (API calls to Cohere, Qdrant, PostgreSQL), making Node.js's event loop ideal.

**Why not alternatives:**

- Bun: Promising but ecosystem compatibility gaps remain for production dependencies like BullMQ
- Deno: Smaller ecosystem; npm compatibility layer adds friction
- Go/Rust: Higher barrier for SDK contributors; TypeScript SDKs are what developers expect

### TypeScript 5.7+

**Version:** `>=5.7.0`
**Justification:** TypeScript 5.7 introduces improved inference for indexed access types, better control flow narrowing, and stabilized decorators. The type system ensures correctness across the entire monorepo — from shared `@ci/types` through to the public SDK.

**Upgrade from original plan:** TS 5.4 -> 5.7+ for improved `satisfies` operator behavior and better generic inference that reduces type assertions in pipeline code.

---

## Database

### PostgreSQL 17 with pgvector 0.8+

**Version:** PostgreSQL `>=17.0`, pgvector `>=0.8.0`
**Justification:** PostgreSQL 17 introduces incremental backup, improved VACUUM performance, and better JSON handling. pgvector 0.8+ delivers **9x faster HNSW queries** over 0.7, making it a viable fallback vector store for datasets under 50M vectors.

**Upgrade rationale:**

- PG 16 -> PG 17: Incremental backup for zero-downtime disaster recovery; improved partition pruning for multi-tenant RLS queries
- pgvector 0.7 -> 0.8+: 9x HNSW performance; improved IVFFlat build times; critical for pgvector-as-fallback architecture

**Why PostgreSQL over alternatives:**
| Feature | PostgreSQL | MySQL | CockroachDB | MongoDB |
|---|---|---|---|---|
| pgvector support | Native | None | None | Atlas Vector (limited) |
| RLS (multi-tenancy) | Native | None | Limited | None |
| JSONB | Excellent | JSON (no index) | Yes | Native |
| Drizzle ORM support | Full | Full | Partial | None |
| Ecosystem maturity | Highest | High | Medium | High |

### Drizzle ORM

**Version:** `>=0.36.0`
**Justification:** Drizzle provides type-safe SQL with zero runtime overhead. The schema-as-code approach means migrations are generated from TypeScript definitions, ensuring the database schema and application types never drift.

**Why Drizzle over alternatives:**

| Feature              | Drizzle                | Prisma              | TypeORM       | Knex       |
| -------------------- | ---------------------- | ------------------- | ------------- | ---------- |
| Type safety          | Full (schema = types)  | Generated client    | Decorators    | Manual     |
| Runtime overhead     | Zero (SQL passthrough) | Query engine (~2MB) | Heavy         | Minimal    |
| Migration approach   | Schema diff            | Schema diff         | Code-first    | Manual SQL |
| Raw SQL escape hatch | First-class            | `$queryRaw`         | QueryBuilder  | Native     |
| Bundle size          | ~50KB                  | ~2MB+               | ~500KB        | ~100KB     |
| pgvector support     | Via custom types       | Plugin              | None          | Manual     |
| Performance          | Direct SQL             | Rust engine proxy   | Query builder | Direct SQL |

Prisma's query engine adds latency and memory overhead that matters at scale. Drizzle generates SQL directly — zero abstraction cost.

---

## Vector Database

### Qdrant (Primary)

**Version:** Latest stable (>=1.12)
**Justification:** Qdrant's Rust-based engine delivers consistent sub-50ms search latency. Its Universal Query API supports multi-stage retrieval (byte-quantized fast scan then full vector refinement then ColBERT rescoring) in a single request. Native sparse vector support enables hybrid search without a separate BM25 index.

**Why Qdrant over alternatives:**

| Feature                | Qdrant       | Pinecone       | Weaviate     | Milvus       |
| ---------------------- | ------------ | -------------- | ------------ | ------------ |
| Self-hosted option     | Yes (OSS)    | No             | Yes (OSS)    | Yes (OSS)    |
| Native sparse vectors  | Yes          | No (2024 beta) | No           | Yes          |
| Pre-filtering perf     | Excellent    | Good           | Good         | Good         |
| Multi-vector (ColBERT) | Yes          | No             | No           | Partial      |
| Namespace isolation    | Native       | Native         | Class-based  | Partition    |
| Pricing (managed)      | $25/mo start | $70/mo start   | $25/mo start | $65/mo start |
| gRPC support           | Yes          | Yes            | Yes          | Yes          |
| Incremental snapshots  | Yes          | N/A            | Yes          | Yes          |
| Matryoshka dims        | Yes          | Yes            | No           | No           |
| License                | Apache 2.0   | Proprietary    | BSD-3        | Apache 2.0   |

### pgvector 0.8+ (Fallback)

Serves as the fallback vector store for tenants who want a single-database architecture or datasets under 50M vectors. The 9x HNSW improvement in 0.8+ makes this viable for production use at moderate scale.

---

## Embedding Models

### Cohere Embed v4 (Primary)

**Version:** `embed-v4.0` (API)
**Justification:** Cohere Embed v4 introduces multimodal support (text + images), Matryoshka dimensionality (256-1536 dims), and improved handling of noisy enterprise data. At $0.12/M tokens, it offers the best quality-to-cost ratio for production RAG.

**Upgrade rationale:** Cohere v3 -> v4: Multimodal capability (index images alongside text), Matryoshka dimensions (use 256-dim for cache lookups, 1024-dim for primary index), improved MTEB benchmarks.

**Key specs:**

- Dimensions: 256, 512, 768, 1024, 1536 (Matryoshka)
- Default dimension: 1024 (balanced quality/cost)
- Max batch size: 96 texts per request
- Input types: `search_document` (indexing), `search_query` (retrieval)
- Multimodal: Text + image in same embedding space

### OpenAI text-embedding-3-large (Fallback)

**Version:** `text-embedding-3-large`
**Cost:** $0.13/M tokens
**Dimensions:** 256-3072 (Matryoshka)
**Use case:** Fallback when Cohere is unavailable; cross-validation of embedding quality

### BGE-M3 (Self-hosted option)

**Version:** `BAAI/bge-m3`
**License:** MIT
**Languages:** 100+
**Use case:** Privacy-sensitive deployments; self-hosted production; generates dense, sparse, and ColBERT representations in a single model

---

## Document Processing

### Docling (Primary Parser)

**Version:** Latest stable
**License:** MIT (LF AI Foundation)
**Justification:** Docling achieves 97.9% table accuracy, supports PDF, DOCX, HTML, PPTX, and images, and is fully open-source under the LF AI Foundation. It replaces LlamaParse which is being deprecated (May 2026) and had proprietary licensing concerns.

**Why Docling over alternatives:**

| Feature                | Docling             | LlamaParse          | Unstructured.io | Apache Tika |
| ---------------------- | ------------------- | ------------------- | --------------- | ----------- |
| License                | MIT                 | Proprietary         | Apache 2.0      | Apache 2.0  |
| Table accuracy         | 97.9%               | ~95%                | ~90%            | ~70%        |
| PDF support            | Excellent           | Excellent           | Good            | Basic       |
| Image/chart extraction | Yes                 | Yes (agentic OCR)   | Partial         | No          |
| Self-hosted            | Yes                 | No (API only)       | Yes             | Yes         |
| Active maintenance     | LF AI Foundation    | Deprecated May 2026 | Active          | Minimal     |
| Cost                   | Free (compute only) | $0.003/page         | $0.03/page      | Free        |
| DOCX/PPTX support      | Yes                 | Yes                 | Yes             | Yes         |

---

## Web Framework

### Express 5.x

**Version:** `>=5.0.0`
**Justification:** Express 5 introduces native async error handling (no more `express-async-errors` wrapper), improved path matching, and dropped legacy APIs. The massive middleware ecosystem (helmet, cors, compression, rate-limit) is production-proven at enormous scale.

**Upgrade rationale:** Express 4 -> 5: Native `async` route handler support eliminates the most common source of unhandled promise rejections in Express apps.

**Why Express 5 over alternatives:**

| Feature                 | Express 5     | Fastify          | Hono      | Koa      |
| ----------------------- | ------------- | ---------------- | --------- | -------- |
| Ecosystem (middleware)  | Largest       | Growing          | Small     | Medium   |
| Async error handling    | Native (v5)   | Native           | Native    | Native   |
| Performance (req/s)     | ~15K          | ~30K             | ~40K      | ~18K     |
| TypeScript support      | Good          | Excellent        | Excellent | Good     |
| Learning curve          | Lowest        | Low              | Low       | Low      |
| Production track record | 15+ years     | 8 years          | 3 years   | 10 years |
| OpenAPI generation      | swagger-jsdoc | @fastify/swagger | Built-in  | Manual   |

Express's lower raw throughput is irrelevant — our bottleneck is Cohere/Qdrant API latency (~50-100ms), not HTTP framework overhead (~0.1ms). The ecosystem advantage and team familiarity outweigh Fastify's performance edge.

---

## Frontend

### Next.js 16

**Version:** `>=16.0.0`
**Justification:** Next.js 16 ships with Turbopack stable (5-10x faster builds than webpack), improved Server Components, and enhanced caching. The dashboard is an internal tool — Next.js's full-stack capabilities (API routes for BFF, SSR for initial load) reduce architecture complexity.

**Upgrade rationale:** Next.js 14 -> 16: Turbopack stable (no more `--turbo` flag), improved streaming SSR, better error boundaries.

---

## Queue & Background Jobs

### BullMQ

**Version:** `>=5.0.0`
**Justification:** BullMQ provides Redis-backed job queues with built-in retry, rate limiting, concurrency control, job prioritization, and a web dashboard. It is the standard for Node.js background processing.

**Key configuration:**

- Concurrency: 5 workers per instance (respect Cohere rate limits)
- Rate limit: 100 jobs/minute (Cohere API ceiling)
- Retry: 3 attempts with exponential backoff (1s, 4s, 16s)
- Stalled job threshold: 30 seconds

### Redis 7.2+

**Version:** `>=7.2.0`
**Justification:** Redis 7.2 introduces triggers and functions, improved ACLs, and enhanced memory efficiency. Used for three purposes: BullMQ job queue backing store, semantic cache (embedding similarity), and short-term conversation memory (session TTL).

---

## Testing

### Vitest

**Version:** `>=2.0.0`
**Justification:** Vitest provides native ESM support, TypeScript-first experience, and Vite-powered parallel execution. Compatible with Jest APIs for easy migration. Workspace support enables per-package test configuration in the monorepo.

**Configuration file:** `vitest.workspace.ts` at monorepo root.

---

## Schema Validation

### Zod

**Version:** `>=3.23.0`
**Justification:** Zod provides runtime validation with TypeScript type inference. Used in three critical places: API request validation (Express middleware), environment variable validation (`@ci/config`), and SDK input validation.

---

## Logging

### Pino

**Version:** `>=9.0.0`
**Justification:** Pino is the fastest Node.js structured logger (~5x faster than Winston). JSON output integrates directly with log aggregation services. Transport plugins enable PII redaction before log persistence.

---

## Monorepo Tooling

### pnpm 9+

**Version:** `>=9.0.0`
**Justification:** pnpm's content-addressable storage deduplicates dependencies across 20+ packages, saving ~60% disk space vs npm. Workspace protocol (`workspace:*`) ensures internal packages always use the latest local version.

### Turborepo

**Version:** `>=2.0.0`
**Justification:** Turborepo provides incremental builds with remote caching. The task dependency graph (`turbo.json`) ensures packages build in correct order. Remote cache on Vercel accelerates CI from ~8 minutes to ~2 minutes on cache hits.

---

## Version Pinning Strategy

All dependencies use **caret ranges** (`^`) in `package.json` with **exact versions** locked in `pnpm-lock.yaml`. Critical infrastructure dependencies have additional constraints:

```json
{
  "dependencies": {
    "drizzle-orm": "^0.36.0",
    "@qdrant/js-client-rest": "^1.12.0",
    "cohere-ai": "^7.15.0",
    "bullmq": "^5.0.0",
    "express": "^5.0.0",
    "zod": "^3.23.0",
    "pino": "^9.0.0"
  }
}
```

**Renovate** (or Dependabot) is configured for automated dependency PRs with the following policy:

- Security patches: auto-merge after CI passes
- Minor versions: PR created, manual review
- Major versions: PR created, requires two approvals

---

## Upgrade Rationale from Original Plan

| Technology      | Original   | Updated     | Reason                                                                              |
| --------------- | ---------- | ----------- | ----------------------------------------------------------------------------------- |
| Node.js         | 20 LTS     | **22 LTS**  | Native TS strip-types; improved fetch; V8 performance                               |
| TypeScript      | 5.4        | **5.7+**    | Better inference; satisfies improvements; decorator stability                       |
| PostgreSQL      | 16         | **17**      | Incremental backup; VACUUM improvements; JSON enhancements                          |
| pgvector        | 0.7        | **0.8+**    | 9x faster HNSW queries; critical for fallback viability                             |
| Express         | 4.x        | **5.x**     | Native async error handling; dropped legacy APIs                                    |
| Next.js         | 14         | **16**      | Turbopack stable; improved Server Components                                        |
| Cohere Embed    | v3         | **v4**      | Multimodal; Matryoshka dims; improved enterprise data handling                      |
| Document Parser | LlamaParse | **Docling** | MIT license; LF AI Foundation; LlamaParse deprecated May 2026; 97.9% table accuracy |

---

## Package Ecosystem Map

```
@ci/types ──────────── No external deps (pure TypeScript interfaces)
    │
    ├── @ci/config ──── zod
    ├── @ci/errors ──── (no external deps)
    ├── @ci/logger ──── pino, pino-pretty (dev)
    ├── @ci/crypto ──── (Node.js crypto module only)
    │
    ├── @ci/db ──────── drizzle-orm, postgres (pg driver), drizzle-kit (dev)
    │   └── @ci/config
    │
    ├── @ci/auth ────── @ci/db, @ci/crypto, @ci/errors, jsonwebtoken, argon2
    │
    ├── @ci/vector-store ── @qdrant/js-client-rest, @ci/types
    ├── @ci/embeddings ──── cohere-ai, openai, @ci/types, @ci/errors
    ├── @ci/chunker ──────── gpt-tokenizer, @ci/types
    ├── @ci/parser ───────── docling (Python bridge or WASM), @ci/types
    ├── @ci/reranker ─────── cohere-ai, @ci/types, @ci/errors
    ├── @ci/compressor ───── @ci/types (LLMLingua-2 via API or Python bridge)
    ├── @ci/evaluator ────── @ci/types (RAGAS-style scoring)
    ├── @ci/cache ─────────── ioredis, @ci/types, @ci/embeddings
    ├── @ci/queue ─────────── bullmq, @ci/types
    │
    ├── @ci/core ──────────── @ci/vector-store, @ci/embeddings, @ci/chunker,
    │                          @ci/parser, @ci/reranker, @ci/compressor,
    │                          @ci/evaluator, @ci/cache, @ci/db, @ci/queue
    │
    ├── @ci/connectors ────── @notionhq/client, googleapis, @slack/web-api,
    │                          @ci/crypto, @ci/types
    │
    └── @ci/sdk ───────────── (zero deps — uses native fetch)

apps/api ────────── express, helmet, cors, compression, express-rate-limit,
                    multer, swagger-jsdoc, @ci/core, @ci/auth, @ci/db,
                    @ci/logger, @ci/config, @ci/errors

apps/worker ─────── bullmq, @ci/core, @ci/queue, @ci/logger, @ci/config

apps/dashboard ──── next, react, @ci/sdk, tailwindcss, shadcn/ui

apps/mcp-server ─── @modelcontextprotocol/sdk, @ci/sdk, zod
```

---

## Performance Benchmarks and Targets

| Operation                                 | Target (p50) | Target (p99) | Notes                         |
| ----------------------------------------- | ------------ | ------------ | ----------------------------- |
| API key validation (cached)               | <1ms         | <5ms         | In-memory LRU cache           |
| Query embedding (Cohere v4)               | 15ms         | 50ms         | Single text, 1024 dims        |
| Vector search (Qdrant, 1M vectors)        | 10ms         | 30ms         | HNSW, pre-filtered            |
| Vector search (pgvector 0.8+, 1M vectors) | 20ms         | 60ms         | HNSW, RLS filtered            |
| Reranking (Cohere 3.5, top-10)            | 50ms         | 100ms        | Cross-encoder scoring         |
| Full retrieval pipeline                   | 80ms         | 200ms        | Cache miss, all stages        |
| Semantic cache lookup                     | 2ms          | 10ms         | Redis + cosine similarity     |
| Document ingestion (per page)             | 500ms        | 2s           | Parse + chunk + embed + store |
| SDK cold start                            | <50ms        | <100ms       | Import + initialize           |

---

_Last updated: 2026-02-23_
_Related: [Architecture](./ARCHITECTURE.md) | [Master Plan](./MASTER_PLAN.md)_
