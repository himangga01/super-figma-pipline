import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ir',
    include: ['test/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
