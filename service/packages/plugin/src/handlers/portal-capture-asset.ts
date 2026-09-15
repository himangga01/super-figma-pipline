import {
  FigmaCaptureAssetArgsSchema,
  FigmaCaptureAssetResultSchema,
  readFigmaCaptureAsset,
} from '../../../shared/src/figma-capture-assets.js';
import type { SandboxToolHandler } from '../dispatcher.js';
export const createPortalCaptureAssetHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, context) => {
    context?.signal.throwIfAborted();
    const query = FigmaCaptureAssetArgsSchema.parse(params).query;
    const result = await readFigmaCaptureAsset(query, figmaCtx);
    context?.signal.throwIfAborted();
    return FigmaCaptureAssetResultSchema.parse({ asset: JSON.parse(result) });
  };
