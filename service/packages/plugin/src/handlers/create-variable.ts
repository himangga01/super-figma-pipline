import type { VariableResult } from '@sfp/shared';
import { VariableInitialValuesSchema } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaVariableValue } from './convert.js';

// A subset of Figma's VariableResolvedDataType, which plugin-typings 1.133 widened with EASING and
// TIMING. Those two are deliberately left out: Figma's own createVariable refuses them —
// "EASING and TIMING variable creation is not currently available" — measured 2026-08-08 against an
// up-to-date editor, so offering them would only be a guaranteed failure.
//
// The whole write side is gated, not just creation: setValueForMode likewise answers "EASING
// variable editing is not supported". Such variables *can* be made in the Figma UI and read back
// fine (get-variable-defs serializes their curves), so plugins see them as read-only for now.
// Re-add both here and in the MCP tool's enum once Figma opens writing up.
const RESOLVED_TYPES = ['BOOLEAN', 'FLOAT', 'STRING', 'COLOR'] as const;
type ResolvedType = (typeof RESOLVED_TYPES)[number];

export const createCreateVariableHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, execution) => {
    const p = (params ?? {}) as {
      name?: unknown;
      collectionId?: unknown;
      resolvedType?: unknown;
      initialValues?: unknown;
    };
    if (typeof p.name !== 'string') throw new TypeError('create_variable: name must be a string');
    if (typeof p.collectionId !== 'string') {
      throw new TypeError('create_variable: collectionId must be a string');
    }
    if (!RESOLVED_TYPES.includes(p.resolvedType as ResolvedType)) {
      throw new TypeError(
        `create_variable: resolvedType must be one of ${RESOLVED_TYPES.join(' / ')}`,
      );
    }

    const initialValues =
      p.initialValues === undefined
        ? undefined
        : VariableInitialValuesSchema.parse(p.initialValues);
    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (collection === null) {
      throw new Error(`create_variable: collection ${p.collectionId} not found`);
    }
    if (initialValues !== undefined) {
      const modes = collection.modes.map(mode => mode.modeId).toSorted();
      if (
        JSON.stringify(modes) !== JSON.stringify(initialValues.map(row => row.modeId).toSorted())
      ) {
        throw new Error('create_variable: initialValues must cover every current mode exactly');
      }
      for (const { value } of initialValues) {
        if (typeof value === 'object' && 'type' in value) {
          // Resolve every external dependency before creating our own object.
          // eslint-disable-next-line no-await-in-loop -- bounded dependency preflight before any creation
          const alias = await figmaCtx.variables.getVariableByIdAsync(value.id);
          if (alias === null || alias.resolvedType !== p.resolvedType) {
            throw new Error('create_variable: alias is missing or has a different resolvedType');
          }
        } else {
          const actualType =
            typeof value === 'object'
              ? 'COLOR'
              : typeof value === 'boolean'
                ? 'BOOLEAN'
                : typeof value === 'number'
                  ? 'FLOAT'
                  : 'STRING';
          if (actualType !== p.resolvedType)
            throw new TypeError('create_variable: initial value resolvedType mismatch');
        }
      }
      // Async alias lookups may yield to other edits. Do not initialize a stale mode set.
      const current = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
      if (
        current === null ||
        JSON.stringify(current.modes.map(mode => mode.modeId).toSorted()) !== JSON.stringify(modes)
      ) {
        throw new Error('create_variable: collection modes changed during preflight');
      }
    }
    const variable = figmaCtx.variables.createVariable(
      p.name,
      collection,
      p.resolvedType as ResolvedType,
    );
    execution?.markMutated?.();
    const createdId = variable.id;

    if (initialValues !== undefined) {
      try {
        for (const { modeId, value } of initialValues) {
          variable.setValueForMode(modeId, toFigmaVariableValue(value));
        }
        for (const { modeId, value } of initialValues) {
          const actual = variable.valuesByMode[modeId];
          const expected = toFigmaVariableValue(value);
          const matches =
            typeof expected !== 'object'
              ? actual === expected
              : typeof actual === 'object' &&
                actual !== null &&
                Object.keys(actual).length === Object.keys(expected).length &&
                Object.entries(expected).every(
                  ([key, entry]) => Reflect.get(actual, key) === entry,
                );
          if (!matches) throw new Error('create_variable: initialized value readback mismatch');
        }
      } catch (cause) {
        // Never delete a pre-existing variable or claim rollback without actual absence evidence.
        try {
          variable.remove();
          if ((await figmaCtx.variables.getVariableByIdAsync(createdId)) !== null)
            throw new Error('object still exists', { cause });
        } catch {
          throw new Error(
            'create_variable: initialization failed; cleanup unverified, partial effect requires reconciliation',
            { cause },
          );
        }
        throw new Error(
          'create_variable: initialization failed; created variable removal verified',
          { cause },
        );
      }
    }

    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    return result;
  };
