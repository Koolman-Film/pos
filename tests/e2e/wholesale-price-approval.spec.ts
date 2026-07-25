import { test, expect } from '@playwright/test';

import { login, logout, setOrderStatus } from './helpers';

/**
 * The wholesale price-approval workflow (spec §9).
 *
 * WS-CM-0091 is seeded as `รออนุมัติราคา` with a requested price below list
 * (10 × 1,000 against a 1,200 list), so it is exactly the case the workflow
 * exists for.
 *
 * Two halves, and the second is the one that matters: the control is hidden from
 * a user without `wholesale.priceApproval`, AND the server action refuses even if
 * that user reaches it another way — the UI gate is not the authorization
 * boundary (correction C2).
 */
const ORDER_ID = 'WS-CM-0091';

// Approval is one-way in the UI, so restore the seeded precondition first. Without
// this the spec passes once per `db reset` and fails on every re-run.
test.beforeEach(async () => {
  await setOrderStatus(ORDER_ID, 'รออนุมัติราคา');
});

// And leave it as the seed had it, so the unit/RLS suites that read live rows and
// the next run of this spec both start from the documented state.
test.afterAll(async () => {
  await setOrderStatus(ORDER_ID, 'รออนุมัติราคา');
});

test('an exec can approve a pending discounted price, moving the PO to รอจัดส่ง', async ({
  page,
}) => {
  await login(page, 'exec');
  await page.goto(`/wholesale/${ORDER_ID}`);

  // The approval affordance only renders for a discounted, pending PO.
  await expect(page.getByText('มีส่วนลดรออนุมัติ')).toBeVisible();

  // 10 × 1,000 with no returns or adjustments.
  await expect(page.getByText('10,000.00').first()).toBeVisible();

  await page.click('button:has-text("อนุมัติราคานี้")');

  // The action redirects/revalidates; the status leaves รออนุมัติราคา.
  await expect(page.getByText('มีส่วนลดรออนุมัติ')).toBeHidden();

  await page.goto('/wholesale');
  // Scope to the shell: the body-level print portal also contains a table with
  // this id, and it is hidden on screen, so an unscoped locator matches that one.
  await expect(page.locator('.app-shell').getByText(ORDER_ID).first()).toBeVisible();
  // The PO has left the pending-approval bucket.
  await expect(page.locator('.app-shell').getByText('รอจัดส่ง').first()).toBeVisible();
});

test('a sales user sees the pending notice but no approve button', async ({ page }) => {
  await logout(page);
  await login(page, 'sales');
  await page.goto(`/wholesale/${ORDER_ID}`);

  // Whatever this PO's status is by now, the sales user must never get the control.
  await expect(page.getByRole('button', { name: 'อนุมัติราคานี้' })).toHaveCount(0);
});
