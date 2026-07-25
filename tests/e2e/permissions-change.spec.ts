import { test, expect } from '@playwright/test';

import { login, logout } from './helpers';

/**
 * A permission change takes effect for the affected role (spec §9).
 *
 * This is the port's central claim — that permissions are data, not code — so the
 * spec drives it the long way round: an admin flips one capability in the matrix,
 * a user of that role logs in fresh, and the control it gates appears or
 * disappears accordingly.
 *
 * `tech` + `stock.editDelete` is the pair used because tech has stock nav access
 * (so the page is reachable) and starts with editDelete OFF, which gives a clean
 * off → on → off cycle that leaves the seed as it found it.
 */
const TOGGLE = 'หัวหน้าช่าง – stock: แก้ไข/ลบสินค้า';
const EDIT_BUTTON = 'แก้ไขสินค้า SKU-FLM-3M60';

async function setTechEditDelete(page: import('@playwright/test').Page, on: boolean) {
  await page.goto('/permissions');
  const toggle = page.getByRole('checkbox', { name: TOGGLE });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(on));
  }
}

/**
 * Always put the permission back, even when the test fails partway through.
 *
 * Without this, a mid-test failure leaves `stock.editDelete` granted to tech, and
 * the next thing to read the live permission table — `tests/unit/auth` and
 * `tests/rls`, which assert against the seeded matrix — fails for a reason that
 * has nothing to do with what it is testing. Shared mutable state needs teardown,
 * not a tidy happy path.
 */
test.afterEach(async ({ page }) => {
  await logout(page);
  await login(page, 'admin');
  await setTechEditDelete(page, false);
});

test('flipping stock.editDelete for the tech role adds and removes the control', async ({
  page,
}) => {
  // --- Baseline: tech cannot edit stock ---
  await login(page, 'tech');
  await page.goto('/stock');
  await expect(page.getByRole('button', { name: EDIT_BUTTON })).toHaveCount(0);

  // --- Admin grants it ---
  await logout(page);
  await login(page, 'admin');
  await setTechEditDelete(page, true);

  // --- Tech now has the control ---
  await logout(page);
  await login(page, 'tech');
  await page.goto('/stock');
  await expect(page.getByRole('button', { name: EDIT_BUTTON })).toBeVisible();

  // --- Admin revokes it, restoring the seeded state ---
  await logout(page);
  await login(page, 'admin');
  await setTechEditDelete(page, false);

  // --- And it is gone again ---
  await logout(page);
  await login(page, 'tech');
  await page.goto('/stock');
  await expect(page.getByRole('button', { name: EDIT_BUTTON })).toHaveCount(0);
});
