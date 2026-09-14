// tests/rls/alert_acknowledgements.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import {
  type PosClient,
  adminClient,
  assertNoError,
  createAuthUser,
  deleteAuthUserByEmail,
  supabaseAnonKey,
  supabaseUrl,
} from './_helpers';

import type { Database } from '@/lib/types/database';

/**
 * การแจ้งเตือน (migration 0058).
 *
 * "รับทราบ · ซ่อนถึงพรุ่งนี้" is a row per person per day. Nobody else may read
 * it or write one in their name — otherwise one person could silence another's
 * reminders. And one login can belong to only one sales rep, or "my customers"
 * would quietly mean two people's.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const A_EMAIL = 'alerts0058-a@test.local';
const B_EMAIL = 'alerts0058-b@test.local';
const DAY = '2026-09-14';

let asA: PosClient;
let asB: PosClient;
let aId: string;
let bId: string;

async function makeUser(email: string, role: string) {
  await deleteAuthUserByEmail(admin, email);
  const user = await createAuthUser(admin, email, PASSWORD);
  assertNoError(
    `app_users ${email}`,
    (
      await admin.from('app_users').insert({
        id: user.id,
        email,
        name: email,
        role_id: role,
        active: true,
        sees_all_shops: true,
      })
    ).error,
  );
  const client = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assertNoError(
    `sign in ${email}`,
    (await client.auth.signInWithPassword({ email, password: PASSWORD })).error,
  );
  return { id: user.id, client };
}

beforeAll(async () => {
  ({ id: aId, client: asA } = await makeUser(A_EMAIL, 'admin'));
  ({ id: bId, client: asB } = await makeUser(B_EMAIL, 'sales'));
});

afterAll(async () => {
  await admin.from('sales_people').delete().like('name', 'TEST-0058%');
  await deleteAuthUserByEmail(admin, A_EMAIL);
  await deleteAuthUserByEmail(admin, B_EMAIL);
});

describe('alert_acknowledgements — ของใครของมัน', () => {
  it('lets a person acknowledge their own day, more than once', async () => {
    const first = await asA
      .from('alert_acknowledgements')
      .upsert(
        { user_id: aId, acked_on: DAY, acked_keys: ['cheque:X'] },
        { onConflict: 'user_id,acked_on' },
      );
    expect(first.error).toBeNull();
    const again = await asA
      .from('alert_acknowledgements')
      .upsert(
        { user_id: aId, acked_on: DAY, acked_keys: ['cheque:X', 'cheque:Y'] },
        { onConflict: 'user_id,acked_on' },
      );
    expect(again.error).toBeNull();
    const { data } = await asA
      .from('alert_acknowledgements')
      .select('acked_keys')
      .eq('acked_on', DAY);
    expect(data).toEqual([{ acked_keys: ['cheque:X', 'cheque:Y'] }]);
  });

  it("will not let anyone acknowledge someone else's reminders", async () => {
    const { error } = await asB
      .from('alert_acknowledgements')
      .insert({ user_id: aId, acked_on: '2026-09-15', acked_keys: [] });
    expect(error).not.toBeNull();
  });

  it("does not show one person's acknowledgements to another", async () => {
    const { data } = await asB.from('alert_acknowledgements').select('user_id');
    expect((data ?? []).some((r) => r.user_id === aId)).toBe(false);
  });
});

describe('sales_people.user_id — หนึ่งบัญชี หนึ่งเซลล์', () => {
  it('refuses linking one login to two sales reps', async () => {
    assertNoError(
      'first rep',
      (
        await admin
          .from('sales_people')
          .insert({ shop_id: 'north', name: 'TEST-0058 A', phone: '', user_id: bId })
      ).error,
    );
    const { error } = await admin
      .from('sales_people')
      .insert({ shop_id: 'north', name: 'TEST-0058 B', phone: '', user_id: bId });
    expect(error?.message ?? '').toMatch(/duplicate|unique/i);
  });
});
