/// <reference types="node" />
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

const execute = promisify(execFile);
const source = new URL('../src/', import.meta.url).href;

it.each(['portal-recipes', 'portal-core-lifecycle', 'portal', 'index'])(
  'initializes portal schemas in a clean Node process when %s is imported first',
  async first => {
    // Resolve only this package's emitted .js specifiers back to its TS source. Node performs
    // native type stripping; the process has no Vitest transform cache or earlier schema imports.
    const script = `
      import assert from 'node:assert/strict';
      import { existsSync } from 'node:fs';
      import { registerHooks } from 'node:module';
      import { fileURLToPath } from 'node:url';
      const source = ${JSON.stringify(source)};
      registerHooks({ resolve(specifier, context, next) {
        if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith(source)) {
          const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
          if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
        }
        return next(specifier, context);
      }});
      await import(new URL(${JSON.stringify(first + '.ts')}, source));
      const portal = await import(new URL('portal.ts', source));
      const recipes = await import(new URL('portal-recipes.ts', source));
      const lifecycle = await import(new URL('portal-core-lifecycle.ts', source));
      const publicApi = await import(new URL('index.ts', source));
      assert.equal(typeof lifecycle.PortalCoreDeclarationBatchSchema.safeParse, 'function');
      assert.equal(typeof recipes.PortalRecipeVerifiedConsumptionSchema.safeParse, 'function');
      assert.equal(publicApi.PortalPathSchema, portal.PortalPathSchema);
      assert.equal(publicApi.PortalLayerSchema, portal.PortalLayerSchema);
      assert.equal(publicApi.PortalCoreDeclarationBatchSchema, lifecycle.PortalCoreDeclarationBatchSchema);
      assert.equal(portal.PortalPathSchema.parse('src/routes/index.tsx'), 'src/routes/index.tsx');
      for (const path of ['../escape', 'C:/outside', 'src/CON.txt', 'src/back\\\\slash', '/absolute'])
        assert.equal(portal.PortalPathSchema.safeParse(path).success, false);
      assert.equal(portal.PortalLayerSchema.parse('frontend'), 'frontend');
      assert.equal(portal.PortalLayerSchema.safeParse('arbitrary-layer').success, false);
      assert.equal(portal.PortalSubmitArgsSchema.safeParse({}).success, false);
      process.stdout.write('portal-import-order-ok');
    `;
    const result = await execute(
      process.execPath,
      [
        '--experimental-transform-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '--eval',
        script,
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    expect(result.stdout).toBe('portal-import-order-ok');
    expect(result.stderr).toBe('');
  },
);
