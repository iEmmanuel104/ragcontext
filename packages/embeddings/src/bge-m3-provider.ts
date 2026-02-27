import type { EmbeddingResult } from "@contextinject/types";
import type { IEmbeddingProvider } from "./embedding-provider.interface.js";

const DEFAULT_DIMENSIONS = 1024;

export interface BgeM3ProviderConfig {
  baseUrl: string;
  dimensions?: number;
}

interface BgeM3Response {
  embeddings: number[][];
  tokens_used: number;
}

/**
 * BGE-M3 self-hosted embedding provider.
 * Communicates with a BGE-M3 model server via HTTP.
 * Used as a cost-effective fallback when Cohere is unavailable or for cost-sensitive tenants.
 */
export class BgeM3EmbeddingProvider implements IEmbeddingProvider {
  readonly name = "bge-m3";
  readonly dimensions: number;
  private baseUrl: string;

  constructor(config: BgeM3ProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return this.batchEmbed([text]);
  }

  async batchEmbed(texts: string[]): Promise<EmbeddingResult> {
    const response = await fetch(`${this.baseUrl}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, dimensions: this.dimensions }),
    });

    if (!response.ok) {
      throw new Error(`BGE-M3 embedding failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as BgeM3Response;

    return {
      embeddings: data.embeddings,
      model: "bge-m3",
      tokensUsed: data.tokens_used,
      dimensions: this.dimensions,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
