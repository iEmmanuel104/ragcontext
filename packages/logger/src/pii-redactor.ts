/**
 * PII Redaction Logic
 *
 * Provides utilities to detect and redact personally identifiable information (PII)
 * and sensitive values from log output.
 */

const REDACTED = "[REDACTED]";

/**
 * Keys whose values should always be redacted (matched case-insensitively).
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "ssn",
  "creditcard",
  "credit_card",
  "accesstoken",
  "refreshtoken",
  "encryptionkey",
]);

/**
 * Regex to detect email addresses inside string values.
 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Determine whether a key name represents a sensitive field.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Redact a single key/value pair.
 *
 * - If the key matches a known sensitive field name the entire value is replaced
 *   with "[REDACTED]".
 * - If the value is a string that contains email-like patterns, those patterns
 *   are replaced with "[REDACTED]".
 *
 * @param key   - The property name being logged.
 * @param value - The property value being logged.
 * @returns The (possibly redacted) value.
 */
export function redactValue(key: string, value: unknown): unknown {
  // Full redaction for sensitive keys
  if (isSensitiveKey(key)) {
    return REDACTED;
  }

  // Partial redaction: strip emails from string values
  if (typeof value === "string" && EMAIL_REGEX.test(value)) {
    // Reset lastIndex because the regex is global
    EMAIL_REGEX.lastIndex = 0;
    return value.replace(EMAIL_REGEX, REDACTED);
  }

  return value;
}

/**
 * List of JSON-path strings suitable for Pino's `redact` option.
 * These cover the most common top-level property names that carry secrets.
 */
export const REDACT_PATHS: string[] = [
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "ssn",
  "creditCard",
  "credit_card",
  "accessToken",
  "refreshToken",
  "encryptionKey",
  // Also cover one level of nesting (e.g. req.headers.authorization)
  "*.password",
  "*.secret",
  "*.token",
  "*.apiKey",
  "*.api_key",
  "*.authorization",
  "*.cookie",
  "*.ssn",
  "*.creditCard",
  "*.credit_card",
  "*.accessToken",
  "*.refreshToken",
  "*.encryptionKey",
];
