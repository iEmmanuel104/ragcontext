import { pgTable, text, timestamp, jsonb, integer, pgEnum } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { projects } from "./projects.js";
import { documents } from "./documents.js";

export const chunkStrategyEnum = pgEnum("chunk_strategy", [
  "semantic",
  "recursive",
  "fixed",
  "sentence",
]);

export const chunks = pgTable("chunks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  index: integer("index").notNull(),
  tokenCount: integer("token_count").notNull(),
  strategy: chunkStrategyEnum("strategy").notNull(),
  metadata: jsonb("metadata").notNull().$type<{
    pageNumber?: number;
    sectionTitle?: string;
    startChar: number;
    endChar: number;
    overlap: number;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
