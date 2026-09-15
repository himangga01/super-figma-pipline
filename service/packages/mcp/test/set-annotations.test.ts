import { SetAnnotationsArgsSchema } from '@sfp/shared';
import { expect, it } from 'vitest';

import { OPERATION_POLICIES } from '../src/policy/operation-policy.js';
import { RESULT_EGRESS_POLICIES } from '../src/policy/result-egress-policy.js';
import { BATCHABLE_TOOL_NAMES, parseBatchOperations } from '../src/tools/batch.js';
import { ALL_TOOL_SPECS, WRITE_TOOL_NAMES } from '../src/tools/registry.js';

it('registers annotations through actual plugin, write, result and policy authorities', () => {
  const spec = ALL_TOOL_SPECS.find(value => value.name === 'set_annotations')!;
  expect(spec.kind).toBe('write');
  expect(spec.handlerAuthority).toBe('plugin-handler');
  expect(spec.targetRequirementFor({ nodeId: '1:2' })).toBe('required');
  expect(spec.inputSchema).toBe(SetAnnotationsArgsSchema);
  expect(spec.resultSchema.parse({ ok: true, nodeId: '1:2' })).toEqual({ ok: true, nodeId: '1:2' });
  expect(WRITE_TOOL_NAMES.has(spec.name)).toBe(true);
  expect(OPERATION_POLICIES[spec.name]).toBeDefined();
  expect(RESULT_EGRESS_POLICIES[spec.name]).toBeDefined();
  expect(BATCHABLE_TOOL_NAMES).toContain(spec.name);
  expect(
    parseBatchOperations({
      ops: [
        {
          tool: spec.name,
          params: { nodeId: '1:2', expectedAnnotations: [], annotations: [{ label: 'Note' }] },
        },
      ],
    }),
  ).toHaveLength(1);
});

it('retains text preimages, bounds rows and refuses undeclared script fields', () => {
  const args = {
    nodeId: '1:2',
    expectedAnnotations: [{ label: 'Current', labelMarkdown: '**Current**' }],
    annotations: [{ label: 'Next' }],
  };
  expect(SetAnnotationsArgsSchema.parse(args)).toEqual(args);
  expect(
    SetAnnotationsArgsSchema.safeParse({
      ...args,
      annotations: Array.from({ length: 129 }, () => ({ label: 'x' })),
    }).success,
  ).toBe(false);
  expect(SetAnnotationsArgsSchema.safeParse({ ...args, script: 'arbitrary' }).success).toBe(false);
});
