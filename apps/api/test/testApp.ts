import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import { buildApp, type App } from '../src/app';
import { loadConfig } from '../src/config';
import { REFRESH_COOKIE } from '../src/routes/auth';

export const WEB_ORIGIN = 'http://localhost:5173';

export interface TestApp {
  app: App;
  /** Moves the injected clock forward. */
  advance(seconds: number): void;
}

/** App wired to the per-run DynamoDB Local table, with a fast bcrypt cost and a controllable clock. */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  let current = Date.now();
  const config = loadConfig({
    NODE_ENV: 'test',
    CORS_ORIGIN: WEB_ORIGIN,
    DYNAMODB_ENDPOINT: inject('dynamoEndpoint'),
    DYNAMODB_TABLE: inject('dynamoTable'),
    BCRYPT_COST: '4',
    ...env,
  });
  const app = await buildApp(config, { now: () => new Date(current) });
  return {
    app,
    advance(seconds) {
      current += seconds * 1000;
    },
  };
}

export const uniqueEmail = () => `user-${randomUUID()}@example.com`;

export function newUser() {
  return { email: uniqueEmail(), password: 'violet-fifths-lantern', displayName: 'Ada' };
}

/** The refresh token set by a response, if any (empty string means the cookie was cleared). */
export function refreshCookie(res: { cookies: Array<{ name: string; value: string }> }) {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value;
}

/** `origin: null` sends no Origin header. */
export function postRefresh(
  app: App,
  token: string | undefined,
  origin: string | null = WEB_ORIGIN,
) {
  return app.inject({
    method: 'POST',
    url: '/auth/refresh',
    ...(origin && { headers: { origin } }),
    ...(token && { cookies: { [REFRESH_COOKIE]: token } }),
  });
}
