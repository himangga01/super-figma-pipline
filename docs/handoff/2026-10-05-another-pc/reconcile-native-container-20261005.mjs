// Bounded provenance review for the native container, corner and grid conversion.
// Run from .worktrees/baseline/service. Writes only the main service review records and a new
// alternate review index; the owner's .git/index must remain byte-identical.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { format } from 'oxfmt';

const repository = resolve('../../..'),
  service = join(repository, 'service');
const index = resolve('.cache/native-container-20261005.index');
const mainIndex = join(repository, '.git/index');
if (existsSync(index)) throw Error('Inspect the existing review index instead of overwriting it');
copyFileSync(resolve('.cache/native-text-20261004.index'), index);
const hash = value => createHash('sha256').update(value).digest('hex');
const mainBefore = hash(readFileSync(mainIndex));
const git = (...args) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-C', repository, ...args], {
    env: { ...process.env, GIT_INDEX_FILE: index },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
const read = path => readFileSync(join(service, path));
const json = path => JSON.parse(read(path));
const sort = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const changed = [
  ...git('diff', '--name-only', '-z', '--', 'service').split('\0'),
  ...git('ls-files', '--others', '--exclude-standard', '-z', '--', 'service').split('\0'),
]
  .filter(Boolean)
  .map(path => path.slice(8));
const paths = [...new Set(changed)].sort(sort);
const expected = [
  'docs/portal-native.md',
  'packages/cli/src/figma-native-layout.ts',
  'packages/cli/src/figma-native-nodes.ts',
  'packages/cli/test/figma-native-layout.test.ts',
].sort(sort);
if (JSON.stringify(paths) !== JSON.stringify(expected))
  throw Error('Review scope changed: ' + JSON.stringify(paths));
const slice = 'review-2026-10-04';
const authorityPath = `capabilities/task-${slice}-authority-classes.json`;
const reviewPath = 'capabilities/reconciliations/review-2026-10-04-native-container.json';
const manifestPath = `capabilities/change-manifests/task-${slice}.json`;
if (existsSync(join(service, reviewPath))) throw Error('Preserve existing review records');
const reserved = ['upstream-lock.json', 'vendor-map.json', 'vendor-rules.json'];
const lock = json('upstream-lock.json'),
  map = json('vendor-map.json');
const claims = path =>
  [
    ...lock.serviceFiles
      .filter(row => row.path === path)
      .map(row => ({ class: 'protected', sha256: row.sha256 })),
    ...lock.destinationClosure.serviceOwnedFiles
      .filter(row => row.path === path)
      .map(row => ({ class: 'managed', sha256: row.sha256 })),
    ...(lock.serviceForks ?? [])
      .filter(
        row => row.transition !== 'delete' && (row.destination ?? row.newDestination) === path,
      )
      .map(row => ({ class: 'fork', sha256: row.stagedSha256 ?? row.newSha256 })),
    ...map.files
      .filter(row => row.mode !== 'referenceOnly' && row.destination === path)
      .map(row => ({ class: 'vendor', sha256: row.currentSha256 })),
    ...(lock.packageAuthorities ?? [])
      .filter(row => row.path === path)
      .map(row => ({ class: 'package', sha256: hash(JSON.stringify(row.projection)) })),
    ...(lock.manifestRequirements ?? [])
      .filter(row => row.path === path)
      .map(row => ({ class: 'manifest', sha256: hash(JSON.stringify(row)) })),
  ].sort((a, b) => sort(a.class, b.class) || sort(a.sha256, b.sha256));
const reasonText =
  'Report corner smoothing, strokes included in layout, fixed child count, overflow direction, layout grids and target aspect ratio from recorded values and Figma omitted defaults, only for Plugin API types that expose them. Column, row and square grids are converted; unobserved forms stay unknown. Separate eCommerce and CDD comparisons add 6,865 and 606 positions with zero differences. Two regressions failed first.';
if (reasonText.length > 512) throw Error(`Reason is too long: ${reasonText.length}`);
const write = async (path, value) => {
  const result = await format(join(service, path), JSON.stringify(value, null, 2) + '\n', {
    endOfLine: 'lf',
    insertFinalNewline: true,
    tabWidth: 2,
    useTabs: false,
  });
  if (result.errors.length) throw Error('Formatting failed');
  writeFileSync(join(service, path), result.code);
};
const authority = json(authorityPath);
authority.scope +=
  ' Also report native container, corner, grid and aspect fields, leaving unobserved forms unknown.';
authority.allowedPaths = [
  ...new Set([
    ...authority.allowedPaths,
    ...paths.map(path => 'service/' + path),
    'service/' + reviewPath,
  ]),
].sort(sort);
await write(authorityPath, authority);
await write(reviewPath, {
  schemaVersion: 1,
  slice,
  baseline: {
    headCommit: git('rev-parse', 'HEAD').trim(),
    authoritySha256: Object.fromEntries(reserved.map(path => [path, hash(read(path))])),
  },
  entries: [...paths, authorityPath].sort(sort).map(path => ({
    path,
    sha256: hash(read(path)),
    priorClaims: claims(path),
    reason: reasonText,
  })),
});

git(
  'add',
  '--',
  ...[...paths, authorityPath, reviewPath, manifestPath, ...reserved].map(path => 'service/' + path),
);
if (hash(readFileSync(mainIndex)) !== mainBefore) throw Error('Main index changed');
console.log(
  JSON.stringify({ index, reviewPath, reviewedFiles: paths.length + 1, mainIndexHash: mainBefore }),
);
