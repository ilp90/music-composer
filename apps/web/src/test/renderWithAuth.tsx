import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';
import { AuthContext, type AuthContextValue, type AuthState } from '../features/auth/authContext';

export const testUser = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  createdAt: '2026-10-22T00:00:00.000Z',
};

/** Renders routes with a stubbed auth context, so components are tested without the network. */
export function renderWithAuth(routes: RouteObject[], state: AuthState, initialPath = '/') {
  const auth: AuthContextValue = {
    state,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <AuthContext value={auth}>{node}</AuthContext>
    </QueryClientProvider>
  );
  return { auth, router, ...render(wrap(<RouterProvider router={router} />)) };
}
