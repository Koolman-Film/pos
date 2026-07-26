import { describe, it, expect } from 'vitest';

import { adminClient, anonClient } from '../rls/_helpers';

/**
 * The admin login that `supabase/seed.sql` creates directly in Auth's tables.
 *
 * Worth a test because the failure mode is silent and total. `auth.users` has
 * several columns that are nullable in the schema but that GoTrue scans into plain
 * Go strings — `confirmation_token`, `recovery_token`, `email_change`,
 * `email_change_token_new`. Leave any of them NULL and the row looks perfectly
 * correct in psql while every single sign-in fails with an opaque 500. That is
 * exactly what happened on the first attempt at this seed.
 *
 * So this asserts the thing that actually matters — that the credential works —
 * rather than that the rows exist.
 */

const SEED_ADMIN_EMAIL = 'admin@finnixfilm.com';
const SEED_ADMIN_PASSWORD = 'finnix-staging-2026';
const SEED_ADMIN_ID = '00000000-0000-4000-8000-000000000001';

describe('seed admin login', () => {
  it('can sign in with the seeded password', async () => {
    const { data, error } = await anonClient().auth.signInWithPassword({
      email: SEED_ADMIN_EMAIL,
      password: SEED_ADMIN_PASSWORD,
    });

    expect(error, error ? `sign-in failed: ${error.status} ${error.message}` : '').toBeNull();
    expect(data.user?.email).toBe(SEED_ADMIN_EMAIL);
    expect(data.session?.access_token).toBeTruthy();
  });

  // NOTE: the two obvious structural checks — "exactly one auth.identities row"
  // and "none of the GoTrue string columns are NULL" — are deliberately absent.
  // The `auth` schema is not exposed through PostgREST, so a test client cannot
  // read it, and both conditions are already covered behaviourally by the sign-in
  // above: a missing identity or a NULL token column makes it fail. Asserting the
  // outcome beats asserting the mechanism.

  it('has an app_users profile, without which the app bounces it to /login', async () => {
    const { data } = await adminClient()
      .from('app_users')
      .select('role_id, active, sees_all_shops')
      .eq('id', SEED_ADMIN_ID)
      .single();

    expect(data).toEqual({ role_id: 'admin', active: true, sees_all_shops: true });
  });

  it('is not duplicated by running supabase/seed.ts afterwards', async () => {
    // seed.ts owns the same email and is documented idempotent; if it ever starts
    // creating a second account instead of updating this one, logins become
    // ambiguous and this catches it.
    const { data } = await adminClient()
      .from('app_users')
      .select('id')
      .eq('email', SEED_ADMIN_EMAIL);
    expect(data).toHaveLength(1);
  });
});
