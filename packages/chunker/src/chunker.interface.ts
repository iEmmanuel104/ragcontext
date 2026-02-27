import type { ChunkResult, ChunkingPipelineConfig } from "@contextinject/types";

export interface IChunker {
  readonly strategy: string;
  chunk(content: string, config: ChunkingPipelineConfig): ChunkResult[];
}
