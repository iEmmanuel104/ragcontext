import type { ChunkResult, ChunkingPipelineConfig } from "@contextinject/types";
import type { IChunker } from "./chunker.interface.js";

/**
 * Fixed token-count windows chunker.
 * Splits text into chunks of approximately equal token count.
 */
export class FixedChunker implements IChunker {
  readonly strategy = "fixed";

  chunk(content: string, config: ChunkingPipelineConfig): ChunkResult[] {
    const { maxTokens, overlap } = config;
    const results: ChunkResult[] = [];
    const charsPerChunk = maxTokens * 4; // ~4 chars per token
    const overlapChars = overlap * 4;

    let startChar = 0;
    let index = 0;

    while (startChar < content.length) {
      const endChar = Math.min(startChar + charsPerChunk, content.length);
      const chunk = content.slice(startChar, endChar).trim();

      if (chunk.length > 0) {
        results.push({
          content: chunk,
          index,
          tokenCount: this.estimateTokens(chunk),
          metadata: { startChar, endChar },
        });
        index++;
      }

      startChar = endChar - overlapChars;
      if (startChar >= content.length || endChar === content.length) break;
    }

    return results;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
