import bcrypt from 'bcrypt';
import { COMMON_PASSWORDS } from './commonPasswords';

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * bcrypt generates a random per-password salt and embeds it (with the cost) in the returned hash string,
 * so the hash is the only thing stored. Hashing runs on libuv's threadpool, not the event loop.
 */
export function createPasswordService(cost: number) {
  // Compared against when the account doesn't exist, so a login for an unknown email
  // takes as long as one with a wrong password (no account enumeration by timing).
  const dummyHash = bcrypt.hash('dummy-password-for-timing', cost);

  return {
    hash(password: string): Promise<string> {
      return bcrypt.hash(password, cost);
    },

    /** Always runs one bcrypt compare, whether or not a hash exists. */
    async verify(password: string, hash: string | undefined): Promise<boolean> {
      const matches = await bcrypt.compare(password, hash ?? (await dummyHash));
      return hash !== undefined && matches;
    },
  };
}

export type PasswordService = ReturnType<typeof createPasswordService>;
