import { describe, it, expect } from "vitest";
import { deriveKey, generateSalt, generateApiKey } from "./key-derivation.js";

describe("Key Derivation", () => {
  describe("deriveKey", () => {
    it("produces a hex string", async () => {
      const key = await deriveKey("password", "salt");

      expect(key).toMatch(/^[0-9a-f]+$/);
      expect(key).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    it("produces consistent output for same inputs", async () => {
      const key1 = await deriveKey("password", "salt");
      const key2 = await deriveKey("password", "salt");

      expect(key1).toBe(key2);
    });

    it("produces different output for different passwords", async () => {
      const key1 = await deriveKey("password1", "salt");
      const key2 = await deriveKey("password2", "salt");

      expect(key1).not.toBe(key2);
    });

    it("produces different output for different salts", async () => {
      const key1 = await deriveKey("password", "salt1");
      const key2 = await deriveKey("password", "salt2");

      expect(key1).not.toBe(key2);
    });

    it("respects custom iterations", async () => {
      const key1 = await deriveKey("password", "salt", 1);
      const key2 = await deriveKey("password", "salt", 2);

      expect(key1).not.toBe(key2);
    });
  });

  describe("generateSalt", () => {
    it("produces a hex string of default length", () => {
      const salt = generateSalt();

      expect(salt).toMatch(/^[0-9a-f]+$/);
      expect(salt).toHaveLength(64); // 32 bytes default = 64 hex chars
    });

    it("produces unique salts", () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      expect(salt1).not.toBe(salt2);
    });

    it("respects custom length", () => {
      const salt = generateSalt(16);

      expect(salt).toMatch(/^[0-9a-f]+$/);
      expect(salt).toHaveLength(32); // 16 bytes = 32 hex chars
    });
  });

  describe("generateApiKey", () => {
    it("returns key with ci_live_ prefix", () => {
      const { key } = generateApiKey();

      expect(key).toMatch(/^ci_live_[0-9a-f]{32}$/);
    });

    it("returns prefix of 8 characters", () => {
      const { prefix } = generateApiKey();

      expect(prefix).toHaveLength(8);
    });

    it("prefix matches first 8 chars of key", () => {
      const { key, prefix } = generateApiKey();

      expect(key.startsWith(prefix)).toBe(true);
    });

    it("produces unique keys", () => {
      const { key: key1 } = generateApiKey();
      const { key: key2 } = generateApiKey();

      expect(key1).not.toBe(key2);
    });
  });
});
