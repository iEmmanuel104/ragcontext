# ContextInject: System Architecture

> Complete system architecture, data flows, multi-tenancy model, and security layers.

---

## High-Level Architecture Diagram

```
                          ┌─────────────────────────────────────────────────┐
                          │              Client Layer                        │
                          │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
                          │  │ SDK (npm) │  │ REST API │  │ MCP Server   │  │
                          │  │contextinject│ │  cURL   │  │(Claude/GPT)  │  │
                          │  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
                          └───────┼─────────────┼────────────────┼──────────┘
                                  │             │                │
                                  ▼             ▼                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         API Gateway (Express 5)                              │
│  ┌─────────┐ ┌────────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌───────┐ ┌────────┐  │
│  │ Helmet  │ │  CORS  │ │ Rate │ │Compress│ │ Auth │ │Tenant │ │Request │  │
│  │         │ │        │ │ Limit│ │  ion   │ │      │ │  ctx  │ │  ID    │  │
│  └─────────┘ └────────┘ └──────┘ └───────┘ └──────┘ └───────┘ └────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐        │
│  │Idempotency│ │API Version│ │Audit Log │ │  Metrics  │ │ Validate │        │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘ └──────────┘        │
│                                                                              │
│  Routes: /v1/query  /v1/documents  /v1/projects  /v1/connectors             │
│          /v1/analytics  /health  /webhooks                                   │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                     ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Query Service   │ │ Document Service │ │ Connector Service│
│  (Retrieval)     │ │ (Ingestion)      │ │ (OAuth + Sync)   │
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         │                    │                     │
         │                    ▼                     │
         │           ┌──────────────────┐           │
         │           │   Job Queue      │           │
         │           │   (BullMQ)       │◄──────────┘
         │           └────────┬─────────┘
         │                    │
         │                    ▼
         │           ┌──────────────────┐
         │           │   Worker         │
         │           │   (apps/worker)  │
         │           │   6 processors   │
         │           └────────┬─────────┘
         │                    │
         ▼                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Data Layer                                   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │ PostgreSQL 17 │  │    Qdrant     │  │   Redis 7.2   │        │
│  │ + pgvector    │  │ (vectors)     │  │ (cache/queue) │        │
│  │ (metadata,    │  │               │  │               │        │
│  │  chunks, RLS) │  │               │  │               │        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 10-Stage Pipeline Flow

Every query flows through up to 10 stages. Each stage is independently testable, measurable, and replaceable.

```
Request ──►[1. Cache Check]──hit──► Return cached result
                │ miss
                ▼
           [2. Query Embedding]──► Cohere Embed v4 (1024 dims)
                │
                ▼
           [3. Permission Filter]──► Build ACL filter (tenant_id + access tags)
                │
                ▼
           [4. Hybrid Search]──► Dense (Qdrant HNSW) + Sparse (BM25/RRF)
                │                  Retrieve top-100 candidates
                ▼
           [5. Chunk Hydration]──► PostgreSQL JOIN (content + metadata)
                │
                ▼
           [6. Reranking]──► Cohere Rerank 3.5 (narrow to top-5)
                │
                ▼
           [7. Compression]──► LLMLingua-2 (2-3x token reduction)
                │
                ▼
           [8. Context Assembly]──► Format with citations, model-specific XML/MD
                │
                ▼
           [9. Quality Scoring]──► RAGAS-style composite score (0-1)
                │
                ▼
           [10. Cache Store + Log]──► Redis cache set + PostgreSQL query_log
                │
                ▼
           Response with context, citations, quality score, usage metrics
```

### Latency Budget per Stage

| Stage                 | Target (p50) | Target (p99) | Notes                             |
| --------------------- | ------------ | ------------ | --------------------------------- |
| 1. Cache check        | 2ms          | 5ms          | Redis GET + cosine comparison     |
| 2. Query embedding    | 15ms         | 50ms         | Cohere API call                   |
| 3. Permission filter  | <1ms         | <1ms         | In-memory filter construction     |
| 4. Hybrid search      | 15ms         | 40ms         | Qdrant dense + sparse parallel    |
| 5. Chunk hydration    | 5ms          | 15ms         | PostgreSQL batch SELECT           |
| 6. Reranking          | 30ms         | 80ms         | Cohere Rerank API                 |
| 7. Compression        | 10ms         | 30ms         | LLMLingua-2 (when enabled)        |
| 8. Context assembly   | <1ms         | <1ms         | String concatenation + formatting |
| 9. Quality scoring    | 5ms          | 15ms         | Statistical scoring (no LLM)      |
| 10. Cache store + log | async        | async        | Fire-and-forget                   |
| **Total**             | **~80ms**    | **~200ms**   | **Full pipeline, cache miss**     |

---

## Data Flow: Ingestion

```
Document Upload (API / Connector Sync)
         │
         ▼
┌─────────────────────────┐
│ 1. Document record       │──► PostgreSQL (status: 'pending')
│    created               │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 2. Job enqueued          │──► BullMQ 'ingest-document' queue
│    (Redis)               │
└────────────┬────────────┘
             │
             ▼  (Worker picks up job)
┌─────────────────────────┐
│ 3. Parse document        │──► Docling: PDF/DOCX/HTML → structured text
│    (status: 'processing')│    Extract: tables, headings, images
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 4. Chunk document        │──► Semantic chunker (512 tokens, 50 overlap)
│                          │    Output: N chunks with metadata
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 5. Generate embeddings   │──► Cohere Embed v4 (batch of 96)
│    (status: 'embedding') │    1024-dim dense vectors
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 6. Upsert vectors        │──► Qdrant: dense + sparse vectors + payload
│                          │    Collection: tenant_{id}
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 7. Store chunk metadata  │──► PostgreSQL: chunks table (content, vectorId)
│                          │    Delete old chunks first (re-index support)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 8. Update document       │──► PostgreSQL (status: 'indexed')
│    record                │    chunkCount, tokenCount, indexedAt
└─────────────────────────┘
```

### Document Status Machine

```
pending ──► processing ──► embedding ──► indexed
   │            │              │
   │            ▼              ▼
   └────────► failed ◄────── failed
                │
                ▼
             (retry up to 3x with exponential backoff)
                │
                ▼
             deleted (soft delete: deletedAt timestamp set)
```

---

## Data Flow: Retrieval

```
Query Request (SDK / API / MCP)
         │
         ├── API key authentication ──► SHA-256 hash lookup ──► tenant context
         │
         ▼
┌─────────────────────────┐
│ Semantic Cache Lookup    │──► Redis: embed query → cosine similarity > 0.90
│ (2-5ms)                 │    Hit: return cached QueryResult
└────────────┬────────────┘
             │ miss
             ▼
┌─────────────────────────┐
│ Query Embedding          │──► Cohere Embed v4 (input_type: 'search_query')
│ (15-50ms)               │    1024-dim vector
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Build Permission Filter  │──► { must: [projectId, !isDeleted, ACL tags] }
│ (<1ms)                  │    Pre-filter, not post-filter
└────────────┬────────────┘
             │
             ├──────────────────────────────┐
             ▼                              ▼
┌──────────────────────┐     ┌──────────────────────┐
│ Dense Vector Search  │     │ Sparse (BM25) Search │
│ Qdrant HNSW          │     │ Qdrant sparse index  │
│ top-K=100            │     │ top-K=100            │
│ (10-30ms)            │     │ (10-20ms)            │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           └──────────┬─────────────────┘
                      ▼
             ┌──────────────────┐
             │ Reciprocal Rank  │──► RRF fusion (k=60)
             │ Fusion (RRF)    │    Merged top-100 candidates
             └────────┬────────┘
                      │
                      ▼
             ┌──────────────────┐
             │ Chunk Hydration  │──► PostgreSQL: SELECT content, metadata
             │ (5-15ms)        │    WHERE vectorId IN (...)
             └────────┬────────┘
                      │
                      ▼
             ┌──────────────────┐
             │ Reranking        │──► Cohere Rerank 3.5: score all 100
             │ (30-80ms)       │    Return top-5 with cross-encoder scores
             └────────┬────────┘
                      │
                      ▼
             ┌──────────────────┐
             │ Context Assembly │──► Concatenate chunks with citations
             │ + Compression   │    LLMLingua-2: 2-3x token reduction
             └────────┬────────┘
                      │
                      ▼
             ┌──────────────────┐
             │ Quality Scoring  │──► Composite: retrieval confidence,
             │                  │    context sufficiency, diversity
             └────────┬────────┘
                      │
                      ├──► Async: cache store (Redis)
                      ├──► Async: query log (PostgreSQL)
                      │
                      ▼
             QueryResult {
               context, citations, quality, usage, latencyMs
             }
```

---

## Multi-Tenancy Architecture

ContextInject uses a tiered isolation model based on customer plan:

### Tier 1: Shared Database + RLS (Free / Starter)

```
┌──────────────────────────────────────────┐
│           PostgreSQL 17                   │
│  ┌──────────────────────────────────┐    │
│  │         tenants table             │    │
│  │  Tenant A │ Tenant B │ Tenant C  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Row-Level Security (RLS) enforced:      │
│  current_setting('app.tenant_id') = id   │
│                                          │
│  All queries automatically filtered      │
│  by tenant_id via RLS policies           │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│              Qdrant                       │
│  ┌────────────┐ ┌────────────┐          │
│  │ namespace: │ │ namespace: │          │
│  │ tenant_a   │ │ tenant_b   │ ...      │
│  └────────────┘ └────────────┘          │
│  Namespace-per-tenant isolation          │
└──────────────────────────────────────────┘
```

**RLS policy (applied per migration):**

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Set tenant context per request (in @ci/db pool middleware):
SET LOCAL app.tenant_id = '<tenant-uuid>';
```

### Tier 2: Schema-per-Tenant (Pro)

Each Pro tenant gets a dedicated PostgreSQL schema with identical table structure. RLS remains as defense-in-depth. Qdrant uses dedicated collections per tenant.

### Tier 3: Database-per-Tenant (Enterprise)

Fully isolated PostgreSQL instance and Qdrant collection for regulated industries (HIPAA, financial services). Supports BYOK (Bring Your Own Key) encryption and regional data residency.

---

## Permission-Aware Retrieval

ACL metadata is stored with every document and propagated to every chunk:

```typescript
// Document-level ACL
interface AccessControl {
  ownerId?: string;
  groupIds?: string[];
  isPublic: boolean;
  customTags?: string[];
}

// Qdrant point payload includes:
{
  tenantId: "tenant-uuid",
  projectId: "project-uuid",
  documentId: "doc-uuid",
  accessControl: {
    ownerId: "user-123",
    groupIds: ["engineering", "platform"],
    isPublic: false,
  },
  isDeleted: false,
}
```

**Pre-filtering** (not post-filtering) is critical for security. The filter is constructed before vector search:

```typescript
const filter = {
  must: [
    { key: "projectId", match: { value: request.projectId } },
    { key: "isDeleted", match: { value: false } },
  ],
  should: [
    { key: "accessControl.isPublic", match: { value: true } },
    { key: "accessControl.ownerId", match: { value: userId } },
    { key: "accessControl.groupIds", match: { any: userGroups } },
  ],
};
```

This ensures users never receive chunks from documents they cannot access — the vector database excludes them before similarity scoring.

---

## Three-Tier Memory Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Short-term Memory (Redis)                                   │
│ TTL: session duration (30 min default)                      │
│ Content: current conversation messages, recent queries       │
│ Use: conversation continuity within a session               │
│ Key: conv:{tenantId}:{conversationId}                       │
└──────────────────────────┬─────────────────────────────────┘
                           │ (session end / TTL expiry)
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Mid-term Memory (Vector Store)                              │
│ TTL: hours to days (configurable per tenant)                │
│ Content: session summaries, extracted entities, preferences  │
│ Use: cross-session context within recent timeframe          │
│ Storage: Qdrant memory collection per tenant                │
└──────────────────────────┬─────────────────────────────────┘
                           │ (important facts extracted)
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Long-term Memory (PostgreSQL)                               │
│ TTL: indefinite                                             │
│ Content: user profiles, interaction history, learned prefs   │
│ Use: persistent knowledge across all sessions               │
│ Storage: conversations table + vector index for retrieval   │
└────────────────────────────────────────────────────────────┘
```

---

## Complete Monorepo Structure

```
ragcontext/
├── apps/
│   ├── api/                    # Express 5 REST API
│   │   ├── src/
│   │   │   ├── app.ts          # Express app factory (14 middleware)
│   │   │   ├── server.ts       # HTTP server entry point
│   │   │   ├── middleware/     # auth, tenant, rate-limit, validate, etc.
│   │   │   ├── routes/        # query, documents, projects, connectors, analytics, health, webhooks
│   │   │   └── services/      # pipeline-factory, document-service, connector-service, queue, analytics, billing
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── worker/                 # BullMQ background processor
│   │   ├── src/
│   │   │   ├── index.ts        # Worker entry point
│   │   │   └── processors/    # ingest-document, sync-connector, delete-document,
│   │   │                       # reindex-project, generate-embeddings, cleanup
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/              # Next.js 16 web UI
│   │   ├── app/               # App Router pages
│   │   ├── components/        # Shared UI components
│   │   └── package.json
│   │
│   └── mcp-server/             # MCP agent integration
│       ├── src/
│       │   └── index.ts        # 4 tools: retrieve_context, index_document,
│       │                       #          list_documents, search_documents
│       └── package.json
│
├── packages/
│   ├── types/                  # Shared TypeScript interfaces
│   │   └── src/index.ts        # Tenant, Document, Chunk, QueryRequest, etc.
│   │
│   ├── db/                     # Drizzle ORM + migrations + connection pool
│   │   ├── src/
│   │   │   ├── schema/         # Table definitions
│   │   │   ├── client.ts       # Pool + drizzle instance
│   │   │   ├── migrate.ts      # Migration runner
│   │   │   └── seed.ts         # Development seed data
│   │   └── drizzle/            # Generated migrations
│   │
│   ├── auth/                   # JWT, API keys, OAuth, RBAC
│   │   └── src/
│   │       ├── api-key.ts      # Key generation + validation
│   │       ├── jwt.ts          # Token issue + verify
│   │       ├── oauth.ts        # PKCE flows for connectors
│   │       ├── rbac.ts         # Role-based access control
│   │       └── password.ts     # Argon2id hashing
│   │
│   ├── errors/                 # Error hierarchy + circuit breaker
│   │   └── src/
│   │       ├── app-error.ts    # Base error class
│   │       ├── errors.ts       # AuthError, ValidationError, etc.
│   │       └── circuit-breaker.ts
│   │
│   ├── logger/                 # Pino structured logging + PII redaction
│   │   └── src/index.ts
│   │
│   ├── config/                 # Zod-validated environment configuration
│   │   └── src/index.ts
│   │
│   ├── crypto/                 # AES-256-GCM, HMAC-SHA256, key rotation
│   │   └── src/index.ts
│   │
│   ├── core/                   # Ingestion + retrieval pipelines
│   │   └── src/
│   │       ├── pipeline/
│   │       │   ├── ingestion-pipeline.ts
│   │       │   └── retrieval-pipeline.ts
│   │       └── index.ts
│   │
│   ├── vector-store/           # Qdrant + pgvector abstraction
│   │   └── src/
│   │       ├── index.ts        # IVectorStore interface
│   │       ├── qdrant.ts       # Qdrant implementation
│   │       └── pgvector.ts     # pgvector fallback
│   │
│   ├── embeddings/             # Cohere v4 + OpenAI + BGE-M3
│   │   └── src/
│   │       ├── index.ts        # IEmbeddingProvider interface
│   │       ├── cohere.ts       # Cohere Embed v4
│   │       ├── openai.ts       # text-embedding-3-large
│   │       └── bgem3.ts        # Self-hosted BGE-M3
│   │
│   ├── chunker/                # Chunking strategies
│   │   └── src/
│   │       ├── semantic.ts     # Embedding-boundary splitting
│   │       ├── recursive.ts    # Recursive character splitting
│   │       ├── sentence.ts     # Sentence-boundary splitting
│   │       └── fixed.ts        # Fixed-size token chunks
│   │
│   ├── parser/                 # Docling adapter
│   │   └── src/
│   │       ├── index.ts        # IDocumentParser interface
│   │       └── docling.ts      # Docling implementation
│   │
│   ├── reranker/               # Cohere Rerank 3.5 + BGE fallback
│   │   └── src/
│   │       ├── index.ts        # IRerankProvider interface
│   │       ├── cohere.ts       # Cohere Rerank 3.5
│   │       └── bge.ts          # BGE-reranker-v2-m3
│   │
│   ├── compressor/             # LLMLingua-2 + extractive fallback
│   │   └── src/index.ts
│   │
│   ├── evaluator/              # RAGAS-style quality scoring
│   │   └── src/index.ts
│   │
│   ├── cache/                  # Redis semantic cache
│   │   └── src/index.ts
│   │
│   ├── queue/                  # BullMQ queue definitions
│   │   └── src/index.ts
│   │
│   ├── connectors/             # Data source connectors
│   │   ├── src/
│   │   │   ├── base.ts         # BaseConnector abstract class
│   │   │   ├── notion/
│   │   │   ├── gdrive/
│   │   │   ├── slack/
│   │   │   ├── gmail/
│   │   │   └── github/
│   │   └── package.json
│   │
│   └── sdk/                    # Public TypeScript SDK (npm: contextinject)
│       └── src/index.ts
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml        # Dev environment
│   │   ├── docker-compose.prod.yml   # Production
│   │   └── docker-compose.test.yml   # CI testing
│   ├── k8s/                          # Kubernetes manifests + HPA
│   └── terraform/                    # Cloud infrastructure modules
│
├── tests/
│   ├── integration/            # Full pipeline, API, auth, multi-tenant
│   ├── load/k6/               # k6 load test scripts
│   ├── security/              # Vector injection, prompt injection, isolation
│   └── quality/               # Embedding quality, retrieval relevance
│
├── scripts/
│   ├── setup.sh               # Initial environment setup
│   ├── seed.ts                # Database seeding
│   └── generate-openapi.ts    # OpenAPI spec generation
│
├── docs/                      # All documentation
├── .github/                   # CI/CD workflows, issue templates, dependabot
│
├── package.json               # Root monorepo config
├── pnpm-workspace.yaml        # Workspace definition
├── turbo.json                 # Turborepo task graph
├── tsconfig.base.json         # Shared TypeScript config
├── vitest.workspace.ts        # Vitest workspace config
├── .env.example               # Environment variable template
│
├── LICENSE-APACHE             # Apache 2.0 for core packages
├── LICENSE-MIT                # MIT for SDKs, connectors, CLI
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── README.md
```

---

## Service Communication Patterns

### Synchronous (Request/Response)

- **SDK -> API**: HTTPS REST (JSON), Bearer token auth
- **API -> Qdrant**: HTTP/gRPC, API key auth
- **API -> Cohere**: HTTPS REST, Bearer token auth
- **API -> PostgreSQL**: TCP, connection pool (pg Pool, max 20 connections per API instance)

### Asynchronous (Message Queue)

- **API -> Worker**: BullMQ (Redis-backed), job types: `ingest-document`, `sync-connector`, `delete-document`, `reindex-project`, `generate-embeddings`, `cleanup`
- **Worker -> API**: Job completion events (BullMQ callbacks); status updates via PostgreSQL

### Real-time

- **API -> Client**: Server-Sent Events (SSE) for streaming retrieval progress
- **Connectors -> API**: Webhooks (HMAC-SHA256 signature verification)

---

## Error Handling Strategy

### Error Hierarchy

```
AppError (base)
├── AuthError (401)
│   ├── InvalidApiKeyError
│   ├── ExpiredApiKeyError
│   └── InsufficientScopeError
├── ValidationError (400)
│   ├── InvalidInputError
│   └── SchemaValidationError
├── NotFoundError (404)
│   ├── DocumentNotFoundError
│   └── ProjectNotFoundError
├── ConflictError (409)
│   └── DuplicateError
├── RateLimitError (429)
├── ExternalServiceError (502)
│   ├── EmbeddingServiceError
│   ├── VectorStoreError
│   └── RerankServiceError
└── InternalError (500)
```

### Circuit Breaker Pattern

Applied to all external service calls (Cohere, Qdrant, Docling):

```
CLOSED ──(failure threshold exceeded)──► OPEN
   ▲                                       │
   │                              (timeout period)
   │                                       │
   └──(success)── HALF-OPEN ◄─────────────┘
```

- **Failure threshold:** 5 failures in 60 seconds
- **Open duration:** 30 seconds
- **Half-open:** Allow 1 request through; success -> CLOSED, failure -> OPEN

### Retry Strategy

All retryable operations use exponential backoff with jitter:

```
delay = min(baseDelay * 2^attempt + random(0, 1000ms), maxDelay)
```

- Base delay: 1 second
- Max delay: 30 seconds
- Max attempts: 3 (configurable per operation)
- Jitter: 0-1000ms random

---

## Security Architecture Layers

```
Layer 1: Network
├── TLS 1.3 in transit (all connections)
├── DDoS protection (Cloudflare / rate limiting)
├── CORS configuration (allowlist origins)
└── Request size limits (50MB max body)

Layer 2: Authentication
├── API key validation (SHA-256 hash, in-memory LRU cache)
├── JWT tokens (dashboard sessions, RS256)
├── OAuth 2.0 PKCE (connector auth flows)
└── Webhook HMAC-SHA256 signature verification

Layer 3: Authorization
├── RBAC (owner, admin, member, viewer)
├── API key scopes (documents:read, documents:write, query, admin)
├── Resource ownership verification (tenant_id matching)
└── Row-Level Security (PostgreSQL RLS policies)

Layer 4: Data Protection
├── AES-256-GCM encryption (connector credentials at rest)
├── BYOK for enterprise tier (customer-managed encryption keys)
├── PII detection + redaction in logs (Pino transport)
├── Content hash verification (SHA-256 for document integrity)
└── Soft delete with GDPR cascading deletion support

Layer 5: Application Security
├── Input validation (Zod schemas on all endpoints)
├── SQL injection prevention (Drizzle parameterized queries)
├── Vector injection prevention (embedding normalization + anomaly detection)
├── Prompt injection detection (input scanning)
├── CSRF protection (SameSite cookies + CSRF tokens)
└── Idempotency keys (prevent duplicate operations)

Layer 6: Operational Security
├── Audit logging (all data mutations → audit_logs table)
├── Dependency scanning (Renovate/Dependabot + npm audit)
├── SBOM generation (CycloneDX format)
├── Secret scanning (pre-commit hooks)
└── Security headers (Helmet.js — CSP, HSTS, X-Frame-Options)

Layer 7: Monitoring
├── OpenTelemetry distributed tracing
├── Prometheus metrics + Grafana dashboards
├── Error rate alerting (PagerDuty/Slack)
├── Anomaly detection on query patterns
└── SLI/SLO definitions with burn rate alerts
```

---

_Last updated: 2026-02-23_
_Related: [Tech Stack](./TECH_STACK.md) | [Master Plan](./MASTER_PLAN.md)_
