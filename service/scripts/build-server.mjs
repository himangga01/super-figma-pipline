import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { computeBuildIdentity } from './build-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const identity = await computeBuildIdentity(root);
const buildId = process.env.SOURCE_DATE_EPOCH
  ? Number(process.env.SOURCE_DATE_EPOCH) * 1000
  : Date.now();
if (!Number.isSafeInteger(buildId) || buildId < 0) throw new Error('BUILD_EPOCH_INVALID');
execFileSync(process.execPath, [resolve(root, 'packages/mcp/node_modules/tsdown/dist/run.mjs')], {
  cwd: resolve(root, 'packages/mcp'),
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, SFP_BUILD_ID: String(buildId), SFP_BUILD_HASH: identity },
});
await writeFile(
  resolve(root, 'packages/mcp/dist/build-info.json'),
  `${JSON.stringify({ schemaVersion: 1, buildId, identity })}\n`,
);
