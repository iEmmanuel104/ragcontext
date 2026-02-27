# 01 — API Server

> **Package**: `apps/api` | **Framework**: Express 5.x (native async error handling)
> **Entry Point**: `apps/api/src/server.ts` | **App Factory**: `apps/api/src/app.ts`

---

## Overview

The API server is the primary interface to ContextInject. It is an Express 5 application using the app factory pattern (`createApp()`) that layers 14 middleware functions in a specific order, routes requests through 7 route groups under `/v1/`, and delegates business logic to 6 service modules.

Express 5 is chosen over Express 4 for its **native async error handling** — `async` route handlers that throw or reject automatically propagate to the error handler without requiring `try/catch` wrappers or `express-async-errors`.

---

## App Factory Pattern

The `createApp()` function creates and configures the Express application, enabling multiple instances for testing and the ability to inject dependencies.

```typescript
// apps/api/src/app.ts
import express, { type Express } from "express";
import { requestIdMiddleware } from "./middleware/request-id";
import { corsMiddleware } from "./middleware/cors";
import { compressionMiddleware } from "./middleware/compression";
import { loggerMiddleware } from "./middleware/logger";
import { metricsMiddleware } from "./middleware/metrics";
import { authMiddleware } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { apiVersionMiddleware } from "./middleware/api-version";
import { auditLogMiddleware } from "./middleware/audit-log";
import { errorHandler } from "./middleware/error-handler";
import { healthRouter } from "./routes/v1/health";
import { webhooksRouter } from "./routes/v1/webhooks";
import { queryRouter } from "./routes/v1/query";
import { documentsRouter } from "./routes/v1/documents";
import { projectsRouter } from "./routes/v1/projects";
import { connectorsRouter } from "./routes/v1/connectors";
import { analyticsRouter } from "./routes/v1/analytics";

export function createApp(): Express {
  const app = express();

  // --- Global middleware (applied to all routes) ---
  app.use(requestIdMiddleware); // 1. Inject X-Request-Id
  app.use(corsMiddleware); // 2. CORS headers
  app.use(compressionMiddleware); // 3. Brotli/gzip compression
  app.use(express.json({ limit: "50mb" }));
  app.use(loggerMiddleware); // 4. Pino request/response logging
  app.use(metricsMiddleware); // 5. OpenTelemetry HTTP metrics

  // --- Public routes (no auth) ---
  app.use("/health", healthRouter);
  app.use("/webhooks", webhooksRouter);

  // --- Protected routes ---
  app.use("/v1", apiVersionMiddleware); // 6. API version validation
  app.use("/v1", authMiddleware); // 7. API key authentication
  app.use("/v1", tenantMiddleware); // 8. Tenant hydration + plan limits
  app.use("/v1", rateLimitMiddleware); // 9. Sliding window rate limiting
  app.use("/v1", idempotencyMiddleware); // 10. Idempotency-Key dedup
  app.use("/v1", auditLogMiddleware); // 11. Immutable audit logging

  app.use("/v1/query", queryRouter);
  app.use("/v1/documents", documentsRouter);
  app.use("/v1/projects", projectsRouter);
  app.use("/v1/connectors", connectorsRouter);
  app.use("/v1/analytics", analyticsRouter);

  // --- Error handler (must be last) ---
  app.use(errorHandler); // 14. Centralized error handling

  return app;
}
```

---

## Middleware Stack (14 Layers)

Middleware runs in the order listed below. The ordering is critical — for example, `request-id` must run before `logger` so that logs include the request ID, and `auth` must run before `tenant` so that tenant hydration has a `tenantId`.

### 1. `request-id.ts` — X-Request-Id Injection and Propagation

Injects a unique request ID into every request and propagates it to downstream services via headers and AsyncLocalStorage.

```typescript
// apps/api/src/middleware/request-id.ts
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers["x-request-id"] as string) ?? randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  requestContext.run({ requestId }, () => next());
}
```

**Behavior**:

- Accepts an existing `X-Request-Id` header from the client (for end-to-end tracing)
- Generates a UUIDv4 if no header is present
- Stores the ID in `AsyncLocalStorage` for access in any downstream code
- Echoes the ID back in the response header

### 2. `cors.ts` — Configurable Per-Environment CORS

```typescript
// apps/api/src/middleware/cors.ts
import cors from "cors";
import type { CorsOptions } from "cors";

const corsConfigs: Record<string, CorsOptions> = {
  development: {
    origin: true,
    credentials: true,
  },
  staging: {
    origin: ["https://staging.contextinject.ai", "https://staging-dashboard.contextinject.ai"],
    credentials: true,
  },
  production: {
    origin: ["https://contextinject.ai", "https://dashboard.contextinject.ai"],
    credentials: true,
    maxAge: 86400,
  },
};

const env = process.env.NODE_ENV ?? "development";
export const corsMiddleware = cors(corsConfigs[env] ?? corsConfigs.development);
```

**Behavior**:

- Development: all origins allowed for local development
- Staging/Production: whitelist of allowed origins
- Credentials enabled for dashboard cookie-based auth
- Preflight caching of 24 hours in production to reduce OPTIONS requests

### 3. `compression.ts` — Brotli/Gzip Response Compression

```typescript
// apps/api/src/middleware/compression.ts
import compression from "compression";
import type { Request, Response } from "express";

export const compressionMiddleware = compression({
  level: 6,
  threshold: 1024,
  filter: (req: Request, res: Response) => {
    if (req.headers.accept === "text/event-stream") return false;
    return compression.filter(req, res);
  },
});
```

**Behavior**:

- Uses brotli when the client supports it, falls back to gzip
- Only compresses responses larger than 1KB
- Disables compression for SSE streams
- Compression level 6 balances CPU usage with compression ratio

### 4. `logger.ts` — Pino Structured Request Logging

```typescript
// apps/api/src/middleware/logger.ts
import pino from "pino";
import pinoHttp from "pino-http";
import { requestContext } from "./request-id";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  redact: ["req.headers.authorization", "req.headers.cookie"],
});

export const loggerMiddleware = pinoHttp({
  logger,
  customProps: () => {
    const ctx = requestContext.getStore();
    return { requestId: ctx?.requestId };
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      tenantId: req.raw?.tenantId,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

export { logger };
```

**Behavior**:

- Structured JSON logging in production, pretty-printed in development
- Automatically redacts `authorization` and `cookie` headers
- Includes `requestId` from `AsyncLocalStorage` in every log line

### 5. `metrics.ts` — OpenTelemetry HTTP Metrics

```typescript
// apps/api/src/middleware/metrics.ts
import { metrics } from "@opentelemetry/api";
import type { Request, Response, NextFunction } from "express";

const meter = metrics.getMeter("contextinject-api");

const httpRequestDuration = meter.createHistogram("http_request_duration_ms", {
  description: "HTTP request duration in milliseconds",
  unit: "ms",
});

const httpRequestsTotal = meter.createCounter("http_requests_total", {
  description: "Total HTTP requests",
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = performance.now();

  res.on("finish", () => {
    const duration = performance.now() - startTime;
    const labels = {
      method: req.method,
      route: req.route?.path ?? req.path,
      status_code: String(res.statusCode),
    };
    httpRequestDuration.record(duration, labels);
    httpRequestsTotal.add(1, labels);
  });

  next();
}
```

### 6. `api-version.ts` — URL-Based Versioning with Deprecation Headers

```typescript
// apps/api/src/middleware/api-version.ts
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";

const SUPPORTED_VERSIONS = ["v1"];
const DEPRECATED_VERSIONS: Record<string, string> = {};

export function apiVersionMiddleware(req: Request, res: Response, next: NextFunction) {
  const version = req.baseUrl.split("/")[1];

  if (!SUPPORTED_VERSIONS.includes(version) && !DEPRECATED_VERSIONS[version]) {
    throw new AppError(
      `API version '${version}' is not supported. Use: ${SUPPORTED_VERSIONS.join(", ")}`,
      400,
      "UNSUPPORTED_API_VERSION",
    );
  }

  if (DEPRECATED_VERSIONS[version]) {
    res.setHeader("Deprecation", `date="${DEPRECATED_VERSIONS[version]}"`);
    res.setHeader("Sunset", DEPRECATED_VERSIONS[version]);
    res.setHeader("Link", `</v1${req.path}>; rel="successor-version"`);
  }

  req.apiVersion = version;
  next();
}
```

**Behavior**:

- Extracts version from URL path (`/v1/...`)
- Returns 400 for unsupported versions
- Adds `Deprecation`, `Sunset`, and `Link` headers for deprecated versions per RFC 8594

### 7. `auth.ts` — API Key Validation with SHA-256 Hash Lookup and LRU Cache

The authentication middleware validates API keys by hashing the raw key with SHA-256 and looking it up in the `api_keys` table. An in-memory LRU cache (max 1000 entries, 5-minute TTL) avoids hitting the database on every request.

Key behavior:

- Keys must start with `ci_` prefix
- SHA-256 hash of raw key is used for database lookup (raw keys are never stored)
- LRU cache with TTL avoids database round-trips
- `lastUsedAt` is updated asynchronously (fire-and-forget)
- Returns 401 for invalid, expired, or missing keys

### 8. `tenant.ts` — Tenant Hydration and Plan Limits

Loads the full tenant record from PostgreSQL using the `tenantId` set by auth middleware. Attaches plan limits to the request for use by rate limiting and resource enforcement middleware.

Plan limits:

- Free: 10K pages, 5K retrievals/mo, 1 project, 1 user
- Starter: 25K pages, 50K retrievals/mo, 3 projects, 3 users
- Pro: 100K pages, unlimited retrievals (fair use), unlimited projects, 10 users
- Enterprise: Unlimited everything

### 9. `validate.ts` — Zod Schema Validation

Provides `validateBody()`, `validateQuery()`, and `validateParams()` middleware factories that accept a Zod schema and validate the corresponding request property. On failure, returns a 400 with structured error details (path + message per field).

### 10. `rate-limit.ts` — Sliding Window Per API Key

Uses Redis sorted sets for a sliding window rate limiter. Each request adds a timestamped entry; entries older than the window are removed. The count of remaining entries determines if the limit is exceeded.

Sets standard `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers on every response.

### 11. `idempotency.ts` — Redis-Backed Idempotency-Key Dedup

For POST/PUT/PATCH requests that include an `Idempotency-Key` header, the middleware checks Redis for a cached response. If found, it returns the cached response immediately. If not found, it captures the response, stores it in Redis with a 24-hour TTL, and returns it to the client.

This prevents duplicate operations when clients retry on network timeouts.

### 12. `audit-log.ts` — Immutable Append-Only Audit Logging

Records all mutating operations (POST, PUT, PATCH, DELETE) to the `audit_logs` table. Each entry includes tenant ID, API key ID, action, resource type, resource ID, request ID, IP address, user agent, and status code.

Logging is fire-and-forget (never fails the request) and the table is append-only (no UPDATE or DELETE operations allowed at the application level).

### 13. `require-scope.ts` — API Key Scope Checking

A middleware factory that accepts required scopes and checks them against the API key's scopes. The `admin` scope grants access to all resources. Returns 403 if the key lacks the required scope.

Available scopes: `documents:read`, `documents:write`, `query`, `admin`.

### 14. `error-handler.ts` — Centralized Error Handling

Catches all errors (both thrown and rejected promises in Express 5). Handles three error types:

- `AppError`: known business errors with status code and error code
- `ZodError`: validation errors that escaped the validate middleware
- Unknown errors: logged with full stack trace, returns generic 500

All error responses include the `requestId` for correlation.

---

## Route Groups (7)

### `/v1/query` — Retrieval Endpoint

**`POST /v1/query`** — The core endpoint. Accepts a query string and project ID, runs the full retrieval pipeline (cache check, embedding, vector search, reranking, compression, quality scoring), and returns ranked chunks with assembled context and a quality score.

Supports SSE streaming when `stream: true` is passed, sending pipeline step updates in real time.

Required scope: `query`

### `/v1/documents` — Document CRUD and Upload

- **`POST /v1/documents/upload`** — Upload file (PDF, DOCX, HTML, TXT, MD) via multipart. Returns 202 with document ID and `processing` status. Requires `documents:write`.
- **`POST /v1/documents/text`** — Upload raw text content as JSON body. Requires `documents:write`.
- **`GET /v1/documents`** — List documents with cursor-based pagination. Filterable by `projectId` and `status`. Requires `documents:read`.
- **`GET /v1/documents/:id`** — Get document details including processing status. Requires `documents:read`.
- **`DELETE /v1/documents/:id`** — Soft-delete document, cascade to chunks and vectors. Requires `documents:write`.

### `/v1/projects` — Project CRUD

- **`POST /v1/projects`** — Create project (enforces plan limits on count). Requires `admin`.
- **`GET /v1/projects`** — List tenant projects. Requires `documents:read`.
- **`GET /v1/projects/:id`** — Get project details with pipeline config. Requires `documents:read`.
- **`PATCH /v1/projects/:id`** — Update project settings. Requires `admin`.
- **`DELETE /v1/projects/:id`** — Delete project (cascades to all documents). Requires `admin`.

### `/v1/connectors` — Connector Management

- **`POST /v1/connectors`** — Create connector with encrypted credentials. Requires `admin`.
- **`GET /v1/connectors`** — List connectors by project. Requires `documents:read`.
- **`POST /v1/connectors/:id/sync`** — Trigger manual sync. Requires `admin`.
- **`DELETE /v1/connectors/:id`** — Remove connector and cancel sync schedule. Requires `admin`.

### `/v1/webhooks` — Connector Webhook Receivers (Public)

Receives webhook events from connected data sources (Notion, Google Drive). Each connector type has its own handler with source-specific signature verification (HMAC-SHA256). No API key auth required; webhooks use their own authentication.

### `/v1/analytics` — Query Analytics

- **`GET /v1/analytics`** — Aggregated analytics (query count, avg latency, cache hit rate, quality scores). Requires `documents:read`.
- **`GET /v1/analytics/queries`** — Recent query log with cursor-based pagination. Requires `admin`.
- **`GET /v1/analytics/quality`** — Quality score distribution over time. Requires `documents:read`.

### `/health` — Health Check (Public, No Auth)

- **`GET /health`** — Returns `{ status: 'ok' }` with dependency checks (Postgres, Redis, Qdrant)
- **`GET /health/ready`** — Readiness probe for Kubernetes (all dependencies healthy)
- **`GET /health/live`** — Liveness probe for Kubernetes (process is running)

---

## Service Modules (6)

### `pipeline-factory.ts`

Creates a `RetrievalPipeline` instance for a specific tenant and project, injecting the correct vector store collection, embedding provider, reranker, compressor, cache, and evaluator. Caches pipeline instances per tenant+project pair for reuse.

### `document-service.ts`

Handles document CRUD operations. On upload: creates a document record in PostgreSQL, computes the SHA-256 content hash for deduplication, and enqueues a BullMQ `ingest-document` job. On delete: soft-deletes document, deletes chunks from Postgres, deletes vectors from Qdrant, invalidates cache entries.

### `project-service.ts`

Manages project CRUD with plan limit enforcement. Manages pipeline configuration per project (chunking strategy, embedding model, retrieval parameters).

### `connector-service.ts`

Creates connector records with AES-256-GCM encrypted credentials (via `@ci/crypto`). Schedules BullMQ recurring sync jobs. Handles OAuth token refresh.

### `billing-service.ts`

Records usage events (page ingested, retrieval run, storage consumed). Enforces hard limits for Free tier. Sends usage data to Stripe Metering for paid tiers. See [Phase 5: Billing](../phase-05-production/02-billing.md).

### `analytics-service.ts`

Aggregates data from `query_logs` table. Computes metrics: queries/day, avg latency, p50/p95/p99 latency, cache hit rate, avg quality score. Uses materialized views for performance on large datasets.

---

## Server Bootstrap with Graceful Shutdown

```typescript
// apps/api/src/server.ts
import { createApp } from "./app";
import { initTelemetry } from "./telemetry/otel";
import { logger } from "./middleware/logger";

async function bootstrap() {
  await initTelemetry();
  const app = createApp();
  const port = parseInt(process.env.PORT ?? "3000");

  const server = app.listen(port, () => {
    logger.info({ port }, "API server started");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 30_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
```

---

## OpenAPI Spec Generation

The `apps/api/scripts/generate-openapi.ts` script uses `zod-to-openapi` to convert all Zod validation schemas into OpenAPI 3.1 schema objects. The generated spec is used by:

- The dashboard API playground
- SDK client generation for other languages (Python, Go)
- External documentation hosted on Mintlify or Readme.com

Run with: `pnpm --filter @ci/api generate-openapi`

Output: `apps/api/openapi.json`

---

## Testing Requirements

- Each middleware file must have a corresponding `.test.ts` with over 90% branch coverage
- Integration test: full request lifecycle through all 14 middleware layers
- Load test: 100 concurrent requests through the auth + rate limit path
- Error handler tests: verify all error types return correct status codes
- Idempotency test: concurrent identical POSTs with same key return same response
- Audit log test: verify all mutating operations are logged with correct metadata

---

## Related Documentation

- [Phase 3 README](./README.md) — Phase overview
- [02-typescript-sdk.md](./02-typescript-sdk.md) — SDK that calls this API
- [03-mcp-server.md](./03-mcp-server.md) — MCP server that wraps SDK calls
- [Phase 5: Security Hardening](../phase-05-production/03-security-hardening.md) — Additional security layers
- [Phase 5: Monitoring](../phase-05-production/05-monitoring.md) — Observability details
