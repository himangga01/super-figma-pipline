import { join } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Windows integration fixtures start real ACL/lease helper processes. CPU-count parallelism
    // can exhaust their deadlines even though each fixture passes in isolation.
    ...(process.platform === 'win32' ? { maxWorkers: 4 } : {}),
    projects: [
      'packages/*/vitest.config.ts',
      {
        test: {
          name: 'root',
          root: import.meta.dirname,
          include: ['test/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      ...(process.platform === 'win32'
        ? [
            {
              test: {
                name: 'mcp-e2e',
                root: join(import.meta.dirname, 'packages/mcp'),
                include: ['test/e2e/**/*.{test,spec}.ts'],
                environment: 'node',
                fileParallelism: false,
                sequence: { groupOrder: 1 },
              },
            },
          ]
        : []),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts', 'packages/*/ui/**/*.ts', 'packages/*/ui/**/*.vue'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
