/* eslint-disable no-await-in-loop -- observe only these owned isolated children */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const directory = resolve(
  process.argv[2] ?? fileURLToPath(new URL('../packages/mcp/dist', import.meta.url)),
);
const catalog = JSON.parse(
  await readFile(new URL('../capabilities/union-manifest.json', import.meta.url), 'utf8'),
);
const expectedNames = catalog.canonicalTools.map(tool => tool.name).toSorted();
const state = await mkdtemp(join(tmpdir(), 'sfp-runtime-smoke-'));
const listener = createServer();
await new Promise(done => listener.listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise(done => listener.close(done));
await mkdir(join(state, 'owner'));
const env = {
  ...process.env,
  FIGWRIGHT_PORT: String(port),
  LOCALAPPDATA: join(state, 'owner'),
  XDG_STATE_HOME: join(state, 'owner'),
};
const waitReady = async child => {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('RUNTIME_EXITED_BEFORE_READY');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ping`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* startup */
    }
    await delay(100);
  }
  throw new Error('RUNTIME_READY_TIMEOUT');
};
const stop = async (child, eof) => {
  const ended = new Promise(done => child.once('exit', done));
  if (eof) child.stdin.end();
  else child.kill('SIGTERM');
  let timer;
  await Promise.race([
    ended,
    new Promise(done => {
      timer = setTimeout(done, 5000);
    }),
  ]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    throw new Error('RUNTIME_SHUTDOWN_TIMEOUT');
  }
};
const start = name => {
  const child = spawn(process.execPath, [join(directory, name)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env,
  });
  child.stderr.resume();
  return child;
};
const mcp = start('index.mjs');
try {
  await waitReady(mcp);
  let buffer = '';
  const messages = new Map();
  mcp.stdout.on('data', chunk => {
    buffer += String(chunk);
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(line);
        messages.set(message.id, message);
      } catch {
        /* require typed response below */
      }
    }
  });
  const request = async (id, method, params) => {
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    for (let i = 0; i < 100; i++) {
      if (messages.has(id)) {
        const result = messages.get(id);
        if (result.error) throw new Error(`MCP_WIRE_ERROR:${result.error.code}`);
        return result.result;
      }
      await delay(100);
    }
    throw new Error('MCP_WIRE_TIMEOUT');
  };
  await request(1, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'sfp-package-smoke', version: '1' },
  });
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const result = await request(2, 'tools/list', {});
  if (
    JSON.stringify(result.tools?.map(tool => tool.name).toSorted()) !==
    JSON.stringify(expectedNames)
  )
    throw new Error('MCP_WIRE_TOOL_REGISTRY');
} finally {
  await stop(mcp, true);
}
const daemon = start('daemon-entry.mjs');
try {
  await waitReady(daemon);
  daemon.stdin.end();
  await delay(400);
  await waitReady(daemon);
} finally {
  await stop(daemon, false);
}
process.stdout.write(
  `MCP wire=${expectedNames.length}; daemon survives stdin EOF; owned processes stopped\n`,
);
