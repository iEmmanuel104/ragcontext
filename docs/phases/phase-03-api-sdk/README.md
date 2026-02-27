# Phase 3: API & SDK Layer

> **Timeline**: Weeks 7-9 | **Status**: Planned
> **Dependencies**: Phase 1 (Core Pipeline) and Phase 2 (Ingestion & Storage) must be complete

---

## Overview

Phase 3 transforms the core pipeline engine built in Phases 1-2 into a production-ready, developer-facing API and SDK ecosystem. This phase delivers four parallel workstreams: the Express 5 REST API server, the TypeScript SDK published to npm, the MCP server for AI agent integration, and the initial data source connectors (Notion, Google Drive, Direct Upload).

The guiding principle is **"time to first RAG query under 3 minutes"** — a developer should be able to install the SDK, generate an API key, upload a document, and run a retrieval query in under 180 seconds.

---

## Objectives

1. **Ship a production-grade REST API** with 14 middleware layers, 7 route groups, and 6 service modules on Express 5 with native async error handling
2. **Publish @ci/sdk to npm** (package name: `contextinject`) with full TypeScript types, retry logic, SSE streaming, and JSDoc documentation
3. **Deploy an MCP server** exposing 4 tools for AI agent integration (Claude, GPT, Gemini, any MCP-compatible agent)
4. **Launch 3 initial connectors** (Notion, Google Drive, Direct Upload) with credential encryption and sync scheduling
5. **Generate an OpenAPI 3.1 specification** from route definitions for automatic documentation and client generation

---

## Deliverables

| Deliverable           | Package/App                            | Output                                                       |
| --------------------- | -------------------------------------- | ------------------------------------------------------------ |
| REST API Server       | `apps/api`                             | Express 5 app with 14 middleware, 7 route groups, 6 services |
| TypeScript SDK        | `packages/sdk`                         | npm package `contextinject` with full type exports           |
| MCP Server            | `apps/mcp-server`                      | Stdio + SSE transport MCP server with 4 tools                |
| Connectors            | `packages/connectors`                  | Notion, Google Drive, Direct Upload connectors               |
| OpenAPI Spec          | `apps/api/scripts/generate-openapi.ts` | OpenAPI 3.1 JSON/YAML                                        |
| API Key Management    | `packages/auth`                        | Key generation, SHA-256 hashing, LRU cache, scope checking   |
| Credential Encryption | `packages/crypto`                      | AES-256-GCM encrypt/decrypt for connector credentials        |

---

## Architecture

```
                    Developer
                       |
            +----------+----------+
            |          |          |
         SDK/HTTP    MCP Tool   Dashboard
            |          |          |
            v          v          v
    +-------------------------------+
    |      Express 5 REST API       |
    |  /v1/query  /v1/documents ... |
    +-------------------------------+
    |     14 Middleware Layers       |
    |  auth -> tenant -> validate   |
    |  -> rate-limit -> idempotency |
    |  -> audit-log -> compress ... |
    +-------------------------------+
    |       6 Service Modules       |
    |  pipeline-factory, document,  |
    |  project, connector, billing, |
    |  analytics                    |
    +-------------------------------+
            |              |
     +------+------+   +--+--+
     | @ci/core    |   | BullMQ |
     | Pipeline    |   | Queue  |
     +-------------+   +--------+
```

---

## Parallel Execution Strategy

After the API server skeleton is in place (routes + middleware), the remaining workstreams can execute in parallel:

```
Week 7: API Server (all middleware + routes + services)
        |
        +---> Week 8: SDK (parallel)
        +---> Week 8: MCP Server (parallel)
        +---> Week 8: Connectors (parallel)
        |
Week 9: Integration testing across all workstreams
        OpenAPI spec generation
        SDK publish dry-run
```

The SDK depends on the API route contracts (request/response shapes), but not on a running API server — it can be developed against the TypeScript types from `@ci/types`. The MCP server wraps SDK calls, so it can be built in parallel once the SDK interface is defined. Connectors are independent of all three.

---

## Critical Files

### API Server (`apps/api/`)

```
apps/api/
├── src/
│   ├── app.ts                          # Express 5 app factory (createApp)
│   ├── server.ts                       # Bootstrap + graceful shutdown
│   ├── middleware/
│   │   ├── auth.ts                     # API key validation, SHA-256 lookup, LRU cache
│   │   ├── tenant.ts                   # Tenant hydration, plan limits enforcement
│   │   ├── validate.ts                 # Zod schema validation (body, params, query)
│   │   ├── error-handler.ts            # Centralized error handling, error codes
│   │   ├── logger.ts                   # Pino structured request logging
│   │   ├── metrics.ts                  # OpenTelemetry HTTP metrics
│   │   ├── rate-limit.ts              # Sliding window per API key, plan-based limits
│   │   ├── idempotency.ts            # Idempotency-Key header, Redis dedup, 24h TTL
│   │   ├── api-version.ts            # URL-based /v1/, deprecation headers
│   │   ├── request-id.ts             # X-Request-Id injection + propagation
│   │   ├── compression.ts            # Brotli/gzip response compression
│   │   ├── audit-log.ts              # Immutable append-only audit logging
│   │   ├── cors.ts                    # Configurable per environment
│   │   └── require-scope.ts           # API key scope checking
│   ├── routes/v1/
│   │   ├── query.ts                    # POST /v1/query (retrieval endpoint)
│   │   ├── documents.ts               # CRUD + upload /v1/documents
│   │   ├── projects.ts                # CRUD /v1/projects
│   │   ├── connectors.ts              # CRUD + sync /v1/connectors
│   │   ├── webhooks.ts                # Connector webhook receivers
│   │   ├── analytics.ts               # GET /v1/analytics
│   │   └── health.ts                  # GET /health (public, no auth)
│   ├── services/
│   │   ├── pipeline-factory.ts         # Creates RetrievalPipeline per tenant+project
│   │   ├── document-service.ts         # Document CRUD + ingestion queuing
│   │   ├── project-service.ts          # Project CRUD + pipeline config
│   │   ├── connector-service.ts        # Connector CRUD + sync scheduling
│   │   ├── billing-service.ts          # Usage metering + plan enforcement
│   │   └── analytics-service.ts        # Query logs aggregation
│   ├── utils/
│   │   ├── errors.ts                   # AppError class + error codes
│   │   ├── pagination.ts              # Cursor-based pagination helpers
│   │   └── response.ts                # Standardized response wrapper
│   └── telemetry/
│       ├── otel.ts                     # OpenTelemetry SDK init
│       └── metrics.ts                  # Custom metric definitions
├── scripts/
│   └── generate-openapi.ts             # OpenAPI 3.1 spec generator
├── package.json
└── tsconfig.json
```

### SDK (`packages/sdk/`)

```
packages/sdk/
├── src/
│   ├── index.ts                        # ContextInject class + all exports
│   ├── types.ts                        # Public SDK types
│   └── errors.ts                       # ContextInjectError class
├── package.json                        # name: "contextinject"
├── tsconfig.json
└── tsup.config.ts                      # Build config (ESM + CJS)
```

### MCP Server (`apps/mcp-server/`)

```
apps/mcp-server/
├── src/
│   ├── index.ts                        # Server bootstrap
│   ├── tools/                          # 4 MCP tools
│   ├── security/
│   │   ├── input-sanitizer.ts          # Prompt injection detection
│   │   └── rate-limiter.ts             # Per-tool rate limiting
│   └── transports/
│       ├── stdio.ts                    # CLI transport
│       └── sse.ts                      # Web transport
├── package.json
└── tsconfig.json
```

### Connectors (`packages/connectors/`)

```
packages/connectors/
├── src/
│   ├── base.ts                         # BaseConnector abstract class
│   ├── types.ts                        # ConnectorDocument interface
│   ├── notion/index.ts                 # Notion connector
│   ├── google-drive/index.ts           # Google Drive connector
│   └── direct-upload/index.ts          # Direct upload handler
├── package.json
└── tsconfig.json
```

---

## Dependencies on Prior Phases

| Dependency                     | Source  | Used By                          |
| ------------------------------ | ------- | -------------------------------- |
| `@ci/types`                    | Phase 1 | All Phase 3 packages             |
| `@ci/db` (schema + client)     | Phase 1 | API services, audit logging      |
| `@ci/core` (RetrievalPipeline) | Phase 1 | Pipeline factory service         |
| `@ci/core` (IngestionPipeline) | Phase 1 | Document service (via BullMQ)    |
| `@ci/vector-store` (Qdrant)    | Phase 2 | Pipeline factory                 |
| `@ci/embeddings` (Cohere v4)   | Phase 2 | Pipeline factory                 |
| `@ci/queue` (BullMQ)           | Phase 2 | Document service, connector sync |
| `@ci/logger` (Pino)            | Phase 1 | All Phase 3 packages             |
| `@ci/auth`                     | Phase 1 | Auth middleware                  |
| `@ci/crypto`                   | Phase 1 | Connector credential encryption  |

---

## Testing Requirements

### Unit Tests (Vitest)

- Each middleware tested in isolation with mock `req`/`res`/`next`
- Each service tested with mocked DB and external dependencies
- SDK methods tested against a mock HTTP server (msw)
- MCP tools tested with mock API responses

### Integration Tests

- Full API request lifecycle: auth -> tenant -> validate -> route -> service -> response
- SDK integration against a running local API server
- Connector credential encryption roundtrip
- Idempotency key deduplication with Redis
- Rate limiting enforcement per plan tier

### E2E Tests

- SDK: `uploadText()` -> wait for indexing -> `query()` -> verify results
- MCP: `retrieve_context` tool returns relevant chunks
- Connector: Notion sync -> documents appear in project -> queryable

### Load Tests (k6)

- `/v1/query` endpoint: target p50 <100ms, p99 <500ms at 100 RPS
- `/v1/documents/upload` endpoint: target 100 docs/min throughput
- Rate limiting: verify enforcement at plan limits
- Idempotency: verify dedup under concurrent identical requests

---

## Risk Assessment

| Risk                                          | Likelihood | Impact | Mitigation                                                              |
| --------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------- |
| Express 5 async error handling edge cases     | Medium     | Medium | Comprehensive error handler tests, wrapper utility for route handlers   |
| Cohere API rate limits during load testing    | High       | Low    | Mock Cohere in load tests, use real API only in integration tests       |
| Notion OAuth complexity                       | Medium     | Medium | Start with personal integration tokens for dev, OAuth for production    |
| SDK bundle size                               | Low        | Medium | Tree-shakeable ESM build, zero runtime dependencies beyond native fetch |
| MCP protocol breaking changes                 | Low        | High   | Pin @modelcontextprotocol/sdk version, monitor MCP spec updates         |
| Cross-origin issues in dashboard -> API calls | Medium     | Low    | Comprehensive CORS middleware with per-environment config               |

---

## Success Criteria

1. A developer can `npm install contextinject`, configure an API key, and execute a query in under 3 minutes
2. All 14 middleware layers pass unit tests with >90% branch coverage
3. The OpenAPI spec validates against the OpenAPI 3.1 specification
4. MCP server passes MCP Inspector validation for all 4 tools
5. Notion connector successfully syncs 100+ pages in under 5 minutes
6. API handles 100 concurrent requests without degradation
7. SDK package is <50KB minified+gzipped with zero external dependencies

---

## Related Documentation

- [01-api-server.md](./01-api-server.md) — Express 5 API server details
- [02-typescript-sdk.md](./02-typescript-sdk.md) — SDK design and implementation
- [03-mcp-server.md](./03-mcp-server.md) — MCP server for AI agents
- [04-connectors.md](./04-connectors.md) — Data source connector system
- [Phase 4: Quality Layer](../phase-04-quality/README.md) — Next phase
