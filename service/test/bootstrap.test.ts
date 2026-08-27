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
});
