/**
 * Where to send a user after an email-link sign-in (`/auth/callback?next=`).
 *
 * `next` arrives in a URL anyone can craft, and it ends up in
 * `window.location.replace`. Passed through as-is, `?next=javascript:…` ran
 * attacker code on this origin for a signed-in user, and `?next=https://…`
 * made the POS a phishing redirect.
 *
 * Only a path on THIS site is followed. It is resolved the way the browser will
 * resolve it (the WHATWG URL parser strips tabs and newlines and reads `\` as
 * `/`), so tricks like `/\evil` or `/<TAB>/evil` land on the same host check as
 * a plain `//evil` instead of slipping past a string test. Anything else goes
 * to the dashboard — the app itself only ever sends `/auth/accept`.
 */
const FALLBACK = '/dashboard';
const PROBE_ORIGIN = 'https://pos.invalid';

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return FALLBACK;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== PROBE_ORIGIN) return FALLBACK;
  return `${url.pathname}${url.search}${url.hash}`;
}
