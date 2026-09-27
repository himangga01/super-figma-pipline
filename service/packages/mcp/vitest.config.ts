import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mcp',
    include: ['test/**/*.{test,spec}.ts'],
    // Windows process E2E runs in the root config's later, sequential project. Portal and
    // state-permission tests start real ACL/lease helper processes; on Windows several take
    // 4-5 s alone, so the 5 s default flakes under load. Revisit after T11 cuts helper cost.
    ...(process.platform === 'win32' ? { exclude: ['test/e2e/**'], testTimeout: 20_000 } : {}),
    environment: 'node',
  },
});
