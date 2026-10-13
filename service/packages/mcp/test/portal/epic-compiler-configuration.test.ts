import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { promisify } from 'node:util';

import { storedChecksum } from '@sfp/ir';
import { expect, it } from 'vitest';

import { REACT_ROUTER_DEPENDENCY_BOOTSTRAP } from '../../src/portal/react-router-compiler-evidence.js';
import {
  assertReactRouterCompilerConfiguration,
  readReactRouterNpmLock,
} from '../../src/portal/react-router-compiler-evidence.js';
import { epicCompilerFixture } from './epic-compiler-fixture.js';
async function removeOwnedFixture(root: string, prefix: string) {
  const actual = await realpath(root),
    part = relative(await realpath(tmpdir()), actual);
  if (isAbsolute(part) || part.startsWith('..' + sep) || !part.startsWith(prefix))
    throw Error('OWNED_CLEANUP_CONTAINMENT_REQUIRED');
  await rm(actual, { recursive: true, force: true });
}
it('admits the inspected Epic callback/hooks without executing repository config and rejects changed hook bytes', () => {
  for (const p of ['vite.config.ts', 'react-router.config.ts'] as const) {
    expect(() => assertReactRouterCompilerConfiguration(p, epicCompilerFixture[p])).not.toThrow(
      /PORTAL_COMPILER_(?:CONFIGURATION|LOCK)_/u,
    );
    expect(() =>
      assertReactRouterCompilerConfiguration(
        p,
        epicCompilerFixture[p] + '\nvoid fetch("https://unreviewed.invalid");',
      ),
    ).toThrow(/PORTAL_COMPILER_(?:CONFIGURATION|LOCK)_/u);
  }
});
it('binds npm v3 standalone selected importer declarations and package integrity without installing', () => {
  const pkg = { dependencies: { vite: '^7.3.1' } };
  const lock = {
    lockfileVersion: 3,
    packages: { '': pkg, 'node_modules/vite': { version: '7.3.1', integrity: 'sha512-YWJjZA==' } },
  };
  expect(readReactRouterNpmLock(JSON.stringify(lock), pkg, ['vite']).get('vite')).toEqual({
    specifier: '^7.3.1',
    version: '7.3.1',
    integrity: 'sha512-YWJjZA==',
  });
  for (const change of [
    { ...lock, lockfileVersion: 2 },
    {
      ...lock,
      packages: {
        ...lock.packages,
        'node_modules/vite': { version: '7.3.1', link: true, integrity: 'sha512-YWJjZA==' },
      },
    },
    { ...lock, packages: { ...lock.packages, '../node_modules/foreign': { version: '1.0.0' } } },
  ])
    expect(() => readReactRouterNpmLock(JSON.stringify(change), pkg, ['vite'])).toThrow(
      /PORTAL_COMPILER_(?:CONFIGURATION|LOCK)_/u,
    );
  expect(() =>
    readReactRouterNpmLock(JSON.stringify(lock), { dependencies: { vite: '^8.0.0' } }, ['vite']),
  ).toThrow(/PORTAL_COMPILER_(?:CONFIGURATION|LOCK)_/u);
});

it('binds the inspected package and route-generation source with both config hashes', async () => {
  const { isReviewedEpicCompilerSource } =
    await import('../../src/portal/epic-compiler-configuration.js');
  const source = new Map<string, string>(Object.entries(epicCompilerFixture));
  expect(isReviewedEpicCompilerSource(source)).toBe(true);
  source.set('app/routes.ts', source.get('app/routes.ts')! + '\nexport const unreviewed=true;');
  expect(isReviewedEpicCompilerSource(source)).toBe(false);
});

it.each(['valid', 'changed-hash', 'foreign-name'])(
  'fresh icon provisioner preserves immutable inputs and removes only verified copied leaves %# %s',
  async kind => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-c2-icon-bootstrap-'));
    try {
      await mkdir(join(root, 'compiler-input/app/components/ui/icons'), { recursive: true });
      await mkdir(join(root, 'deps'));
      const bodies = ['<svg>owned source icon</svg>', 'export type IconName="owned";'];
      for (let i = 0; i < 2; i++)
        await writeFile(
          join(root, 'compiler-input/app/components/ui/icons', ['sprite.svg', 'types.ts'][i]!),
          bodies[i]!,
        );
      const icons = ['sprite.svg', 'types.ts'].map((name, i) => ({
        name,
        hash: storedChecksum(bodies[i]!),
      }));
      if (kind === 'changed-hash') icons[0]!.hash = storedChecksum('wrong-preimage');
      if (kind === 'foreign-name') icons[0]!.name = '../../foreign';
      // spawn-hygiene-exempt: execute the fixed service-owned provisioning bootstrap in an owned regular fixture, no application config or installer.
      const execute = () =>
        promisify(execFile)(
          process.execPath,
          [
            '-e',
            REACT_ROUTER_DEPENDENCY_BOOTSTRAP,
            JSON.stringify({ shared: join(root, 'deps'), local: join(root, 'deps'), icons }),
          ],
          { cwd: root, windowsHide: true, timeout: 10000, maxBuffer: 65536 },
        );
      const outcome = await execute().then(
        value => ({ value, error: null }),
        error => ({ value: null, error }),
      );
      expect(outcome.error !== null).toBe(kind !== 'valid');
      expect((outcome.value?.stdout ?? '').includes('COMPILER_DEPENDENCIES_READY')).toBe(
        kind === 'valid',
      );
      for (const name of ['sprite.svg', 'types.ts']) {
        const result = await readFile(
          join(root, 'compiler-workspace/source/app/components/ui/icons', name),
        ).then(
          () => 'present',
          error => error.code,
        );
        expect(result).toBe(kind === 'valid' ? 'ENOENT' : 'present');
      }
      for (let i = 0; i < 2; i++)
        expect(
          await readFile(
            join(root, 'compiler-input/app/components/ui/icons', ['sprite.svg', 'types.ts'][i]!),
            'utf8',
          ),
        ).toBe(bodies[i]);
    } finally {
      await removeOwnedFixture(root, 'sfp-c2-icon-bootstrap-');
    }
  },
);

it('requires a genuine unchanged Epic issuer and completed provisioner before narrowing the compiler module policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-c2-issuer-fence-'));
  try {
    const manifest = JSON.parse(epicCompilerFixture['package.json']);
    const names = [
      '@react-router/dev',
      '@react-router/express',
      'react-router',
      'vite',
      '@tailwindcss/vite',
      'express',
      '@epic-web/config',
      '@sentry/react-router',
      'react-router-devtools',
      'vite-env-only',
      'vite-plugin-icons-spritesheet',
      'react-router-auto-routes',
    ];
    const installed: Record<string, unknown> = { '': manifest };
    for (const name of names) {
      const spec = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
      const version = /^\D*(\d+\.\d+\.\d+)/u.exec(spec)?.[1] ?? '7.0.0';
      installed['node_modules/' + name] = { version, integrity: 'sha512-YWJjZA==' };
      const folder = join(root, 'node_modules', name);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'package.json'), JSON.stringify({ name, version }));
    }
    const files = {
      ...epicCompilerFixture,
      'server/app.ts': 'export const app = true;',
      'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: installed }),
      'app/components/ui/icons/sprite.svg': '<svg/>',
      'app/components/ui/icons/types.ts': 'export type IconName="owned";',
    };
    for (const [name, text] of Object.entries(files)) {
      await mkdir(join(root, name, '..'), { recursive: true });
      await writeFile(join(root, name), text);
    }
    const { RepoReader } = await import('../../src/fs/repo-walk.js');
    const { collectPortalSourceInventory } = await import('../../src/portal/source-inventory.js');
    const {
      captureReactRouterCompilerSource,
      prepareReactRouterCompilerProfile,
      reactRouterCompilerUsesProvisionedModules,
    } = await import('../../src/portal/react-router-compiler-evidence.js');
    const { nativeExecutableHash, issuedNativeOutputReceipt, NativeProfileSchema } =
      await import('../../src/portal/native-runner.js');
    const reader = new RepoReader({ rootDir: root }),
      inventory = await collectPortalSourceInventory(reader),
      source = await captureReactRouterCompilerSource(
        reader,
        'sha256:' + 'a'.repeat(64),
        inventory,
      );
    const raw = NativeProfileSchema.parse({
      schemaVersion: 1 as const,
      sourceAuthorityVersion: 2,
      id: 'epic-source-fence',
      executionMode: 'native-working-copy' as const,
      environmentKind: 'disposable-test' as const,
      sourceHash: source.inputHash,
      closure: [{ path: 'server/app.ts', hash: storedChecksum(files['server/app.ts']) }],
      environment: {},
      commands: [
        {
          id: 'placeholder',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args: ['-e', ''],
          timeoutMs: 1000,
        },
      ],
    });
    const issued = await prepareReactRouterCompilerProfile(source, raw, root);
    expect(reactRouterCompilerUsesProvisionedModules(issued, 'react-router-compiler')).toBe(true);
    expect(
      reactRouterCompilerUsesProvisionedModules(
        JSON.parse(JSON.stringify(issued)),
        'react-router-compiler',
      ),
    ).toBe(false);
    expect(reactRouterCompilerUsesProvisionedModules(issued, 'foreign-command')).toBe(false);
    const { createNativeModuleFence } = await import('../../src/portal/native-module-fence.js');
    const command = issued.commands.find(c => c.id === 'react-router-compiler')!;
    const home = join(root, 'private-home');
    await mkdir(home);
    await expect(
      createNativeModuleFence(
        issued,
        command,
        root,
        [],
        home,
        new AbortController().signal,
        issued,
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_COMPILER_PROVISIONER_REQUIRED' });
    const fabricated: any = {
      path: 'compiler-workspace',
      kind: 'provisioned-dependencies',
      producerCommandId: 'compiler-dependencies',
    };
    expect(issuedNativeOutputReceipt(fabricated)).toBe(false);
    issued.environment.SFP_UNREVIEWED = 'changed';
    expect(reactRouterCompilerUsesProvisionedModules(issued, 'react-router-compiler')).toBe(false);
  } finally {
    await removeOwnedFixture(root, 'sfp-c2-issuer-fence-');
  }
});
