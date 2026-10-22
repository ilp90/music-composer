import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
      <div className="w-full max-w-sm">
        <Link
          to="/"
          className="mb-8 block text-center text-lg font-semibold tracking-tight text-slate-300"
        >
          Music Composer
        </Link>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
          {children}
        </div>
        <p className="mt-6 text-center text-sm text-slate-400">{footer}</p>
      </div>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-rose-900 bg-rose-950/60 px-3 py-2 text-sm text-rose-300"
    >
      {message}
    </p>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
    >
      {children}
    </button>
  );
}
