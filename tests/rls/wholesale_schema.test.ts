// tests/rls/wholesale_schema.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { adminClient } from './_helpers';

const supabase = adminClient();

const ORDER_ID = 'WS-TEST-0001';
const CUSTOMER_NAME = 'ร้านทดสอบ';

// order_items / order_returns / order_payments / order_adjustments all cascade
// from orders (0005_wholesale.sql). wholesale_customers does NOT cascade and is
// referenced by orders.customer_id, so the order has to go first. Deleting the
// customer by name also sweeps up rows orphaned by an aborted earlier run.
async function removeFixtures() {
  await supabase.from('orders').delete().eq('id', ORDER_ID);
  await supabase.from('wholesale_customers').delete().eq('name', CUSTOMER_NAME);
}

describe('wholesale schema', () => {
  beforeEach(removeFixtures);

  it('stores an order with items, a return, a payment, and an adjustment', async () => {
    const { data: cust } = await supabase.from('wholesale_customers')
      .insert({ name: CUSTOMER_NAME, phone: '080-000-0000', address: 'เชียงใหม่' }).select().single();
    await supabase.from('orders').insert({ id: ORDER_ID, shop_id: 'cm', customer_id: cust!.id, status: 'รออนุมัติราคา' });
    await supabase.from('order_items').insert({ order_id: ORDER_ID, name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, list_price: 1200, requested_price: 1000, reason: 'ลูกค้าประจำ' });
    await supabase.from('order_returns').insert({ order_id: ORDER_ID, item_name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 1, reason: 'ของชำรุด' });
    await supabase.from('order_payments').insert({ order_id: ORDER_ID, amount: 5000, method: 'โอน BBK', paid_at: '2026-07-23' });
    await supabase.from('order_adjustments').insert({ order_id: ORDER_ID, amount: 200, reason: 'ต่อรองราคา', adjusted_at: '2026-07-23' });

    const { data: full } = await supabase
      .from('orders')
      .select('*, order_items(*), order_returns(*), order_payments(*), order_adjustments(*)')
      .eq('id', ORDER_ID)
      .single();

    expect(full!.order_items).toHaveLength(1);
    expect(full!.order_returns).toHaveLength(1);
    expect(full!.order_payments).toHaveLength(1);
    expect(full!.order_adjustments).toHaveLength(1);
  });
});
