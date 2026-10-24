import type { AuthResponse, User } from '@mc/shared';
import type { FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import type { Config } from '../config';
import type { RefreshTokensRepository } from '../repositories/refreshTokens';
import type { UserRecord } from '../repositories/users';
import { generateRefreshToken, type TokenService } from './tokens';

export const REFRESH_COOKIE = 'mc_rt';

export function toPublicUser({ id, email, displayName, createdAt }: UserRecord): User {
  return { id, email, displayName, createdAt };
}

/** Refresh-cookie handling and session start, shared by password and Google sign-in. */
export function createSessionService(deps: {
  config: Config;
  refreshTokens: RefreshTokensRepository;
  tokens: TokenService;
  now: () => Date;
}) {
  const { config, refreshTokens, tokens, now } = deps;
  const refreshTtlMs = config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const cookieOptions = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: config.COOKIE_PATH,
  } as const;

  const setRefreshCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(REFRESH_COOKIE, token, { ...cookieOptions, maxAge: refreshTtlMs / 1000 });

  return {
    refreshTtlMs,
    setRefreshCookie,

    clearRefreshCookie(reply: FastifyReply) {
      reply.clearCookie(REFRESH_COOKIE, cookieOptions);
    },

    async authResponse(user: UserRecord): Promise<AuthResponse> {
      return {
        accessToken: await tokens.signAccessToken(user.id),
        expiresIn: tokens.accessTtlSeconds,
        user: toPublicUser(user),
      };
    },

    /** Starts a new refresh-token family (one per sign-in/device) and sets its cookie. */
    async start(reply: FastifyReply, user: UserRecord): Promise<void> {
      const at = now();
      const { token, hash } = generateRefreshToken(user.id);
      await refreshTokens.createFamily(
        user.id,
        ulid(),
        hash,
        at,
        new Date(at.getTime() + refreshTtlMs),
      );
      setRefreshCookie(reply, token);
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
