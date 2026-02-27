export type JobType = "ingest" | "delete" | "sync" | "reindex";

export type JobStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

export interface JobData {
  tenantId: string;
  type: JobType;
}

export interface IngestJobData extends JobData {
  type: "ingest";
  documentId: string;
  projectId: string;
}

export interface DeleteJobData extends JobData {
  type: "delete";
  documentId: string;
  projectId: string;
  cascadeTargets: ("chunks" | "vectors" | "cache")[];
}

export interface SyncJobData extends JobData {
  type: "sync";
  connectorId: string;
  projectId: string;
  fullSync: boolean;
}

export interface ReindexJobData extends JobData {
  type: "reindex";
  projectId: string;
  reason: string;
}

export type AnyJobData = IngestJobData | DeleteJobData | SyncJobData | ReindexJobData;

export interface JobResult {
  success: boolean;
  processedAt: Date;
  duration: number;
  error?: string;
  metrics?: Record<string, number>;
}
