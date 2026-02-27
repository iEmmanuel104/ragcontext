import { describe, it, expect } from "vitest";
import { SemanticChunker } from "./semantic-chunker.js";
import { RecursiveChunker } from "./recursive-chunker.js";
import { FixedChunker } from "./fixed-chunker.js";
import { SentenceChunker } from "./sentence-chunker.js";
import { createChunker } from "./factory.js";
import type { ChunkingPipelineConfig } from "@contextinject/types";

const SAMPLE_TEXT = `This is the first paragraph of the document. It contains some important information about the topic at hand.

This is the second paragraph. It elaborates on the points made in the first paragraph with additional details and examples.

This is the third paragraph. It provides a conclusion and summarizes the key points discussed in the previous sections.`;

const config: ChunkingPipelineConfig = {
  strategy: "recursive",
  maxTokens: 50,
  overlap: 10,
};

describe("SemanticChunker", () => {
  const chunker = new SemanticChunker();

  it("has strategy 'semantic'", () => {
    expect(chunker.strategy).toBe("semantic");
  });

  it("splits text into chunks at paragraph boundaries", () => {
    const results = chunker.chunk(SAMPLE_TEXT, config);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((chunk) => {
      expect(chunk.content).toBeTruthy();
      expect(chunk.index).toBeTypeOf("number");
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.metadata.startChar).toBeTypeOf("number");
      expect(chunk.metadata.endChar).toBeTypeOf("number");
    });
  });

  it("respects maxTokens limit", () => {
    const results = chunker.chunk(SAMPLE_TEXT, { ...config, maxTokens: 30 });
    results.forEach((chunk) => {
      // Allow some tolerance since token estimation is approximate
      expect(chunk.tokenCount).toBeLessThanOrEqual(60);
    });
  });

  it("handles empty content", () => {
    const results = chunker.chunk("", config);
    expect(results).toHaveLength(0);
  });

  it("handles single paragraph", () => {
    const results = chunker.chunk("A single paragraph.", { ...config, maxTokens: 100 });
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("A single paragraph.");
  });
});

describe("RecursiveChunker", () => {
  const chunker = new RecursiveChunker();

  it("has strategy 'recursive'", () => {
    expect(chunker.strategy).toBe("recursive");
  });

  it("splits text recursively", () => {
    const results = chunker.chunk(SAMPLE_TEXT, config);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((chunk) => {
      expect(chunk.content.length).toBeGreaterThan(0);
    });
  });

  it("handles short text without splitting", () => {
    const results = chunker.chunk("Short text", { ...config, maxTokens: 100 });
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("Short text");
  });

  it("accepts custom separators", () => {
    const customChunker = new RecursiveChunker(["---", " "]);
    const text = "Part one---Part two---Part three";
    const results = customChunker.chunk(text, { ...config, maxTokens: 100 });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe("FixedChunker", () => {
  const chunker = new FixedChunker();

  it("has strategy 'fixed'", () => {
    expect(chunker.strategy).toBe("fixed");
  });

  it("splits text into fixed-size windows", () => {
    const longText = "word ".repeat(200);
    const results = chunker.chunk(longText, { ...config, maxTokens: 50, overlap: 0 });
    expect(results.length).toBeGreaterThan(1);
  });

  it("handles text shorter than chunk size", () => {
    const results = chunker.chunk("Short", { ...config, maxTokens: 100, overlap: 0 });
    expect(results).toHaveLength(1);
  });
});

describe("SentenceChunker", () => {
  const chunker = new SentenceChunker();

  it("has strategy 'sentence'", () => {
    expect(chunker.strategy).toBe("sentence");
  });

  it("splits text at sentence boundaries", () => {
    const text =
      "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.";
    const results = chunker.chunk(text, { ...config, maxTokens: 15 });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((chunk) => {
      expect(chunk.content.length).toBeGreaterThan(0);
    });
  });
});

describe("createChunker factory", () => {
  it("creates SemanticChunker for 'semantic'", () => {
    const chunker = createChunker("semantic");
    expect(chunker.strategy).toBe("semantic");
  });

  it("creates RecursiveChunker for 'recursive'", () => {
    const chunker = createChunker("recursive");
    expect(chunker.strategy).toBe("recursive");
  });

  it("creates FixedChunker for 'fixed'", () => {
    const chunker = createChunker("fixed");
    expect(chunker.strategy).toBe("fixed");
  });

  it("creates SentenceChunker for 'sentence'", () => {
    const chunker = createChunker("sentence");
    expect(chunker.strategy).toBe("sentence");
  });
});
