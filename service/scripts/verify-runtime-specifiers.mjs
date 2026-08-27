import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowedStringsPath = join(serviceRoot, 'vendor-allowed-figwright-strings.json');
const codeExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue',
]);
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const excludedDirectories = new Set(['coverage', 'dist', 'node_modules']);
const rawMatcher = /@figwright\/[A-Za-z0-9._~@/-]+/g;

const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const toPosix = path => path.split(sep).join('/');
const relativeServicePath = path => toPosix(relative(serviceRoot, path));

const walkFiles = async root => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries
      .toSorted((left, right) => compareStrings(left.name, right.name))
      .map(async entry => {
        if (entry.isDirectory() && excludedDirectories.has(entry.name)) return [];
        const path = join(root, entry.name);
        if (entry.isDirectory()) return walkFiles(path);
        return entry.isFile() ? [path] : [];
      }),
  );
  return files.flat();
};

const scriptKindFor = path => {
  const extension = extname(path).toLowerCase();
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
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

const inspectScript = (text, path, offset = 0) => {
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(path),
  );
  return moduleSpecifierLiterals(sourceFile)
    .filter(literal => literal.text.startsWith('@figwright/'))
    .map(literal => ({
      path,
      position: offset + literal.getStart(sourceFile),
      value: literal.text,
    }));
};

const inspectCodeFile = async path => {
  const text = await readFile(path, 'utf8');
  if (extname(path).toLowerCase() !== '.vue') return inspectScript(text, path);
  const findings = [];
  for (const script of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const contents = script[1];
    if (contents === undefined || script.index === undefined) continue;
    const offset = script.index + script[0].indexOf(contents);
    findings.push(...inspectScript(contents, `${path}.ts`, offset));
  }
  return findings;
};

const dependencyFindings = async manifestPath => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const findings = [];
  for (const field of dependencyFields) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith('@figwright/')) {
        findings.push({ path: manifestPath, position: 0, value: `${field}.${name}` });
      }
    }
  }
  return findings;
};

const collectRawEntries = async paths => {
  const entries = (
    await Promise.all(
      paths.toSorted(compareStrings).map(async path => {
        const contents = await readFile(path, 'utf8').catch(() => null);
        if (contents === null || contents.includes('\0')) return [];
        const pathEntries = [];
        const lines = contents.split('\n');
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          for (const match of lines[lineIndex].matchAll(rawMatcher)) {
            pathEntries.push({
              path: relativeServicePath(path),
              line: lineIndex + 1,
              column: (match.index ?? 0) + 1,
              value: match[0],
            });
          }
        }
        return pathEntries;
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

const main = async () => {
  const packageFiles = await walkFiles(join(serviceRoot, 'packages'));
  const codeFiles = packageFiles.filter(path => codeExtensions.has(extname(path).toLowerCase()));
  const manifests = [
    join(serviceRoot, 'package.json'),
    ...packageFiles.filter(path =>
      relativeServicePath(path).match(/^packages\/[^/]+\/package\.json$/),
    ),
  ].toSorted(compareStrings);

  const runtimeFindings = (
    await Promise.all([
      ...codeFiles.map(path => inspectCodeFile(path)),
      ...manifests.map(path => dependencyFindings(path)),
    ])
  ).flat();
  if (runtimeFindings.length > 0) {
    const rendered = runtimeFindings
      .toSorted(
        (left, right) => compareStrings(left.path, right.path) || left.position - right.position,
      )
      .map(({ path, value }) => `${relativeServicePath(path)}: ${value}`)
      .join('\n');
    throw new Error(`runtime @figwright package specifiers remain:\n${rendered}`);
  }

  const allowed = JSON.parse(await readFile(allowedStringsPath, 'utf8'));
  if (allowed.schemaVersion !== 1 || !Array.isArray(allowed.entries)) {
    throw new Error('vendor-allowed-figwright-strings.json must use schemaVersion 1 with entries');
  }
  const rawFiles = [
    ...packageFiles,
    ...(await walkFiles(join(serviceRoot, 'skills'))),
    join(serviceRoot, 'PROVENANCE.md'),
  ];
  const actualEntries = await collectRawEntries(rawFiles);
  const expectedEntries = allowed.entries
    .map(({ path, line, column, value }) => ({ path, line, column, value }))
    .toSorted(
      (left, right) =>
        compareStrings(left.path, right.path) ||
        left.line - right.line ||
        left.column - right.column ||
        compareStrings(left.value, right.value),
    );
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      `raw @figwright allowlist mismatch\nexpected=${JSON.stringify(expectedEntries, null, 2)}\nactual=${JSON.stringify(actualEntries, null, 2)}`,
    );
  }

  console.log(
    `runtime-specifiers=ok codeFiles=${codeFiles.length} manifests=${manifests.length} allowedStrings=${actualEntries.length}`,
  );
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
