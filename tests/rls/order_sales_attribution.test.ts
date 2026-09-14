// tests/rls/order_sales_attribution.test.ts
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
 * ยอดขายเป็นของเซลล์ที่เลือก และบันทึกว่าใครเปิด PO (migration 0057).
 *
 * A rep on the road has somebody in the office raise the PO. The sale must be
 * credited to the rep, and the record must still say who keyed it. These go
 * through PostgREST as a signed-in user because the trigger is the rule; the
 * form is only a convenience in front of it.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const ADMIN_EMAIL = 'attrib0057-admin@test.local';
const OTHER_EMAIL = 'attrib0057-other@test.local';

let asAdmin: PosClient;
let adminId: string;
let otherId: string;

async function makeUser(email: string, role: string) {
  await deleteAuthUserByEmail(admin, email);
  const user = await createAuthUser(admin, email, PASSWORD);
  assertNoError(
    `insert app_users for ${email}`,
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
  return user.id;
}

const stored = async (id: string) =>
  (await admin.from('orders').select('sales_by, created_by, note').eq('id', id).single()).data;

async function cleanup() {
  await admin.from('orders').delete().like('id', 'WS-TEST-ATR%');
}

beforeAll(async () => {
  await cleanup();
  adminId = await makeUser(ADMIN_EMAIL, 'admin');
  otherId = await makeUser(OTHER_EMAIL, 'sales');
  asAdmin = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assertNoError(
    'sign in',
    (await asAdmin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD })).error,
  );
  // The branch this is about must have a sales team for the rule to apply.
  const { count } = await admin
    .from('sales_people')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', 'north')
    .eq('active', true);
  expect(count).toBeGreaterThan(0);
});

afterAll(async () => {
  await cleanup();
  await deleteAuthUserByEmail(admin, ADMIN_EMAIL);
  await deleteAuthUserByEmail(admin, OTHER_EMAIL);
});

describe('PO ขายส่ง — เซลล์เจ้าของยอด และคนที่เปิด', () => {
  it('refuses a new PO with no rep in a branch that has a sales team', async () => {
    const { error } = await asAdmin
      .from('orders')
      .insert({ id: 'WS-TEST-ATR1', shop_id: 'north', status: 'รอจัดส่ง', sales_by: '' });
    expect(error?.message ?? '').toContain('ต้องเลือกพนักงานขาย');
  });

  it('credits the chosen rep, and records the person who actually keyed it', async () => {
    // Opened by the admin on เคน's behalf. Even a payload claiming somebody else
    // raised it cannot change who did.
    const { error } = await asAdmin.from('orders').insert({
      id: 'WS-TEST-ATR2',
      shop_id: 'north',
      status: 'รอจัดส่ง',
      sales_by: 'เคน',
      created_by: otherId,
    });
    expect(error).toBeNull();
    expect(await stored('WS-TEST-ATR2')).toMatchObject({ sales_by: 'เคน', created_by: adminId });
  });

  it('never lets who opened the PO be edited afterwards', async () => {
    const { error } = await asAdmin
      .from('orders')
      .update({ created_by: otherId, note: 'แก้หมายเหตุ' })
      .eq('id', 'WS-TEST-ATR2');
    expect(error).toBeNull();
    expect(await stored('WS-TEST-ATR2')).toMatchObject({
      created_by: adminId,
      note: 'แก้หมายเหตุ',
    });
  });

  it('refuses clearing the rep from a PO that has one', async () => {
    const { error } = await asAdmin
      .from('orders')
      .update({ sales_by: '' })
      .eq('id', 'WS-TEST-ATR2');
    expect(error?.message ?? '').toContain('ต้องเลือกพนักงานขาย');
    expect((await stored('WS-TEST-ATR2'))?.sales_by).toBe('เคน');
  });

  it('still lets an old PO saved without a rep be edited', async () => {
    // Written the way POs were before this rule existed.
    assertNoError(
      'legacy PO',
      (
        await admin
          .from('orders')
          .insert({ id: 'WS-TEST-ATR3', shop_id: 'north', status: 'รอจัดส่ง', sales_by: '' })
      ).error,
    );
    const { error } = await asAdmin
      .from('orders')
      .update({ note: 'ยังไม่ได้ระบุเซลล์' })
      .eq('id', 'WS-TEST-ATR3');
    expect(error).toBeNull();
  });

  it('does not ask for a rep in a branch without a sales team', async () => {
    const { error } = await asAdmin
      .from('orders')
      .insert({ id: 'WS-TEST-ATR4', shop_id: 'cm', status: 'รอจัดส่ง', sales_by: '' });
    expect(error).toBeNull();
    expect((await stored('WS-TEST-ATR4'))?.created_by).toBe(adminId);
  });
});
