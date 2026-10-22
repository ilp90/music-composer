/** Where to go after signing in: back to the protected page that sent the user here, else Compose. */
export function redirectTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
    ? from
    : '/compose';
}
