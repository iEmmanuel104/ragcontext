# Phase 5: Production Readiness

> **Timeline**: Weeks 12-14 | **Status**: Planned
> **Dependencies**: Phase 3 (API & SDK) for API integration points, Phase 4 (Quality) for dashboard metrics

---

## Overview

Phase 5 transforms ContextInject from a functional developer tool into a production-grade SaaS platform. This phase covers five workstreams: the Next.js 16 dashboard for self-serve management, Stripe billing integration with usage metering, security hardening across 8 threat vectors, compliance foundations (SOC 2 Type I roadmap, GDPR, HIPAA-ready), and full observability with OpenTelemetry, Prometheus, and Grafana.

The output of Phase 5 is a platform ready for the **public launch sequence**: Hacker News Show HN (Week 1), Product Hunt (Week 2), and developer newsletter campaigns (Week 3).

---

## Objectives

1. **Ship a self-serve dashboard** (Next.js 16, Turbopack) for project management, document management, API key management, analytics, and billing
2. **Integrate Stripe billing** for all 4 pricing tiers with usage metering, overage billing, and subscription lifecycle management
3. **Harden security** across 8 vectors: DDoS, vector injection, prompt injection, CSRF, PII detection, dependency scanning, SBOM generation, webhook signatures
4. **Establish compliance foundations**: SOC 2 Type I roadmap (month 8 target), GDPR erasure API, HIPAA-ready tier design
5. **Deploy full observability**: OpenTelemetry distributed tracing, Prometheus metrics, Grafana dashboards, Langfuse LLM observability, alerting with SLI/SLO definitions

---

## Deliverables

| Deliverable        | App/Package               | Output                                                        |
| ------------------ | ------------------------- | ------------------------------------------------------------- |
| Web Dashboard      | `apps/dashboard`          | Next.js 16 app with auth, projects, docs, analytics, settings |
| Billing System     | `apps/api` + Stripe       | 4-tier billing, usage metering, webhook handling              |
| Security Hardening | Multiple packages         | 8 security controls across API, MCP, and dashboard            |
| Compliance         | `docs/compliance/` + code | SOC 2 roadmap, GDPR erasure API, audit logging                |
| Monitoring         | `apps/api` + infra        | OTel tracing, Prometheus, Grafana, Langfuse, alerting         |

---

## Architecture

```
                  +-------------------+
                  |   Grafana         |
                  |   Dashboards      |
                  +--------+----------+
                           |
                  +--------+----------+
                  |   Prometheus      |
                  |   Metrics Store   |
                  +--------+----------+
                           |
     +---------------------+---------------------+
     |                     |                     |
+----+------+    +--------+--------+    +-------+-------+
| API Server|    | Worker          |    | MCP Server    |
| Express 5 |    | BullMQ          |    | Stdio/SSE     |
+----+------+    +--------+--------+    +-------+-------+
     |                     |                     |
     +-----+-------+------+-----+-------+-------+
           |       |            |       |
     +-----+--+ +--+----+ +----+--+ +--+-----+
     |OTel    | |Langfuse| |Pino   | |Presidio|
     |Traces  | |LLM Obs | |Logs   | |PII Det |
     +--------+ +--------+ +-------+ +--------+

     +-------------------+
     |  Next.js 16       |
     |  Dashboard        |
     |  - Projects       |
     |  - Documents      |
     |  - Analytics      |
     |  - Settings       |
     |  - Billing        |
     +--------+----------+
              |
     +--------+----------+
     |  Stripe           |
     |  Billing + Meter  |
     +-------------------+
```

---

## Partial Parallel Execution Strategy

Phase 5 workstreams have mixed dependencies:

```
Week 12 (all parallel):
  +---> Dashboard (independent)
  +---> Billing (independent)
  +---> Monitoring (independent)
  +---> Security hardening (independent)

Week 13:
  +---> Compliance (depends on security hardening + audit logging)
  +---> Dashboard <-> Billing integration
  +---> Dashboard <-> Analytics/Monitoring integration

Week 14:
  +---> End-to-end testing
  +---> Load testing with monitoring
  +---> Security audit
  +---> Launch preparation
```

- **Dashboard** and **Billing** are fully independent of each other and can be built in parallel
- **Security hardening** should be completed before **Compliance**, as compliance requires security controls to be in place
- **Monitoring** is fully parallel with everything else
- Week 13 is integration week where all systems connect
- Week 14 is validation and launch preparation

---

## Critical Files

### Dashboard (`apps/dashboard/`)

```
apps/dashboard/
├── src/
│   ├── app/
│   │   ├── layout.tsx               # Root layout with auth provider
│   │   ├── page.tsx                 # Landing/redirect
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx       # Login with email/password
│   │   │   └── signup/page.tsx      # Signup with plan selection
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx           # Dashboard shell (sidebar, header)
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx         # Projects list
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx     # Project detail (documents, queries)
│   │   │   │       └── analytics/page.tsx
│   │   │   ├── settings/
│   │   │   │   ├── api-keys/page.tsx
│   │   │   │   ├── billing/page.tsx
│   │   │   │   └── team/page.tsx
│   │   │   └── analytics/page.tsx   # Global analytics dashboard
│   ├── components/
│   ├── lib/
│   └── styles/
├── package.json
└── next.config.ts
```

### Billing (in `apps/api/`)

```
apps/api/src/
├── services/
│   └── billing-service.ts           # Stripe integration
├── routes/v1/
│   └── billing.ts                   # Billing API routes (internal)
└── webhooks/
    └── stripe.ts                    # Stripe webhook handler
```

### Security

```
apps/api/src/middleware/
├── audit-log.ts                     # Immutable append-only audit logging
├── cors.ts                          # Per-environment CORS
└── ...

apps/mcp-server/src/security/
├── input-sanitizer.ts               # Prompt injection detection
└── rate-limiter.ts                  # Per-tool rate limiting

packages/core/src/security/
├── vector-injection.ts              # L2 norm anomaly detection
└── pii-detector.ts                  # Microsoft Presidio integration
```

### Monitoring

```
apps/api/src/telemetry/
├── otel.ts                          # OpenTelemetry SDK initialization
└── metrics.ts                       # Custom Prometheus metrics

infra/
├── grafana/
│   ├── dashboards/
│   │   ├── system-health.json       # System health dashboard
│   │   ├── pipeline-performance.json # Pipeline metrics
│   │   └── business-metrics.json    # Revenue, usage, growth
│   └── provisioning/
├── prometheus/
│   ├── prometheus.yml               # Scrape config
│   └── rules/
│       ├── p1-critical.yml          # P1 alerts
│       ├── p2-warning.yml           # P2 alerts
│       └── p3-info.yml              # P3 alerts
└── docker/
    └── docker-compose.monitoring.yml
```

---

## Pricing Tiers Implementation

| Tier       | Price   | Documents | Pages     | Retrievals/mo        | Projects  | Users     |
| ---------- | ------- | --------- | --------- | -------------------- | --------- | --------- |
| Free       | $0      | 1K        | 10K       | 5K                   | 1         | 1         |
| Starter    | $99/mo  | -         | 25K       | 50K                  | 3         | 3         |
| Pro        | $499/mo | -         | 100K      | Unlimited (fair use) | Unlimited | 10        |
| Enterprise | $2K+/mo | Unlimited | Unlimited | Unlimited            | Unlimited | Unlimited |

**Enterprise extras**: SSO/SAML, audit logs, RBAC, 99.9%+ SLA, private deploy, custom integrations, dedicated support.

---

## SLI/SLO Definitions

| SLI                     | SLO (Production) | SLO (Enterprise) |
| ----------------------- | ---------------- | ---------------- |
| Availability            | 99.9%            | 99.95%           |
| Retrieval latency (p50) | <100ms           | <75ms            |
| Retrieval latency (p99) | <500ms           | <300ms           |
| Ingestion throughput    | >100 docs/min    | >500 docs/min    |
| Error rate              | <0.1%            | <0.05%           |
| Cache hit rate          | >20%             | >30%             |

---

## Testing Requirements

### Dashboard Tests

- Component tests with Vitest + React Testing Library
- E2E tests with Playwright: signup -> create project -> upload doc -> view analytics
- Accessibility audit: WCAG 2.1 AA compliance with axe-core
- CSRF protection: verify double-submit cookie pattern

### Billing Tests

- Stripe webhook signature validation
- Usage metering accuracy (compare API logs vs. Stripe meter events)
- Plan limit enforcement: verify hard limits on Free tier
- Subscription lifecycle: create -> upgrade -> downgrade -> cancel

### Security Tests

- Penetration testing against OWASP Top 10
- Vector injection: submit adversarial embeddings, verify rejection
- Prompt injection: submit known attack patterns to MCP, verify sanitization
- PII detection: submit documents with SSN, credit cards, emails, verify redaction
- Dependency scan: zero critical or high vulnerabilities in Snyk report

### Monitoring Tests

- Verify trace propagation: API -> Worker -> Qdrant -> PostgreSQL
- Verify all Prometheus metrics are being scraped
- Verify alerting rules fire correctly (inject failures, measure alert latency)
- Load test with monitoring: verify dashboards show accurate data under load

---

## Risk Assessment

| Risk                                      | Likelihood | Impact | Mitigation                                                         |
| ----------------------------------------- | ---------- | ------ | ------------------------------------------------------------------ |
| Stripe webhook reliability                | Low        | High   | Idempotent webhook handlers, retry logic, dead letter queue        |
| Dashboard performance with large datasets | Medium     | Medium | Cursor-based pagination, React.lazy for code splitting             |
| PII detection false positives             | Medium     | Medium | Configurable sensitivity per tenant, allow-list for business terms |
| SOC 2 audit cost overrun                  | Low        | Medium | Use Vanta/Drata automation, budget $40K                            |
| OpenTelemetry overhead on API latency     | Low        | Low    | Sampling rate tuning, async span export                            |
| GDPR erasure complexity (cascade delete)  | Medium     | High   | Comprehensive integration tests for cascade delete path            |

---

## Success Criteria

1. Dashboard loads in <2s (LCP) on 3G connection
2. Stripe billing handles all 4 tiers with correct usage metering (verified by audit)
3. Security audit reveals zero critical/high vulnerabilities
4. SOC 2 Type I evidence collection is 80% automated via Vanta/Drata
5. GDPR erasure API completes full cascade delete in <30 seconds for any document
6. Grafana dashboards show all defined SLIs with <5 minute data lag
7. P1 alerts fire within 60 seconds of triggering condition
8. All P2 latency SLOs are met during a 1-hour load test at 200 RPS

---

## Related Documentation

- [01-dashboard.md](./01-dashboard.md) — Next.js 16 dashboard
- [02-billing.md](./02-billing.md) — Stripe billing integration
- [03-security-hardening.md](./03-security-hardening.md) — Security controls
- [04-compliance.md](./04-compliance.md) — SOC 2, GDPR, HIPAA
- [05-monitoring.md](./05-monitoring.md) — Observability and alerting
- [Phase 4: Quality Layer](../phase-04-quality/README.md) — Previous phase
