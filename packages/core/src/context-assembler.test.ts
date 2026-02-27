import { describe, it, expect } from "vitest";
import { assembleContext } from "./context-assembler.js";
import type { ScoredChunk } from "@contextinject/types";

const CHUNKS: ScoredChunk[] = [
  {
    chunkId: "chunk-1",
    documentId: "doc-1",
    content: "First chunk content.",
    score: 0.95,
    metadata: {},
  },
  {
    chunkId: "chunk-2",
    documentId: "doc-2",
    content: "Second chunk content.",
    score: 0.85,
    metadata: {},
  },
];

describe("assembleContext", () => {
  it("returns empty string for no chunks", () => {
    expect(assembleContext([], "generic")).toBe("");
  });

  describe("Claude (XML format)", () => {
    it("wraps chunks in XML tags", () => {
      const result = assembleContext(CHUNKS, "claude");

      expect(result).toContain("<context>");
      expect(result).toContain("</context>");
      expect(result).toContain('<document index="1" source="doc-1">');
      expect(result).toContain('<document index="2" source="doc-2">');
      expect(result).toContain("First chunk content.");
      expect(result).toContain("Second chunk content.");
    });
  });

  describe("GPT (Markdown format)", () => {
    it("formats chunks as markdown", () => {
      const result = assembleContext(CHUNKS, "gpt");

      expect(result).toContain("## Retrieved Context");
      expect(result).toContain("### Source 1 (doc-1)");
      expect(result).toContain("### Source 2 (doc-2)");
      expect(result).toContain("---");
      expect(result).toContain("First chunk content.");
    });
  });

  describe("Gemini (Plain format)", () => {
    it("formats chunks as numbered sections", () => {
      const result = assembleContext(CHUNKS, "gemini");

      expect(result).toContain("[1] (Source: doc-1)");
      expect(result).toContain("[2] (Source: doc-2)");
      expect(result).toContain("First chunk content.");
    });
  });

  describe("Generic (Plain format)", () => {
    it("uses plain format for generic model", () => {
      const result = assembleContext(CHUNKS, "generic");

      expect(result).toContain("[1] (Source: doc-1)");
      expect(result).toContain("First chunk content.");
    });
  });
});
