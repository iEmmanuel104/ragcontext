import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").notNull(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  responseBody: text("response_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
