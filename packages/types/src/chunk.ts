export type ChunkStrategy = "semantic" | "recursive" | "fixed" | "sentence";

export interface Chunk {
  id: string;
  documentId: string;
  tenantId: string;
  projectId: string;
  content: string;
  index: number;
  tokenCount: number;
  strategy: ChunkStrategy;
  metadata: ChunkMetadata;
  embedding: number[] | null;
  createdAt: Date;
}

export interface ChunkMetadata {
  pageNumber?: number;
  sectionTitle?: string;
  startChar: number;
  endChar: number;
  overlap: number;
}

export interface ChunkingConfig {
  strategy: ChunkStrategy;
  maxTokens: number;
  overlap: number;
  separators?: string[];
}
