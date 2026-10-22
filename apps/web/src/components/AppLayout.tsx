import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../features/auth/authContext';

/** Shell for signed-in pages. Rendered inside ProtectedRoute, so the user is always present. */
export function AppLayout() {
  const { state, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const user = state.status === 'authenticated' ? state.user : null;

  async function onSignOut() {
    setSigningOut(true);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3">
        <Link to="/compose" className="font-semibold tracking-tight">
          Music Composer
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="truncate text-slate-400" data-testid="current-user">
            {user?.displayName}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 transition hover:bg-slate-800 disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
