import { AppError } from "./app-error.js";

export class NotFoundError extends AppError {
  constructor(
    message = "Resource not found",
    options?: { requestId?: string; details?: Record<string, unknown> },
  ) {
    super({
      message,
      statusCode: 404,
      code: "NOT_FOUND",
      requestId: options?.requestId,
      details: options?.details,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = "Unauthorized",
    options?: { requestId?: string; details?: Record<string, unknown> },
  ) {
    super({
      message,
      statusCode: 401,
      code: "UNAUTHORIZED",
      requestId: options?.requestId,
      details: options?.details,
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = "Forbidden",
    options?: { requestId?: string; details?: Record<string, unknown> },
  ) {
    super({
      message,
      statusCode: 403,
      code: "FORBIDDEN",
      requestId: options?.requestId,
      details: options?.details,
    });
  }
}

export class ConflictError extends AppError {
  constructor(
    message = "Conflict",
    options?: { requestId?: string; details?: Record<string, unknown> },
  ) {
    super({
      message,
      statusCode: 409,
      code: "CONFLICT",
      requestId: options?.requestId,
      details: options?.details,
    });
  }
}

export class RateLimitedError extends AppError {
  public readonly retryAfter: number;

  constructor(
    message = "Rate limited",
    retryAfter: number,
    options?: { requestId?: string; details?: Record<string, unknown> },
  ) {
    super({
      message,
      statusCode: 429,
      code: "RATE_LIMITED",
      requestId: options?.requestId,
      details: options?.details,
    });
    this.retryAfter = retryAfter;
  }
}

export class ValidationError extends AppError {
  public readonly fields: Record<string, string>;

  constructor(
    message = "Validation error",
    fields: Record<string, string>,
    options?: { requestId?: string; details?: Record<string, unknown> },
  ) {
    super({
      message,
      statusCode: 400,
      code: "VALIDATION_ERROR",
      requestId: options?.requestId,
      details: options?.details,
    });
    this.fields = fields;
  }
}

export class ExternalServiceError extends AppError {
  public readonly service: string;

  constructor(
    message = "External service error",
    service: string,
    options?: { requestId?: string; details?: Record<string, unknown> },
  ) {
    super({
      message,
      statusCode: 502,
      code: "EXTERNAL_SERVICE_ERROR",
      requestId: options?.requestId,
      details: options?.details,
    });
    this.service = service;
  }
}
