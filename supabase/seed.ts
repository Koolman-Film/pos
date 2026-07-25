/**
 * Creates the four sample login accounts (Task 20, spec §7).
 *
 *   npx tsx supabase/seed.ts
 *
 * Run this AFTER `supabase db reset`, which runs seed.sql but cannot create these:
 * a login needs a row in `auth.users`, which belongs to Auth and is not reachable
 * from the SQL seed the way the `public` tables are. So the users are created
 * through the Admin API, and their `app_users` profile + `user_shop_access` rows
 * are written here too, keyed on the uuid Auth hands back.
 *
 * The accounts are `initialUsers` (reference/v0.4/finnix-film.html:161-166):
 *
 *   admin@finnixfilm.com  แอดมินระบบ    admin  every shop
 *   exec@finnixfilm.com   ผู้บริหาร      exec   every shop
 *   sales@finnixfilm.com  พนักงานขาย     sales  เชียงใหม่ only
 *   tech@finnixfilm.com   หัวหน้าช่าง     tech   เชียงใหม่ only
 *
 * They all share the password below. It is a STAGING/LOCAL convenience and must
 * never be used for the production project — production starts with an empty
 * schema and no seeded users at all (plan Task 22, Step 4).
 *
 * Idempotent: an existing account is looked up and updated rather than
 * re-created, so re-running after a partial failure is safe.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STAGING_PASSWORD = 'finnix-staging-2026';

type SeedUser = {
  email: string;
  name: string;
  roleId: string;
  /** true = every shop (the prototype's shopAccess:'all'). */
  seesAllShops: boolean;
  /** Explicit per-shop grants, used only when seesAllShops is false. */
  shopAccess: string[];
};

const USERS: SeedUser[] = [
  { email: 'admin@finnixfilm.com', name: 'แอดมินระบบ', roleId: 'admin', seesAllShops: true, shopAccess: [] },
  { email: 'exec@finnixfilm.com', name: 'ผู้บริหาร', roleId: 'exec', seesAllShops: true, shopAccess: [] },
  { email: 'sales@finnixfilm.com', name: 'พนักงานขาย', roleId: 'sales', seesAllShops: false, shopAccess: ['cm'] },
  { email: 'tech@finnixfilm.com', name: 'หัวหน้าช่าง', roleId: 'tech', seesAllShops: false, shopAccess: ['cm'] },
];

/**
 * Minimal .env.local reader. Avoids adding a dotenv dependency for a script that
 * runs by hand; `process.env` still wins so CI can inject the values instead.
 */
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  } catch {
    // No .env.local — fall through to process.env only.
  }
  return { ...env, ...(process.env as Record<string, string>) };
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local.example).\n' +
        'Get them from `npx supabase status`.'
    );
  }

  // The service-role client bypasses RLS, which is required both to create users
  // and to write app_users before any session exists.
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fail loudly if the migrations have not been applied — otherwise the FK errors
  // below are much harder to read than this message.
  const { error: rolesError } = await admin.from('roles').select('id').limit(1);
  if (rolesError) {
    throw new Error(
      `Cannot read the roles table (${rolesError.message}). Run \`npx supabase db reset\` first.`
    );
  }

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const byEmail = new Map(existing.users.map((u) => [u.email?.toLowerCase(), u]));

  for (const u of USERS) {
    let userId = byEmail.get(u.email)?.id;

    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password: STAGING_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      console.log(`↻ reused ${u.email}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: STAGING_PASSWORD,
        // Without this the account needs an email round-trip before it can log in,
        // and the local stack only captures mail in Inbucket.
        email_confirm: true,
      });
      if (error) throw error;
      userId = data.user.id;
      console.log(`+ created ${u.email}`);
    }

    const { error: profileError } = await admin.from('app_users').upsert(
      {
        id: userId,
        email: u.email,
        name: u.name,
        role_id: u.roleId,
        active: true,
        sees_all_shops: u.seesAllShops,
      },
      { onConflict: 'id' }
    );
    if (profileError) throw profileError;

    // Replace rather than merge, so removing a grant from USERS actually removes it.
    const { error: deleteError } = await admin
      .from('user_shop_access')
      .delete()
      .eq('user_id', userId);
    if (deleteError) throw deleteError;

    if (u.shopAccess.length > 0) {
      const { error: accessError } = await admin
        .from('user_shop_access')
        .insert(u.shopAccess.map((shopId) => ({ user_id: userId, shop_id: shopId })));
      if (accessError) throw accessError;
    }
  }

  console.log(`\n${USERS.length} accounts ready. Password for all: ${STAGING_PASSWORD}`);
}

main().catch((err) => {
  console.error('\nSeeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
