import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(root, '.wiring-'));
const referencePackage = process.env.C3_SCREENED_REFERENCE_PACKAGE;
if (!referencePackage) throw Error('Exact screened C3 reference package artifact required');
const expressPath = createRequire(referencePackage).resolve('express');
await mkdir(join(scratch, 'server/notes'), { recursive: true }); await mkdir(join(scratch, 'build/server'), { recursive: true }); await mkdir(join(scratch, 'build/client/assets'), { recursive: true });
for (const file of ['store.mjs', 'handler.mjs']) await copyFile(join(root, file), join(scratch, 'server/notes', file));
// Only package resolution differs; the emitted server wiring and actual Express stay intact.
const code = (await readFile(join(root, 'integration/server.js'), 'utf8')).replace("from 'express'", "from '" + pathToFileURL(expressPath).href + "'");
await writeFile(join(scratch, 'server.js'), code); await writeFile(join(scratch, 'package.json'), '{"type":"module"}');
await writeFile(join(scratch, 'build/server/index.js'), "export const app=(req,res)=>res.status(200).type('html').send('<main>Independent generated renderer fixture</main>');\n");
await writeFile(join(scratch, 'build/client/assets/owned.txt'), 'owned static asset');
const env = {}; for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
const child = spawn(process.execPath, ['server.js'], { cwd: scratch, env: { ...env, PORT: '0', DATABASE_PATH: join(scratch, 'notes.sqlite') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', origin; const checks = [];
try {
  origin = await Promise.race([new Promise((ready, reject) => { child.stdout.on('data', value => { stdout += value; const line = stdout.split('\n').find(value => value.includes('"event":"ready"')); if (line) ready(JSON.parse(line).origin); }); child.once('exit', () => reject(Error('Owned server exited'))); }), new Promise((_, reject) => setTimeout(() => reject(Error('Readiness timed out')), 10000).unref())]);
  const api = await fetch(origin + '/api/notes', { signal: AbortSignal.timeout(5000) }); assert.equal(api.status, 401); assert.equal((await api.json()).error, 'AUTH_REQUIRED'); checks.push('real-api-mounted-before-renderer');
  const html = await fetch(origin + '/', { signal: AbortSignal.timeout(5000) }); assert.equal(html.status, 200); assert.match(await html.text(), /Independent generated renderer fixture/u); checks.push('independent-generated-renderer-mounted');
  const staticAsset = await fetch(origin + '/assets/owned.txt', { signal: AbortSignal.timeout(5000) }); assert.equal(staticAsset.status, 200); assert.equal(await staticAsset.text(), 'owned static asset'); checks.push('owned-static-assets');
} finally {
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(Error('Cleanup timed out')), 10000).unref())]); }
}
const receipt = { at: new Date().toISOString(), reason: 'New actual reference-compatible API/renderer/static wiring', scope: 'new-server-wiring-only', expressPath, fixtureRenderer: true, noReferenceFrontendCopied: true, sourcePackageResolutionAdaptation: true, servicePipelineAccepted: false, fullC3Acceptance: false, processes: [child.pid], exited: child.exitCode !== null || child.signalCode !== null, signalCode: child.signalCode, checks };
await writeFile(join(scratch, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ ...receipt, receipt: join(scratch, 'receipt.json') }, null, 2));
