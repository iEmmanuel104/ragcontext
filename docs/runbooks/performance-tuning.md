# Performance Tuning Runbook

> Performance tuning guide for Qdrant HNSW, PostgreSQL 17 indexes, Redis memory, and application-level optimizations.

---

## 1. Latency Budget

The total retrieval latency target is **<150ms p95** for a standard query. Each stage has an allocated budget:

```
Query received (0ms)
  |
  v
Embedding (5-15ms) -----> Cohere v4 API call (batch of 1)
  |
  v
Cache check (2-5ms) ----> Redis SCAN for similar embeddings
  |                        (cache hit? return cached result in <10ms)
  v
Vector search (20-50ms) -> Qdrant hybrid search (dense + sparse)
  |
  v
Metadata hydration (5-10ms) -> PostgreSQL JOIN on chunk IDs
  |
  v
Reranking (30-80ms) -----> Cohere Rerank 3.5 (top-20 to top-5)
  |
  v
Quality scoring (5-10ms) -> @ci/evaluator composite score
  |
  v
Context assembly (2-5ms) -> String concatenation + citation generation
  |
  v
Total: 70-175ms (target: <150ms p95)
```

---

## 2. Qdrant HNSW Tuning

### 2.1 HNSW Index Parameters

| Parameter             | Default | Recommended (Production)            | Effect                                                  |
| --------------------- | ------- | ----------------------------------- | ------------------------------------------------------- |
| `m`                   | 16      | 16 (standard) / 32 (high recall)    | Higher = better recall, more memory, slower indexing    |
| `ef_construct`        | 100     | 200 (standard) / 400 (high quality) | Higher = better index quality, slower build             |
| `ef` (search)         | 128     | 128 (standard) / 256 (high recall)  | Higher = better recall at search time, slower search    |
| `full_scan_threshold` | 10000   | 20000                               | Below this point count, use brute force instead of HNSW |
| `on_disk`             | false   | true (for large collections)        | Store index on disk instead of RAM                      |

**Configuration via API**:

```bash
# Create collection with tuned HNSW parameters
curl -X PUT "http://qdrant:6333/collections/tenant_abc" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "dense": {
        "size": 1024,
        "distance": "Cosine",
        "on_disk": true,
        "hnsw_config": {
          "m": 16,
          "ef_construct": 200
        }
      }
    },
    "sparse_vectors": {
      "sparse": {
        "index": { "on_disk": true }
      }
    },
    "hnsw_config": {
      "m": 16,
      "ef_construct": 200
    },
    "optimizers_config": {
      "default_segment_number": 4,
      "memmap_threshold": 20000,
      "indexing_threshold": 20000
    }
  }'
```

**Tuning at search time**:

```bash
# Override ef at query time for specific queries needing higher recall
curl -X POST "http://qdrant:6333/collections/tenant_abc/points/search" \
  -H "Content-Type: application/json" \
  -d '{
    "vector": {"name": "dense", "vector": [...]},
    "limit": 100,
    "params": {
      "hnsw_ef": 256
    }
  }'
```

### 2.2 Quantization

Quantization reduces memory usage and can improve search speed at the cost of some recall.

#### Binary Quantization (32x memory reduction)

Best for: Large collections where memory is the constraint.

```bash
curl -X PUT "http://qdrant:6333/collections/tenant_abc" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "dense": {
        "size": 1024,
        "distance": "Cosine",
        "quantization_config": {
          "binary": {
            "always_ram": true
          }
        }
      }
    }
  }'
```

**Trade-off**: ~5-10% recall loss. Mitigate with oversampling:

```json
{
  "params": {
    "quantization": {
      "rescore": true,
      "oversampling": 2.0
    }
  }
}
```

#### Product Quantization (8-16x memory reduction)

Best for: Balanced memory/recall trade-off.

```json
{
  "quantization_config": {
    "product": {
      "compression": "x16",
      "always_ram": true
    }
  }
}
```

### 2.3 Segment Optimization

| Parameter                | Description                              | Recommended    |
| ------------------------ | ---------------------------------------- | -------------- |
| `memmap_threshold`       | Vectors count to switch from RAM to mmap | 20000          |
| `indexing_threshold`     | Vectors count to build HNSW index        | 20000          |
| `default_segment_number` | Number of segments per collection        | 4 (multi-core) |
| `max_segment_size`       | Maximum vectors per segment              | 200000         |

**Optimization for large collections (>1M vectors)**:

```bash
# Trigger manual optimization
curl -X POST "http://qdrant:6333/collections/tenant_abc/index" \
  -H "Content-Type: application/json" \
  -d '{"field_name": "projectId", "field_schema": "keyword"}'
```

### 2.4 Qdrant Performance Monitoring

| Metric                         | Target            | Alert             |
| ------------------------------ | ----------------- | ----------------- |
| Search latency p50             | <20ms             | >50ms             |
| Search latency p99             | <50ms             | >200ms            |
| Indexing throughput            | >100 vectors/sec  | <50 vectors/sec   |
| Memory usage                   | <80% of allocated | >80%              |
| Disk I/O wait                  | <5%               | >10%              |
| Collection optimization status | "green"           | "yellow" or "red" |

---

## 3. PostgreSQL 17 Index Tuning

### 3.1 Index Strategy

| Table          | Index Type      | Columns                     | Purpose                         |
| -------------- | --------------- | --------------------------- | ------------------------------- |
| `documents`    | B-tree          | `(tenant_id, project_id)`   | Tenant-scoped document listing  |
| `documents`    | B-tree          | `(status)`                  | Filter by processing status     |
| `documents`    | B-tree          | `(tenant_id, content_hash)` | Deduplication on upload         |
| `documents`    | B-tree          | `(tenant_id, external_id)`  | Connector sync lookups          |
| `chunks`       | B-tree          | `(document_id)`             | Cascade delete, document lookup |
| `chunks`       | B-tree          | `(tenant_id, project_id)`   | Tenant-scoped chunk queries     |
| `chunks`       | B-tree (unique) | `(vector_id)`               | Qdrant point ID lookup          |
| `query_logs`   | B-tree          | `(tenant_id, project_id)`   | Analytics queries               |
| `query_logs`   | B-tree          | `(created_at)`              | Time-range filtering, retention |
| `usage_events` | B-tree          | `(tenant_id, billed_at)`    | Billing aggregation             |
| `api_keys`     | B-tree (unique) | `(key_hash)`                | API key authentication lookup   |

### 3.2 GIN Indexes for JSONB

```sql
-- Index metadata fields for filtered queries
CREATE INDEX idx_documents_metadata ON documents USING GIN (metadata);
CREATE INDEX idx_chunks_metadata ON chunks USING GIN (metadata);

-- Partial GIN index for specific metadata keys (more efficient)
CREATE INDEX idx_documents_metadata_author ON documents
  USING GIN ((metadata->'author'));
```

### 3.3 pg_trgm for Text Search (BM25)

```sql
-- Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN trigram index for text search on chunk content
CREATE INDEX idx_chunks_content_trgm ON chunks
  USING GIN (content gin_trgm_ops);

-- Usage in queries:
SELECT * FROM chunks
WHERE content % 'search query text'  -- Similarity search
AND tenant_id = $1
ORDER BY similarity(content, 'search query text') DESC
LIMIT 100;
```

### 3.4 pgvector Indexes (If Using pgvector Fallback)

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column to chunks table
ALTER TABLE chunks ADD COLUMN embedding vector(1024);

-- Create HNSW index for vector search
CREATE INDEX idx_chunks_embedding_hnsw ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Search query with pre-filtering (crucial for multi-tenancy)
SELECT id, content, embedding <=> $1::vector AS distance
FROM chunks
WHERE tenant_id = $2 AND project_id = $3
ORDER BY embedding <=> $1::vector
LIMIT 100;
```

### 3.5 Connection Pooling

```ini
# PgBouncer configuration (recommended for production)
[pgbouncer]
pool_mode = transaction
default_pool_size = 20
max_client_conn = 200
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3
server_idle_timeout = 600
query_timeout = 30
```

**Application-level pooling (Drizzle/postgres.js)**:

```typescript
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, {
  max: 20, // Maximum connections
  idle_timeout: 30, // Close idle connections after 30s
  connect_timeout: 10, // Connection timeout
  prepare: true, // Use prepared statements (faster repeated queries)
});
```

### 3.6 Query Optimization Patterns

```sql
-- Use EXPLAIN ANALYZE to identify slow queries
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT d.id, d.title, d.status, count(c.id) as chunk_count
FROM documents d
LEFT JOIN chunks c ON c.document_id = d.id
WHERE d.tenant_id = $1
GROUP BY d.id
ORDER BY d.created_at DESC
LIMIT 20;

-- Common issues and fixes:
-- 1. Sequential scan on large table -> Add missing index
-- 2. Nested loop join on large result set -> Consider hash join (increase work_mem)
-- 3. Sort on unindexed column -> Add index or limit result set first
```

**PostgreSQL tuning parameters**:

```ini
# postgresql.conf
shared_buffers = 256MB          # 25% of available RAM
effective_cache_size = 768MB    # 75% of available RAM
work_mem = 16MB                 # Per-operation memory for sorts/hashes
maintenance_work_mem = 128MB    # For VACUUM, CREATE INDEX
random_page_cost = 1.1          # SSD storage (default 4.0 is for spinning disk)
effective_io_concurrency = 200  # SSD storage
```

---

## 4. Redis Memory Optimization

### 4.1 Memory Policy

```ini
# redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lru    # Evict least recently used keys when full
```

**Policy Options**:

| Policy         | Use Case                                             |
| -------------- | ---------------------------------------------------- |
| `allkeys-lru`  | General caching (recommended for ContextInject)      |
| `volatile-lru` | Only evict keys with TTL set                         |
| `allkeys-lfu`  | Frequency-based eviction (good for hot queries)      |
| `noeviction`   | Never evict (for queues — not recommended for cache) |

### 4.2 Key Expiration Strategies

```typescript
// Semantic cache: 1 hour TTL (default, configurable per project)
await redis.set(
  `ci:cache:${projectId}:${queryHash}`,
  JSON.stringify(result),
  "EX",
  3600, // 1 hour
);

// API key cache: 5 minute TTL
await redis.set(
  `ci:auth:${keyHash}`,
  JSON.stringify(keyData),
  "EX",
  300, // 5 minutes
);

// Rate limit counters: Sliding window
await redis.set(
  `ci:ratelimit:${apiKeyId}:${windowStart}`,
  count,
  "EX",
  120, // 2 minutes (slightly longer than window for overlap)
);

// BullMQ: No TTL (managed by BullMQ internal lifecycle)
```

### 4.3 Memory Monitoring

```bash
# Check memory usage
redis-cli info memory

# Key metrics to monitor:
# used_memory: Current memory usage
# used_memory_peak: Peak memory usage
# mem_fragmentation_ratio: Should be 1.0-1.5 (>2.0 = fragmentation issue)
# evicted_keys: Number of keys evicted (should be low)

# If fragmentation is high:
redis-cli memory doctor
# Consider: redis-cli debug reload (restarts with defragmentation)
```

### 4.4 Redis Key Naming Convention

```
ci:cache:{projectId}:{queryHash}     — Semantic cache entries
ci:auth:{keyHash}                     — API key cache
ci:ratelimit:{apiKeyId}:{window}     — Rate limit counters
ci:tenant:{tenantId}:settings        — Tenant settings cache
bull:{queueName}:{jobId}             — BullMQ internal keys
```

---

## 5. Application-Level Tuning

### 5.1 Embedding Batch Sizes

| Provider             | Max Batch Size       | Recommended | Notes                       |
| -------------------- | -------------------- | ----------- | --------------------------- |
| Cohere v4            | 96 texts             | 96          | Use max batch for ingestion |
| OpenAI               | No hard limit        | 100         | Practical limit for latency |
| BGE-M3 (self-hosted) | GPU memory dependent | 32-64       | Depends on GPU VRAM         |

**Implementation**:

```typescript
// Batch embedding for ingestion (maximize throughput)
const batchSize = 96;
for (let i = 0; i < texts.length; i += batchSize) {
  const batch = texts.slice(i, i + batchSize);
  const embeddings = await embedder.embed(batch);
  // Process embeddings...
}
```

### 5.2 Vector Upsert Batch Sizes

```typescript
// Qdrant upsert: 100 points per batch (optimal for network/processing balance)
const upsertBatchSize = 100;
for (let i = 0; i < points.length; i += upsertBatchSize) {
  const batch = points.slice(i, i + upsertBatchSize);
  await qdrantClient.upsert(collectionName, { points: batch, wait: true });
}
```

### 5.3 Worker Concurrency

```typescript
// BullMQ worker configuration
const worker = new Worker("ingest-document", processor, {
  connection: redisConnection,
  concurrency: 5, // Process 5 documents simultaneously
  limiter: {
    max: 100, // Max 100 jobs per minute
    duration: 60 * 1000, // (respect Cohere API rate limits)
  },
  stalledInterval: 30000, // Check for stalled jobs every 30s
  maxStalledCount: 2, // Retry stalled jobs up to 2 times
});
```

**Tuning concurrency by resource**:

| Resource Constraint        | Recommended Concurrency | Reasoning                                     |
| -------------------------- | ----------------------- | --------------------------------------------- |
| Cohere API rate limit      | 5-10                    | 100 requests/min limit at standard tier       |
| CPU-bound (chunking)       | CPU cores - 1           | Leave 1 core for system                       |
| Memory-bound (large docs)  | 3-5                     | Each doc may consume 100MB+ during processing |
| I/O-bound (Qdrant upserts) | 10-20                   | I/O waits allow higher concurrency            |

### 5.4 Rate Limiter Tuning

```typescript
// Sliding window rate limiter (express-rate-limit with Redis store)
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  limit: (req) => {
    const plan = req.tenant?.plan;
    return { free: 60, starter: 300, pro: 1000, enterprise: 5000 }[plan] ?? 60;
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redis.sendCommand(args),
  }),
  keyGenerator: (req) => req.apiKeyId ?? req.ip,
});
```

**When to tune rate limits**:

- If legitimate users hit limits → increase per-plan limits
- If abuse detected → decrease per-IP limits, add CloudFlare rules
- If API is overloaded → decrease limits temporarily, scale infrastructure

---

## 6. Performance Monitoring Checklist

### Daily Monitoring (Automated Dashboards)

| Metric                    | Source             | Target         | Action if Exceeded                     |
| ------------------------- | ------------------ | -------------- | -------------------------------------- |
| API p50 latency           | Prometheus         | <100ms         | Investigate hot paths                  |
| API p95 latency           | Prometheus         | <300ms         | Check Qdrant, Redis, Cohere            |
| API p99 latency           | Prometheus         | <500ms         | Scale infrastructure                   |
| Error rate (5xx)          | Prometheus         | <0.1%          | Investigate errors                     |
| Qdrant search p99         | Qdrant metrics     | <50ms          | Tune HNSW params                       |
| PostgreSQL query time p99 | pg_stat_statements | <10ms          | Add indexes, optimize queries          |
| Redis memory usage        | Redis INFO         | <80% maxmemory | Increase maxmemory or optimize keys    |
| BullMQ queue depth        | Bull Board         | <100 waiting   | Scale workers                          |
| Cache hit rate            | Custom metric      | >30%           | Review cache TTL, key strategy         |
| Cohere API latency        | Custom metric      | <100ms         | Check Cohere status, consider fallback |

### Weekly Review

- [ ] Review slow query log (PostgreSQL: `log_min_duration_statement = 100`)
- [ ] Check index usage stats (`pg_stat_user_indexes`)
- [ ] Review Qdrant collection optimization status
- [ ] Check Redis memory fragmentation ratio
- [ ] Review BullMQ job failure rates
- [ ] Analyze cache hit/miss ratio trends

### Monthly Review

- [ ] Benchmark full pipeline latency against targets
- [ ] Review infrastructure costs against budget
- [ ] Capacity planning: project growth for next 3 months
- [ ] Evaluate if HNSW parameters need adjustment for collection size
- [ ] Consider quantization if memory usage is growing

---

## 7. Cross-References

- Incident response: [incident-response.md](./incident-response.md)
- Database recovery: [database-recovery.md](./database-recovery.md)
- On-call escalation: [on-call-escalation.md](./on-call-escalation.md)
- Tech stack decisions: [TECH_STACK_DECISIONS.md](../research/TECH_STACK_DECISIONS.md)
- Testing strategy (load tests): [01-testing-strategy.md](../phases/phase-06-launch/01-testing-strategy.md)
- Security monitoring: [SECURITY_CONTROLS.md](../compliance/SECURITY_CONTROLS.md)
