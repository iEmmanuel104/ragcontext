import { describe, it, expect } from "vitest";
import { createVectorStore } from "./index.js";

describe("Vector Store", () => {
  describe("createVectorStore factory", () => {
    it("creates QdrantVectorStore for type 'qdrant'", () => {
      const store = createVectorStore({
        type: "qdrant",
        qdrantUrl: "http://localhost:6333",
      });
      expect(store).toBeDefined();
      expect(store.search).toBeTypeOf("function");
      expect(store.upsert).toBeTypeOf("function");
      expect(store.delete).toBeTypeOf("function");
    });

    it("creates PgVectorStore for type 'pgvector'", () => {
      const store = createVectorStore({
        type: "pgvector",
        pgConnectionString: "postgresql://localhost:5432/test",
      });
      expect(store).toBeDefined();
      expect(store.search).toBeTypeOf("function");
    });

    it("throws for missing qdrantUrl", () => {
      expect(() => createVectorStore({ type: "qdrant" })).toThrow("qdrantUrl is required");
    });

    it("throws for missing pgConnectionString", () => {
      expect(() => createVectorStore({ type: "pgvector" })).toThrow(
        "pgConnectionString is required",
      );
    });

    it("throws for unknown type", () => {
      expect(() => createVectorStore({ type: "unknown" as "qdrant" })).toThrow(
        "Unknown vector store type",
      );
    });
  });

  describe("Tenant isolation enforcement", () => {
    it("QdrantVectorStore.search rejects without tenantId", async () => {
      const store = createVectorStore({
        type: "qdrant",
        qdrantUrl: "http://localhost:6333",
      });

      await expect(
        store.search("test-collection", {
          tenantId: "",
          projectId: "proj-1",
          vector: [0.1, 0.2],
          topK: 10,
        }),
      ).rejects.toThrow("tenantId and projectId are required");
    });

    it("QdrantVectorStore.search rejects without projectId", async () => {
      const store = createVectorStore({
        type: "qdrant",
        qdrantUrl: "http://localhost:6333",
      });

      await expect(
        store.search("test-collection", {
          tenantId: "tenant-1",
          projectId: "",
          vector: [0.1, 0.2],
          topK: 10,
        }),
      ).rejects.toThrow("tenantId and projectId are required");
    });

    it("PgVectorStore.search rejects without tenantId", async () => {
      const store = createVectorStore({
        type: "pgvector",
        pgConnectionString: "postgresql://localhost:5432/test",
      });

      await expect(
        store.search("test-collection", {
          tenantId: "",
          projectId: "proj-1",
          vector: [0.1, 0.2],
          topK: 10,
        }),
      ).rejects.toThrow("tenantId and projectId are required");
    });
  });
});
