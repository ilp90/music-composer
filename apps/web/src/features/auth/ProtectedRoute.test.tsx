import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithAuth, testUser } from '../../test/renderWithAuth';
import { ProtectedRoute } from './ProtectedRoute';
import { redirectTarget } from './redirect';

const routes = [
  { path: '/login', element: <p>login page</p> },
  { element: <ProtectedRoute />, children: [{ path: '/compose', element: <p>compose page</p> }] },
];

afterEach(cleanup);

describe('ProtectedRoute', () => {
  it('waits while the session is being restored', () => {
    renderWithAuth(routes, { status: 'loading' }, '/compose');

    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  it('sends anonymous users to /login, remembering where they were going', async () => {
    const { router } = renderWithAuth(routes, { status: 'anonymous' }, '/compose');

    expect(await screen.findByText('login page')).toBeTruthy();
    expect(router.state.location.state).toEqual({ from: '/compose' });
  });

  it('renders the page for signed-in users', () => {
    renderWithAuth(routes, { status: 'authenticated', user: testUser }, '/compose');

    expect(screen.getByText('compose page')).toBeTruthy();
  });
});

describe('redirectTarget', () => {
  it('only follows same-site paths', () => {
    expect(redirectTarget({ from: '/compose' })).toBe('/compose');
    expect(redirectTarget({ from: '//evil.example' })).toBe('/compose');
    expect(redirectTarget({ from: 'https://evil.example' })).toBe('/compose');
    expect(redirectTarget(null)).toBe('/compose');
  });
});
