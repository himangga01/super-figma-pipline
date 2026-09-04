import { execFile } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const serviceRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(serviceRoot, '..');
const ledgerPath = join(serviceRoot, 'capabilities', 'task-8a-direct-fs-importers.json');
const RED_BASE = '0b5c86ae72c9ae6f5eb0f8444cb184f6cb7dba99';

interface LedgerRow {
  source: string;
  test: string;
  legacyImport: 'node:fs/promises';
  replacement: 'RepoReader|WorkspacePolicy';
}

const readLedger = async (): Promise<{ schemaVersion: 1; rows: LedgerRow[] }> =>
  JSON.parse(await readFile(ledgerPath, 'utf8')) as { schemaVersion: 1; rows: LedgerRow[] };

const importSpecifiers = (path: string, source: string): string[] => {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0] as ts.Expression)
    ) {
      specifiers.push((node.arguments[0] as ts.StringLiteral).text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
};

const isDirectFilesystemTraversal = (specifier: string): boolean =>
  specifier.startsWith('node:fs') || specifier === 'fdir';

const productionFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
    }
  };
  await visit(root);
  return files;
};

describe('Task 8A direct project-filesystem importer authority', () => {
  it('keeps the strict six-row UTF-8-sorted ledger and every focused test', async () => {
    const ledger = await readLedger();
    expect(Object.keys(ledger).toSorted()).toEqual(['rows', 'schemaVersion']);
    expect(ledger.schemaVersion).toBe(1);
    expect(ledger.rows).toHaveLength(6);
    expect(ledger.rows.map(row => row.source)).toEqual(
      ledger.rows
        .map(row => row.source)
        .toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    );
    for (const row of ledger.rows) {
      expect(Object.keys(row).toSorted()).toEqual([
        'legacyImport',
        'replacement',
        'source',
        'test',
      ]);
      expect(row.legacyImport).toBe('node:fs/promises');
      expect(row.replacement).toBe('RepoReader|WorkspacePolicy');
      await expect(access(join(serviceRoot, row.test))).resolves.toBeUndefined();
    }
  });

  it('proves every ledger row had the legacy import at the pinned RED base and has none after migration', async () => {
    const ledger = await readLedger();
    for (const row of ledger.rows) {
      const repoPath = `service/${row.source}`;
      const { stdout: parentSource } = await execFileAsync(
        'git',
        ['show', `${RED_BASE}:${repoPath}`],
        { cwd: repoRoot, encoding: 'utf8' },
      );
      expect(importSpecifiers(repoPath, parentSource)).toContain(row.legacyImport);
      const workingSource = await readFile(join(serviceRoot, row.source), 'utf8');
      expect(importSpecifiers(row.source, workingSource)).not.toContain(row.legacyImport);
    }
  });

  it('rejects every direct node:fs project reader outside the fs authority', async () => {
    const scopedRoots = ['scan', 'tools', 'icons', 'profile', 'tokens'].map(name =>
      join(serviceRoot, 'packages', 'mcp', 'src', name),
    );
    const files = (await Promise.all(scopedRoots.map(productionFiles))).flat();
    const offenders: string[] = [];
    for (const path of files) {
      const source = await readFile(path, 'utf8');
      if (importSpecifiers(path, source).some(isDirectFilesystemTraversal)) {
        offenders.push(relative(serviceRoot, path).replaceAll('\\', '/'));
      }
    }
    expect(offenders.toSorted()).toEqual([]);
  });

  it('detects dynamic imports, require, import-equals, and re-export traversal aliases', () => {
    const source = `
      export * from 'fdir';
      const a = import('node:fs/promises');
      const b = require('node:fs');
      import c = require('node:fs/promises');
    `;
    expect(importSpecifiers('mutation.ts', source).filter(isDirectFilesystemTraversal)).toEqual([
      'fdir',
      'node:fs/promises',
      'node:fs',
      'node:fs/promises',
    ]);
  });

  it('injects the runtime AbortSignal into the production workspace-bound RepoReader', async () => {
    const path = join(serviceRoot, 'packages', 'mcp', 'src', 'index.ts');
    const parsed = ts.createSourceFile(
      path,
      await readFile(path, 'utf8'),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    );
    const optionKeys: string[][] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'RepoReader' &&
        node.arguments?.length === 1 &&
        ts.isObjectLiteralExpression(node.arguments[0] as ts.Expression)
      ) {
        optionKeys.push(
          (node.arguments[0] as ts.ObjectLiteralExpression).properties
            .map(property => property.name?.getText(parsed))
            .filter((key): key is string => key !== undefined),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    expect(optionKeys).toContainEqual(['rootDir', 'workspaceId', 'workspacePolicy', 'signal']);
  });

  it('consumes typed native manual-cleanup state without turning it into a readiness throw', async () => {
    const source = await readFile(join(serviceRoot, 'packages', 'mcp', 'src', 'index.ts'), 'utf8');
    expect(source).toContain(
      'const nativeOrphanState = await nativeArtifacts.discoverAndCleanupOrphans',
    );
    expect(source).toContain("if (nativeOrphanState.status === 'manual-cleanup')");
    expect(source).toMatch(/\[retention\].*native evidence requires manual cleanup/u);
  });
});
