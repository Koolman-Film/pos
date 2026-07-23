import { describe, it, expect } from 'vitest';

describe('project scaffold', () => {
  it('sanity check', () => {
    expect(1 + 1).toBe(2);
  });
  it('runs in a jsdom environment (document is defined)', () => {
    expect(typeof document).not.toBe('undefined');
  });
});
