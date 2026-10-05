import { describe, expect, it, vi } from 'vitest';

import { createSandboxCancellation } from '../../src/cancellation.js';
import { dispatchSandboxMessage } from '../../src/dispatcher.js';
import { createCloneNodeHandler } from '../../src/handlers/clone-node.js';
import { createCreateTextHandler } from '../../src/handlers/create-text.js';
import { createDeletePageHandler } from '../../src/handlers/delete-page.js';
import { createDetachInstanceHandler } from '../../src/handlers/detach-instance.js';
import { placeNode } from '../../src/handlers/place.js';
import { createRenameNodeHandler } from '../../src/handlers/rename-node.js';
import { createRenamePageHandler } from '../../src/handlers/rename-page.js';
import { createSetBlendModeHandler } from '../../src/handlers/set-blend-mode.js';
import { createSetInstancePropertiesHandler } from '../../src/handlers/set-instance-properties.js';
import { createSetMaskHandler } from '../../src/handlers/set-mask.js';
import { createSetOpacityHandler } from '../../src/handlers/set-opacity.js';
import { createSetPositionHandler } from '../../src/handlers/set-position.js';
import { createSetTextHandler } from '../../src/handlers/set-text.js';
import { createSetVisibleHandler } from '../../src/handlers/set-visible.js';
import { createToolBridge } from '../../ui/sandbox/tool-bridge.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('dispatched sandbox mutation cancellation', () => {
  it.each([
    ['rename-node', createRenameNodeHandler, { name: 'After' }],
    ['rename-page', createRenamePageHandler, { name: 'After' }],
    ['set-opacity', createSetOpacityHandler, { opacity: 0.5 }],
    ['set-visible', createSetVisibleHandler, { visible: false }],
    ['set-mask', createSetMaskHandler, { isMask: true }],
    ['set-blend-mode', createSetBlendModeHandler, { blendMode: 'MULTIPLY' }],
    ['set-position', createSetPositionHandler, { x: 1, y: 2 }],
    [
      'set-instance-properties',
      createSetInstancePropertiesHandler,
      { properties: { Label: 'After' } },
    ],
    ['delete-page', createDeletePageHandler, {}],
    ['detach-instance', createDetachInstanceHandler, {}],
  ] as const)('prevents %s effects after a cancelled node lookup', async (name, factory, extra) => {
    const lookup = deferred<unknown>();
    const cancellation = createSandboxCancellation();
    const handler = factory({
      currentPage: { id: '0:1' },
      root: { children: [{}, {}] },
      getNodeByIdAsync: () => lookup.promise,
    } as unknown as typeof figma);
    const pending = handler(
      { nodeId: '1:1', pageId: '1:1', instanceId: '1:1', ...extra },
      { signal: cancellation.signal, report: () => {} },
    );
    const rejected = Promise.resolve(pending).catch((error: unknown) => error);
    cancellation.abort();
    const effect = vi.fn<() => void>();
    const node = new Proxy(
      {
        id: '1:1',
        type: name.includes('page') ? 'PAGE' : 'INSTANCE',
        name: 'Before',
        opacity: 1,
        visible: true,
        isMask: false,
        blendMode: 'NORMAL',
        x: 0,
        y: 0,
        parent: null,
        setProperties: effect,
        remove: effect,
        detachInstance: () => {
          effect();
          return { id: 'detached' };
        },
      },
      {
        set: (target, key, value) => {
          effect();
          return Reflect.set(target, key, value);
        },
      },
    );
    lookup.resolve(node);
    expect(await rejected).toMatchObject({ message: 'sandbox operation cancelled' });
    expect(effect).not.toHaveBeenCalled();
  });

  it('prevents text changes when cancellation arrives while fonts are loading', async () => {
    const font = deferred<void>();
    const entered = deferred<void>();
    const text = {
      id: '1:1',
      type: 'TEXT',
      characters: 'Before',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    const host = {
      getNodeByIdAsync: async () => text,
      loadFontAsync: () => {
        entered.resolve();
        return font.promise;
      },
    } as unknown as typeof figma;
    const cancellation = createSandboxCancellation();
    let execution!: Promise<unknown>;
    const bridge = createToolBridge({
      subscribe: () => () => {},
      postMessage: message => {
        if (message.kind === 'tool-cancel') cancellation.abort();
        if (message.kind === 'tool-call')
          execution = dispatchSandboxMessage({
            raw: message,
            editorType: 'figma',
            handlers: { set_text: createSetTextHandler(host) },
            execution: { signal: cancellation.signal, report: () => {} },
          });
      },
    });
    const binding = {
      requestId: 'request-text',
      operationId: 'operation-text',
      actionNonce: 'nonce-text',
    };
    const pending = bridge.handler('set_text', { nodeId: text.id, characters: 'After' }, binding);
    const rejected = Promise.resolve(pending).catch((error: unknown) => error);
    await entered.promise;
    bridge.cancel(binding);
    font.resolve();
    expect(await rejected).toMatchObject({ message: 'sandbox operation cancelled' });
    await execution;
    expect(text.characters).toBe('Before');
    bridge.dispose();
  });

  it('prevents cloning after a cancelled asynchronous lookup completes', async () => {
    const lookup = deferred<unknown>();
    const clone = vi.fn<() => { id: string; name: string; type: string }>(() => ({
      id: 'copy',
      name: 'Copy',
      type: 'RECTANGLE',
    }));
    const cancellation = createSandboxCancellation();
    const handler = createCloneNodeHandler({
      getNodeByIdAsync: () => lookup.promise,
    } as unknown as typeof figma);
    const pending = handler({ nodeId: '1:1' }, { signal: cancellation.signal, report: () => {} });
    const rejected = Promise.resolve(pending).catch((error: unknown) => error);
    cancellation.abort();
    lookup.resolve({ clone, parent: { appendChild: vi.fn<() => void>() } });
    expect(await rejected).toMatchObject({ message: 'sandbox operation cancelled' });
    expect(clone).not.toHaveBeenCalled();
  });

  it('reports an inner dispatched timeout as an uncertain outcome', async () => {
    const bridge = createToolBridge({
      timeoutMs: 5,
      postMessage: () => {},
      subscribe: () => () => {},
    });
    await expect(
      bridge.handler('set_text', { nodeId: '1:1', characters: 'After' }),
    ).rejects.toMatchObject({ code: 'PLUGIN_OUTCOME_UNKNOWN' });
    bridge.dispose();
  });

  it('preserves the partial creation marker but prevents further text writes after font cancellation', async () => {
    const font = deferred<void>();
    const text = {
      id: 'new',
      type: 'TEXT',
      name: 'Text',
      characters: '',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    const appendChild = vi.fn<() => void>();
    const markMutated = vi.fn<() => void>();
    const cancellation = createSandboxCancellation();
    const handler = createCreateTextHandler({
      createText: () => text,
      loadFontAsync: () => font.promise,
      currentPage: { appendChild },
    } as unknown as typeof figma);
    const pending = handler(
      { characters: 'After' },
      { signal: cancellation.signal, report: () => {}, markMutated },
    );
    const rejected = Promise.resolve(pending).catch((error: unknown) => error);
    cancellation.abort();
    font.resolve();
    expect(await rejected).toMatchObject({ message: 'sandbox operation cancelled' });
    expect(markMutated).toHaveBeenCalledOnce();
    expect(text.characters).toBe('');
    expect(appendChild).not.toHaveBeenCalled();
  });

  it('prevents appending an already-created node after cancellation during parent lookup', async () => {
    const lookup = deferred<unknown>();
    const appendChild = vi.fn<() => void>();
    const cancellation = createSandboxCancellation();
    const pending = placeNode(
      { getNodeByIdAsync: () => lookup.promise } as unknown as typeof figma,
      {} as SceneNode,
      'parent',
      'create_frame',
      { signal: cancellation.signal, report: () => {} },
    );
    const rejected = Promise.resolve(pending).catch((error: unknown) => error);
    cancellation.abort();
    lookup.resolve({ appendChild });
    expect(await rejected).toMatchObject({ message: 'sandbox operation cancelled' });
    expect(appendChild).not.toHaveBeenCalled();
  });
});
