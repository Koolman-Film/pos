'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useMobileNav } from './MobileNavContext';
import { resolveActiveNavId, type NavItem } from './navItems';

declare global {
  interface Window {
    /**
     * Set by module forms (the prototype's `useUnsavedChangesWarning`) while a
     * form has unsaved edits. Read here so leaving via the sidebar prompts the
     * same way leaving via the browser does.
     */
    __hasUnsavedFormChanges?: boolean;
  }
}

/** Port of the prototype's `confirmDiscardIfDirty` (finnix-film.html:383-386). */
function confirmDiscardIfDirty(): boolean {
  if (typeof window === 'undefined' || !window.__hasUnsavedFormChanges) return true;
  return window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?');
}

/**
 * The interactive half of the sidebar (see `Sidebar.tsx` for the permission
 * gate). Rendering markup is a straight port of
 * reference/v0.4/finnix-film.html:402-452, with two adaptations:
 *
 *   - each `<button onClick={() => setView(item.id)}>` becomes a `<Link href>`,
 *     and `view === item.id` becomes a pathname match, because navigation is
 *     now real URLs rather than a `view` state variable;
 *   - `items` arrives already filtered by permission, so the prototype's
 *     "disabled + padlock" branch has no counterpart here.
 */
export function SidebarNav({
  items,
  activePath,
}: {
  items: readonly NavItem[];
  /** Overrides `usePathname()`. Test seam; the app never passes it. */
  activePath?: string;
}) {
  const pathname = usePathname();
  const activeId = resolveActiveNavId(items, activePath ?? pathname ?? '');
  const { open, setOpen } = useMobileNav();

  return (
    <>
      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 bg-black/40 z-40 md:hidden" />
      )}
      <aside
        className={`fixed md:sticky top-0 h-screen w-64 flex-shrink-0 flex flex-col z-50 transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
        style={{ background: 'var(--sidebar)' }}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <div
            className="icon-tile"
            style={{ background: 'var(--primary)', boxShadow: 'var(--shadow-red)' }}
          >
            <i className="fa-solid fa-car text-white text-base" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">
              Finnix Film &amp; Central Audio
            </p>
            <p className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,.45)' }}>
              ระบบบริหารจัดการร้าน
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="ปิดเมนู"
            className="ml-auto md:hidden text-white/60"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 flex flex-col gap-1">
          {items.map((item) => {
            const isActive = item.id === activeId;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                onClick={(e) => {
                  if (!confirmDiscardIfDirty()) {
                    e.preventDefault();
                    return;
                  }
                  setOpen(false);
                }}
                className={`nav-item w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-left ${
                  isActive ? 'font-semibold' : 'font-medium'
                }`}
                style={{
                  background: isActive ? 'rgba(255,255,255,.08)' : 'transparent',
                  color: isActive ? '#fff' : 'rgba(255,255,255,.72)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.05)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <i
                  className={`fa-solid ${item.icon} w-4 text-center`}
                  style={{ color: isActive ? 'var(--primary-soft)' : 'inherit' }}
                />
                <span className="flex-1">{item.label}</span>
                {isActive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: 'var(--primary-soft)' }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div
          className="px-5 py-4 text-xs"
          style={{ color: 'rgba(255,255,255,.35)', borderTop: '1px solid rgba(255,255,255,.08)' }}
        >
          Prototype v0.4 &middot; FINNIX FILM
        </div>
      </aside>
    </>
  );
}
