import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import { aggregateRepoScssTokens } from '../../src/tokens/repo-scss.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

describe('aggregateRepoScssTokens', () => {
  it('pools Sass variables and CSS custom properties with repo-relative provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-repo-scss-'));
    roots.push(root);
    await mkdir(join(root, 'styles'), { recursive: true });
    await writeFile(
      join(root, 'styles', '_tokens.scss'),
      '$brand: #123456;\n:root { --space-unit: 8px; }\n',
    );

    const result = await aggregateRepoScssTokens(root);

    expect(result.files).toEqual(['styles/_tokens.scss']);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'brand', value: '#123456', from: 'styles/_tokens.scss' }),
        expect.objectContaining({ name: 'space-unit', value: '8px' }),
      ]),
    );
  });

  it('uses the injected RepoReader root instead of the raw root', async () => {
    const declaredRoot = await mkdtemp(join(tmpdir(), 'sfp-repo-scss-declared-'));
    const authorityRoot = await mkdtemp(join(tmpdir(), 'sfp-repo-scss-authority-'));
    roots.push(declaredRoot, authorityRoot);
    await writeFile(join(authorityRoot, '_owned.scss'), '$owned: #abcdef;');

    const result = await aggregateRepoScssTokens(
      declaredRoot,
      new RepoReader({ rootDir: authorityRoot }),
    );
    expect(result.tokens).toEqual([expect.objectContaining({ name: 'owned' })]);
  });

  it('shares one operation-wide parse-result budget across CSS and SCSS accumulation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-repo-style-shared-budget-'));
    roots.push(root);
    await writeFile(join(root, 'tokens.css'), ':root { --one: 1px; }');
    await writeFile(join(root, 'tokens.scss'), '$two: 2px; $three: 3px;');
    const reader = new RepoReader({ rootDir: root, maxParseResults: 2 } as never);
    const { aggregateRepoCssTokens } = await import('../../src/tokens/repo-css.js');

    await expect(aggregateRepoCssTokens(root, reader)).resolves.toMatchObject({
      tokens: [expect.objectContaining({ name: 'one' })],
    });
    await expect(aggregateRepoScssTokens(root, reader)).rejects.toMatchObject({
      code: 'REPO_PARSE_RESULT_LIMIT_EXCEEDED',
    });
  });
});
