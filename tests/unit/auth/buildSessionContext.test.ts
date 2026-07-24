import { describe, it, expect } from 'vitest';

import { buildSessionContext } from '@/lib/auth/buildSessionContext';

const allShops = ['cm', 'lp', 'py', 'lpg', 'ca'];

const perms = [
  { permission_type: 'nav', permission_key: 'stock', allowed: true },
  { permission_type: 'nav', permission_key: 'permissions', allowed: false },
  { permission_type: 'module_capability', permission_key: 'list.createNew', allowed: true },
  { permission_type: 'module_capability', permission_key: 'stock.editDelete', allowed: false },
  { permission_type: 'dashboard_widget', permission_key: 'stockSummary', allowed: true },
  { permission_type: 'dashboard_widget', permission_key: 'revenue', allowed: false },
];

const salesProfile = {
  name: 'Sales User',
  role_id: 'sales',
  sees_all_shops: false,
  shop_access: ['cm'],
};

describe('buildSessionContext', () => {
  it('restricts a shop-scoped sales user to only their assigned shop', () => {
    const ctx = buildSessionContext('u1', 'sales@test.local', salesProfile, allShops, perms);
    expect(ctx.seesAllShops).toBe(false);
    expect(ctx.accessibleShopIds).toEqual(['cm']);
  });

  it('grants an admin all shops and all capabilities regardless of role_permissions rows', () => {
    const ctx = buildSessionContext(
      'u2',
      'admin@test.local',
      { name: 'Admin', role_id: 'admin', sees_all_shops: false, shop_access: [] },
      allShops,
      []
    );
    expect(ctx.seesAllShops).toBe(true);
    expect(ctx.accessibleShopIds).toEqual(allShops);
    expect(ctx.canDo('stock.editDelete')).toBe(true);
    expect(ctx.hasNav('permissions')).toBe(true);
    expect(ctx.hasDashboardWidget('revenue')).toBe(true);
  });

  it('grants a non-admin with sees_all_shops every shop even with no access rows', () => {
    const ctx = buildSessionContext(
      'u3',
      'exec@test.local',
      { name: 'Exec', role_id: 'exec', sees_all_shops: true, shop_access: [] },
      allShops,
      perms
    );
    expect(ctx.seesAllShops).toBe(true);
    expect(ctx.accessibleShopIds).toEqual(allShops);
    // ...but is still bound by role_permissions, unlike admin.
    expect(ctx.canDo('stock.editDelete')).toBe(false);
  });

  it('resolves nav/module capability lookups per-role from the permission rows', () => {
    const ctx = buildSessionContext('u1', 'sales@test.local', salesProfile, allShops, perms);
    expect(ctx.hasNav('stock')).toBe(true);
    expect(ctx.hasNav('permissions')).toBe(false);
    expect(ctx.canDo('list.createNew')).toBe(true);
    expect(ctx.canDo('stock.editDelete')).toBe(false);
    expect(ctx.canDo('some.unlisted.key')).toBe(false); // absent row defaults to false, not true
    expect(ctx.hasNav('some.unlisted.key')).toBe(false);
    expect(ctx.hasDashboardWidget('some.unlisted.key')).toBe(false);
  });

  it('resolves dashboard widgets independently of nav and capability keys', () => {
    const ctx = buildSessionContext('u1', 'sales@test.local', salesProfile, allShops, perms);
    expect(ctx.hasDashboardWidget('stockSummary')).toBe(true);
    expect(ctx.hasDashboardWidget('revenue')).toBe(false);
  });

  it('does not let a permission of one type satisfy a lookup of another type', () => {
    const ctx = buildSessionContext('u1', 'sales@test.local', salesProfile, allShops, [
      { permission_type: 'nav', permission_key: 'stock', allowed: true },
    ]);
    expect(ctx.hasNav('stock')).toBe(true);
    expect(ctx.canDo('stock')).toBe(false);
    expect(ctx.hasDashboardWidget('stock')).toBe(false);
  });

  it('returns accessible shops in canonical shop order and drops unknown shop ids', () => {
    const ctx = buildSessionContext(
      'u4',
      'multi@test.local',
      {
        name: 'Multi Shop',
        role_id: 'sales',
        sees_all_shops: false,
        shop_access: ['ca', 'lp', 'deleted-shop'],
      },
      allShops,
      perms
    );
    expect(ctx.accessibleShopIds).toEqual(['lp', 'ca']);
  });

  it('carries identity fields through unchanged', () => {
    const ctx = buildSessionContext('u1', 'sales@test.local', salesProfile, allShops, perms);
    expect(ctx.userId).toBe('u1');
    expect(ctx.email).toBe('sales@test.local');
    expect(ctx.name).toBe('Sales User');
    expect(ctx.roleId).toBe('sales');
  });
});
