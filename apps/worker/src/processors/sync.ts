import type { SyncJobData } from "@contextinject/types";

/**
 * Connector sync processor.
 *
 * Fetches new/updated documents from external sources (Notion, GDrive, GitHub)
 * and queues ingestion jobs for each.
 */
export async function processSync(data: SyncJobData): Promise<void> {
  const { tenantId, connectorId, projectId, fullSync } = data;

  if (!tenantId || !connectorId || !projectId) {
    throw new Error("Missing required fields: tenantId, connectorId, projectId");
  }

  console.warn(
    `[sync] Syncing connector ${connectorId} for tenant ${tenantId} (fullSync: ${String(fullSync)})`,
  );

  // TODO: Wire up connector adapter, fetch documents, queue ingest jobs
}
