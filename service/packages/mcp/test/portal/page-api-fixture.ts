import { createContext, runInContext } from 'node:vm';

import pngModule from '@pdf-lib/upng';
import type { Page } from 'playwright';
import { vi } from 'vitest';

import * as browserSession from '../../../cli/src/browser-session.js';
import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { ExistingChromeDesignCapture } from '../../src/portal/design-capture.js';
import type { portalFixture } from './fixtures.js';

const url = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1';
/** Controlled page-global API executes the exact service reader; there is no plugin frame. */
export function pageApiCaptureFixture(f: Awaited<ReturnType<typeof portalFixture>>) {
  const png =
    'encode' in pngModule
      ? pngModule
      : (pngModule as unknown as { default: typeof pngModule }).default;
  const bytes = Buffer.from(png.encode([new Uint8Array([255, 255, 255, 255]).buffer], 1, 1, 0));
  const node: Record<string, any> = {
    id: '1:1',
    name: 'Page source',
    type: 'FRAME',
    width: 1,
    height: 1,
    boundVariables: {},
    reactions: [],
    exportAsync: async () => bytes,
  };
  const currentPage = { id: '0:1', name: 'Page', type: 'PAGE', children: [node], selection: [] };
  node.parent = currentPage;
  let reads = 0;
  const figma = {
    fileKey: '4IBhv1d8hEclifZQrOYxHS',
    root: { name: 'Fixture' },
    currentPage,
    getNodeByIdAsync: async (id: string) => {
      reads++;
      return id === currentPage.id ? currentPage : id === node.id ? node : null;
    },
    variables: {
      getLocalVariablesAsync: async () => [],
      getLocalVariableCollectionsAsync: async () => [],
    },
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
    base64Encode: (value: Uint8Array) => Buffer.from(value).toString('base64'),
    getImageByHash: () => null,
  };
  const context = createContext({ figma });
  const invoke = (fn: Function | string, args: unknown[]) =>
    runInContext(`(${fn.toString()})`, context)(...args);
  const frames = vi.fn<() => never>(() => {
    throw Error('SCRIPTER_MUST_NOT_RUN');
  });
  const page = {
    url: () => url,
    frames,
    evaluateHandle: async (fn: Function, args: unknown) => {
      const value = await invoke(fn, [args]);
      return {
        evaluate: async (callback: Function) => invoke(callback, [value]),
        dispose: async () => {},
      };
    },
  } as unknown as Page;
  const open = vi
    .spyOn(browserSession.ExistingChromeConnection.prototype, 'open')
    .mockImplementation(async input => {
      if (!input.url) throw Error('FIXTURE_TARGET_REQUIRED');
      return { target: parseFigmaTarget(input.url), page, close: async () => {} } as Awaited<
        ReturnType<browserSession.ExistingChromeConnection['open']>
      >;
    });
  vi.spyOn(browserSession, 'observeFigmaPage').mockResolvedValue({ status: 'ready' } as Awaited<
    ReturnType<typeof browserSession.observeFigmaPage>
  >);
  const capture = new ExistingChromeDesignCapture(f.stateRoot, f.permissions, f.store);
  return {
    capture,
    node,
    bytes,
    url,
    figma,
    reads: () => reads,
    scripterCalls: () => frames.mock.calls.length,
    opens: () => open.mock.calls.length,
  };
}
