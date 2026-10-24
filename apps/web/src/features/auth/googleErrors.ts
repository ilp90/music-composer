// Reasons the API's Google callback puts in /login?error=… (see GoogleSignInError in apps/api/src/routes/google.ts).
const MESSAGES: Record<string, string> = {
  google_unavailable:
    'Google sign-in isn’t available right now. Use your email and password instead.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in didn’t complete. Please try again.',
  google_email_unverified:
    'Your Google account’s email isn’t verified, so we can’t use it to sign in.',
  google_account_conflict:
    'This email is already linked to a different Google account. Sign in with that account or with your password.',
};

export function googleErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? null;
}
