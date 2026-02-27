# On-Call and Escalation Procedures

> On-call rotation, response expectations, alert triage, communication channels, and handoff procedures for ContextInject operations.

---

## 1. On-Call Rotation

### Schedule

| Role              | Rotation                                    | Duration | Backup            |
| ----------------- | ------------------------------------------- | -------- | ----------------- |
| Primary On-Call   | Weekly (Monday 9 AM UTC to Monday 9 AM UTC) | 7 days   | Secondary On-Call |
| Secondary On-Call | Weekly (offset by 1 week)                   | 7 days   | Engineering Lead  |

**Initial Team Rotation** (2 engineers):

| Week     | Primary    | Secondary  |
| -------- | ---------- | ---------- |
| 1        | Engineer A | Engineer B |
| 2        | Engineer B | Engineer A |
| 3        | Engineer A | Engineer B |
| (repeat) |            |            |

**As team grows** (4+ engineers): Expand to 2-week rotation with 4 engineers in the pool.

### On-Call Expectations

| Expectation        | Detail                                                          |
| ------------------ | --------------------------------------------------------------- |
| Availability       | Reachable within 15 minutes at all times during rotation        |
| Equipment          | Laptop with VPN access, charged phone, PagerDuty app installed  |
| Location           | Anywhere with internet access and ability to respond            |
| Response time (P1) | 15 minutes to acknowledge page                                  |
| Response time (P2) | 30 minutes to acknowledge page                                  |
| Response time (P3) | 2 hours during business hours                                   |
| Compensation       | Time-off in lieu (1 day per week of on-call) or on-call stipend |
| Handoff            | Formal handoff at rotation boundary (see Section 7)             |

### On-Call Swap Process

1. Find a willing swap partner
2. Update PagerDuty schedule (both parties)
3. Notify `#engineering` Slack channel
4. Both parties confirm in PagerDuty

---

## 2. Response Time Expectations

| Severity      | Acknowledge       | Begin Investigation | First Status Update | Resolution Target |
| ------------- | ----------------- | ------------------- | ------------------- | ----------------- |
| P1 (Critical) | 15 min            | 15 min              | 30 min              | 1 hour            |
| P2 (High)     | 30 min            | 30 min              | 1 hour              | 4 hours           |
| P3 (Medium)   | 2 hours           | 2 hours             | 4 hours             | 24 hours          |
| P4 (Low)      | Next business day | Next business day   | N/A                 | 1 week            |

**Outside Business Hours** (nights, weekends):

- P1: Same response times (15 min) — wake up if needed
- P2: Same response times (30 min) — wake up if needed
- P3: Next business morning
- P4: Next business day

---

## 3. Contact Chain

### Escalation Path

```
Alert fires (PagerDuty/Opsgenie)
  |
  v
Primary On-Call (15 min to acknowledge)
  |
  +--> No ack in 15 min
  |     |
  |     v
  |   Secondary On-Call (15 min to acknowledge)
  |     |
  |     +--> No ack in 15 min
  |           |
  |           v
  |         Engineering Lead (15 min to acknowledge)
  |           |
  |           +--> No ack in 15 min
  |                 |
  |                 v
  |               CTO (phone call)
  v
P1 ONLY: Auto-notify CTO + all engineers immediately
```

### Contact Information

| Role              | Name      | PagerDuty         | Phone     | Slack     |
| ----------------- | --------- | ----------------- | --------- | --------- |
| Primary On-Call   | (rotates) | @oncall-primary   | (rotates) | @oncall   |
| Secondary On-Call | (rotates) | @oncall-secondary | (rotates) | @oncall   |
| Engineering Lead  | [Name]    | @eng-lead         | [Number]  | @eng-lead |
| CTO               | [Name]    | @cto              | [Number]  | @cto      |

### PagerDuty/Opsgenie Configuration

```yaml
# PagerDuty escalation policy
escalation_policy:
  name: "ContextInject Production"
  rules:
    - targets:
        - type: schedule
          id: primary-oncall-schedule
      escalation_delay_in_minutes: 15
    - targets:
        - type: schedule
          id: secondary-oncall-schedule
      escalation_delay_in_minutes: 15
    - targets:
        - type: user
          id: engineering-lead
      escalation_delay_in_minutes: 15
    - targets:
        - type: user
          id: cto
      escalation_delay_in_minutes: 0 # Final escalation, no delay
  repeat_enabled: true
  num_loops: 2
```

---

## 4. Common Alert Triage

### High Error Rate

**Alert**: `http_error_rate > 1% for 5 minutes`

```
Step 1: Check if a deployment just happened
  - gh run list --limit 5
  - If yes: Consider rollback (see incident-response.md)

Step 2: Check external service status
  - Cohere: https://status.cohere.com
  - Qdrant Cloud: https://status.qdrant.io
  - AWS: https://health.aws.amazon.com
  - If external service is down: Enable fallback, update status page

Step 3: Check error logs for patterns
  - Grafana -> Explore -> Loki -> {app="ci-api"} |= "error"
  - Look for: connection refused, timeout, OOM, unhandled promise rejection

Step 4: Check resource utilization
  - CPU, memory, disk, network on all containers
  - PostgreSQL connections: SELECT count(*) FROM pg_stat_activity;
  - Redis memory: redis-cli info memory

Step 5: If no clear cause found
  - Increase logging verbosity temporarily
  - Capture request/response pairs for failing requests
  - Escalate if not resolved within 30 minutes
```

### High Latency

**Alert**: `http_request_duration_p99 > 2s for 5 minutes`

```
Step 1: Identify which pipeline stage is slow
  - Check Grafana dashboard "Pipeline Latency Breakdown"
  - Typical bottleneck order: Qdrant search > Cohere rerank > Cohere embed

Step 2: If Qdrant is slow
  - Check Qdrant collection status: GET /collections/{name}
  - Check if optimization is running (normal during heavy ingestion)
  - Check disk I/O: iostat -x 1 5
  - Temporary fix: Reduce topK, enable more aggressive caching

Step 3: If Cohere API is slow
  - Check Cohere status page
  - Check if we are hitting rate limits (429 responses)
  - Temporary fix: Enable BGE-M3 fallback for embedding
  - Temporary fix: Disable reranking (return vector-only results)

Step 4: If PostgreSQL is slow
  - Check slow query log
  - Check connection count: SELECT count(*) FROM pg_stat_activity;
  - Check for lock contention: SELECT * FROM pg_locks WHERE NOT granted;
  - Check for missing indexes: EXPLAIN ANALYZE on slow queries

Step 5: If Redis is slow
  - Check latency: redis-cli --latency
  - Check memory: redis-cli info memory
  - Check for slow commands: redis-cli slowlog get 10
```

### Queue Depth Growing

**Alert**: `bullmq_waiting_count > 500 for 10 minutes`

```
Step 1: Check worker health
  - Is the worker process running?
  - Check worker logs for errors
  - Check worker CPU/memory utilization

Step 2: Check for blocked workers
  - BullMQ dashboard: http://bull-dashboard:3002
  - Look for stuck "active" jobs (running too long)
  - If jobs are stuck: Check Cohere API status (embedding timeout)

Step 3: Scale workers
  - Increase worker concurrency: WORKER_CONCURRENCY=10
  - Or start additional worker instances
  - Note: Respect Cohere API rate limits (100 req/min standard)

Step 4: If queue is unrecoverable
  - Drain failed jobs: redis-cli DEL bull:ingest-document:failed
  - Re-queue documents: UPDATE documents SET status='pending' WHERE status='processing'
```

### Disk Space Alert

**Alert**: `disk_usage_percent > 80%`

```
Step 1: Identify what is consuming space
  - du -sh /var/lib/postgresql/  (PostgreSQL data)
  - du -sh /qdrant/storage/      (Qdrant vectors)
  - du -sh /var/log/              (Application logs)
  - du -sh /tmp/                  (Temporary files from uploads)

Step 2: Quick cleanup
  - Rotate logs: logrotate -f /etc/logrotate.d/*
  - Clean temp files: find /tmp -name "ci_upload_*" -mtime +1 -delete
  - Vacuum PostgreSQL: VACUUM FULL; (caution: locks tables)
  - Clean old Qdrant snapshots: Remove snapshots older than 7 days

Step 3: If PostgreSQL is the issue
  - Check for bloated tables: SELECT pg_size_pretty(pg_total_relation_size('chunks'));
  - Run VACUUM ANALYZE on large tables
  - Consider table partitioning for query_logs and usage_events

Step 4: If Qdrant is the issue
  - Check collection sizes
  - Consider enabling quantization (reduces storage 8-32x)
  - Remove unused collections from deleted tenants

Step 5: Long-term fix
  - Increase disk allocation
  - Implement automated cleanup jobs (data retention)
  - Set up disk usage alerting at 70% for early warning
```

### Certificate Expiration

**Alert**: `tls_cert_expiry_days < 14`

```
Step 1: Check which certificate is expiring
  - echo | openssl s_client -connect api.contextinject.ai:443 2>/dev/null | openssl x509 -noout -dates

Step 2: If Let's Encrypt (auto-renewal should handle this)
  - Check certbot logs: journalctl -u certbot
  - Check renewal config: certbot renew --dry-run
  - If renewal is failing: Check DNS, firewall, certbot configuration
  - Manual renewal: certbot renew --force-renewal

Step 3: If CloudFlare-managed certificate
  - Check CloudFlare dashboard SSL/TLS settings
  - CloudFlare handles renewal automatically
  - If issue: Contact CloudFlare support

Step 4: If internal/mTLS certificate
  - Generate new certificate from internal CA
  - Deploy to affected services
  - Restart services to pick up new certificate
  - Verify: openssl s_client -connect service:port
```

---

## 5. Communication Channels

| Channel              | Purpose                                    | Who                        |
| -------------------- | ------------------------------------------ | -------------------------- |
| PagerDuty/Opsgenie   | Alert notification and acknowledgment      | On-call engineers          |
| Slack `#incidents`   | Real-time incident coordination            | All engineers during P1/P2 |
| Slack `#engineering` | General engineering communication          | Engineering team           |
| Slack `#monitoring`  | Automated alert notifications (non-paging) | Engineering team           |
| Status page          | External customer communication            | IC (Incident Commander)    |
| Email (support@)     | Customer support inquiries                 | Support rotation           |
| Discord `#status`    | Community notification channel             | Community manager          |

### Slack Channel Rules

**#incidents**:

- Only active incident discussion
- Use threads for investigation details
- IC posts top-level status updates
- No casual conversation during active incidents

**#monitoring**:

- Automated alerts from Prometheus/Grafana
- Alert acknowledgment reactions (checkmark emoji = acknowledged)
- Brief investigation notes for non-paging alerts
- Mute if too noisy (indicate in channel)

---

## 6. Customer Communication Templates

### Proactive Notification (Before Customer Reports)

```
Subject: [ContextInject] Investigating Increased Latency

We are aware of increased API response times affecting some requests.
Our team is investigating and will provide an update within 30 minutes.

Current impact: Query API response times are approximately 2x normal.
Document uploads and processing are unaffected.

Status: https://status.contextinject.ai
```

### During Incident (Customer Inquiry)

```
Subject: Re: [Support] API returning errors

Hi [Name],

Thank you for reporting this. We are aware of the issue and our team is
actively working on a resolution.

What we know:
- [Brief description of the issue]
- Estimated time to resolution: [estimate]

We will notify you when the issue is resolved. You can also follow real-time
updates at https://status.contextinject.ai.

Apologies for the disruption.
Best,
[Name]
```

### Post-Incident Summary (To Affected Customers)

```
Subject: [ContextInject] Incident Resolved — Summary

Hi [Name],

The issue affecting [description] has been resolved as of [time UTC].

Summary:
- Duration: [start] to [end] ([total duration])
- Impact: [what was affected]
- Root cause: [brief, non-technical explanation]
- Resolution: [what was done]

Preventive measures:
- [Action 1]
- [Action 2]

We apologize for the disruption. If you experienced any data issues during
this period, please contact us at support@contextinject.ai.

Best,
[Name]
```

---

## 7. Handoff Procedures

### Weekly Handoff (Monday 9 AM UTC)

The outgoing on-call engineer hands off to the incoming on-call engineer.

#### Handoff Checklist

```
[ ] Review active incidents (if any)
[ ] Review outstanding alerts and their status
[ ] Highlight any infrastructure changes made during the week
[ ] Note any known issues or degradations
[ ] Share any pending maintenance windows
[ ] Confirm incoming on-call has:
    [ ] PagerDuty app installed and notifications working
    [ ] VPN access verified
    [ ] SSH access to production verified
    [ ] Access to monitoring dashboards
    [ ] Copy of this runbook accessible offline
[ ] Update PagerDuty schedule if not auto-rotated
[ ] Post handoff summary in #engineering Slack channel
```

#### Handoff Message Template

```
On-Call Handoff: [Outgoing Name] -> [Incoming Name]
Week of: [Date]

Active Issues:
- [Issue 1]: [Status, next steps]
- [Issue 2]: [Status, next steps]
- None

Recent Incidents:
- [Incident]: [Brief summary, any follow-up needed]
- None this week

Infrastructure Changes:
- [Change]: [Brief description]
- None

Upcoming Maintenance:
- [Date]: [Description]
- None scheduled

Things to Watch:
- [Any known flaky tests, degraded services, capacity concerns]
- All clear

@[Incoming Name] — you are now on-call. Questions?
```

### Emergency Handoff

If the on-call engineer becomes unavailable mid-rotation:

1. On-call engineer posts in `#engineering`: "I need to hand off on-call. [Reason]"
2. Secondary on-call assumes primary responsibility
3. Another engineer volunteers for secondary
4. Update PagerDuty schedule immediately
5. Brief the new primary on any active issues

---

## 8. On-Call Toolkit

### Quick Access Links

| Resource                   | URL / Command                                             |
| -------------------------- | --------------------------------------------------------- |
| API Health                 | `curl https://api.contextinject.ai/health`                |
| Grafana Dashboards         | `https://grafana.internal.contextinject.ai`               |
| PagerDuty                  | `https://contextinject.pagerduty.com`                     |
| BullMQ Dashboard           | `https://bull.internal.contextinject.ai`                  |
| Qdrant Dashboard           | `https://qdrant.internal.contextinject.ai/dashboard`      |
| Status Page Admin          | `https://admin.status.contextinject.ai`                   |
| GitHub Actions             | `https://github.com/contextinject/context-inject/actions` |
| AWS Console                | `https://console.aws.amazon.com`                          |
| Cohere Status              | `https://status.cohere.com`                               |
| Incident Response Runbook  | [incident-response.md](./incident-response.md)            |
| Database Recovery Runbook  | [database-recovery.md](./database-recovery.md)            |
| Performance Tuning Runbook | [performance-tuning.md](./performance-tuning.md)          |

### Quick Diagnostic Commands

```bash
# Check all services health
curl -s https://api.contextinject.ai/health | jq

# Check recent deployments
gh run list --repo contextinject/context-inject --limit 5

# Check PostgreSQL connections
psql -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"

# Check Redis
redis-cli info clients
redis-cli info memory

# Check Qdrant
curl -s http://qdrant:6333/healthz
curl -s http://qdrant:6333/collections | jq '.result.collections | length'

# Check BullMQ queue depth
redis-cli llen bull:ingest-document:wait

# Check recent API errors (last 100 lines)
# (via log aggregation tool — Grafana Loki, CloudWatch, etc.)

# Quick load check
curl -w "\nDNS: %{time_namelookup}s\nConnect: %{time_connect}s\nTTFB: %{time_starttransfer}s\nTotal: %{time_total}s\n" \
  -s -o /dev/null https://api.contextinject.ai/health
```

### On-Call Survival Kit

- Keep this runbook bookmarked on your phone
- Ensure PagerDuty mobile app notifications are enabled (sound ON, Do Not Disturb exception)
- Have a reliable internet connection at all times during rotation
- Keep laptop charged and accessible
- If traveling: notify the team and ensure secondary coverage

---

## 9. Cross-References

- Incident response: [incident-response.md](./incident-response.md)
- Database recovery: [database-recovery.md](./database-recovery.md)
- Performance tuning: [performance-tuning.md](./performance-tuning.md)
- Security controls: [SECURITY_CONTROLS.md](../compliance/SECURITY_CONTROLS.md)
- SOC 2 operational requirements: [SOC2_ROADMAP.md](../compliance/SOC2_ROADMAP.md)
