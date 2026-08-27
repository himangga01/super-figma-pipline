import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format as formatWithOxfmt } from 'oxfmt';
import ts from 'typescript';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serviceRoot, '..');
const upstreamRoot = join(repositoryRoot, 'code-kb', 'figwright');
const rulesPath = join(serviceRoot, 'vendor-rules.json');
const vendorMapPath = join(serviceRoot, 'vendor-map.json');
const allowedStringsPath = join(serviceRoot, 'vendor-allowed-figwright-strings.json');

const codeExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const packageFieldOrder = [
  'name',
  'version',
  'description',
  'keywords',
  'homepage',
  'bugs',
  'license',
  'author',
  'repository',
  'private',
  'type',
  'bin',
  'files',
  'exports',
  'scripts',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'engines',
  'packageManager',
];
const packageFieldRanks = new Map(packageFieldOrder.map((field, index) => [field, index]));
const packageRewrites = new Map([
  ['@figwright/shared', '@sfp/shared'],
  ['@figwright/mcp', '@sfp/mcp'],
  ['@figwright/plugin', '@sfp/plugin'],
]);
const droppedScripts = new Set(['postinstall', 'release']);
const mergedManifestPaths = [
  'package.json',
  'packages/shared/package.json',
  'packages/mcp/package.json',
  'packages/plugin/package.json',
];

const serviceAuthorityPaths = [
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.node-version',
  '.npmrc',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  'knip.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
  'vitest.config.ts',
  'packages/shared/tsconfig.json',
  'packages/shared/vitest.config.ts',
  'packages/ir/package.json',
  'packages/ir/tsconfig.json',
  'packages/ir/vitest.config.ts',
  'packages/mcp/tsconfig.json',
  'packages/mcp/tsdown.config.ts',
  'packages/mcp/vitest.config.ts',
  'packages/plugin/manifest.json',
  'packages/plugin/tsconfig.json',
  'packages/plugin/vite.config.main.ts',
  'packages/plugin/vite.config.ts',
  'packages/plugin/vitest.config.ts',
  'packages/cli/package.json',
  'packages/cli/tsconfig.json',
  'packages/cli/tsdown.config.ts',
  'packages/cli/vitest.config.ts',
  'test/bootstrap.test.ts',
];

const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = contents => createHash('sha256').update(contents).digest('hex');
const destinationPath = path => join(serviceRoot, ...path.split('/'));

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeFormattedJson = async (path, value, formatterOptions) => {
  const formatted = await formatWithOxfmt(
    path,
    `${JSON.stringify(value, null, 2)}\n`,
    formatterOptions,
  );
  if (formatted.errors.length > 0) {
    throw new Error(
      `oxfmt failed for generated JSON ${path}: ${formatted.errors.map(error => error.message).join('; ')}`,
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatted.code, 'utf8');
};

const gitText = (...args) =>
  execFileSync('git', ['-C', upstreamRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

const gitBytes = (...args) =>
  execFileSync('git', ['-C', upstreamRoot, ...args], {
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

const compilePatterns = patterns => patterns.map(pattern => [pattern, globToRegExp(pattern)]);

const assertEveryPatternMatches = (trackedPaths, labelledPatterns) => {
  for (const [label, patterns] of Object.entries(labelledPatterns)) {
    for (const [pattern, matcher] of patterns) {
      if (!trackedPaths.some(path => matcher.test(path))) {
        throw new Error(`${label} vendor pattern matches no tracked file: ${pattern}`);
      }
    }
  }
};

const classifyTrackedFiles = (trackedPaths, rules) => {
  const patterns = {
    copy: compilePatterns(rules.copy),
    mergeDependencyManifest: compilePatterns(rules.mergeDependencyManifests),
    referenceOnly: compilePatterns(rules.referenceOnly),
  };
  const excludes = compilePatterns(rules.exclude);
  assertEveryPatternMatches(trackedPaths, patterns);

  const selected = [];
  for (const sourcePath of trackedPaths) {
    if (excludes.some(([, matcher]) => matcher.test(sourcePath))) continue;
    const modes = Object.entries(patterns)
      .filter(([, matchers]) => matchers.some(([, matcher]) => matcher.test(sourcePath)))
      .map(([mode]) => mode);
    if (modes.length > 1) {
      throw new Error(
        `tracked path has overlapping vendor modes: ${sourcePath} (${modes.join(', ')})`,
      );
    }
    if (modes.length === 1) selected.push({ mode: modes[0], sourcePath });
  }
  return selected.toSorted(
    (left, right) =>
      compareStrings(left.sourcePath, right.sourcePath) || compareStrings(left.mode, right.mode),
  );
};

const assertPinnedUpstream = rules => {
  if (rules.schemaVersion !== 1 || rules.upstream !== 'figwright') {
    throw new Error('vendor-rules.json must describe schemaVersion 1 for figwright');
  }
  const actualCommit = gitText('rev-parse', 'HEAD');
  if (actualCommit !== rules.commit) {
    throw new Error(
      `figwright commit mismatch: expected ${rules.commit}, received ${actualCommit}`,
    );
  }
  const status = gitText('status', '--porcelain=v1', '--untracked-files=all');
  if (status !== '') throw new Error(`figwright worktree is not clean:\n${status}`);
  return actualCommit;
};

const listTrackedPaths = () =>
  gitBytes('ls-files', '-z').toString('utf8').split('\0').filter(Boolean).toSorted(compareStrings);

const readPinnedFile = (commit, sourcePath) => gitBytes('show', `${commit}:${sourcePath}`);

const scriptKindFor = path => {
  const extension = extname(path).toLowerCase();
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
};

const rewrittenSpecifier = specifier => {
  for (const [upstreamName, serviceName] of packageRewrites) {
    if (specifier === upstreamName || specifier.startsWith(`${upstreamName}/`)) {
      return `${serviceName}${specifier.slice(upstreamName.length)}`;
    }
  }
  return specifier;
};

const moduleSpecifierLiterals = sourceFile => {
  const literals = [];
  const visit = node => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      literals.push(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      literals.push(node.moduleReference.expression);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      literals.push(node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      literals.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
};

const rewriteScript = (text, virtualPath) => {
  const sourceFile = ts.createSourceFile(
    virtualPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(virtualPath),
  );
  const replacements = moduleSpecifierLiterals(sourceFile)
    .map(literal => ({
      end: literal.end - 1,
      replacement: rewrittenSpecifier(literal.text),
      start: literal.getStart(sourceFile) + 1,
      original: literal.text,
    }))
    .filter(({ original, replacement }) => original !== replacement)
    .toSorted((left, right) => right.start - left.start);

  let rewritten = text;
  for (const replacement of replacements) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.replacement}${rewritten.slice(replacement.end)}`;
  }
  return { changed: replacements.length > 0, text: rewritten };
};

const rewriteVueScripts = (text, virtualPath) => {
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  let changed = false;
  let rewritten = text;
  for (const script of scripts.toReversed()) {
    const contents = script[1];
    if (contents === undefined || script.index === undefined) continue;
    const start = script.index + script[0].indexOf(contents);
    const replacement = rewriteScript(contents, `${virtualPath}.ts`);
    changed ||= replacement.changed;
    rewritten = `${rewritten.slice(0, start)}${replacement.text}${rewritten.slice(start + contents.length)}`;
  }
  return { changed, text: rewritten };
};

const rewriteCopyContents = async (sourcePath, contents, formatterOptions) => {
  const extension = extname(sourcePath).toLowerCase();
  if (!codeExtensions.has(extension) && extension !== '.vue') {
    return { contents, transformations: [] };
  }
  const text = contents.toString('utf8');
  const rewritten =
    extension === '.vue' ? rewriteVueScripts(text, sourcePath) : rewriteScript(text, sourcePath);
  if (!rewritten.changed) return { contents, transformations: [] };
  const formatted = await formatWithOxfmt(
    destinationPath(sourcePath),
    rewritten.text,
    formatterOptions,
  );
  if (formatted.errors.length > 0) {
    throw new Error(
      `oxfmt failed after package-specifier rewrite for ${sourcePath}: ${formatted.errors.map(error => error.message).join('; ')}`,
    );
  }
  return {
    contents: Buffer.from(formatted.code, 'utf8'),
    transformations: ['package-specifier-rewrite', 'oxfmt-normalize'],
  };
};

const hashAuthorities = async (paths = serviceAuthorityPaths) => {
  const entries = await Promise.all(
    paths.map(async path => {
      const absolutePath = destinationPath(path);
      const metadata = await stat(absolutePath).catch(() => null);
      if (!metadata?.isFile()) throw new Error(`missing Task 1 service authority: ${path}`);
      return [path, sha256(await readFile(absolutePath))];
    }),
  );
  return new Map(entries);
};

const assertAuthoritiesUnchanged = async before => {
  const after = await hashAuthorities([...before.keys()]);
  const changed = [...before]
    .filter(([path, hash]) => after.get(path) !== hash)
    .map(([path]) => path);
  if (changed.length > 0) {
    throw new Error(`Task 1 service authorities changed unexpectedly:\n${changed.join('\n')}`);
  }
};

const rawFigwrightEntries = async copyRows => {
  const matcher = /@figwright\/[A-Za-z0-9._~@/-]+/g;
  const entries = (
    await Promise.all(
      copyRows.map(async row => {
        if (!row.destination?.match(/^(packages|skills)\//)) return [];
        const contents = await readFile(destinationPath(row.destination), 'utf8').catch(() => null);
        if (contents === null || contents.includes('\0')) return [];
        const rowEntries = [];
        const lines = contents.split('\n');
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          for (const match of lines[lineIndex].matchAll(matcher)) {
            rowEntries.push({
              path: row.destination,
              line: lineIndex + 1,
              column: (match.index ?? 0) + 1,
              value: match[0],
              reason: 'upstream protocol tag, comment, fixture, or user guidance',
            });
          }
        }
        return rowEntries;
      }),
    )
  ).flat();
  return entries.toSorted(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      compareStrings(left.value, right.value),
  );
};

const copyOnly = async (rules, commit, selected) => {
  const authorityHashes = await hashAuthorities([...serviceAuthorityPaths, ...mergedManifestPaths]);
  const formatterConfig = await readJson(destinationPath('.oxfmtrc.json'));
  const formatterOptions = {
    ...formatterConfig,
    endOfLine: 'lf',
    insertFinalNewline: true,
    tabWidth: 2,
    useTabs: false,
  };
  const rows = await Promise.all(
    selected.map(async selection => {
      const baseContents = readPinnedFile(commit, selection.sourcePath);
      const destination = selection.mode === 'referenceOnly' ? null : selection.sourcePath;
      let currentSha256 = null;
      let transformations = [];
      if (selection.mode === 'copy') {
        const rewritten = await rewriteCopyContents(
          selection.sourcePath,
          baseContents,
          formatterOptions,
        );
        const absoluteDestination = destinationPath(selection.sourcePath);
        await mkdir(dirname(absoluteDestination), { recursive: true });
        await writeFile(absoluteDestination, rewritten.contents);
        currentSha256 = sha256(rewritten.contents);
        transformations = rewritten.transformations;
      }
      return {
        mode: selection.mode,
        originCommit: commit,
        sourcePath: selection.sourcePath,
        destination,
        baseSha256: sha256(baseContents),
        currentSha256,
        transformations,
        licenseId: 'MIT',
      };
    }),
  );

  await assertAuthoritiesUnchanged(authorityHashes);
  const vendorMap = {
    schemaVersion: 1,
    upstream: rules.upstream,
    originCommit: commit,
    files: rows,
  };
  await writeFormattedJson(vendorMapPath, vendorMap, formatterOptions);
  await writeFormattedJson(
    allowedStringsPath,
    {
      schemaVersion: 1,
      entries: await rawFigwrightEntries(rows.filter(row => row.mode === 'copy')),
    },
    formatterOptions,
  );

  const counts = Object.fromEntries(
    ['copy', 'mergeDependencyManifest', 'referenceOnly'].map(mode => [
      mode,
      rows.filter(row => row.mode === mode).length,
    ]),
  );
  const rewrittenCount = rows.filter(row => row.transformations.length > 0).length;
  console.log(
    `vendor-copy=ok commit=${commit} copy=${counts.copy} merge=${counts.mergeDependencyManifest} reference=${counts.referenceOnly} rewritten=${rewrittenCount}`,
  );
};

const sortRecord = record =>
  Object.fromEntries(
    Object.entries(record).toSorted(([left], [right]) => compareStrings(left, right)),
  );

const rewriteDependencyName = name => rewrittenSpecifier(name);

const mergeRecord = (serviceRecord = {}, upstreamRecord = {}, rewriteNames = false) => {
  const result = { ...serviceRecord };
  for (const upstreamKey of Object.keys(upstreamRecord).toSorted(compareStrings)) {
    const key = rewriteNames ? rewriteDependencyName(upstreamKey) : upstreamKey;
    if (!(key in result)) result[key] = upstreamRecord[upstreamKey];
  }
  return sortRecord(result);
};

const mergeManifest = (serviceManifest, upstreamManifest) => {
  const merged = { ...serviceManifest };
  const upstreamScripts = Object.fromEntries(
    Object.entries(upstreamManifest.scripts ?? {}).filter(([name]) => !droppedScripts.has(name)),
  );
  merged.scripts = mergeRecord(serviceManifest.scripts, upstreamScripts);
  for (const field of dependencyFields) {
    if (serviceManifest[field] !== undefined || upstreamManifest[field] !== undefined) {
      merged[field] = mergeRecord(serviceManifest[field], upstreamManifest[field], true);
    }
  }
  return Object.fromEntries(
    Object.entries(merged).toSorted(
      ([left], [right]) =>
        (packageFieldRanks.get(left) ?? packageFieldOrder.length) -
        (packageFieldRanks.get(right) ?? packageFieldOrder.length),
    ),
  );
};

const assertManifestAuthority = (path, before, after) => {
  for (const [key, value] of Object.entries(before)) {
    if (key === 'scripts' || dependencyFields.includes(key)) continue;
    if (JSON.stringify(after[key]) !== JSON.stringify(value)) {
      throw new Error(`service manifest authority changed at ${path}#${key}`);
    }
  }
  for (const [name, command] of Object.entries(before.scripts ?? {})) {
    if (after.scripts?.[name] !== command) {
      throw new Error(`service script authority changed at ${path}#scripts.${name}`);
    }
  }
  for (const field of dependencyFields) {
    for (const [name, version] of Object.entries(before[field] ?? {})) {
      if (after[field]?.[name] !== version) {
        throw new Error(`service dependency authority changed at ${path}#${field}.${name}`);
      }
    }
  }
  for (const name of droppedScripts) {
    if (after.scripts?.[name] !== undefined) {
      throw new Error(`dropped upstream script remains at ${path}#scripts.${name}`);
    }
  }
};

const mergeManifests = async (rules, commit) => {
  const authorityHashes = await hashAuthorities();
  const pendingWrites = await Promise.all(
    [...rules.mergeDependencyManifests].toSorted(compareStrings).map(async sourcePath => {
      const absoluteDestination = destinationPath(sourcePath);
      const serviceManifest = await readJson(absoluteDestination);
      const upstreamManifest = JSON.parse(readPinnedFile(commit, sourcePath).toString('utf8'));
      const mergedManifest = mergeManifest(serviceManifest, upstreamManifest);
      assertManifestAuthority(sourcePath, serviceManifest, mergedManifest);
      return [absoluteDestination, mergedManifest];
    }),
  );
  await Promise.all(pendingWrites.map(([path, manifest]) => writeJson(path, manifest)));
  await assertAuthoritiesUnchanged(authorityHashes);
  console.log(`vendor-manifests=ok commit=${commit} manifests=${pendingWrites.length}`);
};

const main = async () => {
  const [mode, ...unexpected] = process.argv.slice(2);
  if (!['--copy-only', '--merge-manifests'].includes(mode) || unexpected.length > 0) {
    throw new Error(
      'usage: node service/scripts/vendor-upstreams.mjs --copy-only|--merge-manifests',
    );
  }
  const rules = await readJson(rulesPath);
  const commit = assertPinnedUpstream(rules);
  const trackedPaths = listTrackedPaths();
  const selected = classifyTrackedFiles(trackedPaths, rules);
  if (mode === '--copy-only') await copyOnly(rules, commit, selected);
  else await mergeManifests(rules, commit);
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
