import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(serviceRoot, 'upstream-lock.json');
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const allowedModes = new Set(['copy', 'mergeDependencyManifest', 'referenceOnly']);
const rewriteTransformations = ['package-specifier-rewrite', 'oxfmt-normalize'];
const shaPattern = /^[0-9a-f]{64}$/;

const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = contents => createHash('sha256').update(contents).digest('hex');
const servicePath = path => join(serviceRoot, ...path.split('/'));
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertSha = (value, label) =>
  assert(typeof value === 'string' && shaPattern.test(value), `${label} is not SHA-256`);

const gitText = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

const gitBytes = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });

const globToRegExp = glob => {
  let expression = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        if (glob[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    expression += character.replace(/[\\^$+.()|[\]{}]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
};

const selectedRows = (trackedPaths, rules) => {
  const modes = {
    copy: rules.copy.map(globToRegExp),
    mergeDependencyManifest: rules.mergeDependencyManifests.map(globToRegExp),
    referenceOnly: rules.referenceOnly.map(globToRegExp),
  };
  const excludes = rules.exclude.map(globToRegExp);
  return trackedPaths
    .flatMap(sourcePath => {
      if (excludes.some(matcher => matcher.test(sourcePath))) return [];
      const matchingModes = Object.entries(modes)
        .filter(([, matchers]) => matchers.some(matcher => matcher.test(sourcePath)))
        .map(([mode]) => mode);
      assert(matchingModes.length <= 1, `overlapping upstream vendor modes for ${sourcePath}`);
      return matchingModes.length === 1 ? [{ mode: matchingModes[0], sourcePath }] : [];
    })
    .toSorted(
      (left, right) =>
        compareStrings(left.sourcePath, right.sourcePath) || compareStrings(left.mode, right.mode),
    );
};

const assertSubset = (actual, expected, label) => {
  for (const [name, value] of Object.entries(expected ?? {})) {
    assert(
      actual?.[name] === value,
      `${label}.${name} mismatch: expected ${value}, received ${actual?.[name]}`,
    );
  }
};

const verifyServiceFiles = async lock => {
  await Promise.all(
    lock.serviceFiles.map(async entry => {
      assertSha(entry.sha256, `serviceFiles.${entry.path}`);
      const actual = sha256(await readFile(servicePath(entry.path)));
      assert(actual === entry.sha256, `service file hash mismatch: ${entry.path}`);
    }),
  );
};

const verifyVendorMap = async lock => {
  const contents = await readFile(servicePath(lock.vendorMap.path));
  assertSha(lock.vendorMap.sha256, 'vendorMap.sha256');
  assert(
    sha256(contents) === lock.vendorMap.sha256,
    'vendor-map.json hash does not match upstream-lock.json',
  );
  const vendorMap = JSON.parse(contents.toString('utf8'));
  const figwright = lock.upstreams.find(upstream => upstream.id === 'figwright');
  assert(vendorMap.schemaVersion === 1, 'vendor-map.json schemaVersion must be 1');
  assert(vendorMap.upstream === 'figwright', 'vendor-map.json upstream must be figwright');
  assert(
    vendorMap.originCommit === figwright?.commit,
    'vendor-map.json origin commit is not pinned',
  );
  assert(Array.isArray(vendorMap.files), 'vendor-map.json files must be an array');

  const sorted = vendorMap.files.toSorted(
    (left, right) =>
      compareStrings(left.sourcePath, right.sourcePath) || compareStrings(left.mode, right.mode),
  );
  assert(
    JSON.stringify(vendorMap.files) === JSON.stringify(sorted),
    'vendor-map.json rows are not sorted',
  );
  assert(
    new Set(vendorMap.files.map(row => row.sourcePath)).size === vendorMap.files.length,
    'vendor-map paths are not unique',
  );

  const counts = {
    copy: 0,
    mergeDependencyManifest: 0,
    referenceOnly: 0,
    total: vendorMap.files.length,
  };
  await Promise.all(
    vendorMap.files.map(async row => {
      assert(allowedModes.has(row.mode), `unknown vendor mode for ${row.sourcePath}: ${row.mode}`);
      counts[row.mode] += 1;
      assert(row.originCommit === figwright.commit, `origin commit mismatch for ${row.sourcePath}`);
      assert(row.licenseId === 'MIT', `license mismatch for ${row.sourcePath}`);
      assertSha(row.baseSha256, `${row.sourcePath}.baseSha256`);
      assert(
        Array.isArray(row.transformations),
        `transformations are not an array: ${row.sourcePath}`,
      );
      const transformationShape = JSON.stringify(row.transformations);
      assert(
        transformationShape === '[]' ||
          transformationShape === JSON.stringify(rewriteTransformations),
        `unexpected transformations for ${row.sourcePath}: ${transformationShape}`,
      );
      if (row.mode === 'copy') {
        assert(
          row.destination === row.sourcePath,
          `copy destination mismatch for ${row.sourcePath}`,
        );
        assertSha(row.currentSha256, `${row.sourcePath}.currentSha256`);
        const actual = sha256(await readFile(servicePath(row.destination)));
        assert(actual === row.currentSha256, `vendored file hash mismatch: ${row.destination}`);
      } else {
        assert(
          row.transformations.length === 0,
          `non-copy row has transformations: ${row.sourcePath}`,
        );
        assert(row.currentSha256 === null, `non-copy row has current SHA-256: ${row.sourcePath}`);
        if (row.mode === 'referenceOnly')
          assert(
            row.destination === null,
            `reference-only destination is not null: ${row.sourcePath}`,
          );
        else
          assert(
            row.destination === row.sourcePath,
            `manifest destination mismatch: ${row.sourcePath}`,
          );
      }
    }),
  );
  assert(
    JSON.stringify(counts) === JSON.stringify(lock.vendorMap.counts),
    'vendor-map counts do not match upstream-lock.json',
  );
  return vendorMap;
};

const verifyManifestContracts = async lock => {
  const rootManifest = await readJson(servicePath('package.json'));
  assert(
    rootManifest.packageManager === lock.rootAuthority.packageManager,
    'root packageManager changed',
  );
  assert(rootManifest.engines?.node === lock.rootAuthority.nodeEngine, 'root Node engine changed');
  assertSubset(rootManifest.scripts, lock.rootAuthority.scripts, 'root scripts');

  const packageDirectories = (await readdir(servicePath('packages'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .toSorted(compareStrings);
  const packageManifests = await Promise.all(
    packageDirectories.map(directory =>
      readJson(servicePath(`packages/${directory}/package.json`)),
    ),
  );
  const packageNames = packageManifests.map(manifest => manifest.name).toSorted(compareStrings);
  const expectedPackageNames = lock.rootAuthority.workspacePackageNames.toSorted(compareStrings);
  assert(
    JSON.stringify(packageNames) === JSON.stringify(expectedPackageNames),
    `workspace package names changed: ${JSON.stringify(packageNames)}`,
  );

  const knip = await readJson(servicePath('knip.json'));
  assert(
    JSON.stringify(Object.keys(knip.workspaces)) ===
      JSON.stringify(lock.rootAuthority.knipWorkspaces),
    'knip workspace set changed',
  );
  const workspaceConfig = await readFile(servicePath('pnpm-workspace.yaml'), 'utf8');
  assert(
    workspaceConfig.includes("- 'packages/*'"),
    'pnpm workspace no longer includes packages/*',
  );

  const manifests = [rootManifest, ...packageManifests];
  for (const manifest of manifests) {
    for (const name of lock.droppedScripts) {
      assert(
        manifest.scripts?.[name] === undefined,
        `dropped upstream script remains in ${manifest.name}: ${name}`,
      );
    }
    for (const command of Object.values(manifest.scripts ?? {})) {
      assert(
        !command.includes('scripts/sync-skills.mjs'),
        `skills sync script remains in ${manifest.name}`,
      );
    }
    for (const field of dependencyFields) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        assert(
          !name.startsWith('@figwright/'),
          `runtime dependency namespace remains in ${manifest.name}: ${name}`,
        );
      }
    }
  }

  await Promise.all(
    lock.manifestRequirements.map(async requirement => {
      const manifest = await readJson(servicePath(requirement.path));
      for (const [field, value] of Object.entries(requirement.topLevel ?? {})) {
        assert(
          JSON.stringify(manifest[field]) === JSON.stringify(value),
          `${requirement.path}.${field} mismatch`,
        );
      }
      assertSubset(manifest.scripts, requirement.scripts, `${requirement.path}.scripts`);
      for (const field of dependencyFields) {
        assertSubset(manifest[field], requirement[field], `${requirement.path}.${field}`);
      }
    }),
  );
};

const verifyLicenseCopies = async lock => {
  await Promise.all(
    lock.upstreams.map(async upstream => {
      assertSha(upstream.license.sha256, `${upstream.id}.license.sha256`);
      const actual = sha256(await readFile(servicePath(upstream.license.servicePath)));
      assert(
        actual === upstream.license.sha256,
        `license copy mismatch: ${upstream.license.servicePath}`,
      );
    }),
  );
};

const verifyWithUpstreams = async (lock, vendorMap, upstreamsRoot) => {
  const metadata = await stat(upstreamsRoot).catch(() => null);
  assert(metadata?.isDirectory(), `upstreams root is not a directory: ${upstreamsRoot}`);

  for (const upstream of lock.upstreams) {
    const root = join(upstreamsRoot, upstream.directory);
    assert(
      gitText(root, 'rev-parse', 'HEAD') === upstream.commit,
      `${upstream.id} commit mismatch`,
    );
    const status = gitText(root, 'status', '--porcelain=v1', '--untracked-files=all');
    assert(status === '', `${upstream.id} worktree is not clean:\n${status}`);
    const license = gitBytes(root, 'show', `${upstream.commit}:${upstream.license.sourcePath}`);
    assert(
      sha256(license) === upstream.license.sha256,
      `${upstream.id} upstream license hash mismatch`,
    );
    for (const source of upstream.attributionSources) {
      assertSha(source.sha256, `${upstream.id}.${source.path}`);
      const contents = gitBytes(root, 'show', `${upstream.commit}:${source.path}`);
      assert(
        sha256(contents) === source.sha256,
        `${upstream.id} attribution source hash mismatch: ${source.path}`,
      );
    }
  }

  const figwright = lock.upstreams.find(upstream => upstream.id === 'figwright');
  const figwrightRoot = join(upstreamsRoot, figwright.directory);
  const rules = await readJson(servicePath('vendor-rules.json'));
  assert(
    rules.commit === figwright.commit,
    'vendor-rules.json commit does not match upstream lock',
  );
  const trackedPaths = gitBytes(figwrightRoot, 'ls-files', '-z')
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .toSorted(compareStrings);
  const expectedRows = selectedRows(trackedPaths, rules);
  const actualRows = vendorMap.files.map(({ mode, sourcePath }) => ({ mode, sourcePath }));
  assert(
    JSON.stringify(actualRows) === JSON.stringify(expectedRows),
    'vendor-map paths do not exactly expand vendor-rules.json',
  );
  for (const row of vendorMap.files) {
    const contents = gitBytes(figwrightRoot, 'show', `${figwright.commit}:${row.sourcePath}`);
    assert(sha256(contents) === row.baseSha256, `upstream source hash mismatch: ${row.sourcePath}`);
  }
};

const main = async () => {
  const [mode, upstreamsArgument, ...unexpected] = process.argv.slice(2);
  assert(unexpected.length === 0, 'too many arguments');
  assert(
    mode === '--offline' || mode === '--with-upstreams',
    'usage: verify-upstream-lock.mjs --offline | --with-upstreams <root>',
  );
  assert(
    mode === '--offline' ? upstreamsArgument === undefined : upstreamsArgument !== undefined,
    'invalid upstream argument',
  );

  const lock = await readJson(lockPath);
  assert(lock.schemaVersion === 1, 'upstream-lock.json schemaVersion must be 1');
  assert(
    Array.isArray(lock.upstreams) && lock.upstreams.length === 3,
    'upstream-lock.json must pin three upstreams',
  );
  assert(
    new Set(lock.upstreams.map(upstream => upstream.id)).size === 3,
    'upstream IDs are not unique',
  );
  await verifyServiceFiles(lock);
  const vendorMap = await verifyVendorMap(lock);
  await verifyManifestContracts(lock);
  await verifyLicenseCopies(lock);
  if (mode === '--with-upstreams') {
    await verifyWithUpstreams(lock, vendorMap, resolve(process.cwd(), upstreamsArgument));
  }
  console.log(
    `upstream-lock=ok mode=${mode.slice(2)} upstreams=${lock.upstreams.length} vendorRows=${vendorMap.files.length}`,
  );
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
