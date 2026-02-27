# Phase 1.01: Project Setup

> Monorepo initialization, Docker Compose, CI/CD scaffolding, and developer tooling.

---

## Objectives

1. Initialize pnpm monorepo with Turborepo build orchestration
2. Scaffold all packages and apps with correct dependency graph
3. Set up Docker Compose for local development (PostgreSQL 17, Redis 7.2, Qdrant)
4. Configure TypeScript, ESLint, Prettier, Husky, and commitlint
5. Create GitHub Actions CI pipeline

## Deliverables

- Root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- All package directories with `package.json` and `tsconfig.json`
- `infra/docker/docker-compose.yml` with all services
- `.github/workflows/ci.yml` pipeline
- `.env.example` template
- ESLint flat config, Prettier config, Husky hooks

---

## Root Configuration Files

### `package.json`

```json
{
  "name": "ragcontext",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "lint": "turbo run lint",
    "lint:fix": "turbo run lint:fix",
    "format": "prettier --write \"**/*.{ts,tsx,json,md}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,json,md}\"",
    "typecheck": "turbo run typecheck",
    "db:migrate": "pnpm --filter @ci/db migrate",
    "db:generate": "pnpm --filter @ci/db generate",
    "db:seed": "pnpm --filter @ci/db seed",
    "db:studio": "pnpm --filter @ci/db studio",
    "clean": "turbo run clean && rm -rf node_modules",
    "prepare": "husky"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "husky": "^9.0.0",
    "@commitlint/cli": "^19.0.0",
    "@commitlint/config-conventional": "^19.0.0",
    "lint-staged": "^15.0.0",
    "prettier": "^3.3.0",
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "inputs": ["src/**/*.ts", "tsconfig.json"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["src/**/*.ts", "tests/**/*.ts"]
    },
    "test:integration": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "lint": {
      "inputs": ["src/**/*.ts", "eslint.config.mjs"]
    },
    "lint:fix": {
      "inputs": ["src/**/*.ts"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**/*.ts", "tsconfig.json"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false
  },
  "exclude": ["node_modules", "dist"]
}
```

### `vitest.workspace.ts`

```typescript
import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"]);
```

---

## Package Scaffolding

Each package follows a consistent structure:

```
packages/<name>/
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Standard package `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

### Standard package `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

### Package Dependency Graph (build order)

```
@ci/types          (no deps)
@ci/config         (depends on: zod)
@ci/errors         (depends on: @ci/types)
@ci/logger         (depends on: pino, @ci/config)
@ci/crypto         (depends on: @ci/config — Node.js crypto only)
@ci/db             (depends on: @ci/types, @ci/config, drizzle-orm, postgres)
@ci/auth           (depends on: @ci/db, @ci/crypto, @ci/errors, @ci/types)
@ci/queue          (depends on: @ci/types, @ci/config, bullmq)
@ci/vector-store   (depends on: @ci/types, @ci/errors, @qdrant/js-client-rest)
@ci/embeddings     (depends on: @ci/types, @ci/errors, @ci/config, cohere-ai)
@ci/chunker        (depends on: @ci/types, gpt-tokenizer)
@ci/parser         (depends on: @ci/types, @ci/errors)
@ci/reranker       (depends on: @ci/types, @ci/errors, cohere-ai)
@ci/compressor     (depends on: @ci/types)
@ci/evaluator      (depends on: @ci/types)
@ci/cache          (depends on: @ci/types, @ci/embeddings, ioredis)
@ci/connectors     (depends on: @ci/types, @ci/crypto, various API clients)
@ci/core           (depends on: most @ci/* packages)
@ci/sdk            (no @ci/ deps — uses native fetch only)
```

---

## Docker Compose Setup

### `infra/docker/docker-compose.yml`

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    container_name: ci_postgres
    environment:
      POSTGRES_DB: context_inject
      POSTGRES_USER: ci_user
      POSTGRES_PASSWORD: ci_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-extensions.sql:/docker-entrypoint-initdb.d/01-extensions.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ci_user -d context_inject"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7.2-alpine
    container_name: ci_redis
    command: >
      redis-server
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --requirepass ci_redis_password
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "ci_redis_password", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  qdrant:
    image: qdrant/qdrant:latest
    container_name: ci_qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__HTTP_PORT: 6333
      QDRANT__SERVICE__GRPC_PORT: 6334
      QDRANT__LOG_LEVEL: INFO

volumes:
  postgres_data:
  redis_data:
  qdrant_data:
```

### `infra/docker/init-extensions.sql`

```sql
-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

---

## Environment Configuration

### `.env.example`

```bash
# ─── Database ────────────────────────────────────────────────
DATABASE_URL=postgresql://ci_user:ci_password@localhost:5432/context_inject
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20

# ─── Redis ───────────────────────────────────────────────────
REDIS_URL=redis://:ci_redis_password@localhost:6379

# ─── Vector Store ────────────────────────────────────────────
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=

# ─── External APIs ──────────────────────────────────────────
COHERE_API_KEY=
OPENAI_API_KEY=

# ─── Security ────────────────────────────────────────────────
ENCRYPTION_KEY=                 # 32-byte hex string for AES-256-GCM
HMAC_SECRET=                    # HMAC-SHA256 signing secret
JWT_SECRET=                     # JWT signing secret (HS256) or RS256 private key path
JWT_EXPIRY=24h

# ─── Connector OAuth ────────────────────────────────────────
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=

# ─── Application ─────────────────────────────────────────────
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
API_BASE_URL=http://localhost:3000

# ─── Observability ───────────────────────────────────────────
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=http://localhost:3001
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

---

## ESLint Configuration

### `eslint.config.mjs`

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.config.*"],
  },
);
```

### `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

---

## Husky + Commitlint

### `.husky/pre-commit`

```bash
npx lint-staged
```

### `.husky/commit-msg`

```bash
npx --no -- commitlint --edit $1
```

### `commitlint.config.js`

```javascript
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "types",
        "db",
        "auth",
        "errors",
        "logger",
        "config",
        "crypto",
        "core",
        "vector-store",
        "embeddings",
        "chunker",
        "parser",
        "reranker",
        "compressor",
        "evaluator",
        "cache",
        "queue",
        "connectors",
        "sdk",
        "api",
        "worker",
        "dashboard",
        "mcp-server",
        "infra",
        "ci",
        "docs",
      ],
    ],
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
  },
};
```

---

## CI/CD Pipeline

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm format:check

  test:
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    services:
      postgres:
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_DB: ci_test
          POSTGRES_USER: ci_user
          POSTGRES_PASSWORD: ci_password
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U ci_user -d ci_test"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7.2-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      qdrant:
        image: qdrant/qdrant:latest
        ports: ["6333:6333"]

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm db:migrate
        env:
          DATABASE_URL: postgresql://ci_user:ci_password@localhost:5432/ci_test
      - run: pnpm test
        env:
          DATABASE_URL: postgresql://ci_user:ci_password@localhost:5432/ci_test
          REDIS_URL: redis://localhost:6379
          QDRANT_URL: http://localhost:6333
          NODE_ENV: test
```

---

## Critical File Paths

| File                               | Purpose                            |
| ---------------------------------- | ---------------------------------- |
| `package.json`                     | Root monorepo config               |
| `pnpm-workspace.yaml`              | Workspace package declarations     |
| `turbo.json`                       | Task dependency graph and caching  |
| `tsconfig.base.json`               | Shared TypeScript compiler options |
| `vitest.workspace.ts`              | Test runner workspace config       |
| `eslint.config.mjs`                | Linting rules                      |
| `.prettierrc`                      | Code formatting rules              |
| `commitlint.config.js`             | Commit message format enforcement  |
| `.husky/pre-commit`                | Pre-commit lint-staged hook        |
| `.husky/commit-msg`                | Commit message validation hook     |
| `infra/docker/docker-compose.yml`  | Local dev services                 |
| `infra/docker/init-extensions.sql` | PostgreSQL extension setup         |
| `.env.example`                     | Environment variable template      |
| `.github/workflows/ci.yml`         | CI pipeline definition             |

---

## Testing Requirements

- `pnpm install` completes without errors
- `pnpm build` produces `dist/` in every package
- `docker compose -f infra/docker/docker-compose.yml up -d` starts all services
- PostgreSQL accepts connections and has pgvector extension enabled
- Redis responds to PING
- Qdrant REST API responds at `http://localhost:6333/collections`
- `pnpm lint` passes with no errors
- `pnpm format:check` passes
- Husky pre-commit hook runs lint-staged on commit
- Commitlint rejects non-conventional commit messages

---

_Related: [Phase 1 Overview](./README.md) | [Type System](./02-type-system.md)_
