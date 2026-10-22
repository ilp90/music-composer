import type { ErrorCode } from '@mc/shared';

/** An error that maps directly to an HTTP response with a shared `ErrorResponse` body. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: {
      headers?: Record<string, string>;
      fieldErrors?: Record<string, string[]>;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}
