import CircuitBreaker from "opossum";

export interface CircuitBreakerOptions {
  /** Timeout in milliseconds after which the call is considered failed. Default: 10000 */
  timeout?: number;
  /** Error percentage at which to open the circuit. Default: 50 */
  errorThresholdPercentage?: number;
  /** Time in milliseconds to wait before attempting to close the circuit. Default: 30000 */
  resetTimeout?: number;
  /** Rolling count timeout in milliseconds. Default: 10000 */
  rollingCountTimeout?: number;
  /** Number of buckets in the rolling window. Default: 10 */
  rollingCountBuckets?: number;
}

const DEFAULT_OPTIONS: Required<
  Pick<CircuitBreakerOptions, "timeout" | "errorThresholdPercentage" | "resetTimeout">
> = {
  timeout: 10_000,
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
};

export function createCircuitBreaker<T>(
  name: string,
  fn: (...args: unknown[]) => Promise<T>,
  options?: CircuitBreakerOptions,
): CircuitBreaker {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options, name };

  const breaker = new CircuitBreaker(fn, mergedOptions);

  breaker.on("open", () => {
    console.warn(`[circuit-breaker] ${name}: circuit OPENED (requests will be short-circuited)`);
  });

  breaker.on("halfOpen", () => {
    console.warn(`[circuit-breaker] ${name}: circuit HALF-OPEN (next request is a test)`);
  });

  breaker.on("close", () => {
    console.warn(`[circuit-breaker] ${name}: circuit CLOSED (back to normal)`);
  });

  return breaker;
}
