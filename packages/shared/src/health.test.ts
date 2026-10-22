import { describe, expect, it } from 'vitest';
import { HealthResponse } from './health';

describe('HealthResponse', () => {
  it('accepts a valid payload', () => {
    expect(HealthResponse.parse({ status: 'ok', uptimeSeconds: 12.5 })).toEqual({
      status: 'ok',
      uptimeSeconds: 12.5,
    });
  });

  it('rejects an unexpected status', () => {
    expect(HealthResponse.safeParse({ status: 'down', uptimeSeconds: 1 }).success).toBe(false);
  });
});
