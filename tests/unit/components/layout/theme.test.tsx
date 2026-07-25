import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ThemeToggle } from '@/components/layout/ThemeToggle';
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  readAppliedTheme,
} from '@/components/layout/theme';

/** Run the blocking `<head>` script the way the browser would. */
const runInitScript = () => new Function(THEME_INIT_SCRIPT)();

/** `matchMedia` exists in jsdom but never matches, so the OS preference is stubbed. */
function stubPrefersDark(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: prefersDark && query.includes('dark'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

// `data-theme` and `localStorage` live on the jsdom document/window for the
// whole file, so both are reset between cases. Without this the suite passes
// once and then fails on a second run against the same environment.
beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});

describe('THEME_INIT_SCRIPT', () => {
  it('applies the stored preference to <html> before anything renders', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runInitScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back to the OS preference when nothing is stored', () => {
    stubPrefersDark(true);
    runInitScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    document.documentElement.removeAttribute('data-theme');
    stubPrefersDark(false);
    runInitScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('ignores a junk stored value rather than writing it to the attribute', () => {
    // The attribute drives which CSS token block wins; an unrecognised value
    // would match neither `:root` overrides nor `html[data-theme="dark"]`.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    stubPrefersDark(false);
    runInitScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('swallows a localStorage that throws instead of aborting head parsing', () => {
    // Some privacy modes make even reading storage throw. A throw here would
    // abort parsing of the rest of <head>, so the script has to absorb it.
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => runInitScript()).not.toThrow();
    getItem.mockRestore();
  });

  it('never emits a literal </script> that would close its own tag', () => {
    expect(THEME_INIT_SCRIPT).not.toMatch(/<\/script/i);
  });
});

describe('applyTheme / readAppliedTheme', () => {
  it('writes the attribute and persists the choice', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readAppliedTheme()).toBe('dark');
  });

  it('treats a missing attribute as light', () => {
    expect(readAppliedTheme()).toBe('light');
  });
});

describe('ThemeToggle', () => {
  it('offers the dark mode switch while the light theme is applied', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'สลับเป็นโหมดมืด' })).toBeInTheDocument();
  });

  it('switches the theme, persists it, and flips the affordance', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'สลับเป็นโหมดมืด' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    const back = screen.getByRole('button', { name: 'สลับเป็นโหมดสว่าง' });
    await user.click(back);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('picks up a theme the init script applied before it mounted', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runInitScript();

    render(<ThemeToggle />);

    expect(screen.getByRole('button', { name: 'สลับเป็นโหมดสว่าง' })).toBeInTheDocument();
  });
});
