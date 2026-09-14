// tests/rls/petty_cash_topup.test.ts
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
 * เติมเงินสดย่อยต้องเข้ายอดเงิน (migration 0056).
 *
 * The button on บัญชี/ค่าใช้จ่าย wrote `petty_cash` alone while the balances are
 * built from `money_transfers`, so every top-up since go-live was missing from
 * the เงินสดย่อย balance and nothing said so. These run through PostgREST as
 * signed-in users — the path a Server Action is, underneath — because the
 * functions are security definer and are therefore the only guard there is.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const ADMIN_EMAIL = 'petty0056-admin@test.local';
const SALES_EMAIL = 'petty0056-sales@test.local';
const MARK = 'TEST-0056';

async function makeUser(email: string, role: string): Promise<PosClient> {
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
  const client = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assertNoError(
    `sign in as ${email}`,
    (await client.auth.signInWithPassword({ email, password: PASSWORD })).error,
  );
  return client;
}

const accountId = async (shop: string, kind: string) => {
  const { data } = await admin
    .from('money_accounts')
    .select('id')
    .eq('shop_id', shop)
    .eq('kind', kind)
    .eq('active', true)
    .order('sort_order')
    .order('id')
    .limit(1)
    .single();
  return data!.id;
};

const legacyTopup = async (note: string, amount = 500) => {
  // Written straight into `petty_cash`, the way the button did before 0056.
  const { data, error } = await admin
    .from('petty_cash')
    .insert({ shop_id: 'cm', type: 'เติมเงิน', amount, entry_at: '2026-09-10', note })
    .select('id')
    .single();
  assertNoError('legacy top-up', error);
  return data!.id;
};

const pettyRow = async (id: number) =>
  (
    await admin
      .from('petty_cash')
      .select('money_transfer_id, transfer_skipped_at, entry_at')
      .eq('id', id)
      .single()
  ).data;

const transferRow = async (id: number) =>
  (
    await admin
      .from('money_transfers')
      .select('from_account_id, to_account_id, amount, moved_at')
      .eq('id', id)
      .single()
  ).data;

async function cleanup() {
  await admin.from('petty_cash').delete().like('note', `${MARK}%`);
  await admin.from('money_transfers').delete().like('note', `${MARK}%`);
}

let asAdmin: PosClient;
let asSales: PosClient;
let cmCash: number;
let cmPetty: number;
let lpCash: number;

beforeAll(async () => {
  await cleanup();
  asAdmin = await makeUser(ADMIN_EMAIL, 'admin');
  asSales = await makeUser(SALES_EMAIL, 'sales');
  cmCash = await accountId('cm', 'cash');
  cmPetty = await accountId('cm', 'petty');
  lpCash = await accountId('lp', 'cash');
});

afterAll(async () => {
  await cleanup();
  await deleteAuthUserByEmail(admin, ADMIN_EMAIL);
  await deleteAuthUserByEmail(admin, SALES_EMAIL);
});

describe('เติมเงินสดย่อย — บันทึกเป็นการโอนด้วย', () => {
  it('writes the top-up and its transfer together, and ties them', async () => {
    const { data: id, error } = await asAdmin.rpc('topup_petty_cash', {
      p_shop: 'cm',
      p_from_account: cmCash,
      p_amount: 1234,
      p_note: `${MARK} a`,
    });
    expect(error).toBeNull();

    const petty = await pettyRow(id!);
    expect(petty?.money_transfer_id).toBeTruthy();
    expect(await transferRow(petty!.money_transfer_id!)).toMatchObject({
      from_account_id: cmCash,
      to_account_id: cmPetty,
      amount: 1234,
      // Same day on both, so the accounting list and the ledger agree on it.
      moved_at: petty!.entry_at,
    });
  });

  it('records นอกระบบ as a source with no account', async () => {
    const { data: id, error } = await asAdmin.rpc('topup_petty_cash', {
      p_shop: 'cm',
      p_from_account: null,
      p_amount: 300,
      p_note: `${MARK} outside`,
    });
    expect(error).toBeNull();
    const petty = await pettyRow(id!);
    expect(await transferRow(petty!.money_transfer_id!)).toMatchObject({
      from_account_id: null,
      to_account_id: cmPetty,
    });
  });

  it('refuses a source from another branch, and leaves nothing half-written', async () => {
    const { error } = await asAdmin.rpc('topup_petty_cash', {
      p_shop: 'cm',
      p_from_account: lpCash,
      p_amount: 999,
      p_note: `${MARK} b`,
    });
    expect(error?.message ?? '').toContain('ไม่ได้อยู่ในสาขานี้');

    // The point of doing both in one function: a refusal after the first insert
    // would otherwise leave a petty-cash row the balance knows nothing about.
    const { count: pettyCount } = await admin
      .from('petty_cash')
      .select('id', { count: 'exact', head: true })
      .eq('note', `${MARK} b`);
    const { count: transferCount } = await admin
      .from('money_transfers')
      .select('id', { count: 'exact', head: true })
      .eq('note', `${MARK} b`);
    expect(pettyCount).toBe(0);
    expect(transferCount).toBe(0);
  });

  it('refuses a caller without accounting.topupCash, even calling the function directly', async () => {
    const { error } = await asSales.rpc('topup_petty_cash', {
      p_shop: 'cm',
      p_from_account: null,
      p_amount: 100,
      p_note: `${MARK} sales`,
    });
    expect(error?.message ?? '').toContain('ไม่มีสิทธิ์');
  });
});

describe('เติมเงินสดย่อยที่ตกหล่น — นำเข้าหรือข้าม ครั้งเดียว', () => {
  it('imports a legacy top-up as a transfer dated the day it happened', async () => {
    const id = await legacyTopup(`${MARK} c`);
    const { error } = await asAdmin.rpc('link_petty_cash_topup', {
      p_petty_id: id,
      p_from_account: null,
    });
    expect(error).toBeNull();

    const petty = await pettyRow(id);
    expect(await transferRow(petty!.money_transfer_id!)).toMatchObject({
      to_account_id: cmPetty,
      amount: 500,
      moved_at: '2026-09-10',
    });

    // A second press must not create a second transfer for the same money.
    const again = await asAdmin.rpc('link_petty_cash_topup', {
      p_petty_id: id,
      p_from_account: null,
    });
    expect(again.error?.message ?? '').toContain('จัดการไปแล้ว');
  });

  it('records "already keyed by hand" and will not import it afterwards', async () => {
    const id = await legacyTopup(`${MARK} d`);
    expect((await asAdmin.rpc('skip_petty_cash_topup', { p_petty_id: id })).error).toBeNull();
    expect((await pettyRow(id))?.transfer_skipped_at).toBeTruthy();

    const { error } = await asAdmin.rpc('link_petty_cash_topup', {
      p_petty_id: id,
      p_from_account: cmCash,
    });
    expect(error?.message ?? '').toContain('จัดการไปแล้ว');
  });

  it('refuses a caller without the money register', async () => {
    const id = await legacyTopup(`${MARK} e`);
    const { error } = await asSales.rpc('link_petty_cash_topup', {
      p_petty_id: id,
      p_from_account: null,
    });
    expect(error?.message ?? '').toContain('ไม่มีสิทธิ์');
    expect((await pettyRow(id))?.money_transfer_id).toBeNull();
  });
});
