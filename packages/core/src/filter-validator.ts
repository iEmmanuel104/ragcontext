import type { QueryFilter } from "@contextinject/types";
import { QUERY_FILTER_ALLOWLIST } from "@contextinject/types";

/**
 * Allowlist-only filter validation.
 * Rejects unknown filter fields to prevent SQL injection and
 * ensure only whitelisted fields are used in queries.
 */
export function validateQueryFilter(filter: QueryFilter): void {
  const allowedFields = new Set<string>(QUERY_FILTER_ALLOWLIST);

  for (const key of Object.keys(filter)) {
    if (!allowedFields.has(key)) {
      throw new Error(
        `Invalid filter field: "${key}". Allowed fields: ${[...allowedFields].join(", ")}`,
      );
    }
  }

  // Validate documentIds is an array of strings if present
  if (filter.documentIds !== undefined) {
    if (!Array.isArray(filter.documentIds)) {
      throw new Error("filter.documentIds must be an array of strings");
    }
    for (const id of filter.documentIds) {
      if (typeof id !== "string") {
        throw new Error("Each documentId must be a string");
      }
    }
  }

  // Validate metadata is a plain object if present
  if (filter.metadata !== undefined) {
    if (
      typeof filter.metadata !== "object" ||
      filter.metadata === null ||
      Array.isArray(filter.metadata)
    ) {
      throw new Error("filter.metadata must be a plain object");
    }
  }
}
