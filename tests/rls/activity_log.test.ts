// tests/rls/activity_log.test.ts
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
 * ประวัติการใช้งาน (migration 0061) — "มีบางคนแก้ไขงานทับงานที่ถูกต้องแล้ว".
 *
 * Driven through signed-in clients, the way the app writes: the actor has to be
 * the person who pressed save, and only an admin may read what they did. And
 * the collections rewritten on every save must come out as one readable entry,
 * not one per deleted-and-reinserted row — and as nothing at all when nothing
 * changed, or the history drowns the one edit anybody is looking for.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const ADMIN_EMAIL = 'activity-admin0061@test.local';
const SALES_EMAIL = 'activity-sales0061@test.local';
const TICKET = 'JT-CM-T0061';

let adminUser: PosClient;
let salesUser: PosClient;
let salesId: string;

async function signedIn(email: string, roleId: string): Promise<{ client: PosClient; id: string }> {
  await deleteAuthUserByEmail(admin, email);
  const u = await createAuthUser(admin, email, PASSWORD);
  assertNoError(
    `insert app_users ${email}`,
    (
      await admin.from('app_users').insert({
        id: u.id,
        email,
        name: email,
        role_id: roleId,
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
  return { client, id: u.id };
}

const payments = (amount: number) => [
  { uid: 'pT0061', type: 'มัดจำ', method: 'เงินสด', amount, paidAt: '2026-09-20' },
];

async function saveLines(client: PosClient, amount: number) {
  const { error } = await client.rpc('save_ticket_children', {
    p_ticket_id: TICKET,
    p_items: [{ category: 'ฟิล์มกรองแสง', sold: 'Lamina', soldPrice: 6000, positions: [] }],
    p_payments: payments(amount),
  });
  assertNoError('save_ticket_children', error);
}

/** Every entry about the test ticket, oldest first, read with the service role. */
async function historyOfTicket() {
  const { data, error } = await admin
    .from('activity_log')
    .select('actor, actor_name, entity, action, changes')
    .eq('doc_ref', TICKET)
    .order('id');
  assertNoError('read activity_log', error);
  return data ?? [];
}

beforeAll(async () => {
  ({ client: adminUser } = await signedIn(ADMIN_EMAIL, 'admin'));
  ({ client: salesUser, id: salesId } = await signedIn(SALES_EMAIL, 'sales'));

  await admin.from('tickets').delete().eq('id', TICKET);
  assertNoError(
    'insert ticket',
    (
      await admin.from('tickets').insert({
        id: TICKET,
        shop_id: 'cm',
        customer_name: 'ทดสอบประวัติ',
        plate: 'ทดสอบ 0061',
        status: 'จองแล้ว',
        color: 'ขาว',
        drop_off_date: '2026-09-20T09:00:00+07:00',
        pickup_date: '2026-09-20T17:00:00+07:00',
      })
    ).error,
  );
  // The ticket's first lines, as the service role: this is the "correct work".
  assertNoError(
    'seed lines',
    (
      await admin.rpc('save_ticket_children', {
        p_ticket_id: TICKET,
        p_items: [{ category: 'ฟิล์มกรองแสง', sold: 'Lamina', soldPrice: 6000, positions: [] }],
        p_payments: payments(6000),
      })
    ).error,
  );
});

afterAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await admin.from('activity_log').delete().eq('doc_ref', TICKET);
  await deleteAuthUserByEmail(admin, ADMIN_EMAIL);
  await deleteAuthUserByEmail(admin, SALES_EMAIL);
});

describe('activity_log — who did what', () => {
  it('records a field overwritten by a signed-in user, with the old value and their name', async () => {
    assertNoError(
      'sales edits colour',
      (await salesUser.from('tickets').update({ color: 'แดง' }).eq('id', TICKET)).error,
    );
    const edit = (await historyOfTicket()).find(
      (e) => e.entity === 'tickets' && e.action === 'แก้ไข',
    );
    expect(edit).toMatchObject({
      actor: salesId,
      actor_name: SALES_EMAIL,
      changes: { color: ['ขาว', 'แดง'] },
    });
  });

  it('writes nothing for a save that changed nothing', async () => {
    const before = (await historyOfTicket()).length;
    await salesUser.from('tickets').update({ color: 'แดง' }).eq('id', TICKET);
    await saveLines(salesUser, 6000);
    expect(await historyOfTicket()).toHaveLength(before);
  });

  it('reads a full rewrite of the lines as ONE entry naming only what moved', async () => {
    const before = (await historyOfTicket()).length;
    await saveLines(salesUser, 5500);

    const after = await historyOfTicket();
    expect(after).toHaveLength(before + 1);
    const lines = after[after.length - 1];
    expect(lines.entity).toBe('ticket_lines');
    expect(lines.actor).toBe(salesId);
    // Only the part that changed; the items went through delete-and-reinsert
    // too, but they are the same, so they are not news.
    expect(Object.keys(lines.changes as object)).toEqual(['payments']);
    const [was, now] = (lines.changes as { payments: [{ amount: number }[], { amount: number }[]] })
      .payments;
    expect(Number(was[0].amount)).toBe(6000);
    expect(Number(now[0].amount)).toBe(5500);
  });
});

describe('activity_log — who may read it', () => {
  it('shows an admin the history', async () => {
    const { data, error } = await adminUser.from('activity_log').select('id').eq('doc_ref', TICKET);
    assertNoError('admin read', error);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it('shows anybody else nothing — including their own edits', async () => {
    const { data } = await salesUser.from('activity_log').select('id').eq('doc_ref', TICKET);
    expect(data ?? []).toEqual([]);
  });
});

describe('activity_log — nobody can rewrite it', () => {
  it('refuses an admin deleting, editing or forging an entry', async () => {
    const del = await adminUser.from('activity_log').delete().eq('doc_ref', TICKET);
    const upd = await adminUser
      .from('activity_log')
      .update({ actor_name: 'x' })
      .eq('doc_ref', TICKET);
    const ins = await adminUser
      .from('activity_log')
      .insert({ entity: 'tickets', action: 'แก้ไข', doc_ref: TICKET });
    for (const r of [del, upd, ins]) expect(r.error?.code).toBe('42501');
    // …and the history is still all there.
    expect((await historyOfTicket()).length).toBeGreaterThan(0);
  });
});
