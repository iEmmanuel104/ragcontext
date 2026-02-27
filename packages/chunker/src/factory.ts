import type { ChunkStrategy } from "@contextinject/types";
import type { IChunker } from "./chunker.interface.js";
import { SemanticChunker } from "./semantic-chunker.js";
import { RecursiveChunker } from "./recursive-chunker.js";
import { FixedChunker } from "./fixed-chunker.js";
import { SentenceChunker } from "./sentence-chunker.js";

export function createChunker(strategy: ChunkStrategy): IChunker {
  switch (strategy) {
    case "semantic":
      return new SemanticChunker();
    case "recursive":
      return new RecursiveChunker();
    case "fixed":
      return new FixedChunker();
    case "sentence":
      return new SentenceChunker();
    default:
      throw new Error(`Unknown chunking strategy: ${String(strategy)}`);
  }
}
