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

  it('deduplicates a path declared for read and write and never reads file content', async () => {
    const policy = {
      resolveRead: vi.fn<WorkspacePolicy['resolveRead']>(async () => 'C:/workspace'),
      resolveWrite: vi.fn<WorkspacePolicy['resolveWrite']>(async () => ({
        path: 'C:/workspace',
        overwrites: false,
      })),
      assertWithinRoot: vi.fn<WorkspacePolicy['assertWithinRoot']>(async () => {}),
    };
    const context = await resolvePolicyInvocationContext(
      spec('design_diff'),
      { rootDir: '.', update: true },
      { workspaceId, workspaceRoot },
      policy,
    );

    expect(policy.resolveWrite).toHaveBeenCalledOnce();
    expect(policy.resolveRead).not.toHaveBeenCalled();
    expect(context.resolvedPaths).toEqual({
      rootDir: { path: 'C:/workspace', overwrites: false },
    });
  });
});
