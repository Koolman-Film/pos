// tests/rls/tickets_schema.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { adminClient } from './_helpers';

const supabase = adminClient();

const TICKET_ID = 'JT-TEST-00001';

// Deleting the ticket cascades to ticket_items -> ticket_item_positions,
// ticket_payments and ticket_status_history (see 0004_tickets.sql), so this one
// delete is enough to return the DB to a known state before every run.
async function removeFixtures() {
  await supabase.from('tickets').delete().eq('id', TICKET_ID);
}

describe('tickets schema', () => {
  beforeEach(removeFixtures);

  it('stores a ticket with items, positions, and a payment', async () => {
    await supabase.from('tickets').insert({
      id: TICKET_ID, shop_id: 'cm', customer_name: 'คุณ ทดสอบ', phone: '080-000-0000',
      plate: '1กก 1111', car_type: 'เก๋งเล็ก', brand: 'Toyota', model: 'Vios', color: 'ขาว',
      service_type: 'เข้าทำ/ติดตั้ง', status: 'จองแล้ว', booking_channel: 'Walk-in',
      drop_off_date: '2026-07-23T09:00:00Z', pickup_date: '2026-07-24T09:00:00Z',
    });
    const { data: item } = await supabase.from('ticket_items').insert({
      ticket_id: TICKET_ID, category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม FINNIX CT 40%', sold_price: 1300,
    }).select().single();
    await supabase.from('ticket_item_positions').insert({
      ticket_item_id: item!.id, position: 'บานหน้า', product: 'ฟิล์ม FINNIX CT 40%', price: 1300,
    });
    await supabase.from('ticket_payments').insert({
      ticket_id: TICKET_ID, type: 'มัดจำ', method: 'โอน TTB', amount: 500, paid_at: '2026-07-23',
    });

    const { data: full } = await supabase
      .from('tickets')
      .select('*, ticket_items(*, ticket_item_positions(*)), ticket_payments(*)')
      .eq('id', TICKET_ID)
      .single();

    expect(full!.ticket_items).toHaveLength(1);
    expect(full!.ticket_items[0].ticket_item_positions).toHaveLength(1);
    expect(full!.ticket_payments).toHaveLength(1);
    expect(full!.ticket_payments[0].amount).toBe(500);
  });
});
