import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { resolvePnpmEntry } from './package-manager-entry.mjs';
import { sourceFingerprint } from './source-fingerprint.mjs';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export const assertScopeBinding = async (scope, serviceRoot) => {
  if (scope.sourceHash !== (await sourceFingerprint(serviceRoot)))
    throw new Error('TEST_SCOPE_SOURCE_CHANGED');
  if (
    scope.toolchain?.node !== process.version ||
    scope.toolchain?.nodeSha256 !== sha256(await readFile(process.execPath)) ||
    scope.toolchain?.pnpmSha256 !== sha256(await readFile(resolvePnpmEntry()))
  ) {
    throw new Error('TEST_SCOPE_TOOLCHAIN_CHANGED');
  }
};

const safePath = path =>
  typeof path === 'string' &&
  path !== '' &&
  !path.includes('\\') &&
  !path.includes(':') &&
  !path.startsWith('/') &&
  path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');

export const checkTestScope = (report, scope, serviceRoot, requiredFiles = []) => {
  const problems = [];
  if (
    scope?.schemaVersion !== 1 ||
    !['full', 'focused'].includes(scope.mode) ||
    typeof scope.runId !== 'string' ||
    scope.runId === '' ||
    !/^sha256:[0-9a-f]{64}$/.test(scope.sourceHash ?? '') ||
    !Array.isArray(scope.command) ||
    scope.command.length === 0 ||
    !scope.command.every(value => typeof value === 'string' && value !== '') ||
    typeof scope.toolchain?.node !== 'string' ||
    !Array.isArray(scope.files) ||
    scope.files.length === 0
  ) {
    return ['invalid test scope declaration'];
  }
  const declared = new Map();
  const expectedCommand =
    scope.mode === 'full'
      ? ['pnpm', 'test']
      : ['pnpm', 'exec', 'vitest', 'run', scope.files[0]?.path];
  if (
    JSON.stringify(scope.command) !== JSON.stringify(expectedCommand) ||
    (scope.mode === 'focused' && scope.files.length !== 1)
  ) {
    problems.push('declared command does not select the declared scope');
  }
  for (const file of scope.files) {
    if (
      !safePath(file?.path) ||
      declared.has(file.path) ||
      !Array.isArray(file.tests) ||
      file.tests.length === 0 ||
      file.tests.some(name => typeof name !== 'string' || name === '') ||
      new Set(file.tests).size !== file.tests.length
    ) {
      problems.push(`invalid or duplicate scope file: ${String(file?.path)}`);
      continue;
    }
    declared.set(file.path, file.tests);
  }
  if (scope.mode === 'full') {
    for (const path of requiredFiles)
      if (!declared.has(path)) problems.push(`required file not declared: ${path}`);
  }
  const seenFiles = new Set();
  for (const file of report.testResults ?? []) {
    const path = relative(serviceRoot, resolve(serviceRoot, String(file.name ?? ''))).replaceAll(
      '\\',
      '/',
    );
    if (seenFiles.has(path)) problems.push(`duplicate report file: ${path}`);
    seenFiles.add(path);
    if (!declared.has(path)) {
      problems.push(`undeclared report file: ${path}`);
      continue;
    }
    const assertions = file.assertionResults ?? [];
    if (assertions.length === 0) problems.push(`empty report file: ${path}`);
    const names = assertions.map(row =>
      Array.isArray(row.ancestorTitles)
        ? [...row.ancestorTitles, row.title].filter(Boolean).join(' > ')
        : row.fullName,
    );
    if (new Set(names).size !== names.length) problems.push(`duplicate report cases: ${path}`);
    for (const name of declared.get(path))
      if (!names.includes(name)) problems.push(`missing case: ${path} > ${name}`);
    for (const name of names)
      if (!declared.get(path).includes(name)) problems.push(`undeclared case: ${path} > ${name}`);
  }
  for (const path of declared.keys())
    if (!seenFiles.has(path)) problems.push(`missing file: ${path}`);
  return problems;
};
