import { describe, it, expect } from "vitest";
import { parseEnv } from "./env.js";

function makeValidEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: "test",
    PORT: "3000",
    LOG_LEVEL: "info",
    DATABASE_URL: "postgresql://localhost:5432/test",
    DATABASE_POOL_MAX: "20",
    DATABASE_POOL_MIN: "2",
    REDIS_URL: "redis://localhost:6379",
    QDRANT_URL: "http://localhost:6333",
    JWT_SECRET: "a-very-long-jwt-secret-that-is-at-least-32-chars",
    JWT_EXPIRY: "1h",
    API_KEY_SALT: "salt-that-is-at-least-16-chars",
    CORS_ORIGINS: "https://app.example.com",
    ENCRYPTION_KEY: "abcdefghijklmnopqrstuvwxyz012345",
    ENCRYPTION_KEY_ID: "key-001",
    COHERE_API_KEY: "test-cohere-key",
    COHERE_EMBED_MODEL: "embed-v4.0",
    COHERE_RERANK_MODEL: "rerank-v3.5",
    RATE_LIMIT_WINDOW_MS: "60000",
    RATE_LIMIT_MAX_FREE: "30",
    RATE_LIMIT_MAX_PRO: "300",
    RATE_LIMIT_MAX_ENTERPRISE: "3000",
    ...overrides,
  };
}

describe("parseEnv", () => {
  it("parses valid env and returns AppConfig", () => {
    const config = parseEnv(makeValidEnv());

    expect(config.nodeEnv).toBe("test");
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe("info");
    expect(config.database.url).toBe("postgresql://localhost:5432/test");
    expect(config.database.poolMax).toBe(20);
    expect(config.database.poolMin).toBe(2);
    expect(config.redis.url).toBe("redis://localhost:6379");
    expect(config.qdrant.url).toBe("http://localhost:6333");
    expect(config.auth.jwtSecret).toContain("a-very-long");
    expect(config.auth.jwtExpiry).toBe("1h");
    expect(config.cors.origins).toEqual(["https://app.example.com"]);
    expect(config.encryption.key).toBe("abcdefghijklmnopqrstuvwxyz012345");
    expect(config.encryption.keyId).toBe("key-001");
    expect(config.cohere.apiKey).toBe("test-cohere-key");
    expect(config.rateLimit.windowMs).toBe(60000);
    expect(config.rateLimit.maxByPlan).toEqual({ free: 30, pro: 300, enterprise: 3000 });
  });

  it("splits comma-separated CORS_ORIGINS", () => {
    const config = parseEnv(makeValidEnv({ CORS_ORIGINS: "https://a.com, https://b.com" }));

    expect(config.cors.origins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("rejects wildcard CORS_ORIGINS", () => {
    expect(() => parseEnv(makeValidEnv({ CORS_ORIGINS: "*" }))).toThrow();
  });

  it("rejects missing CORS_ORIGINS", () => {
    const env = makeValidEnv();
    delete (env as Record<string, string | undefined>).CORS_ORIGINS;
    expect(() => parseEnv(env as Record<string, string>)).toThrow();
  });

  it("rejects invalid DATABASE_URL (not starting with postgresql://)", () => {
    expect(() => parseEnv(makeValidEnv({ DATABASE_URL: "mysql://localhost" }))).toThrow();
  });

  it("rejects missing DATABASE_URL", () => {
    const env = makeValidEnv();
    delete (env as Record<string, string | undefined>).DATABASE_URL;
    expect(() => parseEnv(env as Record<string, string>)).toThrow();
  });

  it("rejects JWT_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv(makeValidEnv({ JWT_SECRET: "short" }))).toThrow();
  });

  it("rejects API_KEY_SALT shorter than 16 characters", () => {
    expect(() => parseEnv(makeValidEnv({ API_KEY_SALT: "short" }))).toThrow();
  });

  it("rejects ENCRYPTION_KEY that is not exactly 32 characters", () => {
    expect(() => parseEnv(makeValidEnv({ ENCRYPTION_KEY: "too-short" }))).toThrow();
  });

  it("rejects invalid NODE_ENV", () => {
    expect(() => parseEnv(makeValidEnv({ NODE_ENV: "staging" }))).toThrow();
  });

  it("uses defaults for optional fields", () => {
    const env = makeValidEnv();
    delete (env as Record<string, string | undefined>).PORT;
    delete (env as Record<string, string | undefined>).DATABASE_POOL_MAX;
    delete (env as Record<string, string | undefined>).DATABASE_POOL_MIN;
    delete (env as Record<string, string | undefined>).COHERE_API_KEY;

    const config = parseEnv(env as Record<string, string>);

    expect(config.port).toBe(3000);
    expect(config.database.poolMax).toBe(20);
    expect(config.database.poolMin).toBe(2);
    expect(config.cohere.apiKey).toBe("");
  });
});
