import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  define: { __APP_VERSION__: JSON.stringify('0.1.0-test') },
  test: {
    name: 'plugin',
    include: ['test/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
