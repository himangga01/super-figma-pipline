import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format as formatWithOxfmt } from 'oxfmt';

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repositoryRoot = resolve(process.env.SFP_REPOSITORY_ROOT ?? defaultRepositoryRoot);
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => {
  throw new Error(`[${code}] ${message}`);
};
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

const formattedJsonBytes = async (path, value) => {
  const formatted = await formatWithOxfmt(path, `${JSON.stringify(value, null, 2)}\n`, {
    endOfLine: 'lf',
    insertFinalNewline: true,
    tabWidth: 2,
    useTabs: false,
  });
  if (formatted.errors.length > 0) fail('CHANGE_MANIFEST_FORMAT_FAILED', path);
  return Buffer.from(formatted.code);
};

const upsertHashRow = (rows, path, digest) => {
  const retained = rows.filter(row => row.path !== path);
  retained.push({ path, sha256: digest });
  return retained.toSorted((left, right) => compareUtf8(left.path, right.path));
};

const registerGeneratedManifest = async (manifestRelative, manifestBytes) => {
  const lockPath = join(repositoryRoot, 'service', 'upstream-lock.json');
  const rulesPath = join(repositoryRoot, 'service', 'vendor-rules.json');
  const [lock, rules] = await Promise.all([
    readJson(lockPath).catch(() => null),
    readJson(rulesPath).catch(() => null),
  ]);
  if (
    lock?.schemaVersion !== 2 ||
    !Array.isArray(lock.serviceFiles) ||
    !Array.isArray(lock.destinationClosure?.managedRoots) ||
    !Array.isArray(lock.destinationClosure?.serviceOwnedFiles) ||
    rules?.schemaVersion !== 1 ||
    !Array.isArray(rules.exclude) ||
    !Array.isArray(rules.serviceOwned)
  ) {
    return;
  }
  const serviceRelative = manifestRelative.slice('service/'.length);
  const digest = sha256(manifestBytes);
  lock.serviceFiles = upsertHashRow(lock.serviceFiles, serviceRelative, digest);
  if (
    lock.destinationClosure.managedRoots.some(
      root => serviceRelative === root || serviceRelative.startsWith(`${root}/`),
    )
  ) {
    lock.destinationClosure.serviceOwnedFiles = upsertHashRow(
      lock.destinationClosure.serviceOwnedFiles,
      serviceRelative,
      digest,
    );
    rules.exclude = [...new Set([...rules.exclude, serviceRelative])].toSorted(compareUtf8);
    rules.serviceOwned = [...new Set([...rules.serviceOwned, serviceRelative])].toSorted(
      compareUtf8,
    );
    const rulesBytes = await formattedJsonBytes(rulesPath, rules);
    await writeFile(rulesPath, rulesBytes);
    lock.serviceFiles = upsertHashRow(lock.serviceFiles, 'vendor-rules.json', sha256(rulesBytes));
  }
  await writeFile(lockPath, await formattedJsonBytes(lockPath, lock));
};

const safeRepositoryPath = path => {
  if (
    typeof path !== 'string' ||
    !path.startsWith('service/') ||
    path.startsWith('service/service/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes(':') ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    fail('CHANGE_MANIFEST_PATH_INVALID', String(path));
  }
  return path;
};

const parseMovePairs = (raw, changes, allowedPathSet) => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail('CHANGE_MANIFEST_MOVE_PAIRS_INVALID', 'movePairs must be an array');
  const changesByPath = new Map(changes.map(change => [change.path, change]));
  const seenOld = new Set();
  const seenNew = new Set();
  const pairs = raw.map((pair, index) => {
    if (
      pair === null ||
      typeof pair !== 'object' ||
      Array.isArray(pair) ||
      JSON.stringify(Object.keys(pair).toSorted(compareUtf8)) !==
        JSON.stringify(['newPath', 'oldPath'])
    ) {
      fail('CHANGE_MANIFEST_MOVE_PAIRS_INVALID', `movePairs[${index}] is invalid`);
    }
    const oldPath = safeRepositoryPath(pair.oldPath);
    const newPath = safeRepositoryPath(pair.newPath);
    if (
      oldPath === newPath ||
      seenOld.has(oldPath) ||
      seenNew.has(newPath) ||
      !allowedPathSet.has(oldPath) ||
      !allowedPathSet.has(newPath)
    ) {
      fail(
        'CHANGE_MANIFEST_MOVE_PAIRS_INVALID',
        `movePairs[${index}] is duplicate or out of scope`,
      );
    }
    if (changesByPath.get(oldPath)?.status !== 'D' || changesByPath.get(newPath)?.status !== 'A') {
      fail('CHANGE_MANIFEST_MOVE_INCOMPLETE', `${oldPath} -> ${newPath} requires cached D plus A`);
    }
    seenOld.add(oldPath);
    seenNew.add(newPath);
    return { oldPath, newPath };
  });
  const sorted = pairs.toSorted(
    (left, right) =>
      compareUtf8(left.oldPath, right.oldPath) || compareUtf8(left.newPath, right.newPath),
  );
  if (JSON.stringify(pairs) !== JSON.stringify(sorted)) {
    fail('CHANGE_MANIFEST_MOVE_PAIRS_INVALID', 'movePairs must be UTF-8 sorted');
  }
  return pairs;
};

const readMovePairDeclaration = async (manifestPath, slice, changes, allowedPathSet) => {
  let declaration;
  try {
    declaration = await readJson(manifestPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) {
    fail('CHANGE_MANIFEST_INVALID', 'existing move-pair declaration is not strict v1');
  }
  const keys = Object.keys(declaration).toSorted(compareUtf8);
  const baseKeys = ['authorityPaths', 'changes', 'schemaVersion', 'slice'].toSorted(compareUtf8);
  const moveKeys = [...baseKeys, 'movePairs'].toSorted(compareUtf8);
  if (
    declaration.schemaVersion !== 1 ||
    declaration.slice !== slice ||
    !Array.isArray(declaration.authorityPaths) ||
    !Array.isArray(declaration.changes) ||
    (JSON.stringify(keys) !== JSON.stringify(baseKeys) &&
      JSON.stringify(keys) !== JSON.stringify(moveKeys))
  ) {
    fail('CHANGE_MANIFEST_INVALID', 'existing move-pair declaration is not strict v1');
  }
  return parseMovePairs(declaration.movePairs, changes, allowedPathSet);
};

const cachedChanges = () => {
  const fields = execFileSync(
    'git',
    [
      '-C',
      repositoryRoot,
      'diff',
      '--cached',
      '--name-status',
      '--no-renames',
      '-z',
      '--',
      'service',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const rows = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!/^[AMD]$/.test(status ?? '') || path === undefined) {
      fail('CHANGE_MANIFEST_INDEX_INVALID', 'cached name-status is malformed');
    }
    safeRepositoryPath(path);
    const digest =
      status === 'D'
        ? null
        : sha256(
            execFileSync('git', ['-C', repositoryRoot, 'show', `:${path}`], {
              maxBuffer: 64 * 1024 * 1024,
            }),
          );
    rows.push({ status, path, sha256: digest });
  }
  return rows.toSorted((left, right) => compareUtf8(left.path, right.path));
};

const assertNoUnstagedServiceChanges = () => {
  const entries = execFileSync(
    'git',
    [
      '-C',
      repositoryRoot,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      'service',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const dirty = entries.filter(entry => entry.startsWith('??') || entry[1] !== ' ');
  if (dirty.length > 0) {
    fail('UNSTAGED_SERVICE_CHANGE', dirty.join(', '));
  }
};

const indexMatchesHead = path => {
  try {
    const head = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', `HEAD:${path}`], {
      encoding: 'utf8',
    }).trim();
    const index = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', `:${path}`], {
      encoding: 'utf8',
    }).trim();
    return /^[0-9a-f]{40,64}$/.test(head) && head === index;
  } catch {
    return false;
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const write = args[0] === '--write';
  const offset = write ? 1 : 0;
  if (args.length !== offset + 2 || args[offset] !== '--slice') {
    fail(
      'CHANGE_MANIFEST_USAGE',
      'usage: verify-staged-change-manifest.mjs [--write] --slice <id>',
    );
  }
  const slice = args[offset + 1];
  if (!/^(?:7[ABC]|8[AB]|9[ABC]|10|11|12[AB]|13|14|15|16|review-\d{4}-\d{2}-\d{2})$/.test(slice)) {
    fail('CHANGE_MANIFEST_SLICE_INVALID', slice);
  }
  const slug = slice.toLowerCase();
  const authorityPath = join(
    repositoryRoot,
    'service',
    'capabilities',
    `task-${slug}-authority-classes.json`,
  );
  const manifestRelative = `service/capabilities/change-manifests/task-${slug}.json`;
  const manifestPath = join(repositoryRoot, ...manifestRelative.split('/'));
  const authority = await readJson(authorityPath);
  if (
    authority.schemaVersion !== 1 ||
    authority.slice !== slice ||
    !Array.isArray(authority.allowedPaths)
  ) {
    fail('CHANGE_MANIFEST_AUTHORITY_INVALID', `task-${slug}-authority-classes.json`);
  }
  const allowedPaths = authority.allowedPaths.map(safeRepositoryPath).toSorted(compareUtf8);
  const allowedPathSet = new Set(allowedPaths);
  if (
    new Set(allowedPaths).size !== allowedPaths.length ||
    JSON.stringify(allowedPaths) !== JSON.stringify(authority.allowedPaths)
  ) {
    fail('CHANGE_MANIFEST_AUTHORITY_INVALID', 'allowedPaths must be unique UTF-8 sorted');
  }
  const authorityPaths = [
    manifestRelative,
    'service/upstream-lock.json',
    'service/vendor-map.json',
    'service/vendor-rules.json',
  ].toSorted(compareUtf8);
  for (const path of authorityPaths) {
    if (!allowedPathSet.has(path)) fail('CHANGE_MANIFEST_AUTHORITY_INVALID', `missing ${path}`);
  }
  const all = cachedChanges();
  const outside = all.filter(row => !allowedPathSet.has(row.path));
  if (outside.length > 0) {
    fail('CHANGE_MANIFEST_OUT_OF_SCOPE', outside.map(row => row.path).join(', '));
  }
  const semanticRows = all.filter(row => !authorityPaths.includes(row.path));

  if (write) {
    const movePairs = await readMovePairDeclaration(
      manifestPath,
      slice,
      semanticRows,
      allowedPathSet,
    );
    const manifest = {
      schemaVersion: 1,
      slice,
      authorityPaths,
      changes: semanticRows,
      ...(movePairs.length > 0 ? { movePairs } : {}),
    };
    const manifestBytes = await formattedJsonBytes(manifestPath, manifest);
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, manifestBytes);
    await registerGeneratedManifest(manifestRelative, manifestBytes);
    process.stdout.write(
      `staged-change-manifest=written slice=${slice} changes=${semanticRows.length}\n`,
    );
    return;
  }

  assertNoUnstagedServiceChanges();
  const manifest = await readJson(manifestPath);
  const movePairs = parseMovePairs(manifest.movePairs, semanticRows, allowedPathSet);
  const expectedManifest = {
    schemaVersion: 1,
    slice,
    authorityPaths,
    changes: semanticRows,
    ...(movePairs.length > 0 ? { movePairs } : {}),
  };
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) {
    fail('CHANGE_MANIFEST_MISMATCH', 'manifest rows do not equal cached index blobs');
  }
  const stagedPaths = new Set(all.map(row => row.path));
  const manifestMissing = !stagedPaths.has(manifestRelative);
  const missingAuthority = authorityPaths.filter(
    path => !stagedPaths.has(path) && (path === manifestRelative || !indexMatchesHead(path)),
  );
  if (manifestMissing && !missingAuthority.includes(manifestRelative)) {
    missingAuthority.push(manifestRelative);
  }
  if (missingAuthority.length > 0) {
    fail('CHANGE_MANIFEST_AUTHORITY_MISSING', missingAuthority.join(', '));
  }
  process.stdout.write(
    `staged-change-manifest=ok slice=${slice} changes=${semanticRows.length} authority=${authorityPaths.length}\n`,
  );
};

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
