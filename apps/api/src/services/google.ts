import { Google } from 'arctic';
import { decodeJwt } from 'jose';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** The part of Google OAuth the routes need; tests substitute a fake. */
export interface GoogleClient {
  authorizationUrl(state: string, codeVerifier: string): URL;
  /** Exchanges the authorization code (PKCE) and returns the validated identity from the ID token. */
  exchangeCode(code: string, codeVerifier: string): Promise<GoogleIdentity>;
}

export class InvalidIdTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid Google ID token: ${reason}`);
    this.name = 'InvalidIdTokenError';
  }
}

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/**
 * The ID token arrives directly from Google's token endpoint over TLS, so OIDC Core §3.1.3.7 lets us
 * skip the signature check; the claims are still validated.
 */
export function identityFromIdToken(idToken: string, clientId: string, now: Date): GoogleIdentity {
  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(idToken);
  } catch {
    throw new InvalidIdTokenError('malformed');
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!GOOGLE_ISSUERS.has(String(claims.iss))) throw new InvalidIdTokenError('issuer');
  if (!audiences.includes(clientId)) throw new InvalidIdTokenError('audience');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) {
    throw new InvalidIdTokenError('expired');
  }
  if (typeof claims.sub !== 'string' || !claims.sub) throw new InvalidIdTokenError('subject');
  if (typeof claims.email !== 'string' || !claims.email) throw new InvalidIdTokenError('email');

  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    emailVerified: claims.email_verified === true,
    ...(typeof claims.name === 'string' && claims.name.trim() && { name: claims.name.trim() }),
  };
}

export function createGoogleClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  now: () => Date = () => new Date(),
): GoogleClient {
  const google = new Google(clientId, clientSecret, redirectUri);
  return {
    authorizationUrl(state, codeVerifier) {
      const url = google.createAuthorizationURL(state, codeVerifier, [
        'openid',
        'email',
        'profile',
      ]);
      url.searchParams.set('prompt', 'select_account');
      return url;
    },
    async exchangeCode(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      return identityFromIdToken(tokens.idToken(), clientId, now());
    },
  };
}
