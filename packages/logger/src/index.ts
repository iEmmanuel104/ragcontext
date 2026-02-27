/**
 * @contextinject/logger
 *
 * Structured logging with PII redaction for the ContextInject platform.
 */

export { createLogger, createChildLogger } from "./logger.js";
export type { Logger, CreateLoggerOptions } from "./logger.js";
export { redactValue, REDACT_PATHS } from "./pii-redactor.js";
