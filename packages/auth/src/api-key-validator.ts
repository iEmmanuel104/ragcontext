import { createHmac, timingSafeEqual } from "node:crypto";
import { LRUCache } from "lru-cache";
import type { ApiKey, AuthContext, PlanTier } from "@contextinject/types";

interface ApiKeyLookupResult {
  apiKey: ApiKey;
  tenant: { id: string; plan: PlanTier; status: string };
  expiresAt: number | null;
}

interface CachedApiKey extends ApiKeyLookupResult {
  cachedAt: number;
}

export interface ApiKeyLookupFn {
  (keyHash: string): Promise<ApiKeyLookupResult | null>;
}

const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class ApiKeyValidator {
  private cache: LRUCache<string, CachedApiKey>;
  private salt: string;
  private lookupFn: ApiKeyLookupFn;

  constructor(salt: string, lookupFn: ApiKeyLookupFn) {
    this.salt = salt;
    this.lookupFn = lookupFn;
    this.cache = new LRUCache<string, CachedApiKey>({
      max: CACHE_MAX_SIZE,
      ttl: CACHE_TTL_MS,
    });
  }

  async validate(rawKey: string): Promise<AuthContext | null> {
    const keyHash = this.hashKey(rawKey);

    // Check cache first
    const cached = this.cache.get(keyHash);
    if (cached) {
      // CRITICAL: Always check expiresAt even on cache hit
      if (cached.expiresAt && cached.expiresAt < Date.now()) {
        this.cache.delete(keyHash);
        return null;
      }

      if (cached.apiKey.revokedAt) {
        this.cache.delete(keyHash);
        return null;
      }

      if (cached.tenant.status !== "active") {
        return null;
      }

      return {
        tenantId: cached.tenant.id,
        apiKeyId: cached.apiKey.id,
        scopes: cached.apiKey.scopes,
        plan: cached.tenant.plan,
      };
    }

    // Cache miss — look up from DB
    const result = await this.lookupFn(keyHash);
    if (!result) {
      return null;
    }

    // Check expiration before caching
    if (result.expiresAt && result.expiresAt < Date.now()) {
      return null;
    }

    if (result.apiKey.revokedAt) {
      return null;
    }

    // Cache the result
    this.cache.set(keyHash, {
      ...result,
      cachedAt: Date.now(),
    });

    if (result.tenant.status !== "active") {
      return null;
    }

    return {
      tenantId: result.tenant.id,
      apiKeyId: result.apiKey.id,
      scopes: result.apiKey.scopes,
      plan: result.tenant.plan,
    };
  }

  hashKey(rawKey: string): string {
    return createHmac("sha256", this.salt).update(rawKey).digest("hex");
  }

  verifyHash(rawKey: string, expectedHash: string): boolean {
    const computed = Buffer.from(this.hashKey(rawKey), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  }

  invalidate(keyHash: string): void {
    this.cache.delete(keyHash);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
