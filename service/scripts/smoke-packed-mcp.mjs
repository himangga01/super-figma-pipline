import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { artifactRoot, root } from './release-common.mjs';

const folder = await mkdtemp(join(tmpdir(), 'sfp-isolated-install-'));
await writeFile(join(folder, 'package.json'), '{"private":true,"type":"module"}\n');
const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
execFileSync(
  process.execPath,
  [
    npm,
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    join(artifactRoot, 'mcp.tgz'),
    join(artifactRoot, 'cli.tgz'),
  ],
  {
    cwd: folder,
    windowsHide: true,
    stdio: 'pipe',
    timeout: 180_000,
    maxBuffer: 8_000_000,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  },
);
const run = args =>
  execFileSync(process.execPath, args, {
    cwd: folder,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NODE_PATH: '' },
  });
const tools = JSON.parse(run(['node_modules/@sfp/cli/dist/index.mjs', 'tools', 'list']));
const catalog = JSON.parse(await readFile(join(root, 'capabilities/union-manifest.json'), 'utf8'));
const expectedNames = catalog.canonicalTools.map(tool => tool.name).toSorted();
const installedNames = tools.tools.map(tool => tool.name).toSorted();
if (JSON.stringify(installedNames) !== JSON.stringify(expectedNames))
  throw new Error('PACKED_TOOL_REGISTRY_MISMATCH');
if (!run(['node_modules/@sfp/mcp/dist/daemon-entry.mjs', '--help']).includes('sfp-daemon'))
  throw new Error('PACKED_DAEMON_ENTRY_INVALID');
run([
  '--input-type=module',
  '-e',
  'import {readFile} from "node:fs/promises";import {createRequire} from "node:module";const req=createRequire(import.meta.url);const p=req.resolve("@sfp/mcp");await readFile(new URL("./plugin/manifest.json",new URL("file:///"+p.replaceAll("\\\\","/"))));',
]);
execFileSync(
  process.execPath,
  [join(root, 'scripts/smoke-runtime-entries.mjs'), join(folder, 'node_modules/@sfp/mcp/dist')],
  { cwd: folder, windowsHide: true, stdio: 'inherit', timeout: 120_000 },
);
process.stdout.write(
  `Standalone install passed: ${tools.tools.length} tools, daemon and plugin assets\n`,
);
