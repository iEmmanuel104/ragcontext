import { describe, it, expect } from "vitest";
import { getFeatureFlags, isFeatureEnabled, getEffectiveFlags } from "./feature-flags.js";

describe("Feature Flags", () => {
  describe("getFeatureFlags", () => {
    it("returns all-disabled flags for free plan", () => {
      const flags = getFeatureFlags("free");

      expect(flags).toEqual({
        colpali: false,
        crag: false,
        compression: false,
        semanticCache: false,
        bgeM3Embedding: false,
        threeTierMemory: false,
      });
    });

    it("returns compression+cache enabled for pro plan", () => {
      const flags = getFeatureFlags("pro");

      expect(flags.compression).toBe(true);
      expect(flags.semanticCache).toBe(true);
      expect(flags.colpali).toBe(false);
      expect(flags.crag).toBe(false);
    });

    it("returns all-enabled flags for enterprise plan", () => {
      const flags = getFeatureFlags("enterprise");

      expect(Object.values(flags).every(Boolean)).toBe(true);
    });

    it("returns a copy (not a reference to internal state)", () => {
      const flags1 = getFeatureFlags("free");
      flags1.colpali = true;

      const flags2 = getFeatureFlags("free");
      expect(flags2.colpali).toBe(false);
    });
  });

  describe("isFeatureEnabled", () => {
    it("returns false for disabled feature on free plan", () => {
      expect(isFeatureEnabled("free", "compression")).toBe(false);
    });

    it("returns true for enabled feature on pro plan", () => {
      expect(isFeatureEnabled("pro", "compression")).toBe(true);
    });

    it("returns true for all features on enterprise plan", () => {
      expect(isFeatureEnabled("enterprise", "colpali")).toBe(true);
      expect(isFeatureEnabled("enterprise", "crag")).toBe(true);
      expect(isFeatureEnabled("enterprise", "threeTierMemory")).toBe(true);
    });
  });

  describe("getEffectiveFlags", () => {
    it("returns plan defaults when no overrides given", () => {
      const flags = getEffectiveFlags("free");

      expect(flags).toEqual(getFeatureFlags("free"));
    });

    it("returns plan defaults when overrides is undefined", () => {
      const flags = getEffectiveFlags("pro", undefined);

      expect(flags).toEqual(getFeatureFlags("pro"));
    });

    it("applies overrides to enable a feature", () => {
      const flags = getEffectiveFlags("free", { colpali: true });

      expect(flags.colpali).toBe(true);
      expect(flags.crag).toBe(false); // unchanged
    });

    it("applies overrides to disable a feature", () => {
      const flags = getEffectiveFlags("enterprise", { colpali: false });

      expect(flags.colpali).toBe(false);
      expect(flags.crag).toBe(true); // unchanged
    });

    it("merges multiple overrides", () => {
      const flags = getEffectiveFlags("free", {
        colpali: true,
        crag: true,
        compression: true,
      });

      expect(flags.colpali).toBe(true);
      expect(flags.crag).toBe(true);
      expect(flags.compression).toBe(true);
      expect(flags.semanticCache).toBe(false); // unchanged
    });
  });
});
