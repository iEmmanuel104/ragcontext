# Phase 1.02: Type System

> `@ci/types` — The shared TypeScript type system that every package depends on.

---

## Objectives

1. Define all shared interfaces in a single `@ci/types` package
2. Ensure every other package imports types from `@ci/types` (single source of truth)
3. Cover all domains: tenants, auth, documents, chunks, pipeline config, queries, jobs, connectors, events
4. Export Zod schemas alongside interfaces for runtime validation where needed

## Deliverables

- `packages/types/src/index.ts` — Complete type definitions
- `packages/types/package.json` — Package configuration
- `packages/types/tsconfig.json` — TypeScript configuration

---

## Package Structure

```
packages/types/
├── src/
│   ├── index.ts          # Re-exports all types
│   ├── tenant.ts         # Tenant, TenantSettings, Plan
│   ├── auth.ts           # ApiKey, ApiKeyScope, Role, Session
│   ├── document.ts       # Document, DocumentStatus, AccessControl
│   ├── chunk.ts          # Chunk, ChunkMetadata
│   ├── pipeline.ts       # PipelineConfig and sub-configs
│   ├── query.ts          # QueryRequest, QueryResult, QueryFilter
│   ├── retrieval.ts      # RankedChunk, AssembledContext, Citation, QualityScore
│   ├── job.ts            # JobType, Job, job data interfaces
│   ├── connector.ts      # ConnectorConfig, ConnectorType, SyncConfig
│   ├── usage.ts          # UsageMetrics, UsageEvent
│   ├── conversation.ts   # Conversation, Message
│   └── common.ts         # Pagination, SortOrder, shared utility types
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### `packages/types/package.json`

```json
{
  "name": "@ci/types",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  }
}
```

---

## Complete Type Definitions

### `tenant.ts` — Tenant & Account Types

```typescript
export type Plan = "free" | "starter" | "pro" | "enterprise";

export interface Tenant {
  id: string; // UUID
  name: string;
  slug: string; // URL-safe identifier (e.g., "acme-corp")
  plan: Plan;
  settings: TenantSettings;
  stripeCustomerId?: string;
  region: "us" | "eu" | "apac"; // Data residency — set at creation, immutable
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSettings {
  maxDocuments: number;
  maxRetrievalsPerMonth: number;
  maxProjectsCount: number;
  maxUsersCount: number;
  allowedConnectors: ConnectorType[];
  retentionDays: number;
  encryptionKeyId?: string; // BYOK for enterprise tier
  features: TenantFeatures;
}

export interface TenantFeatures {
  reranking: boolean;
  compression: boolean;
  semanticCache: boolean;
  qualityScoring: boolean;
  hybridSearch: boolean;
  customPipeline: boolean;
  auditLogs: boolean;
  sso: boolean;
}

export const PLAN_LIMITS: Record<
  Plan,
  Omit<TenantSettings, "encryptionKeyId" | "features"> & { features: TenantFeatures }
> = {
  free: {
    maxDocuments: 1000,
    maxRetrievalsPerMonth: 5000,
    maxProjectsCount: 1,
    maxUsersCount: 1,
    allowedConnectors: ["direct-upload"],
    retentionDays: 30,
    features: {
      reranking: false,
      compression: false,
      semanticCache: false,
      qualityScoring: false,
      hybridSearch: false,
      customPipeline: false,
      auditLogs: false,
      sso: false,
    },
  },
  starter: {
    maxDocuments: 25000,
    maxRetrievalsPerMonth: 50000,
    maxProjectsCount: 3,
    maxUsersCount: 3,
    allowedConnectors: ["direct-upload", "notion", "google-drive"],
    retentionDays: 90,
    features: {
      reranking: true,
      compression: false,
      semanticCache: false,
      qualityScoring: false,
      hybridSearch: true,
      customPipeline: false,
      auditLogs: false,
      sso: false,
    },
  },
  pro: {
    maxDocuments: 100000,
    maxRetrievalsPerMonth: -1, // unlimited (fair use)
    maxProjectsCount: -1,
    maxUsersCount: 10,
    allowedConnectors: [
      "direct-upload",
      "notion",
      "google-drive",
      "slack",
      "gmail",
      "github",
      "confluence",
    ],
    retentionDays: 365,
    features: {
      reranking: true,
      compression: true,
      semanticCache: true,
      qualityScoring: true,
      hybridSearch: true,
      customPipeline: true,
      auditLogs: false,
      sso: false,
    },
  },
  enterprise: {
    maxDocuments: -1,
    maxRetrievalsPerMonth: -1,
    maxProjectsCount: -1,
    maxUsersCount: -1,
    allowedConnectors: [
      "direct-upload",
      "notion",
      "google-drive",
      "slack",
      "gmail",
      "github",
      "confluence",
      "jira",
      "sharepoint",
      "web-crawler",
    ],
    retentionDays: -1,
    features: {
      reranking: true,
      compression: true,
      semanticCache: true,
      qualityScoring: true,
      hybridSearch: true,
      customPipeline: true,
      auditLogs: true,
      sso: true,
    },
  },
};
```

### `auth.ts` — Authentication & Authorization Types

```typescript
export type ApiKeyScope =
  | "documents:read"
  | "documents:write"
  | "query"
  | "connectors"
  | "analytics"
  | "admin";

export type Role = "owner" | "admin" | "member" | "viewer";

export interface ApiKey {
  id: string;
  tenantId: string;
  keyHash: string; // SHA-256 of the actual key — never store raw
  prefix: string; // "ci_live_" or "ci_test_" for display
  name: string; // Human-readable label
  scopes: ApiKeyScope[];
  environment: "live" | "test";
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string; // Argon2id
  emailVerified: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface JwtPayload {
  sub: string; // User ID
  tid: string; // Tenant ID
  role: Role;
  iat: number;
  exp: number;
}

export interface OAuthState {
  tenantId: string;
  connectorType: ConnectorType;
  redirectUrl: string;
  codeVerifier: string; // PKCE
  nonce: string;
}

export const ROLE_PERMISSIONS: Record<Role, ApiKeyScope[]> = {
  owner: ["documents:read", "documents:write", "query", "connectors", "analytics", "admin"],
  admin: ["documents:read", "documents:write", "query", "connectors", "analytics"],
  member: ["documents:read", "documents:write", "query"],
  viewer: ["documents:read", "query"],
};
```

### `document.ts` — Document Types

```typescript
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
  connectorId?: string;
  connectorType: ConnectorType;
  externalId?: string; // ID in source system (Notion page ID, etc.)
  title: string;
  sourceUrl?: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string; // SHA-256 of raw content — for change detection
  status: DocumentStatus;
  chunkCount: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
  accessControl: AccessControl;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  indexedAt?: Date;
  deletedAt?: Date; // Soft delete for GDPR cascading deletion
}

export interface AccessControl {
  ownerId?: string;
  groupIds?: string[];
  isPublic: boolean;
  customTags?: string[];
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  pipelineConfig: PipelineConfig;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### `chunk.ts` — Chunk Types

```typescript
export interface Chunk {
  id: string;
  documentId: string;
  tenantId: string;
  projectId: string;
  content: string;
  tokenCount: number;
  chunkIndex: number; // Position within document (0-based)
  vectorId: string; // Corresponding point ID in Qdrant
  metadata: ChunkMetadata;
  createdAt: Date;
}

export interface ChunkMetadata {
  pageNumber?: number;
  sectionTitle?: string;
  headingPath?: string[]; // Breadcrumb: ["Chapter 1", "Section 2", "Subsection A"]
  startOffset: number; // Character offset in original document
  endOffset: number;
  language?: string;
  documentTitle?: string; // Denormalized for display
  sourceUrl?: string; // Denormalized for citations
}
```

### `pipeline.ts` — Pipeline Configuration Types

```typescript
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
  provider: "cohere" | "openai" | "bgem3";
  model: string; // e.g., 'embed-v4.0'
  dimensions: number; // e.g., 1024 (Matryoshka: 256, 512, 768, 1024, 1536)
  batchSize: number; // Documents per embedding batch (default: 96 for Cohere)
}

export interface RetrievalConfig {
  topK: number; // Candidates to retrieve from vector search (default: 100)
  hybridAlpha: number; // 0=BM25 only, 1=dense only (default: 0.7)
  filterByAccessControl: boolean;
  scoreThreshold?: number; // Minimum similarity score (0-1)
}

export interface RerankingConfig {
  enabled: boolean;
  provider: "cohere" | "bgereranker";
  model: string; // e.g., 'rerank-v3.5'
  topN: number; // Final chunks after reranking (default: 5)
}

export interface CompressionConfig {
  enabled: boolean;
  targetRatio: number; // Compression ratio (default: 0.5 = 50% token reduction)
  method: "llmlingua" | "extractive" | "summary";
}

export interface CachingConfig {
  enabled: boolean;
  similarityThreshold: number; // Cosine similarity for cache hit (default: 0.90)
  ttlSeconds: number; // Cache TTL (default: 3600)
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  chunking: { strategy: "semantic", maxTokens: 512, overlapTokens: 50, minTokens: 100 },
  embedding: { provider: "cohere", model: "embed-v4.0", dimensions: 1024, batchSize: 96 },
  retrieval: { topK: 100, hybridAlpha: 0.7, filterByAccessControl: true },
  reranking: { enabled: true, provider: "cohere", model: "rerank-v3.5", topN: 5 },
  compression: { enabled: false, targetRatio: 0.5, method: "llmlingua" },
  caching: { enabled: true, similarityThreshold: 0.9, ttlSeconds: 3600 },
};
```

### `query.ts` — Query Request Types

```typescript
export interface QueryRequest {
  query: string;
  projectId: string;
  conversationId?: string; // For conversation memory continuity
  topK?: number; // Override pipeline default (max 20)
  filters?: QueryFilter[];
  config?: Partial<PipelineConfig>; // Per-query overrides
  includeMetadata?: boolean;
  stream?: boolean; // Enable SSE streaming
}

export interface QueryFilter {
  field: string; // e.g., 'metadata.author', 'connectorType'
  operator: "eq" | "neq" | "in" | "nin" | "contains" | "gte" | "lte";
  value: unknown;
}
```

### `retrieval.ts` — Retrieval Result Types

```typescript
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
  bm25Score: number; // Raw BM25 score (0 if sparse not used)
  rerankScore?: number; // Cross-encoder score from reranker
}

export interface AssembledContext {
  text: string; // Final context string ready for LLM injection
  tokenCount: number;
  chunks: RankedChunk[];
  citations: Citation[];
  compressionRatio?: number; // Original tokens / compressed tokens
}

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceUrl?: string;
  pageNumber?: number;
  sectionTitle?: string;
  excerpt: string; // Short quote for attribution (~200 chars)
}

export interface ContextQualityScore {
  overall: number; // 0-1 composite score
  retrievalConfidence: number; // How relevant are the retrieved chunks
  contextSufficiency: number; // Does context contain enough information
  diversityScore: number; // Source diversity (prevents echo chamber)
  estimatedFaithfulness: number; // Pre-generation faithfulness prediction
  warning?: string; // e.g., "Low confidence — consider rephrasing"
}
```

### `usage.ts` — Usage & Billing Types

```typescript
export interface UsageMetrics {
  documentsScanned: number;
  chunksRetrieved: number;
  chunksAfterRerank: number;
  tokensBeforeCompression: number;
  tokensAfterCompression: number;
  embeddingTokens: number;
}

export type UsageEventType =
  | "retrieval"
  | "page_ingested"
  | "page_deleted"
  | "embedding_generated"
  | "rerank_call"
  | "connector_sync";

export interface UsageEvent {
  id: string;
  tenantId: string;
  eventType: UsageEventType;
  quantity: number;
  metadata: Record<string, unknown>;
  billedAt?: Date;
  createdAt: Date;
}
```

### `job.ts` — Background Job Types

```typescript
export type JobType =
  | "ingest-document"
  | "sync-connector"
  | "delete-document"
  | "reindex-project"
  | "generate-embeddings"
  | "cleanup-expired";

export interface Job<T = unknown> {
  id: string;
  type: JobType;
  tenantId: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  priority: number;
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

export interface SyncConnectorJobData {
  connectorId: string;
  tenantId: string;
  projectId: string;
  fullSync: boolean; // true = re-fetch all; false = incremental
}

export interface DeleteDocumentJobData {
  documentId: string;
  tenantId: string;
  projectId: string;
  vectorIds: string[]; // Qdrant point IDs to remove
}

export interface ReindexProjectJobData {
  projectId: string;
  tenantId: string;
  pipelineConfig: PipelineConfig;
}
```

### `connector.ts` — Connector Types

```typescript
export interface ConnectorConfig {
  id: string;
  tenantId: string;
  projectId: string;
  type: ConnectorType;
  credentials: EncryptedCredentials;
  syncConfig: SyncConfig;
  status: "active" | "paused" | "error" | "disconnected";
  errorMessage?: string;
  lastSyncAt?: Date;
  nextSyncAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EncryptedCredentials {
  ciphertext: string; // AES-256-GCM encrypted JSON
  iv: string; // Initialization vector (hex)
  authTag: string; // GCM authentication tag (hex)
  keyVersion: number; // Encryption key version (for rotation)
}

export interface SyncConfig {
  intervalMinutes: number; // Sync frequency (default: 60)
  includeFilters?: string[]; // Glob patterns to include
  excludeFilters?: string[]; // Glob patterns to exclude
  maxDocuments?: number; // Max docs per sync
}

export interface ConnectorDocument {
  externalId: string;
  title: string;
  content: string;
  mimeType: string;
  sourceUrl: string;
  metadata: Record<string, unknown>;
  lastModified: Date;
  sizeBytes: number;
}
```

### `conversation.ts` — Memory Types

```typescript
export interface Conversation {
  id: string;
  tenantId: string;
  projectId: string;
  title?: string;
  summary?: string; // Mid-term memory: compressed conversation summary
  messages: ConversationMessage[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: {
    queryId?: string;
    qualityScore?: number;
    tokensUsed?: number;
  };
}
```

### `common.ts` — Shared Utility Types

```typescript
export interface PaginatedRequest {
  cursor?: string; // Cursor-based pagination (NOT offset-based)
  limit?: number; // Default: 20, max: 100
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
  total?: number; // Only included when explicitly requested
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiErrorResponse;
  requestId: string;
}

export interface ApiErrorResponse {
  code: string; // Machine-readable error code
  message: string; // Human-readable description
  details?: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId?: string;
  apiKeyId?: string;
  action: string; // e.g., 'document.create', 'project.delete'
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
}
```

---

## Versioning Approach

The `@ci/types` package uses **0.x semver** during development:

- **0.x.y** where x increments for breaking changes and y for additions
- All internal packages use `workspace:*` to always get the latest version
- The public SDK (`@ci/sdk`) re-exports a subset of types — breaking changes in `@ci/types` do not automatically break the SDK

When the public API stabilizes (Phase 3), types exposed through the SDK will be frozen at **1.0.0** with standard semver guarantees.

---

## Export Strategy

The barrel `index.ts` re-exports everything:

```typescript
// packages/types/src/index.ts
export * from "./tenant.js";
export * from "./auth.js";
export * from "./document.js";
export * from "./chunk.js";
export * from "./pipeline.js";
export * from "./query.js";
export * from "./retrieval.js";
export * from "./usage.js";
export * from "./job.js";
export * from "./connector.js";
export * from "./conversation.js";
export * from "./common.js";
```

---

## Testing Requirements

- Type-only package: compile test via `tsc --noEmit`
- Validate `DEFAULT_PIPELINE_CONFIG` satisfies `PipelineConfig`
- Validate `PLAN_LIMITS` entries satisfy `TenantSettings`
- Validate `ROLE_PERMISSIONS` covers all roles

---

_Related: [Phase 1 Overview](./README.md) | [Project Setup](./01-project-setup.md) | [Database Layer](./03-database-layer.md)_
