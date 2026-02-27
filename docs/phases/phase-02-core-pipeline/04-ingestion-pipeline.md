# Phase 2.04: Ingestion Pipeline

> `@ci/core` ingestion pipeline, `apps/worker` BullMQ processor, and `@ci/queue` job definitions.

---

## Objectives

1. Build the end-to-end ingestion flow: upload -> parse -> chunk -> embed -> upsert -> metadata store
2. Implement the document status machine (pending -> processing -> embedding -> indexed | failed)
3. Set up BullMQ worker with concurrency control and rate limiting
4. Support change detection via content hash (SHA-256) and re-indexing
5. Handle errors gracefully with retry logic and status tracking

## Deliverables

- `packages/core/src/pipeline/ingestion-pipeline.ts` — Full ingestion pipeline
- `packages/queue/src/index.ts` — BullMQ queue definitions and job types
- `apps/worker/src/index.ts` — Worker entry point
- `apps/worker/src/processors/ingest-document.ts` — Ingestion job processor

---

## End-to-End Ingestion Flow

```
API Request: POST /v1/documents/upload
         │
         ▼
┌──────────────────────────┐
│ 1. Create Document Record │  apps/api/src/services/document-service.ts
│    status: 'pending'      │  → PostgreSQL: INSERT into documents
│    contentHash: SHA-256   │  → Check for duplicate (same tenant + hash)
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 2. Enqueue Ingestion Job  │  packages/queue/src/index.ts
│    BullMQ: ingest-document│  → Redis: job added to queue
│    Return 202 Accepted    │  → Client gets documentId immediately
└───────────┬──────────────┘
            │
            ▼  (Worker picks up job)
┌──────────────────────────┐
│ 3. Parse Document         │  packages/parser/src/docling.ts
│    status: 'processing'   │  → Docling: PDF/DOCX/HTML → structured text
│    Docling / Text parser  │  → Extract: tables, headings, images, metadata
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 4. Chunk Document         │  packages/chunker/src/semantic.ts
│    Semantic chunker       │  → 512 tokens, 50 overlap
│    (strategy configurable)│  → N chunks with metadata (page, heading, offset)
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 5. Generate Embeddings    │  packages/embeddings/src/cohere.ts
│    status: 'embedding'    │  → Cohere Embed v4 (batch of 96)
│    Batch processing       │  → 1024-dim dense vectors
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 6. Upsert to Vector Store │  packages/vector-store/src/qdrant.ts
│    Qdrant collection      │  → Dense + sparse vectors
│    Batch upsert (100/call)│  → Payload: tenantId, projectId, isDeleted
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 7. Store Chunk Metadata   │  packages/db/src/schema/chunks.ts
│    PostgreSQL chunks table│  → DELETE old chunks (re-index support)
│    vectorId reference     │  → INSERT new chunks with content + vectorId
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 8. Update Document Status │  packages/db/src/schema/documents.ts
│    status: 'indexed'      │  → chunkCount, tokenCount, indexedAt
│    or status: 'failed'    │  → errorMessage if failed
└──────────────────────────┘
```

---

## `@ci/core` Ingestion Pipeline

### `packages/core/src/pipeline/ingestion-pipeline.ts`

```typescript
import { createHash, randomUUID } from "node:crypto";
import { db } from "@ci/db";
import { documents, chunks } from "@ci/db/schema";
import { eq } from "drizzle-orm";
import type { IVectorStore, VectorPoint } from "@ci/vector-store";
import type { IEmbeddingProvider } from "@ci/embeddings";
import type { IDocumentParser } from "@ci/parser";
import type { IChunker } from "@ci/chunker";
import type { IngestDocumentJobData, PipelineConfig } from "@ci/types";
import { logger } from "@ci/logger";

export class IngestionPipeline {
  constructor(
    private vectorStore: IVectorStore,
    private embedder: IEmbeddingProvider,
    private parser: IDocumentParser,
    private chunker: IChunker,
    private collectionName: string,
  ) {}

  async ingest(jobData: IngestDocumentJobData): Promise<{
    chunkCount: number;
    tokenCount: number;
  }> {
    const { documentId, rawContent, mimeType, tenantId, projectId } = jobData;
    const log = logger.child({ documentId, tenantId });

    try {
      // Step 1: Update status to processing
      await this.updateStatus(documentId, "processing");
      log.info("Ingestion started");

      // Step 2: Parse document
      const parsed = await this.parser.parse(Buffer.from(rawContent, "utf-8"), mimeType);
      log.info(
        { pageCount: parsed.metadata.pageCount, wordCount: parsed.metadata.wordCount },
        "Document parsed",
      );

      // Step 3: Chunk document
      const chunkOutputs = this.chunker.chunk(parsed.text, {
        documentId,
        tenantId,
        projectId,
        documentTitle: parsed.metadata.title,
      });

      if (chunkOutputs.length === 0) {
        throw new Error("Document produced no chunks after processing");
      }
      log.info({ chunkCount: chunkOutputs.length }, "Document chunked");

      // Step 4: Generate embeddings (batched)
      await this.updateStatus(documentId, "embedding");
      const texts = chunkOutputs.map((c) => c.content);
      const embeddingResult = await this.embedder.embed(texts, "search_document");
      log.info({ tokensUsed: embeddingResult.tokensUsed }, "Embeddings generated");

      // Step 5: Prepare vector points
      const vectorPoints: VectorPoint[] = chunkOutputs.map((chunk, i) => ({
        id: randomUUID(),
        vector: embeddingResult.embeddings[i],
        payload: {
          documentId,
          tenantId,
          projectId,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          contentPreview: chunk.content.slice(0, 200),
          isDeleted: false,
          pageNumber: chunk.metadata.pageNumber,
          sectionTitle: chunk.metadata.sectionTitle,
          createdAt: new Date().toISOString(),
        },
      }));

      // Step 6: Upsert to vector store
      await this.vectorStore.batchUpsert(this.collectionName, vectorPoints, 100);
      log.info({ pointCount: vectorPoints.length }, "Vectors upserted");

      // Step 7: Store chunk metadata in PostgreSQL
      // Delete existing chunks first (supports re-indexing)
      await db.delete(chunks).where(eq(chunks.documentId, documentId));

      const chunkRecords = chunkOutputs.map((chunk, i) => ({
        id: randomUUID(),
        documentId,
        tenantId,
        projectId,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        chunkIndex: chunk.chunkIndex,
        vectorId: vectorPoints[i].id,
        metadata: {
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          pageNumber: chunk.metadata.pageNumber,
          sectionTitle: chunk.metadata.sectionTitle,
          headingPath: chunk.metadata.headingPath,
        },
      }));

      // Insert in batches to avoid exceeding parameter limits
      const INSERT_BATCH_SIZE = 500;
      for (let i = 0; i < chunkRecords.length; i += INSERT_BATCH_SIZE) {
        await db.insert(chunks).values(chunkRecords.slice(i, i + INSERT_BATCH_SIZE));
      }

      // Step 8: Mark document as indexed
      const totalTokens = chunkOutputs.reduce((sum, c) => sum + c.tokenCount, 0);
      await db
        .update(documents)
        .set({
          status: "indexed",
          chunkCount: chunkOutputs.length,
          tokenCount: totalTokens,
          indexedAt: new Date(),
          updatedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(documents.id, documentId));

      log.info({ chunkCount: chunkOutputs.length, tokenCount: totalTokens }, "Ingestion complete");

      return { chunkCount: chunkOutputs.length, tokenCount: totalTokens };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error({ error: message }, "Ingestion failed");

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

  private async updateStatus(documentId: string, status: string): Promise<void> {
    await db
      .update(documents)
      .set({
        status: status as any,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  }
}
```

---

## Document Status Machine

```
                    ┌─── retry (up to 3x) ───┐
                    │                         │
                    ▼                         │
pending ──► processing ──► embedding ──► indexed
                │               │
                ▼               ▼
              failed ◄────── failed
                │
                ▼
            deleted (soft: deletedAt set)
```

### Status Transitions

| From         | To           | Trigger                                       |
| ------------ | ------------ | --------------------------------------------- |
| `pending`    | `processing` | Worker picks up job, starts parsing           |
| `processing` | `embedding`  | Parsing + chunking complete, embedding starts |
| `embedding`  | `indexed`    | All vectors stored, metadata saved            |
| `processing` | `failed`     | Parse error, chunk error                      |
| `embedding`  | `failed`     | Embedding API error, vector store error       |
| `failed`     | `pending`    | Manual retry via API                          |
| `indexed`    | `pending`    | Re-index triggered (content changed)          |
| any          | `deleted`    | Soft delete via API                           |

---

## Change Detection

Content hashing prevents re-processing unchanged documents:

```typescript
// In document-service.ts (API layer)
async function createOrUpdate(tenantId: string, params: CreateDocumentParams) {
  const contentHash = createHash("sha256").update(params.rawContent).digest("hex");

  // Check if this exact content already exists for this tenant
  const existing = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.contentHash, contentHash),
        eq(documents.projectId, params.projectId),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0].status === "indexed") {
    // Content unchanged — skip re-indexing
    return { document: existing[0], skipped: true };
  }

  // Content is new or changed — proceed with ingestion
  // ...
}
```

---

## `@ci/queue` — BullMQ Job Definitions

### `packages/queue/src/index.ts`

```typescript
import { Queue, type ConnectionOptions } from "bullmq";
import type {
  IngestDocumentJobData,
  SyncConnectorJobData,
  DeleteDocumentJobData,
  ReindexProjectJobData,
} from "@ci/types";
import { getConfig } from "@ci/config";

const config = getConfig();

function getConnection(): ConnectionOptions {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379"),
    password: url.password || undefined,
  };
}

// Queue definitions
export const ingestQueue = new Queue<IngestDocumentJobData>("ingest-document", {
  connection: getConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const syncQueue = new Queue<SyncConnectorJobData>("sync-connector", {
  connection: getConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 },
  },
});

export const deleteQueue = new Queue<DeleteDocumentJobData>("delete-document", {
  connection: getConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 500 },
  },
});

export const reindexQueue = new Queue<ReindexProjectJobData>("reindex-project", {
  connection: getConnection(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 50 },
  },
});

// Helper to enqueue an ingestion job
export async function enqueueIngest(data: IngestDocumentJobData): Promise<string> {
  const job = await ingestQueue.add("ingest", data, {
    jobId: `ingest-${data.documentId}`, // Prevents duplicate jobs for same document
    priority: data.pipelineConfig ? 1 : 2, // Custom pipeline = higher priority
  });
  return job.id!;
}
```

---

## `apps/worker` — BullMQ Worker

### `apps/worker/src/index.ts`

```typescript
import { Worker } from "bullmq";
import { getConfig } from "@ci/config";
import { logger } from "@ci/logger";
import { processIngestJob } from "./processors/ingest-document.js";

const config = getConfig();

function getConnection() {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379"),
    password: url.password || undefined,
  };
}

// ── Ingestion Worker ──────────────────────────────────────────

const ingestWorker = new Worker("ingest-document", processIngestJob, {
  connection: getConnection(),
  concurrency: 5,
  limiter: {
    max: 100, // Max 100 jobs per minute (respect Cohere rate limits)
    duration: 60_000,
  },
  stalledInterval: 300_000, // 5 minutes before considering stalled
});

ingestWorker.on("completed", (job) => {
  logger.info({ jobId: job.id, documentId: job.data.documentId }, "Ingestion job completed");
});

ingestWorker.on("failed", (job, err) => {
  logger.error(
    {
      jobId: job?.id,
      documentId: job?.data.documentId,
      error: err.message,
      attempt: job?.attemptsMade,
    },
    "Ingestion job failed",
  );
});

ingestWorker.on("stalled", (jobId) => {
  logger.warn({ jobId }, "Ingestion job stalled");
});

// ── Graceful Shutdown ─────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received");
  await ingestWorker.close();
  logger.info("Worker shut down gracefully");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

logger.info({ concurrency: 5 }, "Worker started, waiting for jobs...");
```

### `apps/worker/src/processors/ingest-document.ts`

```typescript
import type { Job } from "bullmq";
import type { IngestDocumentJobData } from "@ci/types";
import { IngestionPipeline } from "@ci/core";
import { QdrantVectorStore } from "@ci/vector-store";
import { CohereEmbeddingProvider } from "@ci/embeddings";
import { DoclingParser, TextParser } from "@ci/parser";
import { createChunker } from "@ci/chunker";
import { getConfig } from "@ci/config";
import { getCollectionName } from "@ci/vector-store";

const config = getConfig();

// Shared instances (reused across jobs)
const vectorStore = new QdrantVectorStore(config.qdrantUrl, config.qdrantApiKey);
const embedder = new CohereEmbeddingProvider(config.cohereApiKey, "embed-v4.0", 1024);
const doclingParser = new DoclingParser();
const textParser = new TextParser();

export async function processIngestJob(job: Job<IngestDocumentJobData>): Promise<void> {
  const { tenantId, projectId, mimeType, pipelineConfig } = job.data;

  // Select parser based on mime type
  const parser = textParser.supportedTypes().includes(mimeType) ? textParser : doclingParser;

  // Select chunker based on pipeline config
  const chunker = createChunker(pipelineConfig.chunking.strategy, pipelineConfig.chunking);

  // Ensure collection exists
  const collectionName = getCollectionName(tenantId, projectId);
  const exists = await vectorStore.collectionExists(collectionName);
  if (!exists) {
    await vectorStore.createCollection(collectionName, embedder.getDimensions());
  }

  // Run pipeline
  const pipeline = new IngestionPipeline(vectorStore, embedder, parser, chunker, collectionName);

  await pipeline.ingest(job.data);
}
```

---

## Concurrency and Rate Limiting

### Cohere API Limits

| Plan       | Requests/minute | Tokens/minute |
| ---------- | --------------- | ------------- |
| Trial      | 20              | 100K          |
| Production | 100             | 1M            |
| Enterprise | Custom          | Custom        |

### Worker Configuration

- **Concurrency:** 5 parallel jobs per worker instance
- **Rate limiter:** 100 jobs/minute (matches Cohere production limit)
- **Batch size:** 96 texts per Cohere embed call
- **Stall threshold:** 5 minutes (long documents may take time)
- **Retry:** 3 attempts with exponential backoff (1s, 4s, 16s base)

### Rate Limit Calculation

```
Max embedding calls/min = 100 jobs/min * ceil(avg_chunks/96)
For avg 10 chunks/doc: 100 * 1 = 100 embedding calls/min (within limit)
For avg 200 chunks/doc: 100 * 3 = 300 embedding calls/min (exceeds limit)

Mitigation: For large documents (>100 chunks), process embedding batches
sequentially with 500ms delay between batches.
```

---

## Error Handling and Retry Logic

| Error Type                     | Retry? | Max Attempts | Backoff              |
| ------------------------------ | ------ | ------------ | -------------------- |
| Cohere API 429 (rate limit)    | Yes    | 3            | Exponential + jitter |
| Cohere API 500+ (server error) | Yes    | 3            | Exponential          |
| Qdrant connection error        | Yes    | 3            | Exponential          |
| Parse error (invalid document) | No     | 1            | N/A                  |
| Chunk error (empty result)     | No     | 1            | N/A                  |
| Out of memory                  | No     | 1            | N/A                  |

---

## Re-indexing Support

When a document is re-indexed (content changed or manual trigger):

1. Old chunks are deleted from PostgreSQL (`DELETE FROM chunks WHERE document_id = ?`)
2. Old vectors are soft-deleted in Qdrant (`isDeleted: true` payload update)
3. New chunks are generated and stored
4. Background cleanup job removes soft-deleted vectors after 24h

```typescript
// Soft-delete approach for zero-downtime re-indexing
async function softDeleteVectors(collectionName: string, documentId: string) {
  // Mark old vectors as deleted (they stop appearing in search immediately
  // due to isDeleted filter, but remain for rollback)
  await vectorStore.setPayload(collectionName, {
    filter: { must: [{ key: "documentId", match: { value: documentId } }] },
    payload: { isDeleted: true, deletedAt: new Date().toISOString() },
  });
}
```

---

## Testing Requirements

- Full pipeline: upload plain text -> chunks created -> vectors stored -> status 'indexed'
- Full pipeline: upload PDF via Docling -> tables extracted -> chunks contain table data
- Status transitions: pending -> processing -> embedding -> indexed
- Status transitions: failure at any stage -> 'failed' with errorMessage
- Change detection: same content hash skips re-processing
- Re-indexing: updated content replaces old chunks, not duplicates
- BullMQ: failed job retries 3 times with exponential backoff
- BullMQ: duplicate jobId prevents duplicate processing
- Rate limiting: 100+ documents queued processes at controlled rate
- Large document: 500-page PDF processes without timeout or OOM

---

## Critical File Paths

| File                                               | Purpose                            |
| -------------------------------------------------- | ---------------------------------- |
| `packages/core/src/pipeline/ingestion-pipeline.ts` | End-to-end ingestion orchestration |
| `packages/queue/src/index.ts`                      | Queue definitions + job helpers    |
| `apps/worker/src/index.ts`                         | Worker entry point + lifecycle     |
| `apps/worker/src/processors/ingest-document.ts`    | Ingestion job processor            |

---

## Risk Assessment

| Risk                         | Impact | Mitigation                                                            |
| ---------------------------- | ------ | --------------------------------------------------------------------- |
| Large document OOM in worker | High   | Stream parsing; limit document size per plan; chunked processing      |
| Cohere rate limit exceeded   | High   | Queue-level rate limiting; exponential backoff; fallback to OpenAI    |
| Partial ingestion failure    | Medium | Atomic: delete old chunks before insert; status 'failed' on any error |
| BullMQ Redis connection loss | High   | Reconnection logic; persistence (appendonly); health checks           |

---

_Related: [Phase 2 Overview](./README.md) | [Chunking & Parsing](./03-chunking-and-parsing.md) | [Retrieval Pipeline](./05-retrieval-pipeline.md)_
