import { describe, it, expect } from "vitest";
import { generateHmac, verifyHmac } from "./hmac.js";

const SECRET = "test-hmac-secret";

describe("HMAC", () => {
  describe("generateHmac", () => {
    it("produces a hex string", () => {
      const hmac = generateHmac("test data", SECRET);

      expect(hmac).toMatch(/^[0-9a-f]+$/);
      expect(hmac).toHaveLength(64); // SHA-256 produces 32 bytes = 64 hex chars
    });

    it("produces consistent output for same input", () => {
      const hmac1 = generateHmac("hello", SECRET);
      const hmac2 = generateHmac("hello", SECRET);

      expect(hmac1).toBe(hmac2);
    });

    it("produces different output for different data", () => {
      const hmac1 = generateHmac("hello", SECRET);
      const hmac2 = generateHmac("world", SECRET);

      expect(hmac1).not.toBe(hmac2);
    });

    it("produces different output for different secrets", () => {
      const hmac1 = generateHmac("hello", "secret-1");
      const hmac2 = generateHmac("hello", "secret-2");

      expect(hmac1).not.toBe(hmac2);
    });
  });

  describe("verifyHmac", () => {
    it("returns true for valid HMAC", () => {
      const hmac = generateHmac("test data", SECRET);
      expect(verifyHmac("test data", SECRET, hmac)).toBe(true);
    });

    it("returns false for wrong data", () => {
      const hmac = generateHmac("test data", SECRET);
      expect(verifyHmac("wrong data", SECRET, hmac)).toBe(false);
    });

    it("returns false for wrong secret", () => {
      const hmac = generateHmac("test data", SECRET);
      expect(verifyHmac("test data", "wrong-secret", hmac)).toBe(false);
    });

    it("returns false for tampered HMAC", () => {
      const hmac = generateHmac("test data", SECRET);
      const tampered = "00" + hmac.slice(2);
      expect(verifyHmac("test data", SECRET, tampered)).toBe(false);
    });

    it("uses timing-safe comparison (returns false for length mismatch)", () => {
      expect(verifyHmac("test", SECRET, "abc")).toBe(false);
    });
  });
});
