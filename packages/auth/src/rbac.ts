import type { ApiKeyScope, AuthContext } from "@contextinject/types";

/**
 * Checks if the auth context has the required scope.
 * "admin" scope grants access to everything.
 */
export function hasScope(context: AuthContext, requiredScope: ApiKeyScope): boolean {
  if (context.scopes.includes("admin")) {
    return true;
  }
  return context.scopes.includes(requiredScope);
}

/**
 * Checks if the auth context has ALL required scopes.
 */
export function hasAllScopes(context: AuthContext, requiredScopes: ApiKeyScope[]): boolean {
  return requiredScopes.every((scope) => hasScope(context, scope));
}

/**
 * Checks if the auth context has ANY of the required scopes.
 */
export function hasAnyScope(context: AuthContext, requiredScopes: ApiKeyScope[]): boolean {
  return requiredScopes.some((scope) => hasScope(context, scope));
}
