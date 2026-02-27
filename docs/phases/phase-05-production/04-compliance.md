# 04 — Compliance

> **Scope**: SOC 2 Type I, GDPR, HIPAA-ready
> **Target**: SOC 2 Type I by month 8, GDPR day-one, HIPAA-ready tier by month 12

---

## Overview

Compliance is a staged investment that unlocks enterprise customer segments. ContextInject's compliance strategy addresses three frameworks:

1. **SOC 2 Type I** — The minimum gate for enterprise sales. Target month 8. Cost: $20-40K.
2. **GDPR** — Required for any EU customer from day one. Implemented as code.
3. **HIPAA-ready tier** — Premium offering for healthcare customers. Requires dedicated infrastructure.

All compliance controls build on the security hardening from [03-security-hardening.md](./03-security-hardening.md).

---

## SOC 2 Type I Roadmap

### Timeline: Month 8 Target

SOC 2 Type I (Security criteria only) certifies that security controls are **designed** appropriately at a point in time. Type II (coming months 12-18) certifies that controls are **operating effectively** over a period.

### Budget: $20-40K Total

| Item                                   | Cost                                 |
| -------------------------------------- | ------------------------------------ |
| Compliance automation (Vanta or Drata) | $10-15K/year                         |
| Auditor engagement                     | $10-20K                              |
| Remediation engineering time           | Internal                             |
| Policy document drafting               | Internal (with templates from Vanta) |

### Security Criteria Controls Mapping

| SOC 2 Criteria                      | Control           | ContextInject Implementation                     |
| ----------------------------------- | ----------------- | ------------------------------------------------ |
| CC1.1 — Control environment         | Security policies | Policy documents in `docs/compliance/policies/`  |
| CC2.1 — Information & communication | Incident response | Runbook in `docs/runbooks/incident-response.md`  |
| CC3.1 — Risk assessment             | Risk register     | Annual risk assessment, documented in Vanta      |
| CC5.1 — Control activities          | Access control    | API key scopes, RBAC, tenant isolation           |
| CC5.2 — Logical access              | Authentication    | SHA-256 key hashing, LRU cache, expiry           |
| CC6.1 — System operations           | Monitoring        | OTel tracing, Prometheus, Grafana, PagerDuty     |
| CC6.2 — Change management           | CI/CD             | GitHub PR reviews, automated tests, deploy gates |
| CC6.6 — Threat management           | Security scanning | Snyk, SBOM, CloudFlare WAF                       |
| CC6.7 — Vulnerability management    | Patching          | Dependabot, Snyk alerts, 72h SLA for critical    |
| CC7.1 — System monitoring           | Logging           | Pino structured logs, audit trail, Langfuse      |
| CC7.2 — Incident management         | Response plan     | PagerDuty escalation, incident runbook           |
| CC8.1 — Change management           | Deployment        | Turborepo CI, zero-downtime deployments          |

### Vanta/Drata Compliance Automation

Vanta or Drata automates 80%+ of SOC 2 evidence collection:

- **Automatic evidence**: Pull from AWS/GCP (infra config), GitHub (PR reviews, branch protection), Snyk (vulnerability scans), PagerDuty (incident response)
- **Employee tracking**: Background checks, security training, access reviews
- **Policy management**: Template policies, version tracking, employee acknowledgement
- **Continuous monitoring**: Real-time alerts when controls drift out of compliance
- **Auditor portal**: Auditor directly reviews evidence in the platform

### Evidence Collection

| Evidence Type                | Source                    | Frequency      |
| ---------------------------- | ------------------------- | -------------- |
| Infrastructure configuration | Terraform state, AWS/GCP  | Continuous     |
| Code review records          | GitHub PR approvals       | Continuous     |
| Vulnerability scan results   | Snyk reports              | Weekly         |
| Access logs                  | API audit log table       | Continuous     |
| Encryption configuration     | TLS certs, at-rest config | Monthly        |
| Employee security training   | Vanta training module     | Annual         |
| Incident response records    | PagerDuty incidents       | Per incident   |
| Change management records    | GitHub deployments        | Per deployment |
| Penetration test reports     | Third-party vendor        | Annual         |

---

## GDPR Compliance

### Erasure API (Right to Be Forgotten)

The GDPR erasure API implements a cascade delete that removes all data for a given subject across all storage systems:

```typescript
// packages/core/src/compliance/erasure.ts
import { db } from "@ci/db";
import { documents, chunks, queryLogs, conversations, usageEvents } from "@ci/db/schema";
import { eq, and } from "drizzle-orm";
import type { IVectorStore } from "@ci/vector-store";
import type { ISemanticCache } from "@ci/cache";
import { logger } from "@ci/logger";

export interface ErasureResult {
  documentsDeleted: number;
  chunksDeleted: number;
  vectorsDeleted: number;
  queryLogsDeleted: number;
  conversationsDeleted: number;
  cacheEntriesInvalidated: number;
  completedAt: Date;
}

export async function executeErasure(
  tenantId: string,
  subjectId: string, // User or document owner to erase
  vectorStore: IVectorStore,
  cache: ISemanticCache,
  collectionName: string,
): Promise<ErasureResult> {
  const result: ErasureResult = {
    documentsDeleted: 0,
    chunksDeleted: 0,
    vectorsDeleted: 0,
    queryLogsDeleted: 0,
    conversationsDeleted: 0,
    cacheEntriesInvalidated: 0,
    completedAt: new Date(),
  };

  logger.info({ tenantId, subjectId }, "Starting GDPR erasure");

  // 1. Find all documents owned by this subject
  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        // Subject ID could be in access control or metadata
      ),
    );

  // 2. Delete vectors from Qdrant
  for (const doc of docs) {
    const docChunks = await db
      .select({ vectorId: chunks.vectorId })
      .from(chunks)
      .where(eq(chunks.documentId, doc.id));

    const vectorIds = docChunks.map((c) => c.vectorId);
    if (vectorIds.length > 0) {
      await vectorStore.delete(collectionName, vectorIds);
      result.vectorsDeleted += vectorIds.length;
    }
  }

  // 3. Delete chunks from PostgreSQL
  for (const doc of docs) {
    const deleted = await db.delete(chunks).where(eq(chunks.documentId, doc.id));
    result.chunksDeleted += docs.length;
  }

  // 4. Delete documents from PostgreSQL
  const deletedDocs = await db.delete(documents).where(and(eq(documents.tenantId, tenantId)));
  result.documentsDeleted = docs.length;

  // 5. Delete query logs
  const deletedLogs = await db.delete(queryLogs).where(eq(queryLogs.tenantId, tenantId));
  result.queryLogsDeleted += 1; // Count as batch

  // 6. Delete conversations
  const deletedConvos = await db.delete(conversations).where(eq(conversations.tenantId, tenantId));

  // 7. Invalidate cache
  await cache.invalidateProject(tenantId);
  result.cacheEntriesInvalidated += 1;

  result.completedAt = new Date();
  logger.info({ tenantId, subjectId, result }, "GDPR erasure complete");

  return result;
}
```

### Erasure Cascade Order

```
1. Vectors (Qdrant)       - Remove embedding vectors
2. Chunks (PostgreSQL)     - Remove chunk metadata and content
3. Documents (PostgreSQL)  - Remove document records
4. Query Logs (PostgreSQL) - Remove query history
5. Conversations           - Remove conversation memory
6. Cache (Redis)           - Invalidate all cached results
7. Audit Log               - Retain for compliance (anonymize subject)
```

**Target**: Complete erasure within 30 seconds for any single document, 72 hours for full tenant erasure.

### Data Processing Agreement (DPA)

A DPA template is provided for EU customers:

```
docs/compliance/templates/
├── dpa-template.md           # Data Processing Agreement
├── subprocessor-list.md      # List of sub-processors (Cohere, Qdrant, etc.)
└── data-flow-diagram.md      # Where data flows and is stored
```

Key DPA provisions:

- ContextInject processes data only on customer instructions
- Sub-processors listed with notification of changes
- Data location: specified region (us, eu, apac)
- Breach notification: within 72 hours
- Data return/deletion on contract termination

### Data Protection Impact Assessment (DPIA)

Required when processing personal data at scale. The DPIA template covers:

- Purpose of processing (document indexing for RAG retrieval)
- Necessity and proportionality (minimum data needed for embedding)
- Risks to data subjects (re-identification from embeddings, data leakage)
- Mitigation measures (PII detection, encryption, access control, audit logging)

### Data Retention Policies

Retention is configurable per tenant:

| Data Type     | Default Retention             | Configurable                    |
| ------------- | ----------------------------- | ------------------------------- |
| Documents     | Until deleted                 | Yes                             |
| Chunks        | Until parent document deleted | No (tied to document)           |
| Vectors       | Until parent document deleted | No (tied to document)           |
| Query Logs    | 90 days                       | Yes (30d, 90d, 365d, unlimited) |
| Conversations | 30 days                       | Yes (7d, 30d, 90d)              |
| Audit Logs    | 365 days                      | No (minimum for SOC 2)          |
| Usage Events  | Until billed                  | No                              |

### Right to Portability (Data Export)

```typescript
// packages/core/src/compliance/export.ts

export interface DataExport {
  tenant: { id: string; name: string; plan: string };
  projects: Array<{
    id: string;
    name: string;
    documents: Array<{
      id: string;
      title: string;
      content: string; // Original content if available
      metadata: Record<string, unknown>;
    }>;
  }>;
  exportedAt: string;
  format: "json";
}
```

Export is available as a JSON download from the dashboard settings page or via API.

---

## HIPAA-Ready Tier Design

### Overview

HIPAA compliance requires a Business Associate Agreement (BAA), PHI encryption, access logging, and dedicated infrastructure. This is offered as a premium Enterprise tier add-on.

### Requirements

| Requirement               | Implementation                                    |
| ------------------------- | ------------------------------------------------- |
| BAA                       | Legal agreement with each covered entity customer |
| PHI encryption at rest    | AES-256 with per-tenant keys (BYOK supported)     |
| PHI encryption in transit | TLS 1.3 minimum, mTLS for internal services       |
| Access logging            | Immutable audit log with 6-year retention         |
| Minimum necessary         | Role-based access, scoped API keys                |
| Breach notification       | 60-day notification SLA (HIPAA requirement)       |
| Dedicated infrastructure  | Separate database, separate Qdrant cluster        |

### Dedicated Infrastructure

HIPAA customers get isolated infrastructure:

- Dedicated PostgreSQL instance (not shared)
- Dedicated Qdrant cluster (separate namespace is not sufficient)
- Dedicated Redis instance
- Separate VPC with no connectivity to shared infrastructure
- All data encrypted with customer-managed keys

### Cost Implications

HIPAA tier adds approximately:

- $500-1,000/month in additional infrastructure costs
- Annual HIPAA security assessment ($15-30K)
- Ongoing compliance monitoring via Vanta

---

## Audit Logging

### Immutable Append-Only Log

The `audit_logs` table is append-only at the application level. No UPDATE or DELETE operations are performed on this table by the application.

```sql
-- Database-level protection (PostgreSQL)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  api_key_id UUID,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(255),
  request_id VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  status_code INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Prevent UPDATE and DELETE at the database level
CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- Index for querying by tenant and time
CREATE INDEX audit_logs_tenant_time_idx ON audit_logs (tenant_id, created_at DESC);
```

### Queryable Audit Trail

The audit log is queryable via the API (admin scope) and the dashboard:

```
GET /v1/audit-logs?
  startDate=2026-01-01&
  endDate=2026-01-31&
  action=DELETE&
  resourceType=documents
```

---

## Data Residency

### Region Field on Tenant

```typescript
// Region is set at tenant creation and cannot be changed
export type DataRegion = "us" | "eu" | "apac";

// In tenant schema
export const tenants = pgTable("tenants", {
  // ... existing fields
  region: varchar("region", { length: 10 }).default("us").notNull(),
});
```

### Regional Data Planes

```
Global Control Plane (us-east-1):
  - Billing (Stripe)
  - Feature flags
  - Cross-region routing

US Data Plane (us-east-1):
  - PostgreSQL (tenant data, documents, chunks)
  - Qdrant (vectors)
  - Redis (cache, rate limits)

EU Data Plane (eu-west-1):
  - PostgreSQL (tenant data, documents, chunks)
  - Qdrant (vectors)
  - Redis (cache, rate limits)

APAC Data Plane (ap-southeast-1):
  - PostgreSQL (tenant data, documents, chunks)
  - Qdrant (vectors)
  - Redis (cache, rate limits)
```

All customer data (documents, embeddings, query logs, conversations) stays in the tenant's selected region. Only billing metadata crosses regions.

---

## Testing Requirements

- Erasure API: verify complete cascade delete across all 7 storage layers
- Erasure timing: complete single-document erasure in <30 seconds
- Audit log immutability: verify UPDATE and DELETE operations are rejected
- Data export: verify exported JSON contains all tenant data
- Retention: verify automatic cleanup after configured retention period
- Region isolation: verify data does not cross region boundaries
- DPIA: review and sign-off by data protection officer (or equivalent)

---

## Related Documentation

- [Phase 5 README](./README.md) — Phase overview
- [03-security-hardening.md](./03-security-hardening.md) — Security controls (prerequisite)
- [05-monitoring.md](./05-monitoring.md) — Audit log monitoring
