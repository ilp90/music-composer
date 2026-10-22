import { AuthResponse, ErrorResponse, User } from '@mc/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  newUser,
  postRefresh,
  refreshCookie,
  uniqueEmail,
  WEB_ORIGIN,
  type TestApp,
} from '../../test/testApp';
import { REFRESH_COOKIE } from './auth';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.app.close();
});

const register = (body: object) =>
  t.app.inject({ method: 'POST', url: '/auth/register', payload: body });
const login = (body: object) => t.app.inject({ method: 'POST', url: '/auth/login', payload: body });
const me = (accessToken?: string) =>
  t.app.inject({
    method: 'GET',
    url: '/me',
    ...(accessToken && { headers: { authorization: `Bearer ${accessToken}` } }),
  });
const errorCode = (res: { json(): unknown }) => ErrorResponse.parse(res.json()).code;

async function registered() {
  const user = newUser();
  const res = await register(user);
  expect(res.statusCode).toBe(201);
  return { user, body: AuthResponse.parse(res.json()), refreshToken: refreshCookie(res)! };
}

describe('POST /auth/register', () => {
  it('creates the account, returns an access token and sets a hardened refresh cookie', async () => {
    const user = newUser();
    const res = await register({ ...user, email: `  ${user.email.toUpperCase()} ` });

    expect(res.statusCode).toBe(201);
    const body = AuthResponse.parse(res.json());
    expect(body.user).toMatchObject({ email: user.email, displayName: 'Ada' });
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain(user.password);

    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE)!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    const { user } = await registered();
    const res = await register({ ...newUser(), email: user.email.toUpperCase() });

    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('EMAIL_TAKEN');
  });

  it('returns field errors for invalid input', async () => {
    const res = await register({ email: 'nope', password: 'short', displayName: '' });

    expect(res.statusCode).toBe(400);
    const body = ErrorResponse.parse(res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(
      expect.arrayContaining(['email', 'password', 'displayName']),
    );
  });

  it('rejects a common password', async () => {
    const res = await register({ ...newUser(), password: 'Password123' });

    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('WEAK_PASSWORD');
  });

  it('rejects malformed JSON with a validation error', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });

    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/login', () => {
  it('signs in with the right password', async () => {
    const { user } = await registered();
    const res = await login({ email: user.email, password: user.password });

    expect(res.statusCode).toBe(200);
    expect(AuthResponse.parse(res.json()).user.email).toBe(user.email);
    expect(refreshCookie(res)).toBeTruthy();
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const { user } = await registered();
    const wrongPassword = await login({ email: user.email, password: 'not-the-password' });
    const unknownEmail = await login({ email: uniqueEmail(), password: user.password });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.statusCode).toBe(401);
      expect(ErrorResponse.parse(res.json())).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }
  });

  it('locks the email after 10 failures in the window, then unlocks', async () => {
    const { user } = await registered();
    for (let i = 0; i < 10; i++) {
      expect((await login({ email: user.email, password: `wrong-${i}` })).statusCode).toBe(401);
    }

    const locked = await login({ email: user.email, password: user.password });
    expect(locked.statusCode).toBe(429);
    expect(errorCode(locked)).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    t.advance(15 * 60);
    expect((await login({ email: user.email, password: user.password })).statusCode).toBe(200);
  });
});

describe('GET /me', () => {
  it('returns the signed-in user', async () => {
    const { body } = await registered();
    const res = await me(body.accessToken);

    expect(res.statusCode).toBe(200);
    expect(User.parse(res.json())).toEqual(body.user);
  });

  it('rejects missing, malformed and foreign tokens', async () => {
    const other = await createTestApp();
    const foreign = AuthResponse.parse(
      (
        await other.app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: newUser(),
        })
      ).json(),
    ).accessToken;
    await other.app.close();

    for (const token of [undefined, 'garbage', foreign]) {
      const res = await me(token);
      expect(res.statusCode).toBe(401);
      expect(errorCode(res)).toBe('UNAUTHENTICATED');
    }
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and returns a fresh access token', async () => {
    const { refreshToken } = await registered();

    const first = await postRefresh(t.app, refreshToken);
    expect(first.statusCode).toBe(200);
    const rotated = refreshCookie(first)!;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(refreshToken);
    expect((await me(AuthResponse.parse(first.json()).accessToken)).statusCode).toBe(200);

    expect((await postRefresh(t.app, rotated)).statusCode).toBe(200);
  });

  it('requires the web app origin', async () => {
    const { refreshToken } = await registered();

    expect(errorCode(await postRefresh(t.app, refreshToken, null))).toBe('FORBIDDEN_ORIGIN');
    expect((await postRefresh(t.app, refreshToken, 'https://evil.example')).statusCode).toBe(403);
  });

  it('rejects a missing or forged cookie and clears it', async () => {
    const missing = await postRefresh(t.app, undefined);
    const forged = await postRefresh(t.app, `01ARZ3NDEKTSV4RRFFQ69G5FAV.${'A'.repeat(43)}`);

    for (const res of [missing, forged]) {
      expect(res.statusCode).toBe(401);
      expect(errorCode(res)).toBe('INVALID_REFRESH_TOKEN');
      expect(refreshCookie(res)).toBe('');
    }
  });

  it('treats reuse within the grace window as a race: rejected, but the session survives', async () => {
    const { refreshToken } = await registered();
    const rotated = refreshCookie(await postRefresh(t.app, refreshToken))!;

    const replay = await postRefresh(t.app, refreshToken);
    expect(replay.statusCode).toBe(401);
    expect(refreshCookie(replay)).toBeUndefined(); // don't clobber the winner's cookie

    expect((await postRefresh(t.app, rotated)).statusCode).toBe(200);
  });

  it('revokes the whole family when an old token is replayed after the grace window', async () => {
    const { user, refreshToken: stolen } = await registered();
    const otherDevice = refreshCookie(await login({ email: user.email, password: user.password }))!;
    const rotated = refreshCookie(await postRefresh(t.app, stolen))!;

    t.advance(11);
    const replay = await postRefresh(t.app, stolen);
    expect(replay.statusCode).toBe(401);
    expect(refreshCookie(replay)).toBe('');

    // The legitimate holder of the rotated token is signed out too...
    expect((await postRefresh(t.app, rotated)).statusCode).toBe(401);
    // ...but other devices (other families) are unaffected.
    expect((await postRefresh(t.app, otherDevice)).statusCode).toBe(200);
  });

  it('rejects an expired refresh token', async () => {
    const { refreshToken } = await registered();

    t.advance(31 * 24 * 60 * 60);
    expect((await postRefresh(t.app, refreshToken)).statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('clears the cookie and revokes the session', async () => {
    const { refreshToken } = await registered();
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: WEB_ORIGIN },
      cookies: { [REFRESH_COOKIE]: refreshToken },
    });

    expect(res.statusCode).toBe(204);
    expect(refreshCookie(res)).toBe('');
    expect((await postRefresh(t.app, refreshToken)).statusCode).toBe(401);
  });

  it('succeeds without a session', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: WEB_ORIGIN },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('when DynamoDB is unreachable', () => {
  it('answers 503 with Retry-After instead of hanging, and health stays green', async () => {
    const down = await createTestApp({ DYNAMODB_ENDPOINT: 'http://127.0.0.1:1' });
    try {
      const res = await down.app.inject({ method: 'POST', url: '/auth/login', payload: newUser() });
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('SERVICE_UNAVAILABLE');
      expect(res.headers['retry-after']).toBe('2');

      expect((await down.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    } finally {
      await down.app.close();
    }
  });
});
