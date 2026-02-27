import type { PlanTier } from "./tenant.js";

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  database: DatabaseConfig;
  redis: RedisConfig;
  qdrant: QdrantConfig;
  auth: AuthConfig;
  cors: CorsConfig;
  encryption: EncryptionConfig;
  cohere: CohereConfig;
  rateLimit: RateLimitConfig;
}

export interface DatabaseConfig {
  url: string;
  poolMax: number;
  poolMin: number;
}

export interface RedisConfig {
  url: string;
}

export interface QdrantConfig {
  url: string;
  apiKey?: string;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiry: string;
  apiKeySalt: string;
}

export interface CorsConfig {
  origins: string[];
}

export interface EncryptionConfig {
  key: string;
  keyId: string;
}

export interface CohereConfig {
  apiKey: string;
  embedModel: string;
  rerankModel: string;
}

export interface RateLimitConfig {
  windowMs: number;
  maxByPlan: Record<PlanTier, number>;
}

export interface FeatureFlags {
  colpali: boolean;
  crag: boolean;
  compression: boolean;
  semanticCache: boolean;
  bgeM3Embedding: boolean;
  threeTierMemory: boolean;
}

export type FeatureFlagsByPlan = Record<PlanTier, FeatureFlags>;
