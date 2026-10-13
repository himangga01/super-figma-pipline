/* eslint-disable no-await-in-loop -- Ordered image chunks and source observations bind each export. */
import { randomUUID } from 'node:crypto';

import { captureDesignAssets } from '../../../cli/src/capture-assets.js';
import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { readDesignSnapshot } from '../../../cli/src/snapshot-reader.js';
import {
  AssetReadResultSchema,
  IMAGE_CHUNK_BYTES,
  ImageChunkResultSchema,
} from '../../../shared/src/figma-capture-assets.js';
import { FigmaCaptureReadResultSchema } from '../../../shared/src/figma-capture-query.js';
import type { PortalCaptureGrant } from '../../../shared/src/portal-capture-source.js';
import {
  openOfficialFigmaCapture,
  type OfficialFigmaConnectionOptions,
} from '../official-figma-mcp.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';
import { CoherentDesignCapture, officialMcpCollectorProvenance } from './design-capture.js';
import { portalError, type PortalStore } from './store.js';

/** Official transport uses its own reads and exports; Chrome observations never enter this path. */
export function createOfficialMcpDesignCapture(
  stateRoot: string,
  permissions: BoundStatePermissions,
  store: PortalStore,
  grant: Extract<PortalCaptureGrant, { kind: 'official-mcp' }>,
  connection: OfficialFigmaConnectionOptions = {},
): CoherentDesignCapture {
  return new CoherentDesignCapture(
    stateRoot,
    permissions,
    {
      close: async () => {},
      open: async (url, signal, deadlineAt = Date.now() + 300_000) => {
        const target = parseFigmaTarget(url);
        if (target.url !== grant.url || !target.nodeId)
          throw portalError('PORTAL_CAPTURE_SOURCE_MISMATCH');
        const session = await openOfficialFigmaCapture(
          { endpoint: grant.endpoint, target: { fileKey: target.fileKey, nodeId: target.nodeId } },
          {
            ...connection,
            signal: AbortSignal.any([signal, ...(connection.signal ? [connection.signal] : [])]),
            deadlineAt: Math.min(deadlineAt, connection.deadlineAt ?? deadlineAt),
          },
        );
        return {
          target,
          sessionId: session.sessionId,
          generation: 'official-mcp-attempt:' + randomUUID(),
          bindingMethod: 'file-key',
          provenance: { ...officialMcpCollectorProvenance, endpoint: grant.endpoint },
          ready: async () => {
            await session.execute({ kind: 'identity' });
          },
          close: session.close,
          read: async options => {
            session.assertActive(options);
            const snapshot = await readDesignSnapshot(
              target,
              { nodeId: target.nodeId, depth: 40, maxNodes: 2000 },
              async query => {
                const result = FigmaCaptureReadResultSchema.parse(
                  await session.execute({ kind: 'read', query }, options),
                );
                if (result.source !== 'official-figma-mcp')
                  throw portalError('PORTAL_CAPTURE_COLLECTOR_MISMATCH');
                return result;
              },
              options,
            );
            session.assertActive(options);
            return snapshot;
          },
          assets: async (nodes, folder, options) => {
            session.assertActive(options);
            const assets = await captureDesignAssets(
              nodes,
              folder,
              async query => {
                if (query.kind === 'image') {
                  const chunks: Buffer[] = [];
                  let offset = 0,
                    total: number | null = null;
                  do {
                    const result = ImageChunkResultSchema.parse(
                      await session.execute(
                        {
                          kind: 'asset',
                          query: { kind: 'image-chunk', imageHash: query.imageHash, offset },
                        },
                        options,
                      ),
                    );
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
                  session.assertActive(options);
                  return Buffer.concat(chunks, total);
                }
                const result = AssetReadResultSchema.parse(
                  await session.execute({ kind: 'asset', query }, options),
                );
                if (JSON.stringify(result.query) !== JSON.stringify(query))
                  throw portalError('ASSET_IDENTITY_MISMATCH');
                const bytes = Buffer.from(result.base64, 'base64');
                if (
                  bytes.length !== result.byteLength ||
                  bytes.toString('base64') !== result.base64
                )
                  throw portalError('ASSET_ENCODING_INVALID');
                session.assertActive(options);
                return bytes;
              },
              options,
            );
            session.assertActive(options);
            return assets;
          },
        };
      },
    },
    store,
  );
}
