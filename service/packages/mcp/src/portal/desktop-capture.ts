/* eslint-disable no-await-in-loop -- Each pinned read/export has a distinct parent-bound action and verified continuation. */
import { createHash } from 'node:crypto';

import type { RuntimeExecutionScope, ProgressReporter } from '@sfp/shared';

import { captureDesignAssets } from '../../../cli/src/capture-assets.js';
import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { readDesignSnapshot } from '../../../cli/src/snapshot-reader.js';
import {
  AssetReadResultSchema,
  ImageChunkResultSchema,
  FigmaCaptureAssetResultSchema,
  IMAGE_CHUNK_BYTES,
} from '../../../shared/src/figma-capture-assets.js';
import {
  BrowserReadQuerySchema,
  FigmaCaptureReadResultSchema,
} from '../../../shared/src/figma-capture-query.js';
import type { PortalCaptureGrant } from '../../../shared/src/portal-capture-source.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';
import type { PinnedPluginRuntimePort, RuntimeActionContext } from '../tools/runtime-registry.js';
import { CoherentDesignCapture, desktopCollectorProvenance } from './design-capture.js';
import { portalError, type PortalStore } from './store.js';
export interface DesktopCaptureRuntime {
  scope: RuntimeExecutionScope;
  plugin: PinnedPluginRuntimePort;
  action: Readonly<RuntimeActionContext>;
  reporter?: ProgressReporter;
  grant: Extract<PortalCaptureGrant, { kind: 'desktop' }>;
  revalidate(): Promise<void>;
}
/** Per-operation scope is retained; no localhost client, target reselection or handler dispatch. */
export function createDesktopDesignCapture(
  stateRoot: string,
  permissions: BoundStatePermissions,
  store: PortalStore,
  runtime: DesktopCaptureRuntime,
): CoherentDesignCapture {
  let sequence = 0;
  return new CoherentDesignCapture(
    stateRoot,
    permissions,
    {
      close: async () => {},
      open: async (url, signal) => {
        if (parseFigmaTarget(url).url !== runtime.grant.url)
          throw portalError('PORTAL_CAPTURE_SOURCE_MISMATCH');
        const ready = async () => {
          signal.throwIfAborted();
          await runtime.revalidate();
          signal.throwIfAborted();
        };
        await ready();
        const execute = async (
          name: 'portal_capture_read' | 'portal_capture_asset',
          args: unknown,
        ) => {
          await ready();
          const child = {
            operationId: runtime.action.operationId,
            actionNonce: createHash('sha256')
              .update(
                runtime.action.actionNonce +
                  ':portal-capture:' +
                  sequence++ +
                  ':' +
                  name +
                  ':' +
                  JSON.stringify(args),
              )
              .digest('base64url'),
          };
          const value = await runtime.plugin.execute(
            runtime.scope,
            name,
            args,
            signal,
            runtime.reporter,
            child,
          );
          await ready();
          return value;
        };
        const target = parseFigmaTarget(url);
        return {
          target,
          sessionId: runtime.grant.sessionId,
          generation: runtime.grant.pluginGeneration,
          bindingMethod: runtime.grant.bindingMethod,
          provenance: desktopCollectorProvenance,
          ready,
          close: async () => {},
          read: options =>
            readDesignSnapshot(
              target,
              { nodeId: target.nodeId, depth: 40, maxNodes: 2000 },
              async query => {
                const result = FigmaCaptureReadResultSchema.parse(
                  await execute('portal_capture_read', BrowserReadQuerySchema.parse(query)),
                );
                if (result.source !== 'figma-plugin-api-pinned')
                  throw portalError('PORTAL_CAPTURE_COLLECTOR_MISMATCH');
                return result;
              },
              options,
            ),
          assets: (nodes, folder, options) =>
            captureDesignAssets(
              nodes,
              folder,
              async query => {
                if (query.kind === 'image') {
                  const chunks: Buffer[] = [];
                  let offset = 0,
                    total: number | null = null;
                  do {
                    const wrapper = FigmaCaptureAssetResultSchema.parse(
                      await execute('portal_capture_asset', {
                        query: { kind: 'image-chunk', imageHash: query.imageHash, offset },
                      }),
                    );
                    const result = ImageChunkResultSchema.parse(wrapper.asset);
                    if (result.imageHash !== query.imageHash || result.offset !== offset)
                      throw portalError('ASSET_IDENTITY_MISMATCH');
                    total ??= result.totalBytes;
                    if (total !== result.totalBytes) throw portalError('ASSET_CAPTURE_CHANGED');
                    const bytes = Buffer.from(result.base64, 'base64');
                    if (
                      bytes.length !== Math.min(IMAGE_CHUNK_BYTES, total - offset) ||
                      bytes.toString('base64') !== result.base64
                    )
                      throw portalError('ASSET_ENCODING_INVALID');
                    chunks.push(bytes);
                    offset += bytes.length;
                  } while (offset < total);
                  return Buffer.concat(chunks, total);
                }
                const wrapper = FigmaCaptureAssetResultSchema.parse(
                  await execute('portal_capture_asset', { query }),
                );
                const result = AssetReadResultSchema.parse(wrapper.asset);
                if (JSON.stringify(result.query) !== JSON.stringify(query))
                  throw portalError('ASSET_IDENTITY_MISMATCH');
                const bytes = Buffer.from(result.base64, 'base64');
                if (
                  bytes.length !== result.byteLength ||
                  bytes.toString('base64') !== result.base64
                )
                  throw portalError('ASSET_ENCODING_INVALID');
                return bytes;
              },
              options,
            ),
        };
      },
    },
    store,
  );
}
