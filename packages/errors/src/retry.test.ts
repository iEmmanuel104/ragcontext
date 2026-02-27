import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry } from "./retry.js";
import { AppError } from "./app-error.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Suppress console.warn from retry logic
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns result on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on failure and returns on eventual success", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValue("ok");

    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 1 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after maxRetries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 })).rejects.toThrow(
      "persistent",
    );

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does NOT retry 4xx AppErrors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(
        new AppError({ message: "Bad request", statusCode: 400, code: "BAD_REQUEST" }),
      );

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow("Bad request");

    expect(fn).toHaveBeenCalledOnce(); // No retries
  });

  it("does NOT retry 401 errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(
        new AppError({ message: "Unauthorized", statusCode: 401, code: "UNAUTHORIZED" }),
      );

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow("Unauthorized");

    expect(fn).toHaveBeenCalledOnce();
  });

  it("does NOT retry 404 errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(
        new AppError({ message: "Not found", statusCode: 404, code: "NOT_FOUND" }),
      );

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow("Not found");

    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries 5xx AppErrors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(
        new AppError({ message: "Server error", statusCode: 500, code: "INTERNAL" }),
      )
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 1 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries non-AppError errors (network failures)", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")).mockResolvedValue("ok");

    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 1 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects retryableErrors filter", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(
        new AppError({ message: "Server error", statusCode: 502, code: "BAD_GATEWAY" }),
      );

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 1,
        retryableErrors: ["TIMEOUT"], // BAD_GATEWAY not in list
      }),
    ).rejects.toThrow("Server error");

    expect(fn).toHaveBeenCalledOnce(); // No retries since code not in retryableErrors
  });

  it("uses exponential backoff (delay increases)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const start = Date.now();

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 }),
    ).rejects.toThrow("fail");

    const elapsed = Date.now() - start;
    // Should have some delay from backoff (at least ~10ms + ~20ms with jitter)
    expect(elapsed).toBeGreaterThan(5);
  });
});
