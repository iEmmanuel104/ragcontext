import { describe, it, expect } from "vitest";
import { AppError } from "./app-error.js";
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitedError,
  ValidationError,
  ExternalServiceError,
} from "./errors.js";

describe("AppError", () => {
  it("creates error with all properties", () => {
    const err = new AppError({
      message: "test error",
      statusCode: 500,
      code: "INTERNAL",
      isOperational: false,
      requestId: "req-1",
      details: { foo: "bar" },
    });

    expect(err.message).toBe("test error");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("INTERNAL");
    expect(err.isOperational).toBe(false);
    expect(err.requestId).toBe("req-1");
    expect(err.details).toEqual({ foo: "bar" });
    expect(err.name).toBe("AppError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("defaults isOperational to true", () => {
    const err = new AppError({ message: "test", statusCode: 400, code: "BAD" });
    expect(err.isOperational).toBe(true);
  });

  it("isAppError detects AppError instances", () => {
    const appErr = new AppError({ message: "test", statusCode: 500, code: "ERR" });
    const plainErr = new Error("plain");

    expect(AppError.isAppError(appErr)).toBe(true);
    expect(AppError.isAppError(plainErr)).toBe(false);
    expect(AppError.isAppError(null)).toBe(false);
    expect(AppError.isAppError("string")).toBe(false);
  });
});

describe("Error Subclasses", () => {
  describe("NotFoundError", () => {
    it("has status 404 and NOT_FOUND code", () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("NOT_FOUND");
      expect(err.message).toBe("Resource not found");
      expect(err.name).toBe("NotFoundError");
      expect(err).toBeInstanceOf(AppError);
    });

    it("accepts custom message and options", () => {
      const err = new NotFoundError("User not found", { requestId: "req-1" });
      expect(err.message).toBe("User not found");
      expect(err.requestId).toBe("req-1");
    });
  });

  describe("UnauthorizedError", () => {
    it("has status 401 and UNAUTHORIZED code", () => {
      const err = new UnauthorizedError();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
      expect(err.name).toBe("UnauthorizedError");
    });
  });

  describe("ForbiddenError", () => {
    it("has status 403 and FORBIDDEN code", () => {
      const err = new ForbiddenError();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
      expect(err.name).toBe("ForbiddenError");
    });
  });

  describe("ConflictError", () => {
    it("has status 409 and CONFLICT code", () => {
      const err = new ConflictError();
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe("CONFLICT");
      expect(err.name).toBe("ConflictError");
    });
  });

  describe("RateLimitedError", () => {
    it("has status 429, RATE_LIMITED code, and retryAfter", () => {
      const err = new RateLimitedError("Too many requests", 60);
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.retryAfter).toBe(60);
      expect(err.name).toBe("RateLimitedError");
    });
  });

  describe("ValidationError", () => {
    it("has status 400, VALIDATION_ERROR code, and fields", () => {
      const fields = { email: "Invalid email", name: "Required" };
      const err = new ValidationError("Validation failed", fields);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.fields).toEqual(fields);
      expect(err.name).toBe("ValidationError");
    });
  });

  describe("ExternalServiceError", () => {
    it("has status 502, EXTERNAL_SERVICE_ERROR code, and service", () => {
      const err = new ExternalServiceError("Cohere is down", "cohere");
      expect(err.statusCode).toBe(502);
      expect(err.code).toBe("EXTERNAL_SERVICE_ERROR");
      expect(err.service).toBe("cohere");
      expect(err.name).toBe("ExternalServiceError");
    });
  });
});
