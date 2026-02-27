import { pgTable, text, timestamp, jsonb, integer, pgEnum } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { projects } from "./projects.js";

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "processing",
  "indexed",
  "failed",
  "deleting",
]);

export const documentSourceEnum = pgEnum("document_source", [
  "upload",
  "notion",
  "gdrive",
  "github",
  "api",
]);

export const documents = pgTable("documents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  source: documentSourceEnum("source").notNull().default("upload"),
  sourceId: text("source_id"),
  mimeType: text("mime_type").notNull().default("text/plain"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  status: documentStatusEnum("status").notNull().default("pending"),
  chunkCount: integer("chunk_count").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  cacheVersion: integer("cache_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
