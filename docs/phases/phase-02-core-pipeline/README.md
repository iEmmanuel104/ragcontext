# Phase 2: Core Pipeline (Weeks 4-6)

> Vector store abstraction, embedding service, chunking and parsing, ingestion pipeline, and retrieval pipeline.

---

## Objectives

1. Build the vector store abstraction layer with Qdrant primary and pgvector fallback
2. Implement embedding service with Cohere Embed v4 primary and fallback chain
3. Create document parsing with Docling and multi-strategy chunking
4. Wire up the end-to-end ingestion pipeline (upload to indexed)
5. Wire up the end-to-end retrieval pipeline (query to context)
6. Set up BullMQ worker for background processing

## Deliverables

| Deliverable  | Package            | Description                                                    |
| ------------ | ------------------ | -------------------------------------------------------------- |
| Vector store | `@ci/vector-store` | IVectorStore interface, Qdrant + pgvector implementations      |
| Embeddings   | `@ci/embeddings`   | IEmbeddingProvider interface, Cohere v4 + OpenAI + BGE-M3      |
| Chunker      | `@ci/chunker`      | Semantic, recursive, sentence, fixed-size strategies           |
| Parser       | `@ci/parser`       | Docling adapter for PDF, DOCX, HTML, PPTX                      |
| Ingestion    | `@ci/core`         | Full ingestion pipeline: parse -> chunk -> embed -> store      |
| Retrieval    | `@ci/core`         | Full retrieval pipeline: embed -> search -> rerank -> assemble |
| Queue        | `@ci/queue`        | BullMQ job type definitions and queue factory                  |
| Worker       | `apps/worker`      | Background job processor with retry logic                      |

## Dependencies

- **Requires Phase 1:** `@ci/types`, `@ci/db`, `@ci/config`, `@ci/errors`, `@ci/logger`, `@ci/crypto`
- **External services:** Cohere API (embedding + reranking), Qdrant (vector search), Docling (parsing)
- **Infrastructure:** Redis 7.2 (BullMQ backing), PostgreSQL 17 (metadata)

## Sub-Documents

| #   | Document                                           | Focus                                                       |
| --- | -------------------------------------------------- | ----------------------------------------------------------- |
| 01  | [Vector Store](./01-vector-store.md)               | `@ci/vector-store` — Qdrant + pgvector abstraction          |
| 02  | [Embeddings](./02-embeddings.md)                   | `@ci/embeddings` — Cohere v4 + fallback providers           |
| 03  | [Chunking & Parsing](./03-chunking-and-parsing.md) | `@ci/chunker` + `@ci/parser` — Docling, chunking strategies |
| 04  | [Ingestion Pipeline](./04-ingestion-pipeline.md)   | `@ci/core` ingestion + `apps/worker` + `@ci/queue`          |
| 05  | [Retrieval Pipeline](./05-retrieval-pipeline.md)   | `@ci/core` retrieval — full 10-stage flow                   |

## Exit Criteria

- [ ] Upload a PDF document and receive `indexed` status within 60 seconds
- [ ] Query retrieves relevant chunks with cosine similarity > 0.7
- [ ] Hybrid search (dense + sparse RRF) returns results
- [ ] Qdrant collections are created per-tenant with correct HNSW config
- [ ] pgvector fallback returns comparable results to Qdrant
- [ ] Cohere Embed v4 batch processing handles 96 texts per request
- [ ] Docling successfully parses PDF, DOCX, and HTML documents
- [ ] Semantic chunker produces 300-800 token chunks with correct overlap
- [ ] BullMQ worker processes jobs with retry on failure (up to 3 attempts)
- [ ] Document status transitions: pending -> processing -> embedding -> indexed
- [ ] Failed documents have error messages stored
- [ ] Re-indexing a document replaces old chunks (not duplicates)
- [ ] Integration test: full flow from upload to query returns correct content

## Week-by-Week Breakdown

### Week 4

- `@ci/vector-store` — IVectorStore interface, Qdrant implementation
- `@ci/embeddings` — IEmbeddingProvider interface, Cohere Embed v4 adapter
- `@ci/chunker` — Semantic and recursive chunking strategies
- `@ci/parser` — Docling adapter for PDF/DOCX/HTML

### Week 5

- `@ci/core` ingestion pipeline — end-to-end: parse -> chunk -> embed -> store
- `@ci/queue` — BullMQ job definitions
- `apps/worker` — Job processor with concurrency control
- pgvector fallback implementation in `@ci/vector-store`

### Week 6

- `@ci/core` retrieval pipeline — embed query -> hybrid search -> hydrate -> assemble
- Integration tests: full pipeline flow
- Performance benchmarks: ingestion throughput, retrieval latency
- Error handling: circuit breakers on Cohere + Qdrant

## Risk Assessment

| Risk                                            | Impact | Mitigation                                                                |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Cohere API rate limits throttle batch embedding | High   | Queue-based throttling (100 jobs/min); batch size 96; exponential backoff |
| Qdrant collection creation fails                | Medium | Retry with backoff; pgvector fallback available                           |
| Docling parsing accuracy on complex PDFs        | Medium | Fallback to raw text extraction; log parsing quality metrics              |
| BullMQ job stalling on long documents           | Medium | Stall threshold 5 min; heartbeat during processing; chunked processing    |
| Embedding dimension mismatch                    | High   | Validate dimensions at collection creation; config validation             |

---

_Related: [Master Plan](../../MASTER_PLAN.md) | [Phase 1: Foundation](../phase-01-foundation/README.md)_
