import { canonicalFileIdentityHash, type ControlStatusV1 } from '@sfp/shared';
import { z } from 'zod';

import type { ControlClient } from './control-client.js';
import type { FigmaTarget } from './figma-url.js';

export const assertDesktopTarget = (
  status: ControlStatusV1,
  target: Readonly<FigmaTarget>,
): string => {
  if (status.pairedPluginCount !== 1) throw new Error('DESKTOP_TARGET_AMBIGUOUS');
  const plugin = status.activePlugin;
  if (plugin === null) throw new Error('PLUGIN_NOT_CONNECTED');
  const observedHash =
    plugin.fileIdentityKind === 'figma-file-key'
      ? plugin.fileIdentityHash
      : plugin.bindingVerifiedBy === 'owner-session-confirmation' &&
          plugin.fileIdentityHash !== undefined
        ? plugin.bindingFileKeyHash
        : plugin.fileIdentityKind === 'document-plugin-uuid' &&
            plugin.bindingVerifiedBy === 'owner-confirmation' &&
            plugin.fileIdentityHash !== undefined
          ? plugin.bindingFileKeyHash
          : undefined;
  if (observedHash === undefined)
    throw new Error(
      'DESKTOP_FILE_IDENTITY_UNVERIFIED: bind this document to its URL before capturing',
    );
  if (observedHash !== canonicalFileIdentityHash({ kind: 'figma-file-key', value: target.fileKey }))
    throw new Error('DESKTOP_FILE_MISMATCH');
  return plugin.sessionId;
};

const MetadataSchema = z
  .object({
    currentPage: z.object({ id: z.string(), name: z.string() }),
    pages: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  })
  .passthrough();

/** All calls use the same admitted plugin session. No selection is required for a page read. */
export const readDesktopDesign = async (
  client: Pick<ControlClient, 'readTool'>,
  sessionId: string,
  workspaceId: string | null,
  rootDir?: string,
  nodeId?: string | null,
) => {
  const metadata = MetadataSchema.parse(await client.readTool('get_metadata', {}, sessionId));
  const selection = await client.readTool('get_selection', {}, sessionId);
  const page =
    nodeId === undefined || nodeId === null
      ? metadata.currentPage
      : metadata.pages.find(item => item.id === nodeId);
  let document: unknown;
  if (nodeId === undefined || nodeId === null || nodeId === metadata.currentPage.id) {
    document = await client.readTool('get_document', {}, sessionId);
    if (z.object({ pageId: z.string() }).parse(document).pageId !== metadata.currentPage.id)
      throw new Error('DESKTOP_PAGE_CHANGED');
  } else if (page !== undefined) {
    document = await client.readTool('get_design_context', { nodeId, detail: 'full' }, sessionId);
  } else {
    document = await client.readTool('get_node', { nodeId }, sessionId);
    const result = z.object({ node: z.object({ id: z.string() }).nullable() }).parse(document);
    if (result.node?.id !== nodeId) throw new Error('DESKTOP_NODE_NOT_FOUND');
  }
  const styles = await client.readTool('get_styles', {}, sessionId);
  const variables = await client.readTool('get_variable_defs', {}, sessionId);
  const project =
    rootDir === undefined || workspaceId === null
      ? null
      : {
          profile: await client.readTool('analyze_project', { rootDir }, sessionId, workspaceId),
          components: await client.readTool('scan_components', { rootDir }, sessionId, workspaceId),
          componentMap: await client.readTool(
            'component_map',
            { rootDir, nodeId: nodeId ?? metadata.currentPage.id },
            sessionId,
            workspaceId,
          ),
          tokenMap: await client.readTool('token_map', { rootDir }, sessionId, workspaceId),
          iconMap: await client.readTool(
            'icon_map',
            { rootDir, nodeId: nodeId ?? metadata.currentPage.id },
            sessionId,
            workspaceId,
          ),
        };
  const after = MetadataSchema.parse(await client.readTool('get_metadata', {}, sessionId));
  if (after.currentPage.id !== metadata.currentPage.id) throw new Error('DESKTOP_PAGE_CHANGED');
  return {
    metadata,
    selection,
    document,
    styles,
    variables,
    project,
    scope: {
      nodeId: nodeId ?? metadata.currentPage.id,
      pageId: page?.id ?? null,
      pageName: page?.name ?? null,
    },
  };
};
