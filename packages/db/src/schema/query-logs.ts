import { pgTable, text, timestamp, integer, real, boolean, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { projects } from "./projects.js";

export const queryLogs = pgTable("query_logs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  topK: integer("top_k").notNull(),
  resultsCount: integer("results_count").notNull(),
  retrievalTimeMs: integer("retrieval_time_ms").notNull(),
  rerankTimeMs: integer("rerank_time_ms"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  cacheHit: boolean("cache_hit").notNull().default(false),
  qualityScore: real("quality_score"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
