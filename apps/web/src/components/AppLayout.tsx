import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../features/auth/authContext';
import { UploadQueueRunner } from '../features/recordings/UploadQueueRunner';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 transition ${isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-100'}`;

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
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link to="/compose" className="hidden font-semibold tracking-tight sm:block">
            Music Composer
          </Link>
          <nav aria-label="Main" className="flex gap-1 text-sm">
            <NavLink to="/compose" className={navLinkClass}>
              Compose
            </NavLink>
            <NavLink to="/recordings" className={navLinkClass}>
              My recordings
            </NavLink>
          </nav>
        </div>
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
      {user && <UploadQueueRunner userId={user.id} />}
      <Suspense
        fallback={
          <div role="status" className="flex flex-1 items-center justify-center text-slate-400">
            Loading…
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </div>
  );
}
