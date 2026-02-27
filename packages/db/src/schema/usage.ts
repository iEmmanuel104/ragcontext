import { pgTable, text, timestamp, integer, bigint } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const tenantUsage = pgTable("tenant_usage", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  period: text("period").notNull(), // YYYY-MM format
  pagesIngested: integer("pages_ingested").notNull().default(0),
  retrievalsCount: integer("retrievals_count").notNull().default(0),
  storageUsedMb: integer("storage_used_mb").notNull().default(0),
  embeddingTokensUsed: bigint("embedding_tokens_used", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
