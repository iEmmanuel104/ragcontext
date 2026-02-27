import type { ReindexJobData } from "@contextinject/types";

/**
 * Reindex processor.
 *
 * Re-processes all documents in a project through the ingestion pipeline.
 * Used when embedding model changes or chunking strategy is updated.
 */
export async function processReindex(data: ReindexJobData): Promise<void> {
  const { tenantId, projectId, reason } = data;

  if (!tenantId || !projectId) {
    throw new Error("Missing required fields: tenantId, projectId");
  }

  console.warn(
    `[reindex] Reindexing project ${projectId} for tenant ${tenantId} (reason: ${reason})`,
  );

  // TODO: Fetch all documents in project, queue ingest job for each
}
