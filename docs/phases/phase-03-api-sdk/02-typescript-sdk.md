# 02 — TypeScript SDK

> **Package**: `packages/sdk` | **npm name**: `contextinject` | **Namespace**: `@ci/sdk`
> **Entry Point**: `packages/sdk/src/index.ts`

---

## Overview

The TypeScript SDK is the primary developer interface to ContextInject. It is published to npm as `contextinject` (public) and used internally as `@ci/sdk`. The SDK wraps all REST API calls with TypeScript-first types, retry logic with exponential backoff, AbortController timeout handling, SSE streaming support, and comprehensive JSDoc documentation.

Design goals:

- Zero external runtime dependencies (uses native `fetch`, `AbortController`, `FormData`)
- Works in Node.js 22+, Deno, Bun, and modern browsers
- Tree-shakeable ESM build with CJS fallback
- Bundle size <50KB minified+gzipped
- Full type inference on all method returns

---

## Package Configuration

```json
// packages/sdk/package.json
{
  "name": "contextinject",
  "version": "0.1.0",
  "description": "TypeScript SDK for ContextInject — intelligent RAG middleware",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/contextinject/contextinject"
  },
  "keywords": ["rag", "retrieval", "ai", "context", "embedding", "vector-search"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest",
    "lint": "eslint src/"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0",
    "msw": "^2.0.0"
  }
}
```

```typescript
// packages/sdk/tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false, // Let consumers minify
  target: "es2022",
});
```

---

## Core SDK Class

````typescript
// packages/sdk/src/index.ts

export interface ContextInjectConfig {
  /** API key starting with ci_live_ or ci_test_ */
  apiKey: string;
  /** Base URL of the ContextInject API. Defaults to https://api.contextinject.ai */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30000 */
  timeout?: number;
  /** Maximum retry attempts for transient errors. Defaults to 3 */
  maxRetries?: number;
  /** Custom fetch implementation (for testing or custom HTTP clients) */
  fetch?: typeof globalThis.fetch;
}

export interface QueryOptions {
  /** Number of chunks to return (1-20). Defaults to 5 */
  topK?: number;
  /** Conversation ID for multi-turn context memory */
  conversationId?: string;
  /** Metadata filters to narrow search scope */
  filters?: QueryFilter[];
  /** Enable SSE streaming of pipeline steps */
  stream?: boolean;
}

export interface QueryFilter {
  field: string;
  operator: "eq" | "neq" | "in" | "nin" | "contains";
  value: unknown;
}

export interface UploadOptions {
  /** Document title. Defaults to filename or timestamp */
  title?: string;
  /** Custom metadata to attach to the document */
  metadata?: Record<string, unknown>;
}

export interface ListOptions {
  /** Page number (1-indexed). Defaults to 1 */
  page?: number;
  /** Items per page (1-100). Defaults to 20 */
  limit?: number;
  /** Filter by document status */
  status?: "pending" | "processing" | "indexed" | "failed";
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

export interface RankedChunk {
  id: string;
  documentId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface AssembledContext {
  text: string;
  tokenCount: number;
  citations: Citation[];
}

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceUrl?: string;
  pageNumber?: number;
  excerpt: string;
}

export interface ContextQualityScore {
  overall: number;
  retrievalConfidence: number;
  contextSufficiency: number;
  diversityScore: number;
  estimatedFaithfulness: number;
  warning?: string;
}

export interface UsageMetrics {
  documentsScanned: number;
  chunksRetrieved: number;
  chunksAfterRerank: number;
  tokensBeforeCompression: number;
  tokensAfterCompression: number;
  embeddingTokens: number;
}

export interface DocumentInfo {
  id: string;
  title: string;
  status: string;
  chunkCount: number;
  tokenCount: number;
  connectorType: string;
  createdAt: string;
  indexedAt?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  documentCount: number;
  createdAt: string;
}

export interface AnalyticsData {
  period: string;
  totalQueries: number;
  avgLatencyMs: number;
  cacheHitRate: number;
  avgQualityScore: number;
  queriesOverTime: Array<{ date: string; count: number }>;
}

/**
 * ContextInject SDK — the simplest way to add RAG to any application.
 *
 * @example
 * ```typescript
 * import { ContextInject } from 'contextinject';
 *
 * const ci = new ContextInject({ apiKey: 'ci_live_...' });
 *
 * // Upload a document
 * const doc = await ci.uploadText('proj_123', 'Your document content here');
 *
 * // Query it
 * const result = await ci.query('proj_123', 'What is the refund policy?');
 * console.log(result.data.context.text);
 * console.log(result.data.quality.overall); // 0.87
 * ```
 */
export class ContextInject {
  private config: Required<
    Pick<ContextInjectConfig, "apiKey" | "baseUrl" | "timeout" | "maxRetries">
  >;
  private fetchFn: typeof globalThis.fetch;

  constructor(config: ContextInjectConfig) {
    if (!config.apiKey) throw new Error("apiKey is required");
    if (!config.apiKey.startsWith("ci_")) {
      throw new Error("Invalid API key format. Keys must start with ci_");
    }

    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? "https://api.contextinject.ai",
      timeout: config.timeout ?? 30_000,
      maxRetries: config.maxRetries ?? 3,
    };
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /**
   * Retrieve relevant context for a query from a project's indexed documents.
   *
   * @param projectId - The project to query against
   * @param query - The natural language query
   * @param options - Optional query configuration
   * @returns Query result with ranked chunks, assembled context, and quality score
   *
   * @example
   * ```typescript
   * const result = await ci.query('proj_123', 'What is our refund policy?');
   * console.log(result.data.context.text);
   * console.log(result.data.quality.overall);
   * ```
   */
  async query(
    projectId: string,
    query: string,
    options: QueryOptions = {},
  ): Promise<ApiResponse<QueryResult>> {
    return this.request<QueryResult>("POST", "/v1/query", {
      query,
      projectId,
      topK: options.topK ?? 5,
      conversationId: options.conversationId,
      filters: options.filters,
      stream: options.stream ?? false,
    });
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  /**
   * Upload plain text content as a document.
   *
   * @param projectId - Target project
   * @param content - Text content to index
   * @param options - Upload options (title, metadata)
   * @returns Document info with processing status
   *
   * @example
   * ```typescript
   * const doc = await ci.uploadText('proj_123', '# My Doc\n\nContent here');
   * console.log(doc.data.documentId); // UUID
   * console.log(doc.data.status);     // 'processing'
   * ```
   */
  async uploadText(
    projectId: string,
    content: string,
    options: UploadOptions = {},
  ): Promise<ApiResponse<{ documentId: string; status: string }>> {
    const title = options.title ?? `Document ${Date.now()}`;
    const blob = new Blob([content], { type: "text/plain" });
    return this.uploadFile(projectId, blob, `${title}.txt`, options);
  }

  /**
   * Upload a file (PDF, DOCX, HTML, TXT, Markdown) for indexing.
   *
   * @param projectId - Target project
   * @param file - File as Blob, Buffer, or File
   * @param filename - Filename including extension
   * @param options - Upload options (title, metadata)
   * @returns Document info with processing status
   *
   * @example
   * ```typescript
   * import { readFile } from 'fs/promises';
   * const pdf = await readFile('./report.pdf');
   * const doc = await ci.uploadFile('proj_123', pdf, 'report.pdf');
   * ```
   */
  async uploadFile(
    projectId: string,
    file: Blob | Buffer,
    filename: string,
    options: UploadOptions = {},
  ): Promise<ApiResponse<{ documentId: string; status: string }>> {
    const formData = new FormData();
    const blob = file instanceof Buffer ? new Blob([file]) : file;
    formData.append("file", blob, filename);
    formData.append("projectId", projectId);
    if (options.title) formData.append("title", options.title);
    if (options.metadata) formData.append("metadata", JSON.stringify(options.metadata));

    return this.requestFormData<{ documentId: string; status: string }>(
      "POST",
      "/v1/documents/upload",
      formData,
    );
  }

  /**
   * List documents in a project with pagination.
   *
   * @param projectId - Project to list documents from
   * @param options - Pagination and filter options
   *
   * @example
   * ```typescript
   * const docs = await ci.listDocuments('proj_123', { status: 'indexed' });
   * docs.data.items.forEach(doc => console.log(doc.title));
   * ```
   */
  async listDocuments(
    projectId: string,
    options: ListOptions = {},
  ): Promise<ApiResponse<{ items: DocumentInfo[]; total: number; page: number }>> {
    const params = new URLSearchParams({
      projectId,
      page: String(options.page ?? 1),
      limit: String(Math.min(options.limit ?? 20, 100)),
    });
    if (options.status) params.set("status", options.status);
    return this.request("GET", `/v1/documents?${params}`);
  }

  /**
   * Get a single document's details and processing status.
   *
   * @param documentId - The document UUID
   */
  async getDocument(documentId: string): Promise<ApiResponse<DocumentInfo>> {
    return this.request("GET", `/v1/documents/${documentId}`);
  }

  /**
   * Delete a document and all its chunks/vectors.
   *
   * @param documentId - The document UUID to delete
   *
   * @example
   * ```typescript
   * await ci.deleteDocument('doc_uuid');
   * ```
   */
  async deleteDocument(documentId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.request("DELETE", `/v1/documents/${documentId}`);
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  /**
   * Create a new project. Projects isolate documents and queries.
   *
   * @param name - Project name
   * @param description - Optional description
   *
   * @example
   * ```typescript
   * const project = await ci.createProject('My Knowledge Base');
   * console.log(project.data.id); // Use this for uploads and queries
   * ```
   */
  async createProject(name: string, description?: string): Promise<ApiResponse<ProjectInfo>> {
    return this.request("POST", "/v1/projects", { name, description });
  }

  /**
   * List all projects for the authenticated tenant.
   */
  async listProjects(): Promise<ApiResponse<{ items: ProjectInfo[] }>> {
    return this.request("GET", "/v1/projects");
  }

  /**
   * Get a project's details including pipeline configuration.
   */
  async getProject(projectId: string): Promise<ApiResponse<ProjectInfo>> {
    return this.request("GET", `/v1/projects/${projectId}`);
  }

  // ── Analytics ──────────────────────────────────────────────────────────────

  /**
   * Get analytics for a project.
   *
   * @param projectId - Project to get analytics for
   * @param period - Time period: '24h', '7d', '30d', '90d'
   */
  async getAnalytics(
    projectId: string,
    period: "24h" | "7d" | "30d" | "90d" = "7d",
  ): Promise<ApiResponse<AnalyticsData>> {
    return this.request("GET", `/v1/analytics?projectId=${projectId}&period=${period}`);
  }

  // ── Internal: HTTP Client ──────────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.executeWithRetry(async (signal) => {
      const response = await this.fetchFn(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": `contextinject-sdk/${SDK_VERSION}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });

      return this.handleResponse<T>(response);
    });
  }

  private async requestFormData<T>(
    method: string,
    path: string,
    body: FormData,
  ): Promise<ApiResponse<T>> {
    return this.executeWithRetry(async (signal) => {
      const response = await this.fetchFn(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "User-Agent": `contextinject-sdk/${SDK_VERSION}`,
          // Don't set Content-Type — fetch sets multipart boundary automatically
        },
        body,
        signal,
      });

      return this.handleResponse<T>(response);
    });
  }

  private async handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
    const data = (await response.json()) as any;

    if (!response.ok) {
      throw new ContextInjectError(
        data.error?.message ?? `Request failed with status ${response.status}`,
        response.status,
        data.error?.code,
        data.error?.details,
        data.requestId,
      );
    }

    return {
      data: data.data as T,
      requestId: data.requestId,
    };
  }

  private async executeWithRetry<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const result = await fn(controller.signal);
        return result;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (error instanceof ContextInjectError) {
          if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
            throw error;
          }
        }

        // Don't retry on abort (timeout)
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new ContextInjectError(
            `Request timed out after ${this.config.timeout}ms`,
            0,
            "TIMEOUT",
          );
        }

        // Exponential backoff: 500ms, 1s, 2s
        if (attempt < this.config.maxRetries) {
          const delay = Math.min(500 * Math.pow(2, attempt), 10_000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }
}

const SDK_VERSION = "0.1.0";

// ── API Response Wrapper ─────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  requestId?: string;
}

// ── Error Class ──────────────────────────────────────────────────────────────

/**
 * Error thrown by the ContextInject SDK for API errors.
 *
 * @example
 * ```typescript
 * try {
 *   await ci.query('proj_123', 'test');
 * } catch (error) {
 *   if (error instanceof ContextInjectError) {
 *     console.log(error.statusCode); // 401
 *     console.log(error.code);       // 'UNAUTHORIZED'
 *   }
 * }
 * ```
 */
export class ContextInjectError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ContextInjectError";
  }
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export type {
  ContextInjectConfig,
  QueryOptions,
  QueryFilter,
  UploadOptions,
  ListOptions,
  QueryResult,
  RankedChunk,
  AssembledContext,
  Citation,
  ContextQualityScore,
  UsageMetrics,
  DocumentInfo,
  ProjectInfo,
  AnalyticsData,
};
````

---

## SSE Streaming Support

For real-time visibility into pipeline execution steps, the SDK supports Server-Sent Events streaming:

```typescript
// Usage example: streaming query
const ci = new ContextInject({ apiKey: "ci_live_..." });

// Stream pipeline steps
const eventSource = ci.queryStream("proj_123", "What is the refund policy?");
eventSource.onStep((step, data) => {
  console.log(`Pipeline step: ${step}`, data);
  // "embedding" -> { latencyMs: 12 }
  // "vector_search" -> { candidatesFound: 87 }
  // "reranking" -> { topChunks: 5 }
  // "compression" -> { ratio: 0.48 }
  // "complete" -> { ...full QueryResult }
});
```

The streaming implementation uses the native `EventSource` API in browsers and a lightweight SSE parser for Node.js, keeping the zero-dependency constraint.

---

## Usage Examples

### Basic Retrieval

```typescript
import { ContextInject } from "contextinject";

const ci = new ContextInject({ apiKey: "ci_live_abc123" });

// Create a project
const project = await ci.createProject("Customer Support KB");

// Upload documents
await ci.uploadText(
  project.data.id,
  `
  # Refund Policy
  We offer full refunds within 30 days of purchase.
  No questions asked. Contact support@example.com.
`,
);

// Wait for indexing (poll or use webhooks in production)
await new Promise((r) => setTimeout(r, 5000));

// Query
const result = await ci.query(project.data.id, "What is the refund policy?");
console.log(result.data.context.text);
// "[Source: Refund Policy]\nWe offer full refunds within 30 days..."
console.log(result.data.quality.overall); // 0.92
```

### With Conversation Memory

```typescript
const convId = crypto.randomUUID();
const r1 = await ci.query("proj_123", "What products do you sell?", { conversationId: convId });
const r2 = await ci.query("proj_123", "How much does the first one cost?", {
  conversationId: convId,
});
// r2 has context from r1's conversation
```

### File Upload (Node.js)

```typescript
import { readFile } from "fs/promises";

const pdfBuffer = await readFile("./quarterly-report.pdf");
const result = await ci.uploadFile("proj_123", pdfBuffer, "quarterly-report.pdf", {
  title: "Q4 2025 Report",
  metadata: { department: "finance" },
});
// result.data.status === 'processing'
```

### Error Handling

```typescript
import { ContextInject, ContextInjectError } from "contextinject";

try {
  const result = await ci.query("proj_123", "test query");
} catch (error) {
  if (error instanceof ContextInjectError) {
    switch (error.code) {
      case "RATE_LIMIT_EXCEEDED":
        // Back off and retry
        break;
      case "UNAUTHORIZED":
        // Invalid API key
        break;
      case "VALIDATION_ERROR":
        console.log(error.details); // Field-level errors
        break;
      default:
        console.error(`API error: ${error.message} (${error.statusCode})`);
    }
  }
}
```

---

## Testing

SDK tests use `msw` (Mock Service Worker) to intercept HTTP requests without running a real server:

```typescript
// packages/sdk/src/__tests__/query.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ContextInject, ContextInjectError } from "../index";

const server = setupServer(
  http.post("https://api.contextinject.ai/v1/query", () => {
    return HttpResponse.json({
      success: true,
      data: {
        requestId: "test-req-id",
        query: "test",
        chunks: [],
        context: { text: "test context", tokenCount: 10, citations: [] },
        quality: {
          overall: 0.85,
          retrievalConfidence: 0.9,
          contextSufficiency: 0.8,
          diversityScore: 0.7,
          estimatedFaithfulness: 0.9,
        },
        latencyMs: 42,
        cacheHit: false,
        usage: {
          documentsScanned: 10,
          chunksRetrieved: 10,
          chunksAfterRerank: 5,
          tokensBeforeCompression: 500,
          tokensAfterCompression: 250,
          embeddingTokens: 20,
        },
      },
    });
  }),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

describe("ContextInject.query()", () => {
  const ci = new ContextInject({ apiKey: "ci_test_abc" });

  it("returns query results", async () => {
    const result = await ci.query("proj_123", "test query");
    expect(result.data.quality.overall).toBe(0.85);
    expect(result.data.context.text).toBe("test context");
  });

  it("throws ContextInjectError on 401", async () => {
    server.use(
      http.post("https://api.contextinject.ai/v1/query", () => {
        return HttpResponse.json(
          { error: { message: "Invalid API key", code: "INVALID_API_KEY" } },
          { status: 401 },
        );
      }),
    );

    await expect(ci.query("proj_123", "test")).rejects.toThrow(ContextInjectError);
  });
});
```

---

## Build & Publish

```bash
# Build
pnpm --filter contextinject build

# Dry run publish
pnpm --filter contextinject publish --dry-run

# Publish to npm
pnpm --filter contextinject publish --access public
```

---

## Related Documentation

- [Phase 3 README](./README.md) — Phase overview
- [01-api-server.md](./01-api-server.md) — API that this SDK calls
- [03-mcp-server.md](./03-mcp-server.md) — MCP server that wraps this SDK
