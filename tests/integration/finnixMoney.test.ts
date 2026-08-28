import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';

/**
 * เงินรอคืน / เงินรอรับคืน Finnix (migrations 0031 and 0032).
 *
 * Both columns exist to keep money that belongs to another Finnix shop out of
 * this branch's takings and costs. Two things have to hold in the database
 * itself, not just in the screens that read it:
 *
 *   - every row already recorded keeps counting exactly as it did, which means
 *     the DEFAULT has to be the ordinary kind; and
 *   - nothing but the two known values can ever be stored, or the reports would
 *     silently drop rows they do not recognise.
 */

const admin = adminClient();

const TICKET = 'JT-FINNIX-0001';
const EXPENSE_DESC = 'TEST-EXPENSE-0032';

async function cleanup() {
  await admin.from('tickets').delete().eq('id', TICKET);
  await admin.from('expenses').delete().eq('description', EXPENSE_DESC);
}

beforeEach(cleanup);
afterAll(cleanup);

describe('tickets.revenue_kind', () => {
  async function seed(kind?: string) {
    return admin.from('tickets').insert({
      id: TICKET,
      shop_id: 'cm',
      customer_name: 'ลูกค้าทดสอบ',
      status: 'จองแล้ว',
      drop_off_date: '2026-08-27T09:00:00+07:00',
      pickup_date: '2026-08-27T17:00:00+07:00',
      ...(kind ? { revenue_kind: kind } : {}),
    });
  }

  it('defaults a ticket to รายได้', async () => {
    assertNoError('seed ticket', (await seed()).error);
    const { data } = await admin.from('tickets').select('revenue_kind').eq('id', TICKET).single();
    expect(data?.revenue_kind).toBe('รายได้');
  });

  it('stores รับแทน when the counter chooses it', async () => {
    assertNoError('seed held ticket', (await seed('รับแทน')).error);
    const { data } = await admin.from('tickets').select('revenue_kind').eq('id', TICKET).single();
    expect(data?.revenue_kind).toBe('รับแทน');
  });

  it('refuses any other value', async () => {
    const { error } = await seed('อย่างอื่น');
    expect(error?.message ?? '').toMatch(/revenue_kind/);
  });
});

describe('expenses.expense_kind', () => {
  async function seed(kind?: string) {
    return admin.from('expenses').insert({
      shop_id: 'cm',
      description: EXPENSE_DESC,
      category: 'ค่าวัสดุสิ้นเปลือง',
      source: 'บัญชีธนาคารสาขา',
      amount: 12000,
      status: 'จ่ายแล้ว',
      paid_at: '2026-08-27',
      ...(kind ? { expense_kind: kind } : {}),
    });
  }

  it('defaults an expense to ค่าใช้จ่าย', async () => {
    assertNoError('seed expense', (await seed()).error);
    const { data } = await admin
      .from('expenses')
      .select('expense_kind')
      .eq('description', EXPENSE_DESC)
      .single();
    expect(data?.expense_kind).toBe('ค่าใช้จ่าย');
  });

  it('stores จ่ายแทน when the branch paid for another shop', async () => {
    assertNoError('seed reimbursable', (await seed('จ่ายแทน')).error);
    const { data } = await admin
      .from('expenses')
      .select('expense_kind')
      .eq('description', EXPENSE_DESC)
      .single();
    expect(data?.expense_kind).toBe('จ่ายแทน');
  });

  it('refuses any other value', async () => {
    const { error } = await seed('อย่างอื่น');
    expect(error?.message ?? '').toMatch(/expense_kind/);
  });
});

/**
 * `shop_info.vat_registered` (migration 0035).
 *
 * Only a VAT-registered branch may issue a ใบกำกับภาษี. The flag is data rather
 * than a branch id written into the code, so a shop that registers next year is
 * a tick in จัดการสิทธิ์ — but the default has to be OFF, or a branch added
 * tomorrow could issue tax invoices before anybody decided it should.
 */
describe('shop_info.vat_registered', () => {
  it('is on for เชียงใหม่ and off for every other branch', async () => {
    const { data } = await admin.from('shop_info').select('shop_id, vat_registered');
    const registered = (data ?? []).filter((r) => r.vat_registered).map((r) => r.shop_id);
    expect(registered).toEqual(['cm']);
  });

  it('defaults to off for a branch created later', async () => {
    await admin.from('shop_info').delete().eq('shop_id', 'zzvat');
    await admin.from('shops').delete().eq('id', 'zzvat');
    await admin.from('shops').insert({ id: 'zzvat', name: 'ทดสอบ VAT', sort_order: 99 });
    const { error } = await admin.from('shop_info').insert({ shop_id: 'zzvat' });
    assertNoError('insert shop_info', error);

    const { data } = await admin
      .from('shop_info')
      .select('vat_registered')
      .eq('shop_id', 'zzvat')
      .single();
    expect(data?.vat_registered).toBe(false);

    await admin.from('shop_info').delete().eq('shop_id', 'zzvat');
    await admin.from('shops').delete().eq('id', 'zzvat');
  });
});
