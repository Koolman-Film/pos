import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

import { login } from './helpers';

/**
 * Accessibility audit of every route, at WCAG 2.1 A/AA.
 *
 * This matters more here than in a typical admin tool: the app is used on a shop
 * floor, often on a phone, sometimes by someone wearing gloves and looking at a
 * screen in daylight. Colour contrast and hit targets are working conditions, not
 * compliance paperwork.
 *
 * The prototype was a design mock and was never audited, so a finding here is not
 * automatically a port defect — but it is automatically something to decide about
 * rather than inherit silently. Anything deliberately accepted goes in
 * KNOWN_ISSUES with a reason, so the list stays short and honest.
 */

const KNOWN_ISSUES: { id: string; reason: string }[] = [];

/**
 * Colour pairs inherited from the prototype's palette that fall short of the 4.5:1
 * AA threshold, with their measured ratios.
 *
 * These are NOT port defects — they are the reference design's own token values,
 * and changing them would move the port away from visual parity with the
 * prototype, which is the thing this whole port is measured against. So they are
 * tracked here rather than silently fixed or silently ignored: the palette is a
 * decision for the design owner, and it is written down with numbers so that
 * decision can be made on evidence.
 *
 * The two that matter most in practice:
 *   --ink-faint (#b5aaa1) on white  →  2.27:1  (hint text, placeholders, metadata)
 *   --ink-soft  (#8b7f76) on white  →  3.89:1  (secondary labels)
 * Darkening --ink-faint to about #8a7f76 and --ink-soft to about #6f635b would
 * clear AA while staying in the same warm-grey family.
 *
 * Anything NOT in this list still fails the test — that is the point. A new
 * low-contrast pair introduced by the port is a regression, and stays one.
 */
const INHERITED_CONTRAST_PAIRS = new Set([
  '#b5aaa1 on #faf7f3', // 2.13 — faint text on the paper background
  '#b5aaa1 on #ffffff', // 2.27 — faint text on cards
  '#6f6a69 on #211a18', // 3.21 — dark-theme faint text
  '#8b7f76 on #faf7f3', // 3.64 — soft text on paper
  '#8b7f76 on #ffffff', // 3.89 — soft text on cards
  '#9e5d69 on #f3e3e6', // 4.01 — the danger pill
  '#4c7a3e on #e6efdc', // 4.26 — the success pill
  '#858180 on #211a18', // 4.44 — dark-theme soft text
]);

const ROUTES = [
  { name: 'dashboard', path: '/dashboard', ready: 'ภาพรวมธุรกิจ' },
  { name: 'tickets', path: '/tickets', ready: 'Book งาน' },
  { name: 'ticket-detail', path: '/tickets/JT-CM-00214', ready: 'JT-CM-00214' },
  { name: 'wholesale', path: '/wholesale', ready: 'ขายส่ง' },
  { name: 'stock', path: '/stock', ready: 'สต็อกสินค้า' },
  { name: 'commission', path: '/commission', ready: 'ค่าคอมมิชชั่น' },
  { name: 'accounting', path: '/accounting', ready: 'บัญชี / ค่าใช้จ่าย' },
  { name: 'permissions', path: '/permissions', ready: 'จัดการสิทธิ์การเข้าถึง' },
];

/**
 * Let the page settle before auditing.
 *
 * Every module enters behind a `.fade-page` animation. Auditing mid-animation
 * makes axe measure a partially-transparent colour blended against whatever is
 * behind it, which reports contrast pairs that exist for a few frames and never
 * settle — noise that looks exactly like a real finding. Freeze the animations and
 * let styles settle, so what gets audited is the UI a person actually reads.
 */
async function settle(page: Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

const analyse = (page: Page) =>
  new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(KNOWN_ISSUES.map((k) => k.id))
    .analyze();

test.describe('accessibility', () => {
  test('the login screen has no violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('เข้าสู่ระบบ').first()).toBeVisible();
    await settle(page);

    const results = await analyse(page);
    expect(describe(results.violations)).toEqual([]);
  });

  for (const route of ROUTES) {
    test(`${route.name} has no violations`, async ({ page }) => {
      await login(page, 'admin');
      await page.goto(route.path);
      await expect(page.locator('.app-shell').getByText(route.ready).first()).toBeVisible();
      await settle(page);

      const results = await analyse(page);
      expect(describe(results.violations)).toEqual([]);
    });
  }

  test('every KNOWN_ISSUES entry carries a reason', () => {
    for (const issue of KNOWN_ISSUES) {
      expect(issue.reason.length, `${issue.id} needs a real reason`).toBeGreaterThan(20);
    }
  });
});

/**
 * Turn axe's violation objects into short, readable lines. A raw dump is
 * unreadable in CI output, and an assertion nobody can act on gets muted.
 */
type Violation = {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown[]; html?: string; any?: { data?: unknown }[] }[];
};

function describe(violations: Violation[]): string[] {
  return violations.flatMap((v) => {
    // Contrast is reported per node; drop the nodes whose colour pair is a
    // documented inherited one, and report only genuinely new pairs.
    const nodes =
      v.id === 'color-contrast'
        ? v.nodes.filter((n) => {
            const d = n.any?.[0]?.data as { fgColor?: string; bgColor?: string } | undefined;
            if (!d?.fgColor || !d?.bgColor) return true;
            return !INHERITED_CONTRAST_PAIRS.has(`${d.fgColor} on ${d.bgColor}`);
          })
        : v.nodes;

    if (nodes.length === 0) return [];
    return [
      `${v.id} (${v.impact ?? 'unknown'}): ${v.help} — ${nodes.length} node(s), first: ${JSON.stringify(
        nodes[0]?.target,
      )}`,
    ];
  });
}
