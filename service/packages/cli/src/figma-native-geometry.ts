/** Figma native path opcodes carry little-endian float32 operands. */
export function decodeNativePath(bytes: Uint8Array): string {
  if (bytes.length > 16 * 1024 * 1024) throw new Error('FIGMA_NATIVE_PATH_LIMIT');
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const commands = ['Z', 'M', 'L', 'Q', 'C'],
    operands = [0, 2, 2, 4, 6];
  const paths: string[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const opcode = buffer[cursor++]!,
      count = operands[opcode];
    if (count === undefined) throw new Error('FIGMA_NATIVE_PATH_OPCODE_UNSUPPORTED');
    if (cursor + count * 4 > buffer.length) throw new Error('FIGMA_NATIVE_PATH_TRUNCATED');
    const values: number[] = [];
    for (let index = 0; index < count; index++) {
      const value = buffer.readFloatLE(cursor);
      cursor += 4;
      if (!Number.isFinite(value)) throw new Error('FIGMA_NATIVE_PATH_VALUE_INVALID');
      values.push(Number(value.toPrecision(6)));
    }
    paths.push(commands[opcode]! + values.join(' '));
  }
  return paths.join(' ');
}

export function readNativeGeometry(value: unknown, blobs: unknown) {
  if (!Array.isArray(value)) return [];
  if (!Array.isArray(blobs)) throw new Error('FIGMA_NATIVE_BLOBS_MISSING');
  return value.map(row => {
    const bytes = blobs[row.commandsBlob]?.bytes;
    if (!Number.isSafeInteger(row.commandsBlob) || !(bytes instanceof Uint8Array))
      throw new Error('FIGMA_NATIVE_GEOMETRY_MISSING');
    const windingRule = row.windingRule === 'ODD' ? 'EVENODD' : (row.windingRule ?? 'NONZERO');
    if (!['NONZERO', 'EVENODD'].includes(windingRule))
      throw new Error('FIGMA_NATIVE_WINDING_UNSUPPORTED');
    return { windingRule, data: decodeNativePath(bytes) };
  });
}

type Point = [number, number];
interface Edge {
  kind: string;
  from: Point;
  to: Point;
  controls: Point[];
}
const near = (left: number, right: number) =>
  Math.abs(left - right) <= Math.max(0.0001, Math.abs(right) * 0.000001);
const samePoint = (a: Point, b: Point) => near(a[0], b[0]) && near(a[1], b[1]);
const joinLines = (a: Edge, b: Edge) => {
  if (a.kind !== 'L' || b.kind !== 'L' || !samePoint(a.to, b.from)) return false;
  const x = a.to[0] - a.from[0],
    y = a.to[1] - a.from[1],
    u = b.to[0] - b.from[0],
    v = b.to[1] - b.from[1];
  return (
    Math.abs(x * v - y * u) <= Math.max(1e-8, Math.hypot(x, y) * Math.hypot(u, v) * 1e-6) &&
    x * u + y * v >= -1e-8
  );
};
const pathEdges = (text: string): Array<{ closed: boolean; edges: Edge[] }> | null => {
  const expression = /[MLQCZ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gu;
  if (text.replace(expression, '').replace(/[\s,]/gu, '') !== '') return null;
  const tokens = text.match(expression) ?? [],
    paths: Array<{ closed: boolean; edges: Edge[] }> = [];
  let cursor = 0,
    current: Point | null = null,
    start: Point | null = null,
    edges: Edge[] = [];
  const append = (edge: Edge) => {
    if (edge.kind === 'L' && samePoint(edge.from, edge.to)) return;
    const previous = edges[edges.length - 1];
    if (previous && joinLines(previous, edge)) previous.to = edge.to;
    else edges.push(edge);
  };
  const finish = (closed: boolean) => {
    if (closed && edges.length > 1 && joinLines(edges[edges.length - 1]!, edges[0]!)) {
      edges[0]!.from = edges[edges.length - 1]!.from;
      edges.pop();
    }
    if (edges.length) paths.push({ closed, edges });
    edges = [];
  };
  const point = (): Point => [Number(tokens[cursor++]), Number(tokens[cursor++])];
  while (cursor < tokens.length) {
    const kind = tokens[cursor++];
    if (kind === 'Z') {
      if (!current || !start) return null;
      append({ kind: 'L', from: current, to: start, controls: [] });
      finish(true);
      current = start = null;
      continue;
    }
    const count = kind === 'M' || kind === 'L' ? 1 : kind === 'Q' ? 2 : kind === 'C' ? 3 : 0;
    if (!count || cursor + count * 2 > tokens.length) return null;
    const points = Array.from({ length: count }, point);
    if (points.some(p => !p.every(Number.isFinite))) return null;
    const to = points[points.length - 1]!;
    if (kind === 'M') {
      finish(false);
      start = to;
      current = to;
      continue;
    }
    if (!current) return null;
    append({ kind: kind!, from: current, to, controls: points.slice(0, -1) });
    current = to;
    if (edges.length > 100_000) return null;
  }
  finish(false);
  return paths;
};
const sameEdges = (a: Edge[], b: Edge[], closed: boolean) => {
  if (a.length !== b.length) return false;
  const edge = (x: Edge, y: Edge) =>
    x.kind === y.kind &&
    samePoint(x.from, y.from) &&
    samePoint(x.to, y.to) &&
    x.controls.length === y.controls.length &&
    x.controls.every((p, i) => samePoint(p, y.controls[i]!));
  let candidates = 0;
  for (let offset = 0; offset < (closed ? a.length : 1); offset++) {
    if (!edge(a[0]!, b[offset]!)) continue;
    if (++candidates > 64) return false;
    if (a.every((x, i) => edge(x, b[(i + offset) % b.length]!))) return true;
  }
  return false;
};

export function equalNativeGeometry(actual: unknown, expected: unknown): boolean {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length)
    return false;
  return actual.every((path, index) => {
    const reference = expected[index];
    if (
      !path ||
      !reference ||
      path.windingRule !== reference.windingRule ||
      typeof path.data !== 'string' ||
      typeof reference.data !== 'string'
    )
      return false;
    const a = pathEdges(path.data),
      e = pathEdges(reference.data);
    return (
      a !== null &&
      e !== null &&
      a.length === e.length &&
      a.every((p, i) => p.closed === e[i]!.closed && sameEdges(p.edges, e[i]!.edges, p.closed))
    );
  });
}
