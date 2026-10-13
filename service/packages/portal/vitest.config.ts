import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'portal',
    include: ['test/**/*.test.ts', 'web/tests/*.test.mjs'],
    environment: 'node',
    fileParallelism: false,
  },
});
