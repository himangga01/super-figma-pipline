import { z } from 'zod';

import { BASE64_IMAGE_MAX_BYTES, DECODED_IMAGE_MAX_BYTES } from '../security/request-limits.js';
import { assertBase64Payload } from './binary-payload.js';
import type { RawToolSpec } from './spec.js';

export const IMPORT_IMAGE_TOOL_NAME = 'import_image';

const imageSourceSchema = z.string().trim().min(1);

const inputSchema = z
  .object({
    data: imageSourceSchema.optional().describe('Base64-encoded image bytes (PNG / JPG / GIF)'),
    url: imageSourceSchema.optional().describe('Image URL to fetch instead of data'),
    name: z.string().optional().describe('Optional name for the new rectangle'),
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional().describe('Override width (default: image width)'),
    height: z.number().optional().describe('Override height (default: image height)'),
    scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
  })
  .superRefine((value, context) => {
    if ((value.data === undefined) === (value.url === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'import_image requires exactly one nonempty data or url source',
      });
    }
  });

export const importImageTool: RawToolSpec = {
  name: IMPORT_IMAGE_TOOL_NAME,
  description:
    'Import a raster image (PNG / JPG / GIF) and place it as a rectangle with an IMAGE fill. Provide ' +
    'exactly one source: data (base64-encoded image bytes) or url. The rectangle defaults to the image size unless ' +
    'width/height are given. scaleMode is FILL / FIT / CROP / TILE (default FILL). For vector SVG ' +
    '(logos / icons) use import_svg instead. Returns { ok, nodeId, name, type }.',
  inputSchema,
  kind: 'write',
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/** Validate inline bytes before any plugin dispatch; URL handling remains the existing plugin path. */
export const handleImportImage = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<unknown> => {
  const args = inputSchema.parse(rawArgs);
  if (args.data !== undefined) {
    assertBase64Payload(args.data, {
      encodedMaxBytes: BASE64_IMAGE_MAX_BYTES,
      decodedMaxBytes: DECODED_IMAGE_MAX_BYTES,
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  return dispatch(IMPORT_IMAGE_TOOL_NAME, args);
};
