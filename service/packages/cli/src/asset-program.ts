import {
  AssetQuerySchema,
  ImageChunkQuerySchema,
  readFigmaCaptureAsset,
} from '../../shared/src/figma-capture-assets.js';
export {
  IMAGE_CHUNK_BYTES,
  AssetQuerySchema,
  AssetReadResultSchema,
  ImageChunkResultSchema,
} from '../../shared/src/figma-capture-assets.js';
export const createImageChunkReadProgram = (input: unknown): string => {
  const query = ImageChunkQuerySchema.parse(input);
  return (
    '(' +
    readFigmaCaptureAsset.toString() +
    ')(' +
    JSON.stringify({ kind: 'image-chunk', ...query }) +
    ', figma)'
  );
};
export const createAssetReadProgram = (input: unknown): string => {
  const query = AssetQuerySchema.parse(input);
  return `(async function () {
    const q = ${JSON.stringify(query)};
    let bytes;
    if(q.kind === 'image') {
      const image = figma.getImageByHash(q.imageHash);
      if(!image) throw Error('ASSET_NOT_FOUND');
      bytes = await image.getBytesAsync();
    } else {
      const node = await figma.getNodeByIdAsync(q.nodeId);
      if(!node || typeof node.exportAsync !== 'function') throw Error('ASSET_NOT_EXPORTABLE');
      bytes = await node.exportAsync(q.kind === 'svg' ? {format:'SVG'} : {format:'PNG',constraint:{type:'SCALE',value:1}});
    }
    if(bytes.length > 5000000) throw Error('ASSET_TOO_LARGE');
    return JSON.stringify({query:q,base64:figma.base64Encode(bytes),byteLength:bytes.length});
  })()`;
};
