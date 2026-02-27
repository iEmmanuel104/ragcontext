# Phase 2.03: Chunking & Parsing

> `@ci/chunker` — Multi-strategy document chunking. `@ci/parser` — Docling adapter for document parsing.

---

## Objectives

1. Implement four chunking strategies: semantic, recursive, sentence, fixed-size
2. Build Docling adapter for PDF, DOCX, HTML, PPTX, and image parsing
3. Extract metadata: page numbers, section titles, heading paths
4. Handle chunk overlap for context continuity
5. Merge tiny chunks to avoid low-quality fragments

## Deliverables

- `packages/chunker/src/semantic.ts` — Embedding-boundary semantic chunking
- `packages/chunker/src/recursive.ts` — Recursive character splitting
- `packages/chunker/src/sentence.ts` — Sentence-boundary splitting
- `packages/chunker/src/fixed.ts` — Fixed-size token chunks
- `packages/chunker/src/factory.ts` — Strategy selector
- `packages/parser/src/index.ts` — IDocumentParser interface
- `packages/parser/src/docling.ts` — Docling adapter

---

## `@ci/chunker` Package

### Package Structure

```
packages/chunker/
├── src/
│   ├── index.ts           # Re-exports + IChunker interface
│   ├── semantic.ts        # Semantic chunking (primary)
│   ├── recursive.ts       # Recursive character splitting
│   ├── sentence.ts        # Sentence-boundary splitting
│   ├── fixed.ts           # Fixed-size token chunks
│   └── factory.ts         # createChunker(strategy) factory
├── tests/
│   ├── semantic.test.ts
│   ├── recursive.test.ts
│   └── integration.test.ts
├── package.json
└── tsconfig.json
```

### IChunker Interface

```typescript
// packages/chunker/src/index.ts

export interface ChunkOutput {
  content: string;
  tokenCount: number;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  metadata: ChunkOutputMetadata;
}

export interface ChunkOutputMetadata {
  pageNumber?: number;
  sectionTitle?: string;
  headingPath?: string[];
  [key: string]: unknown;
}

export interface IChunker {
  chunk(text: string, metadata?: Record<string, unknown>): ChunkOutput[];
}

export interface ChunkerConfig {
  maxTokens: number; // Target chunk size (default: 512)
  overlapTokens: number; // Overlap between chunks (default: 50)
  minTokens: number; // Minimum chunk size before merging (default: 100)
}
```

### Chunk Size Guidance

| Document Type           | Recommended Chunk Size | Overlap       | Strategy     |
| ----------------------- | ---------------------- | ------------- | ------------ |
| Technical documentation | 512 tokens             | 50 tokens     | Semantic     |
| Legal contracts         | 400 tokens             | 75 tokens     | Sentence     |
| Knowledge base articles | 600 tokens             | 50 tokens     | Recursive    |
| Code documentation      | 300 tokens             | 30 tokens     | Recursive    |
| Conversational data     | 800 tokens             | 100 tokens    | Fixed        |
| **Default**             | **512 tokens**         | **50 tokens** | **Semantic** |

### Semantic Chunker

The primary chunking strategy. Splits on semantic boundaries using sentence detection, then groups sentences into chunks respecting token limits.

```typescript
// packages/chunker/src/semantic.ts
import { encode } from "gpt-tokenizer";
import type { IChunker, ChunkOutput, ChunkerConfig, ChunkOutputMetadata } from "./index.js";

export class SemanticChunker implements IChunker {
  private config: Required<ChunkerConfig>;

  constructor(config: Partial<ChunkerConfig> = {}) {
    this.config = {
      maxTokens: config.maxTokens ?? 512,
      overlapTokens: config.overlapTokens ?? 50,
      minTokens: config.minTokens ?? 100,
    };
  }

  chunk(text: string, metadata: Record<string, unknown> = {}): ChunkOutput[] {
    const sentences = this.splitIntoSentences(text);
    const chunks: ChunkOutput[] = [];
    let currentSentences: string[] = [];
    let currentTokens = 0;
    let charOffset = 0;
    let chunkStartOffset = 0;
    let chunkIndex = 0;

    for (const sentence of sentences) {
      const sentenceTokens = encode(sentence).length;

      if (currentTokens + sentenceTokens > this.config.maxTokens && currentSentences.length > 0) {
        // Flush current chunk
        const chunkText = currentSentences.join(" ");
        const tokenCount = encode(chunkText).length;

        if (tokenCount >= this.config.minTokens) {
          chunks.push({
            content: chunkText,
            tokenCount,
            chunkIndex,
            startOffset: chunkStartOffset,
            endOffset: charOffset,
            metadata: this.extractMetadata(chunkText, metadata),
          });
          chunkIndex++;
        }

        // Overlap: keep last N sentences that fit within overlap budget
        const overlapSentences = this.getOverlapSentences(currentSentences);
        currentSentences = overlapSentences;
        currentTokens = encode(currentSentences.join(" ")).length;
        chunkStartOffset = charOffset - currentSentences.join(" ").length;
      }

      currentSentences.push(sentence);
      currentTokens += sentenceTokens;
      charOffset += sentence.length + 1;
    }

    // Flush remaining
    if (currentSentences.length > 0) {
      const chunkText = currentSentences.join(" ");
      chunks.push({
        content: chunkText,
        tokenCount: encode(chunkText).length,
        chunkIndex,
        startOffset: chunkStartOffset,
        endOffset: charOffset,
        metadata: this.extractMetadata(chunkText, metadata),
      });
    }

    return this.mergeTinyChunks(chunks);
  }

  private splitIntoSentences(text: string): string[] {
    // Regex handles: periods, exclamation, question marks
    // Avoids splitting on: abbreviations (Mr., Dr.), decimals (3.14), URLs
    return text
      .split(/(?<=[.!?])\s+(?=[A-Z\u00C0-\u024F"])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
  }

  private getOverlapSentences(sentences: string[]): string[] {
    const result: string[] = [];
    let tokens = 0;
    for (let i = sentences.length - 1; i >= 0; i--) {
      const t = encode(sentences[i]).length;
      if (tokens + t > this.config.overlapTokens) break;
      result.unshift(sentences[i]);
      tokens += t;
    }
    return result;
  }

  private mergeTinyChunks(chunks: ChunkOutput[]): ChunkOutput[] {
    return chunks.reduce<ChunkOutput[]>((acc, chunk) => {
      if (chunk.tokenCount < this.config.minTokens && acc.length > 0) {
        const prev = acc[acc.length - 1];
        acc[acc.length - 1] = {
          ...prev,
          content: prev.content + " " + chunk.content,
          tokenCount: prev.tokenCount + chunk.tokenCount,
          endOffset: chunk.endOffset,
        };
      } else {
        acc.push(chunk);
      }
      return acc;
    }, []);
  }

  private extractMetadata(text: string, base: Record<string, unknown>): ChunkOutputMetadata {
    const firstLine = text.split("\n")[0];
    const headingMatch = firstLine?.match(/^#{1,6}\s+(.+)/);

    return {
      ...base,
      ...(headingMatch && { sectionTitle: headingMatch[1] }),
    } as ChunkOutputMetadata;
  }
}
```

### Recursive Chunker

Splits by heading hierarchy first, then paragraphs, then sentences:

```typescript
// packages/chunker/src/recursive.ts

export class RecursiveChunker implements IChunker {
  private separators = [
    "\n## ", // H2 headings
    "\n### ", // H3 headings
    "\n#### ", // H4 headings
    "\n\n", // Paragraphs
    "\n", // Lines
    ". ", // Sentences
    " ", // Words (last resort)
  ];

  // Splits text using the first separator that produces chunks within limit,
  // then recursively splits any over-sized chunks with the next separator.
  chunk(text: string, metadata: Record<string, unknown> = {}): ChunkOutput[] {
    return this.recursiveSplit(text, 0, metadata);
  }

  private recursiveSplit(
    text: string,
    separatorIndex: number,
    metadata: Record<string, unknown>,
  ): ChunkOutput[] {
    // Implementation: split by current separator, check sizes,
    // recursively split oversized pieces with next separator
    // Merge undersized pieces with adjacent chunks
    // ...
  }
}
```

### Strategy Factory

```typescript
// packages/chunker/src/factory.ts
import type { IChunker, ChunkerConfig } from "./index.js";
import { SemanticChunker } from "./semantic.js";
import { RecursiveChunker } from "./recursive.js";
import { SentenceChunker } from "./sentence.js";
import { FixedChunker } from "./fixed.js";

export function createChunker(
  strategy: "semantic" | "recursive" | "sentence" | "fixed",
  config?: Partial<ChunkerConfig>,
): IChunker {
  switch (strategy) {
    case "semantic":
      return new SemanticChunker(config);
    case "recursive":
      return new RecursiveChunker(config);
    case "sentence":
      return new SentenceChunker(config);
    case "fixed":
      return new FixedChunker(config);
  }
}
```

---

## `@ci/parser` Package -- Docling Adapter

### Why Docling Over LlamaParse

| Feature        | Docling                               | LlamaParse              |
| -------------- | ------------------------------------- | ----------------------- |
| License        | **MIT** (LF AI Foundation)            | Proprietary             |
| Status         | Actively maintained                   | **Deprecated May 2026** |
| Table accuracy | **97.9%**                             | ~95%                    |
| Self-hosted    | Yes                                   | No (API only)           |
| Cost           | Free (compute only)                   | $0.003/page             |
| Formats        | PDF, DOCX, HTML, PPTX, images         | PDF, DOCX, HTML         |
| Foundation     | LF AI Foundation project              | LlamaIndex commercial   |
| OCR quality    | Excellent (Tesseract + custom models) | Excellent (agentic OCR) |

Docling was chosen because:

1. MIT license ensures no vendor lock-in
2. LF AI Foundation backing guarantees long-term maintenance
3. LlamaParse is being deprecated in May 2026
4. 97.9% table accuracy matches or exceeds all alternatives
5. Self-hosted means no per-page API costs

### Package Structure

```
packages/parser/
├── src/
│   ├── index.ts           # IDocumentParser interface
│   ├── docling.ts         # Docling adapter
│   └── text.ts            # Plain text fallback parser
├── tests/
│   └── docling.test.ts
├── package.json
└── tsconfig.json
```

### IDocumentParser Interface

```typescript
// packages/parser/src/index.ts

export interface ParsedDocument {
  text: string; // Extracted text content (markdown format)
  pages: ParsedPage[]; // Per-page content
  metadata: ParsedDocumentMetadata;
}

export interface ParsedPage {
  pageNumber: number;
  text: string;
  tables?: ParsedTable[];
  images?: ParsedImage[];
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  caption?: string;
  pageNumber: number;
}

export interface ParsedImage {
  caption?: string;
  altText?: string;
  pageNumber: number;
  base64?: string; // For multimodal embedding
}

export interface ParsedDocumentMetadata {
  title?: string;
  author?: string;
  pageCount: number;
  wordCount: number;
  language?: string;
  headings: string[]; // All headings extracted
  createdAt?: Date;
  modifiedAt?: Date;
}

export interface IDocumentParser {
  parse(content: Buffer, mimeType: string): Promise<ParsedDocument>;
  supportedTypes(): string[];
}
```

### Docling Adapter

```typescript
// packages/parser/src/docling.ts
import { logger } from "@ci/logger";
import type { IDocumentParser, ParsedDocument } from "./index.js";

// Docling runs as a Python service or via CLI
// Node.js communicates via HTTP API or subprocess
export class DoclingParser implements IDocumentParser {
  private serviceUrl: string;

  constructor(serviceUrl: string = "http://localhost:8080") {
    this.serviceUrl = serviceUrl;
  }

  async parse(content: Buffer, mimeType: string): Promise<ParsedDocument> {
    if (!this.supportedTypes().includes(mimeType)) {
      throw new Error("Unsupported mime type: " + mimeType);
    }

    const formData = new FormData();
    formData.append("file", new Blob([content], { type: mimeType }), "document");

    const response = await fetch(this.serviceUrl + "/parse", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error("Docling parsing failed: " + response.status + " " + text);
    }

    const result = await response.json();

    return {
      text: result.text,
      pages: result.pages.map((page: any) => ({
        pageNumber: page.page_number,
        text: page.text,
        tables: page.tables?.map((t: any) => ({
          headers: t.headers,
          rows: t.rows,
          caption: t.caption,
          pageNumber: page.page_number,
        })),
        images: page.images?.map((img: any) => ({
          caption: img.caption,
          altText: img.alt_text,
          pageNumber: page.page_number,
        })),
      })),
      metadata: {
        title: result.metadata?.title,
        author: result.metadata?.author,
        pageCount: result.metadata?.page_count ?? result.pages.length,
        wordCount: result.text.split(/\s+/).length,
        language: result.metadata?.language,
        headings: this.extractHeadings(result.text),
        createdAt: result.metadata?.created_at ? new Date(result.metadata.created_at) : undefined,
        modifiedAt: result.metadata?.modified_at
          ? new Date(result.metadata.modified_at)
          : undefined,
      },
    };
  }

  supportedTypes(): string[] {
    return [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
      "application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
      "text/html",
      "image/png",
      "image/jpeg",
    ];
  }

  private extractHeadings(text: string): string[] {
    const headingRegex = /^#{1,6}\s+(.+)$/gm;
    const headings: string[] = [];
    let match;
    while ((match = headingRegex.exec(text)) !== null) {
      headings.push(match[1]);
    }
    return headings;
  }
}
```

### Plain Text Fallback Parser

For simple text formats (TXT, Markdown) that do not need Docling:

```typescript
// packages/parser/src/text.ts

export class TextParser implements IDocumentParser {
  async parse(content: Buffer, _mimeType: string): Promise<ParsedDocument> {
    const text = content.toString("utf-8");
    return {
      text,
      pages: [{ pageNumber: 1, text }],
      metadata: {
        pageCount: 1,
        wordCount: text.split(/\s+/).length,
        headings: this.extractHeadings(text),
      },
    };
  }

  supportedTypes(): string[] {
    return ["text/plain", "text/markdown", "text/csv"];
  }

  private extractHeadings(text: string): string[] {
    const headingRegex = /^#{1,6}\s+(.+)$/gm;
    const headings: string[] = [];
    let match;
    while ((match = headingRegex.exec(text)) !== null) {
      headings.push(match[1]);
    }
    return headings;
  }
}
```

---

## Metadata Extraction

During chunking, the following metadata is extracted and attached to each chunk:

| Metadata Field              | Source                         | Usage                 |
| --------------------------- | ------------------------------ | --------------------- |
| `pageNumber`                | Docling page boundaries        | Citation display      |
| `sectionTitle`              | Nearest heading above chunk    | Context display       |
| `headingPath`               | Heading hierarchy (breadcrumb) | Navigation, filtering |
| `startOffset` / `endOffset` | Character positions in source  | Source highlighting   |
| `language`                  | Docling language detection     | Multilingual routing  |

### Heading Path Extraction

```typescript
// Extract hierarchical heading breadcrumb
function extractHeadingPath(text: string, offset: number): string[] {
  const lines = text.slice(0, offset).split("\n");
  const path: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      // Trim path to current level
      while (path.length >= level) path.pop();
      path.push(match[2]);
    }
  }

  return path;
}
// Result: ["Chapter 1", "Section 2", "Subsection A"]
```

---

## Testing Requirements

### `@ci/chunker`

- Semantic chunker: 1000-word text produces 2-4 chunks of ~512 tokens
- Semantic chunker: overlap contains last sentences from previous chunk
- Semantic chunker: chunks below `minTokens` merge with previous
- Recursive chunker: respects heading boundaries
- Sentence chunker: never splits mid-sentence
- Fixed chunker: all chunks within 5% of target size
- All strategies: `chunkIndex` is sequential (0, 1, 2, ...)
- All strategies: `startOffset` / `endOffset` cover original text
- All strategies: empty input returns empty array

### `@ci/parser`

- Docling: PDF with tables produces structured table data
- Docling: DOCX extracts headings and body text
- Docling: HTML removes scripts/styles, preserves content
- Docling: unsupported mime type throws error
- Text parser: Markdown headings extracted correctly
- Text parser: UTF-8 content preserved

---

## Critical File Paths

| File                                | Purpose                   |
| ----------------------------------- | ------------------------- |
| `packages/chunker/src/index.ts`     | IChunker interface        |
| `packages/chunker/src/semantic.ts`  | Primary chunking strategy |
| `packages/chunker/src/recursive.ts` | Heading-aware chunking    |
| `packages/chunker/src/factory.ts`   | Strategy selector         |
| `packages/parser/src/index.ts`      | IDocumentParser interface |
| `packages/parser/src/docling.ts`    | Docling HTTP adapter      |
| `packages/parser/src/text.ts`       | Plain text fallback       |

---

## Risk Assessment

| Risk                                    | Impact | Mitigation                                                          |
| --------------------------------------- | ------ | ------------------------------------------------------------------- |
| Docling service unavailable             | High   | Text fallback parser for simple formats; health check before parse  |
| PDF tables parsed incorrectly           | Medium | Log parsing quality; allow manual re-upload with different parser   |
| Token counting drift between tokenizers | Low    | Use `gpt-tokenizer` consistently; validate chunk sizes in tests     |
| Very large documents (>100 pages)       | Medium | Stream parsing; chunk in batches; set document size limits per plan |

---

_Related: [Phase 2 Overview](./README.md) | [Embeddings](./02-embeddings.md) | [Ingestion Pipeline](./04-ingestion-pipeline.md)_
