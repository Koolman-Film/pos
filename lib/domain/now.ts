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
  return dateInputValue(new Date()).slice(0, 7);
}

/** `YYYY-MM-DD` for today — the `rangeEnd` default. */
export function todayValue(): string {
  return dateInputValue(new Date());
}

/** `YYYY-MM-DD` for N days back — the `rangeStart` default (N = 6). */
export function daysAgoValue(n: number): string {
  return dateInputValue(new Date(Date.now() - n * 86400000));
}

/**
 * `YYYY-MM-DD` from the LOCAL calendar parts — the value an `<input type="date">`
 * expects, and the string a `date` column should be given.
 *
 * `toISOString()` is UTC. In Asia/Bangkok (UTC+7) that reports the previous day
 * for every local time before 07:00, so an expense dated 1 August rendered — and
 * saved — as 31 July. Same class of bug `DateTimeField` was already fixed for;
 * every date field now goes through here.
 */
export function dateInputValue(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Millisecond stamp used to keep exported spreadsheet filenames unique, e.g.
 * `stock-all-1753440000000.xlsx`. Same as the prototype's inline `Date.now()`.
 */
export function exportStamp(): number {
  return Date.now();
}
