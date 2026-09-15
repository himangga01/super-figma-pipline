import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { root } from './release-common.mjs';
const url = process.argv[2];
if (!url)
  throw new Error(
    'Usage: pnpm desktop:acceptance <figma-url> [workspace-path]. Requires the existing paired Desktop plugin.',
  );
execFileSync(
  process.execPath,
  [
    join(root, 'packages/cli/dist/index.mjs'),
    'connect',
    '--url',
    url,
    ...(process.argv[3] ? ['--workspace', process.argv[3]] : []),
  ],
  { cwd: root, windowsHide: true, stdio: 'inherit' },
);
