import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The seeded accounts from `supabase/seed.ts`. Staging/local only.
 */
export const ACCOUNTS = {
  admin: 'admin@finnixfilm.com',
  exec: 'exec@finnixfilm.com',
  sales: 'sales@finnixfilm.com',
  tech: 'tech@finnixfilm.com',
} as const;

export const SEED_PASSWORD = 'finnix-staging-2026';

/**
 * Log in through the real login form and wait for the app shell.
 *
 * Every spec starts here rather than injecting a session cookie, because the
 * login server action is what resolves the user's profile and permissions — the
 * thing most of these specs are actually testing the consequences of.
 */
export async function login(page: Page, account: keyof typeof ACCOUNTS) {
  await page.goto('/login');
  await page.fill('input[name=email]', ACCOUNTS[account]);
  await page.fill('input[name=password]', SEED_PASSWORD);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Log out by clearing the Supabase auth cookies, so the next login in the same
 * spec starts clean. Faster and less brittle than driving the header menu, and
 * these specs are not testing the logout control itself.
 */
export async function logout(page: Page) {
  await page.context().clearCookies();
}

/**
 * A service-role client for test SETUP only — never for assertions.
 *
 * Some workflows are one-way in the UI: approving a PO's price moves it out of
 * `รออนุมัติราคา` and there is no un-approve control, by design. A spec that
 * asserts on that transition therefore has to restore its own precondition, or it
 * passes exactly once per `db reset` and fails on every re-run. Restoring the row
 * directly is honest test setup; the assertions still go through the real UI and
 * the real server actions.
 */
export function dbAdmin() {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) {
    for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0 && !env[trimmed.slice(0, eq)]) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Force a wholesale order back to a known status, so a spec can re-run. */
export async function setOrderStatus(orderId: string, status: string) {
  const { error } = await dbAdmin().from('orders').update({ status }).eq('id', orderId);
  if (error) throw new Error(`could not reset ${orderId}: ${error.message}`);
}
