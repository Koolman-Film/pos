import { defineConfig } from '@playwright/test';

/**
 * e2e config (Task 21).
 *
 * These specs drive the real app against the real local Supabase stack — there
 * are no mocks — so they need `supabase start` + `db reset` + `seed.ts` first
 * (see docs/UPDATING.md) and they log in as the seeded accounts.
 *
 * Notes on the settings that are not defaults:
 *  - `workers: 1`. The specs mutate shared rows (a permission flip, a PO
 *    approval), so running them concurrently makes them race each other.
 *    Correctness over wall-clock for four specs.
 *  - `reuseExistingServer` outside CI: attaches to a dev server you already have
 *    running instead of fighting it for port 3000.
 *  - The webServer runs `next start` against a production build in CI and `next
 *    dev` locally. Dev is fine locally and much faster to iterate on; the print
 *    spec asserts computed CSS, which is identical either way.
 */
const PORT = 3000;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  // A dev-mode first paint can take a while to compile a route on demand.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: isCI ? `npm run build && npm run start -- --port ${PORT}` : `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
