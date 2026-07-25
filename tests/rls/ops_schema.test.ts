// tests/rls/ops_schema.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { adminClient } from './_helpers';

const supabase = adminClient();

const STOCK_SKU = 'SKU-TEST-1';
const RULE_NAME = 'ทดสอบ 3%';
const RULE_CATEGORY = 'ค่าคอมพนักงาน';
const EXPENSE_DESCRIPTION = 'ทดสอบ';
// petty_cash has no natural key, so the fixture tags itself via the `note`
// column (0006_stock_commission_accounting.sql) to stay deletable.
const PETTY_CASH_NOTE = 'TEST-FIXTURE ops_schema';

// commission_rule_teams cascades from commission_rules; everything else here is
// a root row and has to be deleted explicitly.
async function removeFixtures() {
  await supabase.from('stock').delete().eq('sku', STOCK_SKU);
  await supabase
    .from('commission_rules')
    .delete()
    .eq('name', RULE_NAME)
    .eq('category', RULE_CATEGORY);
  await supabase
    .from('expenses')
    .delete()
    .eq('shop_id', 'cm')
    .eq('description', EXPENSE_DESCRIPTION)
    .eq('category', 'ค่าเช่า');
  await supabase.from('petty_cash').delete().eq('note', PETTY_CASH_NOTE);
}

describe('stock/commission/accounting schema', () => {
  beforeEach(removeFixtures);
  // Clean up AFTER as well as before. Cleaning only before keeps this file
  // idempotent but leaves its rows in the database once the run ends, which
  // skews the seeded figures the app displays (the dashboard totals in
  // particular) for anyone who runs the suite against a staging stack.
  afterAll(removeFixtures);

  it('stores stock, a commission rule with a team, an expense, and a petty cash entry', async () => {
    await supabase.from('stock').insert({
      sku: STOCK_SKU,
      name: 'ทดสอบ',
      category: 'ฟิล์มกรองแสง',
      shop_id: 'cm',
      qty: 5,
      min_qty: 2,
      cost: 100,
      sell_price: 200,
    });
    const { data: rule } = await supabase
      .from('commission_rules')
      .insert({
        category: RULE_CATEGORY,
        name: RULE_NAME,
        type: 'percent_of_sale',
        value: 3,
        shop_id: 'cm',
      })
      .select()
      .single();
    await supabase
      .from('commission_rule_teams')
      .insert({ commission_rule_id: rule!.id, team_member: 'กมล' });
    await supabase.from('expenses').insert({
      shop_id: 'cm',
      description: EXPENSE_DESCRIPTION,
      category: 'ค่าเช่า',
      source: 'บัญชีธนาคารสาขา',
      amount: 1000,
      status: 'จ่ายแล้ว',
      paid_at: '2026-07-23',
    });
    await supabase.from('petty_cash').insert({
      shop_id: 'cm',
      type: 'เติมเงิน',
      amount: 5000,
      entry_at: '2026-07-23',
      note: PETTY_CASH_NOTE,
    });

    const { data: stockRow } = await supabase
      .from('stock')
      .select('qty')
      .eq('sku', STOCK_SKU)
      .single();
    const { data: team } = await supabase
      .from('commission_rule_teams')
      .select('team_member')
      .eq('commission_rule_id', rule!.id);
    expect(stockRow!.qty).toBe(5);
    expect(team).toEqual([{ team_member: 'กมล' }]);
  });
});
