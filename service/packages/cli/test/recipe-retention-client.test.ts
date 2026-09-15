import { createHash } from 'node:crypto';

import { expect, it, vi } from 'vitest';

import { ControlClient } from '../src/control-client.js';
import {
  createControlRecipeRetention,
  type RecipeRetentionBinding,
} from '../src/control-recipe-client.js';
import { recipeHash } from '../src/recipe-plan.js';

const hash = `sha256:${'a'.repeat(64)}`;
const binding: RecipeRetentionBinding = {
  version: 1,
  planHash: hash,
  stepId: 'sfp_internal:observe:3',
  operationId: `sfp_op1_fixture.${'A'.repeat(43)}`,
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  workspaceId: '11111111-1111-4111-8111-111111111111',
  targetBindingHash: hash,
  argsHash: hash,
  resultSchemaHash: hash,
  operationKind: 'tool',
  operationName: 'get_node',
  maxResultBytes: 8388608,
};
const held = () => ({
  version: 1,
  holdId: recipeHash(binding, 'sfp-recipe-evidence-binding-v1'),
  binding,
  state: 'held',
  verified: null,
});
it('calls only exact metadata service operations and requires a verified response for consumption', async () => {
  const invoke = vi.fn<ControlClient['invoke']>(async () => held());
  const port = createControlRecipeRetention({ invoke });
  await port.ensureHeld(binding);
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'recipe.evidence.hold',
      kind: 'service',
      args: { binding },
      workspaceId: binding.workspaceId,
      targetSelector: { kind: 'none' },
      approve: true,
      captureResult: false,
    }),
  );
  await expect(port.verifyHeld(binding)).rejects.toThrow('RECIPE_RETENTION_INVALID');
});
it.each([
  { state: 'released' },
  { holdId: `sha256:${'b'.repeat(64)}` },
  { binding: { ...binding, argsHash: `sha256:${'b'.repeat(64)}` } },
  { passed: true },
])('rejects changed or untyped hold responses: %j', async changed => {
  const port = createControlRecipeRetention({ invoke: async () => ({ ...held(), ...changed }) });
  await expect(port.ensureHeld(binding)).rejects.toThrow('RECIPE_RETENTION_INVALID');
});
it('binds verified artifact metadata to the exact held operation and result schema', async () => {
  const pathHash = createHash('sha256')
    .update('sfp-operation-evidence-path-v1\0')
    .update(binding.operationId)
    .digest('hex');
  const verified = {
    receiptHash: hash,
    finalizerHash: hash,
    resultHash: hash,
    resultBytes: 10,
    resultArtifact: {
      artifactRelativePath: `.sfp/operation-evidence/${pathHash}/result.v1.json`,
      artifactDigest64: 'a'.repeat(64),
      resultSchemaHash: hash,
    },
  };
  let response = { ...held(), verified };
  const port = createControlRecipeRetention({ invoke: async () => response });
  await port.verifyHeld(binding);
  response = {
    ...response,
    verified: {
      ...verified,
      resultArtifact: {
        ...verified.resultArtifact,
        artifactRelativePath: `.sfp/operation-evidence/${'b'.repeat(64)}/result.v1.json`,
      },
    },
  };
  await expect(port.verifyHeld(binding)).rejects.toThrow('RECIPE_RETENTION_INVALID');
});
it('preserves server hold failures and blocks unavailable protocol endpoints', async () => {
  const stopped = createControlRecipeRetention({
    invoke: async () => {
      throw Object.assign(new Error('released'), { code: 'RECIPE_HOLD_RELEASED' });
    },
  });
  await expect(stopped.ensureHeld(binding)).rejects.toMatchObject({ code: 'RECIPE_HOLD_RELEASED' });
  const missing = createControlRecipeRetention({
    invoke: async () => {
      throw Object.assign(new Error('missing'), { status: 404 });
    },
  });
  await expect(missing.ensureHeld(binding)).rejects.toThrow('RECIPE_RETENTION_UNAVAILABLE');
});
it('rejects unknown service names before requesting an operation ID or falling through to grounding', async () => {
  const client = new ControlClient({ stateRoot: 'unused' });
  const request = vi.spyOn(client, 'request');
  await expect(
    client.invoke({
      name: 'recipe.unknown',
      kind: 'service',
      args: {},
      workspaceId: binding.workspaceId,
      targetSelector: { kind: 'none' },
      approve: false,
      emit: () => {},
    }),
  ).rejects.toThrow('CONTROL_SERVICE_OPERATION_UNSUPPORTED');
  expect(request).not.toHaveBeenCalled();
});
