import { spawn } from "node:child_process";
import type { ParseResult } from "@contextinject/types";
import type { IParser } from "./parser.interface.js";

const DOCLING_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

interface DoclingResult {
  text: string;
  page_count: number;
  metadata: Record<string, unknown>;
}

/**
 * Python bridge to Docling for PDF/DOCX/PPTX parsing.
 * Spawns a Python child process to leverage Docling's document parsing capabilities.
 */
export class DoclingParser implements IParser {
  readonly supportedMimeTypes = DOCLING_MIME_TYPES;
  private pythonPath: string;
  private scriptPath: string;

  constructor(pythonPath = "python3", scriptPath = "scripts/docling-parse.py") {
    this.pythonPath = pythonPath;
    this.scriptPath = scriptPath;
  }

  async parse(input: Uint8Array | string, mimeType: string): Promise<ParseResult> {
    const inputBuffer = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);

    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, [this.scriptPath, "--mime-type", mimeType]);

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Docling parser exited with code ${String(code)}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout) as DoclingResult;
          resolve({
            text: result.text,
            pageCount: result.page_count,
            metadata: result.metadata,
          });
        } catch {
          reject(new Error(`Failed to parse Docling output: ${stdout}`));
        }
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn Docling process: ${err.message}`));
      });

      // Send input as stdin
      child.stdin.write(inputBuffer);
      child.stdin.end();
    });
  }
}
