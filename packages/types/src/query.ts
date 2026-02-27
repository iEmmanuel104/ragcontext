export type TargetModel = "claude" | "gpt" | "gemini" | "generic";

export interface QueryRequest {
  tenantId: string;
  projectId: string;
  query: string;
  topK?: number;
  scoreThreshold?: number;
  filter?: QueryFilter;
  rerank?: boolean;
  compress?: boolean;
  targetModel?: TargetModel;
  includeMetadata?: boolean;
  sessionId?: string;
}

export interface QueryFilter {
  documentIds?: string[];
  metadata?: Record<string, unknown>;
}

// Allowed filter fields for SQL injection prevention
export const QUERY_FILTER_ALLOWLIST = ["documentIds", "metadata"] as const;

export interface QueryResult {
  chunks: ScoredChunk[];
  context: string;
  metadata: QueryMetadata;
}

export interface ScoredChunk {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  rerankScore?: number;
  metadata: Record<string, unknown>;
}

export interface QueryMetadata {
  totalChunksSearched: number;
  retrievalTimeMs: number;
  rerankTimeMs?: number;
  compressionRatio?: number;
  cacheHit: boolean;
  qualityScore?: QualityScore;
  tokensUsed: number;
}

export interface QualityScore {
  relevance: number;
  completeness: number;
  coherence: number;
  groundedness: number;
  composite: number;
}
