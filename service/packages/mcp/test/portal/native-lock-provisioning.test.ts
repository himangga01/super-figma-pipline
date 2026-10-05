import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import {
  inventoryNativeArtifact,
  verifyNativeCommandInputs,
  verifyNativeOutputReceipts,
  type NativeOutputReceipt,
} from '../../src/portal/native-artifacts.js';
import { NativeProfileSchema } from '../../src/portal/native-runner.js';
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep))
      throw new Error('Invalid fixture cleanup');
    await rm(folder, { recursive: true, force: true });
  }
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-lock-'));
  folders.push(root);
  const npm = join(root, 'npm');
  await mkdir(join(npm, 'bin'), { recursive: true });
  const entry = join(npm, 'bin', 'npm-cli.js');
  await writeFile(entry, '// controlled package manager entry');
  const project = join(root, 'project');
  await mkdir(project);
  await writeFile(join(project, 'package.json'), '{}');
  const base = {
    executable: process.execPath,
    executableHash: storedChecksum('fixture'),
    cwd: '.',
    timeoutMs: 1000,
  };
  const profile = NativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    id: 'lock',
    executionMode: 'native-working-copy',
    environmentKind: 'disposable-test',
    sourceHash: storedChecksum('source'),
    closure: [{ path: 'package.json', hash: storedChecksum('{}') }],
    environment: {},
    commands: [
      {
        ...base,
        id: 'lock',
        args: [entry, 'install', '--package-lock-only', '--ignore-scripts'],
        produces: [{ path: 'package-lock.json', kind: 'generated-output' }],
      },
      {
        ...base,
        id: 'install',
        args: [entry, 'ci', '--ignore-scripts', '--include=dev'],
        produces: [{ path: 'node_modules', kind: 'provisioned-dependencies' }],
      },
    ],
  });
  profile.artifactAuthority = {
    artifacts: [
      {
        declaration: { root: npm, kind: 'node-package-tree' },
        inventory: await inventoryNativeArtifact(npm),
      },
    ],
  } as typeof profile.artifactAuthority;
  return { project, profile };
};
it('requires a declared lock output and a verified earlier producer before installation', async () => {
  const { project, profile } = await fixture();
  await expect(
    verifyNativeCommandInputs(profile, profile.commands[0]!, project, []),
  ).resolves.toBeUndefined();
  await expect(
    verifyNativeCommandInputs(profile, profile.commands[1]!, project, []),
  ).rejects.toMatchObject({ code: 'PORTAL_PROVISIONING_INPUTS_REQUIRED' });
  await writeFile(join(project, 'package-lock.json'), '{}');
  const receipt: NativeOutputReceipt = {
    producerCommandId: 'lock',
    commandHash: storedChecksum('command'),
    kind: 'generated-output',
    path: 'package-lock.json',
    inventory: await inventoryNativeArtifact(join(project, 'package-lock.json')),
    inputAuthorityHash: storedChecksum('inputs'),
    exitCode: 0,
    generatedChildren: [],
  };
  await verifyNativeOutputReceipts(project, [receipt], new AbortController().signal);
  await expect(
    verifyNativeCommandInputs(profile, profile.commands[1]!, project, [receipt]),
  ).resolves.toBeUndefined();
  const other = structuredClone(profile);
  other.commands[0]!.args[0] = 'arbitrary-writer.mjs';
  await expect(
    verifyNativeCommandInputs(other, other.commands[1]!, project, [receipt]),
  ).rejects.toMatchObject({ code: 'PORTAL_PROVISIONING_INPUTS_REQUIRED' });
  await writeFile(join(project, 'package-lock.json'), '{"changed":true}');
  await expect(
    verifyNativeOutputReceipts(project, [receipt], new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'PORTAL_PROVISIONED_OUTPUT_CHANGED',
  });
});
it.each([
  '--script-shell=unreviewed',
  '--package-lock=false',
  '--registry=https://unreviewed.invalid',
])('rejects unreviewed npm flags: %s', async flag => {
  const { project, profile } = await fixture();
  profile.commands[0]!.args.push(flag);
  await expect(
    verifyNativeCommandInputs(profile, profile.commands[0]!, project, []),
  ).rejects.toMatchObject({ code: 'PORTAL_NATIVE_PACKAGE_MANAGER_UNSUPPORTED' });
});
it('does not allow lock generation to overwrite a reviewed source lock', async () => {
  const { project, profile } = await fixture();
  profile.closure.push({ path: 'package-lock.json', hash: storedChecksum('old') });
  await expect(
    verifyNativeCommandInputs(profile, profile.commands[0]!, project, []),
  ).rejects.toMatchObject({ code: 'PORTAL_PROVISIONING_INPUTS_REQUIRED' });
});
