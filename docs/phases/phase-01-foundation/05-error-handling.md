# Phase 1.05: Error Handling, Logging, Config & Crypto

> `@ci/errors`, `@ci/logger`, `@ci/config`, `@ci/crypto` — Cross-cutting infrastructure packages.

---

## Objectives

1. Define an error class hierarchy that serializes to consistent API error responses
2. Implement circuit breaker pattern for external service calls
3. Set up structured logging with PII redaction
4. Create Zod-validated environment configuration
5. Build encryption utilities for connector credentials and sensitive data

## Deliverables

- `packages/errors/` — Error hierarchy, circuit breaker, retry utilities
- `packages/logger/` — Pino structured logging with PII redaction transport
- `packages/config/` — Zod-validated environment variables
- `packages/crypto/` — AES-256-GCM encryption, HMAC-SHA256, key rotation

---

## `@ci/errors` — Error Hierarchy

### Package Structure

```
packages/errors/
├── src/
│   ├── index.ts               # Re-exports
│   ├── app-error.ts           # Base AppError class
│   ├── errors.ts              # Concrete error classes
│   ├── circuit-breaker.ts     # Circuit breaker implementation
│   └── retry.ts               # Retry with exponential backoff + jitter
├── tests/
│   ├── app-error.test.ts
│   ├── circuit-breaker.test.ts
│   └── retry.test.ts
├── package.json
└── tsconfig.json
```

### `app-error.ts` — Base Error Class

```typescript
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    options?: {
      isOperational?: boolean;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
    this.details = options?.details;

    // Maintain proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}
```

### `errors.ts` — Concrete Error Classes

```typescript
import { AppError } from "./app-error.js";

// ─── Authentication Errors (401) ────────────────────────────
export class AuthError extends AppError {
  constructor(message: string, code: string = "AUTH_ERROR") {
    super(message, 401, code);
  }
}

export class InvalidApiKeyError extends AuthError {
  constructor() {
    super("Invalid API key", "INVALID_API_KEY");
  }
}

export class ExpiredApiKeyError extends AuthError {
  constructor() {
    super("API key has expired", "API_KEY_EXPIRED");
  }
}

export class InsufficientScopeError extends AuthError {
  constructor(requiredScope: string) {
    super(`Insufficient permissions. Required: ${requiredScope}`, "INSUFFICIENT_SCOPE");
  }
}

// ─── Validation Errors (400) ────────────────────────────────
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, "VALIDATION_ERROR", { details });
  }
}

// ─── Not Found Errors (404) ─────────────────────────────────
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 404, "NOT_FOUND", {
      details: { resource, id },
    });
  }
}

// ─── Conflict Errors (409) ──────────────────────────────────
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

// ─── Rate Limit Errors (429) ────────────────────────────────
export class RateLimitError extends AppError {
  constructor(retryAfterMs: number) {
    super("Rate limit exceeded", 429, "RATE_LIMIT_EXCEEDED", {
      details: { retryAfterMs },
    });
  }
}

// ─── External Service Errors (502) ──────────────────────────
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, cause?: Error) {
    super(`${service}: ${message}`, 502, "EXTERNAL_SERVICE_ERROR", {
      details: { service },
      cause,
    });
  }
}

export class EmbeddingServiceError extends ExternalServiceError {
  constructor(message: string, cause?: Error) {
    super("Embedding Service", message, cause);
  }
}

export class VectorStoreError extends ExternalServiceError {
  constructor(message: string, cause?: Error) {
    super("Vector Store", message, cause);
  }
}

export class RerankServiceError extends ExternalServiceError {
  constructor(message: string, cause?: Error) {
    super("Rerank Service", message, cause);
  }
}

// ─── Internal Errors (500) ──────────────────────────────────
export class InternalError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 500, "INTERNAL_ERROR", { isOperational: false, cause });
  }
}
```

### Express Error Handler Middleware

```typescript
// apps/api/src/middleware/error-handler.ts
import type { Request, Response, NextFunction } from "express";
import { AppError } from "@ci/errors";
import { logger } from "@ci/logger";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  // Known operational errors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId: req.requestId }, "Server error");
    } else {
      logger.warn({ err, requestId: req.requestId }, "Client error");
    }

    return res.status(err.statusCode).json({
      success: false,
      ...err.toJSON(),
      requestId: req.requestId,
    });
  }

  // Unknown errors — treat as 500
  logger.error({ err, requestId: req.requestId }, "Unhandled error");

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
    requestId: req.requestId,
  });
}
```

---

## Circuit Breaker Pattern

### `circuit-breaker.ts`

Applied to all external service calls: Cohere API, Qdrant, Docling.

```typescript
export enum CircuitState {
  CLOSED = "CLOSED", // Normal operation — requests pass through
  OPEN = "OPEN", // Failing — requests rejected immediately
  HALF_OPEN = "HALF_OPEN", // Testing — allow one request through
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // Failures before opening (default: 5)
  resetTimeoutMs: number; // Time in OPEN before trying HALF_OPEN (default: 30000)
  monitorWindowMs: number; // Window for counting failures (default: 60000)
  name: string; // For logging/metrics
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = []; // Timestamps of failures
  private lastFailureTime = 0;
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      resetTimeoutMs: options.resetTimeoutMs ?? 30_000,
      monitorWindowMs: options.monitorWindowMs ?? 60_000,
      name: options.name,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new ExternalServiceError(
          this.options.name,
          `Circuit breaker is OPEN. Retry after ${this.options.resetTimeoutMs}ms`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.failures = [];
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;

    // Remove failures outside the monitoring window
    this.failures = this.failures.filter((t) => now - t < this.options.monitorWindowMs);
    this.failures.push(now);

    if (this.failures.length >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

**Usage pattern:**

```typescript
// In @ci/embeddings/src/cohere.ts
const breaker = new CircuitBreaker({ name: 'cohere-embed', failureThreshold: 5, resetTimeoutMs: 30000, monitorWindowMs: 60000 });

async embed(texts: string[]): Promise<EmbeddingResult> {
  return breaker.execute(async () => {
    // ... Cohere API call
  });
}
```

---

## Retry with Exponential Backoff

### `retry.ts`

```typescript
export interface RetryOptions {
  maxAttempts: number; // Default: 3
  baseDelayMs: number; // Default: 1000
  maxDelayMs: number; // Default: 30000
  shouldRetry?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000 },
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (options.shouldRetry && !options.shouldRetry(lastError)) {
        throw lastError;
      }

      // Don't delay after the last attempt
      if (attempt < options.maxAttempts - 1) {
        const delay = Math.min(
          options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
          options.maxDelayMs,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Helper: common retryable conditions
export function isRetryableError(error: Error): boolean {
  if (error instanceof AppError) {
    // Retry on 429 (rate limit) and 502/503 (service unavailable)
    return [429, 502, 503].includes(error.statusCode);
  }
  // Retry on network errors
  if ("code" in error) {
    return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"].includes((error as any).code);
  }
  return false;
}
```

---

## `@ci/logger` — Structured Logging

### Package Structure

```
packages/logger/
├── src/
│   ├── index.ts              # Logger factory + default instance
│   └── pii-redact.ts         # PII redaction transport
├── package.json
└── tsconfig.json
```

### `index.ts`

```typescript
import pino from "pino";
import { getConfig } from "@ci/config";
import { redactPaths } from "./pii-redact.js";

const config = getConfig();

export const logger = pino({
  level: config.logLevel ?? "info",
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      service: config.serviceName ?? "contextinject",
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty print in development
  ...(config.nodeEnv === "development" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard" },
    },
  }),
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
```

### `pii-redact.ts`

```typescript
// Paths to redact from all log output
export const redactPaths = [
  // Authentication
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  "passwordHash",
  "apiKey",
  "rawKey",
  "keyHash",
  "token",
  "refreshToken",
  "accessToken",
  "codeVerifier",

  // Personal data
  "email",
  "user.email",
  "req.body.email",
  "req.body.password",

  // Credentials
  "credentials",
  "credentials.encrypted",
  "credentials.ciphertext",
  "encryptionKey",
  "hmacSecret",
  "jwtSecret",

  // Nested patterns
  "*.password",
  "*.apiKey",
  "*.secret",
  "*.token",
];
```

---

## `@ci/config` — Zod-Validated Environment Configuration

### Package Structure

```
packages/config/
├── src/
│   └── index.ts
├── package.json
└── tsconfig.json
```

### `index.ts`

```typescript
import { z } from "zod";

const envSchema = z.object({
  // Database
  databaseUrl: z.string().url().describe("PostgreSQL connection string"),
  databasePoolMin: z.coerce.number().default(2),
  databasePoolMax: z.coerce.number().default(20),

  // Redis
  redisUrl: z.string().url().describe("Redis connection string"),

  // Vector Store
  qdrantUrl: z.string().url().describe("Qdrant REST API URL"),
  qdrantApiKey: z.string().optional(),

  // External APIs
  cohereApiKey: z.string().min(1).describe("Cohere API key"),
  openaiApiKey: z.string().optional(),

  // Security
  encryptionKey: z.string().length(64).describe("32-byte hex encryption key"),
  hmacSecret: z.string().min(32).describe("HMAC-SHA256 signing secret"),
  jwtSecret: z.string().min(32).describe("JWT signing secret"),
  jwtExpiry: z.string().default("24h"),

  // Application
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  apiBaseUrl: z.string().url().default("http://localhost:3000"),
  serviceName: z.string().default("contextinject"),

  // Observability (optional)
  langfusePublicKey: z.string().optional(),
  langfuseSecretKey: z.string().optional(),
  langfuseHost: z.string().url().optional(),
  otelExporterEndpoint: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const result = envSchema.safeParse({
    databaseUrl: process.env.DATABASE_URL,
    databasePoolMin: process.env.DATABASE_POOL_MIN,
    databasePoolMax: process.env.DATABASE_POOL_MAX,
    redisUrl: process.env.REDIS_URL,
    qdrantUrl: process.env.QDRANT_URL,
    qdrantApiKey: process.env.QDRANT_API_KEY,
    cohereApiKey: process.env.COHERE_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    encryptionKey: process.env.ENCRYPTION_KEY,
    hmacSecret: process.env.HMAC_SECRET,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiry: process.env.JWT_EXPIRY,
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    logLevel: process.env.LOG_LEVEL,
    apiBaseUrl: process.env.API_BASE_URL,
    serviceName: process.env.SERVICE_NAME,
    langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
    langfuseHost: process.env.LANGFUSE_HOST,
    otelExporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

// Reset cache (for testing)
export function resetConfig(): void {
  cachedConfig = undefined;
}
```

---

## `@ci/crypto` — Encryption Utilities

### Package Structure

```
packages/crypto/
├── src/
│   └── index.ts
├── tests/
│   └── crypto.test.ts
├── package.json
└── tsconfig.json
```

### `index.ts`

```typescript
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";
import { getConfig } from "@ci/config";

// ─── AES-256-GCM Encryption ─────────────────────────────────

export interface EncryptedData {
  ciphertext: string; // Base64-encoded
  iv: string; // Hex-encoded
  authTag: string; // Hex-encoded
  keyVersion: number; // For key rotation tracking
}

export function encrypt(plaintext: string, keyVersion = 1): EncryptedData {
  const config = getConfig();
  const key = Buffer.from(config.encryptionKey, "hex"); // 32 bytes
  const iv = randomBytes(12); // 96-bit IV for GCM

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let ciphertext = cipher.update(plaintext, "utf8", "base64");
  ciphertext += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    keyVersion,
  };
}

export function decrypt(data: EncryptedData): string {
  const config = getConfig();
  const key = Buffer.from(config.encryptionKey, "hex");
  const iv = Buffer.from(data.iv, "hex");
  const authTag = Buffer.from(data.authTag, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(data.ciphertext, "base64", "utf8");
  plaintext += decipher.final("utf8");

  return plaintext;
}

// ─── HMAC-SHA256 ────────────────────────────────────────────

export function signHmac(payload: string): string {
  const config = getConfig();
  return createHmac("sha256", config.hmacSecret).update(payload).digest("hex");
}

export function verifyHmac(payload: string, signature: string): boolean {
  const expected = signHmac(payload);
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// ─── Key Rotation Support ───────────────────────────────────

export function reEncrypt(data: EncryptedData, newKeyHex: string): EncryptedData {
  // Decrypt with current key
  const plaintext = decrypt(data);

  // Re-encrypt with new key
  const newKey = Buffer.from(newKeyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", newKey, iv);
  let ciphertext = cipher.update(plaintext, "utf8", "base64");
  ciphertext += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    keyVersion: data.keyVersion + 1,
  };
}

// ─── Utility ────────────────────────────────────────────────

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

export function hashContent(content: string): string {
  return createHmac("sha256", "").update(content).digest("hex");
}
```

---

## Testing Requirements

### `@ci/errors`

- AppError serializes to correct JSON structure
- Each error class has correct statusCode and code
- Circuit breaker transitions: CLOSED -> OPEN after threshold failures
- Circuit breaker transitions: OPEN -> HALF_OPEN after timeout
- Circuit breaker transitions: HALF_OPEN -> CLOSED on success
- Circuit breaker transitions: HALF_OPEN -> OPEN on failure
- `withRetry` retries correct number of times
- `withRetry` respects exponential backoff delays
- `withRetry` stops retrying when `shouldRetry` returns false

### `@ci/logger`

- Logger outputs JSON in production mode
- Logger redacts PII fields (authorization header, password, email, apiKey)
- Logger includes service name and timestamp

### `@ci/config`

- Valid configuration passes validation
- Missing required fields produce clear error messages
- Default values are applied correctly
- Invalid types are rejected (e.g., port = "abc")
- Config is cached after first call

### `@ci/crypto`

- AES-256-GCM encrypt/decrypt roundtrip preserves plaintext
- Invalid auth tag causes decryption to fail
- HMAC sign/verify roundtrip works
- HMAC verify rejects modified payloads
- Key rotation re-encrypts with new key version
- `generateEncryptionKey` produces 64-character hex string

---

## Critical File Paths

| File                                       | Purpose                                  |
| ------------------------------------------ | ---------------------------------------- |
| `packages/errors/src/app-error.ts`         | Base error class with JSON serialization |
| `packages/errors/src/errors.ts`            | All concrete error classes               |
| `packages/errors/src/circuit-breaker.ts`   | Circuit breaker for external services    |
| `packages/errors/src/retry.ts`             | Exponential backoff with jitter          |
| `packages/logger/src/index.ts`             | Pino logger factory                      |
| `packages/logger/src/pii-redact.ts`        | PII field paths for redaction            |
| `packages/config/src/index.ts`             | Zod env validation + config cache        |
| `packages/crypto/src/index.ts`             | AES-256-GCM, HMAC-SHA256, key rotation   |
| `apps/api/src/middleware/error-handler.ts` | Express error handler                    |

---

## Risk Assessment

| Risk                                   | Impact   | Mitigation                                                   |
| -------------------------------------- | -------- | ------------------------------------------------------------ |
| Encryption key leak in logs            | Critical | PII redaction includes all key-related fields                |
| Circuit breaker false positives        | Medium   | Tune threshold and window per service; monitor state changes |
| Zod validation too strict for env vars | Low      | Defaults on optional fields; clear error messages            |
| Pino performance overhead              | Low      | Pino is ~5x faster than Winston; async logging               |

---

_Related: [Phase 1 Overview](./README.md) | [Auth System](./04-auth-system.md) | [Phase 2: Core Pipeline](../phase-02-core-pipeline/README.md)_
