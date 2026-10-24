import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoogleClient, identityFromIdToken } from './google';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NOW = new Date('2026-10-23T12:00:00Z');

/** Google signs real ID tokens; the signature isn't checked (token comes straight from Google over TLS). */
function idToken(claims: Record<string, unknown>) {
  return new SignJWT({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'Ada@Example.com',
    email_verified: true,
    name: 'Ada Lovelace',
    exp: Math.floor(NOW.getTime() / 1000) + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode('not-googles-key'));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('identityFromIdToken', () => {
  it('returns the identity with a normalized email', async () => {
    expect(identityFromIdToken(await idToken({}), CLIENT_ID, NOW)).toEqual({
      sub: '1234567890',
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada Lovelace',
    });
  });

  it('reports unverified emails', async () => {
    const identity = identityFromIdToken(await idToken({ email_verified: false }), CLIENT_ID, NOW);
    expect(identity.emailVerified).toBe(false);
  });

  it.each([
    ['issuer', { iss: 'https://evil.example' }],
    ['audience', { aud: 'someone-elses-client' }],
    ['expired', { exp: Math.floor(NOW.getTime() / 1000) - 1 }],
    ['subject', { sub: '' }],
    ['email', { email: undefined }],
  ])('rejects a bad %s', async (reason, claims) => {
    const token = await idToken(claims);
    expect(() => identityFromIdToken(token, CLIENT_ID, NOW)).toThrow(reason);
  });

  it('rejects garbage', () => {
    expect(() => identityFromIdToken('not-a-jwt', CLIENT_ID, NOW)).toThrow('malformed');
  });
});

describe('createGoogleClient', () => {
  const client = createGoogleClient(
    CLIENT_ID,
    'test-secret',
    'http://localhost:3000/auth/google/callback',
    () => NOW,
  );

  it('builds an authorization URL with PKCE (S256), state, scopes and the account chooser', () => {
    const url = client.authorizationUrl('the-state', 'the-verifier-'.padEnd(43, 'x'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: 'http://localhost:3000/auth/google/callback',
      state: 'the-state',
      code_challenge_method: 'S256',
      scope: 'openid email profile',
      prompt: 'select_account',
    });
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('exchanges the code at the token endpoint and returns the identity (mocked Google)', async () => {
    const token = await idToken({});
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://oauth2.googleapis.com/token');
      const body = new URLSearchParams(await request.text());
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('code_verifier')).toBe('the-verifier');
      return Response.json({
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: token,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.exchangeCode('auth-code', 'the-verifier')).resolves.toMatchObject({
      sub: '1234567890',
      email: 'ada@example.com',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('fails when Google rejects the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })),
    );

    await expect(client.exchangeCode('used-code', 'v')).rejects.toThrow();
  });
});
