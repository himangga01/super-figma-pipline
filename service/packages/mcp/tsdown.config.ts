import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/daemon-entry.ts', 'src/portal-validation.ts'],
  outDir: 'dist',
  format: 'esm',
  target: 'node24',
  platform: 'node',
  dts: false,
  clean: true,
  shims: false,
  define: {
    __FIGWRIGHT_BUILD_ID__: JSON.stringify(process.env.SFP_BUILD_ID ?? String(Date.now())),
    __SFP_BUILD_HASH__: JSON.stringify(process.env.SFP_BUILD_HASH ?? ''),
  },
  fixedExtension: true,
  publint: true,
  deps: { alwaysBundle: ['@sfp/shared', '@sfp/ir'] },
  outputOptions: {
    banner: '#!/usr/bin/env node',
  },
});
