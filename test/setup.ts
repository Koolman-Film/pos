import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Restore `localStorage` under jsdom.
 *
 * jsdom provides a real `localStorage`, but Node ships its own global of the
 * same name that is `undefined` unless the process was started with
 * `--localstorage-file`, and it shadows jsdom's. The symptom is
 * `'localStorage' in window === true` while `window.localStorage === undefined`
 * — so feature-detecting code takes the browser path and then throws.
 *
 * Anything reading a persisted preference (the theme toggle, and any module
 * that remembers a filter) would otherwise be untestable. This is a per-run,
 * in-memory stand-in: it is not shared between test files, each of which gets a
 * fresh environment.
 */
function installMemoryStorage(target: typeof globalThis | Window) {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  };
  Object.defineProperty(target, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

if (typeof window !== 'undefined' && !window.localStorage) {
  installMemoryStorage(window);
  if ((globalThis as unknown) !== (window as unknown)) installMemoryStorage(globalThis);
}

afterEach(() => cleanup());
