import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Journeys boot a stack and must never run under the unit suite.
    exclude: ['journeys/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
