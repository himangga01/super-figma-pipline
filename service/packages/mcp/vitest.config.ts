import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mcp',
    include: ['test/**/*.{test,spec}.ts'],
    // Windows process E2E runs in the root config's later, sequential project.
    ...(process.platform === 'win32' ? { exclude: ['test/e2e/**'] } : {}),
    environment: 'node',
  },
});
