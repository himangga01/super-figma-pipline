import { crc32, inflateRawSync, zstdDecompressSync } from 'node:zlib';

import {
  ByteBuffer,
  decodeBinarySchema,
  type Definition,
  type Field,
  type Schema,
} from 'kiwi-schema';

const MAX_EXPANDED = 256 * 1024 * 1024;
function invalid(code: string): never {
  throw new Error(code);
}

/** Read a bounded ZIP into memory; no archive path is ever used as a filesystem destination. */
export function readFigmaArchive(bytes: Buffer): Map<string, Buffer> {
  if (bytes.subarray(0, 8).toString() === 'fig-kiwi') return new Map([['canvas.fig', bytes]]);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, bytes.length - 65_557)) invalid('FIGMA_ARCHIVE_DIRECTORY_MISSING');
  const count = bytes.readUInt16LE(end + 10),
    directorySize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16),
    expanded = 0;
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    count === 65535 ||
    bytes.readUInt16LE(end + 8) !== count ||
    cursor + directorySize !== end ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length
  )
    invalid('FIGMA_ARCHIVE_FORMAT_UNSUPPORTED');
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      invalid('FIGMA_ARCHIVE_DIRECTORY_INVALID');
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16),
      compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24),
      nameSize = bytes.readUInt16LE(cursor + 28);
    const extraSize = bytes.readUInt16LE(cursor + 30),
      commentSize = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42),
      next = cursor + 46 + nameSize + extraSize + commentSize;
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > MAX_EXPANDED ||
      (expanded += size) > MAX_EXPANDED
    )
      invalid('FIGMA_ARCHIVE_LIMIT_OR_ENCODING');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameSize),
    );
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.includes('\0') ||
      name.includes(':') ||
      name.split('/').some(part => part === '..' || part === '.') ||
      files.has(name)
    )
      invalid('FIGMA_ARCHIVE_PATH_INVALID');
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
      invalid('FIGMA_ARCHIVE_ENTRY_INVALID');
    const localNameSize = bytes.readUInt16LE(local + 26),
      localExtraSize = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameSize + localExtraSize;
    if (
      start + compressedSize > bytes.readUInt32LE(end + 16) ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt16LE(local + 6) !== flags ||
      !bytes
        .subarray(local + 30, local + 30 + localNameSize)
        .equals(bytes.subarray(cursor + 46, cursor + 46 + nameSize))
    )
      invalid('FIGMA_ARCHIVE_ENTRY_INVALID');
    const compressed = bytes.subarray(start, start + compressedSize);
    const data =
      method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
    if (data.length !== size || crc32(data) !== checksum)
      invalid('FIGMA_ARCHIVE_CHECKSUM_MISMATCH');
    files.set(name, data);
    cursor = next;
  }
  if (cursor !== end || !files.has('canvas.fig')) invalid('FIGMA_ARCHIVE_CANVAS_MISSING');
  return files;
}

const decompress = (bytes: Buffer) =>
  bytes.length >= 4 && bytes.readUInt32LE(0) === 0xfd2fb528
    ? zstdDecompressSync(bytes, { maxOutputLength: MAX_EXPANDED })
    : inflateRawSync(bytes, { maxOutputLength: MAX_EXPANDED });

/** Interpret the embedded Kiwi schema as data; never compile document-supplied JavaScript. */
export function decodeFigmaMessage(schema: Schema, bytes: Uint8Array): Record<string, unknown> {
  if (schema.definitions.length > 10_000) invalid('FIGMA_SCHEMA_LIMIT');
  const definitions = new Map<string, Definition>();
  for (const definition of schema.definitions) {
    if (definitions.has(definition.name) || definition.fields.length > 10_000)
      invalid('FIGMA_SCHEMA_INVALID');
    definitions.set(definition.name, definition);
  }
  const bb = new ByteBuffer(bytes);
  let values = 0;
  const decode = (type: string, depth: number): unknown => {
    if (++values > 8_000_000 || depth > 256) invalid('FIGMA_MESSAGE_LIMIT');
    switch (type) {
      case 'bool':
        return !!bb.readByte();
      case 'byte':
        return bb.readByte();
      case 'int':
        return bb.readVarInt();
      case 'uint':
        return bb.readVarUint();
      case 'float':
        return bb.readVarFloat();
      case 'string':
        return bb.readString();
      case 'int64':
        return bb.readVarInt64().toString();
      case 'uint64':
        return bb.readVarUint64().toString();
    }
    const definition = definitions.get(type);
    if (!definition) return invalid('FIGMA_SCHEMA_TYPE_MISSING');
    if (definition.kind === 'ENUM') {
      const value = bb.readVarUint();
      return (
        definition.fields.find(field => field.value === value)?.name ?? { unknownEnum: type, value }
      );
    }
    const result: Record<string, unknown> = Object.create(null);
    const fieldValue = (field: Field) => {
      if (field.type === null) return invalid('FIGMA_SCHEMA_FIELD_INVALID');
      let value: unknown;
      if (field.isArray) {
        const count = bb.readVarUint();
        if (count > MAX_EXPANDED || (field.type !== 'byte' && count > 1_000_000))
          invalid('FIGMA_MESSAGE_ARRAY_LIMIT');
        if (field.type === 'byte') {
          const data = new Uint8Array(count);
          for (let i = 0; i < count; i++) data[i] = bb.readByte();
          value = data;
        } else value = Array.from({ length: count }, () => decode(field.type!, depth + 1));
      } else value = decode(field.type, depth + 1);
      if (!field.isDeprecated) result[field.name] = value;
    };
    if (definition.kind === 'STRUCT') definition.fields.forEach(fieldValue);
    else {
      const fields = new Map(definition.fields.map(field => [field.value, field]));
      if (fields.size !== definition.fields.length) invalid('FIGMA_SCHEMA_FIELD_INVALID');
      for (;;) {
        const id = bb.readVarUint();
        if (id === 0) break;
        const field = fields.get(id);
        if (!field || Object.hasOwn(result, field.name)) invalid('FIGMA_MESSAGE_FIELD_INVALID');
        fieldValue(field);
      }
    }
    return result;
  };
  return decode('Message', 0) as Record<string, unknown>;
}

export function decodeFigmaNativeDocument(bytes: Buffer) {
  if (bytes.length < 12 || bytes.length > 128 * 1024 * 1024) invalid('FIGMA_ARCHIVE_SIZE_INVALID');
  const files = readFigmaArchive(bytes),
    canvas = files.get('canvas.fig')!;
  if (canvas.length < 20 || canvas.subarray(0, 8).toString() !== 'fig-kiwi')
    invalid('FIGMA_CANVAS_FORMAT_UNSUPPORTED');
  const version = canvas.readUInt32LE(8),
    chunks: Buffer[] = [];
  let cursor = 12;
  while (cursor < canvas.length) {
    if (chunks.length >= 16 || cursor + 4 > canvas.length) invalid('FIGMA_CANVAS_CHUNK_INVALID');
    const length = canvas.readUInt32LE(cursor);
    cursor += 4;
    if (!length || cursor + length > canvas.length) invalid('FIGMA_CANVAS_CHUNK_INVALID');
    chunks.push(canvas.subarray(cursor, cursor + length));
    cursor += length;
  }
  if (chunks.length !== 2) invalid('FIGMA_CANVAS_CHUNKS_UNSUPPORTED');
  const schemaBytes = decompress(chunks[0]!);
  if (schemaBytes.length > 8 * 1024 * 1024) invalid('FIGMA_SCHEMA_LIMIT');
  const schema = decodeBinarySchema(schemaBytes);
  const message = decodeFigmaMessage(schema, decompress(chunks[1]!));
  return { version, schema, message, files };
}

export function nativeNodeId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const guid = value as Record<string, unknown>;
  return Number.isSafeInteger(guid.sessionID) && Number.isSafeInteger(guid.localID)
    ? `${guid.sessionID}:${guid.localID}`
    : null;
}

export function selectFigmaNativeNodes(message: Record<string, unknown>, nodeId: string | null) {
  if (!Array.isArray(message.nodeChanges)) invalid('FIGMA_NATIVE_NODES_MISSING');
  const nodes = new Map<string, Record<string, unknown>>();
  const children = new Map<string, Array<Record<string, unknown>>>();
  for (const input of message.nodeChanges) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      invalid('FIGMA_NATIVE_NODE_INVALID');
    const node = input as Record<string, unknown>,
      id = nativeNodeId(node.guid);
    if (!id || nodes.has(id)) invalid('FIGMA_NATIVE_NODE_INVALID');
    nodes.set(id, node);
    const parent = node.parentIndex as { guid?: unknown } | undefined;
    const parentId = nativeNodeId(parent?.guid);
    if (parentId) {
      const list = children.get(parentId) ?? [];
      list.push(node);
      children.set(parentId, list);
    }
  }
  const root = nodes.get(nodeId ?? '0:0');
  if (!root) invalid('FIGMA_NATIVE_SCOPE_NOT_FOUND');
  const selected: Record<string, unknown>[] = [],
    seen = new Set<string>();
  const visit = (node: Record<string, unknown>, depth: number) => {
    const id = nativeNodeId(node.guid)!;
    if (seen.has(id) || depth > 256) invalid('FIGMA_NATIVE_HIERARCHY_INVALID');
    seen.add(id);
    selected.push(node);
    const ordered = (children.get(id) ?? []).toSorted((a, b) => {
      const left = String((a.parentIndex as { position?: unknown }).position ?? '');
      const right = String((b.parentIndex as { position?: unknown }).position ?? '');
      return left < right ? -1 : left > right ? 1 : 0;
    });
    for (const child of ordered) visit(child, depth + 1);
  };
  visit(root, 0);
  return selected;
}
