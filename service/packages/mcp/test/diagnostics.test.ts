import { fork, type ForkOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'tsdown';
import { afterEach, expect, it, vi } from 'vitest';

import { diagnosticLabels } from '../src/diagnostics-catalog.js';
import {
  Diagnostics,
  diagnosticError,
  diagnosticHeaders,
  diagnosticRoute,
  diagnosticWriterPort,
  withDiagnostics,
} from '../src/diagnostics.js';

const roots: string[] = [];
const cleanupChildren: ReturnType<typeof fork>[] = [];
const forkOptions: ForkOptions & { windowsHide: boolean } = {
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
};
afterEach(async () => {
  for (const child of cleanupChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>(resolve => child.once('exit', () => resolve()));
    }
  }
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function mutexFixture() {
  const root = await fixture();
  await mkdir(join(root, 'diagnostics'));
  return { root, port: diagnosticWriterPort(await realpath(join(root, 'diagnostics')), 'daemon') };
}
async function assertSlotReleased(port: number) {
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
  });
  await new Promise<void>(resolve => server.close(() => resolve()));
}

it('fails logging within the acquisition budget without probing or evicting an occupied foreign slot', async () => {
  const { root, port } = await mutexFixture(),
    foreign = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    foreign.once('error', reject);
    foreign.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
  });
  const signals: string[] = [],
    logger = new Diagnostics(root, 'daemon', { signal: line => signals.push(line) });
  try {
    logger.record('daemon.ready');
    expect(await logger.flush(1000)).toBe(true);
    expect(logger.status()).toMatchObject({ written: 0, writeFailures: 1, pending: 0 });
    expect(signals.join('')).toContain('DIAGNOSTICS_MUTEX_BUSY');
    expect(foreign.listening).toBe(true);
    expect(await readdir(logger.directory)).toEqual([]);
  } finally {
    await new Promise<void>(resolve => foreign.close(() => resolve()));
  }
  await assertSlotReleased(port);
});

it('recovers the identical mutex slot after an owned crashed holder without persistent lock files', async () => {
  const { root, port } = await mutexFixture(),
    worker = join(root, 'holder.mjs');
  await writeFile(
    worker,
    `import {createServer} from 'node:net';const server=createServer(socket=>socket.destroy());server.listen({port:Number(process.argv[2]),host:'127.0.0.1',exclusive:true},()=>process.send({ready:true}));`,
  );
  const child = fork(worker, [String(port)], forkOptions);
  cleanupChildren.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('message', () => resolve());
  });
  const logger = new Diagnostics(root, 'daemon', { signal: () => {} });
  logger.record('daemon.ready');
  const controller = new AbortController();
  controller.abort();
  expect(controller.signal.aborted).toBe(true);
  const exit = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill();
  await exit;
  expect(await logger.flush()).toBe(true);
  expect(logger.status()).toMatchObject({ written: 1, writeFailures: 0 });
  expect(await readdir(logger.directory)).toEqual(['daemon.jsonl']);
  await assertSlotReleased(port);
});

it('keeps ownership while an issued filesystem write is pending and reports an unconfirmed bounded flush', async () => {
  const { root, port } = await mutexFixture();
  const handle = await open(join(root, 'seed'), 'w');
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const original = prototype.writeFile;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const entered = new Promise<void>(resolve => {
    started = resolve;
  });
  let writes = 0;
  vi.spyOn(prototype, 'writeFile').mockImplementation(async function (
    this: unknown,
    ...args: unknown[]
  ) {
    writes++;
    if (writes === 1) {
      started();
      await gate;
    }
    return original.apply(this, args);
  });
  const signals: string[] = [],
    first = new Diagnostics(root, 'daemon', { signal: line => signals.push(line) });
  const second = new Diagnostics(root, 'daemon', { signal: line => signals.push(line) });
  first.record('daemon.ready');
  await entered;
  try {
    expect(await first.flush(20)).toBe(false);
    second.record('daemon.ready');
    expect(await second.flush(1000)).toBe(true);
    expect(writes).toBe(1);
    expect(first.status()).toMatchObject({ pending: 1, flushTimeouts: 1 });
    expect(second.status()).toMatchObject({ written: 0, writeFailures: 1 });
    expect(signals.join('')).toContain('flush-unconfirmed');
  } finally {
    release();
    await first.flush();
  }
  second.record('daemon.ready');
  await second.flush();
  expect(second.status().written).toBe(1);
  await assertSlotReleased(port);
});

async function fileHandlePrototype(root: string) {
  const handle = await open(join(root, 'seed'), 'w');
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  return prototype;
}

it('retries a delayed pre-write stat once with the immutable row and FIFO order, including completed rotation', async () => {
  const { root, port } = await mutexFixture(),
    prototype = await fileHandlePrototype(root);
  const original = prototype.stat;
  const clock = performance.now();
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock + elapsed);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const entered = new Promise<void>(resolve => {
    started = resolve;
  });
  let stats = 0;
  vi.spyOn(prototype, 'stat').mockImplementation(async function (
    this: unknown,
    ...args: unknown[]
  ) {
    stats++;
    if (stats === 1) {
      started();
      await gate;
      elapsed += 300;
    }
    return original.apply(this, args);
  });
  const old = JSON.stringify({ retained: 'x'.repeat(4000) }) + '\n';
  await writeFile(join(root, 'diagnostics/daemon.jsonl'), old);
  const signals: string[] = [],
    logger = new Diagnostics(root, 'daemon', {
      maxBytes: 4096,
      retainedFiles: 3,
      signal: line => signals.push(line),
    });
  const first = randomUUID(),
    second = randomUUID();
  const contextValue = { requestId: first };
  logger.record('daemon.ready', contextValue);
  contextValue.requestId = randomUUID();
  logger.record('daemon.stopped', { requestId: second });
  const controller = new AbortController();
  controller.abort();
  expect(controller.signal.aborted).toBe(true);
  await entered;
  expect(await logger.flush(20)).toBe(false);
  release();
  expect(await logger.flush()).toBe(true);
  expect(logger.status()).toMatchObject({
    written: 2,
    preWriteRetries: 1,
    recoveredWrites: 1,
    writeFailures: 0,
    dropped: 0,
    pending: 0,
  });
  const rows = (await readFile(join(logger.directory, 'daemon.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  expect(rows.map(row => row.requestId)).toEqual([first, second]);
  expect(rows.map(row => row.event)).toEqual(['daemon.ready', 'daemon.stopped']);
  expect(await readFile(join(logger.directory, 'daemon.jsonl.1'), 'utf8')).toBe(old);
  for (const file of await readdir(logger.directory))
    expect((await stat(join(logger.directory, file))).size).toBeLessThanOrEqual(4096);
  expect((await readdir(logger.directory)).length).toBeLessThanOrEqual(3);
  expect(signals.join('')).toContain('pre-write-retry');
  expect(signals.join('')).toContain('retry-recovered');
  await assertSlotReleased(port);
});

it('exhausts the one pre-write retry without appending bytes or enlarging queue and flush budgets', async () => {
  const { root, port } = await mutexFixture(),
    prototype = await fileHandlePrototype(root);
  const original = prototype.stat;
  const clock = performance.now();
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock + elapsed);
  let stats = 0;
  vi.spyOn(prototype, 'stat').mockImplementation(async function (
    this: unknown,
    ...args: unknown[]
  ) {
    stats++;
    const value = await original.apply(this, args);
    elapsed += 300;
    return value;
  });
  const signals: string[] = [],
    logger = new Diagnostics(root, 'daemon', { signal: line => signals.push(line) });
  logger.record('daemon.ready');
  expect(await logger.flush()).toBe(true);
  expect(stats).toBe(2);
  expect(logger.status()).toMatchObject({
    written: 0,
    preWriteRetries: 1,
    recoveredWrites: 0,
    writeFailures: 1,
    pending: 0,
  });
  expect((await readFile(join(logger.directory, 'daemon.jsonl'))).length).toBe(0);
  expect(signals.join('')).toContain('write-failed');
  await assertSlotReleased(port);
});

it('never retries an append-issued partial failure even when its public code imitates a pre-write deadline', async () => {
  const { root, port } = await mutexFixture(),
    prototype = await fileHandlePrototype(root);
  let writes = 0;
  vi.spyOn(prototype, 'writeFile').mockImplementation(async function (
    this: { write(bytes: Buffer): Promise<unknown> },
    data: unknown,
  ) {
    writes++;
    await this.write(Buffer.from(String(data)).subarray(0, 8));
    throw Object.assign(Error('DIAGNOSTICS_WRITE_DEADLINE'), {
      code: 'DIAGNOSTICS_WRITE_DEADLINE',
    });
  });
  const logger = new Diagnostics(root, 'daemon', { signal: () => {} });
  logger.record('daemon.ready');
  await logger.flush();
  expect(writes).toBe(1);
  expect(logger.status()).toMatchObject({
    written: 0,
    preWriteRetries: 0,
    recoveredWrites: 0,
    writeFailures: 1,
  });
  expect((await readFile(join(logger.directory, 'daemon.jsonl'))).length).toBe(8);
  await assertSlotReleased(port);
});

it('does not retry a partially completed rotation or delete the history already moved by that rotation', async () => {
  const { root, port } = await mutexFixture();
  const active = JSON.stringify({ retained: 'x'.repeat(4000) }) + '\n';
  const path = join(root, 'diagnostics/daemon.jsonl');
  await writeFile(path, active);
  await Promise.all([1, 2, 3].map(index => writeFile(`${path}.${index}`, `history-${index}\n`)));
  const clock = performance.now();
  let elapsed = 0,
    moves = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock + elapsed);
  const original = fs.promises.rename;
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, target) => {
    await original(source, target);
    moves++;
    if (moves === 1) elapsed += 300;
  });
  syncBuiltinESMExports();
  const logger = new Diagnostics(root, 'daemon', {
    maxBytes: 4096,
    retainedFiles: 4,
    signal: () => {},
  });
  logger.record('daemon.ready');
  await logger.flush();
  expect(logger.status()).toMatchObject({
    written: 0,
    preWriteRetries: 0,
    recoveredWrites: 0,
    writeFailures: 1,
  });
  expect(moves).toBe(1);
  expect(await readFile(path, 'utf8')).toBe(active);
  expect(await readFile(`${path}.1`, 'utf8')).toBe('history-1\n');
  expect(await readFile(`${path}.3`, 'utf8')).toBe('history-2\n');
  expect(await readdir(logger.directory)).toEqual(
    expect.arrayContaining(['daemon.jsonl', 'daemon.jsonl.1', 'daemon.jsonl.3']),
  );
  await assertSlotReleased(port);
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sfp-diagnostics-'));
  roots.push(root);
  return root;
}

it('keeps every currently registered public feature and tool name readable in the closed catalog', async () => {
  const featureModule = new URL('../../cli/src/service-functions.ts', import.meta.url).href;
  const toolModule = new URL('../../cli/src/service-tool-catalog.ts', import.meta.url).href;
  const { serviceFeatures } = await import(featureModule);
  const { serviceTools } = await import(toolModule);
  for (const descriptor of [...serviceFeatures(), ...serviceTools()])
    expect(diagnosticLabels.has(descriptor.name) ? undefined : descriptor.name).toBeUndefined();
});

it('keeps the file cap when two independent loggers append to the same state concurrently', async () => {
  const root = await fixture();
  await mkdir(join(root, 'diagnostics'));
  const path = join(root, 'diagnostics/daemon.jsonl');
  const signals: string[] = [];
  const first = new Diagnostics(root, 'daemon', {
    maxBytes: 4096,
    signal: line => signals.push(line),
  });
  const second = new Diagnostics(root, 'daemon', {
    maxBytes: 4096,
    signal: line => signals.push(line),
  });
  await writeFile(path, JSON.stringify({ retained: 'x'.repeat(3800) }) + '\n');
  const firstId = randomUUID(),
    secondId = randomUUID();
  first.record('daemon.ready', { requestId: firstId });
  second.record('daemon.ready', { requestId: secondId });
  const flushes = await Promise.all([first.flush(), second.flush()]);
  expect({
    flushes,
    failureSignals: signals.filter(line => JSON.parse(line).event === 'diagnostics.failure'),
  }).toEqual({ flushes: [true, true], failureSignals: [] });
  expect((await stat(path)).size).toBeLessThanOrEqual(4096);
  expect(first.status().writeFailures + second.status().writeFailures).toBe(0);
  expect([first.status().written, second.status().written]).toEqual([1, 1]);
  const records = (
    await Promise.all(
      (await readdir(first.directory)).map(async name =>
        (await readFile(join(first.directory, name), 'utf8'))
          .trim()
          .split('\n')
          .map(line => JSON.parse(line) as { requestId?: string }),
      ),
    )
  ).flat();
  expect(
    records
      .filter(row => row.requestId === firstId || row.requestId === secondId)
      .map(row => row.requestId)
      .toSorted(),
  ).toEqual([firstId, secondId].toSorted());
});

it('bounds shared diagnostics across two actual Node processes without losing JSONL framing', async () => {
  const root = await fixture(),
    source = join(import.meta.dirname, '../src/diagnostics.ts');
  await build({
    entry: [source],
    outDir: join(root, 'bundle'),
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    config: false,
    logLevel: 'silent',
  });
  const worker = join(root, 'writer.mjs'),
    state = join(root, 'state');
  await mkdir(join(state, 'diagnostics'), { recursive: true });
  await writeFile(
    join(state, 'diagnostics/daemon.jsonl'),
    JSON.stringify({ retained: 'x'.repeat(3800) }) + '\n',
  );
  await writeFile(
    worker,
    `import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';
const {Diagnostics}=await import(pathToFileURL(process.argv[2]).href);
const logger=new Diagnostics(process.argv[3],'daemon',{maxBytes:4096,retainedFiles:3,signal:()=>{}});
process.once('message',async()=>{for(let i=0;i<40;i++){logger.record('daemon.ready',{requestId:randomUUID()});await logger.flush();}
process.send({status:logger.status()},()=>process.exit(0));});process.send({ready:true});`,
  );
  const children = [0, 1].map(() =>
    fork(worker, [join(root, 'bundle/diagnostics.mjs'), state], forkOptions),
  );
  cleanupChildren.push(...children);
  const results: Array<Record<string, unknown>> = [];
  const exits = children.map(
    child =>
      new Promise<void>((resolve, reject) => {
        child.on('message', value => {
          const row = value as { status?: Record<string, unknown> };
          if (row.status) results.push(row.status);
        });
        child.once('error', reject);
        child.once('exit', code =>
          code === 0 ? resolve() : reject(Error('Diagnostic child failed')),
        );
      }),
  );
  await Promise.all(
    children.map(child => new Promise<void>(resolve => child.once('message', () => resolve()))),
  );
  children.forEach(child => child.send({ start: true }));
  await Promise.all(exits);
  expect(results).toHaveLength(2);
  for (const result of results)
    expect(result).toMatchObject({ written: 40, dropped: 0, writeFailures: 0 });
  const files = await readdir(join(state, 'diagnostics'));
  const pids = new Set<number>();
  expect(files.length).toBeLessThanOrEqual(3);
  for (const file of files) {
    const data = await readFile(join(state, 'diagnostics', file));
    expect(data.length).toBeLessThanOrEqual(4096);
    for (const line of data.toString().trim().split('\n')) {
      const record = JSON.parse(line);
      if (typeof record.pid === 'number') pids.add(record.pid);
    }
  }
  expect(pids.size).toBe(2);
}, 30000);

it('projects hostile error input, causes and stacks without retaining secrets or private URLs', () => {
  const secret = 'PRIVATE_AUTHORIZATION_VALUE',
    privateUrl = 'ws://127.0.0.1:9222/devtools/browser/private-endpoint';
  const cause = Object.assign(new Error(`Bearer ${secret} ${privateUrl}`), {
    code: secret,
    name: secret,
    input: secret,
  });
  cause.stack = `Error: ${secret}\n at ${secret} (C:/private/${secret}/control-client.ts:123:7)\n at fn (${privateUrl}:42:1)\n at fn (C:/private/${secret}.ts:9:1)`;
  const error = Object.assign(new TypeError('Invalid URL', { cause }), {
    code: 'ERR_INVALID_URL',
    input: privateUrl,
  });
  cause.cause = error;
  const projected = diagnosticError(error),
    json = JSON.stringify(projected);
  expect(json).not.toContain(secret);
  expect(json).not.toContain(privateUrl);
  expect(json).not.toContain('C:/private');
  expect(projected).toHaveLength(2);
  expect(json).toContain('ERR_INVALID_URL');
  expect(json).toContain('control-client.ts');
  expect(json).toContain('123');
  expect(json).toContain('codeHash');
  expect(diagnosticRoute('/control/network/domains/private-secret?token=secret#secret')).toBe(
    '/control/network/domains/:param',
  );
  expect(diagnosticError(Error('CONTROL_NOT_READY: private message'))).toMatchObject([
    { code: 'CONTROL_NOT_READY' },
  ]);
});

it('retains built chunk family and line locations while hashing opaque suffixes and omitting private roots', () => {
  const error = Object.assign(Error('private message'), { code: 'ERR_INVALID_URL' });
  error.stack =
    'Error: private message\n at fn (C:/private-root/commands-CSukwD4X.mjs:8613:14)\n at fn (file:///C:/private-root/commands-PRIVATE_TOKEN_VALUE.mjs:20520:30)\n at fn (C:/private-root/private-secret-CSukwD4X.mjs:9:1)';
  const result = diagnosticError(error),
    data = JSON.stringify(result);
  expect(result).toMatchObject([
    {
      stack: [
        { module: 'commands.mjs', line: 8613, column: 14 },
        { module: 'commands.mjs', line: 20520, column: 30 },
      ],
    },
  ]);
  expect(data).toContain('chunkHash');
  for (const secret of [
    'private message',
    'private-root',
    'CSukwD4X',
    'PRIVATE_TOKEN_VALUE',
    'private-secret',
  ])
    expect(data).not.toContain(secret);
});

it('bounds persisted JSONL rotation and queue pressure with observable drop signals', async () => {
  const root = await fixture(),
    signals: string[] = [];
  const logger = new Diagnostics(root, 'daemon', {
    maxBytes: 4096,
    retainedFiles: 3,
    maxPending: 2,
    signal: line => signals.push(line),
  });
  for (let index = 0; index < 8; index++) logger.record('request.test', { status: 200 });
  await logger.flush();
  expect(logger.status().dropped).toBe(6);
  expect(signals).toHaveLength(1);
  for (let index = 0; index < 100; index++) {
    logger.record('request.test', { requestId: randomUUID(), status: 200 });
    await logger.flush();
  }
  const paths = await readdir(logger.directory);
  expect(paths.toSorted()).toEqual(['daemon.jsonl', 'daemon.jsonl.1', 'daemon.jsonl.2']);
  for (const path of paths) {
    const bytes = await readFile(join(logger.directory, path));
    expect(bytes.length).toBeLessThanOrEqual(4096);
    for (const line of bytes.toString().trim().split('\n'))
      expect(JSON.parse(line).component).toBe('daemon');
  }
});

it('survives throwing error getters and hostile diagnostic context without interrupting cleanup', async () => {
  const root = await fixture(),
    logger = new Diagnostics(root, 'portal', { level: 'debug', signal: () => {} });
  for (const property of ['name', 'code', 'message', 'stack', 'cause']) {
    const error = new Error('private');
    Object.defineProperty(error, property, {
      get() {
        throw Error('private getter');
      },
    });
    expect(() => logger.record('request.error', {}, error, 'error')).not.toThrow();
  }
  const poison = new Proxy(
    {},
    {
      ownKeys() {
        throw Error('private proxy');
      },
    },
  );
  const controller = new AbortController();
  logger.record('request.error', poison, Error('private'), 'error');
  logger.record('private-token-value', {
    functionName: 'private-token-value',
    phase: 'private-token-value',
    outcome: 'private-token-value',
  });
  controller.abort();
  await logger.flush();
  expect(controller.signal.aborted).toBe(true);
  expect(logger.status()).toMatchObject({ written: 6, dropped: 1, writeFailures: 0 });
  const data = await readFile(join(logger.directory, 'portal.jsonl'), 'utf8');
  expect(data).not.toContain('private');
});

it('signals disk failure independently and continues executing request and cancellation work', async () => {
  const root = await fixture(),
    signals: string[] = [];
  await writeFile(join(root, 'diagnostics'), 'owned obstruction');
  const logger = new Diagnostics(root, 'portal', { signal: line => signals.push(line) });
  const controller = new AbortController();
  withDiagnostics(logger, { requestId: randomUUID() }, () => {
    logger.record(
      'request.error',
      { headers: { authorization: 'private' }, body: 'private' },
      Error('private'),
      'error',
    );
    controller.abort();
  });
  await logger.flush();
  expect(controller.signal.aborted).toBe(true);
  expect(logger.status()).toMatchObject({ writeFailures: 1, written: 0, pending: 0 });
  expect(signals).toHaveLength(1);
  expect(signals[0]).not.toContain('private');
});

it('shares correlation across independently built bundles used by portal and public CLI', async () => {
  const root = await fixture(),
    source = join(import.meta.dirname, '../src/diagnostics.ts');
  // Separate builds prevent the bundler from resolving both imports to a shared output chunk.
  await build({
    entry: [source],
    outDir: join(root, 'portal'),
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    config: false,
    logLevel: 'silent',
  });
  await build({
    entry: [source],
    outDir: join(root, 'cli'),
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    config: false,
    logLevel: 'silent',
  });
  const portal = await import(pathToFileURL(join(root, 'portal/diagnostics.mjs')).href);
  const cli = await import(pathToFileURL(join(root, 'cli/diagnostics.mjs')).href);
  const requestId = randomUUID(),
    jobId = randomUUID();
  const logger = new portal.Diagnostics(root, 'portal');
  expect(portal.Diagnostics).not.toBe(cli.Diagnostics);
  const headers = await portal.withDiagnostics(logger, { requestId, jobId }, async () => {
    await Promise.resolve();
    return cli.diagnosticHeaders();
  });
  expect(headers).toEqual({ 'x-sfp-parent-request-id': requestId, 'x-sfp-job-id': jobId });
  expect(diagnosticHeaders()).toEqual({});
}, 30000);
