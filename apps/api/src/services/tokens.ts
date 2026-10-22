import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWK,
} from 'jose';

const ALG = 'ES256';
const AUDIENCE = 'music-composer-api';

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  ephemeral: boolean;
}

/** Loads the ES256 signing key from a private JWK, or generates a throwaway one (dev/test only, enforced in config). */
export async function loadSigningKey(privateJwkJson: string | undefined): Promise<SigningKey> {
  if (!privateJwkJson) {
    const { privateKey, publicKey } = await generateKeyPair(ALG);
    return { kid: `ephemeral-${randomUUID()}`, privateKey, publicKey, ephemeral: true };
  }

  const jwk = JSON.parse(privateJwkJson) as JWK;
  if (!jwk.kid || !jwk.d) throw new Error('JWT_PRIVATE_JWK must be a private EC JWK with a "kid"');
  const { d: _private, ...publicJwk } = jwk;
  return {
    kid: jwk.kid,
    privateKey: (await importJWK(jwk, ALG)) as CryptoKey,
    publicKey: (await importJWK(publicJwk, ALG)) as CryptoKey,
    ephemeral: false,
  };
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super('Invalid access token');
    this.name = 'InvalidAccessTokenError';
  }
}

/**
 * Access tokens are short-lived JWTs verified locally with the public key, so authenticated requests
 * need no database round trip and keep working while DynamoDB is degraded (SPEC §5).
 */
export function createTokenService(key: SigningKey, issuer: string, accessTtlSeconds: number) {
  return {
    accessTtlSeconds,

    async signAccessToken(userId: string): Promise<string> {
      return new SignJWT({})
        .setProtectedHeader({ alg: ALG, kid: key.kid })
        .setSubject(userId)
        .setIssuer(issuer)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${accessTtlSeconds}s`)
        .setJti(randomUUID())
        .sign(key.privateKey);
    },

    /** Returns the user id (`sub`). */
    async verifyAccessToken(token: string): Promise<string> {
      try {
        const { payload } = await jwtVerify(token, key.publicKey, {
          algorithms: [ALG],
          issuer,
          audience: AUDIENCE,
        });
        if (!payload.sub) throw new InvalidAccessTokenError();
        return payload.sub;
      } catch {
        throw new InvalidAccessTokenError();
      }
    },

    /** Public JWK set, for publishing at a JWKS endpoint later if other services need to verify tokens. */
    async publicJwks() {
      return {
        keys: [{ ...(await exportJWK(key.publicKey)), kid: key.kid, alg: ALG, use: 'sig' }],
      };
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;

const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('base64url');

/**
 * Opaque refresh token: `<userId>.<256 random bits>`. The user id (not secret) locates the DynamoDB
 * partition; only the SHA-256 of the secret part is stored.
 */
export function generateRefreshToken(userId: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${userId}.${secret}`, hash: hashSecret(secret) };
}

export function parseRefreshToken(
  token: string | undefined,
): { userId: string; hash: string } | undefined {
  const match = token && /^([0-9A-HJKMNP-TV-Z]{26})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return undefined;
  return { userId: match[1]!, hash: hashSecret(match[2]!) };
}
