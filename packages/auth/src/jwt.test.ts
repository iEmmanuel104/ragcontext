import { describe, it, expect } from "vitest";
import { generateToken, verifyToken, decodeToken } from "./jwt.js";
import type { JwtConfig } from "./jwt.js";

const config: JwtConfig = {
  secret: "test-secret-that-is-long-enough-for-signing",
  expirySeconds: 3600,
};

describe("JWT", () => {
  describe("generateToken", () => {
    it("generates a valid JWT string", () => {
      const token = generateToken(
        { sub: "key-1", tenantId: "tenant-1", scopes: ["query:read"] },
        config,
      );

      expect(token).toBeTruthy();
      expect(token.split(".")).toHaveLength(3); // header.payload.signature
    });
  });

  describe("verifyToken", () => {
    it("verifies and decodes a valid token", () => {
      const token = generateToken(
        { sub: "key-1", tenantId: "tenant-1", scopes: ["query:read", "documents:read"] },
        config,
      );

      const payload = verifyToken(token, config.secret);

      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe("key-1");
      expect(payload!.tenantId).toBe("tenant-1");
      expect(payload!.scopes).toEqual(["query:read", "documents:read"]);
      expect(payload!.iat).toBeTypeOf("number");
      expect(payload!.exp).toBeTypeOf("number");
    });

    it("returns null for invalid token", () => {
      const result = verifyToken("invalid.token.string", config.secret);
      expect(result).toBeNull();
    });

    it("returns null for token signed with wrong secret", () => {
      const token = generateToken(
        { sub: "key-1", tenantId: "tenant-1", scopes: ["query:read"] },
        config,
      );

      const result = verifyToken(token, "wrong-secret");
      expect(result).toBeNull();
    });

    it("returns null for expired token", () => {
      const shortConfig: JwtConfig = { secret: config.secret, expirySeconds: 0 };
      const token = generateToken(
        { sub: "key-1", tenantId: "tenant-1", scopes: ["query:read"] },
        shortConfig,
      );

      // Token with 0 expiry should be expired immediately
      const result = verifyToken(token, config.secret);
      expect(result).toBeNull();
    });
  });

  describe("decodeToken", () => {
    it("decodes token without verification", () => {
      const token = generateToken(
        { sub: "key-1", tenantId: "tenant-1", scopes: ["query:read"] },
        config,
      );

      const payload = decodeToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe("key-1");
      expect(payload!.tenantId).toBe("tenant-1");
    });

    it("decodes token even with wrong secret (no verification)", () => {
      const token = generateToken(
        { sub: "key-1", tenantId: "tenant-1", scopes: ["admin"] },
        config,
      );

      // decodeToken doesn't verify signature
      const payload = decodeToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.scopes).toEqual(["admin"]);
    });

    it("returns null for malformed input", () => {
      const result = decodeToken("not-a-jwt");
      expect(result).toBeNull();
    });
  });
});
