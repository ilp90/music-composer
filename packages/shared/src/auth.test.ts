import { describe, expect, it } from 'vitest';
import { LoginBody, RegisterBody } from './auth';

const valid = { email: '  Ada@Example.COM ', password: 'correct horse', displayName: ' Ada ' };

describe('RegisterBody', () => {
  it('normalizes email and display name', () => {
    expect(RegisterBody.parse(valid)).toEqual({
      email: 'ada@example.com',
      password: 'correct horse',
      displayName: 'Ada',
    });
  });

  it('rejects an invalid email', () => {
    expect(RegisterBody.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(RegisterBody.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('measures the 72 limit in bytes, not characters', () => {
    expect(RegisterBody.safeParse({ ...valid, password: 'a'.repeat(72) }).success).toBe(true);
    expect(RegisterBody.safeParse({ ...valid, password: 'a'.repeat(73) }).success).toBe(false);
    // 'é' is 2 bytes in UTF-8: 37 chars = 74 bytes.
    expect(RegisterBody.safeParse({ ...valid, password: 'é'.repeat(37) }).success).toBe(false);
  });

  it('rejects a blank display name', () => {
    expect(RegisterBody.safeParse({ ...valid, displayName: '   ' }).success).toBe(false);
  });
});

describe('LoginBody', () => {
  it('does not apply the new-password policy', () => {
    expect(LoginBody.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});
