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
    // Without a reporter, reports/ stays empty and the artifact upload has
    // nothing to carry -- a red run would upload silently nothing, which is
    // the exact failure the workflow's always() upload exists to prevent.
    // summary.json and the richer tiers are still to be wired (#14); this
    // is the floor, not the finished article.
    reporters: ['default', ['junit', { outputFile: 'reports/junit.xml' }]],
  },
});
