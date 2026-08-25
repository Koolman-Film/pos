import { test, expect } from '@playwright/test';

import { dbAdmin, login } from './helpers';

/**
 * Automatic stock movement, driven through the real UI.
 *
 * This is the end-to-end proof for the gap the parity audit found: recording
 * actual usage on a job used to change a client-side array and nothing else. The
 * unit tests cover the delta arithmetic and the integration tests cover the
 * database mechanics; this one covers the part only a browser can answer — that
 * the technician's number survives serialize → server action → database, moves the
 * right stock row, and writes the audit trail.
 *
 * JT-CM-00214 is seeded with a ฟิล์มกรองแสง item whose positions use
 * "ฟิล์ม 3M CRM 60%" and "ฟิล์ม FINNIX CT 40%", both of which are stocked at cm.
 */
const TICKET = 'JT-CM-00214';
const PRODUCT = 'ฟิล์ม 3M CRM 60%';
const SKU = 'SKU-FLM-3M60';

const admin = dbAdmin();

const stockQty = async () => {
  const { data } = await admin.from('stock').select('qty').eq('sku', SKU).single();
  return Number(data!.qty);
};

/**
 * The ticket-driven audit trail. Migration 0026 moved this path off
 * `withdrawals` and into the `stock_movements` ledger, written by the
 * move_stock RPC in the same statement as the arithmetic. `withdrawals` is
 * still the manual stock-withdrawal flow, which is why it is not read here.
 *
 * `change` is signed the way the ledger stores it: negative is consumed,
 * positive is returned. That is the opposite of the old `withdrawals.qty`,
 * which counted withdrawals as positive and leaned on `type` to say which
 * direction the stock actually moved.
 */
const movementLog = async () => {
  const { data } = await admin
    .from('stock_movements')
    .select('item_name, change, kind, document_id, qty_before, qty_after, moved_by_name')
    .eq('document_id', TICKET)
    .order('id', { ascending: false });
  return (data ?? []).map((r) => ({ ...r, change: Number(r.change) }));
};

/** Put the ticket and the stock row back, so the spec can run repeatedly. */
async function resetFixture(qty: number) {
  await admin.from('stock_movements').delete().eq('document_id', TICKET);
  await admin.from('stock').update({ qty }).eq('sku', SKU);
  const { data: items } = await admin.from('ticket_items').select('id').eq('ticket_id', TICKET);
  for (const item of items ?? []) {
    await admin.from('ticket_items').update({ actual_qty: {} }).eq('id', item.id);
  }
}

test.beforeEach(async () => {
  await resetFixture(15); // the seeded quantity
});

test.afterAll(async () => {
  await resetFixture(15);
});

test('recording actual usage on a ticket decrements stock and writes an audit row', async ({
  page,
}) => {
  expect(await stockQty()).toBe(15);

  await login(page, 'admin');
  await page.goto(`/tickets/${TICKET}`);

  const qtyInput = page.getByLabel(`จำนวนที่ใช้จริง ${PRODUCT}`);
  await expect(qtyInput).toBeVisible();
  await qtyInput.fill('2');

  await page.click('button:has-text("บันทึกใบงาน")');
  await expect(page).toHaveURL(/\/tickets(\?|$)/);

  // Stock went down by exactly the recorded amount.
  await expect.poll(stockQty, { timeout: 10_000 }).toBe(13);

  // …and the movement is on the record, credited to the signed-in user.
  const log = await movementLog();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({
    item_name: PRODUCT,
    change: -2,
    kind: 'ใบงาน',
    document_id: TICKET,
  });
  expect(log[0].moved_by_name).toBe('แอดมินระบบ');
  // The before/after pair is the point of 0026: the ledger entry and the
  // arithmetic are one statement, so these can never disagree with `stock.qty`.
  expect(Number(log[0].qty_before)).toBe(15);
  expect(Number(log[0].qty_after)).toBe(13);
});

test('the recorded quantity survives a reload, and re-saving does not double-count', async ({
  page,
}) => {
  await login(page, 'admin');
  await page.goto(`/tickets/${TICKET}`);
  await page.getByLabel(`จำนวนที่ใช้จริง ${PRODUCT}`).fill('3');
  await page.click('button:has-text("บันทึกใบงาน")');
  await expect(page).toHaveURL(/\/tickets(\?|$)/);
  await expect.poll(stockQty, { timeout: 10_000 }).toBe(12);

  // Reopen: the number must come back from the database, not reset to blank.
  await page.goto(`/tickets/${TICKET}`);
  await expect(page.getByLabel(`จำนวนที่ใช้จริง ${PRODUCT}`)).toHaveValue('3');

  // Saving again with the same number is a no-op for stock — this is the test that
  // fails if the save ever stops diffing against what is stored.
  await page.click('button:has-text("บันทึกใบงาน")');
  await expect(page).toHaveURL(/\/tickets(\?|$)/);
  await page.waitForTimeout(1500);
  expect(await stockQty()).toBe(12);
  expect(await movementLog()).toHaveLength(1);
});

test('revising the quantity downward returns the difference to stock', async ({ page }) => {
  await login(page, 'admin');
  await page.goto(`/tickets/${TICKET}`);
  await page.getByLabel(`จำนวนที่ใช้จริง ${PRODUCT}`).fill('5');
  await page.click('button:has-text("บันทึกใบงาน")');
  await expect.poll(stockQty, { timeout: 10_000 }).toBe(10);

  // Technician over-recorded; correct it to 1.
  await page.goto(`/tickets/${TICKET}`);
  await page.getByLabel(`จำนวนที่ใช้จริง ${PRODUCT}`).fill('1');
  await page.click('button:has-text("บันทึกใบงาน")');
  await expect.poll(stockQty, { timeout: 10_000 }).toBe(14); // 15 - 1

  const log = await movementLog();
  expect(log).toHaveLength(2);
  // Newest first: the correction returns 4 to stock, so `change` is positive.
  expect(log[0].change).toBe(4);
  expect(log[0].kind).toBe('ใบงาน');
  expect(Number(log[0].qty_before)).toBe(10);
  expect(Number(log[0].qty_after)).toBe(14);
});
