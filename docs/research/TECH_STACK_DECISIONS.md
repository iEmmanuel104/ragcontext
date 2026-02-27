# Technology Stack Decisions

> Detailed technology comparisons with benchmarks, pricing, and rationale for every major ContextInject component.

---

## 1. Vector Database: Qdrant (Primary) + pgvector (Fallback)

### Comparison Matrix

| Feature             | Qdrant                      | Pinecone                  | Weaviate             | Milvus/Zilliz | pgvector                  |
| ------------------- | --------------------------- | ------------------------- | -------------------- | ------------- | ------------------------- |
| **License**         | Apache 2.0                  | Proprietary               | BSD-3                | Apache 2.0    | PostgreSQL                |
| **Language**        | Rust                        | Unknown (managed)         | Go                   | Go + C++      | C                         |
| **Hybrid search**   | Native (dense + sparse)     | Sparse + dense (separate) | BM25 + vector        | Native        | BM25 via pg_trgm + vector |
| **Pre-filtering**   | Native, minimal perf impact | Metadata filtering        | Native               | Native        | SQL WHERE clauses         |
| **Multi-tenancy**   | Namespaces/collections      | Namespaces                | Multi-tenant classes | Partitions    | PostgreSQL schemas/RLS    |
| **Quantization**    | Binary, product, scalar     | Supported                 | PQ, BQ               | Multiple      | Half-precision (halfvec)  |
| **Max dimensions**  | 65,535                      | 20,000                    | Unlimited            | 32,768        | 16,000 (0.8+)             |
| **ColBERT support** | Multi-vector native         | No                        | No                   | No            | No                        |
| **On-disk index**   | Yes (HNSW on disk)          | Managed                   | Yes                  | Yes           | Yes (0.7+)                |
| **Self-hosted**     | Yes                         | No                        | Yes                  | Yes           | Yes (part of PostgreSQL)  |

### Performance Benchmarks (ANN-Benchmarks, 1M vectors, 1024 dims)

| Database        | QPS (Recall@10=0.95) | p99 Latency | Memory (1M vectors) |
| --------------- | -------------------- | ----------- | ------------------- |
| Qdrant          | ~1,200               | ~8ms        | ~4.5 GB             |
| Pinecone (p1)   | ~800                 | ~12ms       | Managed             |
| Weaviate        | ~900                 | ~10ms       | ~5.2 GB             |
| Milvus          | ~1,100               | ~9ms        | ~4.8 GB             |
| pgvector (HNSW) | ~400                 | ~25ms       | ~6.0 GB             |

_Benchmarks approximate, vary by hardware and configuration._

### Pricing Comparison (10M vectors, 1024 dimensions)

| Provider               | Monthly Cost           | Notes                                  |
| ---------------------- | ---------------------- | -------------------------------------- |
| Qdrant Cloud           | $75-$150/mo            | 1GB free forever, pay per GB           |
| Pinecone (Serverless)  | $200-$400/mo           | Read/write unit pricing, can spike     |
| Weaviate Cloud         | $150-$300/mo           | Per-module pricing                     |
| Zilliz Cloud           | $100-$250/mo           | Compute + storage pricing              |
| pgvector (self-hosted) | $0 (compute cost only) | Part of PostgreSQL, no additional cost |

### Decision: Qdrant Primary + pgvector Fallback

**Why Qdrant**:

1. **Rust performance**: Consistently top-tier QPS and latency in benchmarks
2. **Native hybrid search**: Dense + sparse vectors in a single collection, with RRF fusion
3. **Universal Query API**: Multi-stage retrieval (binary quantized scan → full vector → ColBERT rescoring) in one request
4. **Pre-filtering**: Minimal performance impact, critical for permission-aware retrieval with tenant isolation
5. **ColBERT/multi-vector support**: Essential for our ColPali multimodal retrieval roadmap
6. **Open source (Apache 2.0)**: Self-host for cost optimization at scale; no vendor lock-in
7. **Cloud offering**: $25/mo starting, 1GB free — perfect for MVP budget ($265-$565/mo target)
8. **Disk-based storage**: Cost-efficient for large collections without sacrificing too much performance

**Why pgvector as Fallback**:

1. Zero additional infrastructure for small deployments
2. Customers who want a single-database architecture
3. Sufficient for datasets under 50M vectors
4. Self-hosting guide uses pgvector for simplicity
5. HNSW index support (0.7+) with decent performance

**Why not Pinecone**: Proprietary, no self-hosting, pricing spikes (users report $50→$2,847/mo jumps), no ColBERT support
**Why not Weaviate**: Good but Go-based (slower than Rust for vector ops), no native sparse vectors
**Why not Milvus**: Excellent at scale but complex deployment (Kubernetes-heavy), overkill for MVP

---

## 2. Embedding Model: Cohere Embed v4 (Primary) + BGE-M3 (Self-Hosted)

### MTEB Benchmark Comparison

| Model                         | MTEB Average | Dimensions            | Languages | Multimodal          | Price (per M tokens) |
| ----------------------------- | ------------ | --------------------- | --------- | ------------------- | -------------------- |
| Cohere Embed v4               | 69.5         | 256-1024 (flexible)   | 100+      | Yes (text + images) | $0.12                |
| OpenAI text-embedding-3-large | 64.6         | 256-3072 (Matryoshka) | 100+      | No                  | $0.13                |
| OpenAI text-embedding-3-small | 62.3         | 512-1536              | 100+      | No                  | $0.02                |
| BGE-M3                        | 66.1         | 1024                  | 100+      | No                  | Free (self-hosted)   |
| Nomic Embed v2                | 62.8         | 256-768               | English   | No                  | $0.10                |
| Jina Embeddings v3            | 66.5         | 32-1024               | 89        | No                  | $0.02                |

_MTEB scores from leaderboard as of early 2026. Cohere v4 scores reflect multimodal capability boost._

### Feature Comparison

| Feature                             | Cohere v4        | OpenAI v3     | BGE-M3                   | Nomic v2   |
| ----------------------------------- | ---------------- | ------------- | ------------------------ | ---------- |
| Matryoshka dimensions               | Yes              | Yes           | No (fixed 1024)          | Yes        |
| Multimodal (images)                 | Yes              | No            | No                       | No         |
| Input types (search_document/query) | Yes              | No            | No                       | No         |
| Batch size                          | 96 texts         | Unlimited     | Self-hosted              | 2048       |
| Dense + sparse output               | v4 supports both | Dense only    | Dense + sparse + ColBERT | Dense only |
| Fine-tuning                         | API-based        | Not available | LoRA, full retrain       | LoRA       |
| Enterprise noisy data handling      | Excellent        | Good          | Good                     | Moderate   |

### Decision: Cohere Embed v4 Primary, BGE-M3 Self-Hosted Option

**Why Cohere Embed v4**:

1. **Top MTEB scores**: Consistently ranks highest across retrieval benchmarks
2. **Multimodal**: Text + image embeddings in a single model — future-proofs for ColPali integration
3. **Input type separation**: `search_document` vs `search_query` modes improve retrieval quality
4. **Dimension flexibility**: 256-1024 dims, enabling cost/performance tuning per use case
5. **Enterprise data handling**: Specifically trained on noisy enterprise documents (KPMG, EY, Pepsi use it)
6. **Competitive pricing**: $0.12/M tokens is cost-effective; embedding cost per document is $0.0001-$0.0005
7. **Batch API**: 96 texts per batch, efficient for bulk ingestion

**Why BGE-M3 as Self-Hosted Option**:

1. **MIT license**: Free for all uses, including commercial
2. **Triple output**: Dense + sparse + ColBERT representations from one model
3. **100+ languages**: Broadest multilingual coverage among open models
4. **Privacy**: Data never leaves customer infrastructure
5. **Cost**: $0 per token, only compute cost (~$0.50-2/hour on GPU)

**Why not OpenAI text-embedding-3**: No input type separation, no multimodal, slightly lower MTEB scores, $0.13/M is comparable but less capability per dollar.

---

## 3. Document Parser: Docling

### Comparison

| Feature                   | Docling                                 | LlamaParse                        | Unstructured.io                      |
| ------------------------- | --------------------------------------- | --------------------------------- | ------------------------------------ |
| License                   | MIT                                     | Proprietary (deprecated May 2026) | Apache 2.0 (OSS) / Proprietary (API) |
| Table extraction accuracy | High (DocTR engine)                     | High (agentic OCR)                | Medium-High                          |
| Format support            | PDF, DOCX, PPTX, HTML, images, Markdown | PDF, DOCX, PPTX, HTML, images     | 20+ formats                          |
| Processing speed          | Fast (local)                            | ~6s regardless of size (API)      | Variable                             |
| Cost                      | Free                                    | Deprecated                        | $0.03/page (API)                     |
| Self-hosted               | Yes (Python library)                    | No                                | Yes (OSS)                            |
| OCR quality               | DocTR + Tesseract                       | Agentic OCR                       | Multiple engines                     |
| Active maintenance        | Active (IBM Research)                   | Deprecated May 2026               | Active                               |

### Decision: Docling

**Why Docling**:

1. **MIT license**: No cost, no API dependency, full control
2. **Active development**: IBM Research maintains it actively
3. **Strong table extraction**: DocTR-based engine handles complex layouts well
4. **Local processing**: No data leaves infrastructure — critical for privacy-sensitive customers
5. **LlamaParse deprecated**: LlamaParse is deprecated as of May 2026 — Docling is the successor
6. **Format coverage**: PDF, DOCX, PPTX, HTML, images, Markdown — covers all common enterprise formats

**Migration from LlamaParse**: The original build plan referenced LlamaParse. Docling replaces it entirely with no loss of capability and gains privacy, cost, and licensing advantages.

---

## 4. ORM: Drizzle ORM

### Comparison

| Feature              | Drizzle                              | Prisma                    | TypeORM                        |
| -------------------- | ------------------------------------ | ------------------------- | ------------------------------ |
| Type safety          | SQL-like, inferred from schema       | Generated client          | Decorators, partial            |
| Query style          | SQL-like (`select().from().where()`) | Fluent API                | Query builder or Active Record |
| Performance          | Near-raw SQL                         | ~2-5x overhead vs raw     | ~3-8x overhead vs raw          |
| Bundle size          | ~30 KB                               | ~2 MB (generated client)  | ~1.5 MB                        |
| Migration tooling    | Drizzle Kit (generate from schema)   | Prisma Migrate            | TypeORM migrations             |
| Raw SQL escape hatch | Yes (`sql.raw()`)                    | Yes (`$queryRaw`)         | Yes (`query()`)                |
| Edge runtime support | Yes                                  | Limited                   | No                             |
| PostgreSQL features  | Full (RLS, enums, JSONB, arrays)     | Most (some gaps)          | Most                           |
| Learning curve       | Moderate (SQL knowledge required)    | Low (Prisma-specific DSL) | Moderate                       |

### Benchmark: Simple SELECT query (1000 iterations)

| ORM           | Avg Latency | Throughput  |
| ------------- | ----------- | ----------- |
| Raw pg driver | 0.8ms       | 1,250 ops/s |
| Drizzle       | 0.9ms       | 1,111 ops/s |
| Prisma        | 2.1ms       | 476 ops/s   |
| TypeORM       | 3.5ms       | 286 ops/s   |

### Decision: Drizzle ORM

**Why Drizzle**:

1. **SQL-like queries**: Developers think in SQL; Drizzle's API mirrors SQL closely
2. **Near-raw performance**: Only ~10% overhead vs raw SQL, compared to 2-5x for Prisma
3. **Tiny bundle**: ~30 KB vs Prisma's ~2 MB — matters for worker and edge deployments
4. **Full PostgreSQL support**: RLS, enums, JSONB, arrays — everything we need for multi-tenancy
5. **Schema-first**: Define schema in TypeScript, generate migrations — clean workflow
6. **Edge runtime compatible**: Works in Cloudflare Workers, Deno, Bun — future deployment flexibility
7. **No code generation step**: Unlike Prisma, no `prisma generate` needed after schema changes

**Why not Prisma**: Heavier runtime, slower queries, large bundle, code generation step adds complexity.
**Why not TypeORM**: Slowest of all three, decorator-based API is less type-safe, declining community momentum.

---

## 5. Web Framework: Express 5

### Comparison

| Feature              | Express 5                            | Fastify                                | Hono                |
| -------------------- | ------------------------------------ | -------------------------------------- | ------------------- |
| Maturity             | 15+ years, largest ecosystem         | 7 years, growing fast                  | 3 years, edge-first |
| npm downloads/week   | ~35M                                 | ~4M                                    | ~800K               |
| Async support        | Native in v5 (no wrapper needed)     | Native                                 | Native              |
| Middleware ecosystem | Largest (helmet, cors, multer, etc.) | Growing, express-compatible via plugin | Small but growing   |
| Performance (req/s)  | ~15K                                 | ~30K                                   | ~40K                |
| TypeScript support   | @types/express, improving            | First-class                            | First-class         |
| Learning resources   | Most extensive                       | Good                                   | Growing             |
| Body parsing         | Built-in (v5)                        | Built-in                               | Built-in            |

### Decision: Express 5

**Why Express 5**:

1. **Largest ecosystem**: Every middleware we need exists and is battle-tested (helmet, cors, multer, express-rate-limit, compression)
2. **Native async in v5**: The main Express 4 limitation (no async error handling) is fixed
3. **Hiring**: Most Node.js developers know Express — reduces onboarding time
4. **Stability**: 15+ years of production use, well-understood failure modes
5. **TypeScript 5.7+ compatible**: Good type support with `@types/express`

**Why not Fastify**: 2x faster in benchmarks but smaller middleware ecosystem; our bottleneck is Qdrant/Cohere latency, not framework overhead.
**Why not Hono**: Excellent for edge/serverless but too young for the core API; may use for edge functions later.

---

## 6. Frontend: Next.js 16

### Comparison

| Feature                 | Next.js 16               | Remix        | Astro              |
| ----------------------- | ------------------------ | ------------ | ------------------ |
| Rendering               | SSR, SSG, ISR, RSC       | SSR, SSG     | SSG, SSR (partial) |
| Build tool              | Turbopack (stable in 16) | Vite         | Vite               |
| App Router              | Mature (stable since 14) | Flat routes  | File-based         |
| React Server Components | Full support             | Experimental | No                 |
| Vercel integration      | First-class              | Good         | Good               |
| Community size          | Largest React framework  | Growing      | Growing            |
| TypeScript              | First-class              | First-class  | First-class        |

### Decision: Next.js 16

**Why Next.js 16**:

1. **Turbopack stable**: Build times dramatically improved in v16, no more Webpack
2. **App Router mature**: Stable since v14, well-documented patterns
3. **React Server Components**: Reduce client bundle for dashboard pages
4. **Vercel deployment**: Zero-config deployment option for dashboard
5. **Largest ecosystem**: Most UI component libraries support Next.js first
6. **Team familiarity**: Most common React framework, easiest to hire for

---

## 7. Queue: BullMQ

### Comparison

| Feature             | BullMQ             | Temporal               | pg-boss     |
| ------------------- | ------------------ | ---------------------- | ----------- |
| Backend             | Redis              | Custom server + DB     | PostgreSQL  |
| Complexity          | Low                | High                   | Low         |
| Priority queues     | Yes                | Yes                    | Yes         |
| Delayed jobs        | Yes                | Yes                    | Yes         |
| Cron/scheduled      | Yes                | Yes                    | Yes         |
| Rate limiting       | Built-in           | Custom                 | No          |
| Dashboard           | Bull Board (free)  | Temporal Web UI        | No official |
| Retry with backoff  | Exponential        | Custom                 | Linear      |
| Concurrency control | Per-worker, global | Per-workflow           | Per-queue   |
| Learning curve      | Low                | High (requires server) | Low         |

### Decision: BullMQ

**Why BullMQ**:

1. **Redis-based**: We already run Redis for caching — no additional infrastructure
2. **Proven**: Used by thousands of production applications
3. **Rate limiting**: Built-in limiter (100 jobs/min for Cohere API limits)
4. **Concurrency control**: Per-worker concurrency setting (5 concurrent ingestion jobs)
5. **Bull Board**: Free dashboard for monitoring queue health
6. **Simple API**: Queue, Worker, Job — straightforward mental model
7. **Reliable**: Exactly-once processing with acknowledgment, automatic retry on failure

**Why not Temporal**: Excellent for complex workflows but requires separate server deployment — overkill for document ingestion jobs.
**Why not pg-boss**: Decent but no rate limiting, no built-in dashboard, and PostgreSQL-based queues add load to the primary database.

---

## 8. Monorepo: Turborepo

### Comparison

| Feature        | Turborepo                   | Nx                                | Lerna                 |
| -------------- | --------------------------- | --------------------------------- | --------------------- |
| Build caching  | Remote + local              | Remote + local                    | Local only            |
| Task graph     | Automatic from package.json | Explicit configuration            | Manual                |
| Configuration  | Minimal (turbo.json)        | Extensive (nx.json, project.json) | Moderate              |
| Speed          | Fast (Rust-based)           | Fast (Rust-based daemon)          | Slow (Node.js)        |
| Learning curve | Low                         | High                              | Low                   |
| Maintained by  | Vercel                      | Nrwl                              | Community (declining) |
| Plugins        | Minimal                     | Extensive                         | Minimal               |
| Generators     | No                          | Yes                               | No                    |

### Decision: Turborepo

**Why Turborepo**:

1. **Minimal configuration**: Single `turbo.json` file, auto-infers task graph from `package.json`
2. **Rust-based speed**: Fast task scheduling and caching
3. **Remote caching**: Vercel Remote Cache for CI/CD speed (or self-hosted)
4. **pnpm native**: First-class pnpm workspace support
5. **Vercel maintained**: Active development, aligned with our Next.js choice
6. **Simple mental model**: Tasks, dependencies, caching — nothing else to learn

**Why not Nx**: More powerful but significantly more complex configuration; generators and plugins are unnecessary for our scope.
**Why not Lerna**: Effectively deprecated in favor of Nx; slower than both alternatives.

---

## 9. Reranking: Cohere Rerank 3.5

### Comparison

| Model              | Accuracy (BEIR avg)             | Latency (top-20→top-5) | Price               | Languages | Self-hosted |
| ------------------ | ------------------------------- | ---------------------- | ------------------- | --------- | ----------- |
| Cohere Rerank 3.5  | 8-11% improvement over baseline | 50-100ms               | $2/1K searches      | 100+      | No          |
| BGE-reranker-v2-m3 | 6-9% improvement                | 30-80ms (GPU)          | Free (compute only) | 100+      | Yes         |
| Jina Reranker v2   | 5-8% improvement                | 40-90ms                | $0.02/1K            | 100+      | Yes         |
| FlashRank          | 3-5% improvement                | 10-20ms                | Free                | English   | Yes         |

### Decision: Cohere Rerank 3.5

**Why**: Best accuracy, 100+ languages, pairs naturally with Cohere Embed v4, $2/1K searches is affordable at our pricing.

**Fallback**: BGE-reranker-v2-m3 self-hosted for customers requiring data residency.

---

## 10. Additional Stack Components

### Testing: Vitest

- Fast, Vite-based, native TypeScript support
- Compatible with Jest API (easy migration)
- Watch mode, coverage reporting, snapshot testing
- Used across all packages in the monorepo

### Validation: Zod

- Runtime type validation with TypeScript inference
- Used for all API input validation
- Schema-first approach mirrors Drizzle schema definitions
- Small bundle, fast validation

### Logging: Pino

- Fastest Node.js JSON logger
- Structured logging for machine parsing
- Redaction support for sensitive fields (API keys, PII)
- Pino-pretty for development, raw JSON for production
- OpenTelemetry integration via pino-opentelemetry-transport

### Observability: OpenTelemetry + Prometheus + Grafana

- OpenTelemetry: Distributed tracing across API, Worker, and external services
- Prometheus: Metrics collection (latency, error rates, queue depth)
- Grafana: Dashboards and alerting
- Langfuse: LLM-specific observability (token costs, quality scores)

### Package Manager: pnpm 9+

- Fastest install times among npm, yarn, pnpm
- Strict dependency resolution (prevents phantom dependencies)
- Native workspace support (pnpm workspaces)
- Content-addressable storage (disk-efficient)

### Language: TypeScript 5.7+

- `satisfies` operator for type-safe configurations
- `using` keyword for resource management
- Improved type inference for complex generics
- strictNullChecks, exactOptionalPropertyTypes enabled

---

## 11. Infrastructure Cost Projections

### Launch Phase (100 Users)

| Component              | Service                             | Monthly Cost     |
| ---------------------- | ----------------------------------- | ---------------- |
| PostgreSQL 17          | Supabase Pro / RDS                  | $25-$50          |
| Qdrant                 | Qdrant Cloud (1-2 GB)               | $25-$50          |
| Redis 7.2+             | Upstash / ElastiCache               | $10-$30          |
| Compute (API + Worker) | Railway / Fly.io                    | $50-$150         |
| Cohere APIs            | Embed v4 + Rerank 3.5               | $50-$150         |
| CloudFlare             | Pro plan                            | $20              |
| Monitoring             | Grafana Cloud free + Langfuse cloud | $0-$50           |
| Domain + DNS           | CloudFlare                          | $15              |
| **Total**              |                                     | **$265-$565/mo** |

### Scale Phase (10K Users)

| Component              | Service                       | Monthly Cost         |
| ---------------------- | ----------------------------- | -------------------- |
| PostgreSQL 17          | RDS Multi-AZ / Aurora         | $200-$500            |
| Qdrant                 | Self-hosted cluster (3 nodes) | $300-$600            |
| Redis 7.2+             | ElastiCache cluster           | $100-$300            |
| Compute (API + Worker) | ECS/EKS (auto-scaling)        | $500-$1,500          |
| Cohere APIs            | Volume pricing                | $1,000-$2,500        |
| CloudFlare             | Business plan                 | $200                 |
| Monitoring             | Grafana Cloud + Langfuse      | $200-$500            |
| CDN + Storage          | S3 + CloudFront               | $100-$300            |
| **Total**              |                               | **$3,000-$7,200/mo** |

---

## 12. Cross-References

- Competitor analysis: [COMPETITOR_ANALYSIS.md](./COMPETITOR_ANALYSIS.md)
- Pricing model: [PRICING_MODEL.md](./PRICING_MODEL.md)
- Security controls: [SECURITY_CONTROLS.md](../compliance/SECURITY_CONTROLS.md)
- Performance tuning: [performance-tuning.md](../runbooks/performance-tuning.md)
- Phase 1 foundation: [Phase 1 README](../phases/phase-01-foundation/README.md)
