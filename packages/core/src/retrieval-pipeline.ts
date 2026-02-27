import type { QueryRequest, QueryResult, ScoredChunk, QueryMetadata } from "@contextinject/types";
import type { IEmbeddingProvider } from "@contextinject/embeddings";
import type { IVectorStore, VectorSearchResult } from "@contextinject/vector-store";
import { validateQueryFilter } from "./filter-validator.js";
import { assembleContext } from "./context-assembler.js";

export interface RetrievalDependencies {
  embeddingProvider: IEmbeddingProvider;
  vectorStore: IVectorStore;
  collectionName: string;
}

/**
 * Retrieval pipeline: Query -> Embed -> Vector Search -> Assemble Context
 *
 * Enforces filter allowlist validation to prevent injection attacks.
 * Tenant isolation is mandatory — tenantId and projectId are always included.
 */
export async function retrieve(
  request: QueryRequest,
  deps: RetrievalDependencies,
): Promise<QueryResult> {
  const startTime = Date.now();

  // Validate filters (rejects unknown fields)
  if (request.filter) {
    validateQueryFilter(request.filter);
  }

  // Embed the query
  const embeddingResult = await deps.embeddingProvider.embed(request.query);
  const queryVector = embeddingResult.embeddings[0];

  if (!queryVector) {
    throw new Error("Failed to generate embedding for query");
  }

  // Search vectors (tenant isolation enforced by IVectorStore)
  const searchResults = await deps.vectorStore.search(deps.collectionName, {
    tenantId: request.tenantId,
    projectId: request.projectId,
    vector: queryVector,
    topK: request.topK ?? 10,
    scoreThreshold: request.scoreThreshold,
    filter: request.filter
      ? {
          documentIds: request.filter.documentIds,
          metadata: request.filter.metadata,
        }
      : undefined,
  });

  // Map to scored chunks
  const scoredChunks: ScoredChunk[] = searchResults.map((result: VectorSearchResult) => ({
    chunkId: String(result.payload["chunkId"] ?? result.id),
    documentId: String(result.payload["documentId"] ?? ""),
    content: String(result.payload["content"] ?? ""),
    score: result.score,
    metadata: request.includeMetadata ? result.payload : {},
  }));

  const retrievalTimeMs = Date.now() - startTime;

  // Assemble context based on target model
  const context = assembleContext(scoredChunks, request.targetModel ?? "generic");

  const metadata: QueryMetadata = {
    totalChunksSearched: searchResults.length,
    retrievalTimeMs,
    cacheHit: false,
    tokensUsed: embeddingResult.tokensUsed,
  };

  return {
    chunks: scoredChunks,
    context,
    metadata,
  };
}
