import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/*
  The shop's clock, not the machine's. Staff devices run in Asia/Bangkok and
  client code reads the device zone for "today"; CI runners are UTC, so from
  00:00 to 07:00 Bangkok the two disagree and date tests failed every morning.
  Set on the process before workers start so every test file inherits it
  (tests/unit/timezone.test.ts fails if this is ever lost).
*/
process.env.TZ = 'Asia/Bangkok';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    env: { TZ: 'Asia/Bangkok' },
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
