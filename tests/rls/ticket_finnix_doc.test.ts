// tests/rls/ticket_finnix_doc.test.ts
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
 * เลขที่เอกสาร PEAK ทีละรายการ แก้ได้แม้ใบงานปิดแล้ว แต่แก้ได้แค่นั้น
 * (migration 0073).
 *
 * The number arrives from the accounts days after the car has gone and the
 * ticket has locked itself, so the lock has to let it through — and let
 * through nothing else. The caller is a `sales` user, someone WITHOUT
 * `list.unlock`, because an admin can already edit anything.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'peakdoc@test.local';
const TICKET = 'JT-CM-T0073';

let user: PosClient;
let itemIds: number[] = [];

const docsOf = async () => {
  const { data } = await admin
    .from('ticket_items')
    .select('finnix_doc_no')
    .eq('ticket_id', TICKET)
    .order('id');
  return (data ?? []).map((i) => i.finnix_doc_no);
};

const ticketRow = async () => {
  const { data } = await admin
    .from('tickets')
    .select('customer_name, status, locked')
    .eq('id', TICKET)
    .single();
  return data;
};

const reset = async () => {
  await admin
    .from('tickets')
    .update({ locked: true, customer_name: 'ทดสอบ PEAK', status: 'ส่งมอบแล้ว' })
    .eq('id', TICKET);
  await admin.from('ticket_items').update({ finnix_doc_no: '' }).eq('ticket_id', TICKET);
};

const save = (docNos: string[]) =>
  user.rpc('save_ticket_item_finnix_docs', { p_ticket_id: TICKET, p_docs: docNos });

beforeAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await deleteAuthUserByEmail(admin, EMAIL);
  const u = await createAuthUser(admin, EMAIL, PASSWORD);
  assertNoError(
    'insert app_users',
    (
      await admin.from('app_users').insert({
        id: u.id,
        email: EMAIL,
        name: EMAIL,
        role_id: 'sales',
        active: true,
        sees_all_shops: true,
      })
    ).error,
  );
  user = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assertNoError(
    'sign in',
    (await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })).error,
  );
  assertNoError(
    'insert ticket',
    (
      await admin.from('tickets').insert({
        id: TICKET,
        shop_id: 'cm',
        customer_name: 'ทดสอบ PEAK',
        plate: 'ทดสอบ 0073',
        status: 'ส่งมอบแล้ว',
        drop_off_date: '2026-09-01T09:00:00+07:00',
        pickup_date: '2026-09-01T17:00:00+07:00',
        locked: true,
      })
    ).error,
  );
  const { data, error } = await admin
    .from('ticket_items')
    .insert([
      {
        ticket_id: TICKET,
        category: 'ฟิล์มกันรอย',
        sold: 'TPU',
        sold_price: 4000,
        revenue_kind: 'รับแทน',
      },
      {
        ticket_id: TICKET,
        category: 'เครื่องเสียง',
        sold: 'ลำโพง',
        sold_price: 3000,
        revenue_kind: 'รับแทน',
      },
    ])
    .select('id');
  assertNoError('insert items', error);
  itemIds = (data ?? []).map((r) => r.id).sort((a, b) => a - b);
});

afterAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await deleteAuthUserByEmail(admin, EMAIL);
});

describe('เลขที่เอกสาร PEAK ทีละรายการ บนใบงานที่ล็อกแล้ว', () => {
  it('กรอกเลขคนละเลขให้แต่ละรายการได้ แม้ใบงานปิดและล็อกไปแล้ว', async () => {
    // The whole point of moving it onto the line: Finnix issues its documents
    // by ชนิดสินค้า, so one job carries more than one number.
    await reset();
    const { error } = await save(['IV6809-0042', 'IV6809-0043']);
    expect(error).toBeNull();
    expect(await docsOf()).toEqual(['IV6809-0042', 'IV6809-0043']);
    expect(await ticketRow()).toMatchObject({ locked: true });
  });

  it('ตัดช่องว่างหัวท้ายให้ และเว้นว่างไว้ได้', async () => {
    await reset();
    await save(['  IV-1  ', '']);
    expect(await docsOf()).toEqual(['IV-1', '']);
  });

  it('รายการสินค้าเปลี่ยนไปแล้ว ถูกปฏิเสธ ไม่ใช่เขียนผิดแถว', async () => {
    await reset();
    const { error } = await save(['IV-1']);
    expect(error?.message ?? '').toContain('รายการสินค้าในใบงานเปลี่ยนไปแล้ว');
    expect(await docsOf()).toEqual(['', '']);
  });

  it('ด่านล็อกยังกันราคาและสถานะเหมือนเดิม', async () => {
    await reset();
    const price = await user.from('ticket_items').update({ sold_price: 1 }).eq('id', itemIds[0]);
    expect(price.error?.message ?? '').toContain('แก้ไขรายการสินค้าไม่ได้');

    for (const patch of [
      { customer_name: 'ไม่ควรผ่าน' },
      { status: 'จองแล้ว' },
      { locked: false },
    ]) {
      const { error } = await user.from('tickets').update(patch).eq('id', TICKET);
      expect(error?.message ?? '').toContain('ปิดงานแล้ว');
    }
    expect(await ticketRow()).toMatchObject({
      customer_name: 'ทดสอบ PEAK',
      status: 'ส่งมอบแล้ว',
      locked: true,
    });
  });
});
