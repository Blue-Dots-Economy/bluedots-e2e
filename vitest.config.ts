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
  },
});
