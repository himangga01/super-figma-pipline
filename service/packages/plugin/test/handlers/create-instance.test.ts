import type { CreateResult } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateInstanceHandler } from '../../src/handlers/create-instance.js';

const makeInstance = () => ({ id: 'I:1', name: 'Inst', type: 'INSTANCE', x: 0, y: 0 });

const fakeFigma = (over: Partial<Record<string, unknown>> = {}): typeof figma =>
  ({
    currentPage: { appendChild: vi.fn<(n: unknown) => void>() },
    getNodeByIdAsync: async (id: string) =>
      id === 'C:1'
        ? { id: 'C:1', type: 'COMPONENT', createInstance: () => makeInstance() }
        : (over[id] ?? null),
    importComponentByKeyAsync: async () => ({ createInstance: () => makeInstance() }),
    ...over,
  }) as unknown as typeof figma;

describe('create_instance handler', () => {
  it('instantiates a local component and places it', async () => {
    const appendChild = vi.fn<(n: unknown) => void>();
    const figmaCtx = fakeFigma({ currentPage: { appendChild } });
    const result = (await createCreateInstanceHandler(figmaCtx)({
      componentId: 'C:1',
      name: 'Card',
      x: 10,
      y: 20,
    })) as CreateResult;

    expect(result).toEqual({ ok: true, nodeId: 'I:1', name: 'Card', type: 'INSTANCE' });
    expect(appendChild).toHaveBeenCalled();
  });

  it('instantiates a published component by key', async () => {
    const importComponentByKeyAsync = vi.fn<
      (key: string) => Promise<{ createInstance: () => ReturnType<typeof makeInstance> }>
    >(async () => ({ createInstance: () => makeInstance() }));
    const result = (await createCreateInstanceHandler(fakeFigma({ importComponentByKeyAsync }))({
      componentKey: '  abc123  ',
    })) as CreateResult;
    expect(result).toMatchObject({ ok: true, type: 'INSTANCE' });
    expect(importComponentByKeyAsync).toHaveBeenCalledWith('abc123');
  });

  it('rejects a provided invalid componentKey before local fallback or library import', async () => {
    const importComponentByKeyAsync = vi.fn<(key: string) => Promise<unknown>>();
    const getNodeByIdAsync = vi.fn<(id: string) => Promise<unknown>>();
    const figmaCtx = fakeFigma({ importComponentByKeyAsync, getNodeByIdAsync });

    for (const componentKey of ['', '   ', 123]) {
      await expect(
        createCreateInstanceHandler(figmaCtx)({ componentId: 'C:1', componentKey }),
      ).rejects.toThrow(/componentKey.*nonempty string/i);
    }
    expect(importComponentByKeyAsync).not.toHaveBeenCalled();
    expect(getNodeByIdAsync).not.toHaveBeenCalled();
  });

  it('throws without componentId or componentKey, and when the component is missing', async () => {
    await expect(createCreateInstanceHandler(fakeFigma())({})).rejects.toThrow(
      /componentId or componentKey/,
    );
    await expect(createCreateInstanceHandler(fakeFigma())({ componentId: 'X:9' })).rejects.toThrow(
      /not found/,
    );
  });
});
