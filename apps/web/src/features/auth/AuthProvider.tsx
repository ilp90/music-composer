import { AuthResponse, type LoginBody, type RegisterBody } from '@mc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionExpired, refreshSession, setAccessToken } from '../../lib/apiClient';
import { AuthContext, type AuthContextValue, type AuthState } from './authContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  // Restore the session from the refresh cookie on page load.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .catch(() => null)
      .then((session) => {
        if (cancelled) return;
        setState(
          session ? { status: 'authenticated', user: session.user } : { status: 'anonymous' },
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onSessionExpired(() => {
        setState({ status: 'anonymous' });
        queryClient.clear();
      }),
    [queryClient],
  );

  const startSession = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setState({ status: 'authenticated', user: session.user });
  }, []);

  const login = useCallback(
    async (body: LoginBody) => {
      startSession(await api.post('/auth/login', body, AuthResponse, { auth: false }));
    },
    [startSession],
  );

  const register = useCallback(
    async (body: RegisterBody) => {
      startSession(await api.post('/auth/register', body, AuthResponse, { auth: false }));
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, undefined, { auth: false });
    } catch {
      // Signing out locally must always work, even if the API is unreachable.
    }
    setAccessToken(null);
    setState({ status: 'anonymous' });
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, register, logout }),
    [state, login, register, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
