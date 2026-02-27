import { describe, it, expect } from "vitest";
import { validateQueryFilter } from "./filter-validator.js";

describe("validateQueryFilter", () => {
  it("accepts valid filter with documentIds", () => {
    expect(() => validateQueryFilter({ documentIds: ["doc-1", "doc-2"] })).not.toThrow();
  });

  it("accepts valid filter with metadata", () => {
    expect(() => validateQueryFilter({ metadata: { category: "science" } })).not.toThrow();
  });

  it("accepts valid filter with both fields", () => {
    expect(() =>
      validateQueryFilter({
        documentIds: ["doc-1"],
        metadata: { tag: "important" },
      }),
    ).not.toThrow();
  });

  it("accepts empty filter", () => {
    expect(() => validateQueryFilter({})).not.toThrow();
  });

  it("rejects unknown filter fields", () => {
    const filter = { documentIds: ["doc-1"], unknownField: "value" } as Record<string, unknown>;
    expect(() => validateQueryFilter(filter as never)).toThrow(
      /Invalid filter field: "unknownField"/,
    );
  });

  it("rejects SQL injection attempt via filter keys", () => {
    const filter = { "'; DROP TABLE documents; --": "value" } as Record<string, unknown>;
    expect(() => validateQueryFilter(filter as never)).toThrow(/Invalid filter field/);
  });

  it("validates documentIds is an array", () => {
    const filter = { documentIds: "not-an-array" } as Record<string, unknown>;
    expect(() => validateQueryFilter(filter as never)).toThrow(/must be an array/);
  });

  it("validates each documentId is a string", () => {
    const filter = { documentIds: [123, "valid"] } as Record<string, unknown>;
    expect(() => validateQueryFilter(filter as never)).toThrow(/must be a string/);
  });

  it("validates metadata is a plain object", () => {
    const filter = { metadata: "not-an-object" } as Record<string, unknown>;
    expect(() => validateQueryFilter(filter as never)).toThrow(/must be a plain object/);
  });

  it("rejects metadata as array", () => {
    const filter = { metadata: [1, 2, 3] } as Record<string, unknown>;
    expect(() => validateQueryFilter(filter as never)).toThrow(/must be a plain object/);
  });

  it("rejects metadata as null", () => {
    const filter = { metadata: null } as Record<string, unknown>;
    expect(() => validateQueryFilter(filter as never)).toThrow(/must be a plain object/);
  });
});
