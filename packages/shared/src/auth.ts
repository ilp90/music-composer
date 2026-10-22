import { z } from 'zod';

/** bcrypt only hashes the first 72 bytes, so longer passwords are rejected rather than silently truncated. */
export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 72;

/** UTF-8 byte length (what bcrypt sees), without depending on TextEncoder typings. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email'));

export const NewPassword = z
  .string()
  .min(PASSWORD_MIN_CHARS, `Use at least ${PASSWORD_MIN_CHARS} characters`)
  .refine((p) => utf8ByteLength(p) <= PASSWORD_MAX_BYTES, {
    message: `Use at most ${PASSWORD_MAX_BYTES} bytes`,
  });

export const DisplayName = z
  .string()
  .trim()
  .min(1, 'Enter a display name')
  .max(50, 'Use at most 50 characters');

export const RegisterBody = z.object({
  email: Email,
  password: NewPassword,
  displayName: DisplayName,
});
export type RegisterBody = z.input<typeof RegisterBody>;

/** No password policy on login: the policy may change after an account was created. */
export const LoginBody = z.object({
  email: Email,
  password: z.string().min(1, 'Enter your password').max(1024),
});
export type LoginBody = z.input<typeof LoginBody>;

export const User = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof User>;

/** Returned by register, login and refresh. The refresh token travels only in an httpOnly cookie. */
export const AuthResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: User,
});
export type AuthResponse = z.infer<typeof AuthResponse>;
