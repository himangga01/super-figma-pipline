import { defineConfig } from 'tsdown';
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: 'esm',
  target: 'node24',
  platform: 'node',
  dts: false,
  clean: true,
  fixedExtension: true,
  deps: { alwaysBundle: ['@sfp/shared'], neverBundle: ['@sfp/cli'] },
  outputOptions: { banner: '#!/usr/bin/env node' },
});
