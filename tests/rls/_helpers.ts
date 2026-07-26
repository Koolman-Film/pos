// tests/rls/_helpers.ts
//
// Shared bootstrap for the Supabase integration tests under tests/rls/.
//
// Responsibilities:
//   1. Make the tests runnable with zero manual `export`s by loading `.env.local`
//      from the repo root when the variables are not already in `process.env`.
//   2. Fail loudly and actionably when a required variable really is missing,
//      instead of silently handing `undefined` to `createClient()` (which
//      produces a client that fails much later with a confusing error).
//   3. Provide the pre-configured clients and the fixture-cleanup primitives that
//      every test file needs so each run starts from a known state.
//
// No third-party dependency is used for env loading: `.env.local` is a trivial
// KEY=VALUE file and `dotenv` is not installed in this project.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types/database';

const ENV_FILE = '.env.local';

/** Walk up from this file looking for the repo-root `.env.local`. */
function findEnvFile(): string | null {
  const roots = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const root of roots) {
    let dir = root;
    for (;;) {
      const candidate = join(dir, ENV_FILE);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * Parse `.env.local` and populate `process.env` for keys that are not already
 * set. Real environment variables always win, so CI can override the file.
 */
function loadEnvFile(): void {
  const file = findEnvFile();
  if (!file) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

/**
 * Read the first of `names` that has a non-empty value, or throw an error that
 * names exactly what is missing and how to supply it.
 */
function requireEnv(names: [string, ...string[]]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  const [primary, ...aliases] = names;
  const aliasNote = aliases.length ? ` (or ${aliases.join(' / ')})` : '';
  throw new Error(
    `[tests/rls] Missing required environment variable ${primary}${aliasNote}.\n` +
      `These tests talk to a real local Supabase stack. Fix this by either:\n` +
      `  - adding ${primary}=... to ${ENV_FILE} at the repo root, or\n` +
      `  - exporting ${primary} in the shell before running vitest.\n` +
      `Start the local stack with \`npx supabase start\`; \`npx supabase status\` prints the URL and keys.`,
  );
}

export const supabaseUrl = (): string => requireEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
export const supabaseAnonKey = (): string =>
  requireEnv(['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
export const supabaseServiceRoleKey = (): string => requireEnv(['SUPABASE_SERVICE_ROLE_KEY']);

// `persistSession: false` matters: the suite runs under jsdom, where every
// client built from the same URL would otherwise share one localStorage slot and
// clobber each other's sessions.
// `db.schema` matters as much as the auth options here: this app's tables live in
// the `pos` schema (migration 0000), so a client left on the default `public`
// would query the co-located accounting app's schema and find nothing.
/**
 * A client bound to this app's `pos` schema (migration 0000).
 *
 * Named so the generic is declared in one place: a bare `SupabaseClient` defaults
 * to the `public` schema, which in this database belongs to the co-located
 * accounting app — so an un-parameterised annotation compiles but describes the
 * wrong database.
 */
export type PosClient = SupabaseClient<Database, 'pos'>;

const NO_SESSION = {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'pos' },
} as const;

/** Service-role client. Bypasses RLS — use for fixtures and assertions. */
// The 'pos' schema generic has to appear in the return type too, or the
// annotation silently widens back to the default 'public' and stops matching.
export function adminClient(): PosClient {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), NO_SESSION);
}

/** Anon-key client. Subject to RLS — use to act as a signed-in end user. */
export function anonClient(): PosClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), NO_SESSION);
}

/**
 * All six test files run as parallel vitest workers against one local stack. The
 * very first request burst after `supabase db reset` restarts the containers can
 * lose a connection, which shows up as an opaque `fetch failed` / 5xx and kills
 * a `beforeAll` hook. Retry only those transient shapes — a real error (a
 * constraint violation, a bad payload, an RLS denial) is rethrown immediately.
 */
function isTransient(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '');
  const status = Number((error as { status?: unknown } | null)?.status ?? 0);
  return (
    /fetch failed|network|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|terminated|timeout/i.test(
      message,
    ) ||
    (status >= 500 && status <= 599)
  );
}

/**
 * A persistent 502/503 from `/auth/v1/*` is almost always Kong holding a stale
 * upstream address: `supabase db reset` recreates the auth container with a new
 * IP but leaves the long-lived Kong container untouched. Retrying never helps,
 * so say so instead of failing with an empty `{}` message.
 */
function gatewayHint(error: unknown): string {
  const status = Number((error as { status?: unknown } | null)?.status ?? 0);
  if (status !== 502 && status !== 503 && status !== 504) return '';
  return (
    `\nThe API gateway returned ${status} for the auth service. This usually means the local ` +
    `Supabase stack's Kong container is routing to a stale auth container (a known side effect of ` +
    `\`supabase db reset\` restarting containers). Restart the stack — \`npx supabase stop && npx supabase start\` ` +
    `— then re-run. This is a stack issue, not a test failure.`
  );
}

async function withRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const attempts = 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  const detail = String((lastError as { message?: unknown } | null)?.message ?? lastError);
  throw new Error(
    `[tests/rls] ${label} failed after ${attempts} attempt(s): ${detail || '(no message)'}` +
      gatewayHint(lastError),
    { cause: lastError },
  );
}

/** Turn a Supabase `{ error }` result into a thrown Error with real context. */
export function assertNoError(label: string, error: { message?: string } | null): void {
  if (error) throw new Error(`[tests/rls] ${label}: ${error.message ?? JSON.stringify(error)}`);
}

/**
 * Find an auth user by email, paging through the admin list endpoint.
 * Returns null when no such user exists.
 */
export async function findAuthUserByEmail(
  admin: PosClient,
  email: string,
): Promise<{ id: string } | null> {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data } = await withRetry(`listUsers(page ${page})`, async () => {
      const result = await admin.auth.admin.listUsers({ page, perPage });
      if (result.error) throw result.error;
      return result;
    });
    const users = data?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return { id: match.id };
    if (users.length < perPage) return null;
  }
  return null;
}

/**
 * Remove an auth user and its public-schema rows, if present. Idempotent: a
 * missing user is a no-op. `app_users` and `user_shop_access` cascade from
 * `auth.users`, but they are deleted explicitly first so a half-cleaned state
 * (public rows left behind by an aborted run) also gets repaired.
 */
export async function deleteAuthUserByEmail(admin: PosClient, email: string): Promise<void> {
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) {
    await admin.from('user_shop_access').delete().eq('user_id', existing.id);
    await admin.from('app_users').delete().eq('id', existing.id);
    await withRetry(`deleteUser(${email})`, async () => {
      const { error } = await admin.auth.admin.deleteUser(existing.id);
      // A concurrent/duplicate delete leaving nothing to do is not a failure.
      if (error && !/not.?found/i.test(error.message)) throw error;
    });
  }
  // Guard against an orphaned app_users row whose auth user is already gone.
  await admin.from('app_users').delete().eq('email', email);
}

/** Create an auth user, retrying only transient stack failures. */
export async function createAuthUser(
  admin: PosClient,
  email: string,
  password: string,
): Promise<{ id: string }> {
  return withRetry(`createUser(${email})`, async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    if (!data?.user) throw new Error(`createUser returned no user for ${email}`);
    return { id: data.user.id };
  });
}
