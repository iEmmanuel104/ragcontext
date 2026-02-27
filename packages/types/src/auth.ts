import type { PlanTier } from "./tenant.js";

export type ApiKeyScope =
  | "query:read"
  | "documents:read"
  | "documents:write"
  | "documents:delete"
  | "projects:read"
  | "projects:write"
  | "connectors:read"
  | "connectors:write"
  | "analytics:read"
  | "admin";

export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface AuthContext {
  tenantId: string;
  apiKeyId: string;
  scopes: ApiKeyScope[];
  plan: PlanTier;
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  scopes: ApiKeyScope[];
  iat: number;
  exp: number;
}

export interface OAuthState {
  tenantId: string;
  connectorType: string;
  redirectUri: string;
  codeVerifier: string;
  state: string;
  expiresAt: Date;
}
