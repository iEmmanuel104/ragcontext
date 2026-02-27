import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const projects = pgTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  settings: jsonb("settings").notNull().$type<{
    defaultChunkStrategy: "semantic" | "recursive" | "fixed" | "sentence";
    defaultChunkMaxTokens: number;
    defaultChunkOverlap: number;
    embeddingDimensions: number;
    qdrantCollectionName: string;
  }>(),
  documentCount: integer("document_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
