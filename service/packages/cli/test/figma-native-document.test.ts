import { crc32, deflateRawSync, zstdCompressSync } from 'node:zlib';

import { compileSchema, encodeBinarySchema, parseSchema } from 'kiwi-schema';
import { expect, it } from 'vitest';

import { decodeFigmaNativeDocument, decodeFigmaMessage } from '../src/figma-native-document.js';

const schema = parseSchema(`
  struct Id { uint sessionID; uint localID; }
  message Node { Id guid = 1; string name = 2; bool locked = 3; byte[] payload = 4; uint64 stamp = 5; float size = 6; }
  message Message { Node[] nodeChanges = 1; }
`);
const fixture = (zstd = false) => {
  // Only a constant test schema is compiled; production interprets schemas without eval.
  const codec = compileSchema(schema) as { encodeMessage(input: unknown): Uint8Array };
  const message = codec.encodeMessage({
    nodeChanges: [
      {
        guid: { sessionID: 1, localID: 2 },
        name: 'Unicode \u2028\ufeff',
        locked: true,
        payload: new Uint8Array([0, 255]),
        stamp: 18446744073709551615n,
        size: 12.5,
      },
    ],
  });
  const chunks = [
    deflateRawSync(encodeBinarySchema(schema)),
    zstd ? zstdCompressSync(message) : deflateRawSync(message),
  ];
  const header = Buffer.alloc(12);
  header.write('fig-kiwi');
  header.writeUInt32LE(106, 8);
  return Buffer.concat([
    header,
    ...chunks.flatMap(chunk => {
      const size = Buffer.alloc(4);
      size.writeUInt32LE(chunk.length);
      return [size, chunk];
    }),
  ]);
};
const zip = (canvas: Buffer, name = 'canvas.fig') => {
  const filename = Buffer.from(name),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(crc32(canvas), 14);
  local.writeUInt32LE(canvas.length, 18);
  local.writeUInt32LE(canvas.length, 22);
  local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(crc32(canvas), 16);
  central.writeUInt32LE(canvas.length, 20);
  central.writeUInt32LE(canvas.length, 24);
  central.writeUInt16LE(filename.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + canvas.length, 16);
  return Buffer.concat([local, filename, canvas, central, filename, end]);
};

it.each([false, true])(
  'decodes native schema data with zstd=%s without dropping Unicode, bytes or uint64 precision',
  zstd => {
    const decoded = decodeFigmaNativeDocument(zip(fixture(zstd)));
    expect(decoded.version).toBe(106);
    expect(decoded.message.nodeChanges).toEqual([
      {
        guid: { sessionID: 1, localID: 2 },
        name: 'Unicode \u2028\ufeff',
        locked: true,
        payload: new Uint8Array([0, 255]),
        stamp: '18446744073709551615',
        size: 12.5,
      },
    ]);
  },
);

it('rejects corrupt ZIP content, traversal names and truncated binary records', () => {
  const corrupted = zip(fixture());
  corrupted[50] = corrupted[50]! ^ 1;
  expect(() => decodeFigmaNativeDocument(corrupted)).toThrow('FIGMA_ARCHIVE_CHECKSUM_MISMATCH');
  expect(() => decodeFigmaNativeDocument(zip(fixture(), '../canvas.fig'))).toThrow(
    'FIGMA_ARCHIVE_PATH_INVALID',
  );
  expect(() => decodeFigmaNativeDocument(fixture().subarray(0, 20))).toThrow(
    'FIGMA_CANVAS_CHUNK_INVALID',
  );
  expect(() => decodeFigmaMessage(schema, new Uint8Array([99, 0]))).toThrow(
    'FIGMA_MESSAGE_FIELD_INVALID',
  );
});
