import type { VectorRecord } from "@contextinject/types";
import type {
  IVectorStore,
  VectorSearchParams,
  VectorSearchResult,
} from "./vector-store.interface.js";

/**
 * pgvector fallback implementation.
 * Uses PostgreSQL with the pgvector extension for vector similarity search.
 * This is a simplified fallback when Qdrant is unavailable.
 */
export class PgVectorStore implements IVectorStore {
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async upsert(_collectionName: string, _records: VectorRecord[]): Promise<void> {
    // TODO: Implement using Drizzle ORM pgvector operations
    throw new Error("PgVectorStore.upsert not yet implemented");
  }

  async search(_collectionName: string, params: VectorSearchParams): Promise<VectorSearchResult[]> {
    // CRITICAL: Always enforce tenant isolation
    if (!params.tenantId || !params.projectId) {
      throw new Error("tenantId and projectId are required for vector search");
    }

    // TODO: Implement using Drizzle ORM pgvector cosine distance
    throw new Error("PgVectorStore.search not yet implemented");
  }

  async delete(_collectionName: string, _ids: string[]): Promise<void> {
    throw new Error("PgVectorStore.delete not yet implemented");
  }

  async deleteByFilter(
    _collectionName: string,
    _tenantId: string,
    _filter: { documentId?: string; projectId?: string },
  ): Promise<void> {
    throw new Error("PgVectorStore.deleteByFilter not yet implemented");
  }

  async ensureCollection(_collectionName: string, _dimensions: number): Promise<void> {
    // pgvector uses tables, not collections — schema is managed by Drizzle migrations
  }

  async healthCheck(): Promise<boolean> {
    // TODO: Check PostgreSQL connection
    return !!this.connectionString;
  }
}
