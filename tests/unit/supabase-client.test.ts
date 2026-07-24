import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

describe('supabase browser client', () => {
  it('constructs without throwing', async () => {
    const { createClient } = await import('@/lib/supabase/client');
    expect(() => createClient()).not.toThrow();
  });
});
