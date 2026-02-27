# ContextInject

## Project Overview

ContextInject is a production-grade RAG context injection platform ("Stripe for RAG").
Multi-tenant SaaS that provides document ingestion, vector storage, intelligent retrieval, and context assembly via REST API, SDK, and MCP server.

## Tech Stack

- **Runtime**: Node.js 22, TypeScript 5.7+
- **Monorepo**: pnpm workspaces + Turborepo
- **Database**: PostgreSQL 17 + pgvector (Drizzle ORM)
- **Vector DB**: Qdrant 1.12
- **Cache/Queue**: Redis 7.2 (BullMQ)
- **API**: Express 5
- **Dashboard**: Next.js 16 + shadcn/ui
- **Testing**: Vitest
- **CI**: GitHub Actions

## Package Structure

- `packages/` — Shared libraries (`@contextinject/<name>`)
- `apps/` — Deployable applications (api, worker, dashboard, mcp-server)
- `infra/` — Docker, Kubernetes, Terraform configs

## Conventions

### Code Style

- ESLint + Prettier enforced via pre-commit hook
- Conventional commits enforced via commitlint
- Type imports: `import type { Foo } from "./foo"`
- All packages export from `src/index.ts`

### Naming

- Package scope: `@contextinject/`
- Files: kebab-case (`api-key-validator.ts`)
- Types/Interfaces: PascalCase, prefix interfaces with `I` only for contracts (`IVectorStore`)
- Constants: UPPER_SNAKE_CASE
- Functions/variables: camelCase

### Architecture Rules

- **Tenant isolation is mandatory**: Every DB query and vector search MUST include tenantId
- **No wildcard CORS**: CORS_ORIGINS must be explicitly configured
- **Filter allowlist**: Only whitelisted fields allowed in query filters
- **Two-phase commit**: Vectors marked `isDeleted: true` until Postgres tx commits
- **Circuit breakers**: All external service calls (Cohere, Qdrant, connectors) use opossum

### Database

- Drizzle ORM for schema + migrations
- RLS policies on ALL tenant-scoped tables
- Connection pool: max 20 (API), max 10 (workers)
- Always use parameterized queries

### Testing

- Unit tests: `*.test.ts` co-located with source
- Integration tests: `tests/integration/`
- 80% minimum coverage, 90% for auth/core packages
- Use Vitest with `vitest.config.ts` per package

### Security

- API keys validated with lru-cache (always check expiresAt)
- AES-256-GCM for encryption at rest
- PII redacted from logs
- No secrets in code — use .env

## Worktree Directory

.worktrees/
