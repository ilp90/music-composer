import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithAuth, testUser } from '../test/renderWithAuth';
import { HomePage } from './HomePage';

const routes = [{ path: '/', element: <HomePage /> }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HomePage', () => {
  it('shows healthy when /healthz succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'ok', uptimeSeconds: 3 })),
    );

    renderWithAuth(routes, { status: 'anonymous' });

    expect(await screen.findByText('API: healthy')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/healthz', expect.objectContaining({ method: 'GET' }));
  });

  it('shows unreachable when /healthz fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad gateway', { status: 502 })),
    );

    renderWithAuth(routes, { status: 'anonymous' });

    expect(await screen.findByText('API: unreachable')).toBeTruthy();
  });

  it('offers sign-up and sign-in to visitors, and the composer to signed-in users', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'ok', uptimeSeconds: 3 })),
    );

    renderWithAuth(routes, { status: 'anonymous' });
    expect(screen.getByRole('link', { name: 'Get started' }).getAttribute('href')).toBe(
      '/register',
    );
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    cleanup();

    renderWithAuth(routes, { status: 'authenticated', user: testUser });
    expect(screen.getByRole('link', { name: 'Open composer' }).getAttribute('href')).toBe(
      '/compose',
    );
  });
});
