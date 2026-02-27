import { describe, it, expect } from "vitest";
import { TextParser } from "./text-parser.js";
import { DoclingParser } from "./docling-parser.js";
import { getParser } from "./factory.js";

describe("TextParser", () => {
  const parser = new TextParser();

  it("supports text MIME types", () => {
    expect(parser.supportedMimeTypes).toContain("text/plain");
    expect(parser.supportedMimeTypes).toContain("text/markdown");
    expect(parser.supportedMimeTypes).toContain("text/csv");
    expect(parser.supportedMimeTypes).toContain("text/html");
    expect(parser.supportedMimeTypes).toContain("application/json");
  });

  it("parses plain text string", async () => {
    const result = await parser.parse("Hello world", "text/plain");

    expect(result.text).toBe("Hello world");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.metadata).toHaveProperty("mimeType", "text/plain");
    expect(result.metadata).toHaveProperty("charCount", 11);
    expect(result.metadata).toHaveProperty("wordCount", 2);
  });

  it("parses Uint8Array input", async () => {
    const input = new TextEncoder().encode("Encoded text");
    const result = await parser.parse(input, "text/plain");

    expect(result.text).toBe("Encoded text");
  });

  it("strips HTML tags", async () => {
    const html = "<h1>Title</h1><p>Content with <b>bold</b> text</p>";
    const result = await parser.parse(html, "text/html");

    expect(result.text).not.toContain("<h1>");
    expect(result.text).not.toContain("<p>");
    expect(result.text).not.toContain("<b>");
    expect(result.text).toContain("Title");
    expect(result.text).toContain("Content");
    expect(result.text).toContain("bold");
  });

  it("strips script and style tags from HTML", async () => {
    const html = '<script>alert("xss")</script><style>body{color:red}</style><p>Safe content</p>';
    const result = await parser.parse(html, "text/html");

    expect(result.text).not.toContain("alert");
    expect(result.text).not.toContain("color:red");
    expect(result.text).toContain("Safe content");
  });

  it("estimates page count", async () => {
    const longText = "x".repeat(9000);
    const result = await parser.parse(longText, "text/plain");

    expect(result.pageCount).toBe(3); // 9000 / 3000 = 3
  });

  it("returns at least 1 page", async () => {
    const result = await parser.parse("Short", "text/plain");
    expect(result.pageCount).toBe(1);
  });
});

describe("DoclingParser", () => {
  const parser = new DoclingParser();

  it("supports document MIME types", () => {
    expect(parser.supportedMimeTypes).toContain("application/pdf");
    expect(parser.supportedMimeTypes).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("rejects when Python/Docling is not available", async () => {
    const mockParser = new DoclingParser("nonexistent-python", "nonexistent-script.py");

    await expect(mockParser.parse("test", "application/pdf")).rejects.toThrow();
  });
});

describe("getParser factory", () => {
  it("returns TextParser for text/plain", () => {
    const parser = getParser("text/plain");
    expect(parser.supportedMimeTypes).toContain("text/plain");
  });

  it("returns TextParser for text/markdown", () => {
    const parser = getParser("text/markdown");
    expect(parser.supportedMimeTypes).toContain("text/markdown");
  });

  it("returns DoclingParser for application/pdf", () => {
    const parser = getParser("application/pdf");
    expect(parser.supportedMimeTypes).toContain("application/pdf");
  });

  it("returns TextParser as default for unknown types", () => {
    const parser = getParser("application/unknown");
    expect(parser.supportedMimeTypes).toContain("text/plain");
  });
});
