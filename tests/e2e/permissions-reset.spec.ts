import { test, expect } from '@playwright/test';

import { dbAdmin, login } from './helpers';

/**
 * The "รีเซ็ตค่าเริ่มต้น" button restored from the prototype (:4047).
 *
 * The integration tests cover what the SQL function does; this covers the button:
 * that it is confirmed before firing, that a dismissed confirm changes nothing,
 * and that accepting it really does put a drifted matrix back.
 */
const admin = dbAdmin();

const techEditDelete = async () => {
  const { data } = await admin
    .from('role_permissions')
    .select('allowed')
    .eq('role_id', 'tech')
    .eq('permission_type', 'module_capability')
    .eq('permission_key', 'stock.editDelete')
    .single();
  return data!.allowed as boolean;
};

const setTechEditDelete = async (allowed: boolean) => {
  await admin
    .from('role_permissions')
    .update({ allowed })
    .eq('role_id', 'tech')
    .eq('permission_type', 'module_capability')
    .eq('permission_key', 'stock.editDelete');
};

test.afterEach(async () => {
  await admin.rpc('reset_permissions_to_defaults');
});

test('dismissing the confirm leaves the drifted matrix untouched', async ({ page }) => {
  await setTechEditDelete(true);
  expect(await techEditDelete()).toBe(true);

  await login(page, 'admin');
  await page.goto('/permissions');

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('บทบาทที่สร้างเองจะไม่ถูกแตะต้อง');
    return dialog.dismiss();
  });
  await page.click('button:has-text("รีเซ็ตค่าเริ่มต้น")');

  await page.waitForTimeout(1000);
  expect(await techEditDelete()).toBe(true); // still drifted — nothing happened
});

test('accepting the confirm restores the seeded defaults', async ({ page }) => {
  await setTechEditDelete(true);

  await login(page, 'admin');
  await page.goto('/permissions');

  page.once('dialog', (dialog) => dialog.accept());
  await page.click('button:has-text("รีเซ็ตค่าเริ่มต้น")');

  await expect.poll(techEditDelete, { timeout: 10_000 }).toBe(false);

  // The matrix cell in the UI follows, without a manual reload.
  await expect(
    page.getByRole('checkbox', { name: 'หัวหน้าช่าง – stock: แก้ไข/ลบสินค้า' }),
  ).toHaveAttribute('aria-checked', 'false');
});

test('the reset button is not offered to a role without the permissions nav', async ({ page }) => {
  // /permissions 404s for a non-admin, so the control is unreachable by design.
  await login(page, 'sales');
  const response = await page.goto('/permissions');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('button', { name: /รีเซ็ตค่าเริ่มต้น/ })).toHaveCount(0);
});
