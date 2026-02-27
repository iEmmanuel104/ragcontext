# Phase 1.03: Database Layer

> `@ci/db` — Drizzle ORM schema, migrations, connection pooling, RLS, and seed data.

---

## Objectives

1. Define the complete PostgreSQL 17 schema using Drizzle ORM
2. Enable pgvector 0.8+ extension for vector operations
3. Implement connection pooling with pg Pool
4. Set up Row-Level Security (RLS) for multi-tenant isolation
5. Create zero-downtime migration strategy with Drizzle Kit
6. Build seed data scripts for development

## Deliverables

- `packages/db/src/schema/` — Complete table definitions (10+ tables)
- `packages/db/src/client.ts` — Connection pool + Drizzle instance
- `packages/db/src/migrate.ts` — Migration runner
- `packages/db/src/seed.ts` — Development seed data
- `packages/db/drizzle/` — Generated migration SQL files
- `packages/db/drizzle.config.ts` — Drizzle Kit configuration

---

## Package Structure

```
packages/db/
├── src/
│   ├── schema/
│   │   ├── index.ts          # Re-exports all tables
│   │   ├── enums.ts          # PostgreSQL enum definitions
│   │   ├── tenants.ts        # tenants table
│   │   ├── users.ts          # users table
│   │   ├── api-keys.ts       # api_keys table
│   │   ├── projects.ts       # projects table
│   │   ├── connectors.ts     # connectors table
│   │   ├── documents.ts      # documents table
│   │   ├── chunks.ts         # chunks table
│   │   ├── query-logs.ts     # query_logs table
│   │   ├── usage-events.ts   # usage_events table
│   │   ├── conversations.ts  # conversations table
│   │   └── audit-logs.ts     # audit_logs table
│   ├── client.ts             # Pool + Drizzle instance
│   ├── migrate.ts            # Migration runner
│   ├── seed.ts               # Development seed data
│   └── index.ts              # Package entry point
├── drizzle/                  # Generated migration files
├── drizzle.config.ts         # Drizzle Kit config
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### `packages/db/package.json`

```json
{
  "name": "@ci/db",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./schema": { "types": "./dist/schema/index.d.ts", "import": "./dist/schema/index.js" }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "migrate": "tsx src/migrate.ts",
    "generate": "drizzle-kit generate",
    "seed": "tsx src/seed.ts",
    "studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@ci/types": "workspace:*",
    "@ci/config": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.0.0"
  }
}
```

---

## Schema Definitions

### `enums.ts` — PostgreSQL Enum Types

```typescript
import { pgEnum } from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "starter", "pro", "enterprise"]);
export const regionEnum = pgEnum("region", ["us", "eu", "apac"]);
export const roleEnum = pgEnum("role", ["owner", "admin", "member", "viewer"]);
export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "processing",
  "embedding",
  "indexed",
  "failed",
  "deleted",
]);
export const connectorTypeEnum = pgEnum("connector_type", [
  "notion",
  "slack",
  "gmail",
  "github",
  "confluence",
  "jira",
  "sharepoint",
  "google-drive",
  "web-crawler",
  "direct-upload",
]);
export const connectorStatusEnum = pgEnum("connector_status", [
  "active",
  "paused",
  "error",
  "disconnected",
]);
export const apiKeyEnvEnum = pgEnum("api_key_env", ["live", "test"]);
```

### `tenants.ts`

```typescript
import { pgTable, uuid, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { planEnum, regionEnum } from "./enums.js";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 63 }).notNull().unique(),
  plan: planEnum("plan").default("free").notNull(),
  region: regionEnum("region").default("us").notNull(),
  settings: jsonb("settings").notNull().default({}),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### `users.ts`

```typescript
import { pgTable, uuid, varchar, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { roleEnum } from "./enums.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: roleEnum("role").default("member").notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("users_tenant_idx").on(t.tenantId),
    emailIdx: index("users_email_idx")
      .on(t.tenantId, t.email)
      .where(sql`email_verified = true`),
  }),
);
```

### `api-keys.ts`

```typescript
import { pgTable, uuid, varchar, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { apiKeyEnvEnum } from "./enums.js";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(), // SHA-256 hex
    prefix: varchar("prefix", { length: 20 }).notNull(), // "ci_live_abc1" for display
    name: varchar("name", { length: 100 }).notNull(),
    scopes: jsonb("scopes").notNull().default([]),
    environment: apiKeyEnvEnum("environment").default("live").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    keyHashIdx: uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    tenantIdx: index("api_keys_tenant_idx").on(t.tenantId),
  }),
);
```

### `documents.ts`

```typescript
import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { projects } from "./projects.js";
import { connectors } from "./connectors.js";
import { documentStatusEnum, connectorTypeEnum } from "./enums.js";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    connectorId: uuid("connector_id").references(() => connectors.id, { onDelete: "set null" }),
    connectorType: connectorTypeEnum("connector_type").notNull(),
    externalId: varchar("external_id", { length: 255 }),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").default(0).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    status: documentStatusEnum("status").default("pending").notNull(),
    chunkCount: integer("chunk_count").default(0).notNull(),
    tokenCount: integer("token_count").default(0).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    accessControl: jsonb("access_control").notNull().default({ isPublic: false }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    tenantProjectIdx: index("documents_tenant_project_idx").on(t.tenantId, t.projectId),
    statusIdx: index("documents_status_idx").on(t.status),
    contentHashIdx: index("documents_content_hash_idx").on(t.tenantId, t.contentHash),
    externalIdIdx: index("documents_external_id_idx").on(t.tenantId, t.externalId),
  }),
);
```

### `chunks.ts`

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  varchar,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { documents } from "./documents.js";

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id").notNull(), // Denormalized for fast RLS filtering
    projectId: uuid("project_id").notNull(), // Denormalized for fast filtering
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    vectorId: varchar("vector_id", { length: 255 }).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    documentIdx: index("chunks_document_idx").on(t.documentId),
    tenantProjectIdx: index("chunks_tenant_project_idx").on(t.tenantId, t.projectId),
    vectorIdIdx: index("chunks_vector_id_idx").on(t.vectorId),
  }),
);
```

### `query-logs.ts`, `usage-events.ts`, `conversations.ts`, `audit-logs.ts`

These tables follow the same pattern. Key additions for `audit_logs`:

```typescript
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id"),
    apiKeyId: uuid("api_key_id"),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 50 }).notNull(),
    resourceId: uuid("resource_id"),
    metadata: jsonb("metadata").notNull().default({}),
    ipAddress: varchar("ip_address", { length: 45 }), // IPv6 max length
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("audit_logs_tenant_idx").on(t.tenantId),
    createdAtIdx: index("audit_logs_created_at_idx").on(t.createdAt),
    actionIdx: index("audit_logs_action_idx").on(t.tenantId, t.action),
  }),
);
```

---

## Connection Pooling

This is a critical gap addressed from the original plan. Without connection pooling, each API request opens a new PostgreSQL connection, causing connection exhaustion under load.

### `client.ts`

```typescript
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";
import { getConfig } from "@ci/config";

const config = getConfig();

// Connection pool configuration
const pool = postgres(config.databaseUrl, {
  max: config.databasePoolMax ?? 20, // Max connections per instance
  idle_timeout: 20, // Close idle connections after 20s
  connect_timeout: 10, // Connection timeout 10s
  max_lifetime: 60 * 30, // Max connection lifetime 30 min
  prepare: true, // Use prepared statements
  onnotice: () => {}, // Suppress NOTICE messages
});

export const db = drizzle(pool, { schema });

// Tenant-scoped query helper: sets RLS context before executing
export async function withTenant<T>(
  tenantId: string,
  fn: (db: typeof db) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Set the tenant context for RLS policies
    await tx.execute(sql`SET LOCAL app.tenant_id = ${tenantId}`);
    return fn(tx as any);
  });
}

// Graceful shutdown
export async function closePool(): Promise<void> {
  await pool.end();
}
```

**Connection pool sizing guidance:**

- API instance (2 vCPU): `max: 20`
- Worker instance: `max: 10` (less concurrent queries)
- Total: Stay under PostgreSQL `max_connections` (default 100)
- Formula: `pool_size_per_instance * instance_count < max_connections - 10` (reserve 10 for admin)

---

## pgvector 0.8+ Setup

The pgvector extension must be enabled before any vector operations. This is done in the Docker init script (`infra/docker/init-extensions.sql`) and verified in migrations.

```sql
-- Migration: 0001_enable_extensions.sql
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector 0.8+
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- Trigram for text search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- UUID generation
```

For tenants using pgvector as their vector store (instead of Qdrant), a vector column is added:

```sql
-- Optional: pgvector embedding column on chunks table
-- Only used when tenant's vector store is pgvector (not Qdrant)
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector(1024);
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
```

---

## Migration Strategy (Zero-Downtime)

### Drizzle Kit Configuration

```typescript
// packages/db/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
```

### Migration Runner

```typescript
// packages/db/src/migrate.ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  // Use a single connection for migrations (not the pool)
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

### Zero-Downtime Migration Rules

1. **Never drop columns** — mark as deprecated, remove in next release
2. **Never rename columns** — add new column, backfill, update code, drop old later
3. **Always add columns as nullable** or with defaults
4. **Create indexes concurrently** — use `CREATE INDEX CONCURRENTLY`
5. **Test migrations** — run against a copy of production data before deploying
6. **Rollback plan** — every migration has a corresponding down migration

---

## Row-Level Security (RLS)

RLS policies ensure tenant data isolation at the database level. Even if application code has a bug, RLS prevents cross-tenant data access.

### RLS Migration

```sql
-- Migration: 0002_enable_rls.sql

-- Enable RLS on all tenant-scoped tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create policies: tenant can only see their own data
-- The app.tenant_id setting is set per-transaction by the application
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON api_keys
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON chunks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Service role bypasses RLS (for migrations, admin operations)
-- The application connects with a role that has RLS enabled
-- Admin operations use a separate role that bypasses RLS
```

### RLS Integration Pattern

Every request that touches tenant data uses the `withTenant` helper:

```typescript
// In route handler:
const docs = await withTenant(req.tenantId, async (db) => {
  return db.select().from(documents).where(eq(documents.projectId, projectId));
  // RLS automatically filters to current tenant — no need for WHERE tenant_id = ...
});
```

---

## Indexes and Performance Optimization

### Index Strategy

| Table        | Index                       | Type   | Purpose                      |
| ------------ | --------------------------- | ------ | ---------------------------- |
| `tenants`    | `slug`                      | UNIQUE | Slug lookups                 |
| `api_keys`   | `key_hash`                  | UNIQUE | API key authentication       |
| `api_keys`   | `tenant_id`                 | B-tree | List keys per tenant         |
| `documents`  | `(tenant_id, project_id)`   | B-tree | Document listing             |
| `documents`  | `status`                    | B-tree | Status-based filtering       |
| `documents`  | `(tenant_id, content_hash)` | B-tree | Change detection dedup       |
| `documents`  | `(tenant_id, external_id)`  | B-tree | Connector sync lookups       |
| `chunks`     | `document_id`               | B-tree | Chunk retrieval by document  |
| `chunks`     | `(tenant_id, project_id)`   | B-tree | Project-scoped queries       |
| `chunks`     | `vector_id`                 | B-tree | Hydration from vector search |
| `query_logs` | `(tenant_id, project_id)`   | B-tree | Analytics queries            |
| `query_logs` | `created_at`                | B-tree | Time-range queries           |
| `audit_logs` | `(tenant_id, action)`       | B-tree | Audit filtering              |

### Performance Notes

- All timestamp columns use `WITH TIME ZONE` for correct multi-region behavior
- JSONB columns (`metadata`, `settings`, `access_control`) are not indexed by default — add GIN indexes only when query patterns require it
- The `chunks.content` column stores full text; for large documents this can be significant — monitor table bloat
- `VACUUM` is tuned in PostgreSQL 17 for better performance on large tables

---

## Seed Data

```typescript
// packages/db/src/seed.ts
import { db } from "./client.js";
import { tenants, users, apiKeys, projects } from "./schema/index.js";
import { createHash, randomBytes } from "crypto";
import { hash } from "argon2";

async function seed() {
  console.log("Seeding database...");

  // Create test tenant
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: "Test Organization",
      slug: "test-org",
      plan: "pro",
      region: "us",
      settings: {
        /* use PLAN_LIMITS.pro defaults */
      },
    })
    .returning();

  // Create test user
  const passwordHash = await hash("testpassword123");
  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: "dev@contextinject.ai",
      name: "Dev User",
      role: "owner",
      passwordHash,
      emailVerified: true,
    })
    .returning();

  // Create test API key
  const rawKey = `ci_test_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  await db.insert(apiKeys).values({
    tenantId: tenant.id,
    keyHash,
    prefix: rawKey.slice(0, 16),
    name: "Development Key",
    scopes: ["documents:read", "documents:write", "query", "admin"],
    environment: "test",
  });

  // Create test project
  await db.insert(projects).values({
    tenantId: tenant.id,
    name: "Default Project",
    description: "Development test project",
  });

  console.log("Seed complete.");
  console.log(`Test API Key: ${rawKey}`);
  console.log("Store this key — it cannot be retrieved again.");
}

seed()
  .catch(console.error)
  .finally(() => process.exit());
```

---

## Testing Requirements

- Migration applies cleanly to an empty database
- Migration is idempotent (running twice does not error)
- RLS prevents Tenant A from reading Tenant B data
- Connection pool handles 50 concurrent queries without exhaustion
- `withTenant` correctly scopes all queries
- Seed script creates valid test data
- All indexes exist after migration
- pgvector extension is available (`SELECT vector_dims(...)` works)

---

## Risk Assessment

| Risk                                    | Impact | Mitigation                                            |
| --------------------------------------- | ------ | ----------------------------------------------------- |
| pgvector 0.8+ not in Docker image       | Medium | Build custom image; fallback to 0.7                   |
| RLS overhead on high-throughput queries | Low    | tenant_id indexed; benchmark shows <1ms overhead      |
| Connection pool exhaustion              | High   | Monitor pool metrics; alert at 80% utilization        |
| Drizzle Kit migration conflicts         | Medium | Use strict mode; review generated SQL before applying |

---

_Related: [Phase 1 Overview](./README.md) | [Type System](./02-type-system.md) | [Auth System](./04-auth-system.md)_
