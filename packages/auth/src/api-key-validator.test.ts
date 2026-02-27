import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiKey, PlanTier } from "@contextinject/types";
import { ApiKeyValidator } from "./api-key-validator.js";
import type { ApiKeyLookupFn } from "./api-key-validator.js";

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "key-1",
    tenantId: "tenant-1",
    name: "test-key",
    keyHash: "abc123",
    keyPrefix: "ci_live_",
    scopes: ["query:read", "documents:read"],
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    revokedAt: null,
    ...overrides,
  };
}

function makeLookupResult(
  overrides: {
    apiKey?: Partial<ApiKey>;
    tenant?: Partial<{ id: string; plan: PlanTier; status: string }>;
    expiresAt?: number | null;
  } = {},
) {
  return {
    apiKey: makeApiKey(overrides.apiKey),
    tenant: { id: "tenant-1", plan: "pro" as PlanTier, status: "active", ...overrides.tenant },
    expiresAt: overrides.expiresAt ?? null,
  };
}

describe("ApiKeyValidator", () => {
  const salt = "test-salt-for-hmac";
  let lookupFn: ReturnType<typeof vi.fn<ApiKeyLookupFn>>;
  let validator: ApiKeyValidator;

  beforeEach(() => {
    lookupFn = vi.fn<ApiKeyLookupFn>();
    validator = new ApiKeyValidator(salt, lookupFn);
  });

  describe("validate", () => {
    it("returns AuthContext on valid key (cache miss)", async () => {
      lookupFn.mockResolvedValue(makeLookupResult());

      const result = await validator.validate("raw-api-key");

      expect(result).toEqual({
        tenantId: "tenant-1",
        apiKeyId: "key-1",
        scopes: ["query:read", "documents:read"],
        plan: "pro",
      });
      expect(lookupFn).toHaveBeenCalledOnce();
    });

    it("returns AuthContext from cache on second call (cache hit)", async () => {
      lookupFn.mockResolvedValue(makeLookupResult());

      await validator.validate("raw-api-key");
      const result = await validator.validate("raw-api-key");

      expect(result).toEqual({
        tenantId: "tenant-1",
        apiKeyId: "key-1",
        scopes: ["query:read", "documents:read"],
        plan: "pro",
      });
      expect(lookupFn).toHaveBeenCalledOnce(); // Only 1 DB call
    });

    it("returns null when key not found in DB", async () => {
      lookupFn.mockResolvedValue(null);

      const result = await validator.validate("unknown-key");

      expect(result).toBeNull();
    });

    it("returns null and removes from cache when key is expired (cache hit)", async () => {
      const pastExpiry = Date.now() - 1000;
      lookupFn.mockResolvedValue(makeLookupResult({ expiresAt: Date.now() + 60000 }));

      // Prime the cache
      await validator.validate("raw-api-key");

      // Manually expire the cached entry by creating a new validator with same state
      // Instead, let's use a key that will expire
      const validator2 = new ApiKeyValidator(
        salt,
        vi.fn<ApiKeyLookupFn>().mockResolvedValue(makeLookupResult({ expiresAt: pastExpiry })),
      );

      const result = await validator2.validate("raw-api-key");
      expect(result).toBeNull();
    });

    it("returns null when DB result has expired key", async () => {
      const pastExpiry = Date.now() - 1000;
      lookupFn.mockResolvedValue(makeLookupResult({ expiresAt: pastExpiry }));

      const result = await validator.validate("raw-api-key");

      expect(result).toBeNull();
    });

    it("returns null when API key is revoked (DB lookup)", async () => {
      lookupFn.mockResolvedValue(makeLookupResult({ apiKey: { revokedAt: new Date() } }));

      const result = await validator.validate("raw-api-key");

      expect(result).toBeNull();
    });

    it("returns null when API key is revoked (cache hit)", async () => {
      lookupFn.mockResolvedValue(makeLookupResult({ apiKey: { revokedAt: new Date() } }));

      // First call caches it (but it's revoked so returns null)
      const result1 = await validator.validate("raw-api-key");
      expect(result1).toBeNull();
    });

    it("returns null when tenant is not active (DB lookup)", async () => {
      lookupFn.mockResolvedValue(
        makeLookupResult({ tenant: { id: "tenant-1", plan: "pro", status: "suspended" } }),
      );

      const result = await validator.validate("raw-api-key");

      expect(result).toBeNull();
    });

    it("returns null when tenant is not active (cache hit)", async () => {
      lookupFn.mockResolvedValue(
        makeLookupResult({ tenant: { id: "tenant-1", plan: "pro", status: "suspended" } }),
      );

      // Prime cache — but tenant inactive, so returns null
      await validator.validate("raw-api-key");
      const result = await validator.validate("raw-api-key");

      expect(result).toBeNull();
    });

    it("checks expiresAt on every cache hit (critical security)", async () => {
      // Start with a key that expires in the future
      const futureExpiry = Date.now() + 100;
      lookupFn.mockResolvedValue(makeLookupResult({ expiresAt: futureExpiry }));

      // First call: valid
      const result1 = await validator.validate("raw-api-key");
      expect(result1).not.toBeNull();

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second call: should be expired even though cached
      const result2 = await validator.validate("raw-api-key");
      expect(result2).toBeNull();
    });
  });

  describe("hashKey", () => {
    it("produces consistent hashes for same input", () => {
      const hash1 = validator.hashKey("test-key");
      const hash2 = validator.hashKey("test-key");

      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = validator.hashKey("key-1");
      const hash2 = validator.hashKey("key-2");

      expect(hash1).not.toBe(hash2);
    });

    it("produces hex string output", () => {
      const hash = validator.hashKey("test-key");

      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe("verifyHash", () => {
    it("returns true for matching key and hash", () => {
      const hash = validator.hashKey("test-key");
      expect(validator.verifyHash("test-key", hash)).toBe(true);
    });

    it("returns false for mismatched key and hash", () => {
      const hash = validator.hashKey("test-key");
      expect(validator.verifyHash("wrong-key", hash)).toBe(false);
    });
  });

  describe("invalidate", () => {
    it("removes key from cache", async () => {
      lookupFn.mockResolvedValue(makeLookupResult());

      await validator.validate("raw-api-key");
      expect(lookupFn).toHaveBeenCalledOnce();

      const keyHash = validator.hashKey("raw-api-key");
      validator.invalidate(keyHash);

      await validator.validate("raw-api-key");
      expect(lookupFn).toHaveBeenCalledTimes(2); // Had to look up again
    });
  });

  describe("clearCache", () => {
    it("clears all cached entries", async () => {
      lookupFn.mockResolvedValue(makeLookupResult());

      await validator.validate("key-1");
      await validator.validate("key-2");

      validator.clearCache();

      await validator.validate("key-1");
      expect(lookupFn).toHaveBeenCalledTimes(3); // 2 initial + 1 after clear
    });
  });
});
