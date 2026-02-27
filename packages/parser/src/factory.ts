import type { IParser } from "./parser.interface.js";
import { TextParser } from "./text-parser.js";
import { DoclingParser } from "./docling-parser.js";

const textParser = new TextParser();
const doclingParser = new DoclingParser();

const allParsers: IParser[] = [textParser, doclingParser];

/**
 * Select the appropriate parser based on mimeType.
 */
export function getParser(mimeType: string): IParser {
  const parser = allParsers.find((p) => p.supportedMimeTypes.includes(mimeType));

  if (!parser) {
    // Default to text parser for unknown types
    return textParser;
  }

  return parser;
}
