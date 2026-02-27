# Incident Response Runbook

> Incident response procedures for ContextInject covering severity classification, response workflows, communication templates, and post-incident review.

---

## 1. Severity Levels

| Severity | Name     | Definition                                                                        | Response Time     | Resolution Target | Escalation                     |
| -------- | -------- | --------------------------------------------------------------------------------- | ----------------- | ----------------- | ------------------------------ |
| **P1**   | Critical | Complete service outage, data breach, data loss                                   | 15 minutes        | 1 hour            | Immediate: all engineers + CTO |
| **P2**   | High     | Degraded service (>1% error rate), security vulnerability, single tenant impacted | 30 minutes        | 4 hours           | On-call + secondary            |
| **P3**   | Medium   | Performance degradation, non-critical feature failure, monitoring gap             | 2 hours           | 24 hours          | On-call only                   |
| **P4**   | Low      | Minor bugs, cosmetic issues, documentation errors                                 | Next business day | 1 week            | Ticket queue                   |

### Severity Decision Matrix

| Symptom                                                 | Severity |
| ------------------------------------------------------- | -------- |
| All API requests failing (5xx)                          | P1       |
| Query endpoint returning wrong results (data integrity) | P1       |
| Confirmed data breach or unauthorized access            | P1       |
| Database unresponsive                                   | P1       |
| Error rate >5% across all tenants                       | P1       |
| Error rate 1-5% or single tenant affected               | P2       |
| Latency p99 >2 seconds sustained                        | P2       |
| Security vulnerability discovered (exploitable)         | P2       |
| Worker queue growing without processing                 | P2       |
| Latency p99 500ms-2s sustained                          | P3       |
| Non-critical connector sync failing                     | P3       |
| Dashboard UI bug (API working)                          | P3       |
| Monitoring/alerting gap discovered                      | P3       |
| Typo in documentation                                   | P4       |
| Minor UI alignment issue                                | P4       |
| Feature enhancement request from incident               | P4       |

---

## 2. Incident Commander Role

The Incident Commander (IC) is the single point of coordination for all incidents P1-P2.

### Responsibilities

1. **Assess and classify** the incident severity
2. **Communicate** status updates to internal team and external stakeholders
3. **Coordinate** engineering response — assign investigation and remediation tasks
4. **Decide** on escalation, rollback, or emergency changes
5. **Document** timeline and decisions in the incident channel
6. **Initiate** post-incident review after resolution

### Who is IC?

- **P1**: Primary on-call engineer becomes IC. If unavailable within 5 minutes, secondary on-call takes over. CTO is always notified.
- **P2**: Primary on-call engineer is IC.
- **P3**: On-call engineer handles without formal IC role.

### IC Checklist

```
[ ] Acknowledge the incident in #incidents Slack channel
[ ] Classify severity (P1/P2/P3/P4)
[ ] Create incident tracking thread
[ ] Assign investigator(s)
[ ] Post first external status update (if P1/P2)
[ ] Coordinate remediation
[ ] Verify resolution
[ ] Post resolution update
[ ] Schedule post-incident review (within 48 hours for P1/P2)
```

---

## 3. Incident Response Workflow

### Phase 1: Detection (0-5 minutes)

**Automated Detection**:

- Prometheus alerts fire → PagerDuty/Opsgenie notification
- Error rate threshold crossed → on-call paged
- Latency threshold crossed → on-call paged
- Health check failure → on-call paged

**Manual Detection**:

- Customer reports issue via Discord, email, or support
- Team member notices anomaly during development
- Security scanner reports finding

**Immediate Actions**:

1. Acknowledge the page in PagerDuty/Opsgenie
2. Open `#incidents` Slack channel (or create incident-specific channel for P1)
3. Post: `INCIDENT: [brief description] | Severity: [P1/P2/P3] | IC: [your name]`

### Phase 2: Assessment (5-15 minutes)

**Triage Questions**:

1. What is the user-visible impact? (total outage, degraded, single feature)
2. How many tenants are affected? (all, some, one)
3. When did it start? (check dashboards for change point)
4. Was there a recent deployment? (check deployment history)
5. Are external services affected? (Cohere, Qdrant Cloud, AWS/GCP status)

**Quick Diagnostics**:

```bash
# Check API health
curl https://api.contextinject.ai/health

# Check recent deployments
gh run list --limit 5

# Check error rates (Prometheus)
# Query: rate(http_requests_total{status=~"5.."}[5m])

# Check Qdrant status
curl http://qdrant-host:6333/healthz

# Check Redis connectivity
redis-cli -h redis-host ping

# Check PostgreSQL connections
psql -c "SELECT count(*) FROM pg_stat_activity;"

# Check BullMQ queue depth
# Dashboard: http://bull-dashboard:3002
```

### Phase 3: Containment (15-30 minutes)

**Containment Strategies by Root Cause**:

| Root Cause                 | Containment Action                                  |
| -------------------------- | --------------------------------------------------- |
| Bad deployment             | Roll back to previous version (blue-green switch)   |
| Database issue             | Failover to read replica, scale connections         |
| Qdrant overload            | Enable aggressive caching, reduce topK              |
| Cohere API down            | Switch to BGE-M3 fallback                           |
| Redis failure              | Bypass cache layer (cache miss fallback)            |
| DDoS attack                | Increase CloudFlare protection level, block IPs     |
| Memory leak                | Restart affected containers, increase memory limits |
| Connection pool exhaustion | Restart API servers, increase pool size             |

### Phase 4: Remediation (30 min - 4 hours)

1. Identify root cause through logs, traces, and metrics
2. Develop and test fix in staging environment
3. Deploy fix to production (with IC approval)
4. Verify fix resolves the issue
5. Monitor for regression for 30 minutes

### Phase 5: Resolution

1. Confirm all systems are operating normally
2. Post resolution message in `#incidents`
3. Update status page to "resolved"
4. Notify affected customers (P1/P2)
5. Schedule post-incident review within 48 hours

---

## 4. Communication Templates

### Internal — Incident Start

```
@channel INCIDENT DECLARED

Severity: P1 / P2
Impact: [description of user-visible impact]
Start Time: [UTC timestamp]
Incident Commander: [name]
Status: Investigating

Current Actions:
- [action 1]
- [action 2]

Next Update: [time, typically 15-30 minutes]
```

### Internal — Status Update

```
INCIDENT UPDATE [#N]

Severity: P1 / P2
Status: Investigating / Identified / Mitigating / Resolved
Impact: [updated description]

What we know:
- [finding 1]
- [finding 2]

What we are doing:
- [action 1]
- [action 2]

Next Update: [time]
```

### Internal — Resolution

```
INCIDENT RESOLVED

Severity: P1 / P2
Duration: [start time] to [end time] ([total duration])
Impact: [final impact summary]
Root Cause: [brief description]
Resolution: [what was done to fix it]

Post-Incident Review: Scheduled for [date/time]
```

### Customer-Facing — Incident Notification

```
Subject: [ContextInject] Service Incident — [brief description]

We are currently experiencing [description of impact]. Our team is actively
investigating and working to resolve the issue.

What is affected:
- [specific impact to customers]

What we are doing:
- [actions being taken]

We will provide updates every [30 minutes / 1 hour] until this is resolved.

Current status: https://status.contextinject.ai

We apologize for the inconvenience.
— The ContextInject Team
```

### Customer-Facing — Resolution

```
Subject: [ContextInject] Service Incident Resolved

The service incident reported at [time] has been resolved as of [time].

What happened:
- [brief, non-technical description]

Impact:
- [duration and scope]

What we did:
- [resolution actions]

What we are doing to prevent recurrence:
- [follow-up actions]

We apologize for any disruption to your service. If you have any questions,
please contact support@contextinject.ai.
— The ContextInject Team
```

---

## 5. Escalation Matrix

```
Alert fires
  |
  v
Primary On-Call (15 min to acknowledge)
  |
  +--> If no ack in 15 min --> Secondary On-Call
  |                                |
  |                                +--> If no ack in 15 min --> Engineering Lead
  |                                                                |
  |                                                                +--> CTO
  v
P1: Immediately notify CTO + all available engineers
P2: Primary on-call handles, notify secondary
P3: Primary on-call handles alone
P4: Ticket queue, next business day
```

### Contact Chain

| Role              | Primary Contact        | Backup Contact          |
| ----------------- | ---------------------- | ----------------------- |
| Primary On-Call   | PagerDuty notification | Phone call after 10 min |
| Secondary On-Call | PagerDuty notification | Phone call after 10 min |
| Engineering Lead  | Slack + PagerDuty      | Phone call after 15 min |
| CTO               | Slack + Phone          | Email if unreachable    |

---

## 6. Post-Incident Review (Blameless Post-Mortem)

### Template

```markdown
# Post-Incident Review: [Incident Title]

**Date of Incident**: [date]
**Duration**: [start] to [end] ([total])
**Severity**: P[1-4]
**Incident Commander**: [name]
**Author**: [name]
**Review Date**: [date]

## Summary

[2-3 sentence summary of what happened and its impact]

## Timeline (UTC)

| Time  | Event                                  |
| ----- | -------------------------------------- |
| HH:MM | [First symptom detected / alert fired] |
| HH:MM | [On-call acknowledged]                 |
| HH:MM | [Root cause identified]                |
| HH:MM | [Mitigation applied]                   |
| HH:MM | [Full resolution confirmed]            |

## Root Cause

[Detailed technical explanation of what caused the incident]

## Impact

- Users affected: [number or percentage]
- Duration of impact: [time]
- Revenue impact: [if applicable]
- SLA impact: [if applicable]
- Data impact: [any data loss or corruption]

## What Went Well

- [Thing that worked as designed]
- [Quick detection or response]
- [Effective communication]

## What Could Be Improved

- [Detection gap]
- [Response delay]
- [Communication gap]
- [Missing runbook or procedure]

## Action Items

| Action                                  | Owner  | Priority | Due Date |
| --------------------------------------- | ------ | -------- | -------- |
| [Specific action to prevent recurrence] | [name] | [P1-P4]  | [date]   |
| [Monitoring improvement]                | [name] | [P1-P4]  | [date]   |
| [Runbook update]                        | [name] | [P1-P4]  | [date]   |

## Lessons Learned

[Key takeaways for the team]
```

### Post-Mortem Rules

1. **Blameless**: Focus on systems and processes, not individuals
2. **Timely**: Conduct within 48 hours for P1/P2, 1 week for P3
3. **Actionable**: Every post-mortem must produce at least 1 action item
4. **Shared**: Published internally to entire team
5. **Tracked**: Action items tracked to completion in issue tracker

---

## 7. Status Page Management

### Status Page Components

| Component           | Description                                      |
| ------------------- | ------------------------------------------------ |
| API                 | Core REST API (api.contextinject.ai)             |
| Dashboard           | Web dashboard (app.contextinject.ai)             |
| Document Processing | Ingestion pipeline (upload, parse, chunk, embed) |
| Query Engine        | Retrieval pipeline (search, rerank, assemble)    |
| Connectors          | Data source sync (Notion, Google Drive)          |
| MCP Server          | Agent integration endpoint                       |

### Status Levels

| Status               | Meaning                               | When to Use                         |
| -------------------- | ------------------------------------- | ----------------------------------- |
| Operational          | All systems normal                    | Default state                       |
| Degraded Performance | Slower than normal, increased latency | p99 >1s for >5 min                  |
| Partial Outage       | Some features or tenants affected     | Single component or subset impacted |
| Major Outage         | Core service unavailable              | API returning 5xx for all users     |
| Under Maintenance    | Planned downtime                      | Scheduled maintenance window        |

### Update Frequency

| Severity    | Update Frequency                                        |
| ----------- | ------------------------------------------------------- |
| P1          | Every 15 minutes until mitigated, then every 30 minutes |
| P2          | Every 30 minutes until mitigated, then every hour       |
| P3          | Initial update, then on resolution                      |
| Maintenance | 48 hours before, start, and end                         |

---

## 8. Rollback Procedures

### Application Rollback (Blue-Green)

```bash
# Current deployment is "blue", rollback to "green" (previous version)

# 1. Verify green deployment is healthy
curl https://green.internal.contextinject.ai/health

# 2. Switch load balancer to green
# (implementation depends on deployment platform)

# Railway:
# Revert to previous deployment in Railway dashboard

# Fly.io:
fly deploy --image registry.fly.io/contextinject-api:<previous-tag>

# AWS ECS:
aws ecs update-service --cluster ci-prod \
  --service ci-api \
  --task-definition ci-api:<previous-revision>

# 3. Verify green is serving traffic correctly
curl https://api.contextinject.ai/health

# 4. Monitor for 15 minutes
```

### Database Rollback (Drizzle Kit)

```bash
# Generate down migration
pnpm drizzle-kit generate --name rollback_<migration_name>

# Apply down migration
pnpm db:migrate

# WARNING: Data migrations may not be fully reversible
# Always test rollback in staging first
```

### Feature Flag Rollback

```typescript
// Disable a feature via environment variable
// FEATURE_RERANKING_ENABLED=false
// FEATURE_COMPRESSION_ENABLED=false
// FEATURE_SEMANTIC_CACHE_ENABLED=false

// Application checks feature flags at runtime
if (process.env.FEATURE_RERANKING_ENABLED !== "false") {
  // Use reranking
}
```

---

## 9. Data Breach Response Plan

### GDPR 72-Hour Notification Requirement

See [GDPR_IMPLEMENTATION.md](../compliance/GDPR_IMPLEMENTATION.md) Section 10 for the complete breach notification process.

**Summary**:

1. **Hour 0-1**: Detect, contain, assess scope
2. **Hour 1-4**: Impact assessment (what data, which tenants, how many data subjects)
3. **Hour 4-24**: Prepare notifications (supervisory authority, controllers)
4. **Hour 24-48**: Notify affected controllers (our customers)
5. **Hour 48-72**: Notify supervisory authority (if required)
6. **Post-72 hours**: Continue remediation, post-mortem, supplementary notifications

### Breach Classification

| Type                   | Example                             | Notify Authority?      | Notify Customers? |
| ---------------------- | ----------------------------------- | ---------------------- | ----------------- |
| Confidentiality breach | Unauthorized access to data         | Yes (if personal data) | Yes               |
| Integrity breach       | Data modified without authorization | Yes (if personal data) | Yes               |
| Availability breach    | Data unavailable (temporary)        | Case-by-case           | Yes (inform)      |

---

## 10. Cross-References

- On-call escalation: [on-call-escalation.md](./on-call-escalation.md)
- Database recovery: [database-recovery.md](./database-recovery.md)
- Performance tuning: [performance-tuning.md](./performance-tuning.md)
- GDPR breach notification: [GDPR_IMPLEMENTATION.md](../compliance/GDPR_IMPLEMENTATION.md)
- Security controls: [SECURITY_CONTROLS.md](../compliance/SECURITY_CONTROLS.md)
- SOC 2 requirements: [SOC2_ROADMAP.md](../compliance/SOC2_ROADMAP.md)
