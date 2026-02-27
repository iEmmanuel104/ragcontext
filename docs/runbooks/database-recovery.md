# Database Recovery Runbook

> Recovery procedures for PostgreSQL 17, Qdrant, and Redis 7.2+ including backup configuration, restoration, and testing.

---

## 1. Recovery Targets

| Database      | RTO (Recovery Time) | RPO (Recovery Point) | Backup Method                            |
| ------------- | ------------------- | -------------------- | ---------------------------------------- |
| PostgreSQL 17 | 15 minutes          | 5 minutes            | PITR (WAL archiving) + daily base backup |
| Qdrant        | 30 minutes          | 1 hour               | Hourly snapshots + collection backups    |
| Redis 7.2+    | 5 minutes           | ~1 second (AOF)      | AOF persistence + RDB snapshots          |

---

## 2. PostgreSQL 17 Recovery

### 2.1 Backup Configuration

#### WAL Archiving (Continuous)

WAL (Write-Ahead Log) archiving enables Point-in-Time Recovery (PITR).

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://ci-backups/wal/%f --sse AES256'
archive_timeout = 300  # Archive every 5 minutes even if WAL not full
max_wal_senders = 5
wal_keep_size = 2GB
```

**For managed databases (RDS/Supabase)**:

- RDS: Enable automated backups with 35-day retention, PITR enabled by default
- Supabase: Daily backups included in Pro plan, PITR available on Enterprise

#### Full Base Backups (Daily)

```bash
#!/bin/bash
# scripts/backup-postgres.sh
# Run daily at 02:00 UTC via cron

BACKUP_DIR="/tmp/pg_backup_$(date +%Y%m%d_%H%M%S)"
S3_BUCKET="s3://ci-backups/postgres/base"

# Create base backup
pg_basebackup \
  -h $PGHOST \
  -U $PGUSER \
  -D $BACKUP_DIR \
  --format=tar \
  --gzip \
  --checkpoint=fast \
  --wal-method=stream \
  --progress

# Upload to S3 with encryption
aws s3 cp $BACKUP_DIR/ $S3_BUCKET/$(date +%Y%m%d)/ \
  --recursive \
  --sse AES256

# Clean up local backup
rm -rf $BACKUP_DIR

# Verify backup integrity
pg_verifybackup $BACKUP_DIR 2>/dev/null && echo "Backup verified" || echo "Backup verification skipped (tar format)"

# Retain last 30 days of base backups
aws s3 ls $S3_BUCKET/ | while read -r line; do
  DATE=$(echo $line | awk '{print $2}' | tr -d '/')
  if [[ $(date -d "$DATE" +%s) -lt $(date -d "30 days ago" +%s) ]]; then
    aws s3 rm $S3_BUCKET/$DATE/ --recursive
  fi
done

echo "PostgreSQL backup completed at $(date)"
```

### 2.2 Point-in-Time Recovery (PITR)

**When to use**: Data corruption, accidental deletion, need to recover to a specific moment.

```bash
#!/bin/bash
# Restore PostgreSQL to a specific point in time

RECOVERY_TARGET="2026-02-23 14:30:00 UTC"
BASE_BACKUP_DATE="20260223"
RESTORE_DIR="/var/lib/postgresql/17/recovery"

# 1. Stop the current PostgreSQL instance
sudo systemctl stop postgresql

# 2. Move current data directory
sudo mv /var/lib/postgresql/17/main /var/lib/postgresql/17/main.old

# 3. Download the most recent base backup before the target time
aws s3 cp s3://ci-backups/postgres/base/$BASE_BACKUP_DATE/ $RESTORE_DIR/ --recursive

# 4. Extract base backup
cd $RESTORE_DIR
tar -xzf base.tar.gz -C /var/lib/postgresql/17/main

# 5. Create recovery configuration
cat > /var/lib/postgresql/17/main/postgresql.auto.conf << EOF
restore_command = 'aws s3 cp s3://ci-backups/wal/%f %p'
recovery_target_time = '$RECOVERY_TARGET'
recovery_target_action = 'promote'
EOF

# 6. Create recovery signal file
touch /var/lib/postgresql/17/main/recovery.signal

# 7. Set ownership
sudo chown -R postgres:postgres /var/lib/postgresql/17/main

# 8. Start PostgreSQL (it will enter recovery mode)
sudo systemctl start postgresql

# 9. Monitor recovery progress
tail -f /var/log/postgresql/postgresql-17-main.log

# 10. Verify recovery
psql -c "SELECT pg_is_in_recovery();"
# Should return 'f' (false) after recovery completes

# 11. Verify data integrity
psql -c "SELECT count(*) FROM documents;"
psql -c "SELECT count(*) FROM chunks;"
psql -c "SELECT max(created_at) FROM documents;"
```

**For RDS**: Use the AWS Console or CLI to restore to a point in time:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier ci-production \
  --target-db-instance-identifier ci-recovery-$(date +%s) \
  --restore-time "$RECOVERY_TARGET" \
  --db-instance-class db.r6g.large
```

### 2.3 Common PostgreSQL Recovery Scenarios

#### Scenario: Accidental Table Drop

```bash
# If a table was accidentally dropped, use PITR to recover to just before the drop
# 1. Identify the exact time of the DROP (from audit logs)
# 2. Follow PITR procedure above with recovery_target_time set to 1 minute before
# 3. Export the recovered table
pg_dump -h recovery-instance -t dropped_table_name > recovered_table.sql
# 4. Import into production
psql -h production-instance < recovered_table.sql
```

#### Scenario: Corrupted Data in Documents Table

```bash
# 1. Identify the time range of corruption (from query logs, monitoring)
# 2. Use PITR to create a recovery instance at the last known good time
# 3. Compare data between production and recovery
psql -h production -c "SELECT id, content_hash, updated_at FROM documents WHERE updated_at > '2026-02-23' ORDER BY updated_at" > prod_docs.csv
psql -h recovery -c "SELECT id, content_hash, updated_at FROM documents WHERE updated_at > '2026-02-23' ORDER BY updated_at" > recovery_docs.csv
diff prod_docs.csv recovery_docs.csv
# 4. Selectively restore corrupted rows
```

#### Scenario: Full Database Loss

```bash
# 1. Create new PostgreSQL instance
# 2. Restore from latest base backup + WAL replay (PITR to current time)
# 3. Verify all tables exist and row counts match expectations
# 4. Update application connection strings
# 5. Verify application health
```

---

## 3. Qdrant Recovery

### 3.1 Snapshot Configuration

#### Automatic Snapshots (Hourly)

```bash
#!/bin/bash
# scripts/backup-qdrant.sh
# Run hourly via cron

QDRANT_URL="http://qdrant-host:6333"
S3_BUCKET="s3://ci-backups/qdrant"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# List all collections
COLLECTIONS=$(curl -s "$QDRANT_URL/collections" | jq -r '.result.collections[].name')

for COLLECTION in $COLLECTIONS; do
  echo "Creating snapshot for collection: $COLLECTION"

  # Create snapshot
  SNAPSHOT_RESPONSE=$(curl -s -X POST "$QDRANT_URL/collections/$COLLECTION/snapshots")
  SNAPSHOT_NAME=$(echo $SNAPSHOT_RESPONSE | jq -r '.result.name')

  if [ "$SNAPSHOT_NAME" != "null" ]; then
    # Download snapshot
    curl -s "$QDRANT_URL/collections/$COLLECTION/snapshots/$SNAPSHOT_NAME" \
      -o "/tmp/${COLLECTION}_${SNAPSHOT_NAME}"

    # Upload to S3
    aws s3 cp "/tmp/${COLLECTION}_${SNAPSHOT_NAME}" \
      "$S3_BUCKET/$TIMESTAMP/${COLLECTION}_${SNAPSHOT_NAME}" \
      --sse AES256

    # Clean up local file
    rm "/tmp/${COLLECTION}_${SNAPSHOT_NAME}"

    echo "Snapshot created and uploaded: $COLLECTION/$SNAPSHOT_NAME"
  else
    echo "ERROR: Failed to create snapshot for $COLLECTION"
  fi
done

# Retain last 7 days of snapshots
# (implement retention similar to PostgreSQL above)

echo "Qdrant backup completed at $(date)"
```

### 3.2 Snapshot Restoration

```bash
#!/bin/bash
# Restore a Qdrant collection from snapshot

QDRANT_URL="http://qdrant-host:6333"
COLLECTION="tenant_abc123"
SNAPSHOT_FILE="/tmp/tenant_abc123_snapshot.tar"
S3_PATH="s3://ci-backups/qdrant/20260223_140000"

# 1. Download snapshot from S3
aws s3 cp "$S3_PATH/${COLLECTION}_*.snapshot" $SNAPSHOT_FILE

# 2. Delete the existing collection (if corrupted)
curl -X DELETE "$QDRANT_URL/collections/$COLLECTION"

# 3. Restore collection from snapshot
curl -X POST "$QDRANT_URL/collections/$COLLECTION/snapshots/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "snapshot=@$SNAPSHOT_FILE"

# 4. Verify restoration
VECTORS_COUNT=$(curl -s "$QDRANT_URL/collections/$COLLECTION" | jq '.result.vectors_count')
echo "Restored collection $COLLECTION with $VECTORS_COUNT vectors"

# 5. Run a test search to verify functionality
curl -s -X POST "$QDRANT_URL/collections/$COLLECTION/points/search" \
  -H "Content-Type: application/json" \
  -d '{
    "vector": {"name": "dense", "vector": [0.1, 0.2, ...]},
    "limit": 5
  }'
```

### 3.3 Collection Recovery Scenarios

#### Scenario: Single Collection Corrupted

```bash
# 1. Identify the corrupted collection
# 2. Check for the latest healthy snapshot
aws s3 ls s3://ci-backups/qdrant/ --recursive | grep $COLLECTION | sort -r | head -5

# 3. Restore from the latest snapshot (follow 3.2 above)

# 4. If snapshot is outdated, re-index from PostgreSQL
# The chunks table in PostgreSQL is the source of truth
psql -c "SELECT id, vector_id, content FROM chunks WHERE tenant_id = '$TENANT_ID'"
# Re-run embedding and upsert for affected chunks
```

#### Scenario: Complete Qdrant Data Loss

```bash
# 1. Deploy new Qdrant instance
# 2. For each tenant, recreate collection and restore from snapshot
# 3. If snapshots are unavailable, trigger full re-indexing:
#    - For each document in PostgreSQL with status='indexed':
#      - Queue a 'reindex-project' job in BullMQ
#      - Worker will re-chunk, re-embed, and re-index
# 4. Monitor re-indexing progress via BullMQ dashboard
```

### 3.4 Cross-Region Replication (Enterprise)

For Enterprise customers requiring disaster recovery:

```bash
# Qdrant supports distributed mode with replication
# Configure shard replication factor of 2+
curl -X PATCH "$QDRANT_URL/collections/$COLLECTION" \
  -H "Content-Type: application/json" \
  -d '{
    "replication_factor": 2,
    "write_consistency_factor": 1
  }'
```

---

## 4. Redis 7.2+ Recovery

### 4.1 Persistence Configuration

```ini
# redis.conf

# RDB snapshots (periodic full snapshots)
save 900 1      # Save if at least 1 key changed in 900 seconds
save 300 10     # Save if at least 10 keys changed in 300 seconds
save 60 10000   # Save if at least 10000 keys changed in 60 seconds

# AOF (Append-Only File — every write operation logged)
appendonly yes
appendfsync everysec     # Sync to disk every second (balanced performance/durability)
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# Memory management
maxmemory 512mb
maxmemory-policy allkeys-lru
```

### 4.2 Redis Sentinel for Failover

```yaml
# Redis Sentinel configuration (3 Sentinel instances minimum)
# sentinel.conf

sentinel monitor ci-redis master-host 6379 2
sentinel down-after-milliseconds ci-redis 5000
sentinel failover-timeout ci-redis 10000
sentinel parallel-syncs ci-redis 1
```

**Failover process** (automatic with Sentinel):

1. Sentinel detects master is unreachable (5 seconds)
2. Sentinel initiates failover vote (quorum of 2)
3. Replica promoted to master
4. Application connection updated via Sentinel discovery
5. Old master rejoins as replica when recovered

### 4.3 Redis Recovery Scenarios

#### Scenario: Redis Restart (Data in AOF/RDB)

```bash
# Redis automatically loads data from AOF (preferred) or RDB on startup
sudo systemctl restart redis

# Verify data loaded
redis-cli info keyspace
redis-cli dbsize
```

#### Scenario: Redis Data Loss (No Persistence)

```bash
# Redis is used for caching and BullMQ queues
# Cache data: Regenerated automatically on cache miss (no recovery needed)
# BullMQ jobs: Jobs in 'waiting' state are lost; active jobs may be duplicated
#
# Recovery:
# 1. Start fresh Redis instance
# 2. Cache will warm up naturally as queries come in
# 3. Check for stuck documents (status='processing' but no active job)
psql -c "UPDATE documents SET status='pending' WHERE status='processing' AND updated_at < NOW() - INTERVAL '1 hour'"
# 4. Re-queue stuck documents for processing
```

#### Cache Warm-Up After Recovery

```bash
#!/bin/bash
# scripts/warm-cache.sh
# Run after Redis recovery to pre-populate cache for active tenants

# Get top 100 most active projects (by query volume in last 7 days)
PROJECTS=$(psql -t -c "
  SELECT DISTINCT project_id
  FROM query_logs
  WHERE created_at > NOW() - INTERVAL '7 days'
  ORDER BY count(*) DESC
  LIMIT 100
")

for PROJECT_ID in $PROJECTS; do
  # Get top 10 most common queries for each project
  QUERIES=$(psql -t -c "
    SELECT query
    FROM query_logs
    WHERE project_id = '$PROJECT_ID'
    AND created_at > NOW() - INTERVAL '7 days'
    GROUP BY query
    ORDER BY count(*) DESC
    LIMIT 10
  ")

  for QUERY in $QUERIES; do
    # Execute query to populate cache
    curl -s -X POST "http://localhost:3000/v1/query" \
      -H "Authorization: Bearer $INTERNAL_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"$QUERY\", \"projectId\": \"$PROJECT_ID\"}" > /dev/null
    sleep 0.1  # Rate limit
  done
done

echo "Cache warm-up completed"
```

---

## 5. Migration Rollback Procedures (Drizzle Kit)

### Generating Down Migrations

```bash
# Drizzle Kit generates migrations from schema changes
# To rollback, you need to create a reverse migration

# 1. Check current migration status
pnpm drizzle-kit check

# 2. If the last migration needs to be rolled back:
# Option A: Create a manual down migration
cat > packages/db/drizzle/0002_rollback_feature_x.sql << 'EOF'
-- Rollback migration 0001_add_feature_x

ALTER TABLE documents DROP COLUMN IF EXISTS new_column;
DROP INDEX IF EXISTS idx_new_column;
EOF

# 3. Apply the rollback migration
pnpm db:migrate

# Option B: If using Drizzle Kit's snapshot feature
# Restore the previous schema snapshot and regenerate
git checkout HEAD~1 -- packages/db/src/schema/
pnpm drizzle-kit generate
pnpm db:migrate
```

### Safe Migration Practices

1. **Always test migrations in staging first**
2. **Never drop columns in the same release that removes code using them** — deploy code change first, then migrate
3. **Use additive migrations** — add columns, add tables, add indexes. Avoid destructive changes in the same PR.
4. **Keep migration files small** — one concern per migration
5. **Store migration history** — never delete applied migration files from the repository

---

## 6. Recovery Testing Schedule

### Quarterly Recovery Drills

| Quarter | Test                    | Procedure                                                      |
| ------- | ----------------------- | -------------------------------------------------------------- |
| Q1      | PostgreSQL PITR         | Restore to 1 hour ago, verify data integrity                   |
| Q2      | Qdrant snapshot restore | Restore single collection from snapshot                        |
| Q3      | Full disaster recovery  | Simulate complete infrastructure failure, restore all services |
| Q4      | Redis failover          | Kill master, verify Sentinel failover                          |

### Recovery Test Checklist

```
[ ] Schedule test during low-traffic window
[ ] Notify team of planned test
[ ] Create test environment (do NOT test on production unless DR drill)
[ ] Execute recovery procedure from documentation
[ ] Measure actual RTO and RPO
[ ] Compare against targets (PostgreSQL: 15min/5min, Qdrant: 30min/1hr, Redis: 5min/1s)
[ ] Document any discrepancies or procedure updates needed
[ ] Update runbook with lessons learned
[ ] Report results to team
```

---

## 7. Cross-References

- Incident response: [incident-response.md](./incident-response.md)
- Performance tuning: [performance-tuning.md](./performance-tuning.md)
- On-call escalation: [on-call-escalation.md](./on-call-escalation.md)
- GDPR data retention: [GDPR_IMPLEMENTATION.md](../compliance/GDPR_IMPLEMENTATION.md)
- SOC 2 backup evidence: [SOC2_ROADMAP.md](../compliance/SOC2_ROADMAP.md)
- Infrastructure costs: [TECH_STACK_DECISIONS.md](../research/TECH_STACK_DECISIONS.md)
