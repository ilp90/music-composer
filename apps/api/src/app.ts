import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Config } from './config';
import { createDocClient, createDynamoClient, type DocClient } from './db/client';
import { registerErrorHandler } from './plugins/errorHandler';
import { createLoginAttemptsRepository } from './repositories/loginAttempts';
import { createRefreshTokensRepository } from './repositories/refreshTokens';
import { createUsersRepository } from './repositories/users';
import { authRoutes } from './routes/auth';
import { googleRoutes } from './routes/google';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { createGoogleClient, type GoogleClient } from './services/google';
import { createPasswordService } from './services/passwords';
import { createSessionService } from './services/sessions';
import { createTokenService, loadSigningKey } from './services/tokens';

export interface AppOverrides {
  /** Injectable clock for tests (token expiry, grace windows, lockout windows). */
  now?: () => Date;
  db?: DocClient;
  /** Fake Google OAuth client for tests; `null` forces Google sign-in off. */
  google?: GoogleClient | null;
}

export async function buildApp(config: Config, overrides: AppOverrides = {}) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info' },
    // Fail fast instead of hanging (SPEC §5).
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    // Only small JSON bodies: video bytes go straight to S3.
    bodyLimit: 64 * 1024,
  });
  app.decorateRequest('userId', '');
  registerErrorHandler(app);

  const db = overrides.db ?? createDocClient(createDynamoClient(config));
  const now = overrides.now ?? (() => new Date());
  const signingKey = await loadSigningKey(config.JWT_PRIVATE_JWK);
  if (signingKey.ephemeral) {
    app.log.warn(
      'JWT_PRIVATE_JWK not set: using an ephemeral signing key (access tokens reset on restart)',
    );
  }

  const users = createUsersRepository(db, config.DYNAMODB_TABLE);
  const refreshTokens = createRefreshTokensRepository(db, config.DYNAMODB_TABLE);
  const loginAttempts = createLoginAttemptsRepository(
    db,
    config.DYNAMODB_TABLE,
    config.LOGIN_FAILURE_WINDOW_SECONDS,
  );
  const passwords = createPasswordService(config.BCRYPT_COST);
  const tokens = createTokenService(signingKey, config.JWT_ISSUER, config.ACCESS_TOKEN_TTL_SECONDS);

  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(healthRoutes);
  const sessions = createSessionService({ config, refreshTokens, tokens, now });
  const google =
    overrides.google !== undefined
      ? (overrides.google ?? undefined)
      : config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? createGoogleClient(
            config.GOOGLE_CLIENT_ID,
            config.GOOGLE_CLIENT_SECRET,
            config.GOOGLE_REDIRECT_URI,
            now,
          )
        : undefined;
  if (!google)
    app.log.info('Google sign-in disabled (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set)');

  await app.register(authRoutes, {
    config,
    users,
    refreshTokens,
    loginAttempts,
    passwords,
    sessions,
    now,
  });
  await app.register(googleRoutes, { config, google, users, sessions, now });
  await app.register(meRoutes, { users, tokens });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
