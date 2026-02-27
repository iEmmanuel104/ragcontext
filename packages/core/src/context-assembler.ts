import type { ScoredChunk, TargetModel } from "@contextinject/types";

/**
 * Model-agnostic context formatting.
 * Assembles retrieved chunks into a format optimized for the target model.
 *
 * - XML (Claude): Uses XML tags for structured context
 * - Markdown (GPT): Uses markdown formatting
 * - Plain (Gemini/Generic): Simple numbered sections
 */
export function assembleContext(chunks: ScoredChunk[], targetModel: TargetModel): string {
  if (chunks.length === 0) return "";

  switch (targetModel) {
    case "claude":
      return assembleXml(chunks);
    case "gpt":
      return assembleMarkdown(chunks);
    case "gemini":
    case "generic":
    default:
      return assemblePlain(chunks);
  }
}

function assembleXml(chunks: ScoredChunk[]): string {
  const parts = chunks.map(
    (chunk, i) =>
      `<document index="${String(i + 1)}" source="${chunk.documentId}">\n${chunk.content}\n</document>`,
  );

  return `<context>\n${parts.join("\n")}\n</context>`;
}

function assembleMarkdown(chunks: ScoredChunk[]): string {
  const parts = chunks.map(
    (chunk, i) => `### Source ${String(i + 1)} (${chunk.documentId})\n\n${chunk.content}`,
  );

  return `## Retrieved Context\n\n${parts.join("\n\n---\n\n")}`;
}

function assemblePlain(chunks: ScoredChunk[]): string {
  const parts = chunks.map(
    (chunk, i) => `[${String(i + 1)}] (Source: ${chunk.documentId})\n${chunk.content}`,
  );

  return parts.join("\n\n");
}
