'use client';

import { useSyncExternalStore } from 'react';

/**
 * True once the component has hydrated on the client, false during SSR.
 *
 * Four modules (tickets list, ticket print sheet, stock, wholesale detail) need
 * this to gate a `createPortal(..., document.body)` — the print area is portaled
 * out of the `.app-shell` subtree so Task 1's `@media print` rules can hide the
 * shell and show only `.print-area`. `document` does not exist during SSR, so
 * the portal cannot be created on the server.
 *
 * Each of those modules had grown the same `useState(false)` +
 * `useEffect(() => setMounted(true), [])` pair, which React 19's
 * `react-hooks/set-state-in-effect` rule rejects: setting state synchronously in
 * an effect schedules a second render pass immediately after the first, and the
 * rule exists because that pattern cascades badly once it appears in trees.
 *
 * `useSyncExternalStore` expresses the same thing as a read rather than a write:
 * the server snapshot is `false`, the client snapshot is `true`, and React
 * reconciles the difference itself during hydration. The store never actually
 * changes, so `subscribe` has nothing to listen to and returns a no-op
 * unsubscribe.
 */
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useIsMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
