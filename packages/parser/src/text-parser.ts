import type { ParseResult } from "@contextinject/types";
import type { IParser } from "./parser.interface.js";

const TEXT_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/xml",
];

/**
 * Plain text and markdown parser.
 * Handles text-based formats directly without external dependencies.
 */
export class TextParser implements IParser {
  readonly supportedMimeTypes = TEXT_MIME_TYPES;

  async parse(input: Uint8Array | string, mimeType: string): Promise<ParseResult> {
    const text = typeof input === "string" ? input : new TextDecoder().decode(input);

    // Strip HTML tags for HTML content
    const cleanedText = mimeType === "text/html" ? this.stripHtml(text) : text;

    // Estimate page count (roughly 3000 chars per page)
    const pageCount = Math.max(1, Math.ceil(cleanedText.length / 3000));

    return {
      text: cleanedText,
      pageCount,
      metadata: {
        mimeType,
        charCount: cleanedText.length,
        wordCount: cleanedText.split(/\s+/).filter((w) => w.length > 0).length,
      },
    };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
