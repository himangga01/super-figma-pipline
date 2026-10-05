type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const scale = (original: number, actual: number) =>
  original === 0 ? (actual === 0 ? 1 : null) : Math.fround(actual / original);

/** Decode bounded, unstyled native vector loops when no cached fill path was exported. */
export function readNativeVectorGeometry(input: unknown, blobs: unknown, targetSize: unknown) {
  const vector = object(input),
    normalized = object(vector.normalizedSize),
    size = object(targetSize);
  if (vector.vectorNetworkBlob === undefined) return null;
  if (!Number.isSafeInteger(vector.vectorNetworkBlob) || !Array.isArray(blobs))
    throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_MISSING');
  const bytes = object(blobs[Number(vector.vectorNetworkBlob)]).bytes;
  if (!(bytes instanceof Uint8Array)) throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_MISSING');
  if (bytes.length < 12 || bytes.length > 16_777_216)
    throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_LIMIT');
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  const take = (floating = false) => {
    if (cursor + 4 > buffer.length) throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_TRUNCATED');
    const value = floating ? buffer.readFloatLE(cursor) : buffer.readUInt32LE(cursor);
    cursor += 4;
    if (!Number.isFinite(value)) throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_INVALID');
    return value;
  };
  const vertexCount = take(),
    segmentCount = take(),
    regionCount = take();
  if (
    vertexCount > 100000 ||
    segmentCount > 100000 ||
    regionCount > 10000 ||
    12 + vertexCount * 12 + segmentCount * 28 + regionCount * 8 > buffer.length
  )
    throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_LIMIT');
  let unsupported = false;
  const vertices = Array.from({ length: vertexCount }, () => {
    const style = take(),
      x = take(true),
      y = take(true);
    unsupported ||= style !== 0;
    return { x, y };
  });
  const segments = Array.from({ length: segmentCount }, () => {
    const style = take(),
      start = take(),
      tx1 = take(true),
      ty1 = take(true),
      end = take(),
      tx2 = take(true),
      ty2 = take(true);
    unsupported ||= style !== 0;
    if (start >= vertexCount || end >= vertexCount)
      throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_INVALID');
    return { start, end, tx1, ty1, tx2, ty2 };
  });
  let edgeCount = 0,
    totalLoops = 0;
  const regions = Array.from({ length: regionCount }, () => {
    const winding = take(),
      loopCount = take();
    totalLoops += loopCount;
    if (totalLoops > 10000) throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_LIMIT');
    unsupported ||= winding !== 0 && winding !== 1;
    const loops = Array.from({ length: loopCount }, () => {
      const count = take();
      edgeCount += count;
      if (edgeCount > 100000 || cursor + count * 4 > buffer.length)
        throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_LIMIT');
      return Array.from({ length: count }, () => {
        const index = take();
        if (index >= segmentCount) throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_INVALID');
        return index;
      });
    });
    return { winding, loops };
  });
  if (cursor !== buffer.length) throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_TRAILING_DATA');
  if (
    unsupported ||
    ![normalized.x, normalized.y, size.x, size.y].every(
      value => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    )
  )
    return null;
  const sx = scale(Number(normalized.x), Number(size.x)),
    sy = scale(Number(normalized.y), Number(size.y));
  if (sx === null || sy === null || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  const point = (index: number, dx = 0, dy = 0) => {
    const vertex = vertices[index]!;
    const x = Math.fround(Math.fround(vertex.x + dx) * sx),
      y = Math.fround(Math.fround(vertex.y + dy) * sy);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_INVALID');
    return `${x} ${y}`;
  };
  const result: Array<{ windingRule: string; data: string }> = [];
  for (const region of regions) {
    const paths: string[] = [];
    for (const loop of region.loops) {
      if (!loop.length) continue;
      const first = segments[loop[0]!]!,
        next = loop.length > 1 ? segments[loop[1]!] : undefined;
      let current = first.start;
      if (next && next.start !== first.end && next.end !== first.end) current = first.end;
      const commands = ['M' + point(current)];
      for (const index of loop) {
        const segment = segments[index]!;
        const forward = segment.start === current;
        if (!forward && segment.end !== current) return null;
        const end = forward ? segment.end : segment.start;
        const tx1 = forward ? segment.tx1 : segment.tx2,
          ty1 = forward ? segment.ty1 : segment.ty2;
        const tx2 = forward ? segment.tx2 : segment.tx1,
          ty2 = forward ? segment.ty2 : segment.ty1;
        commands.push(
          tx1 === 0 && ty1 === 0 && tx2 === 0 && ty2 === 0
            ? 'L' + point(end)
            : 'C' + point(current, tx1, ty1) + ' ' + point(end, tx2, ty2) + ' ' + point(end),
        );
        current = end;
      }
      commands.push('Z');
      paths.push(commands.join(' '));
    }
    if (paths.length)
      result.push({
        windingRule: region.winding === 0 ? 'EVENODD' : 'NONZERO',
        data: paths.join(' '),
      });
  }
  return result;
}
