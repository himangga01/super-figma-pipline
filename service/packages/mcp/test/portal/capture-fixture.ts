import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pngModule from '@pdf-lib/upng';
import { contentHash, storedChecksum } from '@sfp/ir';
import { canonicalFileIdentityHash } from '@sfp/shared';

import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { readDesignSnapshot } from '../../../cli/src/snapshot-reader.js';
import { FigmaCaptureReadResultSchema } from '../../../shared/src/figma-capture-query.js';
import { readFigmaCapture, type FigmaCaptureApi } from '../../../shared/src/figma-capture-read.js';
import { PortalCaptureGrantSchema } from '../../../shared/src/portal-capture-source.js';
import {
  CoherentDesignCapture,
  chromeCollectorProvenance,
  describePortalCapture,
  type PortalCapturedDesign,
} from '../../src/portal/design-capture.js';
import type { portalFixture } from './fixtures.js';
/**
 * Controlled test API, never a production bypass. Uses actual closed read, continuation, coherence
 * and fingerprints.
 */
export async function currentCaptureFixture(
  f: Awaited<ReturnType<typeof portalFixture>>,
  options: {
    nodes?: unknown[];
    tokens?: unknown[];
    collections?: unknown[];
    styles?: Partial<Record<'paints' | 'texts' | 'effects' | 'grids', unknown[]>> | undefined;
    url?: string;
    assets?: PortalCapturedDesign['assets'];
    assetRoot?: string;
    complete?: boolean;
  } = {},
) {
  const target = parseFigmaTarget(
    options.url ?? 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
  );
  const defaults = (value: unknown): Record<string, unknown> => {
    const node = value as Record<string, unknown>;
    return {
      name: 'Fixture',
      boundVariables: {},
      reactions: [],
      ...node,
      ...(Array.isArray(node.children) ? { children: node.children.map(defaults) } : {}),
    };
  };
  const nodes = (
    options.nodes ?? [{ id: '1:1', name: 'Welcome', type: 'FRAME', width: 100, height: 100 }]
  ).map(defaults);
  const page = {
    id: nodes.some(node => node.id === target.nodeId) ? '0:0' : (target.nodeId ?? '0:1'),
    name: 'Page',
    type: 'PAGE',
    selection: [],
    children: nodes,
  };
  const all = new Map<string, unknown>();
  const walk = (node: Record<string, unknown>) => {
    all.set(String(node.id), node);
    if (Array.isArray(node.children))
      node.children.forEach(child => walk(child as Record<string, unknown>));
  };
  nodes.forEach(walk);
  const figma = {
    root: { name: 'Fixture' },
    currentPage: page,
    getNodeByIdAsync: async (id: string) => all.get(id) ?? (id === page.id ? page : null),
    variables: {
      getLocalVariablesAsync: async () => options.tokens ?? [],
      getLocalVariableCollectionsAsync: async () => options.collections ?? [],
    },
    getLocalPaintStylesAsync: async () => options.styles?.paints ?? [],
    getLocalTextStylesAsync: async () => options.styles?.texts ?? [],
    getLocalEffectStylesAsync: async () => options.styles?.effects ?? [],
    getLocalGridStylesAsync: async () => options.styles?.grids ?? [],
  } as unknown as FigmaCaptureApi;
  const transport = {
    close: async () => {},
    open: async () => ({
      target,
      sessionId: 'test-page:' + randomUUID(),
      generation: 'test-attempt:' + randomUUID(),
      bindingMethod: 'file-key' as const,
      provenance: chromeCollectorProvenance,
      ready: async () => {},
      close: async () => {},
      read: (opts: { signal: AbortSignal; deadlineAt: number }) =>
        readDesignSnapshot(
          target,
          { nodeId: target.nodeId, depth: 40, maxNodes: 2000 },
          async query =>
            FigmaCaptureReadResultSchema.parse(JSON.parse(await readFigmaCapture(query, figma))),
          opts,
        ),
      assets: async (_nodes: unknown[], folder: string) => {
        if (options.assets) return options.assets;
        await mkdir(join(folder, 'assets'), { recursive: true });
        const png =
          'encode' in pngModule
            ? pngModule
            : (pngModule as unknown as { default: typeof pngModule }).default;
        const bytes = Buffer.from(
          png.encode([new Uint8Array([255, 255, 255, 255]).buffer], 1, 1, 0),
        );
        await writeFile(join(folder, 'assets/root.png'), bytes);
        return nodes.map(node => ({
          query: { kind: 'png' as const, nodeId: String(node.id) },
          status: 'captured' as const,
          path: 'assets/root.png',
          sha256: storedChecksum(bytes),
          bytes: bytes.length,
        }));
      },
    }),
  };
  const port = new CoherentDesignCapture(f.stateRoot, f.permissions, transport);
  const captured = await port.capture(
    'current-fixture-' + randomUUID(),
    target.url,
    new AbortController().signal,
  );
  await port.close();
  if (options.assetRoot) captured.assetRoot = options.assetRoot;
  const grant = PortalCaptureGrantSchema.parse({
    version: 1,
    kind: 'chrome',
    phase: 'requested-source',
    binding: 'selected-page-after-approved-connection',
    url: target.url,
    fileKeyHash: canonicalFileIdentityHash({ kind: 'figma-file-key', value: target.fileKey }),
    requestedNodeId: target.nodeId,
  });
  const descriptor = describePortalCapture(captured, { kind: 'chrome', url: target.url });
  if (options.complete === false) captured.complete = false;
  return {
    captured,
    grant,
    descriptor,
    receipt: {
      version: 2 as const,
      originalDescriptorHash: contentHash('sfp-portal-capture-descriptor-v2', descriptor),
      freshDesignFingerprint: descriptor.designFingerprint,
    },
  };
}
