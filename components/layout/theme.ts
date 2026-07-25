/**
 * Theme bootstrapping — the piece the prototype kept in `App()` state
 * (reference/v0.4/finnix-film.html:4328-4332):
 *
 *   const [theme, setTheme] = useState(() => localStorage.getItem('finnix-theme') || 'light');
 *   useEffect(() => { document.documentElement.setAttribute('data-theme', theme); ... }, [theme]);
 *
 * `app/globals.css` styles dark mode off `html[data-theme="dark"]`, so *something*
 * has to write that attribute or the whole dark token block is dead CSS
 * (correction C9 in the execution schedule).
 *
 * A React effect cannot do it without a visible light-flash: the server has no
 * access to `localStorage`, so it emits the light default and the effect only
 * corrects it after hydration and first paint. The fix is the blocking inline
 * script below, run from `<head>` while the browser is still parsing HTML —
 * see node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md.
 */

export type Theme = 'light' | 'dark';

/** Same key the prototype persisted under, so an existing preference carries over. */
export const THEME_STORAGE_KEY = 'finnix-theme';

export const DEFAULT_THEME: Theme = 'light';

/**
 * Blocking `<head>` script. Runs synchronously during HTML parsing, before the
 * first paint, so there is no flash of the light theme for a dark-mode user.
 *
 * Falls back to the OS `prefers-color-scheme` when nothing is stored — the
 * prototype defaulted to light there, but it also had no server render to
 * flash from; honouring the OS preference on a first visit is what the toggle
 * would otherwise force the user to do by hand.
 *
 * Everything is inside `try/catch`: `localStorage` throws outright in some
 * privacy modes, and a throw here would abort parsing of the rest of `<head>`.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var t=window.localStorage.getItem(k);if(t!=="dark"&&t!=="light"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

/** The theme currently painted, read back off the attribute the script set. */
export function readAppliedTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : DEFAULT_THEME;
}

/** Paint `theme` and persist it. Mirrors the prototype's effect body. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode, blocked cookies): the theme still
    // applies for this page, it just will not survive a reload.
  }
}
