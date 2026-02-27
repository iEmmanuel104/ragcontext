import { z } from "zod";
import type { AppConfig, PlanTier } from "@contextinject/types";

/**
 * Zod schema for all environment variables defined in .env.example.
 * Validates, transforms, and provides defaults so that the resulting
 * object is a strongly-typed AppConfig.
 */
export const envSchema = z.object({
  // ---------- Core ----------
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.string().default("3000").transform(Number).pipe(z.number().int().positive()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),

  // ---------- Database ----------
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((url) => url.startsWith("postgresql://"), {
      message: "DATABASE_URL must start with postgresql://",
    }),
  DATABASE_POOL_MAX: z.string().default("20").transform(Number).pipe(z.number().int().positive()),
  DATABASE_POOL_MIN: z.string().default("2").transform(Number).pipe(z.number().int().nonnegative()),

  // ---------- Redis ----------
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // ---------- Qdrant ----------
  QDRANT_URL: z.string().min(1, "QDRANT_URL is required"),
  QDRANT_API_KEY: z.string().optional(),

  // ---------- Auth ----------
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRY: z.string().default("1h"),
  API_KEY_SALT: z.string().min(16, "API_KEY_SALT must be at least 16 characters"),

  // ---------- CORS ----------
  CORS_ORIGINS: z
    .string()
    .min(1, "CORS_ORIGINS is required")
    .refine((val) => val !== "*", {
      message: 'CORS_ORIGINS must not be "*" — specify explicit origins',
    })
    .transform((val) => val.split(",").map((origin) => origin.trim())),

  // ---------- Encryption ----------
  ENCRYPTION_KEY: z.string().length(32, "ENCRYPTION_KEY must be exactly 32 characters"),
  ENCRYPTION_KEY_ID: z.string().min(1, "ENCRYPTION_KEY_ID is required"),

  // ---------- Cohere ----------
  COHERE_API_KEY: z.string().optional(),
  COHERE_EMBED_MODEL: z.string().default("embed-v4.0"),
  COHERE_RERANK_MODEL: z.string().default("rerank-v3.5"),

  // ---------- Rate Limiting ----------
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .default("60000")
    .transform(Number)
    .pipe(z.number().int().positive()),
  RATE_LIMIT_MAX_FREE: z.string().default("30").transform(Number).pipe(z.number().int().positive()),
  RATE_LIMIT_MAX_PRO: z.string().default("300").transform(Number).pipe(z.number().int().positive()),
  RATE_LIMIT_MAX_ENTERPRISE: z
    .string()
    .default("3000")
    .transform(Number)
    .pipe(z.number().int().positive()),
});

/**
 * Parse and validate process.env (or any compatible record) against
 * the envSchema and return a strongly-typed {@link AppConfig}.
 *
 * Throws a ZodError with detailed messages when validation fails.
 */
export function parseEnv(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  const maxByPlan: Record<PlanTier, number> = {
    free: parsed.RATE_LIMIT_MAX_FREE,
    pro: parsed.RATE_LIMIT_MAX_PRO,
    enterprise: parsed.RATE_LIMIT_MAX_ENTERPRISE,
  };

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,

    database: {
      url: parsed.DATABASE_URL,
      poolMax: parsed.DATABASE_POOL_MAX,
      poolMin: parsed.DATABASE_POOL_MIN,
    },

    redis: {
      url: parsed.REDIS_URL,
    },

    qdrant: {
      url: parsed.QDRANT_URL,
      apiKey: parsed.QDRANT_API_KEY,
    },

    auth: {
      jwtSecret: parsed.JWT_SECRET,
      jwtExpiry: parsed.JWT_EXPIRY,
      apiKeySalt: parsed.API_KEY_SALT,
    },

    cors: {
      origins: parsed.CORS_ORIGINS,
    },

    encryption: {
      key: parsed.ENCRYPTION_KEY,
      keyId: parsed.ENCRYPTION_KEY_ID,
    },

    cohere: {
      apiKey: parsed.COHERE_API_KEY ?? "",
      embedModel: parsed.COHERE_EMBED_MODEL,
      rerankModel: parsed.COHERE_RERANK_MODEL,
    },

    rateLimit: {
      windowMs: parsed.RATE_LIMIT_WINDOW_MS,
      maxByPlan,
    },
  };
}
