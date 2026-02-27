# 05 — Monitoring & Observability

> **Stack**: OpenTelemetry + Prometheus + Grafana + Langfuse + PagerDuty
> **Entry Point**: `apps/api/src/telemetry/otel.ts`

---

## Overview

The monitoring stack provides three pillars of observability:

1. **Traces** (OpenTelemetry) — Distributed request tracing across API, Worker, Qdrant, PostgreSQL
2. **Metrics** (Prometheus + Grafana) — System health, pipeline performance, business metrics
3. **LLM Observability** (Langfuse) — Token usage, cost tracking, prompt versioning, quality evaluation

Combined with structured logging (Pino) and alerting (PagerDuty), this provides complete visibility into system behavior from individual request traces to business-level dashboards.

---

## OpenTelemetry Distributed Tracing

### Initialization

```typescript
// apps/api/src/telemetry/otel.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export async function initTelemetry() {
  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: "contextinject-api",
      [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "0.1.0",
      "deployment.environment": process.env.NODE_ENV ?? "development",
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/metrics",
      }),
      exportIntervalMillis: 15_000, // Export every 15 seconds
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-express": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        "@opentelemetry/instrumentation-redis-4": { enabled: true },
        "@opentelemetry/instrumentation-ioredis": { enabled: true },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown
  process.on("SIGTERM", () => sdk.shutdown());
}
```

### Trace Propagation

Traces propagate across service boundaries via W3C Trace Context headers:

```
Client Request
    |
    | X-Request-Id: abc-123
    | traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
    |
API Server (root span: "POST /v1/query")
    |
    +-- Span: "auth.validateApiKey"
    +-- Span: "cache.semanticLookup"
    +-- Span: "embeddings.cohere.embed"
    |       +-- HTTP span to api.cohere.ai
    +-- Span: "vectorStore.qdrant.search"
    |       +-- HTTP span to qdrant:6333
    +-- Span: "db.postgres.hydrateChunks"
    |       +-- SQL span: SELECT FROM chunks
    +-- Span: "reranker.cohere.rerank"
    |       +-- HTTP span to api.cohere.ai
    +-- Span: "compressor.llmlingua.compress"
    +-- Span: "evaluator.qualityScore"
    +-- Span: "cache.store"
```

### Span Naming Conventions

```
{service}.{component}.{operation}

Examples:
  api.auth.validateApiKey
  api.rateLimit.check
  core.pipeline.query
  core.pipeline.ingest
  embeddings.cohere.embed
  vectorStore.qdrant.search
  vectorStore.qdrant.upsert
  reranker.cohere.rerank
  compressor.llmlingua.compress
  cache.redis.get
  cache.redis.set
  db.postgres.query
  worker.ingest.process
```

### Custom Span Attributes

Every span includes context-specific attributes:

```typescript
// packages/core/src/pipeline/retrieval-pipeline.ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('contextinject-core');

async query(request: QueryRequest): Promise<QueryResult> {
  return tracer.startActiveSpan('core.pipeline.query', async (span) => {
    span.setAttribute('tenant.id', request.tenantId);
    span.setAttribute('project.id', request.projectId);
    span.setAttribute('pipeline.stage', 'query');
    span.setAttribute('query.length', request.query.length);
    span.setAttribute('query.topK', request.topK ?? 5);

    try {
      const result = await this.executeQuery(request);

      span.setAttribute('result.chunks', result.chunks.length);
      span.setAttribute('result.cacheHit', result.cacheHit);
      span.setAttribute('result.latencyMs', result.latencyMs);
      span.setAttribute('result.qualityScore', result.quality.overall);
      span.setStatus({ code: SpanStatusCode.OK });

      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

---

## Prometheus Metrics

### Custom Metric Definitions

```typescript
// apps/api/src/telemetry/metrics.ts
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("contextinject-api");

// --- HTTP Metrics ---
export const httpRequestDuration = meter.createHistogram("http_request_duration_ms", {
  description: "HTTP request duration in milliseconds",
  unit: "ms",
});

export const httpRequestsTotal = meter.createCounter("http_requests_total", {
  description: "Total HTTP requests",
});

// --- Pipeline Metrics ---
export const pipelineLatency = meter.createHistogram("pipeline_stage_duration_ms", {
  description: "Duration of each pipeline stage in milliseconds",
  unit: "ms",
});

export const pipelineQualityScore = meter.createHistogram("pipeline_quality_score", {
  description: "Quality score distribution",
});

// --- Cache Metrics ---
export const cacheHits = meter.createCounter("cache_hits_total", {
  description: "Total semantic cache hits",
});

export const cacheMisses = meter.createCounter("cache_misses_total", {
  description: "Total semantic cache misses",
});

// --- Queue Metrics ---
export const queueDepth = meter.createObservableGauge("queue_depth", {
  description: "Current depth of the BullMQ ingestion queue",
});

export const jobsProcessed = meter.createCounter("jobs_processed_total", {
  description: "Total jobs processed by worker",
});

export const jobsFailed = meter.createCounter("jobs_failed_total", {
  description: "Total failed jobs",
});

// --- Embedding Metrics ---
export const embeddingLatency = meter.createHistogram("embedding_api_duration_ms", {
  description: "Embedding API call duration",
  unit: "ms",
});

export const embeddingTokensUsed = meter.createCounter("embedding_tokens_total", {
  description: "Total embedding tokens consumed",
});

// --- Business Metrics ---
export const documentsIngested = meter.createCounter("documents_ingested_total", {
  description: "Total documents ingested",
});

export const queriesExecuted = meter.createCounter("queries_executed_total", {
  description: "Total queries executed",
});

export const activeTenantsGauge = meter.createObservableGauge("active_tenants", {
  description: "Number of active tenants",
});
```

### Prometheus Scrape Configuration

```yaml
# infra/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "contextinject-api"
    static_configs:
      - targets: ["api:3000"]
    metrics_path: "/metrics"

  - job_name: "contextinject-worker"
    static_configs:
      - targets: ["worker:3001"]
    metrics_path: "/metrics"

  - job_name: "qdrant"
    static_configs:
      - targets: ["qdrant:6333"]
    metrics_path: "/metrics"

  - job_name: "redis"
    static_configs:
      - targets: ["redis-exporter:9121"]

  - job_name: "postgres"
    static_configs:
      - targets: ["postgres-exporter:9187"]

rule_files:
  - "/etc/prometheus/rules/*.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]
```

---

## Grafana Dashboards

### Dashboard 1: System Health

Panels:

- **API Uptime** (stat): Percentage of successful responses (non-5xx)
- **Request Rate** (time series): Requests per second by status code
- **Error Rate** (gauge): Percentage of 5xx responses
- **Latency Distribution** (heatmap): Request latency by percentile
- **Active Connections** (stat): Current HTTP connections
- **Memory Usage** (time series): Heap used vs. heap total
- **CPU Usage** (time series): Process CPU percentage

### Dashboard 2: Pipeline Performance

Panels:

- **Pipeline Stage Latencies** (stacked bar): Time per stage (embed, search, rerank, compress, score)
- **Total Pipeline Latency** (time series): p50, p95, p99
- **Cache Hit Rate** (gauge): Percentage of queries served from cache
- **Quality Score Distribution** (histogram): Distribution of quality scores
- **Reranker Latency** (time series): Cohere vs. BGE latency comparison
- **Compression Ratio** (stat): Average compression ratio achieved
- **Vector Search Candidates** (stat): Average candidates from vector search

### Dashboard 3: Business Metrics

Panels:

- **Queries per Day** (time series): Total queries by tenant plan
- **Documents Ingested** (time series): Daily document ingestion rate
- **Active Tenants** (stat): Tenants with activity in last 24h
- **Usage by Plan** (pie chart): Distribution of usage across plan tiers
- **Revenue Indicators** (stat): Estimated MRR based on plan distribution
- **Cache Savings** (stat): Estimated API cost savings from caching
- **Top Tenants** (table): Top 10 tenants by query volume

---

## Alerting Rules

### P1 — Critical (PagerDuty, immediate notification)

```yaml
# infra/prometheus/rules/p1-critical.yml
groups:
  - name: p1-critical
    rules:
      - alert: APIDown
        expr: up{job="contextinject-api"} == 0
        for: 1m
        labels:
          severity: critical
          priority: P1
        annotations:
          summary: "API server is down"
          description: "API server has been unreachable for 1 minute"

      - alert: DatabaseUnreachable
        expr: pg_up == 0
        for: 1m
        labels:
          severity: critical
          priority: P1
        annotations:
          summary: "PostgreSQL database is unreachable"

      - alert: QdrantUnreachable
        expr: up{job="qdrant"} == 0
        for: 1m
        labels:
          severity: critical
          priority: P1
        annotations:
          summary: "Qdrant vector database is unreachable"

      - alert: RedisUnreachable
        expr: redis_up == 0
        for: 1m
        labels:
          severity: critical
          priority: P1
        annotations:
          summary: "Redis is unreachable"
```

### P2 — Warning (PagerDuty, business hours)

```yaml
# infra/prometheus/rules/p2-warning.yml
groups:
  - name: p2-warning
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status_code=~"5.."}[5m]))
          / sum(rate(http_requests_total[5m])) > 0.01
        for: 5m
        labels:
          severity: warning
          priority: P2
        annotations:
          summary: "Error rate exceeds 1%"

      - alert: HighP99Latency
        expr: histogram_quantile(0.99, rate(http_request_duration_ms_bucket[5m])) > 500
        for: 5m
        labels:
          severity: warning
          priority: P2
        annotations:
          summary: "p99 latency exceeds 500ms"

      - alert: QueueBacklog
        expr: queue_depth > 1000
        for: 10m
        labels:
          severity: warning
          priority: P2
        annotations:
          summary: "Ingestion queue backlog exceeds 1000 jobs"
```

### P3 — Info (Slack notification)

```yaml
# infra/prometheus/rules/p3-info.yml
groups:
  - name: p3-info
    rules:
      - alert: LowCacheHitRate
        expr: |
          sum(rate(cache_hits_total[1h]))
          / (sum(rate(cache_hits_total[1h])) + sum(rate(cache_misses_total[1h]))) < 0.20
        for: 1h
        labels:
          severity: info
          priority: P3
        annotations:
          summary: "Cache hit rate below 20%"

      - alert: QualityScoreDegradation
        expr: |
          avg(pipeline_quality_score) < 0.5
        for: 30m
        labels:
          severity: info
          priority: P3
        annotations:
          summary: "Average quality score below 0.5"

      - alert: HighQueueDepth
        expr: queue_depth > 500
        for: 15m
        labels:
          severity: info
          priority: P3
        annotations:
          summary: "Queue depth elevated (>500 jobs)"
```

---

## SLI/SLO Definitions

### Service Level Indicators (SLIs)

| SLI                  | Measurement                                       | Source                                |
| -------------------- | ------------------------------------------------- | ------------------------------------- |
| Availability         | Proportion of successful HTTP responses (non-5xx) | Prometheus `http_requests_total`      |
| Retrieval Latency    | Duration of `/v1/query` requests                  | Prometheus `http_request_duration_ms` |
| Ingestion Throughput | Documents successfully indexed per minute         | Prometheus `documents_ingested_total` |
| Error Rate           | Proportion of 5xx responses to total responses    | Prometheus `http_requests_total`      |
| Cache Hit Rate       | Proportion of queries served from cache           | Prometheus `cache_hits_total` / total |

### Service Level Objectives (SLOs)

| SLO                     | Production Tier                 | Enterprise Tier         | Measurement Window |
| ----------------------- | ------------------------------- | ----------------------- | ------------------ |
| Availability            | 99.9% (43.8 min/month downtime) | 99.95% (21.9 min/month) | Rolling 30 days    |
| Retrieval Latency (p50) | <100ms                          | <75ms                   | Rolling 7 days     |
| Retrieval Latency (p99) | <500ms                          | <300ms                  | Rolling 7 days     |
| Ingestion Throughput    | >100 docs/min                   | >500 docs/min           | Rolling 24 hours   |
| Error Rate              | <0.1%                           | <0.05%                  | Rolling 7 days     |

### Error Budget

```
Monthly error budget at 99.9% SLO:
  Total minutes: 43,200 (30 days)
  Allowed downtime: 43.2 minutes

  If 20 minutes consumed by incident on day 5:
    Remaining budget: 23.2 minutes
    Remaining days: 25
    Daily budget: 0.93 minutes/day

  Action thresholds:
    >50% consumed: Freeze non-critical deployments
    >75% consumed: Incident review, increase monitoring
    >90% consumed: All hands on reliability
```

---

## Langfuse Integration

Langfuse provides LLM-specific observability beyond what OpenTelemetry covers:

```typescript
// packages/core/src/telemetry/langfuse.ts
import { Langfuse } from "langfuse";

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
});

export function tracePipelineExecution(requestId: string, tenantId: string, query: string) {
  const trace = langfuse.trace({
    id: requestId,
    name: "retrieval-pipeline",
    metadata: { tenantId },
    input: { query },
  });

  return {
    spanEmbedding(tokens: number, latencyMs: number, model: string) {
      trace.generation({
        name: "embedding",
        model,
        usage: { input: tokens },
        metadata: { latencyMs },
      });
    },

    spanRerank(inputDocs: number, outputDocs: number, latencyMs: number) {
      trace.span({
        name: "reranking",
        metadata: { inputDocs, outputDocs, latencyMs },
      });
    },

    spanCompression(originalTokens: number, compressedTokens: number) {
      trace.span({
        name: "compression",
        metadata: { originalTokens, compressedTokens, ratio: compressedTokens / originalTokens },
      });
    },

    complete(result: { qualityScore: number; latencyMs: number; cacheHit: boolean }) {
      trace.update({
        output: result,
        metadata: {
          qualityScore: result.qualityScore,
          latencyMs: result.latencyMs,
          cacheHit: result.cacheHit,
        },
      });
    },
  };
}
```

Langfuse provides:

- Token and cost tracking across Cohere Embed + Rerank calls
- Pipeline execution traces with per-stage timing
- Quality score trends over time
- Prompt versioning (for MCP tool descriptions)
- Dataset management for quality benchmarks

---

## Infrastructure Docker Compose

```yaml
# infra/docker/docker-compose.monitoring.yml
services:
  prometheus:
    image: prom/prometheus:v2.51.0
    volumes:
      - ../prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - ../prometheus/rules:/etc/prometheus/rules
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:10.4.0
    volumes:
      - ../grafana/provisioning:/etc/grafana/provisioning
      - ../grafana/dashboards:/var/lib/grafana/dashboards
      - grafana_data:/var/lib/grafana
    ports:
      - "3003:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:-admin}

  alertmanager:
    image: prom/alertmanager:v0.27.0
    volumes:
      - ../alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml
    ports:
      - "9093:9093"

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.97.0
    volumes:
      - ../otel/otel-collector-config.yml:/etc/otel/config.yml
    ports:
      - "4317:4317" # gRPC
      - "4318:4318" # HTTP

volumes:
  prometheus_data:
  grafana_data:
```

---

## Testing Requirements

- Trace propagation: verify spans appear for API -> Worker -> Qdrant -> PostgreSQL
- Metrics: verify all custom metrics are being scraped by Prometheus
- Alerts: inject failures, verify alerts fire within 60 seconds for P1
- Dashboards: verify all panels load with data during a load test
- Langfuse: verify pipeline traces appear with correct token counts
- SLO: run a 1-hour load test and verify all SLOs are met at 200 RPS
- Error budget: verify tracking math is correct

---

## Related Documentation

- [Phase 5 README](./README.md) — Phase overview
- [03-security-hardening.md](./03-security-hardening.md) — Security monitoring
- [04-compliance.md](./04-compliance.md) — Audit logging for compliance
- [Phase 3: API Server](../phase-03-api-sdk/01-api-server.md) — Metrics middleware
