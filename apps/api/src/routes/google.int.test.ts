import { randomUUID } from 'node:crypto';
import { AuthResponse } from '@mc/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  newUser,
  postRefresh,
  refreshCookie,
  uniqueEmail,
  type TestApp,
} from '../../test/testApp';
import type { GoogleClient, GoogleIdentity } from '../services/google';
import { OAUTH_COOKIE, safeReturnTo } from './google';

/** Stands in for Google: the "authorization code" is a key into identities the test registers. */
function fakeGoogle() {
  const identities = new Map<string, GoogleIdentity>();
  const exchanges: Array<{ code: string; codeVerifier: string }> = [];
  const client: GoogleClient = {
    authorizationUrl(state, codeVerifier) {
      const url = new URL('https://accounts.google.test/auth');
      url.searchParams.set('state', state);
      url.searchParams.set('verifier', codeVerifier); // test-only: lets the test see what was stored
      return url;
    },
    async exchangeCode(code, codeVerifier) {
      exchanges.push({ code, codeVerifier });
      const identity = identities.get(code);
      if (!identity) throw new Error('invalid_grant');
      return identity;
    },
  };
  const codeFor = (identity: Partial<GoogleIdentity> = {}) => {
    const code = randomUUID();
    identities.set(code, {
      sub: randomUUID(),
      email: uniqueEmail(),
      emailVerified: true,
      name: 'Grace Hopper',
      ...identity,
    });
    return code;
  };
  return { client, codeFor, exchanges };
}

let t: TestApp;
const google = fakeGoogle();

beforeAll(async () => {
  t = await createTestApp({}, { google: google.client });
});

afterAll(async () => {
  await t.app.close();
});

/** Runs /start like the browser would and returns what the callback needs. */
async function start(returnTo?: string) {
  const res = await t.app.inject({
    method: 'GET',
    url: '/auth/google/start',
    ...(returnTo !== undefined && { query: { returnTo } }),
  });
  const location = new URL(res.headers.location as string);
  const cookie = res.cookies.find((c) => c.name === OAUTH_COOKIE)!;
  return {
    res,
    cookie,
    state: location.searchParams.get('state')!,
    verifier: location.searchParams.get('verifier')!,
  };
}

function callback(query: Record<string, string>, oauthCookie?: string) {
  return t.app.inject({
    method: 'GET',
    url: '/auth/google/callback',
    query,
    ...(oauthCookie !== undefined && { cookies: { [OAUTH_COOKIE]: oauthCookie } }),
  });
}

/** Full sign-in: start → (Google) → callback. */
async function signInWithGoogle(code: string, returnTo?: string) {
  const { cookie, state } = await start(returnTo);
  return callback({ code, state }, cookie.value);
}

async function userFromSession(refreshToken: string) {
  const res = await postRefresh(t.app, refreshToken);
  expect(res.statusCode).toBe(200);
  return AuthResponse.parse(res.json()).user;
}

describe('GET /auth/google/start', () => {
  it('redirects to Google and stores state + PKCE verifier in a short-lived Lax cookie', async () => {
    const { res, cookie, state, verifier } = await start('/compose');

    expect(res.statusCode).toBe(302);
    expect(state).toBeTruthy();
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/auth/google/callback',
      maxAge: 600,
    });
    expect(JSON.parse(cookie.value)).toEqual({
      state,
      codeVerifier: verifier,
      returnTo: '/compose',
    });
  });
});

describe('GET /auth/google/callback', () => {
  it('creates an account for a new Google user, starts a session and returns to the app', async () => {
    const email = uniqueEmail();
    const res = await signInWithGoogle(google.codeFor({ email, name: 'Grace Hopper' }));

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/compose');
    expect(res.cookies.find((c) => c.name === OAUTH_COOKIE)?.value).toBe(''); // one-time use

    const user = await userFromSession(refreshCookie(res)!);
    expect(user).toMatchObject({ email, displayName: 'Grace Hopper' });
  });

  it('passes the stored PKCE verifier to the code exchange', async () => {
    const code = google.codeFor();
    const { cookie, state, verifier } = await start();
    await callback({ code, state }, cookie.value);

    expect(google.exchanges.at(-1)).toEqual({ code, codeVerifier: verifier });
  });

  it('signs a returning Google user into the same account', async () => {
    const sub = randomUUID();
    const first = await signInWithGoogle(google.codeFor({ sub }));
    const second = await signInWithGoogle(google.codeFor({ sub }));

    expect((await userFromSession(refreshCookie(second)!)).id).toBe(
      (await userFromSession(refreshCookie(first)!)).id,
    );
  });

  it('links Google to an existing password account with the same verified email', async () => {
    const password = newUser();
    const registered = AuthResponse.parse(
      (await t.app.inject({ method: 'POST', url: '/auth/register', payload: password })).json(),
    );

    const res = await signInWithGoogle(google.codeFor({ email: password.email }));
    expect((await userFromSession(refreshCookie(res)!)).id).toBe(registered.user.id);

    // Password sign-in still works after linking.
    const login = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: password.email, password: password.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses to link a second Google account to the same email', async () => {
    const email = uniqueEmail();
    await signInWithGoogle(google.codeFor({ email }));
    const res = await signInWithGoogle(google.codeFor({ email }));

    expect(res.headers.location).toBe('http://localhost:5173/login?error=google_account_conflict');
    expect(refreshCookie(res)).toBeUndefined();
  });

  it('rejects an unverified Google email without creating an account', async () => {
    const email = uniqueEmail();
    const res = await signInWithGoogle(google.codeFor({ email, emailVerified: false }));

    expect(res.headers.location).toBe('http://localhost:5173/login?error=google_email_unverified');
    expect(refreshCookie(res)).toBeUndefined();
    const register = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...newUser(), email },
    });
    expect(register.statusCode).toBe(201); // the email was never claimed
  });

  it('rejects a mismatched state (login CSRF)', async () => {
    const { cookie } = await start();
    const res = await callback({ code: google.codeFor(), state: 'attacker-state' }, cookie.value);

    expect(res.headers.location).toBe('http://localhost:5173/login?error=google_failed');
    expect(refreshCookie(res)).toBeUndefined();
  });

  it('rejects a callback without the state cookie', async () => {
    const { state } = await start();
    const res = await callback({ code: google.codeFor(), state });

    expect(res.headers.location).toBe('http://localhost:5173/login?error=google_failed');
  });

  it('reports a cancelled consent screen', async () => {
    const { cookie, state } = await start();
    const res = await callback({ error: 'access_denied', state }, cookie.value);

    expect(res.headers.location).toBe('http://localhost:5173/login?error=google_cancelled');
  });

  it('reports a failed code exchange', async () => {
    const res = await signInWithGoogle('unknown-code');

    expect(res.headers.location).toBe('http://localhost:5173/login?error=google_failed');
  });

  it('honours a same-site returnTo and ignores off-site ones', async () => {
    const same = await signInWithGoogle(google.codeFor(), '/recordings');
    const offSite = await signInWithGoogle(google.codeFor(), '//evil.example/phish');

    expect(same.headers.location).toBe('http://localhost:5173/recordings');
    expect(offSite.headers.location).toBe('http://localhost:5173/compose');
  });
});

describe('when Google credentials are not configured', () => {
  it('sends users back to sign-in with a clear reason', async () => {
    const off = await createTestApp({}, { google: null });
    try {
      for (const url of ['/auth/google/start', '/auth/google/callback?code=x&state=y']) {
        const res = await off.app.inject({ method: 'GET', url });
        expect(res.headers.location).toBe('http://localhost:5173/login?error=google_unavailable');
      }
    } finally {
      await off.app.close();
    }
  });
});

describe('safeReturnTo', () => {
  it('allows only same-site paths', () => {
    expect(safeReturnTo('/compose')).toBe('/compose');
    expect(safeReturnTo('/recordings?page=2')).toBe('/recordings?page=2');
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '/login',
      '',
      42,
    ]) {
      expect(safeReturnTo(bad)).toBe('/compose');
    }
  });
});
