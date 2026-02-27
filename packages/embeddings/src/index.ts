export type { IEmbeddingProvider } from "./embedding-provider.interface.js";
export { CohereEmbeddingProvider } from "./cohere-provider.js";
export type { CohereProviderConfig } from "./cohere-provider.js";
export { BgeM3EmbeddingProvider } from "./bge-m3-provider.js";
export type { BgeM3ProviderConfig } from "./bge-m3-provider.js";
export { createEmbeddingProvider } from "./factory.js";
export type { EmbeddingFactoryConfig, EmbeddingProviderType } from "./factory.js";
