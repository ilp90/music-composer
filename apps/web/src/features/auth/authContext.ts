import type { LoginBody, RegisterBody, User } from '@mc/shared';
import { createContext, useContext } from 'react';

export type AuthState =
  { status: 'loading' } | { status: 'authenticated'; user: User } | { status: 'anonymous' };

export interface AuthContextValue {
  state: AuthState;
  login(body: LoginBody): Promise<void>;
  register(body: RegisterBody): Promise<void>;
  logout(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
