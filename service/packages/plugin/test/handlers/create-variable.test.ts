import type { VariableResult } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateVariableHandler } from '../../src/handlers/create-variable.js';
import { settleHandlerFailure, withMutationOutcome } from '../../src/mutation.js';

const withCollection = (collection: unknown): typeof figma =>
  ({
    variables: {
      getVariableCollectionByIdAsync: async () => collection,
      createVariable: () => ({}),
    },
  }) as unknown as typeof figma;

describe('create_variable handler', () => {
  function initializedFixture(
    options: { failSet?: boolean; failRemove?: boolean; silentSet?: boolean } = {},
  ) {
    const collection = {
      id: 'VC:0',
      modes: [
        { modeId: 'M:light', name: 'Light' },
        { modeId: 'M:dark', name: 'Dark' },
      ],
    };
    const other = { id: 'V:existing', resolvedType: 'FLOAT', remove: vi.fn<() => void>() };
    const valuesByMode: Record<string, unknown> = {};
    let exists = false;
    const variable = {
      id: 'V:new',
      name: 'space',
      valuesByMode,
      setValueForMode: vi.fn<(mode: string, value: unknown) => void>((mode, value) => {
        if (options.failSet) throw new Error('host refused');
        if (!options.silentSet) valuesByMode[mode] = value;
      }),
      remove: vi.fn<() => void>(() => {
        if (options.failRemove) throw new Error('host refused removal');
        exists = false;
      }),
    };
    const createVariable = vi.fn<() => typeof variable>(() => {
      exists = true;
      return variable;
    });
    const f = {
      variables: {
        getVariableCollectionByIdAsync: vi.fn<() => Promise<typeof collection>>(
          async () => collection,
        ),
        getVariableByIdAsync: vi.fn<(id: string) => Promise<typeof other | typeof variable | null>>(
          async (id: string) =>
            id === other.id ? other : id === variable.id && exists ? variable : null,
        ),
        createVariable,
      },
    } as unknown as typeof figma;
    return { f, collection, variable, other, createVariable };
  }
  const request = { name: 'space', collectionId: 'VC:0', resolvedType: 'FLOAT' };
  it.each(['collection', 'alias', 'mode-recheck'] as const)(
    'does not create or initialize a variable cancelled during %s preflight',
    async boundary => {
      const fixture = initializedFixture();
      const controller = new AbortController();
      const reason = new Error('cancelled during preflight');
      let reads = 0;
      vi.mocked(fixture.f.variables.getVariableCollectionByIdAsync).mockImplementation(async () => {
        reads++;
        if (
          (boundary === 'collection' && reads === 1) ||
          (boundary === 'mode-recheck' && reads === 2)
        )
          controller.abort(reason);
        return fixture.collection as unknown as VariableCollection;
      });
      vi.mocked(fixture.f.variables.getVariableByIdAsync).mockImplementation(async () => {
        if (boundary === 'alias') controller.abort(reason);
        return fixture.other as unknown as Variable;
      });
      const handler = withMutationOutcome(
        fixture.f,
        'create_variable',
        createCreateVariableHandler(fixture.f),
      );
      const error = await Promise.resolve(
        handler(
          {
            ...request,
            ...(boundary === 'collection'
              ? {}
              : {
                  initialValues: [
                    { modeId: 'M:light', value: 0 },
                    { modeId: 'M:dark', value: { type: 'VARIABLE_ALIAS', id: 'V:existing' } },
                  ],
                }),
          },
          { signal: controller.signal, report: () => {} },
        ),
      ).then(
        () => null,
        cause => cause,
      );
      expect(error).toBe(reason);
      expect(settleHandlerFailure(error)).toBe(false);
      expect(fixture.createVariable).not.toHaveBeenCalled();
      expect(fixture.variable.setValueForMode).not.toHaveBeenCalled();
      expect(fixture.variable.remove).not.toHaveBeenCalled();
      expect(fixture.other.remove).not.toHaveBeenCalled();
    },
  );
  it('initializes every actual mode, preserving zero and a typed existing alias', async () => {
    const fixture = initializedFixture();
    await expect(
      createCreateVariableHandler(fixture.f)({
        ...request,
        initialValues: [
          { modeId: 'M:light', value: 0 },
          { modeId: 'M:dark', value: { type: 'VARIABLE_ALIAS', id: 'V:existing' } },
        ],
      }),
    ).resolves.toEqual({ ok: true, variableId: 'V:new', name: 'space' });
    expect(fixture.variable.valuesByMode).toEqual({
      'M:light': 0,
      'M:dark': { type: 'VARIABLE_ALIAS', id: 'V:existing' },
    });
    expect(fixture.other.remove).not.toHaveBeenCalled();
  });
  it('rejects incomplete modes, duplicate modes, incorrect typed values and unknown aliases before create', async () => {
    for (const initialValues of [
      [{ modeId: 'M:light', value: 0 }],
      [
        { modeId: 'M:light', value: 0 },
        { modeId: 'M:light', value: 1 },
      ],
      [
        { modeId: 'M:light', value: '0' },
        { modeId: 'M:dark', value: 1 },
      ],
      [
        { modeId: 'M:light', value: { type: 'VARIABLE_ALIAS', id: 'absent' } },
        { modeId: 'M:dark', value: 1 },
      ],
    ]) {
      const fixture = initializedFixture();
      await expect(
        createCreateVariableHandler(fixture.f)({ ...request, initialValues }),
      ).rejects.toThrow(/mode|resolvedType|alias/i);
      expect(fixture.createVariable).not.toHaveBeenCalled();
    }
  });
  it('rechecks collection modes after asynchronous dependency preflight', async () => {
    const fixture = initializedFixture();
    vi.mocked(fixture.f.variables.getVariableByIdAsync).mockImplementationOnce(async () => {
      fixture.collection.modes.push({ modeId: 'M:new', name: 'New' });
      return fixture.other as unknown as Variable;
    });
    await expect(
      createCreateVariableHandler(fixture.f)({
        ...request,
        initialValues: [
          { modeId: 'M:light', value: { type: 'VARIABLE_ALIAS', id: 'V:existing' } },
          { modeId: 'M:dark', value: 1 },
        ],
      }),
    ).rejects.toThrow(/modes changed/);
    expect(fixture.createVariable).not.toHaveBeenCalled();
  });
  it('verifies cleanup of only the newly created variable on host failure or ignored initialization', async () => {
    for (const options of [{ failSet: true }, { silentSet: true }]) {
      const fixture = initializedFixture(options);
      await expect(
        createCreateVariableHandler(fixture.f)({
          ...request,
          initialValues: [
            { modeId: 'M:light', value: 0 },
            { modeId: 'M:dark', value: 1 },
          ],
        }),
      ).rejects.toThrow(/removal verified/);
      expect(fixture.variable.remove).toHaveBeenCalledOnce();
      expect(fixture.other.remove).not.toHaveBeenCalled();
    }
  });
  it('reports a partial effect if removal cannot be verified', async () => {
    const fixture = initializedFixture({ failSet: true, failRemove: true });
    await expect(
      createCreateVariableHandler(fixture.f)({
        ...request,
        initialValues: [
          { modeId: 'M:light', value: 0 },
          { modeId: 'M:dark', value: 1 },
        ],
      }),
    ).rejects.toThrow(/partial effect requires reconciliation/);
  });
  it('creates a variable in the resolved collection', async () => {
    const collection = { id: 'VC:0' };
    const createVariable = vi.fn<(name: string) => { id: string; name: string }>(
      (name: string) => ({
        id: 'V:0',
        name,
      }),
    );
    const f = {
      variables: {
        getVariableCollectionByIdAsync: async () => collection,
        createVariable,
      },
    } as unknown as typeof figma;
    const handler = createCreateVariableHandler(f);
    const result = (await handler({
      name: 'color/primary',
      collectionId: 'VC:0',
      resolvedType: 'COLOR',
    })) as VariableResult;

    expect(createVariable).toHaveBeenCalledWith('color/primary', collection, 'COLOR');
    expect(result).toEqual({ ok: true, variableId: 'V:0', name: 'color/primary' });
  });

  // plugin-typings 1.133 widened VariableResolvedDataType with EASING/TIMING, but Figma's own
  // createVariable still refuses them ("not currently available"), so they stay out of the allowlist
  // and are rejected here rather than sent on to fail. Delete this test when Figma opens creation up.
  it('rejects the motion resolvedTypes Figma cannot create yet', async () => {
    for (const resolvedType of ['EASING', 'TIMING']) {
      const createVariable = vi.fn<() => unknown>();
      const f = {
        variables: {
          getVariableCollectionByIdAsync: async () => ({ id: 'VC:0' }),
          createVariable,
        },
      } as unknown as typeof figma;
      // eslint-disable-next-line no-await-in-loop -- two fixed cases, sequential is fine
      await expect(
        createCreateVariableHandler(f)({
          name: 'motion/enter',
          collectionId: 'VC:0',
          resolvedType,
        }),
      ).rejects.toThrow(/resolvedType/);
      expect(createVariable).not.toHaveBeenCalled();
    }
  });

  it('throws on bad resolvedType, missing collection, or bad input', async () => {
    await expect(
      createCreateVariableHandler(withCollection({ id: 'VC:0' }))({
        name: 'x',
        collectionId: 'VC:0',
        resolvedType: 'NOPE',
      }),
    ).rejects.toThrow(/resolvedType/);
    await expect(
      createCreateVariableHandler(withCollection(null))({
        name: 'x',
        collectionId: 'VC:9',
        resolvedType: 'COLOR',
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      createCreateVariableHandler(withCollection(null))({ collectionId: 'VC:0' }),
    ).rejects.toThrow(/name/);
  });
});
