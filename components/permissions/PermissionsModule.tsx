'use client';

import { useState, useTransition } from 'react';

import type { ActionResult } from '@/app/(app)/permissions/actions';

import {
  DASHBOARD_WIDGETS,
  MODULE_CAPABILITIES,
  NAV_ITEMS,
  OTHER_CAPABILITIES,
  ROLE_ICON_CHOICES,
  toggleAriaLabel,
  type LabeledKey,
  type PermMap,
  type PermUser,
  type Role,
  type ShopInfoRow,
  type ShopRow,
  type StatusRow,
  type WsStatusRow,
} from './permissionMeta';

/**
 * Admin editor for config-as-data (design spec §7) — the UI half of Task 19,
 * ported from reference/v0.4/finnix-film.html:3903-4283 (`PermissionsModule`).
 *
 * In the prototype every section mutated in-memory React state via `setX`
 * callbacks. Here each mutation is a Server Action (see
 * `app/(app)/permissions/actions.ts`), passed in as an optional `on*` prop and
 * dispatched through a transition; the action re-checks auth + capability
 * (correction C2) and revalidates, so the server-rendered props refresh with
 * the new truth. Text fields persist on blur (not per keystroke); toggles and
 * buttons persist immediately.
 *
 * The `admin` role stays locked to full access exactly as in the prototype: its
 * matrix cells are disabled and always shown checked, and it cannot be deleted.
 */

type Maybe = void | Promise<ActionResult | void> | undefined;

export type PermissionsModuleProps = {
  roles: Role[];
  navPermissions?: PermMap;
  dashboardPermissions?: PermMap;
  modulePermissions?: PermMap;
  statuses?: StatusRow[];
  wsStatuses?: WsStatusRow[];
  shops?: ShopRow[];
  shopInfo?: Record<string, ShopInfoRow>;
  users?: PermUser[];
  currentUserId?: string;
  onToggle?: (roleId: string, key: string, allowed: boolean) => Maybe;
  onToggleNav?: (roleId: string, key: string, allowed: boolean) => Maybe;
  onToggleDash?: (roleId: string, key: string, allowed: boolean) => Maybe;
  onAddRole?: (name: string, icon: string) => Maybe;
  onRenameRole?: (id: string, name: string) => Maybe;
  onDeleteRole?: (id: string) => Maybe;
  /** "รีเซ็ตค่าเริ่มต้น" (prototype :4047). Omitted hides the button entirely. */
  onResetDefaults?: () => Maybe;
  onAddStatus?: (name: string, short: string, colorHex: string) => Maybe;
  onUpdateStatus?: (key: string, field: 'short' | 'color', value: string) => Maybe;
  onDeleteStatus?: (key: string) => Maybe;
  onMoveStatus?: (key: string, dir: -1 | 1) => Maybe;
  onAddWsStatus?: (name: string, colorHex: string) => Maybe;
  onUpdateWsStatusColor?: (key: string, colorHex: string) => Maybe;
  onRenameWsStatus?: (oldKey: string, newKey: string) => Maybe;
  onDeleteWsStatus?: (key: string) => Maybe;
  onUpdateShopInfo?: (shopId: string, patch: Partial<ShopInfoRow>) => Maybe;
  onUpdateUser?: (id: string, patch: { role?: string; active?: boolean }) => Maybe;
  onSetUserAllShops?: (id: string, all: boolean) => Maybe;
  onToggleUserShop?: (id: string, shopId: string) => Maybe;
  onDeleteUser?: (id: string) => Maybe;
};

function ToggleCell({
  checked,
  disabled,
  ariaLabel,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  ariaLabel: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className="w-6 h-6 rounded-lg inline-flex items-center justify-center"
      style={{
        background: checked ? 'var(--primary)' : 'var(--paper)',
        border: checked ? 'none' : '1px solid var(--line-strong)',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {checked && <i className="fa-solid fa-check text-xs" style={{ color: '#fff' }}></i>}
    </button>
  );
}

export function PermissionsModule({
  roles,
  navPermissions = {},
  dashboardPermissions = {},
  modulePermissions = {},
  statuses = [],
  wsStatuses = [],
  shops = [],
  shopInfo = {},
  users = [],
  currentUserId,
  onToggle,
  onToggleNav,
  onToggleDash,
  onAddRole,
  onRenameRole,
  onDeleteRole,
  onResetDefaults,
  onAddStatus,
  onUpdateStatus,
  onDeleteStatus,
  onMoveStatus,
  onAddWsStatus,
  onUpdateWsStatusColor,
  onRenameWsStatus,
  onDeleteWsStatus,
  onUpdateShopInfo,
  onUpdateUser,
  onSetUserAllShops,
  onToggleUserShop,
  onDeleteUser,
}: PermissionsModuleProps) {
  const [, startTransition] = useTransition();

  function run(result: Maybe) {
    startTransition(async () => {
      const res = await result;
      if (res && typeof res === 'object' && 'ok' in res && res.ok === false) {
        window.alert(res.error);
      }
    });
  }

  // ----- users -----
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState(roles[0]?.id || 'sales');
  function addUser() {
    const email = newUserEmail.trim();
    const name = newUserName.trim();
    if (!email || !name) {
      window.alert('กรุณากรอกอีเมลและชื่อผู้ใช้งาน');
      return;
    }
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      window.alert('มีอีเมลนี้ในระบบแล้ว');
      return;
    }
    // Creating a login requires provisioning a Supabase Auth account (service
    // role), which a capability-scoped Server Action cannot do; that path is
    // owned by the seed/invite flow. Existing users are fully editable below.
    window.alert('การเพิ่มผู้ใช้ใหม่ต้องสร้างบัญชีเข้าสู่ระบบผ่านผู้ดูแลระบบก่อน');
  }

  // ----- statuses -----
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusShort, setNewStatusShort] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#7A2333');
  function addStatus() {
    const key = newStatusName.trim();
    if (!key || statuses.some((s) => s.key === key)) return;
    run(onAddStatus?.(key, newStatusShort.trim() || key, newStatusColor));
    setNewStatusName('');
    setNewStatusShort('');
    setNewStatusColor('#7A2333');
  }
  function deleteStatus(key: string) {
    if (statuses.length <= 1) {
      window.alert('ต้องมีอย่างน้อย 1 สถานะเสมอ');
      return;
    }
    if (!window.confirm(`ลบสถานะ "${key}"? ใบงานที่ใช้สถานะนี้อยู่จะไม่ถูกเปลี่ยนอัตโนมัติ`))
      return;
    run(onDeleteStatus?.(key));
  }

  // ----- wholesale statuses -----
  const [newWsStatusName, setNewWsStatusName] = useState('');
  const [newWsStatusColor, setNewWsStatusColor] = useState('#7A2333');
  function addWsStatus() {
    const key = newWsStatusName.trim();
    if (!key || wsStatuses.some((s) => s.key === key)) return;
    run(onAddWsStatus?.(key, newWsStatusColor));
    setNewWsStatusName('');
    setNewWsStatusColor('#7A2333');
  }
  function deleteWsStatus(key: string) {
    if (wsStatuses.length <= 1) {
      window.alert('ต้องมีอย่างน้อย 1 สถานะเสมอ');
      return;
    }
    if (!window.confirm(`ลบสถานะ "${key}"? PO ที่ใช้สถานะนี้อยู่จะไม่ถูกเปลี่ยนอัตโนมัติ`)) return;
    run(onDeleteWsStatus?.(key));
  }

  // ----- payment channels (shop info) -----
  function addPaymentChannel(shopId: string) {
    const list = [...(shopInfo[shopId]?.paymentChannels || []), ''];
    run(onUpdateShopInfo?.(shopId, { paymentChannels: list }));
  }
  function updatePaymentChannel(shopId: string, idx: number, val: string) {
    const list = [...(shopInfo[shopId]?.paymentChannels || [])];
    list[idx] = val;
    run(onUpdateShopInfo?.(shopId, { paymentChannels: list }));
  }
  function removePaymentChannel(shopId: string, idx: number) {
    const list = (shopInfo[shopId]?.paymentChannels || []).filter((_, i) => i !== idx);
    run(onUpdateShopInfo?.(shopId, { paymentChannels: list }));
  }

  // ----- roles -----
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleIcon, setNewRoleIcon] = useState(ROLE_ICON_CHOICES[0]);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRoleName, setEditingRoleName] = useState('');
  function addRole() {
    const name = newRoleName.trim();
    if (!name) return;
    run(onAddRole?.(name, newRoleIcon));
    setNewRoleName('');
    setNewRoleIcon(ROLE_ICON_CHOICES[0]);
  }
  function startEditRole(r: Role) {
    setEditingRoleId(r.id);
    setEditingRoleName(r.name);
  }
  function saveEditRole() {
    if (editingRoleId) run(onRenameRole?.(editingRoleId, editingRoleName.trim() || editingRoleId));
    setEditingRoleId(null);
  }
  function deleteRole(id: string) {
    if (id === 'admin') {
      window.alert('ไม่สามารถลบบทบาทแอดมินได้ เพราะต้องมีผู้ดูแลระบบเสมอ');
      return;
    }
    if (!window.confirm('ยืนยันการลบบทบาทนี้? พนักงานที่ใช้บทบาทนี้อยู่จะต้องถูกกำหนดบทบาทใหม่'))
      return;
    run(onDeleteRole?.(id));
  }

  // ----- user shop access -----
  function deleteUser(id: string) {
    if (users.length <= 1) {
      window.alert('ต้องมีผู้ใช้งานอย่างน้อย 1 คนเสมอ');
      return;
    }
    if (!window.confirm('ยืนยันการลบผู้ใช้งานนี้?')) return;
    run(onDeleteUser?.(id));
  }

  const dashboardRows: LabeledKey[] = [...DASHBOARD_WIDGETS, ...OTHER_CAPABILITIES];

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">จัดการสิทธิ์การเข้าถึง</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
            เพิ่ม/ลบ/แก้ไขบทบาท และกำหนดสิทธิ์การเข้าถึงเมนู+การ์ดต่างๆ &middot; แก้ไขได้เฉพาะแอดมิน
          </p>
        </div>
        {onResetDefaults && (
          <button
            onClick={() => {
              // The prototype confirms first (:4034) — this drops custom roles.
              if (!window.confirm('รีเซ็ตบทบาทและสิทธิ์ทั้งหมดกลับเป็นค่าเริ่มต้น?')) return;
              run(onResetDefaults());
            }}
            className="btn-outline text-sm px-4 py-2 rounded-xl font-medium flex items-center gap-2"
          >
            <i className="fa-solid fa-rotate-left"></i>รีเซ็ตค่าเริ่มต้น
          </button>
        )}
      </div>

      {/* ---------- users ---------- */}
      <div className="card p-5 sm:p-6 mb-4">
        <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
          <i className="fa-solid fa-user-lock" style={{ color: 'var(--primary)' }}></i>
          จัดการผู้ใช้งาน
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--ink-soft)' }}>
          รายชื่ออีเมลที่อนุญาตให้เข้าสู่ระบบได้ พร้อมบทบาทที่กำหนดสิทธิ์การใช้งาน
          และสาขาที่แต่ละคนสามารถเห็นข้อมูลได้
        </p>
        <div className="flex flex-col gap-2 mb-4">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between gap-2 py-2 flex-wrap"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate flex items-center gap-2">
                  {u.name}
                  {u.id === currentUserId && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                    >
                      คุณ
                    </span>
                  )}
                  {!u.active && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: '#FBEAEC', color: '#B23A48' }}
                    >
                      ระงับใช้งาน
                    </span>
                  )}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--ink-soft)' }}>
                  {u.email}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                  <span className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                    <i className="fa-solid fa-store mr-1"></i>สิทธิ์สาขา:
                  </span>
                  <button
                    onClick={() => run(onSetUserAllShops?.(u.id, u.shopAccess !== 'all'))}
                    className="text-[10px] px-2 py-1 rounded-full font-semibold"
                    style={{
                      background: u.shopAccess === 'all' ? 'var(--primary)' : 'var(--paper)',
                      color: u.shopAccess === 'all' ? '#fff' : 'var(--ink-soft)',
                      border: u.shopAccess === 'all' ? 'none' : '1px solid var(--line-strong)',
                    }}
                  >
                    ทุกสาขา
                  </button>
                  {u.shopAccess !== 'all' &&
                    shops.map((s) => {
                      const active = (u.shopAccess as string[]).includes(s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => run(onToggleUserShop?.(u.id, s.id))}
                          className="text-[10px] px-2 py-1 rounded-full font-medium"
                          style={{
                            background: active ? 'var(--primary-soft)' : 'var(--paper)',
                            color: active ? 'var(--primary)' : 'var(--ink-faint)',
                            border: '1px solid ' + (active ? 'var(--primary)' : 'var(--line)'),
                          }}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <select
                  value={u.role}
                  aria-label="บทบาทของผู้ใช้"
                  onChange={(e) => run(onUpdateUser?.(u.id, { role: e.target.value }))}
                  className="field text-xs px-2.5 py-1.5"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => run(onUpdateUser?.(u.id, { active: !u.active }))}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                  title={u.active ? 'ระงับการใช้งาน' : 'เปิดใช้งาน'}
                  style={{
                    background: 'var(--paper)',
                    color: u.active ? '#4C7A3E' : 'var(--ink-soft)',
                  }}
                >
                  <i className={`fa-solid ${u.active ? 'fa-toggle-on' : 'fa-toggle-off'}`}></i>
                </button>
                <button
                  onClick={() => deleteUser(u.id)}
                  aria-label={`ลบผู้ใช้ ${u.name}`}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                  style={{ background: 'var(--paper)', color: '#B23A48' }}
                >
                  <i className="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            placeholder="อีเมล"
            className="field text-sm px-3 py-2 sm:col-span-2"
          />
          <input
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            placeholder="ชื่อผู้ใช้งาน"
            className="field text-sm px-3 py-2"
          />
          <select
            value={newUserRole}
            aria-label="บทบาทของผู้ใช้ใหม่"
            onChange={(e) => setNewUserRole(e.target.value)}
            className="field text-sm px-3 py-2"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={addUser}
          className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2 mt-2"
        >
          <i className="fa-solid fa-user-plus"></i>เพิ่มผู้ใช้งาน
        </button>
      </div>

      {/* ---------- roles ---------- */}
      <div className="card p-5 sm:p-6 mb-4">
        <p className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          <i className="fa-solid fa-users-gear" style={{ color: 'var(--primary)' }}></i>จัดการบทบาท
        </p>
        <div className="flex flex-col gap-2 mb-4">
          {roles.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 py-2"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              {editingRoleId === r.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    autoFocus
                    value={editingRoleName}
                    onChange={(e) => setEditingRoleName(e.target.value)}
                    className="field text-sm px-2.5 py-1.5 flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEditRole();
                      if (e.key === 'Escape') setEditingRoleId(null);
                    }}
                  />
                  <button
                    onClick={saveEditRole}
                    className="btn-primary text-xs px-3 py-1.5 rounded-lg font-semibold"
                  >
                    บันทึก
                  </button>
                  <button
                    onClick={() => setEditingRoleId(null)}
                    className="btn-outline text-xs px-3 py-1.5 rounded-lg"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2.5">
                    <div
                      className="icon-tile"
                      style={{ width: 30, height: 30, background: 'var(--paper)' }}
                    >
                      <i
                        className={`fa-solid ${r.icon} text-xs`}
                        style={{ color: 'var(--primary)' }}
                      ></i>
                    </div>
                    <span className="text-sm font-medium">{r.name}</span>
                    {r.id === 'admin' && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                      >
                        สิทธิ์เต็มเสมอ
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => startEditRole(r)}
                      aria-label={`แก้ไขบทบาท ${r.name}`}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                      style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}
                    >
                      <i className="fa-solid fa-pen"></i>
                    </button>
                    <button
                      onClick={() => deleteRole(r.id)}
                      aria-label={`ลบบทบาท ${r.name}`}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                      style={{ background: 'var(--paper)', color: '#B23A48' }}
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            value={newRoleIcon}
            aria-label="ไอคอนของบทบาทใหม่"
            onChange={(e) => setNewRoleIcon(e.target.value)}
            className="field text-sm px-3 py-2"
          >
            {ROLE_ICON_CHOICES.map((ic) => (
              <option key={ic} value={ic}>
                {ic.replace('fa-', '')}
              </option>
            ))}
          </select>
          <input
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="ชื่อบทบาทใหม่ เช่น ผู้จัดการสาขา"
            className="field text-sm px-3 py-2 flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRole();
            }}
          />
          <button
            onClick={addRole}
            className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>เพิ่มบทบาท
          </button>
        </div>
      </div>

      {/* ---------- ticket statuses ---------- */}
      <div className="card p-5 sm:p-6 mb-4">
        <p className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          <i className="fa-solid fa-flag" style={{ color: 'var(--primary)' }}></i>จัดการสถานะงาน
        </p>
        <div className="flex flex-col gap-2 mb-4">
          {statuses.map((s, idx) => (
            <div
              key={s.key}
              className="flex items-center gap-2 py-2"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <div className="flex flex-col flex-shrink-0">
                <button
                  onClick={() => run(onMoveStatus?.(s.key, -1))}
                  aria-label={`เลื่อนสถานะ ${s.key} ขึ้น`}
                  disabled={idx === 0}
                  className="w-6 h-5 flex items-center justify-center text-xs"
                  style={{
                    color: idx === 0 ? 'var(--ink-faint)' : 'var(--ink-soft)',
                    cursor: idx === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  <i className="fa-solid fa-caret-up"></i>
                </button>
                <button
                  onClick={() => run(onMoveStatus?.(s.key, 1))}
                  aria-label={`เลื่อนสถานะ ${s.key} ลง`}
                  disabled={idx === statuses.length - 1}
                  className="w-6 h-5 flex items-center justify-center text-xs"
                  style={{
                    color: idx === statuses.length - 1 ? 'var(--ink-faint)' : 'var(--ink-soft)',
                    cursor: idx === statuses.length - 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  <i className="fa-solid fa-caret-down"></i>
                </button>
              </div>
              <input
                type="color"
                value={s.dot}
                aria-label={`สีของสถานะ ${s.key}`}
                onChange={(e) => run(onUpdateStatus?.(s.key, 'color', e.target.value))}
                className="w-8 h-8 rounded-lg border-none cursor-pointer flex-shrink-0"
              />
              <span className="text-sm font-medium flex-shrink-0" style={{ minWidth: 160 }}>
                {s.key}
              </span>
              <input
                defaultValue={s.short}
                onBlur={(e) => run(onUpdateStatus?.(s.key, 'short', e.target.value))}
                placeholder="ชื่อย่อ (แสดงใน badge)"
                className="field text-xs px-2.5 py-1.5 flex-1"
              />
              <button
                onClick={() => deleteStatus(s.key)}
                aria-label={`ลบสถานะ ${s.key}`}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0"
                style={{ background: 'var(--paper)', color: '#B23A48' }}
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="color"
            value={newStatusColor}
            aria-label="สีของสถานะใหม่"
            onChange={(e) => setNewStatusColor(e.target.value)}
            className="w-9 h-9 rounded-lg border-none cursor-pointer flex-shrink-0"
          />
          <input
            value={newStatusName}
            onChange={(e) => setNewStatusName(e.target.value)}
            placeholder="ชื่อสถานะใหม่ (เต็ม)"
            className="field text-sm px-3 py-2 flex-1"
          />
          <input
            value={newStatusShort}
            onChange={(e) => setNewStatusShort(e.target.value)}
            placeholder="ชื่อย่อ"
            className="field text-sm px-3 py-2 flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addStatus();
            }}
          />
          <button
            onClick={addStatus}
            className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>เพิ่มสถานะ
          </button>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--ink-faint)' }}>
          <i className="fa-solid fa-circle-info mr-1"></i>สถานะที่ใช้อยู่ในใบงานเดิม
          จะไม่เปลี่ยนตามอัตโนมัติถ้าลบหรือเปลี่ยนชื่อสถานะที่ใช้อยู่ ต้องไปแก้ทีละใบงานเอง
        </p>
      </div>

      {/* ---------- wholesale statuses ---------- */}
      <div className="card p-5 sm:p-6 mb-4">
        <p className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          <i className="fa-solid fa-truck-ramp-box" style={{ color: 'var(--primary)' }}></i>
          จัดการสถานะขายส่ง (PO)
        </p>
        <div className="flex flex-col gap-2 mb-4">
          {wsStatuses.map((c) => (
            <div
              key={c.key}
              className="flex items-center gap-2 py-2"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <input
                type="color"
                value={c.dot}
                aria-label={`สีของสถานะขายส่ง ${c.key}`}
                onChange={(e) => run(onUpdateWsStatusColor?.(c.key, e.target.value))}
                className="w-8 h-8 rounded-lg border-none cursor-pointer flex-shrink-0"
              />
              <input
                defaultValue={c.key}
                aria-label={`ชื่อสถานะขายส่ง ${c.key}`}
                onBlur={(e) => run(onRenameWsStatus?.(c.key, e.target.value))}
                className="field text-sm px-2.5 py-1.5 flex-1"
              />
              <button
                onClick={() => deleteWsStatus(c.key)}
                aria-label={`ลบสถานะขายส่ง ${c.key}`}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0"
                style={{ background: 'var(--paper)', color: '#B23A48' }}
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="color"
            value={newWsStatusColor}
            aria-label="สีของสถานะขายส่งใหม่"
            onChange={(e) => setNewWsStatusColor(e.target.value)}
            className="w-9 h-9 rounded-lg border-none cursor-pointer flex-shrink-0"
          />
          <input
            value={newWsStatusName}
            onChange={(e) => setNewWsStatusName(e.target.value)}
            placeholder="ชื่อสถานะใหม่"
            className="field text-sm px-3 py-2 flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addWsStatus();
            }}
          />
          <button
            onClick={addWsStatus}
            className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>เพิ่มสถานะ
          </button>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--ink-faint)' }}>
          <i className="fa-solid fa-circle-info mr-1"></i>PO ที่ใช้อยู่ในสถานะเดิม
          จะไม่เปลี่ยนตามอัตโนมัติถ้าลบหรือเปลี่ยนชื่อสถานะที่ใช้อยู่
        </p>
      </div>

      {/* ---------- shop info ---------- */}
      <div className="card p-5 sm:p-6 mb-4">
        <p className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          <i className="fa-solid fa-location-dot" style={{ color: 'var(--primary)' }}></i>
          ข้อมูลนิติบุคคลของสาขา (สำหรับพิมพ์เอกสารการเงิน)
        </p>
        <div className="flex flex-col gap-3">
          {shops.map((s) => {
            const info = shopInfo[s.id];
            return (
              <div
                key={s.id}
                className="rounded-xl p-3"
                style={{ border: '1px solid var(--line)' }}
              >
                <p className="text-sm font-semibold mb-2">{s.name}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <input
                    defaultValue={info?.companyName || ''}
                    onBlur={(e) => run(onUpdateShopInfo?.(s.id, { companyName: e.target.value }))}
                    placeholder="ชื่อนิติบุคคล เช่น บริษัท ฟินนิกซ์ ฟิล์ม จำกัด"
                    className="field text-xs px-2.5 py-1.5"
                  />
                  <input
                    defaultValue={info?.taxId || ''}
                    onBlur={(e) => run(onUpdateShopInfo?.(s.id, { taxId: e.target.value }))}
                    placeholder="เลขผู้เสียภาษีร้าน 13 หลัก"
                    className="field text-xs px-2.5 py-1.5"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    defaultValue={info?.address || ''}
                    onBlur={(e) => run(onUpdateShopInfo?.(s.id, { address: e.target.value }))}
                    placeholder="ที่อยู่"
                    className="field text-xs px-2.5 py-1.5 sm:col-span-2"
                  />
                  <input
                    defaultValue={info?.phone || ''}
                    onBlur={(e) => run(onUpdateShopInfo?.(s.id, { phone: e.target.value }))}
                    placeholder="เบอร์โทร"
                    className="field text-xs px-2.5 py-1.5"
                  />
                </div>
                <div className="mt-2">
                  <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--ink-soft)' }}>
                    ช่องทางการชำระเงิน (แสดงในใบแจ้งหนี้)
                  </p>
                  <div className="flex flex-col gap-1.5 mb-1.5">
                    {(info?.paymentChannels || []).map((pc, idx) => (
                      <div key={idx} className="flex gap-2">
                        <input
                          defaultValue={pc}
                          onBlur={(e) => updatePaymentChannel(s.id, idx, e.target.value)}
                          placeholder="เช่น โอนเข้าบัญชี กสิกรไทย 123-4-56789-0"
                          className="field text-xs px-2.5 py-1.5 flex-1"
                        />
                        <button
                          onClick={() => removePaymentChannel(s.id, idx)}
                          aria-label="ลบช่องทางการชำระเงินนี้"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0"
                          style={{ background: 'var(--paper)', color: '#B23A48' }}
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => addPaymentChannel(s.id)}
                    className="btn-outline text-xs px-3 py-1.5 rounded-full"
                  >
                    <i className="fa-solid fa-plus mr-1"></i>เพิ่มช่องทางการชำระเงิน
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- nav (sidebar) permissions ---------- */}
      <div className="card p-5 sm:p-6 overflow-x-auto mb-4">
        <p className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          <i className="fa-solid fa-bars" style={{ color: 'var(--primary)' }}></i>สิทธิ์เข้าถึงเมนู
          (Sidebar)
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontSize: 12,
                  color: 'var(--ink-soft)',
                  fontWeight: 500,
                }}
              >
                เมนู
              </th>
              {roles.map((r) => (
                <th
                  key={r.id}
                  style={{
                    padding: '8px 12px',
                    fontSize: 12,
                    color: 'var(--ink-soft)',
                    fontWeight: 500,
                  }}
                >
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NAV_ITEMS.map((n) => (
              <tr key={n.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500 }}>{n.label}</td>
                {roles.map((r) => {
                  const checked = r.id === 'admin' || !!navPermissions[r.id]?.[n.id];
                  return (
                    <td key={r.id} style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <ToggleCell
                        checked={checked}
                        disabled={r.id === 'admin'}
                        ariaLabel={toggleAriaLabel(r.name, { key: n.id, label: n.label })}
                        onToggle={() => run(onToggleNav?.(r.id, n.id, !checked))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- dashboard widget / capability permissions ---------- */}
      <div className="card p-5 sm:p-6 overflow-x-auto">
        <p className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          <i className="fa-solid fa-gauge-high" style={{ color: 'var(--primary)' }}></i>
          สิทธิ์ในหน้าแดชบอร์ด
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontSize: 12,
                  color: 'var(--ink-soft)',
                  fontWeight: 500,
                }}
              >
                การ์ด / กราฟ / ความสามารถ
              </th>
              {roles.map((r) => (
                <th
                  key={r.id}
                  style={{
                    padding: '8px 12px',
                    fontSize: 12,
                    color: 'var(--ink-soft)',
                    fontWeight: 500,
                  }}
                >
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dashboardRows.map((w) => (
              <tr key={w.key} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500 }}>{w.label}</td>
                {roles.map((r) => {
                  const checked = r.id === 'admin' || !!dashboardPermissions[r.id]?.[w.key];
                  return (
                    <td key={r.id} style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <ToggleCell
                        checked={checked}
                        disabled={r.id === 'admin'}
                        ariaLabel={toggleAriaLabel(r.name, w)}
                        onToggle={() => run(onToggleDash?.(r.id, w.key, !checked))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs mt-4" style={{ color: 'var(--ink-faint)' }}>
          <i className="fa-solid fa-circle-info mr-1"></i>คอลัมน์ &quot;แอดมิน/หลังบ้าน&quot;
          ล็อกไว้ให้เห็นครบทุกอย่างเสมอ กันลืมปิดสิทธิ์ตัวเองจนเข้าระบบไม่ได้
          ส่วนบทบาทอื่นแก้ไขได้อิสระและมีผลทันที
        </p>
      </div>

      {/* ---------- module capability permissions ---------- */}
      <div className="card p-5 sm:p-6 overflow-x-auto mt-4">
        <p className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          <i className="fa-solid fa-sliders" style={{ color: 'var(--primary)' }}></i>
          สิทธิ์การใช้งานในแต่ละเมนู
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontSize: 12,
                  color: 'var(--ink-soft)',
                  fontWeight: 500,
                }}
              >
                การกระทำ
              </th>
              {roles.map((r) => (
                <th
                  key={r.id}
                  style={{
                    padding: '8px 12px',
                    fontSize: 12,
                    color: 'var(--ink-soft)',
                    fontWeight: 500,
                  }}
                >
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULE_CAPABILITIES.map((c) => (
              <tr key={c.key} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500 }}>{c.label}</td>
                {roles.map((r) => {
                  const checked = r.id === 'admin' || !!modulePermissions[r.id]?.[c.key];
                  return (
                    <td key={r.id} style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <ToggleCell
                        checked={checked}
                        disabled={r.id === 'admin'}
                        ariaLabel={toggleAriaLabel(r.name, c)}
                        onToggle={() => run(onToggle?.(r.id, c.key, !checked))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs mt-4" style={{ color: 'var(--ink-faint)' }}>
          <i className="fa-solid fa-circle-info mr-1"></i>ควบคุมปุ่ม/การกระทำเฉพาะจุดในแต่ละเมนู
          เช่น ปิดปุ่ม &quot;เพิ่มสินค้า&quot; สำหรับพนักงานขาย โดยที่ยังเข้าดูเมนูสต็อกได้ตามปกติ
        </p>
      </div>
    </div>
  );
}
