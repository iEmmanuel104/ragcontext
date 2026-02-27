import { describe, it, expect } from "vitest";
import type { AuthContext } from "@contextinject/types";
import { hasScope, hasAllScopes, hasAnyScope } from "./rbac.js";

function makeContext(scopes: AuthContext["scopes"]): AuthContext {
  return {
    tenantId: "tenant-1",
    apiKeyId: "key-1",
    scopes,
    plan: "pro",
  };
}

describe("RBAC", () => {
  describe("hasScope", () => {
    it("returns true when context has the required scope", () => {
      const ctx = makeContext(["query:read", "documents:read"]);
      expect(hasScope(ctx, "query:read")).toBe(true);
    });

    it("returns false when context lacks the required scope", () => {
      const ctx = makeContext(["query:read"]);
      expect(hasScope(ctx, "documents:write")).toBe(false);
    });

    it("returns true for any scope when context has admin", () => {
      const ctx = makeContext(["admin"]);
      expect(hasScope(ctx, "query:read")).toBe(true);
      expect(hasScope(ctx, "documents:write")).toBe(true);
      expect(hasScope(ctx, "documents:delete")).toBe(true);
      expect(hasScope(ctx, "connectors:write")).toBe(true);
    });
  });

  describe("hasAllScopes", () => {
    it("returns true when context has all required scopes", () => {
      const ctx = makeContext(["query:read", "documents:read", "documents:write"]);
      expect(hasAllScopes(ctx, ["query:read", "documents:read"])).toBe(true);
    });

    it("returns false when context is missing any required scope", () => {
      const ctx = makeContext(["query:read"]);
      expect(hasAllScopes(ctx, ["query:read", "documents:write"])).toBe(false);
    });

    it("returns true for empty required scopes", () => {
      const ctx = makeContext(["query:read"]);
      expect(hasAllScopes(ctx, [])).toBe(true);
    });

    it("returns true for admin with any required scopes", () => {
      const ctx = makeContext(["admin"]);
      expect(hasAllScopes(ctx, ["query:read", "documents:write", "connectors:read"])).toBe(true);
    });
  });

  describe("hasAnyScope", () => {
    it("returns true when context has at least one required scope", () => {
      const ctx = makeContext(["query:read"]);
      expect(hasAnyScope(ctx, ["query:read", "documents:write"])).toBe(true);
    });

    it("returns false when context has none of the required scopes", () => {
      const ctx = makeContext(["query:read"]);
      expect(hasAnyScope(ctx, ["documents:write", "connectors:read"])).toBe(false);
    });

    it("returns false for empty required scopes", () => {
      const ctx = makeContext(["query:read"]);
      expect(hasAnyScope(ctx, [])).toBe(false);
    });

    it("returns true for admin with any required scopes", () => {
      const ctx = makeContext(["admin"]);
      expect(hasAnyScope(ctx, ["documents:write"])).toBe(true);
    });
  });
});
