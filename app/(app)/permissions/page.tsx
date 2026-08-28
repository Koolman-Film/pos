import { notFound } from 'next/navigation';

import { PermissionsModule } from '@/components/permissions/PermissionsModule';
import type {
  PermMap,
  PermUser,
  Role,
  ShopInfoRow,
  ShopRow,
  StatusRow,
  WsStatusRow,
} from '@/components/permissions/permissionMeta';
import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

import {
  addRole,
  addStatus,
  addUser,
  addWsStatus,
  deleteRole,
  deleteStatus,
  deleteUser,
  deleteWsStatus,
  moveStatus,
  renameRole,
  renameWsStatus,
  resendInvite,
  resetPermissionsToDefaults,
  setDashboardPermission,
  setModulePermission,
  setNavPermission,
  setUserAllShops,
  toggleUserShop,
  updateShopInfo,
  saveShop,
  updateStatus,
  updateUser,
  updateWsStatusColor,
} from './actions';

/**
 * Permissions admin page — reads the config tables and renders the editor.
 *
 * Reachability: the sidebar only shows this link when `hasNav('permissions')`
 * (Task 12), and RLS (migration 0007) restricts these tables to permitted
 * roles. This page adds the third layer the prototype implies — a direct URL
 * visit by a role without the `permissions` nav is a 404, not a rendered (but
 * empty) screen. Every write additionally re-checks in `actions.ts` (C2).
 */
export default async function PermissionsPage() {
  const session = await getSessionContext();
  if (!session.hasNav('permissions')) notFound();

  const supabase = await createClient();

  const [
    { data: roleRows },
    { data: permRows },
    { data: statusRows },
    { data: wsStatusRows },
    { data: shopRows },
    { data: shopInfoRows },
    { data: userRows },
  ] = await Promise.all([
    supabase.from('roles').select('id, name, icon').order('id'),
    supabase.from('role_permissions').select('role_id, permission_type, permission_key, allowed'),
    supabase.from('statuses').select('key, short, bg, text_color, dot').order('sort_order'),
    supabase.from('ws_statuses').select('key, bg, text_color, dot').order('sort_order'),
    supabase.from('shops').select('id, name').order('sort_order'),
    supabase
      .from('shop_info')
      .select('shop_id, company_name, tax_id, address, phone, payment_channels'),
    supabase
      .from('app_users')
      .select('id, email, name, role_id, active, sees_all_shops, user_shop_access(shop_id)')
      .order('email'),
  ]);

  const roles: Role[] = (roleRows ?? []).map((r) => ({ id: r.id, name: r.name, icon: r.icon }));

  const navPermissions: PermMap = {};
  const dashboardPermissions: PermMap = {};
  const modulePermissions: PermMap = {};
  for (const p of permRows ?? []) {
    const bucket =
      p.permission_type === 'nav'
        ? navPermissions
        : p.permission_type === 'dashboard_widget'
          ? dashboardPermissions
          : modulePermissions;
    (bucket[p.role_id] ??= {})[p.permission_key] = p.allowed;
  }

  const statuses: StatusRow[] = (statusRows ?? []).map((s) => ({
    key: s.key,
    short: s.short,
    bg: s.bg,
    text: s.text_color,
    dot: s.dot,
  }));

  const wsStatuses: WsStatusRow[] = (wsStatusRows ?? []).map((s) => ({
    key: s.key,
    bg: s.bg,
    text: s.text_color,
    dot: s.dot,
  }));

  const shops: ShopRow[] = (shopRows ?? []).map((s) => ({ id: s.id, name: s.name }));

  const shopInfo: Record<string, ShopInfoRow> = {};
  for (const info of shopInfoRows ?? []) {
    shopInfo[info.shop_id] = {
      companyName: info.company_name,
      taxId: info.tax_id,
      address: info.address,
      phone: info.phone,
      paymentChannels: info.payment_channels ?? [],
    };
  }

  const users: PermUser[] = (userRows ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role_id,
    active: u.active,
    shopAccess: u.sees_all_shops ? 'all' : (u.user_shop_access ?? []).map((a) => a.shop_id),
  }));

  return (
    <PermissionsModule
      roles={roles}
      navPermissions={navPermissions}
      dashboardPermissions={dashboardPermissions}
      modulePermissions={modulePermissions}
      statuses={statuses}
      wsStatuses={wsStatuses}
      shops={shops}
      shopInfo={shopInfo}
      users={users}
      currentUserId={session.userId}
      onToggle={setModulePermission}
      onToggleNav={setNavPermission}
      onToggleDash={setDashboardPermission}
      onAddRole={addRole}
      onRenameRole={renameRole}
      onDeleteRole={deleteRole}
      onResetDefaults={resetPermissionsToDefaults}
      onAddStatus={addStatus}
      onUpdateStatus={updateStatus}
      onDeleteStatus={deleteStatus}
      onMoveStatus={moveStatus}
      onAddWsStatus={addWsStatus}
      onUpdateWsStatusColor={updateWsStatusColor}
      onRenameWsStatus={renameWsStatus}
      onDeleteWsStatus={deleteWsStatus}
      onUpdateShopInfo={updateShopInfo}
      onSaveShop={saveShop}
      onUpdateUser={updateUser}
      onSetUserAllShops={setUserAllShops}
      onToggleUserShop={toggleUserShop}
      onDeleteUser={deleteUser}
      onAddUser={addUser}
      onResendInvite={resendInvite}
    />
  );
}
