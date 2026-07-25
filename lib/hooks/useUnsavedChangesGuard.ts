'use client';

import { useEffect } from 'react';

/**
 * The single dirty-form guard for the whole app — the port of the prototype's
 * `useUnsavedChangesGuard` / `confirmDiscardIfDirty`
 * (reference/v0.4/finnix-film.html:374-386).
 *
 * Consolidated here per correction C12. The Wave 4 module tracks each grew their
 * own local copy, and they had already diverged: the wholesale copy only wired
 * `beforeunload` and never set `window.__hasUnsavedFormChanges`, so leaving a
 * dirty PO through the sidebar skipped the confirm entirely. The prototype uses
 * one guard for both exits, so both exits must read the same flag.
 *
 * Two exits, two exports:
 *   - `beforeunload` (tab close / reload)      -> useUnsavedChangesGuard
 *   - in-app navigation (sidebar, back button) -> confirmDiscardIfPendingChanges
 */
declare global {
  interface Window {
    /**
     * Set by `useUnsavedChangesGuard` while a form is dirty, so an in-app nav
     * guard anywhere in the tree can ask "is anything unsaved?" without the
     * dirty component having to publish state upward. Same mechanism the
     * prototype used.
     */
    __hasUnsavedFormChanges?: boolean;
  }
}

const DEFAULT_WARNING = 'มีข้อมูลที่ยังไม่ได้บันทึก';
const DEFAULT_CONFIRM = 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?';

/**
 * Warn on tab close/reload while `isDirty`, and publish that dirtiness on
 * `window.__hasUnsavedFormChanges` for in-app nav guards.
 */
export function useUnsavedChangesGuard(isDirty: boolean, message: string = DEFAULT_WARNING) {
  useEffect(() => {
    window.__hasUnsavedFormChanges = isDirty;
    const clearFlag = () => {
      window.__hasUnsavedFormChanges = false;
    };
    if (!isDirty) return clearFlag;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message || DEFAULT_WARNING;
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      clearFlag();
    };
  }, [isDirty, message]);
}

/**
 * Ask before discarding, when the caller already knows it is dirty.
 * Returns true when it is safe to proceed.
 */
export function confirmDiscardIfDirty(
  isDirty: boolean,
  message: string = DEFAULT_CONFIRM,
): boolean {
  if (!isDirty) return true;
  return window.confirm(message || DEFAULT_CONFIRM);
}

/**
 * Ask before discarding, when the caller does *not* know who is dirty — the
 * in-app nav case. Reads the flag published by `useUnsavedChangesGuard`.
 */
export function confirmDiscardIfPendingChanges(message: string = DEFAULT_CONFIRM): boolean {
  if (typeof window === 'undefined') return true;
  return confirmDiscardIfDirty(Boolean(window.__hasUnsavedFormChanges), message);
}
