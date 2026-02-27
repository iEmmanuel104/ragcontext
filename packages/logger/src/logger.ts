/**
 * Main Logger Setup
 *
 * Creates structured Pino logger instances with PII redaction, pretty-printing
 * in development, and JSON output in production / test environments.
 */

import pino, { type Logger as PinoLogger } from "pino";
import { REDACT_PATHS } from "./pii-redactor.js";

/**
 * Re-export the Pino Logger type so consumers do not need a direct pino dependency.
 */
export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  /** Log level (defaults to "info", or "debug" when NODE_ENV is "development"). */
  level?: string;
  /** Logical service / component name attached to every log line. */
  service?: string;
}

/**
 * Determine whether the current runtime environment is "development".
 */
function isDevelopment(): boolean {
  return process.env["NODE_ENV"] === "development";
}

/**
 * Build the Pino transport configuration.
 *
 * - In **development** we pipe through `pino-pretty` for human-readable output.
 * - In **production / test** we emit structured JSON (no transport needed).
 */
function buildTransport(): pino.TransportSingleOptions | undefined {
  if (isDevelopment()) {
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  }
  return undefined;
}

/**
 * Create a new root Pino logger.
 *
 * @param options - Optional overrides for level and service name.
 * @returns A configured Pino `Logger` instance.
 */
export function createLogger(options?: CreateLoggerOptions): Logger {
  const level = options?.level ?? (isDevelopment() ? "debug" : "info");
  const service = options?.service ?? "contextinject";

  const transport = buildTransport();

  return pino({
    level,
    name: service,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(transport ? { transport } : {}),
  });
}

/**
 * Create a child logger that inherits the parent's configuration and adds
 * request-scoped bindings (e.g. `requestId`, `tenantId`).
 *
 * @param parent   - The parent `Logger` to derive from.
 * @param bindings - Key/value pairs merged into every log line produced by the child.
 * @returns A child `Logger` instance.
 */
export function createChildLogger(parent: Logger, bindings: Record<string, unknown>): Logger {
  return parent.child(bindings);
}
