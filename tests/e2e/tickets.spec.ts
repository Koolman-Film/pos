import { test, expect } from '@playwright/test';

import { login } from './helpers';

/**
 * Ticket creation, end to end: the sales user has `list.createNew`, so the form
 * is reachable and the insert should land in the list.
 *
 * A unique plate per run keeps this idempotent — the spec inserts a real row into
 * the local database and does not clean up, which is intentional: re-running
 * against an accumulating table is exactly what production does.
 */
test('sales user can create a ticket and see it in the list', async ({ page }) => {
  await login(page, 'sales');

  const plate = `9กก ${Date.now().toString().slice(-4)}`;

  await page.goto('/tickets/new');

  // Pick an existing customer from the register — this fills both the name and
  // the phone, the two fields the form marks required.
  // The option label is `{name} · {phone}`, built in TicketCustomerPicker.
  await page.getByLabel('เลือกลูกค้าจากทะเบียน').selectOption({ label: 'คุณ เอ · 081-234-5678' });
  await page.getByLabel('ทะเบียนรถ/เลขถัง').fill(plate);

  await page.click('button:has-text("บันทึกใบงาน")');

  // The save action redirects to the list on success.
  await expect(page).toHaveURL(/\/tickets(\?|$)/);
  await expect(page.getByText(plate).first()).toBeVisible();
});
