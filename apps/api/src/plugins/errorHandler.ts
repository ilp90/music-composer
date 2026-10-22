import type { ErrorResponse } from '@mc/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors';

// Dependency failures that are worth retrying: answer 503 + Retry-After instead of hanging or 500 (SPEC §5).
const RETRYABLE_AWS_ERRORS = new Set([
  'ProvisionedThroughputExceededException',
  'ThrottlingException',
  'RequestLimitExceeded',
  'InternalServerError',
  'ServiceUnavailable',
  'TimeoutError',
]);
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
]);

function isDependencyUnavailable(err: Error): boolean {
  const { code, $retryable } = err as Error & { code?: string; $retryable?: unknown };
  return (
    RETRYABLE_AWS_ERRORS.has(err.name) ||
    $retryable !== undefined ||
    (code !== undefined && NETWORK_ERROR_CODES.has(code))
  );
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    if (err instanceof AppError) {
      const body: ErrorResponse = {
        code: err.code,
        message: err.message,
        ...(err.extra.fieldErrors && { fieldErrors: err.extra.fieldErrors }),
      };
      return reply
        .status(err.statusCode)
        .headers(err.extra.headers ?? {})
        .send(body);
    }

    if (err instanceof z.ZodError) {
      const { fieldErrors } = z.flattenError(err);
      const body: ErrorResponse = {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        fieldErrors: fieldErrors as Record<string, string[]>,
      };
      return reply.status(400).send(body);
    }

    // Fastify's own client errors (malformed JSON, body too large, wrong content type).
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
      const body: ErrorResponse = { code: 'VALIDATION_ERROR', message: err.message };
      return reply.status(err.statusCode).send(body);
    }

    if (isDependencyUnavailable(err)) {
      request.log.warn({ err }, 'dependency unavailable');
      const body: ErrorResponse = {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Temporarily unavailable, please retry',
      };
      return reply.status(503).header('retry-after', '2').send(body);
    }

    request.log.error({ err }, 'unhandled error');
    const body: ErrorResponse = { code: 'INTERNAL', message: 'Something went wrong' };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ErrorResponse = { code: 'NOT_FOUND', message: 'Not found' };
    return reply.status(404).send(body);
  });
}
