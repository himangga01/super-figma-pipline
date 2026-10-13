type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const scale = (original: number, actual: number, precise: boolean) =>
  original === 0
    ? actual === 0
      ? 1
      : null
    : precise
      ? actual / original
      : Math.fround(actual / original);

/** Decode bounded, unstyled native vector loops when no cached fill path was exported. */
export function readNativeVectorGeometry(
  input: unknown,
  blobs: unknown,
  targetSize: unknown,
  mode: 'fill' | 'paths' = 'fill',
) {
  const pathsMode = mode === 'paths';
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
  const sx = scale(Number(normalized.x), Number(size.x), pathsMode),
    sy = scale(Number(normalized.y), Number(size.y), pathsMode);
  if (sx === null || sy === null || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  const point = (index: number, dx = 0, dy = 0) => {
    const vertex = vertices[index]!;
    const x = pathsMode ? (vertex.x + dx) * sx : Math.fround(Math.fround(vertex.x + dx) * sx),
      y = pathsMode ? (vertex.y + dy) * sy : Math.fround(Math.fround(vertex.y + dy) * sy);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('FIGMA_NATIVE_VECTOR_NETWORK_INVALID');
    return `${x} ${y}`;
  };
  const result: Array<{ windingRule: string; data: string }> = [];
  const used = new Set<number>();
  const coincident = (a: number, b: number) =>
    vertices[a]!.x === vertices[b]!.x && vertices[a]!.y === vertices[b]!.y;
  const step = (index: number, current: number) => {
    const segment = segments[index]!;
    const forward = segment.start === current;
    if (!forward && segment.end !== current) return null;
    const end = forward ? segment.end : segment.start;
    const tx1 = forward ? segment.tx1 : segment.tx2,
      ty1 = forward ? segment.ty1 : segment.ty2;
    const tx2 = forward ? segment.tx2 : segment.tx1,
      ty2 = forward ? segment.ty2 : segment.ty1;
    return {
      end,
      command:
        tx1 === 0 && ty1 === 0 && tx2 === 0 && ty2 === 0
          ? 'L' + point(end)
          : 'C' + point(current, tx1, ty1) + ' ' + point(end, tx2, ty2) + ' ' + point(end),
    };
  };
  for (const region of regions) {
    const paths: string[] = [];
    for (const loop of region.loops) {
      if (!loop.length) continue;
      const first = segments[loop[0]!]!,
        next = loop.length > 1 ? segments[loop[1]!] : undefined;
      let current = first.start;
      if (next && next.start !== first.end && next.end !== first.end) current = first.end;
      const initial = current;
      const commands = ['M' + point(current)];
      for (const index of loop) {
        const edge = step(index, current);
        if (!edge) return null;
        used.add(index);
        commands.push(edge.command);
        current = edge.end;
      }
      if (!pathsMode || coincident(current, initial)) commands.push('Z');
      paths.push(commands.join(' '));
    }
    if (paths.length)
      result.push({
        windingRule: region.winding === 0 ? 'EVENODD' : 'NONZERO',
        data: paths.join(' '),
      });
  }
  if (pathsMode) {
    // Segments outside a fill region remain stroke-only paths, including branching arrows.
    const adjacent = new Map<number, number[]>();
    segments.forEach((segment, index) => {
      if (used.has(index)) return;
      for (const vertex of new Set([segment.start, segment.end])) {
        const incident = adjacent.get(vertex) ?? [];
        incident.push(index);
        adjacent.set(vertex, incident);
      }
    });
    const unfilled: string[] = [];
    const trace = (initial: number, first: number) => {
      const commands = ['M' + point(initial)];
      let current = initial,
        index = first;
      while (!used.has(index)) {
        used.add(index);
        const next = step(index, current)!;
        commands.push(next.command);
        current = next.end;
        const incident = adjacent.get(current)!;
        if (incident.length !== 2) break;
        const pending = incident.find(candidate => !used.has(candidate));
        if (pending === undefined) break;
        index = pending;
      }
      if (coincident(current, initial)) commands.push('Z');
      unfilled.push(commands.join(' '));
    };
    for (const [vertex, incident] of [...adjacent].toSorted((a, b) => a[0] - b[0]))
      if (incident.length !== 2)
        for (const index of incident) if (!used.has(index)) trace(vertex, index);
    segments.forEach((segment, index) => {
      if (!used.has(index)) trace(segment.start, index);
    });
    if (unfilled.length) result.push({ windingRule: 'NONE', data: unfilled.join(' ') });
  }
  return result;
}
