// tests/rls/rls_shop_isolation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  anonClient,
  assertNoError,
  createAuthUser,
  deleteAuthUserByEmail,
} from './_helpers';

const admin = adminClient();

const PASSWORD = 'test-password-123';
const TICKET_IDS = ['JT-RLS-CM', 'JT-RLS-LP'];
const SALES_EMAILS = ['sales-cm@test.local', 'sales-lp@test.local', 'sales-cm-2@test.local'];

/**
 * Create a sales user scoped to one shop, replacing any identically-named user
 * left behind by a previous run. Without the delete, `createUser` fails with
 * "email already exists", returns a null user, and every later step explodes on
 * a null id.
 */
async function createSalesUser(email: string, shopId: string): Promise<SupabaseClient> {
  await deleteAuthUserByEmail(admin, email);
  const user = await createAuthUser(admin, email, PASSWORD);

  const { error: appUserError } = await admin.from('app_users').insert({
    id: user.id,
    email,
    name: email,
    role_id: 'sales',
    active: true,
    sees_all_shops: false,
  });
  assertNoError(`insert app_users for ${email}`, appUserError);

  const { error: accessError } = await admin
    .from('user_shop_access')
    .insert({ user_id: user.id, shop_id: shopId });
  assertNoError(`insert user_shop_access for ${email}`, accessError);

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  assertNoError(`sign in as ${email}`, signInError);
  return client;
}

describe('RLS shop isolation', () => {
  beforeAll(async () => {
    // Start from a known state: drop the fixture tickets and users this file
    // owns, and restore the seed value of the status row the third test probes.
    await admin.from('tickets').delete().in('id', TICKET_IDS);
    for (const email of SALES_EMAILS) await deleteAuthUserByEmail(admin, email);
    await admin.from('statuses').update({ short: 'จองแล้ว' }).eq('key', 'จองแล้ว');

    const { error } = await admin.from('tickets').insert([
      {
        id: 'JT-RLS-CM',
        shop_id: 'cm',
        customer_name: 'CM Customer',
        status: 'จองแล้ว',
        drop_off_date: '2026-07-23T09:00:00Z',
        pickup_date: '2026-07-24T09:00:00Z',
      },
      {
        id: 'JT-RLS-LP',
        shop_id: 'lp',
        customer_name: 'LP Customer',
        status: 'จองแล้ว',
        drop_off_date: '2026-07-23T09:00:00Z',
        pickup_date: '2026-07-24T09:00:00Z',
      },
    ]);
    assertNoError('seed RLS fixture tickets', error);
  });

  // Take the fixtures back out. Cleaning only in beforeAll leaves two fake
  // tickets and three fake sales users in the database after the run, which show
  // up in the app's own numbers — the dashboard counted them as real jobs.
  afterAll(async () => {
    await admin.from('tickets').delete().in('id', TICKET_IDS);
    for (const email of SALES_EMAILS) await deleteAuthUserByEmail(admin, email);
    await admin.from('statuses').update({ short: 'จองแล้ว' }).eq('key', 'จองแล้ว');
  });

  it('a sales user scoped to shop cm only sees shop cm tickets', async () => {
    const cmUser = await createSalesUser('sales-cm@test.local', 'cm');
    const { data, error } = await cmUser.from('tickets').select('id').in('id', TICKET_IDS);
    expect(error).toBeNull();
    expect(data?.map((t) => t.id)).toEqual(['JT-RLS-CM']);
  });

  it('a sales user scoped to shop lp only sees shop lp tickets', async () => {
    const lpUser = await createSalesUser('sales-lp@test.local', 'lp');
    const { data } = await lpUser.from('tickets').select('id').in('id', TICKET_IDS);
    expect(data?.map((t) => t.id)).toEqual(['JT-RLS-LP']);
  });

  it('a sales user cannot edit the shared statuses config table (nav.permissions is false for sales)', async () => {
    const cmUser = await createSalesUser('sales-cm-2@test.local', 'cm');
    await cmUser.from('statuses').update({ short: 'hacked' }).eq('key', 'จองแล้ว');
    const { data: check } = await admin
      .from('statuses')
      .select('short')
      .eq('key', 'จองแล้ว')
      .single();
    expect(check!.short).toBe('จองแล้ว'); // unchanged — RLS silently filtered the update to 0 rows
  });
});
