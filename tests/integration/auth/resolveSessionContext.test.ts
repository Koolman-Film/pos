/**
 * @vitest-environment node
 *
 * Runs on the node environment, not the project-wide jsdom default: jsdom's
 * `fetch` applies browser CORS rules to the Supabase origin and fails every
 * request with `AuthRetryableFetchError`, and its `URL` is not the one
 * `node:fs` accepts. There is no DOM in this file to need jsdom for.
 *
 * Integration test for the real authorization path, run against the local
 * Supabase stack (Postgres + GoTrue + PostgREST) with real auth users and the
 * RLS policies from `supabase/migrations/0007_rls_policies.sql` switched on.
 *
 * Lives under tests/integration/ for that reason. It spent a while in tests/unit/,
 * where it passed only because a developer machine happens to have .env.local and
 * a running stack; the first CI run — which has neither in the unit job — is what
 * surfaced it.
 *
 * `resolveSessionContext()` is deliberately Next-free, so it can be exercised
 * here with a plain `@supabase/supabase-js` client — no `next/headers` or
 * `next/navigation` stubbing, and nothing about the check is faked.
 *
 * Every fixture user gets a random email and is deleted in `afterAll`, so the
 * file is idempotent: it passes repeatedly without a `supabase db reset`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, afterAll } from 'vitest';

import { resolveSessionContext } from '@/lib/auth/resolveSessionContext';
import type { Database } from '@/lib/types/database';

// --- environment -----------------------------------------------------------
// Vitest does not load `.env.local`, and the RLS suite is invoked with
// SUPABASE_* exported. Accept either, falling back to parsing `.env.local`.
function readEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      // Vitest's root is the repo root.
      readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const eq = line.indexOf('=');
          return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

const fileEnv = readEnvLocal();
const pick = (...keys: string[]) =>
  keys.map((k) => process.env[k] ?? fileEnv[k]).find(Boolean) ?? '';

const url = pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
const anonKey = pick('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const serviceKey = pick('SUPABASE_SERVICE_ROLE_KEY');

const PASSWORD = 'test-password-123';
const ALL_SHOPS = ['cm', 'lp', 'py', 'lpg', 'ca'];

// Memory-only auth state: several clients share one jsdom `localStorage`, and
// the default storage key is per-project, so persisting would let one signed-in
// fixture clobber another's session.
const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  // This app's tables are in the `pos` schema (migration 0000); `public` belongs
  // to the co-located accounting app. All three clients below share these options,
  // so the schema is stated once.
  db: { schema: 'pos' as const },
};

const admin = createClient<Database>(url, serviceKey, authOptions);

const createdUserIds: string[] = [];

async function createAuthUser(): Promise<{ id: string; email: string }> {
  const email = `t9-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('createUser returned no user');
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, authOptions);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** Registered auth user + `app_users` row (+ optional shop access), signed in. */
async function createAppUser(opts: {
  roleId: string;
  name: string;
  seesAllShops?: boolean;
  active?: boolean;
  shopIds?: string[];
}) {
  const { id, email } = await createAuthUser();
  const { error } = await admin.from('app_users').insert({
    id,
    email,
    name: opts.name,
    role_id: opts.roleId,
    active: opts.active ?? true,
    sees_all_shops: opts.seesAllShops ?? false,
  });
  if (error) throw error;

  if (opts.shopIds?.length) {
    const { error: accessError } = await admin
      .from('user_shop_access')
      .insert(opts.shopIds.map((shop_id) => ({ user_id: id, shop_id })));
    if (accessError) throw accessError;
  }

  return { id, email, client: await signIn(email) };
}

afterAll(async () => {
  // Deleting the auth user cascades to `app_users` and `user_shop_access`.
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  createdUserIds.length = 0;
});

describe('resolveSessionContext (live Supabase)', () => {
  it('resolves a shop-scoped sales user from app_users + user_shop_access + role_permissions', async () => {
    const { id, email, client } = await createAppUser({
      roleId: 'sales',
      name: 'พนักงานขาย เชียงใหม่',
      shopIds: ['cm'],
    });

    const resolved = await resolveSessionContext(client);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const ctx = resolved.session;
    expect(ctx.userId).toBe(id);
    expect(ctx.email).toBe(email);
    expect(ctx.name).toBe('พนักงานขาย เชียงใหม่');
    expect(ctx.roleId).toBe('sales');
    expect(ctx.seesAllShops).toBe(false);
    expect(ctx.accessibleShopIds).toEqual(['cm']);

    // Straight from the seeded `role_permissions` rows (migration 0002).
    expect(ctx.hasNav('list')).toBe(true);
    expect(ctx.hasNav('stock')).toBe(false);
    expect(ctx.canDo('list.createNew')).toBe(true);
    expect(ctx.canDo('stock.editDelete')).toBe(false);
    expect(ctx.hasDashboardWidget('stockSummary')).toBe(true);
    expect(ctx.hasDashboardWidget('revenue')).toBe(false);
  });

  it('agrees with the database RLS helpers for the same user', async () => {
    const { client } = await createAppUser({
      roleId: 'sales',
      name: 'Agreement Check',
      shopIds: ['lp'],
    });

    const resolved = await resolveSessionContext(client);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const [seesAll, shops, canEdit, canCreate, hasStockNav] = await Promise.all([
      client.rpc('current_user_sees_all_shops'),
      client.rpc('current_user_shops'),
      client.rpc('current_user_can', { cap: 'stock.editDelete' }),
      client.rpc('current_user_can', { cap: 'list.createNew' }),
      client.rpc('current_user_has_nav', { nav_key: 'stock' }),
    ]);

    expect(seesAll.data).toBe(resolved.session.seesAllShops);
    expect((shops.data as unknown as string[]).sort()).toEqual(
      [...resolved.session.accessibleShopIds].sort(),
    );
    expect(canEdit.data).toBe(resolved.session.canDo('stock.editDelete'));
    expect(canCreate.data).toBe(resolved.session.canDo('list.createNew'));
    expect(hasStockNav.data).toBe(resolved.session.hasNav('stock'));
  });

  it('gives an admin every shop and every capability with no shop-access rows', async () => {
    const { client } = await createAppUser({ roleId: 'admin', name: 'แอดมิน' });

    const resolved = await resolveSessionContext(client);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.session.seesAllShops).toBe(true);
    expect(resolved.session.accessibleShopIds).toEqual(ALL_SHOPS);
    expect(resolved.session.canDo('stock.editDelete')).toBe(true);
    expect(resolved.session.hasNav('permissions')).toBe(true);
  });

  it('gives a non-admin with sees_all_shops every shop but not admin capabilities', async () => {
    const { client } = await createAppUser({
      roleId: 'tech',
      name: 'หัวหน้าช่าง',
      seesAllShops: true,
    });

    const resolved = await resolveSessionContext(client);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.session.seesAllShops).toBe(true);
    expect(resolved.session.accessibleShopIds).toEqual(ALL_SHOPS);
    expect(resolved.session.hasNav('wholesale')).toBe(false);
    expect(resolved.session.canDo('stock.withdraw')).toBe(true);
    expect(resolved.session.canDo('stock.editDelete')).toBe(false);
  });

  it('rejects a client with no session', async () => {
    const anon = createClient<Database>(url, anonKey, authOptions);
    expect(await resolveSessionContext(anon)).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('rejects an authenticated user who has no app_users row', async () => {
    const { email } = await createAuthUser();
    const client = await signIn(email);
    expect(await resolveSessionContext(client)).toEqual({ ok: false, reason: 'no_profile' });
  });

  it('rejects a suspended (active = false) account', async () => {
    const { client } = await createAppUser({
      roleId: 'sales',
      name: 'Suspended User',
      active: false,
      shopIds: ['cm'],
    });
    expect(await resolveSessionContext(client)).toEqual({ ok: false, reason: 'inactive' });
  });

  it('revalidates against the auth server, so a deleted user is rejected despite a live session', async () => {
    // This is the getUser()-vs-getSession() guarantee: the client still holds a
    // perfectly well-formed, unexpired token. `getSession()` would decode it and
    // happily hand back a user; `getUser()` asks the auth server and gets a 4xx.
    const { id, client } = await createAppUser({
      roleId: 'sales',
      name: 'Soon Deleted',
      shopIds: ['cm'],
    });
    expect((await resolveSessionContext(client)).ok).toBe(true);

    const stillHasToken = (await client.auth.getSession()).data.session?.access_token;
    expect(stillHasToken).toBeTruthy();

    await admin.auth.admin.deleteUser(id);
    createdUserIds.splice(createdUserIds.indexOf(id), 1);

    expect(await resolveSessionContext(client)).toEqual({ ok: false, reason: 'unauthenticated' });
  });
});
