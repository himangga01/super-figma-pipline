import type { CallToolResult } from '@modelcontextprotocol/server';
import { PortalNextResultSchema } from '@sfp/shared';

/** Present approved raster evidence as actual MCP images, not a large base64 text prompt. */
export const presentPortalNext = (input: unknown): CallToolResult => {
  const result = PortalNextResultSchema.parse(input);
  const images: CallToolResult['content'] = [];
  for (const asset of result.assets?.contents ?? []) {
    if (!asset.data) continue;
    const bytes = Buffer.from(asset.data, 'base64');
    const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216
        ? 'image/jpeg'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
          ? 'image/webp'
          : null;
    if (!mimeType) continue;
    images.push({ type: 'image', mimeType, data: asset.data });
    delete asset.data;
    asset.delivery = 'inline-image';
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }, ...images] };
};
