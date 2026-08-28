// tests/rls/manage_shops.test.ts
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
 * `save_shop` (migration 0034).
 *
 * `shops` is select-only under RLS, so adding a branch goes through a
 * `security definer` function — which means the function IS the authorization
 * boundary. It is granted to `authenticated`, so any signed-in token can call
 * it directly, with or without the screen that has the button.
 *
 * The case worth pinning is the empty one: `current_user_role()` returns NULL
 * for a token with no `app_users` row, and `NULL <> 'admin'` is NULL, not TRUE
 * — a bare comparison would have waved exactly that caller through.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const ADMIN_EMAIL = 'shopadmin@test.local';
const SALES_EMAIL = 'shopsales@test.local';
const STRANGER_EMAIL = 'shopstranger@test.local';
const NEW_SHOP = 'zzrls';

async function signedIn(email: string): Promise<PosClient> {
  const client = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  assertNoError(`sign in as ${email}`, error);
  return client;
}

/** A user with an `app_users` row, in the given role. */
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
  return signedIn(email);
}

/** Authenticated against GoTrue, but never registered in the app. */
async function makeStranger(email: string): Promise<PosClient> {
  await deleteAuthUserByEmail(admin, email);
  await createAuthUser(admin, email, PASSWORD);
  return signedIn(email);
}

let asAdmin: PosClient;
let asSales: PosClient;
let asStranger: PosClient;

beforeAll(async () => {
  await admin.from('shops').delete().eq('id', NEW_SHOP);
  asAdmin = await makeUser(ADMIN_EMAIL, 'admin');
  asSales = await makeUser(SALES_EMAIL, 'sales');
  asStranger = await makeStranger(STRANGER_EMAIL);
}, 60_000);

afterAll(async () => {
  await admin.from('shops').delete().eq('id', NEW_SHOP);
  for (const email of [ADMIN_EMAIL, SALES_EMAIL, STRANGER_EMAIL]) {
    await deleteAuthUserByEmail(admin, email);
  }
}, 60_000);

describe('save_shop', () => {
  it('lets an admin open a new branch', async () => {
    const { error } = await asAdmin.rpc('save_shop', {
      p_id: NEW_SHOP,
      p_name: 'Finnix ทดสอบ',
    });
    assertNoError('admin save_shop', error);

    const { data } = await admin
      .from('shops')
      .select('name, sort_order')
      .eq('id', NEW_SHOP)
      .single();
    expect(data?.name).toBe('Finnix ทดสอบ');
    // Appended, so adding a branch never reshuffles the sidebar.
    expect(Number(data?.sort_order)).toBeGreaterThan(5);
  });

  it('renames without moving it', async () => {
    const before = await admin.from('shops').select('sort_order').eq('id', NEW_SHOP).single();
    assertNoError(
      'rename',
      (await asAdmin.rpc('save_shop', { p_id: NEW_SHOP, p_name: 'Finnix North' })).error,
    );
    const after = await admin.from('shops').select('name, sort_order').eq('id', NEW_SHOP).single();
    expect(after.data?.name).toBe('Finnix North');
    expect(after.data?.sort_order).toBe(before.data?.sort_order);
  });

  it('refuses an id that would not survive a document number', async () => {
    // The id ends up in document numbers and export filenames, so it stays
    // short, lowercase and free of anything that needs escaping.
    for (const bad of ['A', 'north branch', 'ภาคเหนือ', 'x', 'waytoolongforanid']) {
      const { error } = await asAdmin.rpc('save_shop', { p_id: bad, p_name: 'ทดสอบ' });
      expect(error, `expected ${bad} to be refused`).not.toBeNull();
    }
  });

  it('refuses a branch with no name', async () => {
    const { error } = await asAdmin.rpc('save_shop', { p_id: 'zzname', p_name: '   ' });
    expect(error?.message ?? '').toContain('ชื่อสาขา');
  });

  it('refuses a non-admin role', async () => {
    const { error } = await asSales.rpc('save_shop', { p_id: 'zzsales', p_name: 'ห้ามผ่าน' });
    expect(error?.message ?? '').toContain('forbidden');
  });

  it('refuses a signed-in token with no app_users row', async () => {
    const { error } = await asStranger.rpc('save_shop', { p_id: 'zzstrgr', p_name: 'ห้ามผ่าน' });
    expect(error?.message ?? '').toContain('forbidden');
    const { data } = await admin.from('shops').select('id').eq('id', 'zzstrgr');
    expect(data ?? []).toHaveLength(0);
  });
});
