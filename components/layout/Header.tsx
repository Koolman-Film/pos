'use client';

import { useState } from 'react';

import { logout } from '@/app/login/actions';

import { useMobileNav } from './MobileNavContext';
import { ThemeToggle } from './ThemeToggle';

/**
 * Role display names and icons, ported from the prototype's `DEFAULT_ROLES`
 * (reference/v0.4/finnix-film.html:154-159).
 *
 * `SessionContext` carries only `roleId`, so the header resolves the label
 * locally. Roles are editable data (the `roles` table, Task 19), so anything
 * not in this map falls back to showing the raw id with a neutral icon rather
 * than rendering blank.
 */
const ROLE_META: Record<string, { name: string; icon: string }> = {
  admin: { name: 'แอดมิน/หลังบ้าน', icon: 'fa-gear' },
  exec: { name: 'ผู้บริหาร', icon: 'fa-crown' },
  sales: { name: 'พนักงานขาย', icon: 'fa-user-tie' },
  tech: { name: 'หัวหน้าช่าง', icon: 'fa-screwdriver-wrench' },
};

/**
 * Port of the prototype's `Header` (reference/v0.4/finnix-film.html:453-498).
 *
 * Adaptations: `roles`/`currentUser` become plain `roleId`/`name`/`email` props
 * off `getSessionContext()`, the `theme`/`setTheme` pair becomes `ThemeToggle`
 * (which owns its own persistence), and `onLogout` becomes the `logout()`
 * Server Action submitted through a `<form>` so sign-out is a POST and the
 * cookie is cleared server-side.
 *
 * The search field is carried over exactly as the prototype had it: decorative,
 * not wired to anything.
 */
export function Header({ name, roleId, email }: { name: string; roleId: string; email?: string }) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { setOpen } = useMobileNav();
  const role = ROLE_META[roleId] ?? { name: roleId, icon: 'fa-user' };

  return (
    <div
      className="sticky top-0 z-30"
      style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}
    >
      <div className="px-4 sm:px-6 py-3.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="เปิดเมนู"
          className="md:hidden icon-tile"
          style={{ background: 'var(--paper)' }}
        >
          <i className="fa-solid fa-bars" />
        </button>

        <div className="relative flex-1 max-w-xs hidden sm:block">
          <i
            className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-xs"
            style={{ color: 'var(--ink-faint)' }}
          />
          <input placeholder="ค้นหาที่นี่..." className="field w-full text-sm pl-9 pr-3.5 py-2" />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <ThemeToggle />

          <button
            type="button"
            className="icon-tile relative"
            style={{ background: 'var(--paper)' }}
          >
            <i className="fa-regular fa-bell text-sm" style={{ color: 'var(--ink-soft)' }} />
            <span
              className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--primary)' }}
            />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              aria-expanded={showUserMenu}
              className="field text-sm pl-9 pr-3 py-2 flex items-center gap-2 font-medium"
              style={{ position: 'relative' }}
            >
              <i
                className={`fa-solid ${role.icon} absolute left-3 top-1/2 -translate-y-1/2 text-xs`}
                style={{ color: 'var(--primary)' }}
              />
              <span className="hidden sm:inline">{name}</span>
              <i
                className="fa-solid fa-chevron-down text-xs"
                style={{ color: 'var(--ink-faint)' }}
              />
            </button>

            {showUserMenu && (
              <div
                className="absolute right-0 mt-1.5 rounded-xl overflow-hidden z-40"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  boxShadow: 'var(--shadow-md)',
                  width: 200,
                }}
              >
                <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
                  <p className="text-sm font-semibold truncate">{name}</p>
                  {email && (
                    <p className="text-xs truncate" style={{ color: 'var(--ink-soft)' }}>
                      {email}
                    </p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: 'var(--primary)' }}>
                    {role.name}
                  </p>
                </div>
                <form action={logout}>
                  <button
                    type="submit"
                    className="w-full text-left px-3.5 py-2.5 text-xs font-medium flex items-center gap-2"
                    style={{ color: '#B23A48' }}
                  >
                    <i className="fa-solid fa-right-from-bracket" />
                    ออกจากระบบ
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
