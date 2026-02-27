import jwt from "jsonwebtoken";
import type { ApiKeyScope } from "@contextinject/types";
import type { JwtPayload as AppJwtPayload } from "@contextinject/types";

export interface JwtConfig {
  secret: string;
  expirySeconds: number;
}

export function generateToken(
  payload: { sub: string; tenantId: string; scopes: ApiKeyScope[] },
  config: JwtConfig,
): string {
  return jwt.sign(
    {
      sub: payload.sub,
      tenantId: payload.tenantId,
      scopes: payload.scopes,
    },
    config.secret,
    { expiresIn: config.expirySeconds },
  );
}

export function verifyToken(token: string, secret: string): AppJwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as AppJwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

export function decodeToken(token: string): AppJwtPayload | null {
  try {
    return jwt.decode(token) as AppJwtPayload | null;
  } catch {
    return null;
  }
}
