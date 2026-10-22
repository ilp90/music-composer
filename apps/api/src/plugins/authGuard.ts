import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../errors';
import type { TokenService } from '../services/tokens';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAuth` from the access token's `sub`. */
    userId: string;
  }
}

/** preHandler for protected routes. Verifies the Bearer access token locally (no database call). */
export function requireAuth(tokens: TokenService): preHandlerAsyncHookHandler {
  return async (request) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');

    try {
      request.userId = await tokens.verifyAccessToken(token);
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'Session expired, please sign in again');
    }
  };
}

/**
 * CSRF defense for cookie-authenticated endpoints, on top of SameSite=Strict: browsers always send
 * Origin on POST, so require it to be the web app's.
 */
export function assertAllowedOrigin(request: FastifyRequest, allowedOrigin: string) {
  if (request.headers.origin !== allowedOrigin) {
    throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Request origin not allowed');
  }
}
