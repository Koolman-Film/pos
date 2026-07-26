import { test, expect, type Page } from '@playwright/test';

import { login } from './helpers';

/**
 * Visual regression baselines.
 *
 * These catch the class of breakage no assertion in the other specs can: a layout
 * that collapses, a theme token that stops resolving, a card that loses its
 * border, the print sheet reflowing. The port's styling is a hand-transcription of
 * the prototype's, so it is exactly the kind of thing that drifts silently.
 *
 * Determinism is the whole game with screenshots, and this app is full of moving
 * parts — a seeded dataset with RELATIVE dates, a trend chart, a "today"
 * highlight in the calendar, and a clock in the dashboard subtitle. So before
 * every shot we:
 *   - freeze animations and transitions,
 *   - hide the elements whose content is genuinely time-dependent,
 *   - wait for fonts, because Thai glyph metrics shift the whole layout.
 *
 * Update baselines deliberately, never reflexively:
 *   npm run test:e2e:update-snapshots
 * and read the diff image first — that diff is the point of the test.
 */

/** Selectors whose rendered content changes with the clock or the RNG. */
const NON_DETERMINISTIC = [
  '[data-testid="dashboard-date"]',
  '.job-calendar',
  'canvas', // the Chart.js trend line
];

const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  /* The blinking cursor and hover states are not part of the layout contract. */
  *:focus-visible { outline: none !important; }
`;

async function stabilise(page: Page) {
  await page.addStyleTag({ content: FREEZE_CSS });
  for (const selector of NON_DETERMINISTIC) {
    // Hidden rather than removed, so surrounding layout keeps its box.
    await page
      .locator(selector)
      .evaluateAll((els) => els.forEach((el) => ((el as HTMLElement).style.visibility = 'hidden')))
      .catch(() => {});
  }
  // Thai text needs the real font metrics or every line wraps differently.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

const PAGES: { name: string; path: string; ready: string }[] = [
  { name: 'dashboard', path: '/dashboard', ready: 'ภาพรวมธุรกิจ' },
  { name: 'tickets-list', path: '/tickets', ready: 'Book งาน' },
  { name: 'ticket-detail', path: '/tickets/JT-CM-00214', ready: 'JT-CM-00214' },
  { name: 'ticket-new', path: '/tickets/new', ready: 'ชื่อลูกค้า' },
  { name: 'wholesale-list', path: '/wholesale', ready: 'ขายส่ง' },
  { name: 'wholesale-detail', path: '/wholesale/WS-CM-0091', ready: 'รายการสินค้า' },
  { name: 'stock', path: '/stock', ready: 'สต็อกสินค้า' },
  { name: 'commission', path: '/commission', ready: 'ค่าคอมมิชชั่น' },
  { name: 'accounting', path: '/accounting', ready: 'บัญชี / ค่าใช้จ่าย' },
  { name: 'permissions', path: '/permissions', ready: 'จัดการสิทธิ์การเข้าถึง' },
];

test.describe('visual — light theme, desktop', () => {
  for (const p of PAGES) {
    test(`${p.name} matches its baseline`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await login(page, 'admin');
      await page.goto(p.path);
      await expect(page.locator('.app-shell').getByText(p.ready).first()).toBeVisible();
      await stabilise(page);

      await expect(page).toHaveScreenshot(`${p.name}-light.png`, {
        fullPage: true,
        // Thai antialiasing differs a hair between runs; a small tolerance keeps
        // the test about layout rather than about pixel noise.
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });
  }
});

test.describe('visual — dark theme', () => {
  // Dark mode was unreachable until Task 12 wired the attribute, so it is worth
  // having baselines rather than trusting that the token block still resolves.
  for (const p of [PAGES[0], PAGES[2], PAGES[6]]) {
    test(`${p.name} in dark mode matches its baseline`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await login(page, 'admin');
      await page.goto(p.path);
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      });
      await expect(page.locator('.app-shell').getByText(p.ready).first()).toBeVisible();
      await stabilise(page);

      await expect(page).toHaveScreenshot(`${p.name}-dark.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });
  }
});

test.describe('visual — mobile', () => {
  // The shop floor uses phones; the sidebar collapses behind a toggle at this size.
  for (const p of [PAGES[0], PAGES[1], PAGES[6]]) {
    test(`${p.name} on a phone matches its baseline`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await login(page, 'admin');
      await page.goto(p.path);
      await expect(page.locator('.app-shell').getByText(p.ready).first()).toBeVisible();
      await stabilise(page);

      await expect(page).toHaveScreenshot(`${p.name}-mobile.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });
  }
});

test.describe('visual — the printed documents', () => {
  /**
   * The print sheets are the port's highest-risk visuals: nobody sees them on
   * screen, they are laid out with inline styles transcribed by hand from the
   * prototype, and they are what the shop hands to a customer. Captured under
   * print media so the @media print rules are the ones being measured.
   */
  const SHEETS = [
    { name: 'job-sheet', ticket: 'JT-CM-00214' },
    { name: 'job-sheet-multi-category', ticket: 'JT-CM-00212' },
  ];

  for (const sheet of SHEETS) {
    test(`${sheet.name} matches its baseline under print media`, async ({ page }) => {
      await page.setViewportSize({ width: 1240, height: 1754 }); // ~A4 at 150dpi
      await login(page, 'admin');
      await page.goto(`/tickets/${sheet.ticket}`);
      await expect(page.locator('.print-area').first()).toHaveCount(1);

      await page.emulateMedia({ media: 'print' });
      await stabilise(page);

      // Only the print area is visible under print media; shoot that, not the page,
      // so the screenshot is the document rather than a mostly-blank viewport.
      await expect(page.locator('.print-area').first()).toHaveScreenshot(`${sheet.name}.png`, {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });
  }
});

test.describe('visual — login', () => {
  test('the login card matches its baseline', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/login');
    await expect(page.getByText('เข้าสู่ระบบ').first()).toBeVisible();
    await stabilise(page);
    await expect(page).toHaveScreenshot('login-light.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});
