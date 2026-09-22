import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // Playwright specs under tests/e2e are driven by the Playwright runner
    // (Task 21), not Vitest. Without this exclude, Vitest globs them and dies
    // with "Playwright Test did not expect test() to be called here".
    // Agent worktrees under .claude/ are whole copies of the repo; their tests
    // run against their own code, not this checkout's.
    exclude: ['**/node_modules/**', '**/tests/e2e/**', '.claude/**'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
});
