# GDPR Implementation Guide

> Complete GDPR compliance implementation for ContextInject, covering data processing, subject rights, retention policies, and cross-border data transfers.

---

## 1. Overview

ContextInject processes personal data on behalf of customers (data controllers) as a data processor. This document defines our GDPR compliance implementation, including technical measures, data subject rights handling, retention policies, and cross-border transfer mechanisms.

### Roles and Responsibilities

| Role                    | Entity                        | Responsibility                                     |
| ----------------------- | ----------------------------- | -------------------------------------------------- |
| Data Controller         | ContextInject customers       | Determine purposes and means of data processing    |
| Data Processor          | ContextInject                 | Process personal data on behalf of controllers     |
| Sub-processor           | Cohere, Qdrant Cloud, AWS/GCP | Process data under ContextInject's instructions    |
| Data Protection Officer | CTO (interim)                 | Oversee GDPR compliance, point of contact for DPAs |

### Lawful Basis for Processing

| Processing Activity               | Lawful Basis                        | Justification                                              |
| --------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Document ingestion and indexing   | Legitimate interest (Art. 6(1)(f))  | Necessary for service provision contracted by the customer |
| Query processing and retrieval    | Legitimate interest (Art. 6(1)(f))  | Core service functionality                                 |
| Usage metering and billing        | Contract performance (Art. 6(1)(b)) | Required to fulfill the service agreement                  |
| Dashboard analytics               | Legitimate interest (Art. 6(1)(f))  | Service improvement and quality monitoring                 |
| Marketing emails                  | Consent (Art. 6(1)(a))              | Opt-in only, with unsubscribe                              |
| Cookie tracking (dashboard)       | Consent (Art. 6(1)(a))              | Cookie banner with granular consent                        |
| Security logging and audit trails | Legal obligation (Art. 6(1)(c))     | Required for SOC 2, fraud prevention                       |

---

## 2. Data Processing Agreement (DPA) Template Outline

Every customer relationship requires a DPA. The following structure is provided as a template that the legal team finalizes.

### DPA Structure

1. **Definitions** — Controller, Processor, Sub-processor, Personal Data, Processing, Data Subject
2. **Scope and Purpose** — ContextInject processes data solely for providing RAG middleware services as instructed by the controller
3. **Duration** — Co-terminus with the service agreement
4. **Nature of Processing** — Document ingestion, text chunking, vector embedding, storage, retrieval, and caching
5. **Categories of Data Subjects** — End users whose data is contained in ingested documents (determined by controller)
6. **Types of Personal Data** — As determined by the controller; may include names, emails, addresses, and other PII contained in uploaded documents
7. **Processor Obligations**:
   - Process data only on documented instructions from the controller
   - Ensure personnel are bound by confidentiality obligations
   - Implement appropriate technical and organizational security measures (see [SECURITY_CONTROLS.md](./SECURITY_CONTROLS.md))
   - Engage sub-processors only with prior written authorization
   - Assist controller with data subject requests
   - Delete or return all personal data upon termination
   - Make available all information necessary to demonstrate compliance
   - Allow and contribute to audits
8. **Sub-processor Management** — Listed in Section 7 of this document
9. **Cross-border Transfers** — Covered by SCCs or EU-US Data Privacy Framework
10. **Breach Notification** — 48-hour notification to controller (within the 72-hour GDPR window)
11. **Data Return and Deletion** — 30-day deletion upon termination, certification of deletion provided

### Standard DPA Availability

- Self-serve DPA signing for Starter and Pro tiers via dashboard
- Custom DPA negotiation available for Enterprise tier
- DPA template published at `contextinject.ai/legal/dpa`

---

## 3. Data Protection Impact Assessment (DPIA)

### DPIA for ContextInject RAG Processing

**Assessment Date**: Pre-launch
**Assessor**: CTO / Data Protection Officer
**Review Schedule**: Annual or upon significant processing changes

#### 3.1 Description of Processing

| Aspect  | Detail                                                                 |
| ------- | ---------------------------------------------------------------------- |
| Nature  | Automated processing of documents containing potentially personal data |
| Purpose | Enable customers to build RAG-powered AI applications                  |
| Scope   | Multi-tenant platform processing documents from multiple data sources  |
| Context | B2B SaaS — customers determine what data is uploaded                   |

#### 3.2 Necessity and Proportionality

- **Necessity**: Document processing is essential for the service — no alternative exists
- **Proportionality**: Only text content is extracted; images with PII can be excluded via configuration
- **Data minimization**: Chunks contain only relevant text segments, not full documents
- **Storage limitation**: Configurable retention policies, automatic expiry, soft-delete with hard purge

#### 3.3 Risk Assessment

| Risk                                | Likelihood | Impact   | Mitigation                                                                       | Residual Risk |
| ----------------------------------- | ---------- | -------- | -------------------------------------------------------------------------------- | ------------- |
| PII in vector embeddings            | High       | Medium   | PII detection via Presidio before embedding, redaction options                   | Low           |
| Cross-tenant data leakage           | Low        | Critical | Collection-per-tenant isolation in Qdrant, PostgreSQL RLS, integration tests     | Very Low      |
| Unauthorized access to documents    | Medium     | High     | API key authentication, RBAC, access control metadata on chunks                  | Low           |
| Data breach via compromised API key | Medium     | High     | Key hashing (SHA-256), rotation support, scope limitations, rate limiting        | Low           |
| Sub-processor breach                | Low        | High     | DPAs with sub-processors, vendor security assessments, encrypted data in transit | Low           |
| Excessive data retention            | Medium     | Medium   | Configurable retention policies, automated purge jobs                            | Low           |

#### 3.4 DPIA Outcome

The processing is necessary and proportionate. Identified risks are mitigated through technical and organizational measures. No consultation with supervisory authority is required.

---

## 4. Data Subject Rights Implementation

### 4.1 Right to Access (Art. 15) — Data Export API

**Endpoint**: `GET /v1/data-export?tenantId={tenantId}`

**Implementation**:

```
1. Authenticate request (API key with admin scope or dashboard session)
2. Query all documents for the tenant
3. For each document: retrieve chunk content, metadata, and associated query logs
4. Package into JSON export with schema version
5. Optionally convert to CSV for tabular data
6. Return download URL (signed, expires in 24 hours)
7. Log the export request in audit trail
```

**Response Format**:

```json
{
  "exportId": "uuid",
  "format": "json",
  "tenant": {
    "id": "uuid",
    "name": "Acme Corp",
    "plan": "pro",
    "createdAt": "2026-01-15T00:00:00Z"
  },
  "documents": [...],
  "queryLogs": [...],
  "usageEvents": [...],
  "generatedAt": "2026-02-23T00:00:00Z",
  "schemaVersion": "1.0"
}
```

**SLA**: Export available within 1 hour for tenants with <10K documents, 24 hours for larger datasets.

### 4.2 Right to Erasure (Art. 17) — Cascade Delete API

**Endpoint**: `DELETE /v1/data-erasure?tenantId={tenantId}&scope=full|documents|queries`

**Cascade Delete Sequence** (critical — must delete in correct order):

```
Step 1: Mark tenant as "erasure_in_progress" (prevent new writes)
  ↓
Step 2: Delete cached query results from Redis
  - Pattern: DEL ci:cache:{tenantId}:*
  - Verify: SCAN to confirm no remaining keys
  ↓
Step 3: Delete vector embeddings from Qdrant
  - Delete collection: tenant_{tenantId}
  - Verify: Collection no longer exists
  ↓
Step 4: Delete chunks from PostgreSQL
  - DELETE FROM chunks WHERE tenant_id = {tenantId}
  - Verify: Count = 0
  ↓
Step 5: Delete documents from PostgreSQL
  - DELETE FROM documents WHERE tenant_id = {tenantId}
  - Verify: Count = 0
  ↓
Step 6: Delete query logs
  - DELETE FROM query_logs WHERE tenant_id = {tenantId}
  - Verify: Count = 0
  ↓
Step 7: Delete usage events
  - DELETE FROM usage_events WHERE tenant_id = {tenantId}
  - Verify: Count = 0
  ↓
Step 8: Delete conversations
  - DELETE FROM conversations WHERE tenant_id = {tenantId}
  - Verify: Count = 0
  ↓
Step 9: Delete audit logs (after retention period)
  - Audit logs retained for 1 year per compliance requirements
  - Mark for deletion after retention period expires
  - Schedule: deferred_delete job at retention_expiry_date
  ↓
Step 10: Delete connector credentials
  - DELETE FROM connectors WHERE tenant_id = {tenantId}
  - Wipe encrypted credentials
  ↓
Step 11: Delete API keys
  - DELETE FROM api_keys WHERE tenant_id = {tenantId}
  ↓
Step 12: Delete tenant record (or anonymize if billing history needed)
  - Option A: Full delete for complete erasure
  - Option B: Anonymize (replace PII, keep billing record for tax compliance)
  ↓
Step 13: Generate deletion certificate
  - Record all deletion timestamps
  - Generate signed PDF certificate
  - Send to controller via email
```

**SLA**: Complete erasure within 72 hours. Audit logs retained for compliance minimum, then auto-purged.

### 4.3 Right to Data Portability (Art. 20) — Export in Standard Formats

**Endpoint**: `GET /v1/data-export?tenantId={tenantId}&format=json|csv`

**Exported Data**:

- Documents: Original content, metadata, processing status (JSON)
- Chunks: Chunk content, metadata, vector IDs (JSON)
- Query logs: Queries, results, quality scores (CSV)
- Usage events: Billing events with timestamps (CSV)
- Projects: Project configurations (JSON)
- Connectors: Connector configurations (credentials excluded) (JSON)

**Format Requirements**:

- JSON: Structured, machine-readable, with schema documentation
- CSV: Tabular data with headers, UTF-8 encoded
- ZIP archive for bulk exports
- Schema documentation included in every export

### 4.4 Right to Rectification (Art. 16) — Document Re-upload

**Implementation**: Rectification is handled through the standard document re-upload flow:

1. Customer identifies incorrect data in an indexed document
2. Customer uploads corrected document via `POST /v1/documents/upload`
3. System detects content change via content hash comparison
4. Old chunks and embeddings are replaced (cascade update)
5. Previous version is soft-deleted, hard-purged after 30 days
6. Audit log records the rectification event

**API Endpoint**: Standard `POST /v1/documents/upload` with `replaceDocumentId` parameter.

### 4.5 Right to Restriction of Processing (Art. 18) — Processing Pause

**Endpoint**: `POST /v1/tenants/{tenantId}/restrict`

**Implementation**:

1. Set tenant status to `restricted` in the tenants table
2. API middleware checks tenant status on every request
3. While restricted:
   - Document ingestion jobs are paused (BullMQ job pause)
   - Query requests return 403 with explanation
   - Dashboard shows read-only view of existing data
   - No new data processing occurs
   - Existing data is preserved but not processed
4. Restriction can be lifted via `POST /v1/tenants/{tenantId}/unrestrict`
5. Audit log records restriction start/end with reason

---

## 5. Data Retention Policies

### Default Retention Schedule

| Data Type                       | Default Retention           | Configurable                | Minimum   | Maximum  |
| ------------------------------- | --------------------------- | --------------------------- | --------- | -------- |
| Query logs                      | 90 days                     | Yes (per tenant)            | 30 days   | 1 year   |
| Audit logs                      | 1 year                      | No (compliance requirement) | 1 year    | 3 years  |
| Deleted documents (soft delete) | 30 days                     | Yes (per tenant)            | 7 days    | 90 days  |
| Deleted documents (hard purge)  | 30 days after soft delete   | Automatic                   | N/A       | N/A      |
| Cache entries                   | 1 hour TTL                  | Yes (per project)           | 5 minutes | 24 hours |
| Conversation memory             | 30 days after last activity | Yes (per project)           | 7 days    | 1 year   |
| Usage events                    | 2 years                     | No (billing requirement)    | 2 years   | 5 years  |
| Vector embeddings               | Matches document lifecycle  | Automatic                   | N/A       | N/A      |
| Connector credentials           | Until connector deleted     | N/A                         | N/A       | N/A      |
| API keys                        | Until revoked or expired    | N/A                         | N/A       | N/A      |

### Automated Purge Implementation

A scheduled BullMQ job runs daily to enforce retention policies:

```
Job: data-retention-purge (runs daily at 02:00 UTC)

1. Query logs older than tenant's retention setting → hard delete
2. Soft-deleted documents past retention window → cascade hard delete
   - Delete from PostgreSQL (chunks, documents)
   - Delete from Qdrant (vectors)
   - Delete from Redis (cache entries)
3. Expired conversations → hard delete
4. Expired cache entries → Redis handles via TTL (no action needed)
5. Audit logs past retention → hard delete (only after minimum 1 year)
6. Generate retention compliance report
7. Log all purge actions to audit trail
```

### Tenant-Level Configuration

Tenants can configure retention via the dashboard or API:

```
PATCH /v1/tenants/{tenantId}/settings
{
  "retention": {
    "queryLogDays": 60,
    "softDeleteDays": 14,
    "conversationDays": 90,
    "cacheTtlSeconds": 1800
  }
}
```

---

## 6. Cross-Border Data Transfers

### EU-US Data Privacy Framework

ContextInject will self-certify under the EU-US Data Privacy Framework (DPF) when eligible. This provides the simplest mechanism for EU-to-US data transfers.

**Requirements for DPF**:

- Self-certification with the US Department of Commerce
- Published privacy policy referencing DPF principles
- Independent recourse mechanism for complaints
- Cooperation with EU DPAs
- Annual re-certification

### Standard Contractual Clauses (SCCs)

Until DPF certification is complete, or for transfers to non-DPF countries, ContextInject uses the European Commission's 2021 Standard Contractual Clauses (Module 2: Controller-to-Processor).

**SCC Implementation**:

- SCCs are incorporated into the DPA by reference
- Annex I (Parties, description of transfer, competent supervisory authority) populated per customer
- Annex II (Technical and organizational measures) references [SECURITY_CONTROLS.md](./SECURITY_CONTROLS.md)
- Annex III (Sub-processors) references Section 7 of this document

### Data Residency Implementation

ContextInject supports regional data residency as a first-class feature.

**Region Field**: Every tenant has a `region` field set at creation time:

| Region Code | Data Location           | Available Tiers          |
| ----------- | ----------------------- | ------------------------ |
| `us`        | US East (Virginia)      | All tiers                |
| `eu`        | EU West (Frankfurt)     | Starter, Pro, Enterprise |
| `apac`      | APAC (Singapore/Sydney) | Enterprise only          |

**Architecture**:

```
Global Control Plane (us-east-1)
  - Billing and subscription management
  - Feature flag configuration
  - Cross-region tenant directory

Regional Data Planes
  us: PostgreSQL, Qdrant, Redis, API servers, Workers
  eu: PostgreSQL, Qdrant, Redis, API servers, Workers
  apac: PostgreSQL, Qdrant, Redis, API servers, Workers
```

**Enforcement**:

- Tenant region is immutable after creation (migration requires support ticket)
- All document data, chunks, vectors, query logs, and cache entries remain in-region
- API requests are routed to the correct regional data plane via DNS
- Cross-region replication is disabled by default (available for Enterprise DR)
- Audit logs include region metadata for compliance verification

---

## 7. Sub-Processor List and Notification

### Current Sub-Processors

| Sub-Processor         | Service                            | Data Processed                         | Location              | DPA Status |
| --------------------- | ---------------------------------- | -------------------------------------- | --------------------- | ---------- |
| Cohere Inc.           | Embedding generation, reranking    | Document text (chunked)                | US, Canada            | Signed     |
| Qdrant Cloud          | Vector database storage            | Vector embeddings, metadata            | US, EU (configurable) | Signed     |
| Amazon Web Services   | Cloud infrastructure               | All data (encrypted)                   | US, EU (regional)     | AWS DPA    |
| Google Cloud Platform | Cloud infrastructure (alternative) | All data (encrypted)                   | US, EU (regional)     | GCP DPA    |
| Stripe Inc.           | Payment processing                 | Billing information only               | US                    | Stripe DPA |
| CloudFlare Inc.       | WAF, CDN, DNS                      | Request metadata, IPs                  | Global (edge)         | Signed     |
| Vanta Inc.            | Compliance automation              | Employee data, infrastructure metadata | US                    | Signed     |

### Sub-Processor Change Notification

Per GDPR Art. 28(2), controllers must be notified of sub-processor changes.

**Notification Process**:

1. ContextInject publishes sub-processor list at `contextinject.ai/legal/sub-processors`
2. Changes are emailed to all customers with DPAs 30 days before the change takes effect
3. Customers have 30 days to object to the new sub-processor
4. If objection cannot be resolved, customer may terminate without penalty
5. Notification includes: sub-processor name, service description, data processed, location, DPA status

### Sub-Processor Assessment

Before engaging a new sub-processor:

- [ ] Review their SOC 2 report (or equivalent security certification)
- [ ] Execute a DPA with GDPR-compliant terms
- [ ] Verify data processing location aligns with customer residency requirements
- [ ] Conduct security questionnaire review
- [ ] Document assessment results in vendor register

---

## 8. Cookie Policy for Dashboard

### Cookie Categories

| Category           | Purpose                                  | Consent Required         | Examples                              |
| ------------------ | ---------------------------------------- | ------------------------ | ------------------------------------- |
| Strictly Necessary | Authentication, security, load balancing | No                       | Session cookie, CSRF token            |
| Functional         | User preferences, language               | No (legitimate interest) | Dashboard layout preferences          |
| Analytics          | Usage analytics, feature adoption        | Yes                      | Plausible Analytics (privacy-focused) |
| Marketing          | None planned                             | Yes                      | N/A                                   |

### Implementation

- Cookie consent banner on first dashboard visit
- Granular consent options (not just "accept all")
- Consent stored in localStorage and synced to server
- No cookies set before consent is obtained (except strictly necessary)
- Consent can be withdrawn at any time via dashboard settings
- Cookie policy published at `contextinject.ai/legal/cookies`

**Cookie Consent Tool**: Use a lightweight, GDPR-compliant library (e.g., cookie-consent by Osano or custom implementation).

---

## 9. Privacy Notice Template

Published at `contextinject.ai/privacy` and covering:

1. **Identity and Contact Details** — ContextInject Inc., privacy@contextinject.ai
2. **Types of Data Collected** — Account data (email, name, company), usage data (API calls, query counts), billing data (via Stripe)
3. **Purpose of Processing** — Service provision, billing, support, service improvement
4. **Lawful Basis** — Contract performance, legitimate interest, consent
5. **Data Recipients** — Sub-processors listed in Section 7
6. **International Transfers** — EU-US DPF, SCCs
7. **Retention Periods** — As defined in Section 5
8. **Data Subject Rights** — Access, erasure, portability, rectification, restriction, objection
9. **Right to Complain** — Contact DPO, file complaint with supervisory authority
10. **Automated Decision-Making** — Quality scoring is automated but does not produce legal effects
11. **Updates** — 30-day notice for material changes

---

## 10. Breach Notification Process (72-Hour GDPR Requirement)

### Detection to Notification Timeline

```
Hour 0: Breach detected (automated monitoring, user report, or security scan)
  ↓
Hour 0-1: Incident commander activated (see incident-response.md)
  - Assess scope: what data, how many data subjects, which tenants
  - Contain the breach: revoke access, patch vulnerability, isolate affected systems
  ↓
Hour 1-4: Impact assessment
  - Determine if personal data was exposed
  - Identify affected tenants and data subjects
  - Assess risk to rights and freedoms of data subjects
  ↓
Hour 4-24: Prepare notification
  - Draft supervisory authority notification (if required)
  - Draft affected controller notifications
  - Prepare data subject notification (if high risk)
  ↓
Hour 24-48: Notify affected controllers (our customers)
  - Email notification with: nature of breach, data affected, measures taken, recommended actions
  - Dashboard banner for affected tenants
  ↓
Hour 48-72: Notify supervisory authority (if required)
  - Submit notification to lead supervisory authority (Irish DPC if EU-established)
  - Include: nature of breach, categories of data subjects, approximate number, measures taken
  ↓
Post-72 hours: Ongoing
  - Continue remediation
  - Update controllers with new information
  - Conduct post-mortem (see incident-response.md)
  - Update DPIA if processing risk profile changed
  - File supplementary notification if new information emerges
```

### Notification Decision Matrix

| Scenario                                       | Notify Supervisory Authority? | Notify Controllers? | Notify Data Subjects?   |
| ---------------------------------------------- | ----------------------------- | ------------------- | ----------------------- |
| Encrypted data exposed, key not compromised    | No                            | Yes (inform)        | No                      |
| Unencrypted PII accessed by unauthorized party | Yes                           | Yes (urgent)        | Possibly (if high risk) |
| Data deleted but no access                     | No                            | Yes (inform)        | No                      |
| API key compromised, data accessed             | Yes                           | Yes (urgent)        | Possibly                |
| System misconfiguration, no data accessed      | No                            | Yes (inform)        | No                      |

### Notification Templates

**Controller Notification Email**:

```
Subject: [ContextInject] Security Incident Notification — Action Required

Dear {CustomerName},

We are writing to notify you of a security incident that may have affected
data processed by ContextInject on your behalf.

**Nature of Incident**: {description}
**Date Detected**: {date}
**Data Potentially Affected**: {description}
**Measures Taken**: {actions}
**Recommended Actions**: {recommendations}

We take this matter extremely seriously and are working to ensure it does not
recur. Please contact security@contextinject.ai for any questions.

{Signature}
```

---

## 11. Cross-References

- Security controls: [SECURITY_CONTROLS.md](./SECURITY_CONTROLS.md)
- SOC 2 roadmap: [SOC2_ROADMAP.md](./SOC2_ROADMAP.md)
- Incident response: [incident-response.md](../runbooks/incident-response.md)
- Database recovery: [database-recovery.md](../runbooks/database-recovery.md)
- Data residency architecture: [TECH_STACK_DECISIONS.md](../research/TECH_STACK_DECISIONS.md)
