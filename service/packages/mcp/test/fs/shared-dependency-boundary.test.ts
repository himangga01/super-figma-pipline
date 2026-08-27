import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const serviceRoot = resolve(import.meta.dirname, '../../../..');

const sourceFiles = async (root: string): Promise<string[]> => {
  if ((await stat(root)).isFile()) return root.endsWith('.ts') ? [root] : [];
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(entry => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat().filter(path => path.endsWith('.ts'));
};

const runtimeImports = async (root: string): Promise<string[]> => {
  const imports: string[] = [];
  for (const file of await sourceFiles(resolve(serviceRoot, root))) {
    const source = await readFile(file, 'utf8');
    const pattern = /(?:\bfrom\s*|\bimport\s*\()(['"])([^'"]+)\1/g;
    for (const match of source.matchAll(pattern)) imports.push(match[2] as string);
  }
  return imports;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(resolve(serviceRoot, path));
    return true;
  } catch {
    return false;
  }
};

describe('Task 4 package boundaries', () => {
  it('keeps Task 4 shared code independent from future IR', async () => {
    expect(await runtimeImports('packages/shared/src')).not.toContain('@sfp/ir');
    expect(await fileExists('packages/shared/src/snapshot-storage.ts')).toBe(false);
  });

  it('does not declare an IR dependency or snapshot storage authority in shared', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(serviceRoot, 'packages/shared/package.json'), 'utf8'),
    ) as Record<string, Record<string, string> | undefined>;
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ];

    expect(dependencyNames).not.toContain('@sfp/ir');
    expect(await runtimeImports('packages/shared/src')).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/snapshot-storage/)]),
    );
  });

  it('does not import Task 7, 8, or 11 implementation modules early', async () => {
    const task4Imports = [
      ...(await runtimeImports('packages/mcp/src/runtime-paths.ts')),
      ...(await runtimeImports('packages/mcp/src/security')),
      ...(await runtimeImports('packages/mcp/src/fs')),
    ];

    expect(task4Imports).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/journal|network|snapshot/i)]),
    );
  });
});
