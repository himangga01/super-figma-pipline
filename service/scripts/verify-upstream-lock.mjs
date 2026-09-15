import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serviceRoot, '..');
const lockPath = join(serviceRoot, 'upstream-lock.json');
const lockSchemaPath = join(serviceRoot, 'schemas', 'upstream-lock-v2.schema.json');
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

class VerificationError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.name = 'VerificationError';
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertSha = (value, label) =>
  assert(typeof value === 'string' && shaPattern.test(value), `${label} is not SHA-256`);

const assertExactKeys = (value, expected, label) => {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} is not an object`,
  );
  const actual = Object.keys(value).toSorted(compareStrings);
  const wanted = [...expected].toSorted(compareStrings);
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} has unknown or missing keys`);
};

const verifyLockV2Schema = async lock => {
  const schema = await readJson(lockSchemaPath);
  const expectedTopLevel = [
    'schemaVersion',
    'vendorMap',
    'destinationClosure',
    'serviceForks',
    'serviceFiles',
    'packageAuthorities',
    'rootAuthority',
    'excludedUpstreamScriptInputs',
    'manifestRequirements',
    'upstreams',
  ];
  assert(
    schema?.$schema === 'https://json-schema.org/draft/2020-12/schema' &&
      schema?.$id === 'https://super-figma-pipeline.local/schemas/upstream-lock-v2.schema.json' &&
      schema?.type === 'object' &&
      schema?.additionalProperties === false &&
      Array.isArray(schema.required) &&
      schema.properties !== null &&
      typeof schema.properties === 'object' &&
      !Array.isArray(schema.properties),
    'upstream-lock-v2.schema.json authority is invalid',
  );
  assert(
    JSON.stringify([...schema.required].toSorted(compareStrings)) ===
      JSON.stringify([...expectedTopLevel].toSorted(compareStrings)) &&
      JSON.stringify(Object.keys(schema.properties).toSorted(compareStrings)) ===
        JSON.stringify([...expectedTopLevel].toSorted(compareStrings)) &&
      schema.properties.schemaVersion?.const === 2 &&
      schema.properties.serviceForks?.items?.$ref === '#/$defs/serviceFork',
    'upstream-lock-v2.schema.json contract is incomplete',
  );
  assertExactKeys(lock, expectedTopLevel, 'upstream-lock.json');
  assertExactKeys(lock.vendorMap, ['path', 'sha256', 'counts'], 'upstream-lock.json.vendorMap');
  assertExactKeys(
    lock.vendorMap.counts,
    ['copy', 'mergeDependencyManifest', 'referenceOnly', 'total'],
    'upstream-lock.json.vendorMap.counts',
  );
  assertSafeDestinationPath(lock.vendorMap.path, 'upstream-lock.json.vendorMap.path');
  assertSha(lock.vendorMap.sha256, 'upstream-lock.json.vendorMap.sha256');
  for (const [name, value] of Object.entries(lock.vendorMap.counts)) {
    assert(Number.isSafeInteger(value) && value >= 0, `vendorMap.counts.${name} is invalid`);
  }
  assertExactKeys(
    lock.destinationClosure,
    ['managedRoots', 'serviceOwnedFiles'],
    'upstream-lock.json.destinationClosure',
  );
  for (const [index, entry] of lock.serviceFiles.entries()) {
    assertExactKeys(entry, ['path', 'sha256'], `serviceFiles[${index}]`);
    assertSafeDestinationPath(entry.path, `serviceFiles[${index}].path`);
    assertSha(entry.sha256, `serviceFiles[${index}].sha256`);
  }
  for (const [index, entry] of lock.destinationClosure.serviceOwnedFiles.entries()) {
    assertExactKeys(entry, ['path', 'sha256'], `serviceOwnedFiles[${index}]`);
    assertSafeDestinationPath(entry.path, `serviceOwnedFiles[${index}].path`);
    assertSha(entry.sha256, `serviceOwnedFiles[${index}].sha256`);
  }
  for (const [index, entry] of lock.packageAuthorities.entries()) {
    assertExactKeys(entry, ['path', 'projection'], `packageAuthorities[${index}]`);
    assertSafeDestinationPath(entry.path, `packageAuthorities[${index}].path`);
    assert(
      entry.projection !== null &&
        typeof entry.projection === 'object' &&
        !Array.isArray(entry.projection),
      `packageAuthorities[${index}].projection is invalid`,
    );
  }
  assertExactKeys(
    lock.rootAuthority,
    ['packageManager', 'nodeEngine', 'scripts', 'workspacePackageNames', 'knipWorkspaces'],
    'upstream-lock.json.rootAuthority',
  );
  assert(
    Array.isArray(lock.excludedUpstreamScriptInputs) &&
      lock.excludedUpstreamScriptInputs.every(value => typeof value === 'string'),
    'upstream-lock.json excludedUpstreamScriptInputs is invalid',
  );
  for (const [index, requirement] of lock.manifestRequirements.entries()) {
    const allowedKeys = new Set(['path', 'topLevel', 'scripts', ...dependencyFields]);
    assert(
      Object.keys(requirement).every(key => allowedKeys.has(key)) &&
        Object.hasOwn(requirement, 'path'),
      `manifestRequirements[${index}] has unknown or missing keys`,
    );
    assertSafeDestinationPath(requirement.path, `manifestRequirements[${index}].path`);
  }
  for (const [index, upstream] of lock.upstreams.entries()) {
    assertExactKeys(
      upstream,
      ['id', 'directory', 'commit', 'license', 'attributionSources'],
      `upstreams[${index}]`,
    );
    assert(
      ['figwright', 'figma-mcp-rust', 'figmosha2'].includes(upstream.id),
      'upstream id invalid',
    );
    assertSafeDestinationPath(upstream.directory, `upstreams[${index}].directory`);
    assert(/^[0-9a-f]{40}$/.test(upstream.commit), `upstreams[${index}].commit is invalid`);
    assertExactKeys(
      upstream.license,
      ['sourcePath', 'servicePath', 'sha256'],
      `upstreams[${index}].license`,
    );
    assertSafeDestinationPath(
      upstream.license.sourcePath,
      `upstreams[${index}].license.sourcePath`,
    );
    assertSafeDestinationPath(
      upstream.license.servicePath,
      `upstreams[${index}].license.servicePath`,
    );
    assertSha(upstream.license.sha256, `upstreams[${index}].license.sha256`);
    assert(
      Array.isArray(upstream.attributionSources),
      `upstreams[${index}].attributionSources invalid`,
    );
    for (const [sourceIndex, source] of upstream.attributionSources.entries()) {
      assertExactKeys(
        source,
        ['path', 'ranges', 'sha256'],
        `upstreams[${index}].sources[${sourceIndex}]`,
      );
      assertSafeDestinationPath(source.path, `upstreams[${index}].sources[${sourceIndex}].path`);
      assert(
        Array.isArray(source.ranges),
        `upstreams[${index}].sources[${sourceIndex}].ranges invalid`,
      );
      assertSha(source.sha256, `upstreams[${index}].sources[${sourceIndex}].sha256`);
    }
  }
};

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
  assert(Array.isArray(lock.serviceFiles), 'upstream-lock.json serviceFiles must be an array');
  const paths = lock.serviceFiles.map(entry => entry.path);
  assert(
    new Set(paths).size === paths.length,
    'upstream-lock.json serviceFiles paths are not unique',
  );
  await Promise.all(
    lock.serviceFiles.map(async entry => {
      assertSha(entry.sha256, `serviceFiles.${entry.path}`);
      const contents = await readFile(servicePath(entry.path)).catch(error => {
        throw new VerificationError(
          'PROTECTED_AUTHORITY',
          `protected service file is unavailable: ${entry.path} (${error?.code ?? 'read error'})`,
        );
      });
      const actual = sha256(contents);
      if (actual !== entry.sha256) {
        throw new VerificationError(
          'PROTECTED_AUTHORITY',
          `protected service file hash mismatch: ${entry.path}`,
        );
      }
    }),
  );
};

const verifyPackageAuthorities = async lock => {
  assert(
    Array.isArray(lock.packageAuthorities),
    'upstream-lock.json packageAuthorities must be an array',
  );
  const paths = lock.packageAuthorities.map(entry => entry.path);
  assert(new Set(paths).size === paths.length, 'package authority paths are not unique');
  await Promise.all(
    lock.packageAuthorities.map(async entry => {
      const manifest = await readJson(servicePath(entry.path));
      const actual = {};
      for (const [field, expected] of Object.entries(entry.projection)) {
        if (field === 'serviceScripts' || field === 'excludedScriptAuthority') {
          actual[field] = Object.fromEntries(
            Object.keys(expected).map(name => [name, manifest.scripts?.[name] ?? null]),
          );
        } else {
          actual[field] = manifest[field] ?? null;
        }
      }
      if (JSON.stringify(actual) !== JSON.stringify(entry.projection)) {
        throw new VerificationError(
          'PROTECTED_AUTHORITY',
          `protected package authority mismatch: ${entry.path}`,
        );
      }
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

const verifyServiceForks = async (lock, vendorMap) => {
  assert(Array.isArray(lock.serviceForks), 'upstream-lock.json serviceForks must be an array');
  const rules = await readJson(servicePath('vendor-rules.json'));
  assert(Array.isArray(rules.serviceOwned), 'vendor-rules.json serviceOwned must be an array');
  const exclusion = new Set(rules.exclude);
  const serviceOwned = new Set(rules.serviceOwned);
  assert(
    serviceOwned.size === rules.serviceOwned.length,
    'vendor-rules serviceOwned is not unique',
  );
  assert(
    JSON.stringify([...serviceOwned].toSorted(compareStrings)) ===
      JSON.stringify(rules.serviceOwned),
    'vendor-rules serviceOwned is not sorted',
  );
  const identities = new Set();
  /* eslint-disable no-await-in-loop -- canonical lineage order produces deterministic failures */
  for (const [index, row] of lock.serviceForks.entries()) {
    const common = [
      'originRepo',
      'originPath',
      'previousMode',
      'originCommit',
      'baseSha256',
      'transitionTask',
      'reason',
      'transition',
    ];
    const variant =
      row.transition === 'edit'
        ? ['destination', 'stagedSha256']
        : row.transition === 'move'
          ? ['oldDestination', 'newDestination', 'newSha256']
          : row.transition === 'delete'
            ? ['destination', 'stagedSha256']
            : [];
    assert(variant.length > 0, `serviceForks[${index}] transition is invalid`);
    assertExactKeys(row, [...common, ...variant], `serviceForks[${index}]`);
    assert(
      ['figwright', 'figma-mcp-rust', 'figmosha2'].includes(row.originRepo),
      `serviceForks[${index}] originRepo is invalid`,
    );
    assertSafeDestinationPath(row.originPath, `serviceForks[${index}].originPath`);
    assert(allowedModes.has(row.previousMode), `serviceForks[${index}] previousMode is invalid`);
    assert(
      /^[0-9a-f]{40}$/.test(row.originCommit),
      `serviceForks[${index}] originCommit is invalid`,
    );
    const pinnedOrigin = lock.upstreams.find(upstream => upstream.id === row.originRepo);
    assert(pinnedOrigin !== undefined, `service-fork origin repo is not pinned: ${row.originRepo}`);
    assert(
      row.originCommit === pinnedOrigin.commit,
      `service-fork origin commit mismatch: ${row.originPath}`,
    );
    assertSha(row.baseSha256, `serviceForks[${index}].baseSha256`);
    assert(
      /^(?:7[ABC]|8[AB]|9[ABC]|10|11|12[AB]|13|14|15|16|review-\d{4}-\d{2}-\d{2})$/.test(
        row.transitionTask,
      ),
      `serviceForks[${index}] transitionTask is invalid`,
    );
    assert(
      typeof row.reason === 'string' && row.reason.length > 0 && row.reason.length <= 512,
      `serviceForks[${index}] reason is invalid`,
    );
    const destinations =
      row.transition === 'move' ? [row.oldDestination, row.newDestination] : [row.destination];
    for (const destination of destinations) {
      assertSafeDestinationPath(destination, `serviceForks[${index}] destination`);
      assert(!identities.has(destination), `duplicate service-fork destination: ${destination}`);
      identities.add(destination);
      assert(
        !vendorMap.files.some(candidate => candidate.destination === destination),
        `service-fork remains in vendor-map: ${destination}`,
      );
    }
    if (row.transition === 'edit') {
      assertSha(row.stagedSha256, `serviceForks[${index}].stagedSha256`);
      assert(
        exclusion.has(row.destination),
        `service-fork is absent from exclude: ${row.destination}`,
      );
      assert(
        serviceOwned.has(row.destination),
        `service-fork is absent from serviceOwned: ${row.destination}`,
      );
      assert(
        sha256(await readFile(servicePath(row.destination))) === row.stagedSha256,
        `service-fork current hash mismatch: ${row.destination}`,
      );
    } else if (row.transition === 'move') {
      assert(row.oldDestination !== row.newDestination, `service-fork move is a no-op`);
      assertSha(row.newSha256, `serviceForks[${index}].newSha256`);
      assert(exclusion.has(row.oldDestination), `moved fork old path is absent from exclude`);
      assert(!serviceOwned.has(row.oldDestination), `moved fork old path remains serviceOwned`);
      assert(
        exclusion.has(row.newDestination) && serviceOwned.has(row.newDestination),
        `moved fork new path is not serviceOwned`,
      );
      await readFile(servicePath(row.oldDestination)).then(
        () => assert(false, `moved fork old path still exists: ${row.oldDestination}`),
        error => assert(error?.code === 'ENOENT', `moved fork old path read failed unexpectedly`),
      );
      assert(
        sha256(await readFile(servicePath(row.newDestination))) === row.newSha256,
        `moved fork current hash mismatch: ${row.newDestination}`,
      );
    } else {
      assert(row.stagedSha256 === null, `deleted fork stagedSha256 must be null`);
      assert(exclusion.has(row.destination), `deleted fork tombstone is absent from exclude`);
      assert(!serviceOwned.has(row.destination), `deleted fork remains serviceOwned`);
      await readFile(servicePath(row.destination)).then(
        () => assert(false, `deleted fork still exists: ${row.destination}`),
        error => assert(error?.code === 'ENOENT', `deleted fork read failed unexpectedly`),
      );
    }
  }
  /* eslint-enable no-await-in-loop */
};

const verifyParentForkProvenance = async lock => {
  const gitMetadata = await stat(join(repositoryRoot, '.git')).catch(() => null);
  if (gitMetadata === null) return;
  let parentVendorMap;
  let parentLock;
  try {
    parentVendorMap = JSON.parse(
      gitBytes(repositoryRoot, 'show', 'HEAD:service/vendor-map.json').toString('utf8'),
    );
    parentLock = JSON.parse(
      gitBytes(repositoryRoot, 'show', 'HEAD:service/upstream-lock.json').toString('utf8'),
    );
  } catch (error) {
    throw new VerificationError(
      'SERVICE_FORK_PARENT_INVALID',
      `cannot read parent provenance authorities: ${String(error)}`,
    );
  }
  for (const row of lock.serviceForks) {
    const priorDestination = row.transition === 'move' ? row.oldDestination : row.destination;
    const priorVendor = parentVendorMap.files?.find(
      candidate => candidate.destination === priorDestination,
    );
    if (priorVendor !== undefined) {
      assert(
        row.originRepo === parentVendorMap.upstream &&
          row.originPath === priorVendor.sourcePath &&
          row.previousMode === priorVendor.mode &&
          row.originCommit === priorVendor.originCommit &&
          row.baseSha256 === priorVendor.baseSha256,
        `service-fork parent vendor provenance mismatch: ${priorDestination}`,
      );
      continue;
    }
    const priorFork = (parentLock.serviceForks ?? []).find(candidate => {
      if (candidate.transition === 'move') {
        return (
          candidate.oldDestination === priorDestination ||
          candidate.newDestination === priorDestination
        );
      }
      return candidate.destination === priorDestination;
    });
    assert(priorFork !== undefined, `service-fork parent lineage is missing: ${priorDestination}`);
    assert(
      row.originRepo === priorFork.originRepo &&
        row.originPath === priorFork.originPath &&
        row.previousMode === priorFork.previousMode &&
        row.originCommit === priorFork.originCommit &&
        row.baseSha256 === priorFork.baseSha256,
      `service-fork inherited parent provenance mismatch: ${priorDestination}`,
    );
  }
};

const assertSafeDestinationPath = (path, label) => {
  const segments = typeof path === 'string' ? path.split('/') : [];
  if (
    typeof path !== 'string' ||
    segments.length === 0 ||
    segments.some(
      segment => segment === '' || segment === '.' || segment === '..' || segment.includes(':'),
    ) ||
    path.includes('\\') ||
    path.includes('\0') ||
    [...path].some(character => character.charCodeAt(0) <= 0x1f) ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path
  ) {
    throw new VerificationError('DESTINATION_POLICY_INVALID', `${label}: ${String(path)}`);
  }
};

const collectManagedFiles = async path => {
  assertSafeDestinationPath(path, 'unsafe managed root');
  const absolutePath = servicePath(path);
  const metadata = await lstat(absolutePath).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (metadata === null) return [];
  if (metadata.isSymbolicLink()) {
    throw new VerificationError('MANAGED_DESTINATION_TYPE', `managed path is a symlink: ${path}`);
  }
  if (metadata.isFile()) return [path];
  if (!metadata.isDirectory()) {
    throw new VerificationError(
      'MANAGED_DESTINATION_TYPE',
      `managed path is not a file or directory: ${path}`,
    );
  }
  const entries = (await readdir(absolutePath, { withFileTypes: true })).toSorted((left, right) =>
    compareStrings(left.name, right.name),
  );
  const nested = await Promise.all(
    entries.map(entry => collectManagedFiles(`${path}/${entry.name}`)),
  );
  return nested.flat();
};

const verifyDestinationClosure = async (lock, vendorMap) => {
  const policy = lock.destinationClosure;
  assert(
    Array.isArray(policy?.managedRoots) && Array.isArray(policy?.serviceOwnedFiles),
    'upstream-lock.json destinationClosure is invalid',
  );
  const managedRoots = policy.managedRoots.toSorted(compareStrings);
  assert(
    new Set(managedRoots).size === managedRoots.length,
    'destinationClosure managed roots are not unique',
  );
  for (const root of managedRoots) assertSafeDestinationPath(root, 'unsafe managed root');

  const vendoredDestinations = vendorMap.files
    .filter(row => row.mode === 'copy')
    .map(row => row.destination);
  const serviceOwnedDestinations = policy.serviceOwnedFiles.map(entry => entry.path);
  const expectedDestinations = [...vendoredDestinations, ...serviceOwnedDestinations];
  assert(
    new Set(expectedDestinations).size === expectedDestinations.length,
    'vendored and service-owned managed destinations overlap',
  );
  for (const destination of expectedDestinations) {
    assertSafeDestinationPath(destination, 'unsafe managed destination');
    assert(
      managedRoots.some(root => destination === root || destination.startsWith(`${root}/`)),
      `managed destination is outside registered roots: ${destination}`,
    );
  }

  await Promise.all(
    policy.serviceOwnedFiles.map(async entry => {
      assertSha(entry.sha256, `destinationClosure.serviceOwnedFiles.${entry.path}`);
      const actual = sha256(await readFile(servicePath(entry.path)));
      assert(actual === entry.sha256, `service-owned managed file hash mismatch: ${entry.path}`);
    }),
  );
  const actualDestinations = new Set(
    (await Promise.all(managedRoots.map(root => collectManagedFiles(root)))).flat(),
  );
  const expectedSet = new Set(expectedDestinations);
  const unexpected = [...actualDestinations]
    .filter(path => !expectedSet.has(path))
    .toSorted(compareStrings);
  if (unexpected.length > 0) {
    throw new VerificationError(
      'UNMANAGED_DESTINATION',
      `files exist inside managed roots without provenance:\n${unexpected.join('\n')}`,
    );
  }
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
      gitText(root, 'rev-parse', '--verify', `${upstream.commit}^{commit}`) === upstream.commit,
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
  const trackedPaths = gitBytes(
    figwrightRoot,
    'ls-tree',
    '-r',
    '--name-only',
    '-z',
    figwright.commit,
  )
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
  for (const row of lock.serviceForks) {
    const upstream = lock.upstreams.find(candidate => candidate.id === row.originRepo);
    assert(upstream !== undefined, `service-fork origin repo is not pinned: ${row.originRepo}`);
    assert(
      row.originCommit === upstream.commit,
      `service-fork origin commit mismatch: ${row.originPath}`,
    );
    const contents = gitBytes(
      join(upstreamsRoot, upstream.directory),
      'show',
      `${row.originCommit}:${row.originPath}`,
    );
    assert(
      sha256(contents) === row.baseSha256,
      `service-fork base hash mismatch: ${row.originPath}`,
    );
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
  await verifyLockV2Schema(lock);
  assert(lock.schemaVersion === 2, 'upstream-lock.json schemaVersion must be 2');
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
  await verifyServiceForks(lock, vendorMap);
  await verifyParentForkProvenance(lock);
  await verifyDestinationClosure(lock, vendorMap);
  await verifyPackageAuthorities(lock);
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
