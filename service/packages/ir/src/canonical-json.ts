import { createHash } from 'node:crypto';

/** Emit canonical JSON incrementally without materializing large subtrees. */
const visitCanonical = (input: unknown, write: (text: string) => void): void => {
  const active = new Set<object>();
  let visited = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++visited > 10_000_000 || depth > 128) throw new Error('CANONICAL_JSON_LIMIT');
    if (
      item === null ||
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    ) {
      write(JSON.stringify(item));
      return;
    }
    if (typeof item !== 'object' || active.has(item)) throw new Error('CANONICAL_JSON_INVALID');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))
      throw new Error('CANONICAL_JSON_INVALID');
    active.add(item);
    try {
      if (Array.isArray(item)) {
        write('[');
        for (let index = 0; index < item.length; index++) {
          if (!Object.hasOwn(item, index)) throw new Error('CANONICAL_JSON_INVALID');
          if (index > 0) write(',');
          visit(item[index], depth + 1);
        }
        write(']');
      } else {
        write('{');
        const keys = Object.keys(item)
          .toSorted()
          .filter(key => (item as Record<string, unknown>)[key] !== undefined);
        for (const [index, key] of keys.entries()) {
          if (index > 0) write(',');
          write(`${JSON.stringify(key)}:`);
          visit((item as Record<string, unknown>)[key], depth + 1);
        }
        write('}');
      }
    } finally {
      active.delete(item);
    }
  };
  visit(input, 0);
};

export const canonicalJson = (input: unknown): string => {
  const chunks: string[] = [];
  let pending = '';
  visitCanonical(input, text => {
    pending += text;
    if (pending.length >= 16_384) {
      chunks.push(pending);
      pending = '';
    }
  });
  chunks.push(pending);
  return chunks.join('');
};

/** Bounded storage encoding; do not allocate a second full JSON string before UTF-8 conversion. */
export const encodeCanonicalJson = (input: unknown): Uint8Array => {
  const chunks: Uint8Array[] = [],
    encoder = new TextEncoder();
  let pending = '',
    total = 0;
  const flush = () => {
    const bytes = encoder.encode(pending);
    pending = '';
    total += bytes.length;
    if (total > 33_554_432) throw new Error('SNAPSHOT_STORAGE_LIMIT');
    chunks.push(bytes);
  };
  visitCanonical(input, text => {
    pending += text;
    if (pending.length >= 16_384) flush();
  });
  pending += '\n';
  flush();
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

export const contentHash = (domain: string, value: unknown): `sha256:${string}` => {
  const hash = createHash('sha256').update(domain).update('\0');
  let pending = '';
  visitCanonical(value, text => {
    pending += text;
    if (pending.length >= 16_384) {
      hash.update(pending);
      pending = '';
    }
  });
  hash.update(pending);
  return `sha256:${hash.digest('hex')}`;
};
export const storedChecksum = (bytes: string | Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
