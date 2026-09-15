import { FigmaCaptureAssetArgsSchema } from '../../../shared/src/figma-capture-assets.js';
import { BrowserReadQuerySchema } from '../../../shared/src/figma-capture-query.js';
import type { RawToolSpec } from './spec.js';
export const portalCaptureReadTool: RawToolSpec = {
  name: 'portal_capture_read',
  description:
    'Read one bounded tree/catalog/reference query from the admitted Figma document. Continuations and missing APIs remain explicit.',
  inputSchema: BrowserReadQuerySchema,
  kind: 'read',
};
export const portalCaptureAssetTool: RawToolSpec = {
  name: 'portal_capture_asset',
  description:
    'Read a bounded immutable original image chunk or exact-scale node export from the admitted Figma document.',
  inputSchema: FigmaCaptureAssetArgsSchema,
  kind: 'read',
};
