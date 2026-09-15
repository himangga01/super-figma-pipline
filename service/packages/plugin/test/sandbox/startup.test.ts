import { afterEach, expect, it, vi } from 'vitest';

import { createToolCall } from '../../protocol/bridge.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('starts without browser globals and serves reads after the UI seeds identity', async () => {
  vi.stubGlobal('crypto', undefined);
  vi.stubGlobal('AbortController', undefined);
  vi.stubGlobal('__html__', '<html></html>');
  const postMessage = vi.fn<(message: unknown) => void>();
  const figmaStub = {
    showUI: vi.fn<(html: string, options: unknown) => void>(),
    on: vi.fn<(event: string, callback: () => void) => void>(),
    ui: { postMessage, onmessage: (_raw: unknown) => {} },
    clientStorage: { getAsync: async () => undefined },
    editorType: 'figma',
    mode: 'default',
    apiVersion: '1.0.0',
    root: { name: 'Free account design', getSharedPluginData: () => '' },
    currentPage: { id: 'page', name: 'Page', selection: [] },
  };
  vi.stubGlobal('figma', figmaStub);
  await import('../../src/code.js');
  expect(figmaStub.showUI).toHaveBeenCalledOnce();
  expect(postMessage).not.toHaveBeenCalled();
  figmaStub.ui.onmessage({
    tag: '@sfp/identity-seed',
    provisionalSessionId: 'a'.repeat(32),
    pluginGeneration: 'b'.repeat(32),
  });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      fileIdentity: {
        kind: 'unstable-readonly',
        sessionId: 'a'.repeat(32),
        pluginGeneration: 'b'.repeat(32),
      },
    }),
  );
  figmaStub.ui.onmessage({
    tag: '@sfp/identity-seed',
    provisionalSessionId: 'c'.repeat(32),
    pluginGeneration: 'd'.repeat(32),
  });
  expect(postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ pluginGeneration: 'b'.repeat(32) }),
  );
  figmaStub.ui.onmessage(
    createToolCall({
      id: 'read',
      method: 'get_selection',
      binding: { requestId: 'read', operationId: 'operation', actionNonce: 'nonce' },
    }),
  );
  await vi.waitFor(() =>
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool-result',
        result: { pageId: 'page', pageName: 'Page', nodes: [] },
      }),
    ),
  );
});
