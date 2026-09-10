import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Stack tests boot real containers against real images. They are slow
 * (minutes, and multiple GB on a cold image cache) and are deliberately kept
 * out of `pnpm test` so the per-PR check stays fast and image-free.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.stack.test.ts'],
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
    // One stack at a time: a run tests one target, and two stacks would
    // contend for memory and for the developer's machine.
    fileParallelism: false,
    environment: 'node',
  },
});
