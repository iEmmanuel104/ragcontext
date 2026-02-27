export interface IngestionPipeline {
  parse: (input: PipelineInput) => Promise<ParseResult>;
  chunk: (content: string, config: ChunkingPipelineConfig) => Promise<ChunkResult[]>;
  embed: (chunks: string[]) => Promise<EmbeddingResult>;
  store: (vectors: VectorRecord[]) => Promise<void>;
}

export interface PipelineInput {
  documentId: string;
  tenantId: string;
  projectId: string;
  content: Uint8Array | string;
  mimeType: string;
}

export interface ParseResult {
  text: string;
  pageCount: number;
  metadata: Record<string, unknown>;
}

export interface ChunkingPipelineConfig {
  strategy: "semantic" | "recursive" | "fixed" | "sentence";
  maxTokens: number;
  overlap: number;
}

export interface ChunkResult {
  content: string;
  index: number;
  tokenCount: number;
  metadata: {
    startChar: number;
    endChar: number;
  };
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  tokensUsed: number;
  dimensions: number;
}

export interface VectorRecord {
  id: string;
  tenantId: string;
  projectId: string;
  documentId: string;
  chunkId: string;
  vector: number[];
  payload: Record<string, unknown>;
  isDeleted: boolean;
}
