import { test, expect } from '@playwright/test';

import { login } from './helpers';

/**
 * Print isolation (spec §9) — the one thing in the port that unit tests
 * structurally cannot check, because it is a claim about *computed CSS under
 * print media* across a portal boundary.
 *
 * The mechanism, spread over three tasks: the print sheet is rendered through a
 * portal to document.body (Task 14) so it is a sibling of `.app-shell` (Task 12)
 * rather than a descendant, because the `@media print` block (Task 1) hides
 * `.app-shell` outright. Nest the print area inside the shell and it is hidden
 * along with it — a silent, screen-invisible regression that only shows up on
 * paper. Hence this spec.
 */
test('under print media the app shell is hidden and the print area is shown', async ({ page }) => {
  await login(page, 'admin');

  // JT-CM-00214 is seeded with items and payments, so the sheet has real content.
  await page.goto('/tickets/JT-CM-00214');

  const shell = page.locator('.app-shell');
  await expect(shell).toBeVisible();

  const printArea = page.locator('.print-area').first();
  // The portal renders it immediately (printMode defaults to 'job'); on screen it
  // is present but not laid out for display.
  await expect(printArea).toHaveCount(1);

  // The portal target must be body, NOT inside the shell — this is the assertion
  // that would catch someone "simplifying" the portal away.
  const isOutsideShell = await printArea.evaluate((el) => !el.closest('.app-shell'));
  expect(isOutsideShell).toBe(true);

  await page.emulateMedia({ media: 'print' });

  const shellDisplay = await shell.evaluate((el) => getComputedStyle(el).display);
  const printDisplay = await printArea.evaluate((el) => getComputedStyle(el).display);

  expect(shellDisplay).toBe('none');
  expect(printDisplay).toBe('block');

  await page.emulateMedia({ media: 'screen' });
  expect(await shell.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
});
