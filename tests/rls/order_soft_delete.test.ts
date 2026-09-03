// tests/rls/order_soft_delete.test.ts
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
 * ลบ / กู้คืน PO ต้องมีสิทธิ์ (migration 0040).
 *
 * `orders_rw` lets any member of the branch update the row, so the capability
 * cannot live only in the server action: a signed-in token can PATCH
 * `deleted_at` straight through PostgREST without ever loading the page that
 * has the button. The trigger is what actually stops it, and that is what these
 * assertions are for.
 *
 * `tech` is the role that has neither capability by default; `admin` has both.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const ADMIN_EMAIL = 'podelete-admin@test.local';
const TECH_EMAIL = 'podelete-tech@test.local';
const ORDER_ID = 'WS-TEST-DEL1';

async function signedIn(email: string): Promise<PosClient> {
  const client = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  assertNoError(`sign in as ${email}`, error);
  return client;
}

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

let asAdmin: PosClient;
let asTech: PosClient;

async function removeFixtures() {
  await admin.from('orders').delete().eq('id', ORDER_ID);
}

beforeAll(async () => {
  await removeFixtures();
  asAdmin = await makeUser(ADMIN_EMAIL, 'admin');
  asTech = await makeUser(TECH_EMAIL, 'tech');
  assertNoError(
    'seed order',
    (
      await admin
        .from('orders')
        .insert({ id: ORDER_ID, shop_id: 'cm', customer_id: null, status: 'รออนุมัติราคา' })
    ).error,
  );
});

afterAll(async () => {
  await removeFixtures();
  await deleteAuthUserByEmail(admin, ADMIN_EMAIL);
  await deleteAuthUserByEmail(admin, TECH_EMAIL);
});

describe('ลบ PO ต้องมีสิทธิ์ wholesale.delete', () => {
  it('refuses a caller without the capability, even straight through PostgREST', async () => {
    const { error } = await asTech
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', ORDER_ID);
    expect(error?.message).toContain('ไม่มีสิทธิ์ลบ PO');

    // And the row really is untouched — a refusal that still wrote would be worse
    // than no check at all.
    const { data } = await admin.from('orders').select('deleted_at').eq('id', ORDER_ID).single();
    expect(data!.deleted_at).toBeNull();
  });

  it('lets a holder delete, and refuses the same caller the restore', async () => {
    assertNoError(
      'admin deletes',
      (
        await asAdmin
          .from('orders')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', ORDER_ID)
      ).error,
    );
    const { data } = await admin.from('orders').select('deleted_at').eq('id', ORDER_ID).single();
    expect(data!.deleted_at).not.toBeNull();

    // tech holds neither key: putting a PO back is its own decision.
    const { error } = await asTech.from('orders').update({ deleted_at: null }).eq('id', ORDER_ID);
    expect(error?.message).toContain('ไม่มีสิทธิ์กู้คืน PO');
  });

  it('lets a holder of wholesale.restore put it back', async () => {
    assertNoError(
      'admin restores',
      (await asAdmin.from('orders').update({ deleted_at: null }).eq('id', ORDER_ID)).error,
    );
    const { data } = await admin.from('orders').select('deleted_at').eq('id', ORDER_ID).single();
    expect(data!.deleted_at).toBeNull();
  });
});
