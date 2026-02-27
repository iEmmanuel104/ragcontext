export interface AppErrorOptions {
  message: string;
  statusCode: number;
  code: string;
  isOperational?: boolean;
  requestId?: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly requestId?: string;
  public readonly details?: Record<string, unknown>;

  constructor({
    message,
    statusCode,
    code,
    isOperational = true,
    requestId,
    details,
  }: AppErrorOptions) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.requestId = requestId;
    this.details = details;

    // Restore prototype chain (necessary when extending built-ins in TS)
    Object.setPrototypeOf(this, new.target.prototype);

    Error.captureStackTrace(this, this.constructor);
  }

  static isAppError(err: unknown): err is AppError {
    return err instanceof AppError;
  }
}
