import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceDirectories = [
  'packages/cli/src',
  'packages/ir/src',
  'packages/mcp/src',
  'packages/shared/src',
];
const requiredFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/build-identity.mjs',
  'scripts/build-server.mjs',
  'tsconfig.base.json',
  'tsconfig.json',
  ...['cli', 'ir', 'mcp', 'shared'].flatMap(name => [
    `packages/${name}/package.json`,
    `packages/${name}/tsconfig.json`,
  ]),
  'packages/cli/tsdown.config.ts',
  'packages/mcp/tsdown.config.ts',
];
const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const missingInput = path => new Error(`BUILD_IDENTITY_REQUIRED_INPUT_MISSING:${path}`);

const requireFile = async (root, path) => {
  try {
    if (!(await lstat(resolve(root, path))).isFile()) throw missingInput(path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BUILD_IDENTITY_')) throw error;
    throw missingInput(path);
  }
};

const walkSource = async (root, path) => {
  let items;
  try {
    items = await readdir(resolve(root, path), { withFileTypes: true });
  } catch {
    throw missingInput(path);
  }
  const nested = await Promise.all(
    items
      .toSorted((left, right) => comparePaths(left.name, right.name))
      .map(async item => {
        const child = `${path}/${item.name}`;
        if (item.isDirectory()) return walkSource(root, child);
        if (item.isFile()) return [child];
        throw new Error(`BUILD_IDENTITY_UNSUPPORTED_INPUT:${child}`);
      }),
  );
  return nested.flat();
};

export const enumerateBuildIdentityInputs = async root => {
  const normalizedRoot = resolve(root);
  await Promise.all(requiredFiles.map(path => requireFile(normalizedRoot, path)));
  const sourceFiles = (
    await Promise.all(sourceDirectories.map(path => walkSource(normalizedRoot, path)))
  ).flat();
  const inputs = [...requiredFiles, ...sourceFiles];
  return [...new Set(inputs)].toSorted(comparePaths);
};

const updateFramed = (hash, value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
};

export const computeBuildIdentity = async root => {
  const normalizedRoot = resolve(root);
  const inputs = await enumerateBuildIdentityInputs(normalizedRoot);
  const hash = createHash('sha256');
  updateFramed(hash, 'sfp-daemon-build-identity-v2');
  updateFramed(hash, String(inputs.length));
  const contents = await Promise.all(
    inputs.map(async path => {
      try {
        return await readFile(resolve(normalizedRoot, path));
      } catch {
        throw missingInput(path);
      }
    }),
  );
  for (const [index, path] of inputs.entries()) {
    const content = contents[index];
    if (!content) throw missingInput(path);
    updateFramed(hash, path);
    updateFramed(hash, content);
  }
  return `sha256:${hash.digest('hex')}`;
};
