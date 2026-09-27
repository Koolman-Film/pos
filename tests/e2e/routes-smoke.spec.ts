import { test, expect } from '@playwright/test';

import { login } from './helpers';

/**
 * Every route renders for an admin, with no server error and no console error.
 *
 * This exists because of a real regression: `/stock` 500'd on every request for
 * the whole of Wave 4 — the page handed a Client Component a closure, which React
 * cannot serialise — and nothing caught it. Its unit test rendered the component
 * directly, where a function prop is legal, and no other test loaded the route.
 *
 * The guard against that whole class of bug is cheap: visit each page and assert
 * it actually rendered. Server-component wiring errors surface here as a 500 or as
 * a console error, both of which fail this spec.
 */
const ROUTES = [
  { path: '/dashboard', marker: 'ภาพรวมธุรกิจ' },
  { path: '/tickets', marker: 'Book งาน' },
  { path: '/tickets/new', marker: 'ชื่อลูกค้า' },
  { path: '/tickets/JT-CM-00214', marker: 'JT-CM-00214' },
  { path: '/wholesale', marker: 'ขายส่ง' },
  // The detail view shows the PO number only on the print sheet, so key off the
  // editor's own heading instead.
  { path: '/wholesale/WS-CM-0091', marker: 'รายการสินค้า' },
  { path: '/stock', marker: 'สต็อก' },
  { path: '/commission', marker: 'คอมมิชชั่น' },
  { path: '/accounting', marker: 'ค่าใช้จ่าย' },
  { path: '/permissions', marker: 'สิทธิ์' },
  // Checked by their <h1>: the sidebar carries links with the same words, so a
  // text marker would be found even on a page that failed to render.
  { path: '/revenue', heading: 'รายได้' },
  { path: '/money', heading: 'การจัดการเงิน/บัญชี' },
  { path: '/customers', heading: 'ทะเบียนลูกค้า' },
  { path: '/activity', heading: 'ประวัติการใช้งาน' },
  { path: '/daily-report', heading: 'รายงานการเงินรายวัน' },
];

test('every route renders for an admin with no errors', async ({ page }) => {
  const problems: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Font Awesome is loaded from a CDN; a blocked/slow icon font is not an app bug.
    if (/cdnjs\.cloudflare\.com|favicon/.test(msg.text())) return;
    problems.push(`console error on ${page.url()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    problems.push(`uncaught error on ${page.url()}: ${err.message}`);
  });

  await login(page, 'admin');

  for (const route of ROUTES) {
    const response = await page.goto(route.path);
    expect(response?.status(), `${route.path} should not error`).toBeLessThan(400);
    // A rendered marker proves the page produced its own content rather than an
    // error boundary that happens to return 200.
    const content =
      'heading' in route
        ? page.getByRole('heading', { level: 1, name: route.heading, exact: true })
        : page.locator('.app-shell').getByText(route.marker, { exact: false }).first();
    await expect(content, `${route.path} should render its content`).toBeVisible();
  }

  expect(problems, problems.join('\n')).toEqual([]);
});
