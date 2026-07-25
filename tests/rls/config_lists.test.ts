// tests/rls/config_lists.test.ts
import { describe, it, expect } from 'vitest';
import { adminClient } from './_helpers';

// Read-only against seed data; no fixtures to clean up.
const supabase = adminClient();

describe('config-as-data seed', () => {
  it('seeds all 12 flat option list keys with at least one value', async () => {
    const { data } = await supabase.from('option_lists').select('list_key');
    const keys = new Set(data!.map((r) => r.list_key));
    expect([...keys].sort()).toEqual(
      [
        'booking_channels',
        'car_brands',
        'car_types',
        'expense_categories',
        'extra_options',
        'film_positions',
        'payment_methods',
        'payment_sources',
        'product_categories',
        'service_items',
        'service_types',
        'slide_types',
        'technicians',
        'time_slots',
        'wrap_positions',
      ].sort(),
    );
  });

  it('seeds the 6 default ticket statuses in order', async () => {
    const { data } = await supabase.from('statuses').select('key').order('sort_order');
    expect(data?.map((s) => s.key)).toEqual([
      'จองแล้ว',
      'กำลัง QC ก่อนติดตั้ง',
      'กำลังติดตั้ง',
      'รอส่งมอบ',
      'ส่งมอบแล้ว',
      'ค้างชำระ',
    ]);
  });

  it('seeds car_models as structured rows, not option_lists rows', async () => {
    const { data } = await supabase
      .from('car_models')
      .select('model, brand, car_type')
      .eq('model', 'D-Max');
    expect(data).toEqual([{ model: 'D-Max', brand: 'Isuzu', car_type: 'กระบะ' }]);
  });
});
