import type { OperationPolicy } from '@sfp/shared';

import type { ExecutableOperations } from '../../execution/executable-operation.js';
import { serviceResultPolicy } from '../../snapshot/operations.js';
import {
  RECIPE_EVIDENCE_OPERATION_NAMES,
  RecipeEvidenceArgsSchema,
  RecipeEvidenceResultSchema,
} from './evidence-contract.js';
import type { RecipeEvidenceHolds } from './evidence-hold.js';

const definitions = RECIPE_EVIDENCE_OPERATION_NAMES.map(name => {
  const policy: OperationPolicy = {
    toolName: name,
    possibleEffects: [
      { type: 'portal-state-read' },
      { type: 'portal-state-write' },
      ...(name === 'recipe.evidence.verify' || name === 'recipe.evidence.hold'
        ? [{ type: 'filesystem-read' as const, pathArgs: [] }]
        : []),
    ],
    possibleIdempotency: 'operation-id',
    effectsFor: () => policy.possibleEffects,
    idempotencyFor: () => 'operation-id',
    approvalFor: () => (name === 'recipe.evidence.release' ? 'explicit-user' : 'client'),
    concurrency: 'file-write',
  };
  return Object.freeze({
    name,
    inputSchema: RecipeEvidenceArgsSchema,
    resultSchema: RecipeEvidenceResultSchema,
    policy: Object.freeze(policy),
    egress: serviceResultPolicy(RecipeEvidenceResultSchema, ['public']),
    targetRequirementFor: () => 'forbidden' as const,
  });
});
export const RECIPE_EVIDENCE_DEFINITIONS = Object.freeze(definitions);
export const createRecipeEvidenceOperations = (holds: RecipeEvidenceHolds): ExecutableOperations =>
  Object.freeze(
    Object.fromEntries(
      RECIPE_EVIDENCE_DEFINITIONS.map(definition => [
        definition.name,
        {
          ...definition,
          operationKind: 'service' as const,
          execute: async (scope, args, signal) => {
            signal.throwIfAborted();
            const { binding } = RecipeEvidenceArgsSchema.parse(args);
            return definition.name === 'recipe.evidence.hold'
              ? holds.ensureHeld(scope, binding, signal)
              : definition.name === 'recipe.evidence.verify'
                ? holds.verifyHeld(scope, binding, signal)
                : holds.release(scope, binding, signal);
          },
        } satisfies ExecutableOperations[string],
      ]),
    ),
  );
