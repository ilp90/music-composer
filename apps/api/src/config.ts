import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    // The web app's origin: allowed by CORS and required on cookie-authenticated POSTs (CSRF defense).
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    AWS_REGION: z.string().default('us-east-1'),
    // Only set locally (DynamoDB Local / RustFS). Unset in AWS so the SDK resolves real endpoints.
    DYNAMODB_ENDPOINT: z.url().optional(),
    DYNAMODB_TABLE: z.string().default('app'),
    S3_ENDPOINT: z.url().optional(),
    S3_BUCKET: z.string().default('recordings'),

    // Private ES256 JWK as one line of JSON, including "kid". Generate with `pnpm --filter @mc/api keys:generate`.
    // Optional outside production: an ephemeral key is generated at startup.
    JWT_PRIVATE_JWK: z.string().optional(),
    JWT_ISSUER: z.string().default('music-composer'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // A refresh token reused within this window is treated as a benign race (e.g. a retried request), not theft.
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(10),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    COOKIE_SECURE: z.stringbool().default(true),
    // Path as the browser sees it: the SPA calls the API under /api.
    COOKIE_PATH: z.string().default('/api/auth'),
    LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(10),
    LOGIN_FAILURE_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60),

    // Google sign-in is enabled only when both are set; email/password works regardless.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // Must exactly match an "Authorized redirect URI" of the OAuth client. In production:
    // https://<app domain>/api/auth/google/callback (CloudFront strips /api).
    GOOGLE_REDIRECT_URI: z.url().default('http://localhost:3000/auth/google/callback'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.JWT_PRIVATE_JWK) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_PRIVATE_JWK'],
        message: 'required in production',
      });
    }
    if (env.BCRYPT_COST < 12) {
      ctx.addIssue({
        code: 'custom',
        path: ['BCRYPT_COST'],
        message: 'must be >= 12 in production',
      });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
