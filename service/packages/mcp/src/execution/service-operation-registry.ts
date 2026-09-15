import {
  ServiceOperationNameSchema,
  type ServiceOperationName,
  type ServiceOperationSpec,
} from '@sfp/shared';

import { RECIPE_EVIDENCE_DEFINITIONS } from '../portal/recipes/evidence-operations.js';
import { SNAPSHOT_OPERATION_DEFINITIONS } from '../snapshot/operations.js';

export type ServiceOperationRegistry = Readonly<
  Partial<Record<ServiceOperationName, ServiceOperationSpec<unknown, unknown>>>
>;

export const createServiceOperationRegistry = (
  rows: readonly ServiceOperationSpec<unknown, unknown>[],
): ServiceOperationRegistry => {
  const registry: Partial<Record<ServiceOperationName, ServiceOperationSpec<unknown, unknown>>> =
    Object.create(null) as Partial<
      Record<ServiceOperationName, ServiceOperationSpec<unknown, unknown>>
    >;
  for (const row of rows) {
    const name = ServiceOperationNameSchema.parse(row.name);
    if (registry[name] !== undefined) throw new Error(`duplicate service operation: ${name}`);
    registry[name] = Object.freeze(row);
  }
  return Object.freeze(registry);
};

export const SERVICE_OPERATION_SPECS: ServiceOperationRegistry = createServiceOperationRegistry(
  [...Object.values(SNAPSHOT_OPERATION_DEFINITIONS), ...RECIPE_EVIDENCE_DEFINITIONS].map(
    definition => ({
      name: definition.name,
      inputSchema: definition.inputSchema,
      resultSchema: definition.resultSchema,
      policyId: `service:${definition.name}:v1`,
      possibleEffects: definition.policy.possibleEffects,
      effectsFor: definition.policy.effectsFor,
      idempotencyFor: definition.policy.idempotencyFor,
      approvalFor: definition.policy.approvalFor,
      concurrency: definition.policy.concurrency,
      egressPolicy: definition.egress,
      targetRequirementFor: definition.targetRequirementFor,
      execute: async () => {
        throw new Error('OPERATION_EXECUTOR_REQUIRED');
      },
    }),
  ),
);
