import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * RLS policy SQL statements for tenant isolation.
 * These should be run as part of database migrations.
 *
 * Every tenant-scoped table gets a policy that restricts
 * access based on current_setting('app.tenant_id').
 */
const TENANT_SCOPED_TABLES = [
  "projects",
  "documents",
  "chunks",
  "api_keys",
  "connectors",
  "tenant_usage",
  "query_logs",
  "idempotency_keys",
  "audit_logs",
] as const;

export function getRlsMigrationSql(): string {
  const statements: string[] = [];

  for (const table of TENANT_SCOPED_TABLES) {
    statements.push(`
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tenant_isolation_policy ON ${table};
      CREATE POLICY tenant_isolation_policy ON ${table}
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

      GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO contextinject_api;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO contextinject_worker;
    `);
  }

  // Tenants table: users can only see their own tenant
  statements.push(`
    ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation_policy ON tenants;
    CREATE POLICY tenant_isolation_policy ON tenants
      USING (id = current_setting('app.tenant_id', true))
      WITH CHECK (id = current_setting('app.tenant_id', true));

    GRANT SELECT, UPDATE ON tenants TO contextinject_api;
    GRANT SELECT ON tenants TO contextinject_worker;
  `);

  return statements.join("\n");
}

/**
 * Sets the tenant context for RLS policies.
 * Must be called at the start of every request/job.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function setTenantContext(db: PgDatabase<any>, tenantId: string): Promise<void> {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
}

/**
 * Clears the tenant context. Call after request completes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function clearTenantContext(db: PgDatabase<any>): Promise<void> {
  await db.execute(sql`SELECT set_config('app.tenant_id', '', true)`);
}
