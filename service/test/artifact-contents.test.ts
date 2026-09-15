import { execFileSync } from 'node:child_process';

import { expect, it } from 'vitest';

it('verifies the actual three archives and every contained file', () => {
  const result = execFileSync(process.execPath, ['scripts/verify-artifacts.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(result).toContain('Verified 3 archives');
}, 30_000);
