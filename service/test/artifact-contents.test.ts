import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

it('verifies the actual four archives, contained files and portable portal startup', () => {
  const result = execFileSync(process.execPath, ['scripts/verify-artifacts.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(result).toContain('Verified 4 archives');
  expect(result).toContain('Verified portable portal startup');
  const manifest = JSON.parse(
    readFileSync(new URL('../artifacts/artifact-manifest.v1.json', import.meta.url), 'utf8'),
  );
  const portal = manifest.archives.find((archive: { name: string }) =>
    archive.name.includes('portal'),
  );
  expect(portal.files.some((file: { path: string }) => file.path === 'DEBUGGING.md')).toBe(true);
}, 30_000);
