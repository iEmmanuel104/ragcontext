import { describe, it, expect } from "vitest";
import { createEmbeddingProvider } from "./factory.js";

describe("Embeddings", () => {
  describe("createEmbeddingProvider factory", () => {
    it("creates CohereEmbeddingProvider for type 'cohere'", () => {
      const provider = createEmbeddingProvider({
        provider: "cohere",
        cohere: { apiKey: "test-key" },
      });
      expect(provider).toBeDefined();
      expect(provider.name).toBe("cohere");
      expect(provider.dimensions).toBe(1024);
      expect(provider.embed).toBeTypeOf("function");
      expect(provider.batchEmbed).toBeTypeOf("function");
    });

    it("creates BgeM3EmbeddingProvider for type 'bge-m3'", () => {
      const provider = createEmbeddingProvider({
        provider: "bge-m3",
        bgeM3: { baseUrl: "http://localhost:8080" },
      });
      expect(provider).toBeDefined();
      expect(provider.name).toBe("bge-m3");
      expect(provider.dimensions).toBe(1024);
    });

    it("respects custom dimensions for Cohere", () => {
      const provider = createEmbeddingProvider({
        provider: "cohere",
        cohere: { apiKey: "test-key", dimensions: 256 },
      });
      expect(provider.dimensions).toBe(256);
    });

    it("respects custom dimensions for BGE-M3", () => {
      const provider = createEmbeddingProvider({
        provider: "bge-m3",
        bgeM3: { baseUrl: "http://localhost:8080", dimensions: 768 },
      });
      expect(provider.dimensions).toBe(768);
    });

    it("throws for missing cohere config", () => {
      expect(() => createEmbeddingProvider({ provider: "cohere" })).toThrow(
        "Cohere config is required",
      );
    });

    it("throws for missing bge-m3 config", () => {
      expect(() => createEmbeddingProvider({ provider: "bge-m3" })).toThrow(
        "BGE-M3 config is required",
      );
    });

    it("throws for unknown provider", () => {
      expect(() => createEmbeddingProvider({ provider: "unknown" as "cohere" })).toThrow(
        "Unknown embedding provider",
      );
    });
  });
});
