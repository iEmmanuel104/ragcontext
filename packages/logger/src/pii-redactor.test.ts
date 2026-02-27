import { describe, it, expect } from "vitest";
import { redactValue, REDACT_PATHS } from "./pii-redactor.js";

describe("PII Redactor", () => {
  describe("redactValue", () => {
    it("redacts sensitive keys entirely", () => {
      expect(redactValue("password", "secret123")).toBe("[REDACTED]");
      expect(redactValue("secret", "my-secret")).toBe("[REDACTED]");
      expect(redactValue("token", "jwt-token")).toBe("[REDACTED]");
      expect(redactValue("apikey", "ci_live_abc")).toBe("[REDACTED]");
      expect(redactValue("api_key", "ci_live_abc")).toBe("[REDACTED]");
      expect(redactValue("authorization", "Bearer xyz")).toBe("[REDACTED]");
      expect(redactValue("cookie", "session=abc")).toBe("[REDACTED]");
      expect(redactValue("ssn", "123-45-6789")).toBe("[REDACTED]");
      expect(redactValue("creditcard", "4111111111111111")).toBe("[REDACTED]");
      expect(redactValue("credit_card", "4111111111111111")).toBe("[REDACTED]");
      expect(redactValue("accesstoken", "access_abc")).toBe("[REDACTED]");
      expect(redactValue("refreshtoken", "refresh_abc")).toBe("[REDACTED]");
      expect(redactValue("encryptionkey", "enc_key")).toBe("[REDACTED]");
    });

    it("is case-insensitive for key matching", () => {
      expect(redactValue("Password", "secret123")).toBe("[REDACTED]");
      expect(redactValue("SECRET", "my-secret")).toBe("[REDACTED]");
      expect(redactValue("ApiKey", "ci_live_abc")).toBe("[REDACTED]");
    });

    it("redacts email addresses in string values", () => {
      const result = redactValue("message", "Contact user@example.com for details");
      expect(result).toBe("Contact [REDACTED] for details");
    });

    it("redacts multiple email addresses", () => {
      const result = redactValue("log", "From a@b.com to c@d.com");
      expect(result).toBe("From [REDACTED] to [REDACTED]");
    });

    it("does not redact non-sensitive keys with non-email values", () => {
      expect(redactValue("username", "john")).toBe("john");
      expect(redactValue("status", "active")).toBe("active");
      expect(redactValue("count", 42)).toBe(42);
    });

    it("does not modify non-string values for non-sensitive keys", () => {
      expect(redactValue("count", 42)).toBe(42);
      expect(redactValue("active", true)).toBe(true);
      expect(redactValue("data", null)).toBe(null);
    });

    it("handles empty string values", () => {
      expect(redactValue("name", "")).toBe("");
    });

    it("handles strings without emails for non-sensitive keys", () => {
      expect(redactValue("message", "Hello world")).toBe("Hello world");
    });
  });

  describe("REDACT_PATHS", () => {
    it("includes all top-level sensitive paths", () => {
      expect(REDACT_PATHS).toContain("password");
      expect(REDACT_PATHS).toContain("secret");
      expect(REDACT_PATHS).toContain("token");
      expect(REDACT_PATHS).toContain("apiKey");
      expect(REDACT_PATHS).toContain("authorization");
      expect(REDACT_PATHS).toContain("cookie");
    });

    it("includes nested sensitive paths", () => {
      expect(REDACT_PATHS).toContain("*.password");
      expect(REDACT_PATHS).toContain("*.secret");
      expect(REDACT_PATHS).toContain("*.token");
      expect(REDACT_PATHS).toContain("*.authorization");
    });

    it("has both top-level and nested for each sensitive key", () => {
      const topLevel = REDACT_PATHS.filter((p) => !p.startsWith("*."));
      const nested = REDACT_PATHS.filter((p) => p.startsWith("*."));

      expect(topLevel.length).toBe(nested.length);
      for (const key of topLevel) {
        expect(REDACT_PATHS).toContain(`*.${key}`);
      }
    });
  });
});
