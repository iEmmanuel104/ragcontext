import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const auditLogs = pgTable("audit_logs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // e.g., "document.create", "api_key.revoke"
  actorType: text("actor_type").notNull(), // "api_key", "system", "oauth_user"
  actorId: text("actor_id").notNull(),
  resourceType: text("resource_type").notNull(), // "document", "project", "connector"
  resourceId: text("resource_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
