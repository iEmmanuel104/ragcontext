# SOC 2 Certification Roadmap

> ContextInject compliance certification plan for SOC 2 Type I (Month 8) and Type II (Month 12-18).

---

## 1. Executive Summary

SOC 2 compliance is the primary enterprise gate for ContextInject. Without SOC 2 Type I, enterprise procurement teams will not proceed past security questionnaires. This roadmap targets **SOC 2 Type I certification by Month 8** with a total budget of $20K-$40K, followed by **SOC 2 Type II by Month 12-18** at $30K-$60K.

### Why SOC 2 First

- SOC 2 is the most requested compliance certification in SaaS procurement (asked by >80% of enterprise buyers)
- Type I is achievable in 1.5-3.5 months with compliance automation
- It unlocks enterprise contracts at $24K+/year, justifying the investment within 1-2 deals
- Competitors: Ragie does not yet have SOC 2; Pinecone and Qdrant Cloud have it — we must reach parity

### Timeline Overview

| Phase                 | Timeline    | Activities                                                  | Budget    |
| --------------------- | ----------- | ----------------------------------------------------------- | --------- |
| Preparation           | Month 5     | Gap assessment, tool setup, policy drafting                 | $10K-$15K |
| Readiness Assessment  | Month 6-7   | Control implementation, evidence collection, internal audit | $5K-$10K  |
| Auditor Engagement    | Month 8     | Formal audit, report generation                             | $5K-$15K  |
| Type II Observation   | Month 12-15 | 3-month continuous monitoring                               | Ongoing   |
| Type II Certification | Month 15-18 | Formal Type II audit                                        | $30K-$60K |

---

## 2. Trust Service Criteria Mapping

SOC 2 is built on the AICPA Trust Service Criteria. We target **Security** as the primary criterion for Type I, then add Availability, Processing Integrity, Confidentiality, and Privacy for Type II.

### Primary Criteria: Security (Type I)

Security is mandatory for all SOC 2 reports. The Common Criteria (CC) categories are:

| Category | Description                          | Priority |
| -------- | ------------------------------------ | -------- |
| CC1      | Control Environment                  | Required |
| CC2      | Communication and Information        | Required |
| CC3      | Risk Assessment                      | Required |
| CC5      | Control Activities                   | Required |
| CC6      | Logical and Physical Access Controls | Required |
| CC7      | System Operations                    | Required |
| CC8      | Change Management                    | Required |
| CC9      | Risk Mitigation                      | Required |

### Additional Criteria (Type II)

| Criterion            | Relevance to ContextInject                                                             | Timeline |
| -------------------- | -------------------------------------------------------------------------------------- | -------- |
| Availability         | 99.9%+ SLA commitments for Pro/Enterprise tiers                                        | Type II  |
| Processing Integrity | RAG pipeline produces accurate, complete results                                       | Type II  |
| Confidentiality      | Multi-tenant data isolation, encryption at rest                                        | Type II  |
| Privacy              | GDPR compliance, PII handling (see [GDPR_IMPLEMENTATION.md](./GDPR_IMPLEMENTATION.md)) | Type II  |

---

## 3. Security Criteria Controls — Detailed Implementation

### CC1: Control Environment

**Objective**: Establish organizational commitment to integrity, ethical values, and security.

| Control                          | Implementation                                                                             | Evidence                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| CC1.1 — Security policies        | Draft Information Security Policy, Acceptable Use Policy, Data Classification Policy       | Policy documents with version history, board approval records |
| CC1.2 — Organizational structure | Define security roles: CTO (security owner), DPO (data protection), on-call engineers      | Org chart, role descriptions, RACI matrix                     |
| CC1.3 — Board oversight          | Quarterly security reviews with founding team, document decisions                          | Meeting minutes, action items, resolution tracking            |
| CC1.4 — Personnel management     | Background checks for employees with data access, security training within 30 days of hire | Training completion records, background check confirmations   |

**Key Deliverables**:

- Information Security Policy (20-30 pages covering all CC categories)
- Acceptable Use Policy for internal systems
- Data Classification Policy (Public, Internal, Confidential, Restricted)
- Security roles and responsibilities matrix

### CC2: Communication and Information

**Objective**: Ensure security information is communicated to internal and external parties.

| Control                              | Implementation                                                                           | Evidence                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| CC2.1 — Internal communication       | Security awareness training quarterly via Vanta/KnowBe4, Slack #security channel         | Training completion rates, quiz scores            |
| CC2.2 — Security policies accessible | Internal wiki with all policies, new hire onboarding checklist                           | Wiki access logs, onboarding checklist completion |
| CC2.3 — External communication       | Security page on website, Trust Center (powered by Vanta), responsible disclosure policy | Published URLs, Trust Center metrics              |
| CC2.4 — Reporting mechanisms         | security@contextinject.ai alias, anonymous reporting channel                             | Email forwarding config, channel setup            |

**Training Program**:

- New hire: 2-hour security onboarding within first week
- Quarterly: 30-minute refresher on current threats and policies
- Annual: Comprehensive security awareness review with assessment
- Ad-hoc: Targeted training after incidents or policy changes
- Topics: Phishing recognition, API key handling, PII awareness, incident reporting

### CC3: Risk Assessment

**Objective**: Identify and assess risks to the achievement of security objectives.

| Control                          | Implementation                                                                           | Evidence                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| CC3.1 — Risk register            | Maintain a risk register in Vanta with likelihood/impact scoring                         | Risk register export, quarterly review records     |
| CC3.2 — Threat modeling          | STRIDE threat model for each component: API, worker, dashboard, MCP server, vector store | Threat model documents per component               |
| CC3.3 — Vulnerability management | Snyk for dependency scanning, weekly automated scans, SLA for remediation                | Snyk dashboard exports, remediation SLA compliance |
| CC3.4 — Risk acceptance process  | CTO approval required for accepting risks rated Medium or above                          | Approval records, risk acceptance forms            |

**Risk Register Categories**:

- Infrastructure risks: Cloud provider outages, database failures, DDoS attacks
- Application risks: Vector injection, prompt injection, tenant data leakage
- Data risks: PII exposure, unauthorized access, data loss
- Vendor risks: Cohere API outage, Qdrant Cloud degradation, payment processor issues
- Compliance risks: Regulatory changes, cross-border data transfer restrictions
- Operational risks: Key person dependency, insufficient monitoring

**Threat Modeling Schedule**:

- Initial: Full STRIDE analysis for all components before Type I audit
- Quarterly: Review and update for changed components
- Ad-hoc: New feature threat review during design phase
- Annual: Comprehensive re-assessment with external consultant

### CC5: Control Activities

**Objective**: Select and develop control activities that mitigate risks.

| Control                         | Implementation                                                                          | Evidence                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CC5.1 — Access controls         | RBAC with four roles (owner, admin, member, viewer), API key scopes, PostgreSQL RLS     | Access control configuration, RBAC policy document               |
| CC5.2 — Encryption              | AES-256-GCM at rest, TLS 1.3 in transit, mTLS service-to-service                        | Encryption configuration exports, certificate inventory          |
| CC5.3 — Monitoring and alerting | Prometheus + Grafana dashboards, PagerDuty alerting, Pino structured logging            | Dashboard screenshots, alert configuration, log retention policy |
| CC5.4 — Data backup             | PostgreSQL PITR (5-min RPO), Qdrant snapshots (hourly), Redis RDB + AOF                 | Backup configuration, restore test records                       |
| CC5.5 — Endpoint protection     | Container image scanning (Trivy), SBOM generation (CycloneDX), Snyk dependency scanning | Scan reports, SBOM exports                                       |

**Encryption Standards**:

- At rest: AES-256-GCM for all data stores, per-tenant encryption keys for Enterprise tier
- In transit: TLS 1.3 minimum, HSTS headers, certificate pinning for internal services
- Key management: AWS KMS or HashiCorp Vault, 90-day key rotation, BYOK for Enterprise
- Credential storage: AES-256-GCM encrypted, separate encryption key from data keys

### CC6: Logical and Physical Access Controls

**Objective**: Restrict logical and physical access to authorized individuals.

| Control                      | Implementation                                                                       | Evidence                                           |
| ---------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| CC6.1 — User authentication  | MFA required for all internal systems (GitHub, AWS, dashboard admin)                 | MFA enrollment reports                             |
| CC6.2 — Access provisioning  | Least privilege by default, access requests via ticketing system                     | Access request tickets, approval records           |
| CC6.3 — Access reviews       | Quarterly access reviews for all systems, immediate revocation on termination        | Access review records, offboarding checklist       |
| CC6.4 — Network segmentation | VPC with private subnets for databases, public subnets for API only, security groups | Network architecture diagram, security group rules |
| CC6.5 — API authentication   | SHA-256 hashed API keys, JWT RS256 with 15-min access tokens, OAuth 2.0 PKCE         | Auth middleware code, token configuration          |
| CC6.6 — Session management   | 15-minute access token TTL, 7-day refresh token with rotation, secure cookie flags   | Token configuration, cookie policy                 |

**Network Architecture for SOC 2**:

```
Internet → CloudFlare WAF → Load Balancer (public subnet)
  → API servers (private subnet)
    → PostgreSQL 17 (private subnet, no public access)
    → Qdrant (private subnet, no public access)
    → Redis 7.2+ (private subnet, no public access)
```

### CC7: System Operations

**Objective**: Detect and respond to system anomalies and security events.

| Control                        | Implementation                                                                                                                    | Evidence                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| CC7.1 — Monitoring             | OpenTelemetry traces, Prometheus metrics, Grafana dashboards                                                                      | Dashboard screenshots, metric configuration             |
| CC7.2 — Incident response      | Documented IRP with severity levels P1-P4, incident commander role (see [incident-response.md](../runbooks/incident-response.md)) | IRP document, incident log, post-mortem records         |
| CC7.3 — Anomaly detection      | Automated alerts for error rate spikes, latency anomalies, unusual access patterns                                                | Alert rules, triggered alert history                    |
| CC7.4 — Logging                | Structured JSON logs via Pino, centralized log aggregation, 1-year retention for audit logs                                       | Log configuration, retention policy, sample log exports |
| CC7.5 — Vulnerability scanning | Weekly automated scans (Snyk), annual penetration test, OWASP Top 10 coverage                                                     | Scan reports, pentest reports, remediation records      |

**Incident Response SLAs**:

- P1 (Critical): 15-minute response, 1-hour resolution target
- P2 (High): 30-minute response, 4-hour resolution target
- P3 (Medium): 2-hour response, 24-hour resolution target
- P4 (Low): Next business day

### CC8: Change Management

**Objective**: Manage changes to infrastructure and software in a controlled manner.

| Control                      | Implementation                                                                                             | Evidence                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CC8.1 — Code review          | All PRs require at least 1 approval, no direct commits to main                                             | GitHub branch protection rules, PR merge records |
| CC8.2 — CI/CD gates          | Automated tests, linting, security scanning before merge; deployment approval for production               | GitHub Actions workflow configs, deployment logs |
| CC8.3 — Change documentation | Conventional commits, automated changelog via release-please                                               | Commit history, changelogs, release notes        |
| CC8.4 — Rollback procedures  | Blue-green deployment, feature flags via environment variables, database migration rollbacks (Drizzle Kit) | Deployment configuration, rollback test records  |
| CC8.5 — Emergency changes    | Documented emergency change process, post-implementation review required                                   | Emergency change log, review records             |

**CI/CD Pipeline Security Gates**:

1. `pnpm lint` — Code style enforcement
2. `pnpm test` — Unit and integration tests (>80% coverage)
3. Snyk dependency scan — Block on critical/high vulnerabilities
4. Trivy container scan — Block on critical findings
5. SBOM generation — CycloneDX output attached to release
6. Deployment approval — Required for production deployments
7. Post-deployment smoke test — Automated health check

### CC9: Risk Mitigation

**Objective**: Identify, assess, and manage risks from third-party vendors.

| Control                     | Implementation                                                           | Evidence                                          |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| CC9.1 — Vendor inventory    | Maintain list of all third-party services with risk ratings              | Vendor register in Vanta                          |
| CC9.2 — Vendor assessment   | Annual security questionnaire for critical vendors, SOC 2 report review  | Completed questionnaires, SOC 2 report copies     |
| CC9.3 — Contract management | DPA requirements, security SLA clauses, breach notification requirements | Contract excerpts, DPA copies                     |
| CC9.4 — Vendor monitoring   | Monitor vendor status pages, subscribe to security advisories            | Monitoring configuration, advisory review records |

**Critical Vendor Risk Assessment**:

| Vendor       | Service                    | Risk Level | SOC 2       | Mitigation                           |
| ------------ | -------------------------- | ---------- | ----------- | ------------------------------------ |
| Cohere       | Embedding + Reranking APIs | High       | Yes         | Fallback to BGE-M3 self-hosted       |
| Qdrant Cloud | Vector database            | High       | In progress | pgvector fallback, regular snapshots |
| AWS/GCP      | Cloud infrastructure       | High       | Yes         | Multi-region, IaC with Terraform     |
| Stripe       | Payment processing         | Medium     | Yes         | PCI DSS compliant                    |
| CloudFlare   | WAF + CDN                  | Medium     | Yes         | Fallback DNS configuration           |
| Redis Cloud  | Cache + queues             | Medium     | Yes         | Self-hosted Redis fallback           |

---

## 4. Compliance Automation Tools

### Recommended: Vanta ($10K/year)

Vanta automates 80%+ of SOC 2 evidence collection and is the most popular choice for startups.

**Why Vanta**:

- Integrates with GitHub, AWS, GCP, Azure, Google Workspace, Slack, Okta
- Automated evidence collection for 90%+ of controls
- Policy templates pre-mapped to SOC 2 criteria
- Continuous monitoring with real-time compliance dashboard
- Trust Center for customer-facing compliance documentation
- Used by 7,000+ companies including Notion, Lattice, and Loom

**Setup Timeline**:

- Week 1: Connect cloud infrastructure (AWS/GCP), GitHub, Google Workspace
- Week 2: Deploy Vanta agent on employee devices, configure HR integration
- Week 3: Customize policy templates for ContextInject
- Week 4: Begin automated evidence collection, gap assessment

### Alternative: Drata ($8K-$12K/year)

- Stronger on international frameworks (ISO 27001, GDPR)
- Better custom control builder
- Consider if planning ISO 27001 alongside SOC 2

### Alternative: Secureframe ($8K-$10K/year)

- Fastest time-to-compliance claims
- Good for teams wanting minimal configuration
- Slightly smaller integration library than Vanta

---

## 5. Evidence Collection Strategy

### Automated Evidence (via Vanta)

| Evidence Type         | Source                            | Frequency      |
| --------------------- | --------------------------------- | -------------- |
| Access reviews        | GitHub, AWS IAM, Google Workspace | Continuous     |
| MFA enrollment        | Google Workspace, AWS             | Continuous     |
| Vulnerability scans   | Snyk, Trivy                       | Weekly         |
| Infrastructure config | Terraform state, AWS Config       | Continuous     |
| Code review records   | GitHub PR history                 | Continuous     |
| Deployment logs       | GitHub Actions                    | Per deployment |
| Uptime metrics        | Prometheus, status page           | Continuous     |

### Manual Evidence (quarterly collection)

| Evidence Type                       | Owner              | Frequency    |
| ----------------------------------- | ------------------ | ------------ |
| Security awareness training records | CTO                | Quarterly    |
| Risk register review                | CTO                | Quarterly    |
| Access review approvals             | CTO                | Quarterly    |
| Vendor security assessments         | CTO                | Annual       |
| Penetration test reports            | External firm      | Annual       |
| Board security review minutes       | CEO                | Quarterly    |
| Incident post-mortems               | Incident commander | Per incident |
| Business continuity plan review     | CTO                | Annual       |

### Evidence Storage

- Vanta platform: Primary storage for all automated and uploaded evidence
- Google Drive (backup): Organized folder structure mirroring CC categories
- Retention: Minimum 1 year for all evidence, 3 years recommended

---

## 6. Cost Breakdown

### SOC 2 Type I (Target: Month 8)

| Item                          | Cost                | Notes                                       |
| ----------------------------- | ------------------- | ------------------------------------------- |
| Compliance automation (Vanta) | $10,000/year        | Annual subscription                         |
| Auditor engagement (Type I)   | $8,000-$20,000      | Depends on firm size                        |
| Policy drafting assistance    | $2,000-$5,000       | Can be done in-house with templates         |
| Penetration test              | $5,000-$10,000      | Annual, required before audit               |
| Employee training platform    | $0-$2,000           | Vanta includes basics, KnowBe4 for advanced |
| **Total Type I**              | **$20,000-$40,000** | One-time                                    |

### SOC 2 Type II (Target: Month 12-18)

| Item                         | Cost                | Notes                                |
| ---------------------------- | ------------------- | ------------------------------------ |
| Continued Vanta subscription | $10,000/year        | Ongoing                              |
| Auditor engagement (Type II) | $15,000-$35,000     | 3-month observation + report         |
| Ongoing penetration testing  | $5,000-$10,000      | Annual                               |
| Remediation costs            | $5,000-$15,000      | Addressing findings from observation |
| **Total Type II**            | **$30,000-$60,000** | Annual recurring                     |

### ROI Justification

- A single Enterprise contract ($24K+/year) covers the entire Type I cost
- SOC 2 eliminates the #1 blocker in enterprise sales cycles
- Competitors without SOC 2 (Ragie) lose deals we can win
- Enterprise deals average $50K-$250K/year at scale — SOC 2 is table stakes

---

## 7. Detailed Timeline

### Month 5: Preparation Phase

**Week 1-2: Tool Setup and Gap Assessment**

- [ ] Purchase and configure Vanta
- [ ] Connect all infrastructure integrations (AWS/GCP, GitHub, Google Workspace)
- [ ] Run initial gap assessment — identify missing controls
- [ ] Create project plan with assigned owners for each control gap

**Week 3-4: Policy Drafting**

- [ ] Draft Information Security Policy
- [ ] Draft Acceptable Use Policy
- [ ] Draft Data Classification Policy
- [ ] Draft Access Control Policy
- [ ] Draft Incident Response Plan (cross-ref: [incident-response.md](../runbooks/incident-response.md))
- [ ] Draft Change Management Policy
- [ ] Draft Vendor Management Policy
- [ ] Draft Data Retention Policy (cross-ref: [GDPR_IMPLEMENTATION.md](./GDPR_IMPLEMENTATION.md))
- [ ] Review all policies with founding team, obtain sign-off

### Month 6: Control Implementation

**Week 1-2: Technical Controls**

- [ ] Enable MFA on all internal systems (GitHub, AWS, Google Workspace, Slack)
- [ ] Configure branch protection rules on GitHub (require PR reviews, no force push)
- [ ] Set up Snyk for dependency scanning with CI/CD integration
- [ ] Configure container scanning with Trivy
- [ ] Set up SBOM generation with CycloneDX
- [ ] Verify encryption configuration (AES-256-GCM at rest, TLS 1.3 in transit)
- [ ] Document network architecture and security group rules
- [ ] Configure centralized logging with 1-year retention

**Week 3-4: Operational Controls**

- [ ] Conduct first security awareness training
- [ ] Complete initial risk assessment and populate risk register
- [ ] Perform first access review across all systems
- [ ] Set up PagerDuty/Opsgenie for incident alerting
- [ ] Test incident response procedures with tabletop exercise
- [ ] Document backup and recovery procedures (cross-ref: [database-recovery.md](../runbooks/database-recovery.md))
- [ ] Test backup restoration procedures

### Month 7: Readiness Assessment

**Week 1-2: Internal Audit**

- [ ] Conduct internal readiness assessment using Vanta's audit preparation tools
- [ ] Identify and remediate remaining gaps
- [ ] Collect all manual evidence (training records, meeting minutes, etc.)
- [ ] Verify all automated evidence collection is functioning

**Week 3-4: Pre-Audit Preparation**

- [ ] Select auditor (see Section 8)
- [ ] Schedule audit engagement
- [ ] Conduct mock audit with internal team
- [ ] Prepare management assertion letter
- [ ] Brief all team members on audit process and expectations

### Month 8: Audit Engagement

**Week 1-2: Auditor Fieldwork**

- [ ] Kick-off meeting with auditor
- [ ] Provide access to Vanta for evidence review
- [ ] Auditor interviews with key personnel (CTO, developers, operations)
- [ ] Respond to auditor inquiries within 24 hours

**Week 3-4: Report Generation**

- [ ] Review draft report for accuracy
- [ ] Address any findings or exceptions
- [ ] Receive final SOC 2 Type I report
- [ ] Publish report availability on Trust Center
- [ ] Celebrate and communicate to customers

---

## 8. Auditor Selection Criteria

### Top Auditor Firms for Startup SOC 2

| Firm                | Specialization               | Price Range | Best For                        |
| ------------------- | ---------------------------- | ----------- | ------------------------------- |
| Prescient Assurance | Startup-focused, fast        | $8K-$15K    | Speed and affordability         |
| Johanson Group      | SaaS companies               | $10K-$20K   | SaaS-specific expertise         |
| Schellman           | Technology companies         | $15K-$30K   | Larger scope, brand recognition |
| BARR Advisory       | Cloud-native companies       | $12K-$25K   | Cloud infrastructure expertise  |
| A-LIGN              | High volume, fast turnaround | $10K-$20K   | Fast turnaround                 |

### Selection Criteria

1. **Experience with SaaS/API companies**: Must understand multi-tenant architectures
2. **Familiarity with cloud-native infrastructure**: AWS/GCP, containers, serverless
3. **Turnaround time**: Target 4-6 weeks from engagement to final report
4. **Price transparency**: Fixed-fee engagement preferred over hourly
5. **Vanta integration**: Auditor should accept evidence directly from Vanta
6. **Communication style**: Responsive, collaborative, not adversarial
7. **References**: Request references from similar-sized SaaS companies

### RFP Process

- Request proposals from 3 firms minimum
- Evaluate on: price, timeline, experience, communication, references
- Schedule introductory calls with top 2 candidates
- Select and engage by Month 7, Week 3

---

## 9. SOC 2 Type II Roadmap (Month 12-18)

### Key Differences from Type I

| Aspect            | Type I                        | Type II                                  |
| ----------------- | ----------------------------- | ---------------------------------------- |
| Scope             | Point-in-time assessment      | 3-12 month observation period            |
| Evidence          | Controls designed effectively | Controls operating effectively over time |
| Value             | "We have controls"            | "Our controls work consistently"         |
| Enterprise impact | Opens the door                | Closes the deal                          |

### Type II Preparation (Month 9-11)

- [ ] Review Type I findings and address any noted exceptions
- [ ] Ensure continuous evidence collection in Vanta is functioning
- [ ] Maintain quarterly security reviews without gaps
- [ ] Conduct quarterly access reviews on schedule
- [ ] Keep vulnerability remediation SLAs (Critical: 24h, High: 7d, Medium: 30d)
- [ ] Maintain incident response log (even if no incidents — document that)

### Type II Observation Period (Month 12-14)

- 3-month minimum observation window (6 months preferred by some auditors)
- Auditor reviews controls at multiple points during the period
- Any control failures during observation must be documented and remediated
- Continuous monitoring via Vanta provides real-time compliance status

### Type II Audit (Month 15-18)

- Auditor reviews observation period evidence
- Final Type II report covers design effectiveness AND operating effectiveness
- Report is valid for 12 months; annual re-certification required
- Budget: $30K-$60K including auditor fees, continued Vanta, and remediation

---

## 10. Cross-References

- Security controls detail: [SECURITY_CONTROLS.md](./SECURITY_CONTROLS.md)
- GDPR and data privacy: [GDPR_IMPLEMENTATION.md](./GDPR_IMPLEMENTATION.md)
- Incident response procedures: [incident-response.md](../runbooks/incident-response.md)
- Database recovery (backup evidence): [database-recovery.md](../runbooks/database-recovery.md)
- Performance monitoring: [performance-tuning.md](../runbooks/performance-tuning.md)
- On-call procedures: [on-call-escalation.md](../runbooks/on-call-escalation.md)
