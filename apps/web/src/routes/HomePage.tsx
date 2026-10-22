import { HealthResponse } from '@mc/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../features/auth/authContext';
import { api } from '../lib/apiClient';

const primaryLink =
  'rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500';
const secondaryLink =
  'rounded-lg border border-slate-700 px-5 py-2.5 transition hover:bg-slate-800';

export function HomePage() {
  const { state } = useAuth();
  const health = useQuery({
    queryKey: ['healthz'],
    queryFn: () => api.get('/healthz', HealthResponse, { auth: false }),
  });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 p-4 text-center text-slate-100">
      <h1 className="text-4xl font-semibold tracking-tight">Music Composer</h1>
      <p className="text-slate-400">Point at the circle of fifths. Make music.</p>

      <nav className="flex flex-wrap justify-center gap-3">
        {state.status === 'authenticated' ? (
          <Link to="/compose" className={primaryLink}>
            Open composer
          </Link>
        ) : (
          <>
            <Link to="/register" className={primaryLink}>
              Get started
            </Link>
            <Link to="/login" className={secondaryLink}>
              Sign in
            </Link>
          </>
        )}
      </nav>

      <p role="status" className="rounded-full border border-slate-700 px-4 py-1 text-sm">
        {health.isPending && 'API: checking…'}
        {health.isSuccess && <span className="text-emerald-400">API: healthy</span>}
        {health.isError && <span className="text-rose-400">API: unreachable</span>}
      </p>
    </main>
  );
}
