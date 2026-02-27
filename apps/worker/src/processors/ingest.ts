import type { IngestJobData } from "@contextinject/types";

/**
 * Ingest job processor.
 *
 * Workflow:
 * 1. Fetch document content from storage
 * 2. Run ingestion pipeline (parse -> chunk -> embed -> store)
 * 3. Vectors stored with isDeleted=true (two-phase commit)
 * 4. Update document status in Postgres
 * 5. Flip isDeleted=false after Postgres tx commits
 */
export async function processIngest(data: IngestJobData): Promise<void> {
  const { tenantId, documentId, projectId } = data;

  // TODO: Wire up actual dependencies (parser, chunker, embeddings, vector store)
  // For now, this is a placeholder that validates the job data structure

  if (!tenantId || !documentId || !projectId) {
    throw new Error("Missing required fields: tenantId, documentId, projectId");
  }

  console.warn(
    `[ingest] Processing document ${documentId} for tenant ${tenantId} in project ${projectId}`,
  );

  // Pipeline steps will be wired in Phase 3 when the API server creates
  // the dependency injection container
}
