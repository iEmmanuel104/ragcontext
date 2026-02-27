export type ConnectorType = "notion" | "gdrive" | "github";

export type ConnectorStatus = "active" | "disconnected" | "syncing" | "error";

export interface Connector {
  id: string;
  tenantId: string;
  projectId: string;
  type: ConnectorType;
  status: ConnectorStatus;
  config: ConnectorConfig;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorConfig {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  syncRootId?: string;
  syncFilter?: Record<string, unknown>;
}

export interface IConnectorAdapter {
  type: ConnectorType;
  authorize(tenantId: string, redirectUri: string): Promise<string>;
  handleCallback(code: string, state: string): Promise<ConnectorConfig>;
  sync(connector: Connector, fullSync: boolean): AsyncGenerator<ConnectorDocument>;
  validateConnection(config: ConnectorConfig): Promise<boolean>;
}

export interface ConnectorDocument {
  sourceId: string;
  title: string;
  content: string | Uint8Array;
  mimeType: string;
  metadata: Record<string, unknown>;
  lastModifiedAt: Date;
}
