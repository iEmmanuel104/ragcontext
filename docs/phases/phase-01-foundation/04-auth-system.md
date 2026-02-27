# Phase 1.04: Auth System

> `@ci/auth` — API key generation, JWT tokens, OAuth 2.0 PKCE, RBAC, and password hashing.

---

## Objectives

1. API key generation with `ci_live_` / `ci_test_` prefixes and SHA-256 hash storage
2. JWT tokens for dashboard session management
3. OAuth 2.0 PKCE flow for connector authentication (Notion, Google, Slack)
4. Role-Based Access Control (RBAC) with four roles
5. Argon2id password hashing for dashboard users
6. Rate limiting per API key and per plan tier

## Deliverables

- `packages/auth/src/api-key.ts` — Key generation, validation, rotation
- `packages/auth/src/jwt.ts` — Token issue, verify, refresh
- `packages/auth/src/oauth.ts` — PKCE flow helpers
- `packages/auth/src/rbac.ts` — Role + scope enforcement
- `packages/auth/src/password.ts` — Argon2id hashing
- `packages/auth/src/rate-limit.ts` — Per-key rate limiting
- `apps/api/src/middleware/auth.ts` — Express auth middleware

---

## Package Structure

```
packages/auth/
├── src/
│   ├── index.ts           # Re-exports
│   ├── api-key.ts         # Key generation + validation
│   ├── jwt.ts             # Token issue + verify
│   ├── oauth.ts           # OAuth 2.0 PKCE
│   ├── rbac.ts            # Role-based access control
│   ├── password.ts        # Argon2id hashing
│   └── rate-limit.ts      # Plan-based rate limits
├── tests/
│   ├── api-key.test.ts
│   ├── jwt.test.ts
│   ├── rbac.test.ts
│   └── password.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### `packages/auth/package.json`

```json
{
  "name": "@ci/auth",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run"
  },
  "dependencies": {
    "@ci/types": "workspace:*",
    "@ci/db": "workspace:*",
    "@ci/crypto": "workspace:*",
    "@ci/errors": "workspace:*",
    "argon2": "^0.41.0",
    "jsonwebtoken": "^9.0.0"
  },
  "devDependencies": {
    "@types/jsonwebtoken": "^9.0.0"
  }
}
```

---

## API Key System

### Key Format

```
ci_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
│  │    └── 36 characters of base36-encoded random bytes
│  └── Environment: "live" (production) or "test" (development)
└── Prefix: "ci" (ContextInject)
```

- **Total length:** ~45 characters
- **Entropy:** 256 bits (32 bytes of `crypto.randomBytes`)
- **Display prefix:** First 16 characters stored for identification (e.g., `ci_live_a1b2c3d4`)
- **Storage:** Only SHA-256 hash stored in database; raw key shown once at creation

### `api-key.ts`

```typescript
import { randomBytes, createHash } from "node:crypto";
import { db } from "@ci/db";
import { apiKeys } from "@ci/db/schema";
import { eq } from "drizzle-orm";
import type { ApiKeyScope } from "@ci/types";
import { AuthError } from "@ci/errors";

export interface GenerateApiKeyOptions {
  tenantId: string;
  name: string;
  scopes: ApiKeyScope[];
  environment: "live" | "test";
  expiresAt?: Date;
}

export interface GeneratedApiKey {
  id: string;
  rawKey: string; // Only returned once at creation
  prefix: string;
  name: string;
  scopes: ApiKeyScope[];
  environment: "live" | "test";
  createdAt: Date;
}

export async function generateApiKey(opts: GenerateApiKeyOptions): Promise<GeneratedApiKey> {
  const randomPart = randomBytes(32).toString("base64url");
  const envPrefix = opts.environment === "live" ? "ci_live_" : "ci_test_";
  const rawKey = `${envPrefix}${randomPart}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const prefix = rawKey.slice(0, 16);

  const [record] = await db
    .insert(apiKeys)
    .values({
      tenantId: opts.tenantId,
      keyHash,
      prefix,
      name: opts.name,
      scopes: opts.scopes,
      environment: opts.environment,
      expiresAt: opts.expiresAt,
    })
    .returning();

  return {
    id: record.id,
    rawKey, // IMPORTANT: Only returned here. Cannot be retrieved again.
    prefix,
    name: opts.name,
    scopes: opts.scopes,
    environment: opts.environment,
    createdAt: record.createdAt,
  };
}

// In-memory LRU cache for validated API keys
const KEY_CACHE = new Map<
  string,
  {
    tenantId: string;
    keyId: string;
    scopes: string[];
    environment: string;
    cachedAt: number;
  }
>();
const KEY_CACHE_MAX = 1000;
const KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function validateApiKey(rawKey: string): Promise<{
  tenantId: string;
  keyId: string;
  scopes: ApiKeyScope[];
  environment: string;
}> {
  // Validate format
  if (!rawKey.startsWith("ci_live_") && !rawKey.startsWith("ci_test_")) {
    throw new AuthError("Invalid API key format", "INVALID_API_KEY");
  }

  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  // Check cache first
  const cached = KEY_CACHE.get(keyHash);
  if (cached && Date.now() - cached.cachedAt < KEY_CACHE_TTL_MS) {
    return {
      tenantId: cached.tenantId,
      keyId: cached.keyId,
      scopes: cached.scopes as ApiKeyScope[],
      environment: cached.environment,
    };
  }

  // Database lookup
  const [record] = await db
    .select({
      id: apiKeys.id,
      tenantId: apiKeys.tenantId,
      scopes: apiKeys.scopes,
      environment: apiKeys.environment,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!record) {
    throw new AuthError("Invalid API key", "INVALID_API_KEY");
  }

  if (record.expiresAt && record.expiresAt < new Date()) {
    throw new AuthError("API key has expired", "API_KEY_EXPIRED");
  }

  // Update last used (fire-and-forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, record.id))
    .catch(() => {});

  // Cache the validated key
  if (KEY_CACHE.size >= KEY_CACHE_MAX) {
    const firstKey = KEY_CACHE.keys().next().value;
    if (firstKey) KEY_CACHE.delete(firstKey);
  }
  KEY_CACHE.set(keyHash, {
    tenantId: record.tenantId,
    keyId: record.id,
    scopes: record.scopes as string[],
    environment: record.environment,
    cachedAt: Date.now(),
  });

  return {
    tenantId: record.tenantId,
    keyId: record.id,
    scopes: record.scopes as ApiKeyScope[],
    environment: record.environment,
  };
}

export async function rotateApiKey(oldKeyId: string, tenantId: string): Promise<GeneratedApiKey> {
  const [oldKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, oldKeyId)).limit(1);
  if (!oldKey || oldKey.tenantId !== tenantId) {
    throw new AuthError("API key not found", "NOT_FOUND");
  }

  // Generate new key with same configuration
  const newKey = await generateApiKey({
    tenantId,
    name: `${oldKey.name} (rotated)`,
    scopes: oldKey.scopes as ApiKeyScope[],
    environment: oldKey.environment as "live" | "test",
  });

  // Delete old key
  await db.delete(apiKeys).where(eq(apiKeys.id, oldKeyId));

  // Invalidate cache
  KEY_CACHE.clear();

  return newKey;
}
```

---

## JWT Token Management

### `jwt.ts`

```typescript
import jwt from "jsonwebtoken";
import type { JwtPayload, Role } from "@ci/types";
import { AuthError } from "@ci/errors";
import { getConfig } from "@ci/config";

const config = getConfig();

export interface IssueTokenOptions {
  userId: string;
  tenantId: string;
  role: Role;
}

export function issueToken(opts: IssueTokenOptions): string {
  const payload: Omit<JwtPayload, "iat" | "exp"> = {
    sub: opts.userId,
    tid: opts.tenantId,
    role: opts.role,
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiry ?? "24h",
    issuer: "contextinject",
    audience: "ci-dashboard",
  });
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, config.jwtSecret, {
      issuer: "contextinject",
      audience: "ci-dashboard",
    }) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthError("Token has expired", "TOKEN_EXPIRED");
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new AuthError("Invalid token", "INVALID_TOKEN");
    }
    throw new AuthError("Token verification failed", "TOKEN_ERROR");
  }
}

export function issueRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: "refresh" }, config.jwtSecret, {
    expiresIn: "7d",
    issuer: "contextinject",
  });
}
```

---

## OAuth 2.0 PKCE for Connectors

### `oauth.ts`

```typescript
import { randomBytes, createHash } from "node:crypto";
import type { ConnectorType, OAuthState } from "@ci/types";
import { encrypt, decrypt } from "@ci/crypto";

// PKCE code verifier generation (RFC 7636)
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// OAuth state parameter (encrypted, contains tenant context)
export function createOAuthState(params: {
  tenantId: string;
  connectorType: ConnectorType;
  redirectUrl: string;
}): { state: string; codeVerifier: string } {
  const codeVerifier = generateCodeVerifier();
  const nonce = randomBytes(16).toString("hex");

  const statePayload: OAuthState = {
    tenantId: params.tenantId,
    connectorType: params.connectorType,
    redirectUrl: params.redirectUrl,
    codeVerifier,
    nonce,
  };

  const encrypted = encrypt(JSON.stringify(statePayload));
  const state = Buffer.from(JSON.stringify(encrypted)).toString("base64url");

  return { state, codeVerifier };
}

export function parseOAuthState(state: string): OAuthState {
  const encrypted = JSON.parse(Buffer.from(state, "base64url").toString());
  const decrypted = decrypt(encrypted);
  return JSON.parse(decrypted) as OAuthState;
}

// Connector-specific OAuth configuration
export const OAUTH_CONFIGS: Record<
  string,
  {
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
  }
> = {
  notion: {
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [], // Notion uses integration-level permissions
  },
  "google-drive": {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  },
  slack: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["channels:history", "channels:read", "files:read"],
  },
  gmail: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  },
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:org"],
  },
};
```

---

## RBAC (Role-Based Access Control)

### `rbac.ts`

```typescript
import type { Role, ApiKeyScope } from "@ci/types";
import { AuthError } from "@ci/errors";

const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

const ROLE_SCOPES: Record<Role, ApiKeyScope[]> = {
  owner: ["documents:read", "documents:write", "query", "connectors", "analytics", "admin"],
  admin: ["documents:read", "documents:write", "query", "connectors", "analytics"],
  member: ["documents:read", "documents:write", "query"],
  viewer: ["documents:read", "query"],
};

export function hasScope(userScopes: ApiKeyScope[], requiredScope: ApiKeyScope): boolean {
  return userScopes.includes(requiredScope) || userScopes.includes("admin");
}

export function requireScope(scopes: ApiKeyScope[], requiredScope: ApiKeyScope): void {
  if (!hasScope(scopes, requiredScope)) {
    throw new AuthError(
      `Insufficient permissions. Required scope: ${requiredScope}`,
      "INSUFFICIENT_SCOPE",
    );
  }
}

export function hasRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function requireRole(userRole: Role, requiredRole: Role): void {
  if (!hasRole(userRole, requiredRole)) {
    throw new AuthError(
      `Insufficient role. Required: ${requiredRole}, Current: ${userRole}`,
      "INSUFFICIENT_ROLE",
    );
  }
}

export function getScopesForRole(role: Role): ApiKeyScope[] {
  return ROLE_SCOPES[role];
}
```

---

## Password Hashing

### `password.ts`

```typescript
import { hash, verify, argon2id } from "argon2";

// Argon2id configuration (OWASP recommended)
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 threads
  hashLength: 32, // 32-byte output
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return verify(hash, password);
}
```

---

## Rate Limiting Per Plan

### `rate-limit.ts`

```typescript
import type { Plan } from "@ci/types";

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  burstSize: number;
}

export const RATE_LIMITS: Record<Plan, RateLimitConfig> = {
  free: { requestsPerMinute: 60, requestsPerHour: 1000, burstSize: 10 },
  starter: { requestsPerMinute: 300, requestsPerHour: 10000, burstSize: 50 },
  pro: { requestsPerMinute: 1000, requestsPerHour: 50000, burstSize: 100 },
  enterprise: { requestsPerMinute: 5000, requestsPerHour: 200000, burstSize: 500 },
};

// Per-endpoint rate limits (stricter than global)
export const ENDPOINT_RATE_LIMITS: Record<string, { requestsPerMinute: number }> = {
  "POST /v1/query": { requestsPerMinute: 100 }, // Query is expensive
  "POST /v1/documents/upload": { requestsPerMinute: 30 }, // Upload triggers ingestion
  "POST /v1/connectors/sync": { requestsPerMinute: 10 }, // Sync is very expensive
};
```

---

## Express Auth Middleware

### `apps/api/src/middleware/auth.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { validateApiKey } from "@ci/auth";
import { verifyToken } from "@ci/auth";
import { db } from "@ci/db";
import { tenants } from "@ci/db/schema";
import { eq } from "drizzle-orm";

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError("Missing Authorization header", 401, "UNAUTHORIZED");
  }

  const token = authHeader.slice(7);

  // API key authentication (ci_live_ or ci_test_ prefix)
  if (token.startsWith("ci_")) {
    const { tenantId, keyId, scopes, environment } = await validateApiKey(token);

    // Load tenant
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new AppError("Tenant not found", 401, "TENANT_NOT_FOUND");

    req.tenantId = tenantId;
    req.tenant = tenant;
    req.apiKeyId = keyId;
    req.apiKeyScopes = scopes;
    req.authType = "api-key";
    return next();
  }

  // JWT authentication (dashboard sessions)
  const payload = verifyToken(token);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, payload.tid)).limit(1);
  if (!tenant) throw new AppError("Tenant not found", 401, "TENANT_NOT_FOUND");

  req.tenantId = payload.tid;
  req.tenant = tenant;
  req.userId = payload.sub;
  req.userRole = payload.role;
  req.authType = "jwt";
  next();
}
```

---

## Session Management

- JWT access tokens: 24h expiry (configurable via `JWT_EXPIRY`)
- Refresh tokens: 7 day expiry, stored in HttpOnly SameSite cookie
- Dashboard sessions: access token in memory, refresh token in cookie
- API keys: no expiry by default, optional `expiresAt` field
- Token refresh: POST `/auth/refresh` with refresh token cookie

---

## Testing Requirements

- API key generation produces correct format (`ci_live_*` / `ci_test_*`)
- API key validation succeeds with correct key, fails with incorrect key
- API key validation uses cache on second call (measure time)
- API key rotation creates new key and deletes old key
- Expired API keys are rejected
- JWT issue/verify roundtrip preserves payload
- Expired JWT tokens are rejected
- Invalid JWT tokens are rejected
- Argon2id hash/verify roundtrip works
- RBAC: owner has all scopes, viewer has only read + query
- RBAC: `requireScope` throws for insufficient permissions
- PKCE: code verifier + challenge match per RFC 7636
- OAuth state: encrypt/decrypt roundtrip preserves state
- Rate limit configs: all plans have defined limits

---

## Critical File Paths

| File                              | Purpose                                     |
| --------------------------------- | ------------------------------------------- |
| `packages/auth/src/api-key.ts`    | Key generation, validation, rotation, cache |
| `packages/auth/src/jwt.ts`        | Token issue, verify, refresh                |
| `packages/auth/src/oauth.ts`      | PKCE helpers, OAuth config per connector    |
| `packages/auth/src/rbac.ts`       | Role hierarchy, scope checking              |
| `packages/auth/src/password.ts`   | Argon2id hash/verify                        |
| `packages/auth/src/rate-limit.ts` | Plan-based rate limit configs               |
| `apps/api/src/middleware/auth.ts` | Express middleware integrating all auth     |

---

## Risk Assessment

| Risk                               | Impact   | Mitigation                                         |
| ---------------------------------- | -------- | -------------------------------------------------- |
| API key cache stale after rotation | Medium   | Cache TTL 5 min; rotation clears entire cache      |
| JWT secret compromise              | Critical | Use RS256 in production; secret rotation procedure |
| Argon2id timing attack             | Low      | Library uses constant-time comparison              |
| OAuth state tampering              | Medium   | AES-256-GCM encryption with auth tag verification  |

---

_Related: [Phase 1 Overview](./README.md) | [Database Layer](./03-database-layer.md) | [Error Handling](./05-error-handling.md)_
