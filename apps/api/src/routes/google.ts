import { generateCodeVerifier, generateState } from 'arctic';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Config } from '../config';
import {
  EmailTakenError,
  GoogleLinkConflictError,
  type UserRecord,
  type UsersRepository,
} from '../repositories/users';
import type { GoogleClient, GoogleIdentity } from '../services/google';
import type { SessionService } from '../services/sessions';

export const OAUTH_COOKIE = 'mc_oauth';

/** Reasons shown on /login?error=… after a failed Google sign-in (the web app maps them to messages). */
export type GoogleSignInError =
  | 'google_unavailable'
  | 'google_cancelled'
  | 'google_failed'
  | 'google_email_unverified'
  | 'google_account_conflict';

export interface GoogleRoutesOptions {
  config: Config;
  /** Undefined when Google credentials aren't configured: the routes then report it as unavailable. */
  google: GoogleClient | undefined;
  users: UsersRepository;
  sessions: SessionService;
  now: () => Date;
}

const OAuthCookie = z.object({ state: z.string(), codeVerifier: z.string(), returnTo: z.string() });

const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

/** Same-site path to land on after sign-in; anything else (absolute or protocol-relative URLs) goes to /compose. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && !value.startsWith('/login')
    ? value
    : '/compose';
}

function displayNameFor(identity: GoogleIdentity): string {
  return (identity.name ?? identity.email.split('@')[0] ?? 'Musician').slice(0, 50);
}

export const googleRoutes: FastifyPluginAsync<GoogleRoutesOptions> = async (app, opts) => {
  const { config, google, users, sessions, now } = opts;

  // Lax, not Strict: the callback is a top-level navigation *from Google*, and Strict cookies aren't sent on it.
  const oauthCookieOptions = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: new URL(config.GOOGLE_REDIRECT_URI).pathname,
  } as const;

  const appUrl = (path: string) => new URL(path, config.CORS_ORIGIN).toString();
  const fail = (reply: FastifyReply, reason: GoogleSignInError) =>
    reply.redirect(appUrl(`/login?error=${reason}`));

  /** Signed in with this Google account before → that user; same verified email → link; else a new account. */
  async function findOrCreateUser(identity: GoogleIdentity): Promise<UserRecord> {
    const linked = await users.findByGoogleSub(identity.sub);
    if (linked) return linked;

    const byEmail = await users.findByEmail(identity.email);
    if (byEmail) {
      if (byEmail.googleSub) throw new GoogleLinkConflictError();
      // Safe only because Google verified the email (checked by the caller).
      await users.linkGoogle(byEmail.id, identity.sub);
      return { ...byEmail, googleSub: identity.sub };
    }

    const user: UserRecord = {
      id: ulid(),
      email: identity.email,
      displayName: displayNameFor(identity),
      googleSub: identity.sub,
      createdAt: now().toISOString(),
    };
    await users.create(user);
    return user;
  }

  app.get('/auth/google/start', async (request, reply) => {
    if (!google) return fail(reply, 'google_unavailable');

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const { returnTo } = request.query as { returnTo?: unknown };
    reply.setCookie(
      OAUTH_COOKIE,
      JSON.stringify({ state, codeVerifier, returnTo: safeReturnTo(returnTo) }),
      { ...oauthCookieOptions, maxAge: 10 * 60 },
    );
    return reply.redirect(google.authorizationUrl(state, codeVerifier).toString());
  });

  app.get('/auth/google/callback', async (request, reply) => {
    // One-time use, whatever the outcome.
    reply.clearCookie(OAUTH_COOKIE, oauthCookieOptions);
    if (!google) return fail(reply, 'google_unavailable');

    const query = CallbackQuery.safeParse(request.query);
    const saved = OAuthCookie.safeParse(
      (() => {
        try {
          return JSON.parse(request.cookies[OAUTH_COOKIE] ?? '');
        } catch {
          return null;
        }
      })(),
    );

    if (!query.success) return fail(reply, 'google_failed');
    if (query.data.error) {
      return fail(
        reply,
        query.data.error === 'access_denied' ? 'google_cancelled' : 'google_failed',
      );
    }
    // `state` ties the callback to the browser that started the flow (login CSRF defense).
    if (!saved.success || !query.data.code || query.data.state !== saved.data.state) {
      return fail(reply, 'google_failed');
    }

    let identity: GoogleIdentity;
    try {
      identity = await google.exchangeCode(query.data.code, saved.data.codeVerifier);
    } catch (err) {
      request.log.warn({ err }, 'google code exchange failed');
      return fail(reply, 'google_failed');
    }
    if (!identity.emailVerified) return fail(reply, 'google_email_unverified');

    let user: UserRecord;
    try {
      user = await findOrCreateUser(identity);
    } catch (err) {
      if (err instanceof GoogleLinkConflictError) return fail(reply, 'google_account_conflict');
      // A concurrent sign-up took the email between our lookup and write; a retry will link instead.
      if (err instanceof EmailTakenError) return fail(reply, 'google_failed');
      throw err;
    }

    await sessions.start(reply, user);
    return reply.redirect(appUrl(saved.data.returnTo));
  });
};
