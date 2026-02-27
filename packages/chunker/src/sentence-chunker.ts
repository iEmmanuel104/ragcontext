import type { ChunkResult, ChunkingPipelineConfig } from "@contextinject/types";
import type { IChunker } from "./chunker.interface.js";

const SENTENCE_REGEX = /(?<=[.!?])\s+(?=[A-Z])/;

/**
 * Sentence-level splitting chunker.
 * Splits text at sentence boundaries, grouping sentences until the token limit.
 */
export class SentenceChunker implements IChunker {
  readonly strategy = "sentence";

  chunk(content: string, config: ChunkingPipelineConfig): ChunkResult[] {
    const { maxTokens, overlap } = config;
    const results: ChunkResult[] = [];
    const sentences = content.split(SENTENCE_REGEX).filter((s) => s.trim().length > 0);

    let currentChunk = "";
    let chunkStart = 0;
    let index = 0;
    let charOffset = 0;

    for (const sentence of sentences) {
      const candidateTokens = this.estimateTokens(currentChunk + " " + sentence);

      if (candidateTokens > maxTokens && currentChunk.length > 0) {
        results.push({
          content: currentChunk.trim(),
          index,
          tokenCount: this.estimateTokens(currentChunk.trim()),
          metadata: { startChar: chunkStart, endChar: chunkStart + currentChunk.length },
        });
        index++;

        if (overlap > 0) {
          const overlapText = this.getOverlapSentences(currentChunk, overlap);
          chunkStart = chunkStart + currentChunk.length - overlapText.length;
          currentChunk = overlapText + " " + sentence;
        } else {
          chunkStart = charOffset;
          currentChunk = sentence;
        }
      } else {
        currentChunk = currentChunk.length > 0 ? currentChunk + " " + sentence : sentence;
      }

      charOffset += sentence.length + 1;
    }

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
    return Math.ceil(text.length / 4);
  }

  private getOverlapSentences(text: string, overlapTokens: number): string {
    const overlapChars = overlapTokens * 4;
    return text.slice(-overlapChars);
  }
}
