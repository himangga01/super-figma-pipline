import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm, readFile, copyFile, readdir, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';

import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it, vi } from 'vitest';

import {
  prepareNativeArtifactAuthority,
  inventoryNativeArtifact,
  verifyNativeOutputReceipts,
} from '../../src/portal/native-artifacts.js';
import {
  NativePortalRunner,
  NativeProfileSchema,
  nativeExecutableHash,
} from '../../src/portal/native-runner.js';
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const roots: string[] = [];
const runners: NativePortalRunner[] = [];
afterEach(async () => {
  await Promise.all(runners.splice(0).map(runner => runner.close()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-artifact-'));
  roots.push(root);
  const source = 'console.log("ok")';
  await writeFile(join(root, 'check.mjs'), source);
  const profile = NativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    id: 'artifacts',
    executionMode: 'native-working-copy',
    environmentKind: 'disposable-test',
    sourceHash: storedChecksum(source),
    closure: [{ path: 'check.mjs', hash: storedChecksum(source) }],
    environment: {},
    commands: [
      {
        id: 'check',
        executable: process.execPath,
        executableHash: await nativeExecutableHash(process.execPath),
        args: ['check.mjs'],
        timeoutMs: 5000,
      },
    ],
  });
  const runner = new NativePortalRunner();
  runners.push(runner);
  return {
    root,
    profile,
    run: (budgetMs = 60000) =>
      runner.execute(
        'artifacts',
        profile,
        root,
        profile.sourceHash,
        new AbortController().signal,
        Date.now() + budgetMs,
      ),
  };
};
it('fences historical missing external authority at the actual runner', async () => {
  const value = await fixture();
  await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_ARTIFACT_AUTHORITY_REQUIRED' });
});
it('binds the whole approved external harness tree before launch', async () => {
  const value = await fixture();
  const external = await mkdtemp(join(tmpdir(), 'sfp-external-'));
  roots.push(external);
  await writeFile(join(external, 'entry.mjs'), 'import "./dep.mjs"');
  await writeFile(join(external, 'dep.mjs'), 'console.log("bound")');
  value.profile.commands[0]!.args = [join(external, 'entry.mjs')];
  value.profile.externalArtifacts = [{ root: external, kind: 'node-package-tree' }];
  value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
  await writeFile(join(external, 'dep.mjs'), 'throw Error("changed")');
  await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_ARTIFACT_CHANGED' });
});
it('records and verifies producer outputs before dependent commands and acceptance', async () => {
  const value = await fixture();
  const producer =
    'import {mkdirSync,writeFileSync} from "node:fs"; mkdirSync("node_modules");writeFileSync("node_modules/dep.mjs","export default 1");';
  await writeFile(join(value.root, 'check.mjs'), producer);
  value.profile.closure[0]!.hash = storedChecksum(producer);
  value.profile.commands[0]!.produces = [
    { path: 'node_modules', kind: 'provisioned-dependencies' },
  ];
  value.profile.commands.push({
    ...value.profile.commands[0]!,
    id: 'assert',
    args: ['-e', 'import("./node_modules/dep.mjs").then(m=>{if(m.default!==1)process.exit(1)})'],
    produces: [],
  });
  value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
  const result = await value.run();
  expect(result.commands.map(command => command.status)).toEqual(['passed', 'passed']);
  expect(result.outputReceipts).toHaveLength(1);
  await mkdir(join(value.root, 'node_modules', 'new'));
});

it.each(['change', 'add', 'remove'] as const)(
  'rejects %s of provisioned artifacts by an assertion',
  async mutation => {
    const value = await fixture();
    const source =
      'import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("node_modules");writeFileSync("node_modules/dep.mjs","export default 1")';
    await writeFile(join(value.root, 'check.mjs'), source);
    value.profile.closure[0]!.hash = storedChecksum(source);
    value.profile.commands[0]!.produces = [
      { path: 'node_modules', kind: 'provisioned-dependencies' },
    ];
    const mutate =
      mutation === 'remove'
        ? 'unlinkSync("node_modules/dep.mjs")'
        : `writeFileSync("node_modules/${mutation === 'add' ? 'added' : 'dep'}.mjs","export default 2")`;
    value.profile.commands.push({
      ...value.profile.commands[0]!,
      id: 'assert',
      produces: [],
      args: ['-e', `const {writeFileSync,unlinkSync}=require("node:fs");${mutate}`],
    });
    value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
    await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_PROVISIONED_OUTPUT_CHANGED' });
  },
);
it('does not publish a provisioning receipt or run assertions after failed installation', async () => {
  const value = await fixture();
  value.profile.commands[0]!.args = ['-e', 'process.exit(9)'];
  value.profile.commands[0]!.produces = [
    { path: 'node_modules', kind: 'provisioned-dependencies' },
  ];
  value.profile.commands.push({
    ...value.profile.commands[0]!,
    id: 'assert',
    produces: [],
    args: ['-e', 'process.exit(0)'],
  });
  value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
  const result = await value.run();
  expect(result.commands).toHaveLength(1);
  expect(result.commands[0]!.status).toBe('failed');
  expect(result.outputReceipts).toEqual([]);
});
it('rejects loader flags, unbound external entrypoints and pre-existing unbound dependencies', async () => {
  for (const args of [
    ['--import', 'bad.mjs', 'check.mjs'],
    [join(dirname(process.execPath), 'unbound.mjs')],
  ]) {
    const value = await fixture();
    value.profile.commands[0]!.args = args;
    value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
    await expect(value.run()).rejects.toMatchObject({
      code:
        args[0] === '--import'
          ? 'PORTAL_NATIVE_LOADER_UNSUPPORTED'
          : 'PORTAL_NATIVE_ENTRYPOINT_UNBOUND',
    });
  }
  const value = await fixture();
  await mkdir(join(value.root, 'node_modules'));
  await writeFile(join(value.root, 'node_modules', 'unbound.mjs'), '');
  value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
  await expect(value.run()).rejects.toMatchObject({
    code: 'PORTAL_PROFILE_CLOSURE_MEMBERSHIP_CHANGED',
  });
});
it('bounds artifact capture and verifies hardlink identity without granting source write authority', async () => {
  const value = await fixture();
  await expect(
    inventoryNativeArtifact(value.root, undefined, { entries: 1, bytes: 10, fileBytes: 10 }),
  ).rejects.toMatchObject({ code: 'PORTAL_ARTIFACT_LIMIT' });
  await link(join(value.root, 'check.mjs'), join(value.root, 'linked.mjs'));
  const before = await inventoryNativeArtifact(value.root);
  await writeFile(join(value.root, 'linked.mjs'), 'changed');
  expect((await inventoryNativeArtifact(value.root)).hash).not.toBe(before.hash);
});
it('executes actual offline npm provisioning followed by build and assertion with receipts', async () => {
  const value = await fixture(),
    npmRoot = join(dirname(process.execPath), 'node_modules/npm'),
    npm = join(npmRoot, 'bin/npm-cli.js');
  const packageRoot = await mkdtemp(join(tmpdir(), 'sfp-npm-package-'));
  roots.push(packageRoot);
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'sfp-native-test-dependency',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
    }),
  );
  await writeFile(join(packageRoot, 'index.js'), 'export const answer=42;');
  await promisify(execFile)(process.execPath, [npm, 'pack', '--ignore-scripts', '--offline'], {
    cwd: packageRoot,
    windowsHide: true,
  });
  const archive = (await readdir(packageRoot)).find(path => path.endsWith('.tgz'))!;
  await copyFile(join(packageRoot, archive), join(value.root, archive));
  const bytes = await readFile(join(value.root, archive));
  await writeFile(
    join(value.root, 'package.json'),
    JSON.stringify({
      name: 'native-consumer',
      version: '1.0.0',
      type: 'module',
      dependencies: { 'sfp-native-test-dependency': `file:${archive}` },
    }),
  );
  await writeFile(
    join(value.root, 'package-lock.json'),
    JSON.stringify({
      name: 'native-consumer',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'native-consumer',
          version: '1.0.0',
          dependencies: { 'sfp-native-test-dependency': `file:${archive}` },
        },
        'node_modules/sfp-native-test-dependency': {
          version: '1.0.0',
          resolved: `file:${archive}`,
          integrity: 'sha512:' + createHash('sha512').update(bytes).digest('base64'),
        },
      },
    }),
  );
  const build =
    'import {answer} from "sfp-native-test-dependency";import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("dist");writeFileSync("dist/result.json",JSON.stringify({answer}));';
  await writeFile(join(value.root, 'check.mjs'), build);
  value.profile.closure = await Promise.all(
    (await readdir(value.root)).map(async path => ({
      path,
      hash: storedChecksum(await readFile(join(value.root, path))),
    })),
  );
  const base = value.profile.commands[0]!;
  value.profile.commands = [
    {
      ...base,
      id: 'install',
      args: [npm, 'ci', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'],
      timeoutMs: 30000,
      produces: [{ path: 'node_modules', kind: 'provisioned-dependencies' }],
    },
    { ...base, id: 'build', produces: [{ path: 'dist', kind: 'generated-output' }] },
    {
      ...base,
      id: 'assert',
      args: [
        '-e',
        'if(JSON.parse(require("fs").readFileSync("dist/result.json")).answer!==42)process.exit(1)',
      ],
    },
  ];
  value.profile.externalArtifacts = [{ root: npmRoot, kind: 'node-package-tree' }];
  value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
  const result = await value.run();
  expect(
    result.commands.map(command => ({
      id: command.commandId,
      status: command.status,
      output: command.output,
    })),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'install', status: 'passed' }),
      expect.objectContaining({ id: 'build', status: 'passed' }),
      expect.objectContaining({ id: 'assert', status: 'passed' }),
    ]),
  );
  expect(result.outputReceipts).toHaveLength(2);
  await writeFile(
    join(value.root, 'node_modules/sfp-native-test-dependency/index.js'),
    'export const answer=0;',
  );
  await expect(
    verifyNativeOutputReceipts(value.root, result.outputReceipts, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_PROVISIONED_OUTPUT_CHANGED' });
}, 90000);

it('binds a declared Vite-style generated cache separately from installed dependencies', async () => {
  const value = await fixture();
  const producer =
    'import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("node_modules");writeFileSync("node_modules/dep.mjs","export default 1")';
  await writeFile(join(value.root, 'check.mjs'), producer);
  value.profile.closure[0]!.hash = storedChecksum(producer);
  value.profile.commands[0]!.produces = [
    { path: 'node_modules', kind: 'provisioned-dependencies' },
  ];
  value.profile.commands.push({
    ...value.profile.commands[0]!,
    id: 'build',
    produces: [{ path: 'node_modules/.vite-temp', kind: 'generated-output' }],
    args: [
      '-e',
      'const {mkdirSync,writeFileSync}=require("fs");mkdirSync("node_modules/.vite-temp");writeFileSync("node_modules/.vite-temp/config.mjs","export default 1")',
    ],
  });
  value.profile.commands.push({
    ...value.profile.commands[0]!,
    id: 'assert',
    produces: [],
    args: ['node_modules/.vite-temp/config.mjs'],
  });
  value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
  const result = await value.run();
  expect(result.commands.map(command => command.status)).toEqual(['passed', 'passed', 'passed']);
  expect(result.outputReceipts[0]!.generatedChildren).toEqual(['.vite-temp']);
  await writeFile(join(value.root, 'node_modules/.vite-temp/config.mjs'), 'export default 2');
  await expect(
    verifyNativeOutputReceipts(value.root, result.outputReceipts, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_PROVISIONED_OUTPUT_CHANGED' });
}, 60000);
it('rejects an external harness dynamic or escaping module closure during preparation', async () => {
  for (const source of ['await import(process.env.MODULE)', 'import "../outside.mjs"']) {
    const value = await fixture();
    const external = await mkdtemp(join(tmpdir(), 'sfp-loader-'));
    roots.push(external);
    await writeFile(join(external, 'entry.mjs'), source);
    value.profile.commands[0]!.args = [join(external, 'entry.mjs')];
    value.profile.externalArtifacts = [{ root: external, kind: 'node-package-tree' }];
    await expect(prepareNativeArtifactAuthority(value.profile)).rejects.toMatchObject({
      code: 'PORTAL_NATIVE_LOADER_UNSUPPORTED',
    });
  }
});

it.runIf(process.env.SFP_NATIVE_VITE_ACCEPTANCE === '1')(
  'provisions and builds the actual locked React/Vite preset with a generated configuration cache',
  async () => {
    const value = await fixture();
    await copyFile(
      join(import.meta.dirname, 'fixtures/native-vite-package.json'),
      join(value.root, 'package.json'),
    );
    await copyFile(
      join(import.meta.dirname, 'fixtures/native-vite-lock.json'),
      join(value.root, 'package-lock.json'),
    );
    await writeFile(
      join(value.root, 'index.html'),
      '<div id="root"></div><script type="module" src="/app.jsx"></script>',
    );
    await writeFile(
      join(value.root, 'app.jsx'),
      'import React from "react";import {createRoot} from "react-dom/client";createRoot(document.getElementById("root")).render(<h1>Native authority verified</h1>);',
    );
    await writeFile(
      join(value.root, 'vite.config.mjs'),
      'import {defineConfig} from "vite";import react from "@vitejs/plugin-react";export default defineConfig({plugins:[react()]});',
    );
    value.profile.closure = await Promise.all(
      (await readdir(value.root)).map(async path => ({
        path,
        hash: storedChecksum(await readFile(join(value.root, path))),
      })),
    );
    const npmRoot = join(dirname(process.execPath), 'node_modules/npm'),
      base = value.profile.commands[0]!;
    value.profile.commands = [
      {
        ...base,
        id: 'install',
        timeoutMs: 120000,
        args: [
          join(npmRoot, 'bin/npm-cli.js'),
          'ci',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ],
        produces: [{ path: 'node_modules', kind: 'provisioned-dependencies' }],
      },
      {
        ...base,
        id: 'build',
        timeoutMs: 60000,
        args: ['node_modules/vite/bin/vite.js', 'build'],
        produces: [
          { path: 'dist', kind: 'generated-output' },
          { path: 'node_modules/.vite-temp', kind: 'generated-output' },
        ],
      },
      {
        ...base,
        id: 'assert',
        args: [
          '-e',
          'const fs=require("fs");if(!fs.readFileSync("dist/index.html","utf8").includes("/assets/"))process.exit(1);if(!fs.readdirSync("dist/assets").some(name=>name.endsWith(".js")))process.exit(2)',
        ],
      },
    ];
    value.profile.externalArtifacts = [{ root: npmRoot, kind: 'node-package-tree' }];
    value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
    const result = await value.run(240000);
    expect(
      result.commands.map(command => ({
        id: command.commandId,
        status: command.status,
        output: command.output,
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'install', status: 'passed' }),
        expect.objectContaining({ id: 'build', status: 'passed' }),
        expect.objectContaining({ id: 'assert', status: 'passed' }),
      ]),
    );
    expect(result.outputReceipts.map(receipt => receipt.path)).toEqual([
      'node_modules',
      'dist',
      'node_modules/.vite-temp',
    ]);
  },
  300000,
);

it('rejects package-manager implementation replacement while the Node executable is unchanged', async () => {
  const value = await fixture(),
    npmRoot = await mkdtemp(join(tmpdir(), 'sfp-reviewed-npm-'));
  roots.push(npmRoot);
  await mkdir(join(npmRoot, 'bin'));
  await writeFile(
    join(npmRoot, 'package.json'),
    JSON.stringify({ name: 'npm', version: 'fixture' }),
  );
  await writeFile(join(npmRoot, 'bin/npm-cli.js'), 'process.exit(0)');
  value.profile.commands[0]!.args = [join(npmRoot, 'bin/npm-cli.js'), 'ci', '--ignore-scripts'];
  value.profile.commands[0]!.produces = [
    { path: 'node_modules', kind: 'provisioned-dependencies' },
  ];
  value.profile.externalArtifacts = [{ root: npmRoot, kind: 'node-package-tree' }];
  value.profile.artifactAuthority = await prepareNativeArtifactAuthority(value.profile);
  await writeFile(join(npmRoot, 'bin/npm-cli.js'), 'throw Error("replacement must not run")');
  await expect(value.run()).rejects.toMatchObject({ code: 'PORTAL_ARTIFACT_CHANGED' });
});
