import { QdrantClient } from "@qdrant/js-client-rest";
import type { VectorRecord } from "@contextinject/types";
import type {
  IVectorStore,
  VectorSearchParams,
  VectorSearchResult,
} from "./vector-store.interface.js";

const BATCH_SIZE = 100;

export class QdrantVectorStore implements IVectorStore {
  private client: QdrantClient;

  constructor(url: string, apiKey?: string) {
    this.client = new QdrantClient({ url, apiKey });
  }

  async upsert(collectionName: string, records: VectorRecord[]): Promise<void> {
    // Process in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      await this.client.upsert(collectionName, {
        points: batch.map((r) => ({
          id: r.id,
          vector: r.vector,
          payload: {
            tenantId: r.tenantId,
            projectId: r.projectId,
            documentId: r.documentId,
            chunkId: r.chunkId,
            isDeleted: r.isDeleted,
            ...r.payload,
          },
        })),
      });
    }
  }

  async search(collectionName: string, params: VectorSearchParams): Promise<VectorSearchResult[]> {
    // CRITICAL: Always enforce tenant isolation
    if (!params.tenantId || !params.projectId) {
      throw new Error("tenantId and projectId are required for vector search");
    }

    const must: Array<Record<string, unknown>> = [
      { key: "tenantId", match: { value: params.tenantId } },
      { key: "projectId", match: { value: params.projectId } },
      { key: "isDeleted", match: { value: false } },
    ];

    if (params.filter?.documentIds && params.filter.documentIds.length > 0) {
      must.push({
        key: "documentId",
        match: { any: params.filter.documentIds },
      });
    }

    const results = await this.client.search(collectionName, {
      vector: params.vector,
      limit: params.topK,
      score_threshold: params.scoreThreshold,
      filter: { must },
      with_payload: true,
    });

    return results.map((r) => ({
      id: typeof r.id === "string" ? r.id : String(r.id),
      score: r.score,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }

  async delete(collectionName: string, ids: string[]): Promise<void> {
    await this.client.delete(collectionName, {
      points: ids,
    });
  }

  async deleteByFilter(
    collectionName: string,
    tenantId: string,
    filter: { documentId?: string; projectId?: string },
  ): Promise<void> {
    const must: Array<Record<string, unknown>> = [{ key: "tenantId", match: { value: tenantId } }];

    if (filter.documentId) {
      must.push({ key: "documentId", match: { value: filter.documentId } });
    }
    if (filter.projectId) {
      must.push({ key: "projectId", match: { value: filter.projectId } });
    }

    await this.client.delete(collectionName, {
      filter: { must },
    });
  }

  async ensureCollection(collectionName: string, dimensions: number): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === collectionName);

    if (!exists) {
      await this.client.createCollection(collectionName, {
        vectors: {
          size: dimensions,
          distance: "Cosine",
        },
        optimizers_config: {
          indexing_threshold: 20000,
        },
      });

      // Create payload indexes for filtering
      await this.client.createPayloadIndex(collectionName, {
        field_name: "tenantId",
        field_schema: "keyword",
      });
      await this.client.createPayloadIndex(collectionName, {
        field_name: "projectId",
        field_schema: "keyword",
      });
      await this.client.createPayloadIndex(collectionName, {
        field_name: "documentId",
        field_schema: "keyword",
      });
      await this.client.createPayloadIndex(collectionName, {
        field_name: "isDeleted",
        field_schema: "bool",
      });
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }
}
