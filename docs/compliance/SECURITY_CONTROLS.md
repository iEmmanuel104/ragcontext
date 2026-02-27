# Security Controls Matrix

> Complete security controls for ContextInject covering encryption, authentication, authorization, network security, application security, data protection, infrastructure security, and operational security.

---

## 1. Security Architecture Overview

ContextInject operates a defense-in-depth security architecture with multiple layers of protection. Every layer assumes the layer above it could be compromised.

```
Layer 1: Edge Security (CloudFlare WAF, DDoS protection, TLS termination)
Layer 2: Network Security (VPC, security groups, network segmentation)
Layer 3: Application Security (input validation, auth middleware, rate limiting)
Layer 4: Data Security (encryption at rest, PII detection, tenant isolation)
Layer 5: Infrastructure Security (container scanning, dependency scanning, SBOM)
Layer 6: Operational Security (audit logging, monitoring, incident response)
```

---

## 2. Encryption

### 2.1 Encryption at Rest

| Data Store            | Algorithm                        | Key Management           | Notes                            |
| --------------------- | -------------------------------- | ------------------------ | -------------------------------- |
| PostgreSQL 17         | AES-256 (TDE or disk encryption) | AWS KMS / GCP CMEK       | All tables encrypted             |
| Qdrant                | AES-256 (disk encryption)        | Cloud provider KMS       | Vector data + payloads           |
| Redis 7.2+            | AES-256 (disk encryption)        | Cloud provider KMS       | Cache and queue data             |
| File uploads (temp)   | AES-256-GCM                      | Application-level key    | Encrypted before storage         |
| Connector credentials | AES-256-GCM                      | Dedicated encryption key | Per-field encryption             |
| Backups               | AES-256                          | Backup-specific key      | Encrypted at rest and in transit |

**Connector Credential Encryption**:

```typescript
// Encryption: AES-256-GCM with random IV and auth tag
interface EncryptedCredentials {
  encrypted: string; // Base64-encoded ciphertext
  iv: string; // 12-byte initialization vector
  authTag: string; // 16-byte authentication tag
}
// Key derivation: HKDF from master key with tenant-specific salt
// Key rotation: Re-encrypt all credentials when key rotates
```

### 2.2 Encryption in Transit

| Communication Path | Protocol | Configuration                                |
| ------------------ | -------- | -------------------------------------------- |
| Client to API      | TLS 1.3  | HSTS, min TLS 1.2, strong cipher suites only |
| API to PostgreSQL  | TLS 1.3  | `sslmode=verify-full`, certificate pinning   |
| API to Qdrant      | TLS 1.3  | mTLS with client certificates                |
| API to Redis       | TLS 1.3  | `tls: true` in connection config             |
| Worker to services | mTLS     | Mutual TLS with service certificates         |
| API to Cohere      | TLS 1.3  | HTTPS, certificate validation                |
| Dashboard to API   | TLS 1.3  | Same-origin or CORS with credentials         |

**TLS Configuration**:

- Minimum version: TLS 1.2 (prefer TLS 1.3)
- Cipher suites: TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256
- HSTS: `max-age=31536000; includeSubDomains; preload`
- Certificate: Let's Encrypt with auto-renewal (90-day rotation)
- OCSP stapling: Enabled

### 2.3 Bring Your Own Key (BYOK) — Enterprise Tier

Enterprise customers can provide their own encryption keys:

| Feature        | Implementation                                                         |
| -------------- | ---------------------------------------------------------------------- |
| Key storage    | Customer provides KMS ARN (AWS) or CMEK resource (GCP)                 |
| Key rotation   | Customer manages rotation; ContextInject re-encrypts on rotation event |
| Key revocation | Customer revokes key; all tenant data becomes inaccessible             |
| Audit trail    | All key usage logged in customer's CloudTrail/Audit Logs               |
| Scope          | Covers PostgreSQL data, Qdrant vectors, Redis cache, file uploads      |

---

## 3. Authentication

### 3.1 API Key Authentication

| Property      | Value                                                                |
| ------------- | -------------------------------------------------------------------- |
| Generation    | 256-bit cryptographic random (`crypto.randomBytes(32)`)              |
| Format        | `ci_live_{base62_encoded}` or `ci_test_{base62_encoded}`             |
| Storage       | SHA-256 hash only — raw key shown once at creation                   |
| Prefix        | Identifiable prefix for log analysis and key type detection          |
| Lookup        | Hash-based lookup with in-memory LRU cache (5-min TTL, 1000 entries) |
| Rotation      | Create new key, migrate clients, revoke old key — no downtime        |
| Expiration    | Optional expiration date, enforced at auth middleware                |
| Scopes        | `documents:read`, `documents:write`, `query`, `admin`                |
| Rate limiting | Per-key rate limits based on tenant plan                             |

**API Key Lifecycle**:

```
Create -> SHA-256 hash -> Store hash in DB -> Return raw key to user (once)
  |
On request: Extract from Bearer header -> Hash -> Cache lookup -> DB lookup
  |
Validate: Check expiration -> Check scopes -> Load tenant -> Proceed
  |
Rotate: Create new key -> Customer updates clients -> Revoke old key
```

### 3.2 JWT Authentication (Dashboard)

| Property          | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| Algorithm         | RS256 (RSA with SHA-256)                                |
| Access token TTL  | 15 minutes                                              |
| Refresh token TTL | 7 days                                                  |
| Refresh rotation  | New refresh token issued on each refresh (one-time use) |
| Token storage     | httpOnly, Secure, SameSite=Strict cookies               |
| Key pair rotation | 90-day rotation with graceful overlap                   |
| Revocation        | Token blacklist in Redis for immediate revocation       |

### 3.3 OAuth 2.0 PKCE (Dashboard Login)

| Property        | Value                                            |
| --------------- | ------------------------------------------------ |
| Flow            | Authorization Code with PKCE (S256)              |
| Providers       | Google, GitHub (initial), Microsoft (Enterprise) |
| State parameter | Cryptographic random, validated server-side      |
| Nonce           | Required for OpenID Connect flows                |
| Redirect URI    | Strict whitelist, no wildcards                   |

### 3.4 SSO/SAML (Enterprise Tier)

| Property           | Value                                             |
| ------------------ | ------------------------------------------------- |
| Protocol           | SAML 2.0                                          |
| IdP Support        | Okta, Azure AD, OneLogin, Google Workspace        |
| Attribute mapping  | email, name, groups mapped to ContextInject roles |
| JIT provisioning   | Create user on first SAML login                   |
| Session management | Respect IdP session lifetime                      |
| Integration        | Via WorkOS or Auth0 for simplified implementation |

---

## 4. Authorization

### 4.1 Role-Based Access Control (RBAC)

| Role   | Dashboard | Documents  | Query | Projects | Connectors | Billing | Users  |
| ------ | --------- | ---------- | ----- | -------- | ---------- | ------- | ------ |
| Owner  | Full      | Full       | Full  | Full     | Full       | Full    | Full   |
| Admin  | Full      | Full       | Full  | Full     | Full       | View    | Manage |
| Member | View      | Read/Write | Full  | View     | View       | None    | None   |
| Viewer | View      | Read       | Read  | View     | None       | None    | None   |

**Role Assignment**:

- Owner: Tenant creator, exactly one per tenant, transferable
- Admin: Assigned by Owner, can manage most settings
- Member: Default role for invited users
- Viewer: Read-only access for stakeholders

### 4.2 API Key Scopes

| Scope             | Permitted Operations                                    |
| ----------------- | ------------------------------------------------------- |
| `query`           | `POST /v1/query`                                        |
| `documents:read`  | `GET /v1/documents`, `GET /v1/documents/:id`            |
| `documents:write` | `POST /v1/documents/upload`, `DELETE /v1/documents/:id` |
| `admin`           | All operations including project/connector management   |

**Scope Enforcement**:

```typescript
// Middleware: requireScope('documents:write')
// Checks req.apiKeyScopes.includes(requiredScope) || req.apiKeyScopes.includes('admin')
```

### 4.3 Row-Level Security (PostgreSQL)

All data queries are tenant-scoped via PostgreSQL RLS policies:

```sql
-- Enable RLS on all data tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Policy: users can only access their tenant data
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Set tenant context on every request (in middleware)
SET LOCAL app.current_tenant_id = '{tenantId}';
```

**Defense in Depth**: Even if application code has a bug, RLS prevents cross-tenant data access at the database level.

---

## 5. Network Security

### 5.1 CloudFlare WAF

| Rule Category      | Configuration                                                |
| ------------------ | ------------------------------------------------------------ |
| DDoS protection    | Always enabled, automatic mitigation                         |
| Rate limiting      | Edge rate limiting before requests reach origin              |
| Bot management     | Challenge suspicious automated traffic                       |
| OWASP Core Ruleset | Enabled with tuning for API traffic                          |
| Custom rules       | Block known attack patterns, geo-restrictions for Enterprise |
| IP reputation      | Block requests from known malicious IPs                      |
| SSL/TLS            | Full (strict) mode, minimum TLS 1.2                          |

### 5.2 Rate Limiting per Endpoint

| Endpoint                    | Free    | Starter | Pro       | Enterprise |
| --------------------------- | ------- | ------- | --------- | ---------- |
| `POST /v1/query`            | 60/min  | 300/min | 1,000/min | 5,000/min  |
| `POST /v1/documents/upload` | 10/min  | 50/min  | 200/min   | 1,000/min  |
| `GET /v1/documents`         | 120/min | 600/min | 2,000/min | 10,000/min |
| `POST /v1/projects`         | 5/min   | 20/min  | 100/min   | 500/min    |
| `POST /v1/connectors`       | 5/min   | 20/min  | 100/min   | 500/min    |
| Authentication endpoints    | 10/min  | 10/min  | 10/min    | 10/min     |

**Rate Limiting Implementation**:

- Algorithm: Sliding window counter (express-rate-limit with Redis store)
- Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (draft-7 standard)
- Response on limit: HTTP 429 with `Retry-After` header and JSON error body

### 5.3 IP Allowlisting (Enterprise)

Enterprise tenants can restrict API access to specific IP ranges:

- Configured via dashboard or API: `PATCH /v1/tenants/{id}/settings`
- Stored in tenant settings, cached in Redis for fast lookup
- Supports CIDR notation (e.g., `10.0.0.0/8`, `192.168.1.0/24`)
- Bypass for dashboard access via separate allowlist

### 5.4 Network Architecture

```
                    Internet
                       |
                CloudFlare WAF
                       |
                Load Balancer
              (public subnet)
                   |       |
              API Server   Dashboard
            (private subnet)
              |    |    |
        ------+----+----+------
        |     |    |    |     |
   PostgreSQL Qdrant Redis  Worker
   (private) (private)(priv)(private)
```

- All data stores in private subnets with no public IP addresses
- Security groups restrict inbound traffic to application tier only
- Network ACLs as secondary defense layer
- VPC Flow Logs enabled for network traffic auditing

---

## 6. Application Security

### 6.1 Input Validation (Zod)

Every API endpoint validates input using Zod schemas:

```typescript
// Example: Query endpoint validation
const QuerySchema = z.object({
  query: z.string().min(1).max(2000),
  projectId: z.string().uuid(),
  topK: z.number().int().min(1).max(20).default(5),
  filters: z
    .array(
      z.object({
        field: z.string().max(100),
        operator: z.enum(["eq", "neq", "in", "nin", "contains"]),
        value: z.unknown(),
      }),
    )
    .optional(),
});
```

**Validation Rules**:

- All string inputs have maximum length constraints
- UUIDs validated with `z.string().uuid()`
- Numeric inputs have min/max bounds
- File uploads validated by MIME type and size (50MB max)
- JSON payloads limited to 50MB
- No dynamic code execution or unsafe interpretation of user-supplied strings
- No template injection paths in any server-side rendering

### 6.2 SQL Injection Prevention

- **Drizzle ORM**: All queries use parameterized queries by default
- **No raw SQL**: Direct SQL execution is prohibited in application code
- **PostgreSQL RLS**: Additional defense layer even if query construction fails
- **Audit**: Regular code review for any `sql.raw()` or string concatenation in queries

### 6.3 XSS Prevention

- **React auto-escaping**: Dashboard uses React which auto-escapes all JSX content by default
- **Content-Security-Policy**: Strict CSP headers on dashboard
- **No raw HTML rendering**: Code review enforces that user content is never rendered as raw HTML
- **API responses**: JSON only, no HTML rendering from user input
- **Helmet.js**: Security headers including X-XSS-Protection, X-Content-Type-Options

### 6.4 CSRF Protection

- **Double-submit cookie pattern**: CSRF token in cookie + request header
- **SameSite=Strict**: Cookie attribute prevents cross-origin requests
- **Origin validation**: Verify Origin header matches allowed domains
- **API keys exempt**: API key authentication is inherently CSRF-resistant

### 6.5 Vector Injection Prevention

Malicious actors may attempt to craft embeddings that manipulate retrieval results.

| Attack Vector                 | Detection                                           | Prevention                                    |
| ----------------------------- | --------------------------------------------------- | --------------------------------------------- |
| Anomalous L2 norms            | Monitor embedding norms, flag outliers (>3 std dev) | Reject embeddings with abnormal norms         |
| Adversarial documents         | Content analysis before embedding                   | Document quality scoring, admin review        |
| Prompt injection in documents | Pattern matching for known injection patterns       | PII/injection detection in ingestion pipeline |
| Embedding space poisoning     | Cluster analysis on new embeddings                  | Quarantine documents with outlier embeddings  |

**Implementation**:

```typescript
// L2 norm anomaly detection
function validateEmbedding(embedding: number[]): boolean {
  const l2Norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  // Cohere v4 embeddings are unit-normalized; reject if far from 1.0
  return l2Norm > 0.8 && l2Norm < 1.2;
}
```

### 6.6 Prompt Injection Detection

For the MCP server and any LLM-integrated features:

| Layer                 | Technique                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Input scanning        | Pattern match for known injection strings ("ignore previous instructions", "system prompt:", etc.) |
| Structural separation | XML tags to separate system context from user input                                                |
| Output validation     | Verify LLM output matches expected format                                                          |
| Logging               | Log all detected injection attempts with full context                                              |

---

## 7. Data Security

### 7.1 PII Detection (Microsoft Presidio)

**Integration Point**: Ingestion pipeline, after chunking, before embedding.

| Entity Type         | Detection Method | Action                                         |
| ------------------- | ---------------- | ---------------------------------------------- |
| Email addresses     | Pattern + NER    | Flag, optional redaction                       |
| Phone numbers       | Pattern + NER    | Flag, optional redaction                       |
| SSN/National IDs    | Pattern          | Flag, mandatory redaction                      |
| Credit card numbers | Luhn + pattern   | Block ingestion, alert                         |
| Physical addresses  | NER              | Flag, optional redaction                       |
| Names               | NER              | Flag (high false positive rate — configurable) |

**Tenant Configuration**:

```json
{
  "piiDetection": {
    "enabled": true,
    "mode": "flag",
    "entities": ["email", "phone", "ssn", "credit_card"],
    "threshold": 0.85,
    "exemptConnectors": []
  }
}
```

### 7.2 Key Rotation

| Key Type              | Rotation Period  | Process                                                      |
| --------------------- | ---------------- | ------------------------------------------------------------ |
| Encryption master key | 90 days          | Generate new key, re-encrypt all credentials, retire old key |
| JWT signing key pair  | 90 days          | Generate new pair, overlap period (24h), retire old pair     |
| API keys              | Customer-managed | Create new, update clients, revoke old                       |
| TLS certificates      | 90 days (auto)   | Let's Encrypt auto-renewal                                   |
| Database credentials  | 90 days          | Rotate in secrets manager, update connection strings         |
| Cohere API key        | 90 days          | Rotate in Cohere dashboard, update environment               |

### 7.3 Data Classification

| Classification | Examples                                  | Controls                                  |
| -------------- | ----------------------------------------- | ----------------------------------------- |
| Public         | API documentation, marketing site         | No restrictions                           |
| Internal       | Architecture docs, meeting notes          | Employee access only                      |
| Confidential   | Customer data, query logs, embeddings     | Encrypted, access-controlled, audited     |
| Restricted     | Encryption keys, credentials, API secrets | Encrypted, minimal access, audit + alerts |

---

## 8. Infrastructure Security

### 8.1 Container Security

| Control              | Tool                       | Integration                       |
| -------------------- | -------------------------- | --------------------------------- |
| Image scanning       | Trivy                      | CI/CD pipeline, block on Critical |
| Base image           | `node:22-alpine`           | Minimal attack surface            |
| Non-root user        | Dockerfile `USER node`     | No root processes in containers   |
| Read-only filesystem | Docker `--read-only`       | Prevent runtime modifications     |
| Resource limits      | Kubernetes resource quotas | Prevent resource exhaustion       |
| Network policies     | Kubernetes NetworkPolicy   | Restrict inter-pod communication  |

### 8.2 Dependency Scanning (Snyk)

| Configuration      | Value                                          |
| ------------------ | ---------------------------------------------- |
| Scan frequency     | Every PR + weekly scheduled scan               |
| Severity threshold | Block on Critical and High                     |
| Auto-fix PRs       | Enabled for patch updates                      |
| License compliance | Block copyleft licenses in proprietary code    |
| SBOM generation    | CycloneDX format, attached to every release    |
| Remediation SLA    | Critical: 24h, High: 7d, Medium: 30d, Low: 90d |

### 8.3 Secrets Management

| Secret Type          | Storage                                  | Access Method                     |
| -------------------- | ---------------------------------------- | --------------------------------- |
| Application secrets  | AWS Secrets Manager / GCP Secret Manager | IAM role-based access             |
| Database credentials | Secrets Manager                          | Injected as environment variables |
| API keys (external)  | Secrets Manager                          | Injected as environment variables |
| Encryption keys      | AWS KMS / GCP CMEK                       | SDK-based access with audit trail |
| CI/CD secrets        | GitHub Actions secrets                   | Encrypted, available to workflows |

**Rules**:

- No secrets in code repositories (enforced by git-secrets pre-commit hook)
- No secrets in Docker images (multi-stage builds, runtime injection)
- No secrets in logs (Pino redaction for sensitive fields)
- No secrets in error messages (generic error responses to clients)

---

## 9. Operational Security

### 9.1 Audit Logging

Every security-relevant action is logged to the audit trail:

| Event Category    | Examples                                             | Retention |
| ----------------- | ---------------------------------------------------- | --------- |
| Authentication    | Login, logout, failed login, API key usage           | 1 year    |
| Authorization     | Permission denied, scope violation                   | 1 year    |
| Data access       | Document read, query execution, export               | 1 year    |
| Data modification | Document create/update/delete, setting changes       | 1 year    |
| Admin actions     | User invite, role change, key creation/revocation    | 1 year    |
| Security events   | Rate limit hit, injection attempt, anomaly detection | 1 year    |

**Audit Log Schema**:

```json
{
  "timestamp": "2026-02-23T12:00:00Z",
  "eventType": "document.delete",
  "actor": { "type": "api_key", "id": "key_xxx", "tenantId": "tenant_xxx" },
  "resource": { "type": "document", "id": "doc_xxx" },
  "action": "delete",
  "result": "success",
  "metadata": { "ip": "1.2.3.4", "userAgent": "context-inject-sdk/1.0.0" },
  "requestId": "req_xxx"
}
```

**Audit Log Protection**:

- Append-only storage (no update or delete operations)
- Separate from application database for tamper resistance
- Encrypted at rest
- Access restricted to admin role only
- Exported to SIEM for enterprise customers

### 9.2 Security Monitoring

| Metric                   | Alert Threshold                 | Response                      |
| ------------------------ | ------------------------------- | ----------------------------- |
| Failed auth rate         | >50/min per IP                  | Auto-block IP for 1 hour      |
| Error rate (5xx)         | >1% over 5 minutes              | P2 incident, on-call notified |
| Latency spike            | p99 >2s over 5 minutes          | P3 investigation              |
| Unusual query volume     | >200% of trailing 7-day average | P3 investigation              |
| Dependency vulnerability | Critical severity               | P2 remediation within 24h     |
| Certificate expiry       | <14 days remaining              | P3 renewal                    |
| Disk usage               | >80% capacity                   | P3 capacity planning          |

### 9.3 Penetration Testing

| Aspect          | Policy                                                        |
| --------------- | ------------------------------------------------------------- |
| Frequency       | Annual by external firm, quarterly internal                   |
| Scope           | Full application + infrastructure                             |
| Methodology     | OWASP Testing Guide, PTES                                     |
| Reporting       | Findings documented with severity, remediation plan, timeline |
| Remediation SLA | Critical: 7d, High: 30d, Medium: 90d                          |
| Re-test         | Verify remediation within 2 weeks of fix                      |
| Budget          | $5,000-$10,000 per engagement                                 |

---

## 10. Compliance Alignment

### OWASP Top 10 Coverage

| OWASP Risk                     | ContextInject Controls                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- |
| A01: Broken Access Control     | RBAC, API key scopes, PostgreSQL RLS, tenant isolation                        |
| A02: Cryptographic Failures    | AES-256-GCM at rest, TLS 1.3, key management, no weak ciphers                 |
| A03: Injection                 | Drizzle ORM (parameterized), Zod validation, CSP headers                      |
| A04: Insecure Design           | Threat modeling (STRIDE), security reviews in design phase                    |
| A05: Security Misconfiguration | Helmet.js, secure defaults, infrastructure as code, scanning                  |
| A06: Vulnerable Components     | Snyk scanning, SBOM, automated patching                                       |
| A07: Auth Failures             | SHA-256 hashed keys, JWT RS256, MFA, session management                       |
| A08: Data Integrity Failures   | Content hash verification, signed deployments, CI/CD gates                    |
| A09: Logging and Monitoring    | Pino structured logging, OpenTelemetry, Prometheus, alerting                  |
| A10: SSRF                      | No user-controlled URLs in server-side requests, URL allowlist for connectors |

### Security Testing in CI

```yaml
# Security gates in GitHub Actions CI pipeline
- name: Dependency scan
  run: snyk test --severity-threshold=high
- name: Container scan
  run: trivy image --severity HIGH,CRITICAL --exit-code 1 $IMAGE
- name: SBOM generation
  run: cyclonedx-npm --output sbom.json
- name: Secret detection
  run: gitleaks detect --source . --verbose
- name: License compliance
  run: snyk test --license-only
```

---

## 11. Cross-References

- SOC 2 certification roadmap: [SOC2_ROADMAP.md](./SOC2_ROADMAP.md)
- GDPR data protection: [GDPR_IMPLEMENTATION.md](./GDPR_IMPLEMENTATION.md)
- Incident response runbook: [incident-response.md](../runbooks/incident-response.md)
- Performance and tuning: [performance-tuning.md](../runbooks/performance-tuning.md)
- On-call escalation: [on-call-escalation.md](../runbooks/on-call-escalation.md)
- Tech stack decisions: [TECH_STACK_DECISIONS.md](../research/TECH_STACK_DECISIONS.md)
