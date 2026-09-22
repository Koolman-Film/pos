import { describe, it, expect, afterAll, beforeAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';

/**
 * การชำระเงิน / แหล่งเงิน เป็นรายการเดียว (migration 0064, ร้านขอ 22 ก.ย. 2569).
 *
 * Every payment picker now stores the NAME of a แหล่งเงิน, and the balances
 * match payments to accounts by that name. These pin what keeps the name a
 * trustworthy link: it is unique in its branch, a rename does not strand the
 * money already recorded under the old one, and a cheque is known by its own
 * flag now that the method no longer says "เช็ค".
 */

const admin = adminClient();
const ORDER = 'WS-CM-T0064';
let accountId: number;

beforeAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER);
  await admin.from('money_accounts').delete().eq('shop_id', 'cm').like('name', 'ทดสอบ 0064%');
  const { data, error } = await admin
    .from('money_accounts')
    .insert({ shop_id: 'cm', name: 'ทดสอบ 0064 กสิกร', kind: 'bank', match_names: [] })
    .select('id')
    .single();
  assertNoError('seed account', error);
  accountId = data!.id;
});

afterAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER);
  await admin.from('money_accounts').delete().eq('shop_id', 'cm').like('name', 'ทดสอบ 0064%');
});

describe('แหล่งเงินเป็นตัวเชื่อมที่เชื่อถือได้', () => {
  it('refuses a second account of the same name in the same branch', async () => {
    const { error } = await admin
      .from('money_accounts')
      .insert({ shop_id: 'cm', name: ' ทดสอบ 0064 กสิกร ', kind: 'bank' });
    expect(error?.code).toBe('23505');
  });

  it('keeps the old name as a match name when an account is renamed', async () => {
    assertNoError(
      'rename',
      (
        await admin
          .from('money_accounts')
          .update({ name: 'ทดสอบ 0064 กสิกร ออมทรัพย์' })
          .eq('id', accountId)
      ).error,
    );
    const { data } = await admin
      .from('money_accounts')
      .select('name, match_names')
      .eq('id', accountId)
      .single();
    expect(data?.name).toBe('ทดสอบ 0064 กสิกร ออมทรัพย์');
    // Payments recorded as "ทดสอบ 0064 กสิกร" still land here.
    expect(data?.match_names).toContain('ทดสอบ 0064 กสิกร');
  });

  it('saves a wholesale cheque as a cheque, with the account the money will land in', async () => {
    assertNoError(
      'seed order',
      (
        await admin
          .from('orders')
          .insert({ id: ORDER, shop_id: 'cm', customer_id: 1, status: 'รออนุมัติราคา' })
      ).error,
    );
    assertNoError(
      'save payment',
      (
        await admin.rpc('save_order_children', {
          p_order_id: ORDER,
          p_items: [],
          p_returns: [],
          p_adjustments: [],
          p_payments: [
            {
              uid: 'pT0064',
              amount: 5000,
              method: 'ทดสอบ 0064 กสิกร ออมทรัพย์',
              date: '2026-09-22',
              isCheque: true,
              chequeNo: '1234567',
            },
          ],
          p_saved_on: '2026-09-22',
        })
      ).error,
    );
    const { data } = await admin
      .from('order_payments')
      .select('method, is_cheque, cheque_no')
      .eq('order_id', ORDER)
      .single();
    expect(data).toEqual({
      method: 'ทดสอบ 0064 กสิกร ออมทรัพย์',
      is_cheque: true,
      cheque_no: '1234567',
    });
  });
});
