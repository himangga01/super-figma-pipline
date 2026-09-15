import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { resolvePortalCase } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { ControlClient } from '../src/control-client.js';
import { runPortalPlanCommand } from '../src/portal-commands.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const path = relative(tmpdir(), root);
    if (!path || isAbsolute(path) || path.startsWith('..'))
      throw Error('Invalid test cleanup root');
    await rm(root, { recursive: true, force: true });
  }
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-portal-cli-'));
  roots.push(root);
  const workspace = vi
    .spyOn(ControlClient.prototype, 'workspace')
    .mockImplementation(
      async path => `00000000-0000-4000-8000-${String(path.length).padStart(12, '0')}`,
    );
  const invoke = vi
    .spyOn(ControlClient.prototype, 'invoke')
    .mockResolvedValue({ planId: 'fixture' });
  return {
    root,
    workspace,
    invoke,
    run: (args: string[]) =>
      runPortalPlanCommand(['portal', 'plan', ...args], () => {}, { home: root }),
  };
};
it('creates a concrete default output workspace for a new service without scanning references', async () => {
  const value = await fixture();
  await value.run([]);
  expect(value.workspace).toHaveBeenCalledExactlyOnceWith(
    join(value.root, 'Projects', 'SuperFigmaPortals'),
  );
  const input = value.invoke.mock.calls[0]![0];
  expect(resolvePortalCase(input.args).implementationScope).toBe('frontend-only');
  expect(input).toMatchObject({
    name: 'portal_plan',
    kind: 'tool',
    targetSelector: { kind: 'none' },
  });
});
it('registers an existing legacy root and keeps its operational scope', async () => {
  const value = await fixture(),
    legacy = join(value.root, 'legacy');
  await mkdir(legacy);
  await value.run(['--case', 'legacy', '--target', legacy]);
  expect(value.workspace).toHaveBeenCalledExactlyOnceWith(legacy);
  const input = value.invoke.mock.calls[0]![0];
  expect(input.args).toMatchObject({ case: 'legacy', targetPath: '.' });
  expect(resolvePortalCase(input.args).implementationScope).toBe('operational-portal');
});
it('uses only explicit service references for C3 and respects the chosen frontend stack', async () => {
  const value = await fixture(),
    reference = join(value.root, 'reference');
  await mkdir(reference);
  await value.run(['--case', 'new-reference', '--reference', reference, '--stack', 'vue-vite']);
  expect(value.workspace).toHaveBeenCalledWith(reference);
  const input = value.invoke.mock.calls[0]![0];
  expect(input.args).toMatchObject({
    case: 'new-reference',
    stack: 'vue-vite',
    references: [{ rootPath: '.', role: 'primary' }],
  });
  expect(resolvePortalCase(input.args).implementationScope).toBe('operational-portal');
});
it('rejects contradictory scope and invalid requests before workspace registration', async () => {
  const value = await fixture();
  await expect(value.run(['--case', 'new-blank', '--reference', value.root])).rejects.toThrow(
    'Case 4',
  );
  await expect(value.run(['--case', 'unknown'])).rejects.toThrow(/Invalid/u);
  expect(value.workspace).not.toHaveBeenCalled();
  expect(value.invoke).not.toHaveBeenCalled();
  await expect(stat(join(value.root, 'Projects'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('copies a supplied design into a hash-bound input artifact without marking it live', async () => {
  const value = await fixture(),
    source = join(value.root, 'original.json');
  const bytes = JSON.stringify({ nodes: [{ id: '1:1' }] });
  await writeFile(source, bytes);
  await value.run(['--design-artifact', source]);
  const args = value.invoke.mock.calls[0]![0].args as {
    design: { artifactPath: string; artifactHash: string; freshness: string };
  };
  expect(args.design.freshness).toBe('require-live');
  expect(args.design.artifactHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(
    await readFile(
      join(value.root, 'Projects', 'SuperFigmaPortals', args.design.artifactPath),
      'utf8',
    ),
  ).toBe(bytes);
  expect(await readFile(source, 'utf8')).toBe(bytes);
});
