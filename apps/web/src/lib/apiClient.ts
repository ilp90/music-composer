import { AuthResponse, ErrorResponse, type ErrorCode } from '@mc/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// --- Session state -------------------------------------------------------------------------------
// The access token lives only in memory (never localStorage), so XSS can't lift a long-lived credential.
// The refresh token is an httpOnly cookie the browser sends to /api/auth/* on its own.

let accessToken: string | null = null;
const sessionExpiredListeners = new Set<() => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Called when a refresh fails mid-session, so the UI can send the user to sign in. */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

let refreshInFlight: Promise<AuthResponse | null> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Resolves null when there is no valid session.
 * Refresh tokens rotate on every use, so concurrent refreshes would look like token reuse:
 * callers in this tab share one request, and a Web Lock queues other tabs behind it.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= withCrossTabLock(postRefresh).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('mc-auth-refresh', fn)
    : fn();
}

async function postRefresh(): Promise<AuthResponse | null> {
  const res = await send('POST', '/auth/refresh', undefined, false);
  if (res.status === 401) {
    setAccessToken(null);
    return null;
  }
  if (!res.ok) throw await toApiError(res);
  const session = AuthResponse.parse(await res.json());
  setAccessToken(session.accessToken);
  return session;
}

// --- Requests ------------------------------------------------------------------------------------

async function send(
  method: string,
  path: string,
  body: unknown,
  withAuth: boolean,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (withAuth && accessToken) headers.authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Can’t reach the server. Check your connection and try again.',
    );
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const parsed = ErrorResponse.safeParse(await res.json().catch(() => null));
  return parsed.success
    ? new ApiError(res.status, parsed.data.code, parsed.data.message, parsed.data.fieldErrors)
    : new ApiError(res.status, 'INTERNAL', `Request failed (${res.status})`);
}

interface RequestOptions {
  /** Attach the access token and, on 401, refresh once and retry. Off for the auth endpoints themselves. */
  auth?: boolean;
}

async function request<T extends z.ZodType>(
  method: string,
  path: string,
  body: unknown,
  schema: T | undefined,
  { auth = true }: RequestOptions,
): Promise<z.infer<T>> {
  let res = await send(method, path, body, auth);

  if (res.status === 401 && auth) {
    const session = await refreshSession().catch(() => null);
    if (!session) {
      sessionExpiredListeners.forEach((listener) => listener());
      throw await toApiError(res);
    }
    res = await send(method, path, body, auth);
  }

  if (!res.ok) throw await toApiError(res);
  if (!schema || res.status === 204) return undefined as z.infer<T>;
  return schema.parse(await res.json());
}

export const api = {
  get<T extends z.ZodType>(path: string, schema: T, options: RequestOptions = {}) {
    return request('GET', path, undefined, schema, options);
  },
  post<T extends z.ZodType>(path: string, body: unknown, schema?: T, options: RequestOptions = {}) {
    return request('POST', path, body, schema, options);
  },
};
