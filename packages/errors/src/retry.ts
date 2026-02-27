import { AppError } from "./app-error.js";

export interface RetryOptions {
  /** Maximum number of retry attempts. Default: 3 */
  maxRetries?: number;
  /** Base delay in milliseconds before the first retry. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds between retries. Default: 10000 */
  maxDelayMs?: number;
  /** Error codes that should be retried. If omitted, all retryable errors are retried. */
  retryableErrors?: string[];
}

const DEFAULT_RETRY_OPTIONS: Required<
  Pick<RetryOptions, "maxRetries" | "baseDelayMs" | "maxDelayMs">
> = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
};

/**
 * Determines whether an error is retryable.
 * Client errors (4xx) are NOT retried; server errors (5xx) and network errors ARE retried.
 */
function isRetryable(error: unknown, retryableErrors?: string[]): boolean {
  if (AppError.isAppError(error)) {
    // Never retry client errors (4xx)
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }

    // If retryableErrors list is specified, only retry matching codes
    if (retryableErrors && retryableErrors.length > 0) {
      return retryableErrors.includes(error.code);
    }

    // Server errors (5xx) are retryable
    return error.statusCode >= 500;
  }

  // Non-AppError errors (e.g. network failures, unexpected errors) are retryable
  // unless a retryableErrors filter is specified
  if (retryableErrors && retryableErrors.length > 0) {
    const code = (error as { code?: string }).code;
    return code !== undefined && retryableErrors.includes(code);
  }

  return true;
}

/**
 * Calculate delay with exponential backoff and jitter.
 * delay = min(maxDelay, baseDelay * 2^attempt) * random(0.5, 1.0)
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(maxDelayMs, exponentialDelay);
  // Add jitter: random value between 50% and 100% of the capped delay
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.floor(cappedDelay * jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic using exponential backoff and jitter.
 * Does NOT retry on 4xx (client) errors -- only 5xx and network errors.
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const retryableErrors = options?.retryableErrors;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }

      // Don't retry non-retryable errors
      if (!isRetryable(error, retryableErrors)) {
        break;
      }

      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
      console.warn(
        `[retry] Attempt ${String(attempt + 1)}/${String(maxRetries)} failed, retrying in ${String(delay)}ms...`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
