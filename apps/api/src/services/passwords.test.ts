import { describe, expect, it } from 'vitest';
import { createPasswordService, isCommonPassword } from './passwords';

const passwords = createPasswordService(4);

describe('password service', () => {
  it('produces a salted bcrypt hash that verifies', async () => {
    const hash = await passwords.hash('correct horse battery');

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(hash).not.toContain('correct horse battery');
    expect(await passwords.verify('correct horse battery', hash)).toBe(true);
    expect(await passwords.verify('wrong horse battery', hash)).toBe(false);
  });

  it('salts each hash differently', async () => {
    const [a, b] = await Promise.all([
      passwords.hash('same password'),
      passwords.hash('same password'),
    ]);

    expect(a).not.toBe(b);
  });

  it('returns false when there is no hash (unknown or Google-only account)', async () => {
    expect(await passwords.verify('anything at all', undefined)).toBe(false);
  });
});

describe('isCommonPassword', () => {
  it('matches case-insensitively', () => {
    expect(isCommonPassword('Password123')).toBe(true);
    expect(isCommonPassword('violet-fifths-lantern')).toBe(false);
  });
});
