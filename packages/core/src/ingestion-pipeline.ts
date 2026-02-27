import type {
  PipelineInput,
  ParseResult,
  ChunkResult,
  EmbeddingResult,
  VectorRecord,
} from "@contextinject/types";
import type { IParser } from "@contextinject/parser";
import type { IChunker } from "@contextinject/chunker";
import type { IEmbeddingProvider } from "@contextinject/embeddings";
import type { IVectorStore } from "@contextinject/vector-store";
import { randomUUID } from "node:crypto";

export interface IngestionDependencies {
  parser: IParser;
  chunker: IChunker;
  embeddingProvider: IEmbeddingProvider;
  vectorStore: IVectorStore;
  collectionName: string;
  onParsed?: (result: ParseResult) => Promise<void>;
  onChunked?: (results: ChunkResult[]) => Promise<void>;
  onEmbedded?: (result: EmbeddingResult) => Promise<void>;
  onStored?: () => Promise<void>;
}

export interface IngestionResult {
  documentId: string;
  chunkCount: number;
  tokensUsed: number;
  embeddingDimensions: number;
}

/**
 * Ingestion pipeline: Parse -> Chunk -> Embed -> Store
 *
 * Implements two-phase commit: vectors are initially stored with isDeleted=true.
 * The caller (job processor) is responsible for flipping isDeleted to false
 * after the Postgres transaction commits successfully.
 */
export async function ingest(
  input: PipelineInput,
  deps: IngestionDependencies,
): Promise<IngestionResult> {
  // Phase 1: Parse
  const parseResult = await deps.parser.parse(input.content, input.mimeType);
  if (deps.onParsed) await deps.onParsed(parseResult);

  // Phase 2: Chunk
  const chunks = deps.chunker.chunk(parseResult.text, {
    strategy: "recursive",
    maxTokens: 512,
    overlap: 50,
  });
  if (deps.onChunked) await deps.onChunked(chunks);

  if (chunks.length === 0) {
    return {
      documentId: input.documentId,
      chunkCount: 0,
      tokensUsed: 0,
      embeddingDimensions: deps.embeddingProvider.dimensions,
    };
  }

  // Phase 3: Embed
  const embeddingResult = await deps.embeddingProvider.batchEmbed(chunks.map((c) => c.content));
  if (deps.onEmbedded) await deps.onEmbedded(embeddingResult);

  // Phase 4: Store with isDeleted=true (two-phase commit)
  const vectorRecords: VectorRecord[] = chunks.map((chunk, i) => ({
    id: randomUUID(),
    tenantId: input.tenantId,
    projectId: input.projectId,
    documentId: input.documentId,
    chunkId: randomUUID(),
    vector: embeddingResult.embeddings[i]!,
    payload: {
      content: chunk.content,
      index: chunk.index,
      tokenCount: chunk.tokenCount,
      ...chunk.metadata,
    },
    isDeleted: true, // Two-phase commit: marked deleted until Postgres tx commits
  }));

  await deps.vectorStore.upsert(deps.collectionName, vectorRecords);
  if (deps.onStored) await deps.onStored();

  return {
    documentId: input.documentId,
    chunkCount: chunks.length,
    tokensUsed: embeddingResult.tokensUsed,
    embeddingDimensions: embeddingResult.dimensions,
  };
}
