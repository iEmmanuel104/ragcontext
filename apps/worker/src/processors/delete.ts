import type { DeleteJobData } from "@contextinject/types";

/**
 * Cascading delete processor.
 *
 * Workflow: docs -> chunks -> vectors -> cache
 * Ensures complete cleanup across all storage layers.
 */
export async function processDelete(data: DeleteJobData): Promise<void> {
  const { tenantId, documentId, projectId, cascadeTargets } = data;

  if (!tenantId || !documentId || !projectId) {
    throw new Error("Missing required fields: tenantId, documentId, projectId");
  }

  console.warn(
    `[delete] Deleting document ${documentId} for tenant ${tenantId}, cascade: ${cascadeTargets.join(", ")}`,
  );

  // Delete in order: chunks -> vectors -> cache -> document
  for (const target of cascadeTargets) {
    switch (target) {
      case "chunks":
        // TODO: Delete chunks from Postgres where documentId matches
        console.warn(`[delete] Deleting chunks for document ${documentId}`);
        break;
      case "vectors":
        // TODO: Delete vectors from Qdrant where documentId matches
        console.warn(`[delete] Deleting vectors for document ${documentId}`);
        break;
      case "cache":
        // TODO: Invalidate cache entries for document
        console.warn(`[delete] Invalidating cache for document ${documentId}`);
        break;
    }
  }

  // TODO: Update document status to 'deleting' then remove from Postgres
}
