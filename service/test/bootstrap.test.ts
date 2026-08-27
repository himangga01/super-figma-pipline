import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('service bootstrap', () => {
  it('declares every package needed by the implementation plan', async () => {
    const names = await Promise.all(
      ['shared', 'ir', 'mcp', 'plugin', 'cli'].map(
        async dir =>
          JSON.parse(
            await readFile(new URL(`../packages/${dir}/package.json`, import.meta.url), 'utf8'),
          ).name,
      ),
    );
    expect(names).toEqual(['@sfp/shared', '@sfp/ir', '@sfp/mcp', '@sfp/plugin', '@sfp/cli']);
  });

  it('passes Vitest exclusion globs without literal shell quotes', async () => {
    const { scripts } = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect.soft(scripts.test).toBe('vitest run --exclude "test/artifact-contents.test.ts"');
    expect
      .soft(scripts['test:unit'])
      .toBe('vitest run --exclude "**/test/e2e/**" --exclude "test/artifact-contents.test.ts"');
    expect.soft(scripts.test).not.toContain("'");
    expect.soft(scripts['test:unit']).not.toContain("'");
  });
});
