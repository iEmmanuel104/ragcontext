import { CohereClient } from "cohere-ai";
import type { EmbeddingResult } from "@contextinject/types";
import type { IEmbeddingProvider } from "./embedding-provider.interface.js";

const DEFAULT_MODEL = "embed-v4.0";
const DEFAULT_DIMENSIONS = 1024;
const BATCH_SIZE = 96; // Cohere limit

export interface CohereProviderConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
}

export class CohereEmbeddingProvider implements IEmbeddingProvider {
  readonly name = "cohere";
  readonly dimensions: number;
  private client: CohereClient;
  private model: string;

  constructor(config: CohereProviderConfig) {
    this.client = new CohereClient({ token: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return this.batchEmbed([text]);
  }

  async batchEmbed(texts: string[]): Promise<EmbeddingResult> {
    const allEmbeddings: number[][] = [];
    let totalTokens = 0;

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      const response = await this.client.v2.embed({
        texts: batch,
        model: this.model,
        inputType: "search_document",
        embeddingTypes: ["float"],
      });

      if (response.embeddings.float) {
        allEmbeddings.push(...response.embeddings.float);
      }

      // Use actual tokensUsed from Cohere response for billing accuracy
      if (response.meta?.billedUnits?.inputTokens) {
        totalTokens += response.meta.billedUnits.inputTokens;
      }
    }

    return {
      embeddings: allEmbeddings,
      model: this.model,
      tokensUsed: totalTokens,
      dimensions: this.dimensions,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.embed("health check");
      return true;
    } catch {
      return false;
    }
  }
}
