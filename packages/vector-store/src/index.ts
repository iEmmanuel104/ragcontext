import type { IVectorStore } from "./vector-store.interface.js";
import { QdrantVectorStore } from "./qdrant-adapter.js";
import { PgVectorStore } from "./pgvector-adapter.js";

export type {
  IVectorStore,
  VectorSearchParams,
  VectorSearchResult,
  VectorFilter,
} from "./vector-store.interface.js";
export { QdrantVectorStore } from "./qdrant-adapter.js";
export { PgVectorStore } from "./pgvector-adapter.js";

export type VectorStoreType = "qdrant" | "pgvector";

export interface VectorStoreConfig {
  type: VectorStoreType;
  qdrantUrl?: string;
  qdrantApiKey?: string;
  pgConnectionString?: string;
}

export function createVectorStore(config: VectorStoreConfig): IVectorStore {
  switch (config.type) {
    case "qdrant":
      if (!config.qdrantUrl) {
        throw new Error("qdrantUrl is required for Qdrant vector store");
      }
      return new QdrantVectorStore(config.qdrantUrl, config.qdrantApiKey);
    case "pgvector":
      if (!config.pgConnectionString) {
        throw new Error("pgConnectionString is required for pgvector store");
      }
      return new PgVectorStore(config.pgConnectionString);
    default:
      throw new Error(`Unknown vector store type: ${String(config.type)}`);
  }
}
