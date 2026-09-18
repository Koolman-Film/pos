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
 * The default is `false` (ร้านขอ 18 ก.ย. 2569). Every module that renders these
 * pickers wraps its subtree in `OptionManageProvider`, so the default is only
 * ever reached by a picker somebody forgot to wrap — and the answer to "may this
 * person extend a shop-wide list?" must not be yes by omission. The shop asked
 * for the add control to be admin-only precisely to stop lists filling up with
 * duplicates and typos.
 *
 * The actual boundary is server-side either way: `updateOptionList` re-checks
 * `options.manage` before it writes, so hiding the control is a courtesy.
 */
const OptionManageContext = createContext(false);

export function OptionManageProvider({
  canManage,
  children,
}: {
  canManage: boolean;
  children: React.ReactNode;
}) {
  return <OptionManageContext.Provider value={canManage}>{children}</OptionManageContext.Provider>;
}

export function useCanManageOptions(): boolean {
  return useContext(OptionManageContext);
}
