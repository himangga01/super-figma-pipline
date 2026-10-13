import { z } from 'zod';

import {
  FigmaCaptureAssetQuerySchema,
  readFigmaCaptureAsset,
} from '../../shared/src/figma-capture-assets.js';
import { BrowserReadQuerySchema } from '../../shared/src/figma-capture-query.js';
import { readFigmaCapture } from '../../shared/src/figma-capture-read.js';
import { OfficialFigmaCaptureNodeIdSchema } from '../../shared/src/portal-capture-source.js';

export const OfficialCaptureTargetSchema = z
  .object({
    fileKey: z.string().regex(/^[A-Za-z0-9_-]{10,128}$/u),
    nodeId: OfficialFigmaCaptureNodeIdSchema,
  })
  .strict();
export const OfficialCaptureQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('identity') }).strict(),
  z.object({ kind: z.literal('read'), query: BrowserReadQuerySchema }).strict(),
  z.object({ kind: z.literal('asset'), query: FigmaCaptureAssetQuerySchema }).strict(),
]);
export type OfficialCaptureQuery = z.infer<typeof OfficialCaptureQuerySchema>;

/** Only compiled service readers and validated data become code. There is no caller JS input. */
export function officialCaptureProgram(
  targetInput: unknown,
  input: unknown,
  nonce: string,
): string {
  const target = OfficialCaptureTargetSchema.parse(targetInput);
  const operation = OfficialCaptureQuerySchema.parse(input);
  const requestNonce = z.string().uuid().parse(nonce);
  const expression =
    operation.kind === 'read'
      ? `JSON.parse(await (${readFigmaCapture.toString()})(${JSON.stringify(operation.query)}, figma, 'official-figma-mcp'))`
      : operation.kind === 'asset'
        ? `JSON.parse(await (${readFigmaCaptureAsset.toString()})(${JSON.stringify(operation.query)}, figma))`
        : `'ready'`;
  const queryNode =
    operation.kind === 'identity'
      ? target.nodeId
      : 'nodeId' in operation.query
        ? operation.query.nodeId
        : null;
  if (operation.kind === 'read' && queryNode === null) throw new Error('FIGMA_MCP_TARGET_REQUIRED');
  return `const target = ${JSON.stringify(target)};
const nonce = ${JSON.stringify(requestNonce)};
if (figma.editorType !== 'figma' || figma.fileKey !== target.fileKey)
  throw Error('FIGMA_MCP_FILE_IDENTITY_UNVERIFIED');
const scope = await figma.getNodeByIdAsync(target.nodeId);
if (!scope || scope.id !== target.nodeId) throw Error('FIGMA_MCP_SCOPE_MISMATCH');
let page = scope;
for (let depth = 0; page && page.type !== 'PAGE' && depth < 64; depth++) page = page.parent;
if (!page || page.type !== 'PAGE') throw Error('FIGMA_MCP_SCOPE_MISMATCH');
await figma.setCurrentPageAsync(page);
const queryNodeId = ${JSON.stringify(queryNode ?? null)};
if (queryNodeId !== null) {
  let node = await figma.getNodeByIdAsync(queryNodeId);
  for (let depth = 0; node && node.id !== scope.id && depth < 64; depth++) node = node.parent;
  if (!node || node.id !== scope.id) throw Error('FIGMA_MCP_SCOPE_MISMATCH');
}
const result = ${expression};
if (figma.fileKey !== target.fileKey || figma.currentPage.id !== page.id)
  throw Error('FIGMA_MCP_FILE_IDENTITY_UNVERIFIED');
return { protocol: 'sfp-official-capture-v1', nonce, fileKey: figma.fileKey,
  pageId: figma.currentPage.id, scopeNodeId: scope.id, result };`;
}
