import type { ChunkResult, ChunkingPipelineConfig } from "@contextinject/types";
import type { IChunker } from "./chunker.interface.js";

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

/**
 * Recursive splitting with separator hierarchy.
 * Tries larger separators first, falling back to smaller ones.
 */
export class RecursiveChunker implements IChunker {
  readonly strategy = "recursive";
  private separators: string[];

  constructor(separators?: string[]) {
    this.separators = separators ?? DEFAULT_SEPARATORS;
  }

  chunk(content: string, config: ChunkingPipelineConfig): ChunkResult[] {
    const { maxTokens, overlap } = config;
    const results: ChunkResult[] = [];
    const chunks = this.splitRecursive(content, maxTokens, 0);

    let charOffset = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const startChar = content.indexOf(chunk, charOffset);
      const endChar = startChar + chunk.length;

      results.push({
        content: chunk,
        index: i,
        tokenCount: this.estimateTokens(chunk),
        metadata: {
          startChar: startChar >= 0 ? startChar : charOffset,
          endChar: startChar >= 0 ? endChar : charOffset + chunk.length,
        },
      });

      if (startChar >= 0) {
        charOffset = overlap > 0 ? Math.max(charOffset, endChar - overlap * 4) : endChar;
      }
    }

    return results;
  }

  private splitRecursive(text: string, maxTokens: number, separatorIndex: number): string[] {
    if (this.estimateTokens(text) <= maxTokens) {
      return text.trim().length > 0 ? [text.trim()] : [];
    }

    if (separatorIndex >= this.separators.length) {
      // Hard cut at maxTokens * 4 chars
      const maxChars = maxTokens * 4;
      const results: string[] = [];
      for (let i = 0; i < text.length; i += maxChars) {
        const chunk = text.slice(i, i + maxChars).trim();
        if (chunk.length > 0) {
          results.push(chunk);
        }
      }
      return results;
    }

    const separator = this.separators[separatorIndex]!;
    const parts = separator === "" ? [text] : text.split(separator);

    const results: string[] = [];
    let current = "";

    for (const part of parts) {
      const candidate = current.length > 0 ? current + separator + part : part;

      if (this.estimateTokens(candidate) > maxTokens) {
        if (current.trim().length > 0) {
          if (this.estimateTokens(current.trim()) <= maxTokens) {
            results.push(current.trim());
          } else {
            results.push(...this.splitRecursive(current.trim(), maxTokens, separatorIndex + 1));
          }
        }
        current = part;
      } else {
        current = candidate;
      }
    }

    if (current.trim().length > 0) {
      if (this.estimateTokens(current.trim()) <= maxTokens) {
        results.push(current.trim());
      } else {
        results.push(...this.splitRecursive(current.trim(), maxTokens, separatorIndex + 1));
      }
    }

    return results;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
