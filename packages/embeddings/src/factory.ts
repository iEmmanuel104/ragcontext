import type { IEmbeddingProvider } from "./embedding-provider.interface.js";
import { CohereEmbeddingProvider } from "./cohere-provider.js";
import type { CohereProviderConfig } from "./cohere-provider.js";
import { BgeM3EmbeddingProvider } from "./bge-m3-provider.js";
import type { BgeM3ProviderConfig } from "./bge-m3-provider.js";

export type EmbeddingProviderType = "cohere" | "bge-m3";

export interface EmbeddingFactoryConfig {
  provider: EmbeddingProviderType;
  cohere?: CohereProviderConfig;
  bgeM3?: BgeM3ProviderConfig;
}

export function createEmbeddingProvider(config: EmbeddingFactoryConfig): IEmbeddingProvider {
  switch (config.provider) {
    case "cohere":
      if (!config.cohere) {
        throw new Error("Cohere config is required when provider is 'cohere'");
      }
      return new CohereEmbeddingProvider(config.cohere);
    case "bge-m3":
      if (!config.bgeM3) {
        throw new Error("BGE-M3 config is required when provider is 'bge-m3'");
      }
      return new BgeM3EmbeddingProvider(config.bgeM3);
    default:
      throw new Error(`Unknown embedding provider: ${String(config.provider)}`);
  }
}
