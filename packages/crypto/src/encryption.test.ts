import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./encryption.js";

// AES-256 requires exactly 32 bytes
const VALID_KEY = "abcdefghijklmnopqrstuvwxyz012345"; // 32 ASCII chars = 32 bytes

describe("Encryption", () => {
  describe("encrypt", () => {
    it("returns EncryptedData with iv, ciphertext, tag, keyId", () => {
      const result = encrypt("hello world", VALID_KEY);

      expect(result).toHaveProperty("iv");
      expect(result).toHaveProperty("ciphertext");
      expect(result).toHaveProperty("tag");
      expect(result).toHaveProperty("keyId");
      expect(result.iv).toMatch(/^[0-9a-f]+$/);
      expect(result.ciphertext).toMatch(/^[0-9a-f]+$/);
      expect(result.tag).toMatch(/^[0-9a-f]+$/);
      expect(result.keyId).toHaveLength(16);
    });

    it("produces different ciphertexts for same plaintext (random IV)", () => {
      const result1 = encrypt("hello", VALID_KEY);
      const result2 = encrypt("hello", VALID_KEY);

      expect(result1.ciphertext).not.toBe(result2.ciphertext);
      expect(result1.iv).not.toBe(result2.iv);
    });

    it("produces consistent keyId for same key", () => {
      const result1 = encrypt("hello", VALID_KEY);
      const result2 = encrypt("world", VALID_KEY);

      expect(result1.keyId).toBe(result2.keyId);
    });
  });

  describe("decrypt", () => {
    it("roundtrips correctly", () => {
      const plaintext = "hello world, this is a secret message!";
      const encrypted = encrypt(plaintext, VALID_KEY);
      const decrypted = decrypt(encrypted, VALID_KEY);

      expect(decrypted).toBe(plaintext);
    });

    it("handles empty string", () => {
      const encrypted = encrypt("", VALID_KEY);
      const decrypted = decrypt(encrypted, VALID_KEY);

      expect(decrypted).toBe("");
    });

    it("handles unicode content", () => {
      const plaintext = "Hello \u{1F30E} Unicode \u00E9\u00E0\u00FC\u00F1";
      const encrypted = encrypt(plaintext, VALID_KEY);
      const decrypted = decrypt(encrypted, VALID_KEY);

      expect(decrypted).toBe(plaintext);
    });

    it("handles long content", () => {
      const plaintext = "x".repeat(10000);
      const encrypted = encrypt(plaintext, VALID_KEY);
      const decrypted = decrypt(encrypted, VALID_KEY);

      expect(decrypted).toBe(plaintext);
    });

    it("fails with wrong key", () => {
      const encrypted = encrypt("secret", VALID_KEY);
      const wrongKey = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });

    it("fails with tampered ciphertext", () => {
      const encrypted = encrypt("secret", VALID_KEY);
      encrypted.ciphertext = "00" + encrypted.ciphertext.slice(2);

      expect(() => decrypt(encrypted, VALID_KEY)).toThrow();
    });

    it("fails with tampered tag", () => {
      const encrypted = encrypt("secret", VALID_KEY);
      encrypted.tag = "00".repeat(16);

      expect(() => decrypt(encrypted, VALID_KEY)).toThrow();
    });
  });

  describe("key validation", () => {
    it("throws for key that is too short", () => {
      expect(() => encrypt("hello", "short-key")).toThrow(/Key must be exactly 32 bytes/);
    });

    it("throws for key that is too long", () => {
      expect(() => encrypt("hello", "a".repeat(33))).toThrow(/Key must be exactly 32 bytes/);
    });
  });
});
