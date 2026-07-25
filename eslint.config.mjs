import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Last: turns off the stylistic rules Prettier owns, so the two never disagree.
  // Prettier handles formatting; ESLint handles correctness.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // The reference prototype is a verbatim artifact, not source we maintain.
    'reference/**',
    // Generated from the database schema.
    'lib/types/database.ts',
    // Playwright output.
    'playwright-report/**',
    'test-results/**',
  ]),
]);

export default eslintConfig;
