import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // *.stack.test.ts boots real containers and takes minutes. Excluded from
    // the fast unit suite so `pnpm test` stays a per-PR check; run it with
    // `pnpm test:stack`.
    exclude: ['**/*.stack.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // lcov for the Sonar scan, text so a local run still says something.
      reporter: ['text', 'lcov'],
      // The stack suite is excluded from this run, so anything only it
      // exercises would otherwise read as dead uncovered code.
      exclude: [
        '**/*.test.ts',
        'tests/**',
        'scripts/**',
        // Generated from provider OpenAPI specs; the next generate
        // overwrites anything written here.
        'src/clients/generated/**',
        '**/*.config.ts',
      ],
    },
  },
});
