'use client';

import { useEffect } from 'react';

// Ported unchanged from reference/v0.4/finnix-film.html:374-386. Still relevant
// with a real backend: navigating away before the save action completes should
// still warn. `window.__hasUnsavedFormChanges` is left in place so any global
// nav guard can read it, exactly as the prototype did.
declare global {
  interface Window {
    __hasUnsavedFormChanges?: boolean;
  }
}

export function useUnsavedChangesGuard(isDirty: boolean, message: string) {
  useEffect(() => {
    window.__hasUnsavedFormChanges = isDirty;
    if (!isDirty) return () => { window.__hasUnsavedFormChanges = false; };
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message || 'มีข้อมูลที่ยังไม่ได้บันทึก';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.__hasUnsavedFormChanges = false;
    };
  }, [isDirty, message]);
}

export function confirmDiscardIfDirty(isDirty: boolean, message: string): boolean {
  if (!isDirty) return true;
  return window.confirm(message || 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?');
}
