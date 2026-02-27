import type { EmbeddingResult } from "@contextinject/types";

export interface IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  embed(text: string): Promise<EmbeddingResult>;
  batchEmbed(texts: string[]): Promise<EmbeddingResult>;
  healthCheck(): Promise<boolean>;
}
