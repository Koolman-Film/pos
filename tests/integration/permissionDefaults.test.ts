import { describe, it, expect, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';

/**
 * `reset_permissions_to_defaults()` — the SQL function behind the Permissions
 * module's "รีเซ็ตค่าเริ่มต้น" button (migration 0009).
 *
 * The function now holds the canonical default matrix, which migration 0002 also
 * spells out as literal INSERTs. Two copies of the same data will drift, so the
 * first test here is the one that matters: calling the function on a
 * freshly-migrated database must change nothing. If 0002 and 0009 ever disagree,
 * that test fails and says so.
 */

const admin = adminClient();

type PermRow = {
  role_id: string;
  permission_type: string;
  permission_key: string;
  allowed: boolean;
};

const snapshotMatrix = async (): Promise<string> => {
  const { data } = await admin
    .from('role_permissions')
    .select('role_id, permission_type, permission_key, allowed');
  return (data as PermRow[])
    .map((r) => `${r.role_id}|${r.permission_type}|${r.permission_key}|${r.allowed}`)
    .sort()
    .join('\n');
};

const snapshotRoles = async (): Promise<string> => {
  const { data } = await admin.from('roles').select('id, name, icon').order('id');
  return (data ?? []).map((r) => `${r.id}|${r.name}|${r.icon}`).join('\n');
};

const reset = async () => {
  const { error } = await admin.rpc('reset_permissions_to_defaults');
  assertNoError('reset_permissions_to_defaults', error);
};

afterAll(async () => {
  // Leave the database as the seed had it, whatever these tests did.
  await admin.from('roles').delete().eq('id', 'qa-temp-role');
  await reset();
});

describe('reset_permissions_to_defaults', () => {
  it('is a no-op on a freshly-seeded database — proving 0009 agrees with 0002', async () => {
    const before = await snapshotMatrix();
    const rolesBefore = await snapshotRoles();

    await reset();

    expect(await snapshotMatrix()).toBe(before);
    expect(await snapshotRoles()).toBe(rolesBefore);
  });

  it('restores a permission that was flipped away from its default', async () => {
    // tech.stock.editDelete defaults to false.
    await admin
      .from('role_permissions')
      .update({ allowed: true })
      .eq('role_id', 'tech')
      .eq('permission_type', 'module_capability')
      .eq('permission_key', 'stock.editDelete');

    await reset();

    const { data } = await admin
      .from('role_permissions')
      .select('allowed')
      .eq('role_id', 'tech')
      .eq('permission_type', 'module_capability')
      .eq('permission_key', 'stock.editDelete')
      .single();
    expect(data!.allowed).toBe(false);
  });

  it('re-adds a permission row that was deleted outright', async () => {
    await admin
      .from('role_permissions')
      .delete()
      .eq('role_id', 'sales')
      .eq('permission_type', 'nav')
      .eq('permission_key', 'dashboard');

    await reset();

    const { data } = await admin
      .from('role_permissions')
      .select('allowed')
      .eq('role_id', 'sales')
      .eq('permission_type', 'nav')
      .eq('permission_key', 'dashboard')
      .single();
    expect(data!.allowed).toBe(true);
  });

  it('drops a custom role, exactly as the prototype setRoles(DEFAULT_ROLES) did', async () => {
    const { error } = await admin
      .from('roles')
      .insert({ id: 'qa-temp-role', name: 'บทบาททดสอบ', icon: 'fa-user' });
    assertNoError('insert custom role', error);

    await reset();

    const { data } = await admin.from('roles').select('id').eq('id', 'qa-temp-role');
    expect(data).toEqual([]);
  });

  it('moves a user off a dropped custom role onto admin rather than orphaning them', async () => {
    await admin.from('roles').insert({ id: 'qa-temp-role', name: 'บทบาททดสอบ', icon: 'fa-user' });

    // Re-point a seeded account at the custom role, then reset.
    const { data: user } = await admin
      .from('app_users')
      .select('id, role_id')
      .eq('email', 'tech@finnixfilm.com')
      .single();
    const originalRole = user!.role_id;
    await admin.from('app_users').update({ role_id: 'qa-temp-role' }).eq('id', user!.id);

    await reset();

    const { data: after } = await admin
      .from('app_users')
      .select('role_id')
      .eq('id', user!.id)
      .single();
    expect(after!.role_id).toBe('admin');

    // Put the seeded account back where it belongs.
    await admin.from('app_users').update({ role_id: originalRole }).eq('id', user!.id);
  });

  it('restores a renamed default role name and icon', async () => {
    await admin.from('roles').update({ name: 'เปลี่ยนชื่อแล้ว', icon: 'fa-bug' }).eq('id', 'sales');

    await reset();

    const { data } = await admin.from('roles').select('name, icon').eq('id', 'sales').single();
    expect(data).toEqual({ name: 'พนักงานขาย', icon: 'fa-user-tie' });
  });

  it('is idempotent — calling it twice leaves the same state', async () => {
    await reset();
    const once = await snapshotMatrix();
    await reset();
    expect(await snapshotMatrix()).toBe(once);
  });

  it('produces exactly the key set the UI knows about, with none missing', async () => {
    await reset();
    const { data } = await admin
      .from('role_permissions')
      .select('role_id, permission_type, permission_key');

    const rows = data as PermRow[];
    // 7 nav + 10 dashboard widgets/other + 15 module capabilities, for each role.
    for (const role of ['admin', 'exec', 'sales', 'tech']) {
      const forRole = rows.filter((r) => r.role_id === role);
      expect(forRole.filter((r) => r.permission_type === 'nav')).toHaveLength(7);
      expect(forRole.filter((r) => r.permission_type === 'dashboard_widget')).toHaveLength(10);
      expect(forRole.filter((r) => r.permission_type === 'module_capability')).toHaveLength(15);
    }
  });
});
