import type { Request, Response, NextFunction } from "express";
import type { AuthContext, ApiKeyScope, Tenant } from "@contextinject/types";
import type { ApiKeyValidator } from "./api-key-validator.js";
import { verifyToken } from "./jwt.js";
import { hasScope } from "./rbac.js";

// Extend Express Request with auth context and requestId
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenant?: Tenant;
      requestId?: string;
    }
  }
}

const API_KEY_PREFIX = "Bearer ";
const API_KEY_HEADER = "x-api-key";

function getRequestId(req: Request): string {
  return req.requestId ?? "unknown";
}

/**
 * Authentication middleware.
 * Validates API key or JWT and attaches auth context to request.
 */
export function createAuthMiddleware(validator: ApiKeyValidator, jwtSecret: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Try X-API-Key header first
    const apiKey = req.headers[API_KEY_HEADER] as string | undefined;
    if (apiKey) {
      const context = await validator.validate(apiKey);
      if (!context) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or expired API key",
            requestId: getRequestId(req),
          },
        });
        return;
      }
      req.auth = context;
      next();
      return;
    }

    // Try Bearer token (JWT)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith(API_KEY_PREFIX)) {
      const token = authHeader.slice(API_KEY_PREFIX.length);
      const payload = verifyToken(token, jwtSecret);
      if (!payload) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or expired token",
            requestId: getRequestId(req),
          },
        });
        return;
      }
      req.auth = {
        tenantId: payload.tenantId,
        apiKeyId: payload.sub,
        scopes: payload.scopes,
        plan: "free", // JWT-based auth should fetch plan from DB
      };
      next();
      return;
    }

    res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Missing authentication",
        requestId: getRequestId(req),
      },
    });
  };
}

/**
 * Scope-checking middleware factory.
 * Returns middleware that verifies the request has the required scope.
 */
export function requireScope(...requiredScopes: ApiKeyScope[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated", requestId: getRequestId(req) },
      });
      return;
    }

    const hasRequired = requiredScopes.every((scope) => hasScope(req.auth!, scope));
    if (!hasRequired) {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: `Insufficient permissions. Required scopes: ${requiredScopes.join(", ")}`,
          requestId: getRequestId(req),
        },
      });
      return;
    }

    next();
  };
}

/**
 * Tenant middleware.
 * Injects req.tenant with full tenant record + settings.
 * Must run after auth middleware.
 */
export function createTenantMiddleware(lookupFn: (tenantId: string) => Promise<Tenant | null>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated", requestId: getRequestId(req) },
      });
      return;
    }

    const tenant = await lookupFn(req.auth.tenantId);
    if (!tenant) {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Tenant not found or inactive",
          requestId: getRequestId(req),
        },
      });
      return;
    }

    if (tenant.status !== "active") {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Tenant account is suspended",
          requestId: getRequestId(req),
        },
      });
      return;
    }

    req.tenant = tenant;
    next();
  };
}
