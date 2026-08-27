import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: 'esm',
  target: 'node24',
  platform: 'node',
  dts: false,
  clean: true,
  shims: false,
  fixedExtension: true,
  publint: true,
  deps: { alwaysBundle: ['@sfp/shared'] },
  outputOptions: {
    banner: '#!/usr/bin/env node',
  },
});
