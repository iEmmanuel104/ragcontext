import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const planTierEnum = pgEnum("plan_tier", ["free", "pro", "enterprise"]);
export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended", "pending"]);

export const tenants = pgTable("tenants", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planTierEnum("plan").notNull().default("free"),
  status: tenantStatusEnum("status").notNull().default("active"),
  settings: jsonb("settings").notNull().$type<{
    maxProjects: number;
    maxDocumentsPerProject: number;
    maxStorageMb: number;
    embeddingProvider: "cohere" | "bge-m3" | "openai";
    enableColpali: boolean;
    enableCrag: boolean;
    enableCompression: boolean;
    enableSemanticCache: boolean;
    customCorsOrigins: string[];
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
