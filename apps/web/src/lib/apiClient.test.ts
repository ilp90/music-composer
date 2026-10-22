import { User } from '@mc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, onSessionExpired, refreshSession, setAccessToken } from './apiClient';

const user = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  createdAt: '2026-10-22T00:00:00.000Z',
};

const authResponse = (accessToken: string) => Response.json({ accessToken, expiresIn: 900, user });
const error = (status: number, code: string, message = code) =>
  Response.json({ code, message }, { status });

/** Fake API: /me accepts only the "fresh" token; /auth/refresh issues it (or fails, per `refreshResult`). */
function fakeApi(refreshResult: () => Response = () => authResponse('fresh')) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(url);
    const auth = (init.headers as Record<string, string>).authorization;
    if (url === '/api/auth/refresh') return refreshResult();
    if (url === '/api/me')
      return auth === 'Bearer fresh' ? Response.json(user) : error(401, 'UNAUTHENTICATED');
    return error(404, 'NOT_FOUND');
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('sends the access token as a Bearer header', async () => {
    const { fetchMock } = fakeApi();
    setAccessToken('fresh');

    expect(await api.get('/me', User)).toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({
        headers: { authorization: 'Bearer fresh' },
        credentials: 'include',
      }),
    );
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const { calls } = fakeApi();
    setAccessToken('stale');

    expect(await api.get('/me', User)).toEqual(user);
    expect(calls).toEqual(['/api/me', '/api/auth/refresh', '/api/me']);
  });

  it('shares one refresh between concurrent 401s (refresh tokens rotate)', async () => {
    const { calls } = fakeApi();
    setAccessToken('stale');

    await Promise.all([api.get('/me', User), api.get('/me', User), api.get('/me', User)]);

    expect(calls.filter((url) => url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('signals session expiry when the refresh is rejected', async () => {
    fakeApi(() => error(401, 'INVALID_REFRESH_TOKEN'));
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    setAccessToken('stale');

    await expect(api.get('/me', User)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(expired).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('maps error bodies to ApiError with field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { code: 'EMAIL_TAKEN', message: 'taken', fieldErrors: { email: ['taken'] } },
          { status: 409 },
        ),
      ),
    );

    const err = await api
      .post('/auth/register', {}, User, { auth: false })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      code: 'EMAIL_TAKEN',
      fieldErrors: { email: ['taken'] },
    });
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await expect(api.get('/me', User)).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});

describe('refreshSession', () => {
  it('resolves null without a valid session', async () => {
    fakeApi(() => error(401, 'INVALID_REFRESH_TOKEN'));

    expect(await refreshSession()).toBeNull();
  });

  it('stores the new access token', async () => {
    fakeApi();

    expect((await refreshSession())?.user).toEqual(user);
    expect(await api.get('/me', User)).toEqual(user);
  });
});
