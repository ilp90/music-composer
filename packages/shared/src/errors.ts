import { z } from 'zod';

export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'EMAIL_TAKEN',
  'WEAK_PASSWORD',
  'INVALID_CREDENTIALS',
  'TOO_MANY_ATTEMPTS',
  'UNAUTHENTICATED',
  'INVALID_REFRESH_TOKEN',
  'FORBIDDEN_ORIGIN',
  'NOT_FOUND',
  'QUOTA_EXCEEDED',
  'UPLOAD_INCOMPLETE',
  'CONFLICT',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Body of every non-2xx API response. */
export const ErrorResponse = z.object({
  code: ErrorCode,
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
