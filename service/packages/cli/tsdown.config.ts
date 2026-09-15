import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/library.ts'],
  outDir: 'dist',
  format: 'esm',
  target: 'node24',
  platform: 'node',
  dts: false,
  clean: true,
  shims: false,
  fixedExtension: true,
  publint: true,
  deps: { alwaysBundle: ['@sfp/shared', '@sfp/ir'] },
  outputOptions: {
    banner: '#!/usr/bin/env node',
  },
});
