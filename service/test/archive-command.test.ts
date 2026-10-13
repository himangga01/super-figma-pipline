import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { resolveArchiveTar } from '../scripts/archive-command.mjs';

it.skipIf(process.platform !== 'win32')(
  'reads and extracts absolute Windows tgz and zip paths when Git GNU tar precedes native tar',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-archive-path-'));
    try {
      const nativeTar = join(process.env.SystemRoot!, 'System32', 'tar.exe');
      const gitTools = join(process.env.ProgramFiles!, 'Git', 'usr', 'bin');
      expect(existsSync(join(gitTools, 'tar.exe'))).toBe(true);
      await writeFile(join(root, 'marker.txt'), 'archive path verification');
      for (const format of ['tgz', 'zip']) {
        const archive = join(root, `fixture.${format}`);
        execFileSync(
          nativeTar,
          format === 'zip'
            ? ['--format', 'zip', '-cf', archive, '-C', root, 'marker.txt']
            : ['-czf', archive, '-C', root, 'marker.txt'],
          { windowsHide: true },
        );
        const env = { ...process.env, PATH: `${gitTools};${process.env.PATH}` };
        const listing = execFileSync(resolveArchiveTar(), ['-tf', archive], {
          env,
          windowsHide: true,
          encoding: 'utf8',
        });
        expect(listing.trim()).toBe('marker.txt');
        const output = join(root, format);
        await mkdir(output);
        execFileSync(resolveArchiveTar(), ['-xf', archive, '-C', output], {
          env,
          windowsHide: true,
        });
        expect(await readFile(join(output, 'marker.txt'), 'utf8')).toBe(
          'archive path verification',
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
