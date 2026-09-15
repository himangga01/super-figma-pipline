import {
  BrowserReadQuerySchema,
  FigmaCaptureReadResultSchema,
} from '../../../shared/src/figma-capture-query.js';
import { readFigmaCapture, type FigmaCaptureApi } from '../../../shared/src/figma-capture-read.js';
import type { SandboxToolHandler } from '../dispatcher.js';
/** Fixed read APIs only. No caller-provided program is accepted. */
export const createPortalCaptureReadHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, context) => {
    context?.signal.throwIfAborted();
    const query = BrowserReadQuerySchema.parse(params);
    const result = await readFigmaCapture(
      query,
      figmaCtx as unknown as FigmaCaptureApi,
      'figma-plugin-api-pinned',
    );
    context?.signal.throwIfAborted();
    return FigmaCaptureReadResultSchema.parse(JSON.parse(result));
  };
