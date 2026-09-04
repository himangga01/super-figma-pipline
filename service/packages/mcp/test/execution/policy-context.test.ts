import { join } from 'node:path';

import type { WorkspacePolicy } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { resolvePolicyInvocationContext } from '../../src/execution/execution-plane.js';
import { evaluateOperationPolicy } from '../../src/policy/policy-engine.js';
import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';

const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
const workspaceRoot = 'C:/workspace';

const spec = (name: string) => ALL_TOOL_SPECS.find(candidate => candidate.name === name)!;

describe('path-first policy context', () => {
  it('resolves a real export_pdf overwrite before evaluating effects', async () => {
    const events: string[] = [];
    const policy = {
      resolveRead: vi.fn<WorkspacePolicy['resolveRead']>(async () => {
        events.push('resolve-read');
        return 'C:/workspace/out.pdf';
      }),
      resolveWrite: vi.fn<WorkspacePolicy['resolveWrite']>(async () => {
        events.push('resolve-write');
        return { path: 'C:/workspace/out.pdf', overwrites: true };
      }),
      assertWithinRoot: vi.fn<WorkspacePolicy['assertWithinRoot']>(async () => {}),
    };
    const args = { nodeId: '1:2', outPath: 'out.pdf' };
    const context = await resolvePolicyInvocationContext(
      spec('export_pdf'),
      args,
      { workspaceId, workspaceRoot },
      policy,
    );
    events.push('effects');
    const decision = evaluateOperationPolicy('export_pdf', args, context);

    expect(events).toEqual(['resolve-write', 'effects']);
    expect(context.resolvedPaths?.outPath).toEqual({
      path: 'C:/workspace/out.pdf',
      overwrites: true,
    });
    expect(decision.effects).toContainEqual({
      type: 'filesystem-write',
      pathArgs: ['outPath'],
      destructive: true,
    });
  });

  it('resolves design_diff root as a directory read and its derived snapshot as the write target', async () => {
    const policy = {
      resolveRead: vi.fn<WorkspacePolicy['resolveRead']>(async () => 'C:/workspace'),
      resolveWrite: vi.fn<WorkspacePolicy['resolveWrite']>(async (_workspace, input) => ({
        path: input,
        overwrites: true,
      })),
      assertWithinRoot: vi.fn<WorkspacePolicy['assertWithinRoot']>(async () => {}),
    };
    const context = await resolvePolicyInvocationContext(
      spec('design_diff'),
      { rootDir: '.', nodeId: '1:1', update: true },
      { workspaceId, workspaceRoot },
      policy,
    );

    expect(policy.resolveWrite).toHaveBeenCalledOnce();
    expect(policy.resolveRead).toHaveBeenCalledOnce();
    expect(context.resolvedPaths).toEqual({
      rootDir: { path: 'C:/workspace', overwrites: false },
      snapshotPath: {
        path: join('C:/workspace', '.figwright', 'snapshots', '1-1.json'),
        overwrites: true,
      },
    });
  });

  it('derives design_diff snapshot authority from the resolved subproject root', async () => {
    const subproject = join('C:/workspace', 'packages', 'app');
    const resolveWrite = vi.fn<WorkspacePolicy['resolveWrite']>(async (_workspace, input) => ({
      path: input,
      overwrites: false,
    }));
    const context = await resolvePolicyInvocationContext(
      spec('design_diff'),
      { rootDir: 'packages/app', nodeId: '1:1' },
      { workspaceId, workspaceRoot },
      {
        resolveRead: async () => subproject,
        resolveWrite,
        assertWithinRoot: async () => undefined,
      },
    );

    const snapshot = join(subproject, '.figwright', 'snapshots', '1-1.json');
    expect(resolveWrite).toHaveBeenLastCalledWith(workspaceId, snapshot);
    expect(context.resolvedPaths?.snapshotPath?.path).toBe(snapshot);
  });

  it('uses directory-specific resolution for an existing save_screenshots outDir', async () => {
    const resolveWrite = vi.fn<WorkspacePolicy['resolveWrite']>(async () => {
      throw new Error('file resolver must not classify outDir');
    });
    const resolveWriteDirectory = vi.fn<() => Promise<{ path: string; exists: boolean }>>(
      async () => ({ path: 'C:/workspace/exports', exists: true }),
    );
    const context = await resolvePolicyInvocationContext(
      spec('save_screenshots'),
      { nodeIds: ['1:1'], outDir: 'exports' },
      { workspaceId, workspaceRoot },
      {
        resolveRead: async () => 'unused',
        resolveWrite,
        resolveWriteDirectory,
        assertWithinRoot: async () => undefined,
      } as WorkspacePolicy,
    );
    expect(resolveWriteDirectory).toHaveBeenCalledOnce();
    expect(resolveWrite).not.toHaveBeenCalled();
    expect(context.resolvedPaths?.outDir).toEqual({
      path: 'C:/workspace/exports',
      overwrites: false,
    });
  });
});
