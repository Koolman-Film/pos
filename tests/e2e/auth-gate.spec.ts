import { expect, test } from '@playwright/test';

import { ACCOUNTS, SEED_PASSWORD, login, logout } from './helpers';

/**
 * The proxy's front-door gate.
 *
 * `proxy.ts` verifies the session with `getClaims()`, which checks the token's
 * ES256 signature locally against a cached JWKS instead of asking the auth
 * server on every request. Local verification is only worth anything if a token
 * that does not verify is actually turned away, so that is what these assert:
 * no cookie, and a cookie whose signature no longer matches its payload.
 *
 * There was no coverage of the unauthenticated redirect at all before this,
 * which made the switch away from `getUser()` unfalsifiable from the suite.
 */
const PROTECTED = ['/dashboard', '/tickets', '/stock', '/revenue', '/permissions'];

test('every protected route bounces a caller with no session to /login', async ({ page }) => {
  await page.context().clearCookies();

  for (const path of PROTECTED) {
    await page.goto(path);
    await expect(page, `${path} must not render without a session`).toHaveURL(/\/login/);
  }
});

test('a forged token — valid shape, wrong signature — is rejected', async ({ page }) => {
  // Start from a real session so the cookie is genuine in every respect except
  // the one thing under test.
  await login(page, 'admin');

  const cookies = await page.context().cookies();
  const authCookie = cookies.find((c) => c.name.includes('auth-token'));
  expect(authCookie, 'expected a Supabase auth cookie after login').toBeTruthy();

  // The cookie is `base64-<session JSON>`, not a bare JWT, so corrupting the
  // string at random only breaks the envelope — which any implementation
  // rejects and which would prove nothing about signature checking. Unwrap it,
  // edit a CLAIM inside the access token, and re-wrap: the result is a
  // perfectly well-formed session whose JWT signature no longer matches its
  // payload. A real verification refuses it; a bare decode waves it through.
  const raw = authCookie!.value;
  expect(raw.startsWith('base64-'), 'unexpected cookie encoding').toBeTruthy();

  const session = JSON.parse(Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8'));
  const [header, payload, signature] = (session.access_token as string).split('.');
  expect(signature, 'access_token should be a three-part JWT').toBeTruthy();

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.role = 'service_role'; // the escalation a forger would actually want
  const forgedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  expect(forgedPayload).not.toBe(payload);

  // Same header, same (now wrong) signature, edited payload.
  session.access_token = `${header}.${forgedPayload}.${signature}`;
  const forgedCookie = `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`;

  await page.context().clearCookies();
  await page.context().addCookies([{ ...authCookie!, value: forgedCookie }]);

  await page.goto('/dashboard');
  await expect(page, 'a token whose signature does not match must not be accepted').toHaveURL(
    /\/login/,
  );
});

test('a valid session still reaches the app, and logging out closes it again', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);

  await logout(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test.describe('the seeded roles can all still sign in', () => {
  for (const role of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
    test(`${role} signs in with the real form`, async ({ page }) => {
      await page.goto('/login');
      await page.fill('input[name=email]', ACCOUNTS[role]);
      await page.fill('input[name=password]', SEED_PASSWORD);
      await page.click('button[type=submit]');
      await expect(page).toHaveURL(/\/dashboard/);
    });
  }
});
