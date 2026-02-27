import { pgTable, text, timestamp, jsonb, integer, pgEnum } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { projects } from "./projects.js";

export const connectorTypeEnum = pgEnum("connector_type", ["notion", "gdrive", "github"]);
export const connectorStatusEnum = pgEnum("connector_status", [
  "active",
  "disconnected",
  "syncing",
  "error",
]);

export const connectors = pgTable("connectors", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: connectorTypeEnum("type").notNull(),
  status: connectorStatusEnum("status").notNull().default("disconnected"),
  config: jsonb("config").notNull().default({}),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  documentCount: integer("document_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
