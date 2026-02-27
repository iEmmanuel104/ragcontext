import type { ParseResult } from "@contextinject/types";

export interface IParser {
  readonly supportedMimeTypes: string[];
  parse(input: Uint8Array | string, mimeType: string): Promise<ParseResult>;
}
