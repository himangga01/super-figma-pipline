import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { root } from './release-common.mjs';
const runs = [];
for (let run = 0; run < 3; run++)
  runs.push(
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--expose-gc',
          '--experimental-transform-types',
          join(root, 'scripts/graph-memory-child.mjs'),
        ],
        { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000 },
      ),
    ),
  );
process.stdout.write(`${JSON.stringify({ passed: true, runs }, null, 2)}\n`);
