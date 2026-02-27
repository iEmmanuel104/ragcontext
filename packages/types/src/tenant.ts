export type PlanTier = "free" | "pro" | "enterprise";

export type TenantStatus = "active" | "suspended" | "pending";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  status: TenantStatus;
  settings: TenantSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSettings {
  maxProjects: number;
  maxDocumentsPerProject: number;
  maxStorageMb: number;
  embeddingProvider: "cohere" | "bge-m3" | "openai";
  enableColpali: boolean;
  enableCrag: boolean;
  enableCompression: boolean;
  enableSemanticCache: boolean;
  customCorsOrigins: string[];
}

export interface TenantUsage {
  tenantId: string;
  period: string;
  pagesIngested: number;
  retrievalsCount: number;
  storageUsedMb: number;
  embeddingTokensUsed: number;
}
