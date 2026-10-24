import { LoginBody, RegisterBody } from '@mc/shared';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import type { Config } from '../config';
import { AppError } from '../errors';
import { assertAllowedOrigin } from '../plugins/authGuard';
import type { LoginAttemptsRepository } from '../repositories/loginAttempts';
import type { RefreshTokensRepository } from '../repositories/refreshTokens';
import { EmailTakenError, type UserRecord, type UsersRepository } from '../repositories/users';
import { isCommonPassword, type PasswordService } from '../services/passwords';
import { REFRESH_COOKIE, type SessionService } from '../services/sessions';
import { generateRefreshToken, parseRefreshToken } from '../services/tokens';

export interface AuthRoutesOptions {
  config: Config;
  users: UsersRepository;
  refreshTokens: RefreshTokensRepository;
  loginAttempts: LoginAttemptsRepository;
  passwords: PasswordService;
  sessions: SessionService;
  now: () => Date;
}

/** Runs a non-critical write/read; on failure logs and returns the fallback so the request still succeeds (SPEC §5). */
export async function bestEffort<T>(
  log: FastifyBaseLogger,
  what: string,
  fn: () => Promise<T>,
  fallback: T,
) {
  try {
    return await fn();
  } catch (err) {
    log.warn({ err }, `${what} failed; continuing`);
    return fallback;
  }
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, opts) => {
  const { config, users, refreshTokens, loginAttempts, passwords, sessions, now } = opts;

  const startSession = async (reply: FastifyReply, user: UserRecord) => {
    await sessions.start(reply, user);
    return sessions.authResponse(user);
  };

  app.post('/auth/register', async (request, reply) => {
    const body = RegisterBody.parse(request.body);
    if (isCommonPassword(body.password)) {
      const message = 'This password is too common. Choose a less guessable one.';
      throw new AppError(400, 'WEAK_PASSWORD', message, { fieldErrors: { password: [message] } });
    }

    const user: UserRecord = {
      id: ulid(),
      email: body.email,
      displayName: body.displayName,
      passwordHash: await passwords.hash(body.password),
      createdAt: now().toISOString(),
    };
    try {
      await users.create(user);
    } catch (err) {
      if (err instanceof EmailTakenError) {
        const message = 'An account with this email already exists';
        throw new AppError(409, 'EMAIL_TAKEN', message, { fieldErrors: { email: [message] } });
      }
      throw err;
    }

    return reply.status(201).send(await startSession(reply, user));
  });

  app.post('/auth/login', async (request, reply) => {
    const { email, password } = LoginBody.parse(request.body);
    const at = now();

    // Lockout is a defense-in-depth layer behind WAF; if its storage is unavailable, fail open.
    const attempts = await bestEffort(
      request.log,
      'login attempts lookup',
      () => loginAttempts.get(email, at),
      { failures: 0, resetsInSeconds: 0 },
    );
    if (attempts.failures >= config.LOGIN_MAX_FAILURES) {
      throw new AppError(
        429,
        'TOO_MANY_ATTEMPTS',
        'Too many failed sign-in attempts. Try again later.',
        {
          headers: { 'retry-after': String(attempts.resetsInSeconds) },
        },
      );
    }

    const user = await users.findByEmail(email);
    // Always one bcrypt compare, so unknown emails and wrong passwords take the same time.
    const valid = await passwords.verify(password, user?.passwordHash);
    if (!user || !valid) {
      await bestEffort(
        request.log,
        'record login failure',
        () => loginAttempts.recordFailure(email, at),
        undefined,
      );
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    if (attempts.failures > 0) {
      await bestEffort(
        request.log,
        'clear login failures',
        () => loginAttempts.clear(email, at),
        undefined,
      );
    }
    return reply.send(await startSession(reply, user));
  });

  app.post('/auth/refresh', async (request, reply) => {
    assertAllowedOrigin(request, config.CORS_ORIGIN);

    const presented = parseRefreshToken(request.cookies[REFRESH_COOKIE]);
    if (!presented) {
      sessions.clearRefreshCookie(reply);
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please sign in again');
    }

    const at = now();
    const next = generateRefreshToken(presented.userId);
    const result = await refreshTokens.rotate({
      userId: presented.userId,
      oldHash: presented.hash,
      newHash: next.hash,
      now: at,
      expiresAt: new Date(at.getTime() + sessions.refreshTtlMs),
      graceSeconds: config.REFRESH_REUSE_GRACE_SECONDS,
    });

    if (!result.ok) {
      if (result.reason === 'reused') {
        request.log.warn(
          { userId: presented.userId },
          'refresh token reuse detected; session family revoked',
        );
      }
      // On a race the browser may already hold the winner's new cookie: don't clear it.
      if (result.reason !== 'race') sessions.clearRefreshCookie(reply);
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please sign in again');
    }

    const user = await users.findById(presented.userId);
    if (!user) {
      sessions.clearRefreshCookie(reply);
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please sign in again');
    }

    sessions.setRefreshCookie(reply, next.token);
    return reply.send(await sessions.authResponse(user));
  });

  app.post('/auth/logout', async (request, reply) => {
    assertAllowedOrigin(request, config.CORS_ORIGIN);

    const presented = parseRefreshToken(request.cookies[REFRESH_COOKIE]);
    if (presented) {
      // Clearing the cookie is what the user needs; revoking server-side is best effort.
      await bestEffort(
        request.log,
        'revoke session',
        async () => {
          const token = await refreshTokens.findToken(presented.userId, presented.hash);
          if (token) await refreshTokens.revokeFamily(presented.userId, token.familyId, now());
        },
        undefined,
      );
    }

    sessions.clearRefreshCookie(reply);
    return reply.status(204).send();
  });
};
