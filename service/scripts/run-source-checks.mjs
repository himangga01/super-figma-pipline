/* eslint-disable no-await-in-loop -- checks and source fingerprints have a fixed evidence order */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { root, artifactRoot, sha256, publish } from './release-common.mjs';

const sourceHash = async () => {
  const names = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'service'],
    { cwd: dirname(root), windowsHide: true, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256');
  for (const name of [...new Set(names)].toSorted()) {
    try {
      hash
        .update(name)
        .update('\0')
        .update(await readFile(join(dirname(root), name)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return `sha256:${hash.digest('hex')}`;
};
const pnpm =
  process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/corepack/dist/pnpm.js');
const before = await sourceHash();
const folder = join(artifactRoot, 'source-checks');
await mkdir(folder, { recursive: true });
const checks = [
  ['verify', [pnpm, 'verify']],
  ['provenance', ['scripts/verify-upstream-lock.mjs', '--offline']],
  ['graph-memory', ['scripts/verify-graph-memory.mjs']],
  ['sbom', ['scripts/generate-sbom.mjs']],
  ['notices', ['scripts/generate-notices.mjs']],
  ['package', ['scripts/package-artifacts.mjs']],
  ['checksums', ['scripts/generate-checksums.mjs']],
  ['artifacts', ['scripts/verify-artifacts.mjs']],
  ['isolated-runtime', ['scripts/smoke-packed-mcp.mjs']],
];
const results = [];
for (const [name, args] of checks) {
  process.stdout.write(`Checking ${name}\n`);
  const started = Date.now();
  try {
    const output = execFileSync(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 64_000_000,
      timeout: 1_800_000,
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    });
    await publish(join(folder, `${name}.txt`), Buffer.from(output));
    results.push({ name, exitCode: 0, elapsedMs: Date.now() - started, logSha256: sha256(output) });
  } catch (error) {
    await publish(
      join(folder, `${name}.txt`),
      Buffer.from(String(error.stdout ?? '') + String(error.stderr ?? '')),
    );
    throw new Error(`SOURCE_CHECK_FAILED:${name}`, { cause: error });
  }
}
const after = await sourceHash();
if (before !== after) throw new Error('SOURCE_CHANGED_DURING_VERIFICATION');
const report = {
  schemaVersion: 1,
  status: 'local-source-verified',
  sourceHash: after,
  verifiedAt: new Date().toISOString(),
  checks: results,
  realFigmaValidated: false,
  targetServiceValidated: false,
  remoteCiValidated: false,
};
await publish(
  join(artifactRoot, 'source-checks-report.json'),
  Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
);
process.stdout.write(
  'Local source, artifacts and isolated runtime verified; live Figma and target-service acceptance are separate.\n',
);
