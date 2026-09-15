import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  SERVICE_OPERATION_SPECS,
  createServiceOperationRegistry,
} from '../../src/execution/service-operation-registry.js';

const spec = (name: 'snapshot.capture' | 'grounding.refresh') => ({
  name,
  inputSchema: z.object({}).strict(),
  resultSchema: z.object({ ok: z.literal(true) }).strict(),
  policyId: `service:${name}:v1`,
  possibleEffects: [],
  effectsFor: () => [],
  idempotencyFor: () => 'operation-id' as const,
  approvalFor: () => 'none' as const,
  concurrency: 'file-write' as const,
  egressPolicy: {
    possibleInputClasses: () => [],
    possibleResultClasses: [],
    classifyInput: (value: Readonly<Record<string, unknown>>) => ({
      value,
      classes: [],
      bytes: 2,
      tokens: 1,
    }),
    classifyResult: (value: Readonly<Record<string, unknown>>) => ({
      value,
      classes: [],
      bytes: 11,
      tokens: 3,
    }),
    redactResult: (value: Readonly<Record<string, unknown>>) => value,
  },
  targetRequirementFor: () => 'required' as const,
  execute: async () => ({ ok: true as const }),
});

describe('service operation registry seam', () => {
  it('advertises control-only operations separately from the canonical MCP tools', () => {
    expect(Object.keys(SERVICE_OPERATION_SPECS).toSorted()).toEqual([
      'grounding.refresh',
      'recipe.evidence.hold',
      'recipe.evidence.release',
      'recipe.evidence.verify',
      'snapshot.capture',
    ]);
    expect(SERVICE_OPERATION_SPECS['snapshot.capture']?.targetRequirementFor({})).toBe('required');
    expect(SERVICE_OPERATION_SPECS['grounding.refresh']?.targetRequirementFor({})).toBe(
      'forbidden',
    );
  });

  it('rejects duplicate rows instead of hiding one with object overwrite', () => {
    const row = spec('snapshot.capture');
    expect(() => createServiceOperationRegistry([row, row])).toThrow(
      /duplicate.*snapshot\.capture/i,
    );
  });
});
