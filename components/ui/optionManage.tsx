'use client';

import { createContext, useContext } from 'react';

/**
 * May the current user add or remove entries in the admin-managed option lists?
 *
 * The `Managed*` pickers (dropdown, chip, multi-chip) are scattered through the
 * ticket form, the wholesale PO, สต็อก and บัญชี, several levels below the page
 * that knows the caller's capabilities. Threading a boolean through every
 * intermediate section would touch a dozen components that have no other reason
 * to know about permissions, so the answer travels by context instead.
 *
 * The default is `true` — the pickers keep their standalone behaviour when
 * rendered without a provider (their own unit tests do exactly that). Every real
 * module wraps its subtree in `OptionManageProvider`, and the actual boundary is
 * server-side anyway: `updateOptionList` re-checks `options.manage` before it
 * writes, so hiding the controls is a courtesy, not the gate.
 */
const OptionManageContext = createContext(true);

export function OptionManageProvider({
  canManage,
  children,
}: {
  canManage: boolean;
  children: React.ReactNode;
}) {
  return (
    <OptionManageContext.Provider value={canManage}>{children}</OptionManageContext.Provider>
  );
}

export function useCanManageOptions(): boolean {
  return useContext(OptionManageContext);
}
