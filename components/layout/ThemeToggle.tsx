'use client';

import { useSyncExternalStore } from 'react';

import { DEFAULT_THEME, applyTheme, readAppliedTheme } from './theme';

/**
 * `data-theme` on `<html>` is the store; watch it directly so the button stays
 * right no matter who wrote it — the boot script, this click, or another tab.
 */
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

/**
 * The prototype's light/dark switch — the same `icon-tile` button, the same
 * sun/moon swap and the same Thai tooltips as
 * reference/v0.4/finnix-film.html:467-469 (header) and :4300-4302 (login).
 *
 * `variant` covers the two placements the prototype uses:
 *   - `header`   — inline in the header's action row, on `--paper`.
 *   - `floating` — fixed top-right on the login screen, on `--surface` + border.
 *
 * Note on the icon: the theme itself is applied before first paint by
 * `THEME_INIT_SCRIPT`, so the page never flashes. The *icon* is a separate
 * problem — the server cannot know the stored preference, so rendering a sun on
 * the server and a moon on the client would be a hydration mismatch and React
 * would throw away the tree. `useSyncExternalStore`'s server snapshot renders
 * the light affordance during hydration and swaps to the real one immediately
 * after; the 14px glyph settles a frame late, which is invisible next to a
 * correctly painted page.
 */
export function ThemeToggle({ variant = 'header' }: { variant?: 'header' | 'floating' }) {
  const theme = useSyncExternalStore(subscribeToTheme, readAppliedTheme, () => DEFAULT_THEME);

  const isDark = theme === 'dark';
  const title = isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด';

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // Read the DOM rather than the rendered value: the attribute is the
      // single source of truth, and the subscription above pushes the change
      // back into React.
      onClick={() => applyTheme(readAppliedTheme() === 'dark' ? 'light' : 'dark')}
      className={variant === 'floating' ? 'icon-tile fixed top-4 right-4' : 'icon-tile'}
      style={
        variant === 'floating'
          ? { background: 'var(--surface)', border: '1px solid var(--line)' }
          : { background: 'var(--paper)' }
      }
    >
      <i
        className={`fa-solid ${isDark ? 'fa-sun' : 'fa-moon'} text-sm`}
        style={{ color: 'var(--ink-soft)' }}
      />
    </button>
  );
}
