# Phase 1: Foundation (Weeks 1-3)

> Monorepo scaffolding, type system, database layer, authentication, and error handling infrastructure.

---

## Objectives

1. Initialize the pnpm + Turborepo monorepo with all package scaffolds
2. Define the complete TypeScript type system shared across all packages
3. Set up PostgreSQL 17 with pgvector 0.8+, Drizzle ORM, and migrations
4. Build authentication (API keys, JWT, OAuth PKCE, RBAC)
5. Implement error hierarchy, structured logging, config validation, and encryption utilities
6. Docker Compose for local development (PostgreSQL, Redis, Qdrant)
7. CI/CD scaffolding with GitHub Actions

## Deliverables

| Deliverable       | Package              | Description                                                           |
| ----------------- | -------------------- | --------------------------------------------------------------------- |
| Monorepo skeleton | Root                 | pnpm workspaces, Turborepo, tsconfig, ESLint, Prettier, Husky         |
| Type system       | `@ci/types`          | All shared interfaces: Tenant, Document, Chunk, Pipeline, Query, etc. |
| Database layer    | `@ci/db`             | Drizzle schema, migrations, connection pool, RLS policies, seed data  |
| Auth system       | `@ci/auth`           | API key gen/validation, JWT, OAuth 2.0 PKCE, RBAC, Argon2id           |
| Error handling    | `@ci/errors`         | AppError hierarchy, circuit breaker, retry utilities                  |
| Logging           | `@ci/logger`         | Pino structured logging with PII redaction transport                  |
| Config            | `@ci/config`         | Zod-validated environment variables                                   |
| Crypto            | `@ci/crypto`         | AES-256-GCM encryption, HMAC-SHA256, key rotation                     |
| Docker Compose    | `infra/docker/`      | PostgreSQL 17 + pgvector, Redis 7.2, Qdrant latest                    |
| CI pipeline       | `.github/workflows/` | Build, lint, test on PR; deploy on main merge                         |

## Dependencies

- **External:** Node.js 22 LTS, pnpm 9+, Docker 25+
- **No upstream phase dependencies** — this is the foundation layer
- **Downstream:** Phase 2 (Core Pipeline) depends on all Phase 1 deliverables

## Sub-Documents

| #   | Document                                 | Focus                                                  |
| --- | ---------------------------------------- | ------------------------------------------------------ |
| 01  | [Project Setup](./01-project-setup.md)   | Monorepo init, Docker, CI/CD, tooling                  |
| 02  | [Type System](./02-type-system.md)       | `@ci/types` complete interface definitions             |
| 03  | [Database Layer](./03-database-layer.md) | `@ci/db` schema, migrations, RLS, pooling              |
| 04  | [Auth System](./04-auth-system.md)       | `@ci/auth` API keys, JWT, OAuth, RBAC                  |
| 05  | [Error Handling](./05-error-handling.md) | `@ci/errors`, `@ci/logger`, `@ci/config`, `@ci/crypto` |

## Exit Criteria

- [ ] `pnpm install && pnpm build` completes with zero errors across all packages
- [ ] Docker Compose starts PostgreSQL 17, Redis 7.2, and Qdrant in <30s
- [ ] Database migrations apply idempotently; `pnpm db:migrate` is repeatable
- [ ] RLS policies verified: Tenant A cannot read Tenant B's data
- [ ] API key generation produces `ci_live_` / `ci_test_` prefixed keys
- [ ] API key validation completes in <5ms (cached path)
- [ ] JWT issue/verify roundtrip works; expired tokens rejected
- [ ] AppError hierarchy serializes correctly to JSON error responses
- [ ] Circuit breaker transitions through CLOSED -> OPEN -> HALF-OPEN states
- [ ] Pino logger redacts PII fields (email, password, apiKey)
- [ ] Zod config validation rejects missing required env vars with clear messages
- [ ] AES-256-GCM encrypt/decrypt roundtrip preserves data
- [ ] Unit test coverage >80% across auth, errors, crypto packages
- [ ] CI pipeline passes on a clean PR

## Week-by-Week Breakdown

### Week 1

- Monorepo initialization (pnpm, Turborepo, tsconfig.base.json)
- `@ci/types` — complete type system
- `@ci/config` — Zod-validated environment variables
- `@ci/logger` — Pino structured logging
- Docker Compose (PostgreSQL 17 + pgvector 0.8+, Redis 7.2, Qdrant)
- ESLint + Prettier + Husky + commitlint

### Week 2

- `@ci/db` — Complete Drizzle schema (10 tables)
- Migrations (initial + pgvector extension + RLS policies)
- Connection pooling with pg Pool
- Seed data script
- `@ci/crypto` — AES-256-GCM, HMAC-SHA256

### Week 3

- `@ci/auth` — API keys, JWT, RBAC
- `@ci/errors` — Error hierarchy, circuit breaker, retry
- CI/CD pipeline (.github/workflows/ci.yml)
- Integration tests: auth flow, DB operations, encryption roundtrip
- Documentation review and cross-references

## Risk Assessment

| Risk                                     | Impact | Mitigation                                                            |
| ---------------------------------------- | ------ | --------------------------------------------------------------------- |
| pgvector 0.8+ Docker image not available | Medium | Build custom image from pgvector source; fallback to 0.7 temporarily  |
| Drizzle ORM API changes (0.x semver)     | Medium | Pin exact version; test migrations on upgrade                         |
| OAuth PKCE complexity for connectors     | Low    | Implement direct-upload first; OAuth flows in Phase 3 with connectors |
| RLS policy performance overhead          | Low    | Benchmark with 100K rows; RLS on indexed tenant_id column is fast     |

---

_Related: [Master Plan](../../MASTER_PLAN.md) | [Phase 2: Core Pipeline](../phase-02-core-pipeline/README.md)_
