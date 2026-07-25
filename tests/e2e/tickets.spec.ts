import { test, expect } from '@playwright/test';

// Written now, executed in Task 21 once the full app is wired end-to-end.
test('sales user can create a ticket and see it in the list', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', 'sales@finnixfilm.com');
  await page.fill('input[name=password]', 'test-password-123');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/dashboard/);

  await page.goto('/tickets/new');
  await page.fill('input[name=customerName]', 'คุณ ทดสอบ E2E');
  await page.fill('input[name=plate]', '9กก 9999');
  await page.click('button:has-text("บันทึก")');

  await page.goto('/tickets');
  await expect(page.getByText('คุณ ทดสอบ E2E')).toBeVisible();
});
