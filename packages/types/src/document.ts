export type DocumentStatus = "pending" | "processing" | "indexed" | "failed" | "deleting";

export type DocumentSource = "upload" | "notion" | "gdrive" | "github" | "api";

export interface Document {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  source: DocumentSource;
  sourceId: string | null;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  chunkCount: number;
  metadata: Record<string, unknown>;
  cacheVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DocumentUploadRequest {
  projectId: string;
  title: string;
  content?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface DocumentListFilter {
  projectId?: string;
  status?: DocumentStatus;
  source?: DocumentSource;
  createdAfter?: Date;
  createdBefore?: Date;
}

// Allowed filter fields for SQL injection prevention
export const DOCUMENT_FILTER_ALLOWLIST = [
  "projectId",
  "status",
  "source",
  "createdAfter",
  "createdBefore",
] as const;
