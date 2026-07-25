// The app's clock reads, in one place.
//
// The period filters in every module default to "today" / "this month" / "the
// last 7 days", which the prototype expressed as inline `new Date()` calls in
// `useState(...)` initialisers (reference/v0.4/finnix-film.html:2517-2524 and the
// same block copy-pasted into each module). React 19's `react-hooks/purity` rule
// correctly rejects that: an eager initialiser constructs a Date on *every*
// render and discards it, and an impure read during render is unstable by
// definition.
//
// The defaults are unchanged — same strings, same 6-days-ago boundary. What
// changes is that the impure read happens in a plain module function that
// callers invoke from a lazy initialiser (`useState(() => todayValue())`) or
// from an event handler, not in a component body.

/** `YYYY-MM` for the current month — the `periodValue` default. */
export function currentMonthValue(): string {
  return new Date().toISOString().slice(0, 7);
}

/** `YYYY-MM-DD` for today — the `rangeEnd` default. */
export function todayValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` for N days back — the `rangeStart` default (N = 6). */
export function daysAgoValue(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/**
 * Millisecond stamp used to keep exported spreadsheet filenames unique, e.g.
 * `stock-all-1753440000000.xlsx`. Same as the prototype's inline `Date.now()`.
 */
export function exportStamp(): number {
  return Date.now();
}
