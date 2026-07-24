'use client';

import { createContext, useContext, useMemo, useState } from 'react';

/**
 * The prototype held `mobileOpen` in `App()` and threaded it into both
 * `Sidebar` and `Header` (reference/v0.4/finnix-film.html:4406-4407): the
 * header's hamburger opens the drawer that the sidebar renders.
 *
 * In the port those two live on opposite sides of `app/(app)/layout.tsx`, which
 * is a Server Component and cannot hold state — so the shared bit of state
 * moves into this client-side context instead.
 *
 * The default value is a no-op rather than a thrown error on purpose: it lets
 * `Sidebar` / `Header` be rendered standalone (in tests, or a future storybook)
 * without a provider. Only the drawer stops working, nothing crashes.
 */
type MobileNavState = { open: boolean; setOpen: (open: boolean) => void };

const MobileNavContext = createContext<MobileNavState>({ open: false, setOpen: () => {} });

export function useMobileNav(): MobileNavState {
  return useContext(MobileNavContext);
}

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}
