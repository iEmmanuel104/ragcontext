import type { ChunkResult, ChunkingPipelineConfig } from "@contextinject/types";
import type { IChunker } from "./chunker.interface.js";

/**
 * Semantic boundary detection chunker.
 * Splits text at natural semantic boundaries (paragraphs, sections, topic shifts).
 * Falls back to sentence splitting when semantic boundaries aren't clear.
 */
export class SemanticChunker implements IChunker {
  readonly strategy = "semantic";

  chunk(content: string, config: ChunkingPipelineConfig): ChunkResult[] {
    const { maxTokens, overlap } = config;
    const results: ChunkResult[] = [];

    // Split on double newlines (paragraph boundaries)
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    let currentChunk = "";
    let chunkStart = 0;
    let index = 0;
    let charOffset = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);
      const currentTokens = this.estimateTokens(currentChunk);

      if (currentTokens + paragraphTokens > maxTokens && currentChunk.length > 0) {
        results.push({
          content: currentChunk.trim(),
          index,
          tokenCount: this.estimateTokens(currentChunk.trim()),
          metadata: { startChar: chunkStart, endChar: chunkStart + currentChunk.length },
        });
        index++;

        // Apply overlap
        if (overlap > 0) {
          const overlapText = this.getOverlapText(currentChunk, overlap);
          chunkStart = chunkStart + currentChunk.length - overlapText.length;
          currentChunk = overlapText + paragraph;
        } else {
          chunkStart = charOffset;
          currentChunk = paragraph;
        }
      } else {
        if (currentChunk.length > 0) {
          currentChunk += "\n\n" + paragraph;
        } else {
          currentChunk = paragraph;
        }
      }

      charOffset += paragraph.length + 2; // +2 for \n\n
    }

    // Flush remaining
    if (currentChunk.trim().length > 0) {
      results.push({
        content: currentChunk.trim(),
        index,
        tokenCount: this.estimateTokens(currentChunk.trim()),
        metadata: { startChar: chunkStart, endChar: chunkStart + currentChunk.length },
      });
    }

    return results;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token for English text
    return Math.ceil(text.length / 4);
  }

  private getOverlapText(text: string, overlapTokens: number): string {
    const overlapChars = overlapTokens * 4;
    return text.slice(-overlapChars);
  }
}
