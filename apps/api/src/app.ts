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
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { createPasswordService } from './services/passwords';
import { createTokenService, loadSigningKey } from './services/tokens';

export interface AppOverrides {
  /** Injectable clock for tests (token expiry, grace windows, lockout windows). */
  now?: () => Date;
  db?: DocClient;
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
  await app.register(authRoutes, {
    config,
    users,
    refreshTokens,
    loginAttempts,
    passwords,
    tokens,
    now,
  });
  await app.register(meRoutes, { users, tokens });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
