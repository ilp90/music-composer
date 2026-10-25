import { describe, expect, it } from 'vitest';
import { cameraErrorKind } from './camera';

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('cameraErrorKind', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['OverconstrainedError', 'not-found'],
    ['NotReadableError', 'in-use'],
    ['AbortError', 'in-use'],
    ['TypeError', 'unknown'],
  ])('maps %s to %s', (name, kind) => {
    expect(cameraErrorKind(domError(name))).toBe(kind);
  });

  it('handles non-errors', () => {
    expect(cameraErrorKind(null)).toBe('unknown');
    expect(cameraErrorKind('boom')).toBe('unknown');
  });
});
