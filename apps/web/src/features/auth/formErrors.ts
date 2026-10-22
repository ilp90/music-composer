import type { z } from 'zod';
import { ApiError } from '../../lib/apiClient';

export type FieldErrors = Record<string, string | undefined>;

/** First message per field from a failed client-side zod parse. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    errors[field] ??= issue.message;
  }
  return errors;
}

/** Splits an API failure into per-field messages and a form-level message. */
export function apiFormErrors(err: unknown): { fields: FieldErrors; form: string | null } {
  if (!(err instanceof ApiError))
    return { fields: {}, form: 'Something went wrong. Please try again.' };
  const fields: FieldErrors = {};
  for (const [field, messages] of Object.entries(err.fieldErrors)) fields[field] = messages[0];
  return { fields, form: Object.keys(fields).length > 0 ? null : err.message };
}
