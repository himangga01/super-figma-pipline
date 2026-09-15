import { contentHash, storedChecksum } from '@sfp/ir';
import { z } from 'zod';

import type { RepoReader } from '../fs/repo-walk.js';
import { parseMapFile } from '../join/component-map.js';
import { parseTokenMapFile, TokenOverrideProofSchema } from '../join/token-map.js';
import type { ProjectProfile } from '../profile/profile.js';
import { loadProjectTokens } from '../tokens/load.js';

/** Missing optional maps are empty. Boundary, decoding and read failures remain visible. */
const readOptional = async (reader: RepoReader, path: string): Promise<string> => {
  try {
    return await reader.readText(path);
  } catch (error) {
    if ((error as { code?: string }).code === 'REPO_FILE_NOT_FOUND') return '';
    throw error;
  }
};
export const readMappingOverrides = async (reader: RepoReader) => {
  const [tokens, components] = await Promise.all([
    readOptional(reader, 'docs/figma-token-map.md'),
    readOptional(reader, 'docs/figma-component-map.md'),
  ]);
  const proofs = [...tokens.matchAll(/```sfp-token-map-v2\s*\n([\s\S]*?)```/g)].flatMap(match =>
    z.array(TokenOverrideProofSchema).max(10000).parse(JSON.parse(match[1]!)),
  );
  const componentRows = parseMapFile(components);
  const present = new Set<string>();
  for (const path of new Set([...componentRows.values()].map(row => row.filePath))) {
    // eslint-disable-next-line no-await-in-loop -- preserve bounded retained path checks
    if (await reader.exists(path)) present.add(path);
  }
  return {
    tokens: parseTokenMapFile(tokens),
    proofs: z.array(TokenOverrideProofSchema).max(10000).parse(proofs),
    components: componentRows,
    componentsOnDisk: new Set(
      [...componentRows].filter(([, row]) => present.has(row.filePath)).map(([key]) => key),
    ),
  };
};
/** Record the exact bytes supplied to the existing parsers, without changing their authority. */
export const loadMappingTokenSource = async (
  reader: RepoReader,
  profile: ProjectProfile,
  tokenSource?: string,
) => {
  const observed = new Map<string, string>();
  const read = async (path: string, maxBytes?: number) => {
    const bytes = await reader.readBytes(path, maxBytes),
      hash = storedChecksum(bytes);
    const previous = observed.get(path);
    if (previous !== undefined && previous !== hash) throw new Error('MAPPING_SOURCE_CHANGED');
    observed.set(path, hash);
    return bytes;
  };
  const tracked = new Proxy(reader, {
    get(target, key) {
      if (key === 'readBytes') return read;
      if (key === 'readText')
        return async (path: string, maxBytes?: number) =>
          (await read(path, maxBytes)).toString('utf8');
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const loaded = await loadProjectTokens(reader.rootDir, profile, tokenSource, tracked);
  const files = [...observed]
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([path, hash]) => ({ path, hash }));
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop -- bounded optimistic re-observation of actual parser inputs
    if (storedChecksum(await reader.readBytes(file.path)) !== file.hash)
      throw new Error('MAPPING_SOURCE_CHANGED');
  }
  return { loaded, codeSourceHash: contentHash('sfp-mapping-code-source-v2', { profile, files }) };
};
