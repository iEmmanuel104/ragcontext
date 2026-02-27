# ContextInject: Complete Build Plan, Code Architecture & Implementation Guide

> **The Stripe for RAG** — Intelligent context middleware between any data source and any AI model.
> This document is the single source of truth for building the MVP to production system.

---

## Part 1: Project Foundation & Developer Environment

### 1.1 Prerequisites & Tooling

```bash
# Required versions — pin these to avoid drift
Node.js     >= 20.x LTS (use nvm)
TypeScript  >= 5.4
PostgreSQL  >= 16 (with pgvector extension 0.7+)
Redis       >= 7.2
Docker      >= 25.0
pnpm        >= 9.0 (monorepo package manager)

# Install nvm and node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20 && nvm use 20

# Install pnpm globally
npm install -g pnpm

# Install Docker Desktop (Mac/Windows) or Docker Engine (Linux)
# https://docs.docker.com/get-docker/
```

### 1.2 Monorepo Structure

The entire system lives in a single pnpm monorepo. This enables shared types, shared utilities, atomic changes across services, and unified CI/CD.

```
context-inject/
├── apps/
│   ├── api/                    # Core REST API (Express + TypeScript)
│   ├── worker/                 # Background job processor (BullMQ)
│   ├── dashboard/              # Web UI (Next.js 14)
│   └── mcp-server/             # MCP server for AI agent integration
├── packages/
│   ├── core/                   # Pipeline engine (shared business logic)
│   ├── connectors/             # Data source connectors
│   │   ├── notion/
│   │   ├── slack/
│   │   ├── gmail/
│   │   ├── github/
│   │   ├── confluence/
│   │   └── web-crawler/
│   ├── sdk/                    # Public TypeScript SDK
│   ├── sdk-python/             # Public Python SDK (separate repo later)
│   ├── db/                     # Database client + migrations (Drizzle ORM)
│   ├── queue/                  # Queue abstractions (BullMQ wrappers)
│   ├── embeddings/             # Embedding model clients + abstraction
│   ├── vector-store/           # Vector database abstraction layer
│   ├── chunker/                # Document chunking strategies
│   ├── reranker/               # Reranking model clients
│   ├── compressor/             # Context compression (LLMLingua)
│   ├── evaluator/              # RAGAS-style quality scoring
│   ├── cache/                  # Semantic cache layer
│   ├── logger/                 # Structured logging (Pino)
│   └── types/                  # Shared TypeScript types (the source of truth)
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml  # Local development stack
│   │   └── docker-compose.prod.yml
│   ├── k8s/                    # Kubernetes manifests (production)
│   └── terraform/              # Cloud infrastructure (AWS/GCP)
├── scripts/
│   ├── seed.ts                 # Database seeding
│   └── migrate.ts              # Migration runner
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── pnpm-workspace.yaml
├── turbo.json                  # Turborepo build cache config
└── package.json
```

### 1.3 Initialize the Monorepo

```bash
# Create root
mkdir context-inject && cd context-inject
git init

# Root package.json
cat > package.json << 'EOF'
{
  "name": "context-inject",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "db:migrate": "pnpm --filter @ci/db migrate",
    "db:seed": "pnpm --filter @ci/db seed"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
EOF

# Workspace configuration
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'apps/*'
  - 'packages/*'
EOF

# Turborepo config for caching and task dependency graph
cat > turbo.json << 'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
EOF

# Install turbo and initialize
pnpm install
```

---

## Part 2: Shared Types Package — The Backbone of Everything

**Build this first.** Every other package depends on these types. Getting them right prevents refactoring pain.

```bash
mkdir -p packages/types && cd packages/types
cat > package.json << 'EOF'
{
  "name": "@ci/types",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  }
}
EOF
```

```typescript
// packages/types/src/index.ts — The complete type system

// ─── Tenant & Auth ───────────────────────────────────────────────────────────

export interface Tenant {
  id: string; // UUID
  name: string;
  slug: string; // URL-safe identifier
  plan: "free" | "starter" | "pro" | "enterprise";
  createdAt: Date;
  settings: TenantSettings;
}

export interface TenantSettings {
  maxDocuments: number;
  maxRetrievalsPerMonth: number;
  allowedConnectors: ConnectorType[];
  retentionDays: number;
  encryptionKeyId?: string; // BYOK for enterprise
}

export interface ApiKey {
  id: string;
  tenantId: string;
  keyHash: string; // SHA-256 of the actual key — never store raw
  prefix: string; // e.g., "ci_live_" for display
  name: string;
  scopes: ApiKeyScope[];
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export type ApiKeyScope = "documents:read" | "documents:write" | "query" | "admin";

// ─── Documents & Chunks ──────────────────────────────────────────────────────

export type ConnectorType =
  | "notion"
  | "slack"
  | "gmail"
  | "github"
  | "confluence"
  | "jira"
  | "sharepoint"
  | "google-drive"
  | "web-crawler"
  | "direct-upload";

export type DocumentStatus =
  | "pending"
  | "processing"
  | "embedding"
  | "indexed"
  | "failed"
  | "deleted";

export interface Document {
  id: string;
  tenantId: string;
  projectId: string;
  connectorType: ConnectorType;
  externalId?: string; // ID in source system (e.g., Notion page ID)
  title: string;
  sourceUrl?: string;
  mimeType: string;
  contentHash: string; // SHA-256 of raw content — for change detection
  status: DocumentStatus;
  chunkCount: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
  accessControl: AccessControl;
  createdAt: Date;
  updatedAt: Date;
  indexedAt?: Date;
}

export interface AccessControl {
  ownerId?: string;
  groupIds?: string[];
  isPublic: boolean;
  customTags?: string[];
}

export interface Chunk {
  id: string;
  documentId: string;
  tenantId: string;
  content: string;
  tokenCount: number;
  chunkIndex: number; // Position in document
  embedding?: number[]; // Stored in vector DB, not here
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  pageNumber?: number;
  sectionTitle?: string;
  headingPath?: string[]; // Breadcrumb: ["Chapter 1", "Section 2"]
  startOffset: number; // Character offset in original document
  endOffset: number;
}

// ─── Pipeline Configuration ──────────────────────────────────────────────────

export interface PipelineConfig {
  chunking: ChunkingConfig;
  embedding: EmbeddingConfig;
  retrieval: RetrievalConfig;
  reranking: RerankingConfig;
  compression: CompressionConfig;
  caching: CachingConfig;
}

export interface ChunkingConfig {
  strategy: "semantic" | "recursive" | "fixed" | "sentence";
  maxTokens: number; // Target chunk size (default: 512)
  overlapTokens: number; // Overlap between chunks (default: 50)
  minTokens: number; // Minimum chunk size before merging (default: 100)
}

export interface EmbeddingConfig {
  provider: "cohere" | "openai" | "bgem3" | "nomic";
  model: string; // e.g., 'embed-english-v3.0'
  dimensions: number; // e.g., 1024
  batchSize: number; // Documents per embedding batch (default: 96)
}

export interface RetrievalConfig {
  topK: number; // Candidates to retrieve (default: 100)
  hybridAlpha: number; // 0=BM25 only, 1=dense only (default: 0.7)
  filterByAccessControl: boolean;
}

export interface RerankingConfig {
  enabled: boolean;
  provider: "cohere" | "bgereranker" | "llm";
  model: string;
  topN: number; // Final chunks after reranking (default: 5)
}

export interface CompressionConfig {
  enabled: boolean;
  targetRatio: number; // Compression ratio (default: 0.5 = 50% tokens)
  method: "llmlingua" | "extractive" | "summary";
}

export interface CachingConfig {
  enabled: boolean;
  similarityThreshold: number; // Cosine similarity for cache hit (default: 0.90)
  ttlSeconds: number; // Cache TTL (default: 3600)
}

// ─── Query & Retrieval ───────────────────────────────────────────────────────

export interface QueryRequest {
  query: string;
  projectId: string;
  conversationId?: string; // For conversation memory
  topK?: number;
  filters?: QueryFilter[];
  config?: Partial<PipelineConfig>;
  includeMetadata?: boolean;
  stream?: boolean;
}

export interface QueryFilter {
  field: string; // e.g., 'metadata.author', 'connectorType'
  operator: "eq" | "neq" | "in" | "nin" | "contains";
  value: unknown;
}

export interface QueryResult {
  requestId: string;
  query: string;
  chunks: RankedChunk[];
  context: AssembledContext;
  quality: ContextQualityScore;
  latencyMs: number;
  cacheHit: boolean;
  usage: UsageMetrics;
}

export interface RankedChunk extends Chunk {
  score: number; // Final relevance score after reranking
  vectorScore: number; // Raw vector similarity
  bm25Score: number; // Raw BM25 score
  rerankScore?: number; // Cross-encoder score
}

export interface AssembledContext {
  text: string; // Final context string for LLM injection
  tokenCount: number;
  chunks: RankedChunk[];
  citations: Citation[];
  compressionRatio?: number;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceUrl?: string;
  pageNumber?: number;
  excerpt: string; // Short quote for attribution
}

export interface ContextQualityScore {
  overall: number; // 0-1 composite score
  retrievalConfidence: number; // How relevant are the retrieved chunks
  contextSufficiency: number; // Does context contain enough information
  diversityScore: number; // Source diversity (prevents echo chamber)
  estimatedFaithfulness: number; // Pre-generation faithfulness prediction
  warning?: string; // e.g., "Low confidence — consider rephrasing"
}

export interface UsageMetrics {
  documentsScanned: number;
  chunksRetrieved: number;
  chunksAfterRerank: number;
  tokensBeforeCompression: number;
  tokensAfterCompression: number;
  embeddingTokens: number;
}

// ─── Jobs & Events ───────────────────────────────────────────────────────────

export type JobType =
  | "ingest-document"
  | "sync-connector"
  | "delete-document"
  | "reindex-project"
  | "generate-embeddings";

export interface Job<T = unknown> {
  id: string;
  type: JobType;
  tenantId: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
}

export interface IngestDocumentJobData {
  documentId: string;
  tenantId: string;
  projectId: string;
  rawContent: string;
  mimeType: string;
  pipelineConfig: PipelineConfig;
}

// ─── Connectors ──────────────────────────────────────────────────────────────

export interface ConnectorConfig {
  id: string;
  tenantId: string;
  type: ConnectorType;
  credentials: EncryptedCredentials;
  syncConfig: SyncConfig;
  status: "active" | "paused" | "error";
  lastSyncAt?: Date;
  nextSyncAt?: Date;
}

export interface EncryptedCredentials {
  encrypted: string; // AES-256-GCM encrypted JSON
  iv: string;
  authTag: string;
}

export interface SyncConfig {
  intervalMinutes: number;
  includeFilters?: string[];
  excludeFilters?: string[];
  maxDocuments?: number;
}
```

---

## Part 3: Database Layer — Schema, Migrations & Client

### 3.1 Setup Drizzle ORM

```bash
mkdir -p packages/db && cd packages/db
pnpm add drizzle-orm postgres pg drizzle-kit dotenv
pnpm add -D @types/pg
```

### 3.2 Complete Database Schema

```typescript
// packages/db/src/schema/index.ts
import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  pgEnum,
  real,
  bigint,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const planEnum = pgEnum("plan", ["free", "starter", "pro", "enterprise"]);
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
export const jobStatusEnum = pgEnum("job_status", [
  "waiting",
  "active",
  "completed",
  "failed",
  "delayed",
]);

// ─── Tenants ─────────────────────────────────────────────────────────────────

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 63 }).notNull(),
    plan: planEnum("plan").default("free").notNull(),
    settings: jsonb("settings").notNull().default({}),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("tenants_slug_idx").on(t.slug),
  }),
);

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(), // SHA-256 hex
    prefix: varchar("prefix", { length: 20 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    scopes: jsonb("scopes").notNull().default([]),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    keyHashIdx: uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    tenantIdx: index("api_keys_tenant_idx").on(t.tenantId),
  }),
);

// ─── Projects ────────────────────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    pipelineConfig: jsonb("pipeline_config").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("projects_tenant_idx").on(t.tenantId),
  }),
);

// ─── Connectors ──────────────────────────────────────────────────────────────

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    type: connectorTypeEnum("type").notNull(),
    credentials: jsonb("credentials").notNull(), // Encrypted JSON blob
    syncConfig: jsonb("sync_config").notNull().default({}),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    errorMessage: text("error_message"),
    lastSyncAt: timestamp("last_sync_at"),
    nextSyncAt: timestamp("next_sync_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    tenantProjectIdx: index("connectors_tenant_project_idx").on(t.tenantId, t.projectId),
  }),
);

// ─── Documents ───────────────────────────────────────────────────────────────

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
    externalId: varchar("external_id", { length: 255 }), // ID in source system
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(), // SHA-256
    status: documentStatusEnum("status").default("pending").notNull(),
    chunkCount: integer("chunk_count").default(0).notNull(),
    tokenCount: integer("token_count").default(0).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    accessControl: jsonb("access_control").notNull().default({ isPublic: false }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    indexedAt: timestamp("indexed_at"),
    deletedAt: timestamp("deleted_at"), // Soft delete for GDPR
  },
  (t) => ({
    tenantProjectIdx: index("documents_tenant_project_idx").on(t.tenantId, t.projectId),
    statusIdx: index("documents_status_idx").on(t.status),
    contentHashIdx: index("documents_content_hash_idx").on(t.tenantId, t.contentHash),
    externalIdIdx: index("documents_external_id_idx").on(t.tenantId, t.externalId),
  }),
);

// ─── Chunks (with pgvector embeddings) ───────────────────────────────────────
// Note: Chunk embeddings live in Qdrant. This table holds chunk metadata only.
// We keep chunk metadata here for fast SQL joins and filtering.

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id").notNull(), // Denormalized for fast filtering
    projectId: uuid("project_id").notNull(), // Denormalized for fast filtering
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    vectorId: varchar("vector_id", { length: 255 }).notNull(), // Qdrant point ID
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    documentIdx: index("chunks_document_idx").on(t.documentId),
    tenantProjectIdx: index("chunks_tenant_project_idx").on(t.tenantId, t.projectId),
  }),
);

// ─── Query Logs (for analytics and quality monitoring) ───────────────────────

export const queryLogs = pgTable(
  "query_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    conversationId: uuid("conversation_id"),
    query: text("query").notNull(),
    queryEmbeddingId: varchar("query_embedding_id", { length: 255 }),
    chunksRetrieved: integer("chunks_retrieved").notNull(),
    cacheHit: boolean("cache_hit").default(false).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    qualityScore: real("quality_score"),
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    tenantProjectIdx: index("query_logs_tenant_project_idx").on(t.tenantId, t.projectId),
    createdAtIdx: index("query_logs_created_at_idx").on(t.createdAt),
  }),
);

// ─── Usage Metering (for billing) ────────────────────────────────────────────

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(), // 'retrieval' | 'page_ingested' | etc.
    quantity: integer("quantity").notNull().default(1),
    metadata: jsonb("metadata").notNull().default({}),
    billedAt: timestamp("billed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("usage_events_tenant_idx").on(t.tenantId),
    billingIdx: index("usage_events_billing_idx").on(t.tenantId, t.billedAt),
  }),
);

// ─── Conversation Memory ─────────────────────────────────────────────────────

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  projectId: uuid("project_id").notNull(),
  title: varchar("title", { length: 255 }),
  summary: text("summary"), // Mid-term memory: compressed conversation
  messages: jsonb("messages").notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});
```

### 3.3 Migration Setup

```typescript
// packages/db/src/migrate.ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);

async function main() {
  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await sql.end();
}

main().catch(console.error);
```

```bash
# Generate initial migration from schema
pnpm drizzle-kit generate
pnpm db:migrate

# Enable pgvector extension (run once)
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"  # For BM25 text search
```

---

## Part 4: The Core Pipeline Engine

This is the heart of the system. Every query flows through this pipeline.

### 4.1 Vector Store Abstraction

```typescript
// packages/vector-store/src/index.ts
// Abstract interface so we can swap Qdrant for Milvus, Pinecone, etc.

export interface VectorPoint {
  id: string;
  vector: number[];
  sparseVector?: { indices: number[]; values: number[] }; // For hybrid search
  payload: Record<string, unknown>;
}

export interface VectorSearchParams {
  vector: number[];
  sparseVector?: { indices: number[]; values: number[] };
  topK: number;
  filter?: VectorFilter;
  withPayload?: boolean;
  scoreThreshold?: number;
}

export interface VectorFilter {
  must?: FilterCondition[];
  should?: FilterCondition[];
  mustNot?: FilterCondition[];
}

export interface FilterCondition {
  key: string;
  match?: { value: unknown };
  range?: { gte?: number; lte?: number };
  values?: { values: unknown[] };
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface IVectorStore {
  upsertPoints(collectionName: string, points: VectorPoint[]): Promise<void>;
  search(collectionName: string, params: VectorSearchParams): Promise<VectorSearchResult[]>;
  delete(collectionName: string, ids: string[]): Promise<void>;
  createCollection(name: string, dimensions: number): Promise<void>;
  deleteCollection(name: string): Promise<void>;
  getCollectionInfo(name: string): Promise<{ vectorsCount: number }>;
}
```

```typescript
// packages/vector-store/src/qdrant.ts
import { QdrantClient } from "@qdrant/js-client-rest";
import type { IVectorStore, VectorPoint, VectorSearchParams, VectorSearchResult } from "./index";

export class QdrantVectorStore implements IVectorStore {
  private client: QdrantClient;

  constructor(url: string, apiKey?: string) {
    this.client = new QdrantClient({ url, apiKey });
  }

  async createCollection(name: string, dimensions: number): Promise<void> {
    await this.client.createCollection(name, {
      vectors: {
        dense: {
          size: dimensions,
          distance: "Cosine",
          on_disk: true, // Cost-efficient for large collections
        },
      },
      sparse_vectors: {
        sparse: {
          index: { on_disk: true },
        },
      },
      // HNSW parameters tuned for recall vs speed
      hnsw_config: { m: 16, ef_construct: 200 },
      optimizers_config: {
        default_segment_number: 4,
        memmap_threshold: 20000,
      },
    });
  }

  async upsertPoints(collectionName: string, points: VectorPoint[]): Promise<void> {
    const qdrantPoints = points.map((p) => ({
      id: p.id,
      vector: {
        dense: p.vector,
        ...(p.sparseVector && { sparse: p.sparseVector }),
      },
      payload: p.payload,
    }));

    // Batch upsert in groups of 100
    const batchSize = 100;
    for (let i = 0; i < qdrantPoints.length; i += batchSize) {
      const batch = qdrantPoints.slice(i, i + batchSize);
      await this.client.upsert(collectionName, {
        wait: true,
        points: batch,
      });
    }
  }

  async search(collectionName: string, params: VectorSearchParams): Promise<VectorSearchResult[]> {
    // Hybrid search: run dense and sparse in parallel, fuse with RRF
    const [denseResults, sparseResults] = await Promise.all([
      this.client.search(collectionName, {
        vector: { name: "dense", vector: params.vector },
        limit: params.topK,
        filter: this.buildFilter(params.filter),
        with_payload: params.withPayload ?? true,
        score_threshold: params.scoreThreshold,
      }),
      params.sparseVector
        ? this.client.search(collectionName, {
            vector: { name: "sparse", vector: params.sparseVector as any },
            limit: params.topK,
            filter: this.buildFilter(params.filter),
            with_payload: false, // Only need scores for RRF
          })
        : Promise.resolve([]),
    ]);

    // Reciprocal Rank Fusion (RRF) to merge dense + sparse results
    return this.reciprocalRankFusion(denseResults, sparseResults, params.topK);
  }

  private reciprocalRankFusion(
    denseResults: any[],
    sparseResults: any[],
    topK: number,
    k = 60, // RRF constant
  ): VectorSearchResult[] {
    const scores = new Map<string, number>();

    // Score from dense ranking
    denseResults.forEach((result, rank) => {
      const id = String(result.id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });

    // Score from sparse ranking
    sparseResults.forEach((result, rank) => {
      const id = String(result.id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });

    // Merge payloads from dense results
    const payloadMap = new Map(denseResults.map((r) => [String(r.id), r.payload]));

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => ({
        id,
        score,
        payload: payloadMap.get(id) ?? {},
      }));
  }

  private buildFilter(filter?: any) {
    if (!filter) return undefined;
    return filter; // Pass-through — Qdrant filter syntax used directly
  }

  async delete(collectionName: string, ids: string[]): Promise<void> {
    await this.client.delete(collectionName, {
      wait: true,
      points: ids,
    });
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name);
  }

  async getCollectionInfo(name: string) {
    const info = await this.client.getCollection(name);
    return { vectorsCount: info.vectors_count ?? 0 };
  }
}
```

### 4.2 Embedding Service

```typescript
// packages/embeddings/src/index.ts

export interface EmbeddingResult {
  embeddings: number[][];
  tokensUsed: number;
  model: string;
}

export interface IEmbeddingProvider {
  embed(texts: string[]): Promise<EmbeddingResult>;
  getDimensions(): number;
  getModel(): string;
}
```

```typescript
// packages/embeddings/src/cohere.ts
import Cohere from "cohere-ai";
import type { IEmbeddingProvider, EmbeddingResult } from "./index";

export class CohereEmbedding implements IEmbeddingProvider {
  private client: Cohere;
  private model: string;
  private dimensions: number;
  private inputType: "search_document" | "search_query";

  constructor(
    apiKey: string,
    model = "embed-english-v3.0",
    inputType: "search_document" | "search_query" = "search_document",
  ) {
    this.client = new Cohere({ token: apiKey });
    this.model = model;
    this.dimensions = 1024;
    this.inputType = inputType;
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    // Cohere supports batch of 96 texts max
    const allEmbeddings: number[][] = [];
    const batchSize = 96;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.client.embed({
        texts: batch,
        model: this.model,
        inputType: this.inputType,
        embeddingTypes: ["float"],
      });

      const embeddings = response.embeddings?.float ?? [];
      allEmbeddings.push(...(embeddings as number[][]));
    }

    return {
      embeddings: allEmbeddings,
      tokensUsed: texts.join(" ").split(" ").length * 1.3, // Approximation
      model: this.model,
    };
  }

  getDimensions() {
    return this.dimensions;
  }
  getModel() {
    return this.model;
  }
}
```

### 4.3 Chunking Engine

```typescript
// packages/chunker/src/semantic.ts
import { encode } from "gpt-tokenizer";

interface SemanticChunk {
  content: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  metadata: Record<string, unknown>;
}

export class SemanticChunker {
  private maxTokens: number;
  private overlapTokens: number;
  private minTokens: number;

  constructor(config: { maxTokens: number; overlapTokens: number; minTokens: number }) {
    this.maxTokens = config.maxTokens;
    this.overlapTokens = config.overlapTokens;
    this.minTokens = config.minTokens;
  }

  // Split text into semantic chunks using sentence boundaries
  chunk(text: string, metadata: Record<string, unknown> = {}): SemanticChunk[] {
    const sentences = this.splitIntoSentences(text);
    const chunks: SemanticChunk[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let charOffset = 0;
    let chunkStartOffset = 0;

    for (const sentence of sentences) {
      const sentenceTokens = encode(sentence).length;

      // If adding this sentence exceeds max, flush current chunk
      if (currentTokens + sentenceTokens > this.maxTokens && currentChunk.length > 0) {
        const chunkText = currentChunk.join(" ");
        if (encode(chunkText).length >= this.minTokens) {
          chunks.push({
            content: chunkText,
            tokenCount: encode(chunkText).length,
            startOffset: chunkStartOffset,
            endOffset: charOffset,
            metadata,
          });
        }

        // Handle overlap: keep last N sentences for context continuity
        const overlapSentences = this.getOverlapSentences(currentChunk, this.overlapTokens);
        currentChunk = overlapSentences;
        currentTokens = encode(currentChunk.join(" ")).length;
        chunkStartOffset = charOffset - currentChunk.join(" ").length;
      }

      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
      charOffset += sentence.length + 1; // +1 for space
    }

    // Flush remaining
    if (currentChunk.length > 0) {
      const chunkText = currentChunk.join(" ");
      chunks.push({
        content: chunkText,
        tokenCount: encode(chunkText).length,
        startOffset: chunkStartOffset,
        endOffset: charOffset,
        metadata,
      });
    }

    // Merge tiny chunks with previous
    return this.mergeTinyChunks(chunks);
  }

  private splitIntoSentences(text: string): string[] {
    // Use regex that handles abbreviations, decimal numbers, etc.
    return text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
  }

  private getOverlapSentences(sentences: string[], targetTokens: number): string[] {
    const result: string[] = [];
    let tokens = 0;
    for (let i = sentences.length - 1; i >= 0; i--) {
      const t = encode(sentences[i]).length;
      if (tokens + t > targetTokens) break;
      result.unshift(sentences[i]);
      tokens += t;
    }
    return result;
  }

  private mergeTinyChunks(chunks: SemanticChunk[]): SemanticChunk[] {
    return chunks.reduce((acc, chunk) => {
      if (chunk.tokenCount < this.minTokens && acc.length > 0) {
        const prev = acc[acc.length - 1];
        acc[acc.length - 1] = {
          content: prev.content + " " + chunk.content,
          tokenCount: prev.tokenCount + chunk.tokenCount,
          startOffset: prev.startOffset,
          endOffset: chunk.endOffset,
          metadata: prev.metadata,
        };
      } else {
        acc.push(chunk);
      }
      return acc;
    }, [] as SemanticChunk[]);
  }
}
```

### 4.4 The Retrieval Pipeline — Core Engine

```typescript
// packages/core/src/pipeline/retrieval-pipeline.ts

import type { QueryRequest, QueryResult, RankedChunk, AssembledContext } from "@ci/types";
import type { IVectorStore } from "@ci/vector-store";
import type { IEmbeddingProvider } from "@ci/embeddings";
import type { IRerankProvider } from "@ci/reranker";
import type { ICompressor } from "@ci/compressor";
import type { ISemanticCache } from "@ci/cache";
import type { IQualityEvaluator } from "@ci/evaluator";
import { db } from "@ci/db";
import { chunks, documents, queryLogs } from "@ci/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

export class RetrievalPipeline {
  constructor(
    private vectorStore: IVectorStore,
    private embedder: IEmbeddingProvider,
    private reranker: IRerankProvider,
    private compressor: ICompressor,
    private cache: ISemanticCache,
    private evaluator: IQualityEvaluator,
    private collectionName: string,
  ) {}

  async query(request: QueryRequest): Promise<QueryResult> {
    const startTime = Date.now();
    const requestId = randomUUID();

    // ── Stage 1: Semantic Cache Check ────────────────────────────────────────
    const cachedResult = await this.cache.get(request.query, request.projectId);
    if (cachedResult) {
      return {
        ...cachedResult,
        requestId,
        cacheHit: true,
        latencyMs: Date.now() - startTime,
      };
    }

    // ── Stage 2: Query Embedding ──────────────────────────────────────────────
    const queryEmbeddingResult = await this.embedder.embed([request.query]);
    const queryVector = queryEmbeddingResult.embeddings[0];

    // ── Stage 3: Build Permission-Aware Filter ────────────────────────────────
    const filter = this.buildAccessFilter(request);

    // ── Stage 4: Hybrid Vector Search (Dense + Sparse) ────────────────────────
    const searchResults = await this.vectorStore.search(this.collectionName, {
      vector: queryVector,
      topK: request.config?.retrieval?.topK ?? 100,
      filter,
      withPayload: true,
    });

    // ── Stage 5: Hydrate Chunk Metadata from Postgres ─────────────────────────
    const chunkIds = searchResults.map((r) => r.id);
    const hydratedChunks = await this.hydrateChunks(chunkIds, searchResults);

    // ── Stage 6: Reranking ────────────────────────────────────────────────────
    const rerankedChunks = await this.reranker.rerank(
      request.query,
      hydratedChunks,
      request.config?.reranking?.topN ?? 10,
    );

    // ── Stage 7: Context Compression ─────────────────────────────────────────
    const compressedContext = request.config?.compression?.enabled
      ? await this.compressor.compress(rerankedChunks, request.query)
      : this.assembleContext(rerankedChunks);

    // ── Stage 8: Quality Scoring ──────────────────────────────────────────────
    const qualityScore = await this.evaluator.score({
      query: request.query,
      chunks: rerankedChunks,
      context: compressedContext,
    });

    // ── Stage 9: Assemble Final Result ────────────────────────────────────────
    const result: QueryResult = {
      requestId,
      query: request.query,
      chunks: rerankedChunks,
      context: compressedContext,
      quality: qualityScore,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
      usage: {
        documentsScanned: searchResults.length,
        chunksRetrieved: searchResults.length,
        chunksAfterRerank: rerankedChunks.length,
        tokensBeforeCompression: hydratedChunks.reduce((sum, c) => sum + c.tokenCount, 0),
        tokensAfterCompression: compressedContext.tokenCount,
        embeddingTokens: queryEmbeddingResult.tokensUsed,
      },
    };

    // ── Stage 10: Cache Store & Async Logging ─────────────────────────────────
    // Don't await these — fire and forget for latency
    Promise.all([
      this.cache.set(request.query, request.projectId, result),
      this.logQuery(request, result),
    ]).catch(console.error);

    return result;
  }

  private buildAccessFilter(request: QueryRequest) {
    // Always filter by project and exclude soft-deleted documents
    return {
      must: [
        { key: "projectId", match: { value: request.projectId } },
        { key: "isDeleted", match: { value: false } },
        // Additional user-level filters from request
        ...(request.filters?.map((f) => ({
          key: f.field,
          match: { value: f.value },
        })) ?? []),
      ],
    };
  }

  private async hydrateChunks(
    chunkIds: string[],
    searchResults: { id: string; score: number }[],
  ): Promise<RankedChunk[]> {
    const scoreMap = new Map(searchResults.map((r) => [r.id, r.score]));

    const dbChunks = await db.select().from(chunks).where(inArray(chunks.vectorId, chunkIds));

    return dbChunks
      .map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        tenantId: chunk.tenantId,
        projectId: chunk.projectId,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata as any,
        score: scoreMap.get(chunk.vectorId) ?? 0,
        vectorScore: scoreMap.get(chunk.vectorId) ?? 0,
        bm25Score: 0, // Will be populated from sparse search in production
      }))
      .sort((a, b) => b.score - a.score);
  }

  private assembleContext(rankedChunks: RankedChunk[]): AssembledContext {
    const contextParts: string[] = [];
    let totalTokens = 0;

    for (const chunk of rankedChunks) {
      contextParts.push(`[Source: ${chunk.metadata.documentTitle ?? "Unknown"}]\n${chunk.content}`);
      totalTokens += chunk.tokenCount;
    }

    const text = contextParts.join("\n\n---\n\n");
    const citations = rankedChunks.map((chunk) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: String(chunk.metadata.documentTitle ?? ""),
      sourceUrl: chunk.metadata.sourceUrl as string | undefined,
      excerpt: chunk.content.slice(0, 200) + "...",
    }));

    return { text, tokenCount: totalTokens, chunks: rankedChunks, citations };
  }

  private async logQuery(request: QueryRequest, result: QueryResult): Promise<void> {
    await db.insert(queryLogs).values({
      tenantId: "", // Set from middleware
      projectId: request.projectId,
      conversationId: request.conversationId,
      query: request.query,
      chunksRetrieved: result.chunks.length,
      cacheHit: result.cacheHit,
      latencyMs: result.latencyMs,
      qualityScore: result.quality.overall,
      tokensInput: result.usage.tokensBeforeCompression,
      tokensOutput: result.usage.tokensAfterCompression,
    });
  }
}
```

### 4.5 Document Ingestion Pipeline

```typescript
// packages/core/src/pipeline/ingestion-pipeline.ts

import { createHash, randomUUID } from "crypto";
import { encode } from "gpt-tokenizer";
import type { IngestDocumentJobData } from "@ci/types";
import { SemanticChunker } from "@ci/chunker";
import type { IVectorStore, VectorPoint } from "@ci/vector-store";
import type { IEmbeddingProvider } from "@ci/embeddings";
import { db } from "@ci/db";
import { documents, chunks } from "@ci/db/schema";
import { eq } from "drizzle-orm";

export class IngestionPipeline {
  private chunker: SemanticChunker;

  constructor(
    private vectorStore: IVectorStore,
    private embedder: IEmbeddingProvider,
    private collectionName: string,
  ) {
    this.chunker = new SemanticChunker({
      maxTokens: 512,
      overlapTokens: 50,
      minTokens: 100,
    });
  }

  async ingest(jobData: IngestDocumentJobData): Promise<void> {
    const { documentId, rawContent, mimeType, tenantId, projectId } = jobData;

    try {
      // ── Step 1: Update status to processing ───────────────────────────────
      await db
        .update(documents)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(documents.id, documentId));

      // ── Step 2: Parse content (already done by connector, passed as text) ──
      const cleanText = this.cleanText(rawContent);

      // ── Step 3: Semantic Chunking ─────────────────────────────────────────
      const semanticChunks = this.chunker.chunk(cleanText, {
        documentId,
        tenantId,
        projectId,
        mimeType,
      });

      if (semanticChunks.length === 0) {
        throw new Error("Document produced no chunks after processing");
      }

      // ── Step 4: Generate Embeddings (batched) ─────────────────────────────
      await db.update(documents).set({ status: "embedding" }).where(eq(documents.id, documentId));

      const texts = semanticChunks.map((c) => c.content);
      const embeddingResult = await this.embedder.embed(texts);

      // ── Step 5: Prepare Vector Points ─────────────────────────────────────
      const vectorPoints: VectorPoint[] = semanticChunks.map((chunk, i) => {
        const vectorId = randomUUID();
        return {
          id: vectorId,
          vector: embeddingResult.embeddings[i],
          payload: {
            documentId,
            tenantId,
            projectId,
            chunkIndex: i,
            tokenCount: chunk.tokenCount,
            contentPreview: chunk.content.slice(0, 200),
            isDeleted: false,
            createdAt: new Date().toISOString(),
          },
        };
      });

      // ── Step 6: Upsert to Vector Store ───────────────────────────────────
      await this.vectorStore.upsertPoints(this.collectionName, vectorPoints);

      // ── Step 7: Save Chunk Metadata to Postgres ──────────────────────────
      const chunkRecords = semanticChunks.map((chunk, i) => ({
        id: randomUUID(),
        documentId,
        tenantId,
        projectId,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        chunkIndex: i,
        vectorId: vectorPoints[i].id,
        metadata: {
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          ...chunk.metadata,
        },
      }));

      // Delete existing chunks first (for re-indexing support)
      await db.delete(chunks).where(eq(chunks.documentId, documentId));
      await db.insert(chunks).values(chunkRecords);

      // ── Step 8: Mark document as indexed ─────────────────────────────────
      const totalTokens = semanticChunks.reduce((sum, c) => sum + c.tokenCount, 0);
      await db
        .update(documents)
        .set({
          status: "indexed",
          chunkCount: semanticChunks.length,
          tokenCount: totalTokens,
          indexedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await db
        .update(documents)
        .set({
          status: "failed",
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
      throw error;
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\t/g, "  ")
      .replace(/\n{3,}/g, "\n\n") // Max 2 consecutive newlines
      .replace(/[^\S\n]+/g, " ") // Normalize spaces (preserve newlines)
      .trim();
  }
}
```

---

## Part 5: The API Server

### 5.1 Express App Setup

```typescript
// apps/api/src/app.ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import compression from "compression";
import { authMiddleware } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import { errorHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/logger";
import { metricsMiddleware } from "./middleware/metrics";

// Route handlers
import { queryRouter } from "./routes/query";
import { documentsRouter } from "./routes/documents";
import { projectsRouter } from "./routes/projects";
import { connectorsRouter } from "./routes/connectors";
import { webhooksRouter } from "./routes/webhooks";
import { analyticsRouter } from "./routes/analytics";
import { healthRouter } from "./routes/health";

export function createApp() {
  const app = express();

  // ── Security ───────────────────────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(",") ?? "*",
      credentials: true,
    }),
  );

  // ── Rate Limiting ──────────────────────────────────────────────────────────
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: (req) => {
      // Dynamic limits based on plan
      const plan = (req as any).tenant?.plan;
      const limits: Record<string, number> = {
        free: 60,
        starter: 300,
        pro: 1000,
        enterprise: 5000,
      };
      return limits[plan] ?? 60;
    },
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => (req as any).apiKeyId ?? req.ip,
    message: { error: "Rate limit exceeded", code: "RATE_LIMIT_EXCEEDED" },
  });

  // ── Middleware Stack ───────────────────────────────────────────────────────
  app.use(compression());
  app.use(express.json({ limit: "50mb" }));
  app.use(requestLogger);
  app.use(metricsMiddleware);

  // ── Public Routes (no auth) ────────────────────────────────────────────────
  app.use("/health", healthRouter);
  app.use("/webhooks", webhooksRouter); // Connector webhooks have their own auth

  // ── Protected Routes ───────────────────────────────────────────────────────
  app.use("/v1", authMiddleware, tenantMiddleware, apiLimiter);
  app.use("/v1/query", queryRouter);
  app.use("/v1/documents", documentsRouter);
  app.use("/v1/projects", projectsRouter);
  app.use("/v1/connectors", connectorsRouter);
  app.use("/v1/analytics", analyticsRouter);

  // ── Error Handler (must be last) ──────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
```

### 5.2 Authentication Middleware

```typescript
// apps/api/src/middleware/auth.ts
import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { db } from "@ci/db";
import { apiKeys, tenants } from "@ci/db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "../utils/errors";

declare global {
  namespace Express {
    interface Request {
      tenantId: string;
      tenant: typeof tenants.$inferSelect;
      apiKeyId: string;
      apiKeyScopes: string[];
    }
  }
}

// In-memory LRU cache for API keys — avoid hitting DB on every request
const keyCache = new Map<string, { tenantId: string; keyId: string; scopes: string[] }>();
const KEY_CACHE_MAX = 1000;
const KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError("Missing or invalid Authorization header", 401, "UNAUTHORIZED");
  }

  const rawKey = authHeader.slice(7);

  if (!rawKey.startsWith("ci_")) {
    throw new AppError("Invalid API key format", 401, "INVALID_API_KEY");
  }

  // Hash the key for lookup
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  // Check in-memory cache first
  const cached = keyCache.get(keyHash);
  if (cached) {
    req.tenantId = cached.tenantId;
    req.apiKeyId = cached.keyId;
    req.apiKeyScopes = cached.scopes;
    return next();
  }

  // Look up in database
  const [keyRecord] = await db
    .select({
      id: apiKeys.id,
      tenantId: apiKeys.tenantId,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!keyRecord) {
    throw new AppError("Invalid API key", 401, "INVALID_API_KEY");
  }

  if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
    throw new AppError("API key has expired", 401, "API_KEY_EXPIRED");
  }

  // Update last used (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyRecord.id))
    .catch(console.error);

  // Cache it
  if (keyCache.size >= KEY_CACHE_MAX) {
    const firstKey = keyCache.keys().next().value;
    if (firstKey) keyCache.delete(firstKey);
  }
  keyCache.set(keyHash, {
    tenantId: keyRecord.tenantId,
    keyId: keyRecord.id,
    scopes: keyRecord.scopes as string[],
  });

  req.tenantId = keyRecord.tenantId;
  req.apiKeyId = keyRecord.id;
  req.apiKeyScopes = keyRecord.scopes as string[];

  next();
}
```

### 5.3 Query Route — The Core API Endpoint

```typescript
// apps/api/src/routes/query.ts
import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate";
import { requireScope } from "../middleware/require-scope";
import { getPipeline } from "../services/pipeline-factory";
import { AppError } from "../utils/errors";

const QuerySchema = z.object({
  query: z.string().min(1).max(2000),
  projectId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  topK: z.number().int().min(1).max(20).default(5),
  filters: z
    .array(
      z.object({
        field: z.string(),
        operator: z.enum(["eq", "neq", "in", "nin", "contains"]),
        value: z.unknown(),
      }),
    )
    .optional(),
  stream: z.boolean().default(false),
});

export const queryRouter = Router();

queryRouter.post("/", requireScope("query"), validateBody(QuerySchema), async (req, res) => {
  const body = req.body;

  // Verify project belongs to tenant
  const pipeline = await getPipeline(req.tenantId, body.projectId);

  if (body.stream) {
    // SSE streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Stream retrieval steps as they complete
    const result = await pipeline.query({
      ...body,
      onStep: (step: string, data: unknown) => {
        res.write(`data: ${JSON.stringify({ step, data })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ step: "complete", data: result })}\n\n`);
    res.end();
  } else {
    const result = await pipeline.query(body);
    res.json({ success: true, data: result });
  }
});
```

### 5.4 Documents Route

```typescript
// apps/api/src/routes/documents.ts
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { validateBody, validateParams } from "../middleware/validate";
import { requireScope } from "../middleware/require-scope";
import { DocumentService } from "../services/document-service";
import { queueIngestJob } from "../services/queue";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/html",
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

export const documentsRouter = Router();

// Upload a document directly
documentsRouter.post(
  "/upload",
  requireScope("documents:write"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const { projectId } = req.body;
    const docService = new DocumentService(req.tenantId);

    // Create document record
    const doc = await docService.create({
      projectId,
      title: req.file.originalname,
      mimeType: req.file.mimetype,
      connectorType: "direct-upload",
      rawContent: req.file.buffer.toString("utf-8"),
    });

    // Queue ingestion job (async — returns immediately)
    await queueIngestJob({
      documentId: doc.id,
      tenantId: req.tenantId,
      projectId,
      rawContent: req.file.buffer.toString("utf-8"),
      mimeType: req.file.mimetype,
      pipelineConfig: doc.pipelineConfig,
    });

    res.status(202).json({
      success: true,
      data: { documentId: doc.id, status: "processing" },
    });
  },
);

// List documents in a project
documentsRouter.get("/", requireScope("documents:read"), async (req, res) => {
  const { projectId, status, page = "1", limit = "20" } = req.query;
  const docService = new DocumentService(req.tenantId);
  const result = await docService.list({
    projectId: projectId as string,
    status: status as string,
    page: parseInt(page as string),
    limit: Math.min(parseInt(limit as string), 100),
  });
  res.json({ success: true, data: result });
});

// Get single document status
documentsRouter.get("/:id", requireScope("documents:read"), async (req, res) => {
  const docService = new DocumentService(req.tenantId);
  const doc = await docService.getById(req.params.id);
  res.json({ success: true, data: doc });
});

// Delete document (triggers cascading delete from vector store)
documentsRouter.delete("/:id", requireScope("documents:write"), async (req, res) => {
  const docService = new DocumentService(req.tenantId);
  await docService.delete(req.params.id);
  res.json({ success: true });
});
```

---

## Part 6: Background Worker (Job Processing)

```typescript
// apps/worker/src/index.ts
import { Worker, Queue } from "bullmq";
import { createClient } from "redis";
import { IngestionPipeline } from "@ci/core";
import { QdrantVectorStore } from "@ci/vector-store";
import { CohereEmbedding } from "@ci/embeddings";
import { logger } from "@ci/logger";

const connection = { host: process.env.REDIS_HOST!, port: 6379 };

// ── Document Ingestion Worker ─────────────────────────────────────────────────

const ingestWorker = new Worker(
  "ingest-document",
  async (job) => {
    logger.info({ jobId: job.id, documentId: job.data.documentId }, "Starting ingestion");

    const vectorStore = new QdrantVectorStore(process.env.QDRANT_URL!, process.env.QDRANT_API_KEY);

    const embedder = new CohereEmbedding(
      process.env.COHERE_API_KEY!,
      "embed-english-v3.0",
      "search_document",
    );

    const pipeline = new IngestionPipeline(
      vectorStore,
      embedder,
      `tenant_${job.data.tenantId}`, // Per-tenant collection naming
    );

    await pipeline.ingest(job.data);
    logger.info({ jobId: job.id, documentId: job.data.documentId }, "Ingestion complete");
  },
  {
    connection,
    concurrency: 5, // Process 5 documents simultaneously
    limiter: {
      max: 100, // Max 100 jobs per minute (respect Cohere rate limits)
      duration: 60 * 1000,
    },
  },
);

// ── Worker Event Handlers ─────────────────────────────────────────────────────

ingestWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Job completed");
});

ingestWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, "Job failed");
});

ingestWorker.on("stalled", (jobId) => {
  logger.warn({ jobId }, "Job stalled");
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await ingestWorker.close();
  process.exit(0);
});

logger.info("Worker started, waiting for jobs...");
```

---

## Part 7: Connector System

### 7.1 Connector Interface

```typescript
// packages/connectors/src/base.ts
import type { ConnectorConfig, Document } from "@ci/types";

export interface ConnectorDocument {
  externalId: string;
  title: string;
  content: string;
  mimeType: string;
  sourceUrl: string;
  metadata: Record<string, unknown>;
  lastModified: Date;
}

export abstract class BaseConnector {
  constructor(protected config: ConnectorConfig) {}

  abstract fetchDocuments(): AsyncGenerator<ConnectorDocument>;
  abstract fetchDocument(externalId: string): Promise<ConnectorDocument>;
  abstract validateCredentials(): Promise<boolean>;
  abstract getWebhookConfig(): { url: string; events: string[] } | null;
}
```

### 7.2 Notion Connector

```typescript
// packages/connectors/src/notion/index.ts
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import type { ConnectorConfig } from "@ci/types";
import { BaseConnector, type ConnectorDocument } from "../base";

export class NotionConnector extends BaseConnector {
  private client: Client;
  private n2m: NotionToMarkdown;

  constructor(config: ConnectorConfig) {
    super(config);
    const creds = this.decryptCredentials();
    this.client = new Client({ auth: creds.accessToken });
    this.n2m = new NotionToMarkdown({ notionClient: this.client });
  }

  async *fetchDocuments(): AsyncGenerator<ConnectorDocument> {
    let cursor: string | undefined;

    do {
      const response = await this.client.search({
        filter: { property: "object", value: "page" },
        page_size: 100,
        start_cursor: cursor,
      });

      for (const page of response.results) {
        if (page.object !== "page") continue;

        try {
          const doc = await this.fetchDocument(page.id);
          yield doc;
        } catch (error) {
          console.error(`Failed to fetch Notion page ${page.id}:`, error);
        }
      }

      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
    } while (cursor);
  }

  async fetchDocument(pageId: string): Promise<ConnectorDocument> {
    // Fetch page metadata
    const page = (await this.client.pages.retrieve({ page_id: pageId })) as any;

    // Convert blocks to Markdown
    const mdBlocks = await this.n2m.pageToMarkdown(pageId);
    const content = this.n2m.toMarkdownString(mdBlocks).parent;

    const title =
      page.properties?.title?.title?.[0]?.plain_text ??
      page.properties?.Name?.title?.[0]?.plain_text ??
      "Untitled";

    return {
      externalId: pageId,
      title,
      content,
      mimeType: "text/markdown",
      sourceUrl: page.url,
      metadata: {
        notionPageId: pageId,
        lastEditedBy: page.last_edited_by?.id,
        createdBy: page.created_by?.id,
        databaseId: page.parent?.database_id,
      },
      lastModified: new Date(page.last_edited_time),
    };
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.client.users.me();
      return true;
    } catch {
      return false;
    }
  }

  getWebhookConfig() {
    // Notion doesn't have webhooks yet — use polling
    return null;
  }

  private decryptCredentials() {
    // Decrypt AES-256-GCM encrypted credentials stored in DB
    // Implementation in packages/crypto
    return JSON.parse(Buffer.from(this.config.credentials.encrypted, "base64").toString());
  }
}
```

---

## Part 8: MCP Server for Agent Integration

```typescript
// apps/mcp-server/src/index.ts
// Exposes ContextInject as an MCP server — enables Claude, GPT, and any MCP-compatible agent to use it

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RetrievalPipeline } from "@ci/core";

const server = new McpServer({
  name: "context-inject",
  version: "1.0.0",
  description: "Intelligent context retrieval from your connected data sources",
});

// ── Tool: retrieve_context ────────────────────────────────────────────────────

server.tool(
  "retrieve_context",
  "Retrieve relevant context from connected data sources for a query",
  {
    query: z.string().describe("The question or topic to retrieve context for"),
    projectId: z.string().describe("The ContextInject project ID"),
    topK: z.number().optional().default(5).describe("Number of chunks to retrieve"),
    conversationId: z.string().optional().describe("Conversation ID for memory continuity"),
  },
  async ({ query, projectId, topK, conversationId }) => {
    const apiKey = process.env.CONTEXT_INJECT_API_KEY!;
    const baseUrl = process.env.CONTEXT_INJECT_URL ?? "https://api.contextinject.ai";

    const response = await fetch(`${baseUrl}/v1/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, projectId, topK, conversationId }),
    });

    if (!response.ok) {
      throw new Error(`ContextInject API error: ${response.status}`);
    }

    const result = await response.json();
    const { context, quality, usage } = result.data;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              context: context.text,
              citations: context.citations,
              qualityScore: quality.overall,
              warning: quality.warning,
              usage,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ── Tool: index_document ──────────────────────────────────────────────────────

server.tool(
  "index_document",
  "Add a document to ContextInject for future retrieval",
  {
    content: z.string().describe("Document text content"),
    title: z.string().describe("Document title"),
    projectId: z.string().describe("The ContextInject project ID"),
    sourceUrl: z.string().optional().describe("Source URL of the document"),
  },
  async ({ content, title, projectId, sourceUrl }) => {
    const apiKey = process.env.CONTEXT_INJECT_API_KEY!;
    const baseUrl = process.env.CONTEXT_INJECT_URL ?? "https://api.contextinject.ai";

    const formData = new FormData();
    const blob = new Blob([content], { type: "text/plain" });
    formData.append("file", blob, `${title}.txt`);
    formData.append("projectId", projectId);
    if (sourceUrl) formData.append("sourceUrl", sourceUrl);

    const response = await fetch(`${baseUrl}/v1/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    const result = await response.json();

    return {
      content: [
        {
          type: "text",
          text: `Document indexed successfully. ID: ${result.data.documentId}. Status: ${result.data.status}`,
        },
      ],
    };
  },
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("ContextInject MCP server running on stdio");
```

---

## Part 9: Public SDK

```typescript
// packages/sdk/src/index.ts — The developer-facing SDK

export interface ContextInjectConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface QueryOptions {
  topK?: number;
  conversationId?: string;
  filters?: Array<{ field: string; operator: string; value: unknown }>;
  stream?: boolean;
}

export interface UploadOptions {
  title?: string;
  metadata?: Record<string, unknown>;
}

export class ContextInject {
  private config: Required<ContextInjectConfig>;

  constructor(config: ContextInjectConfig) {
    this.config = {
      baseUrl: "https://api.contextinject.ai",
      timeout: 30000,
      ...config,
    };
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  async query(projectId: string, query: string, options: QueryOptions = {}) {
    return this.request("POST", "/v1/query", {
      query,
      projectId,
      topK: options.topK ?? 5,
      conversationId: options.conversationId,
      filters: options.filters,
    });
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  async uploadText(projectId: string, content: string, options: UploadOptions = {}) {
    const blob = new Blob([content], { type: "text/plain" });
    const title = options.title ?? `Document ${Date.now()}`;
    return this.uploadFile(projectId, blob, title, options);
  }

  async uploadFile(
    projectId: string,
    file: Blob | Buffer,
    filename: string,
    options: UploadOptions = {},
  ) {
    const formData = new FormData();
    const blob = file instanceof Buffer ? new Blob([file]) : file;
    formData.append("file", blob, filename);
    formData.append("projectId", projectId);
    if (options.metadata) {
      formData.append("metadata", JSON.stringify(options.metadata));
    }

    return this.requestFormData("POST", "/v1/documents/upload", formData);
  }

  async listDocuments(projectId: string, page = 1, limit = 20) {
    return this.request("GET", `/v1/documents?projectId=${projectId}&page=${page}&limit=${limit}`);
  }

  async deleteDocument(documentId: string) {
    return this.request("DELETE", `/v1/documents/${documentId}`);
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  async createProject(name: string, description?: string) {
    return this.request("POST", "/v1/projects", { name, description });
  }

  async listProjects() {
    return this.request("GET", "/v1/projects");
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getAnalytics(projectId: string, period = "7d") {
    return this.request("GET", `/v1/analytics?projectId=${projectId}&period=${period}`);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async request(method: string, path: string, body?: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "context-inject-sdk/1.0.0",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ContextInjectError(data.error ?? "Request failed", response.status, data.code);
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestFormData(method: string, path: string, body: FormData) {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "User-Agent": "context-inject-sdk/1.0.0",
      },
      body,
    });
    const data = await response.json();
    if (!response.ok) throw new ContextInjectError(data.error, response.status, data.code);
    return data;
  }
}

export class ContextInjectError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ContextInjectError";
  }
}

// ── SDK Usage Example ─────────────────────────────────────────────────────────
//
// import { ContextInject } from 'context-inject';
//
// const ci = new ContextInject({ apiKey: 'ci_live_...' });
//
// // Upload a document
// await ci.uploadText(projectId, '# My Document\n\nThis is my knowledge base...');
//
// // Query it
// const result = await ci.query(projectId, 'What is our refund policy?');
// console.log(result.data.context.text);
// console.log(result.data.quality.overall); // 0.87
```

---

## Part 10: Local Development Stack

### 10.1 Docker Compose

```yaml
# infra/docker/docker-compose.yml

version: "3.9"

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: ci_postgres
    environment:
      POSTGRES_DB: context_inject
      POSTGRES_USER: ci_user
      POSTGRES_PASSWORD: ci_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ci_user -d context_inject"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7.2-alpine
    container_name: ci_redis
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s

  qdrant:
    image: qdrant/qdrant:v1.9.0
    container_name: ci_qdrant
    ports:
      - "6333:6333" # REST API
      - "6334:6334" # gRPC
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__HTTP_PORT: 6333
      QDRANT__SERVICE__GRPC_PORT: 6334

  # Langfuse for observability (optional in dev)
  langfuse:
    image: langfuse/langfuse:latest
    container_name: ci_langfuse
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3001:3000"
    environment:
      DATABASE_URL: postgresql://ci_user:ci_password@postgres:5432/langfuse
      NEXTAUTH_SECRET: dev-secret-change-in-prod
      NEXTAUTH_URL: http://localhost:3001
      LANGFUSE_INIT_ORG_ID: ci-dev
      LANGFUSE_INIT_PROJECT_ID: ci-project

  # BullMQ Dashboard (optional)
  bull-dashboard:
    image: felixmosh/bull-board:latest
    container_name: ci_bull_dashboard
    ports:
      - "3002:3000"
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379

volumes:
  postgres_data:
  redis_data:
  qdrant_data:
```

### 10.2 Environment Variables

```bash
# .env.local — Copy to each app that needs it
DATABASE_URL=postgresql://ci_user:ci_password@localhost:5432/context_inject
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=

# External APIs
COHERE_API_KEY=your_cohere_key_here
OPENAI_API_KEY=your_openai_key_here  # Fallback embedding option

# Security
ENCRYPTION_KEY=your-32-byte-hex-key-for-credential-encryption
JWT_SECRET=your-jwt-secret

# Observability
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=http://localhost:3001

# Connectors OAuth
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# App
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
```

---

## Part 11: Build Sequence — What to Build in What Order

### Phase 1: Core Pipeline (Weeks 1-4)

Build the non-negotiables that everything else depends on:

```
Week 1:  packages/types      — Complete type system (all interfaces)
         packages/db         — Schema + migrations + client
         packages/logger     — Structured logging (Pino)

Week 2:  packages/vector-store  — Qdrant adapter + IVectorStore interface
         packages/embeddings    — Cohere adapter + IEmbeddingProvider interface
         packages/chunker       — Semantic chunker with overlap

Week 3:  packages/core/ingestion  — Full ingestion pipeline (end-to-end working)
         packages/core/retrieval  — Full retrieval pipeline (end-to-end working)
         packages/queue           — BullMQ job definitions + queue factory

Week 4:  apps/worker           — Background worker with retry logic
         apps/api (skeleton)   — Express app + auth + basic endpoints
         Integration test      — Full flow: upload PDF → chunk → embed → store → query
```

### Phase 2: API & Developer Experience (Weeks 5-8)

```
Week 5:  apps/api (complete)  — All routes: query, documents, projects, connectors
         packages/sdk          — TypeScript SDK with JSDoc
         Documentation v1      — README + quickstart + API reference

Week 6:  packages/connectors/notion    — Notion connector with OAuth
         packages/connectors/direct-upload — PDF/DOCX/TXT processing via LlamaParse

Week 7:  packages/reranker     — Cohere Rerank 3.5 integration
         packages/compressor   — LLMLingua-2 integration
         packages/evaluator    — Context quality scoring (RAGAS-style)

Week 8:  packages/cache        — Semantic cache with Redis + cosine similarity
         apps/mcp-server       — MCP server for Claude/GPT agent integration
         End-to-end tests      — Integration tests for full pipeline
```

### Phase 3: Dashboard & GTM Readiness (Weeks 9-12)

```
Week 9:   apps/dashboard   — Next.js dashboard: document management, project config
Week 10:  Billing          — Stripe integration + usage metering
Week 11:  packages/connectors/slack, /gmail, /github
Week 12:  Security audit   — Rate limiting, injection protection, auth hardening
          Alpha launch      — First 20 users onboarded manually
```

---

## Part 12: Testing Strategy

```typescript
// Example integration test — run the full pipeline
// tests/integration/pipeline.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ContextInject } from "@ci/sdk";

const ci = new ContextInject({
  apiKey: process.env.TEST_API_KEY!,
  baseUrl: "http://localhost:3000",
});

const PROJECT_ID = process.env.TEST_PROJECT_ID!;

describe("Full Pipeline Integration", () => {
  let documentId: string;

  it("should upload and index a document", async () => {
    const result = await ci.uploadText(
      PROJECT_ID,
      `# Refund Policy\n\nWe offer full refunds within 30 days of purchase.\nNo questions asked.`,
      { title: "Test Refund Policy" },
    );
    expect(result.data.status).toBe("processing");
    documentId = result.data.documentId;
  }, 10_000);

  it("should retrieve relevant context for a query", async () => {
    // Wait for indexing to complete
    await new Promise((r) => setTimeout(r, 5000));

    const result = await ci.query(PROJECT_ID, "What is the refund policy?");
    expect(result.data.chunks).toBeDefined();
    expect(result.data.chunks.length).toBeGreaterThan(0);
    expect(result.data.context.text).toContain("30 days");
    expect(result.data.quality.overall).toBeGreaterThan(0.5);
  }, 15_000);

  it("should return cache hit on repeated query", async () => {
    const result = await ci.query(PROJECT_ID, "What is the refund policy?");
    expect(result.data.cacheHit).toBe(true);
  });

  afterAll(async () => {
    if (documentId) await ci.deleteDocument(documentId);
  });
});
```

---

## Part 13: CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_DB: ci_test
          POSTGRES_USER: ci_user
          POSTGRES_PASSWORD: ci_password
        ports: ["5432:5432"]
      redis:
        image: redis:7.2-alpine
        ports: ["6379:6379"]
      qdrant:
        image: qdrant/qdrant:v1.9.0
        ports: ["6333:6333"]

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "pnpm" }

      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm lint
      - run: pnpm db:migrate
        env:
          DATABASE_URL: postgresql://ci_user:ci_password@localhost:5432/ci_test
      - run: pnpm test
        env:
          DATABASE_URL: postgresql://ci_user:ci_password@localhost:5432/ci_test
          REDIS_URL: redis://localhost:6379
          QDRANT_URL: http://localhost:6333
          COHERE_API_KEY: ${{ secrets.COHERE_API_KEY }}

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Railway / Fly.io
        run: echo "Deploy step here"
```

---

## Summary: The Correct Build Order

```
1. @ci/types              — Foundation (all interfaces)
2. @ci/db                 — Database schema + client
3. @ci/logger             — Logging
4. @ci/vector-store       — Qdrant abstraction
5. @ci/embeddings         — Cohere embedding
6. @ci/chunker            — Semantic chunking
7. @ci/core (ingestion)   — Ingest pipeline
8. @ci/core (retrieval)   — Query pipeline
9. @ci/queue              — BullMQ jobs
10. apps/worker           — Job processor
11. apps/api              — HTTP API
12. @ci/sdk               — TypeScript SDK
13. apps/mcp-server       — MCP agent integration
14. @ci/reranker          — Cohere Rerank
15. @ci/compressor        — LLMLingua-2
16. @ci/cache             — Semantic cache
17. @ci/evaluator         — Quality scoring
18. packages/connectors/* — Notion, Gmail, Slack, GitHub
19. apps/dashboard        — Next.js UI
20. Billing + compliance  — Stripe + SOC2 preparation
```

**Rule: Never move to the next item until the current one has a passing integration test. The pipeline is only as strong as its weakest, untested link.**
