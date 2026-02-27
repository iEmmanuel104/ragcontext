import type { VectorRecord } from "@contextinject/types";

export interface VectorSearchParams {
  tenantId: string;
  projectId: string;
  vector: number[];
  topK: number;
  scoreThreshold?: number;
  filter?: VectorFilter;
}

export interface VectorFilter {
  documentIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface IVectorStore {
  upsert(collectionName: string, records: VectorRecord[]): Promise<void>;
  search(collectionName: string, params: VectorSearchParams): Promise<VectorSearchResult[]>;
  delete(collectionName: string, ids: string[]): Promise<void>;
  deleteByFilter(
    collectionName: string,
    tenantId: string,
    filter: { documentId?: string; projectId?: string },
  ): Promise<void>;
  ensureCollection(collectionName: string, dimensions: number): Promise<void>;
  healthCheck(): Promise<boolean>;
}
