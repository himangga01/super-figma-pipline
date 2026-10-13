import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  diagnosticErrorCodes,
  diagnosticStackModules,
  diagnosticLabels,
} from './diagnostics-catalog.js';

type Level = 'debug' | 'info' | 'warn' | 'error' | 'off';
type Fields = Record<string, unknown>;
const levels: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3, off: 4 };
// Portal dynamically imports a separately bundled CLI. Both bundles must share this process context.
const contextKey = Symbol.for('sfp.diagnostics.context.v1');
const registry = globalThis as typeof globalThis & {
  [contextKey]?: AsyncLocalStorage<{ logger: Diagnostics; fields: Fields }>;
};
const context = (registry[contextKey] ??= new AsyncLocalStorage<{
  logger: Diagnostics;
  fields: Fields;
}>());
for (const entry of ['index.mjs', 'library.mjs', 'daemon-entry.mjs', 'portal-validation.mjs'])
  diagnosticStackModules.add(entry);
const stackFamilies = new Set(
  [...diagnosticStackModules]
    .map(name => name.replace(/\.(?:[cm]?js|ts)$/u, ''))
    .toSorted((left, right) => right.length - left.length),
);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function stackModule(name: string): { module: string; chunkHash?: string } | undefined {
  if (diagnosticStackModules.has(name)) return { module: name };
  const extension = /\.([cm]?js)$/u.exec(name)?.[1];
  if (!extension) return undefined;
  const stem = name.slice(0, -(extension.length + 1));
  for (const family of stackFamilies) {
    if (
      stem.startsWith(`${family}-`) &&
      /^[A-Za-z0-9_-]{6,64}$/u.test(stem.slice(family.length + 1))
    )
      return { module: `${family}.${extension}`, chunkHash: `sha256:${digest(name)}` };
  }
  return undefined;
}
const WRITE_DEADLINE_MS = 250;

/** Fixed ephemeral IPC mutex slot. Collisions serialize or fail logging, never choose another slot. */
export function diagnosticWriterPort(
  canonicalDirectory: string,
  component: 'portal' | 'daemon',
): number {
  const identity =
    process.platform === 'win32' ? canonicalDirectory.toLowerCase() : canonicalDirectory;
  return (
    55000 +
    (Number.parseInt(
      digest(`sfp-diagnostics-writer-v1\0${identity}\0${component}`).slice(0, 8),
      16,
    ) %
      10000)
  );
}
const diagnosticFailure = (code: 'DIAGNOSTICS_MUTEX_BUSY' | 'DIAGNOSTICS_WRITE_DEADLINE') =>
  Object.assign(Error(code), { code });

/** Private identity is the retry authority; error fields/prototypes cannot manufacture it. */
const preWriteDeadlines = new WeakSet<object>();
function preWriteDeadline(): Error {
  const error = diagnosticFailure('DIAGNOSTICS_WRITE_DEADLINE');
  preWriteDeadlines.add(error);
  return error;
}
function discardPreWriteDeadline(error: unknown): void {
  if (typeof error === 'object' && error !== null) preWriteDeadlines.delete(error);
}

async function acquireWriter(directory: string, component: 'portal' | 'daemon') {
  const deadline = performance.now() + WRITE_DEADLINE_MS;
  const port = diagnosticWriterPort(await realpath(directory), component);
  /* eslint-disable no-await-in-loop -- retry one fixed OS mutex slot within one deadline */
  while (true) {
    if (performance.now() >= deadline) throw diagnosticFailure('DIAGNOSTICS_MUTEX_BUSY');
    const server = createServer(socket => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
      });
      // This listener has no data protocol. The OS releases it on process termination.
      server.removeAllListeners('error');
      server.on('error', () => {});
      return {
        release: () =>
          new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve())),
          ),
      };
    } catch (error) {
      server.close();
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw diagnosticFailure('DIAGNOSTICS_MUTEX_BUSY');
      await delay(Math.min(10, remaining));
    }
  }
  /* eslint-enable no-await-in-loop */
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const words = new Set(
  'api bootstrap health activities workspaces workflows validate runs actions events service catalog jobs figma-settings probe read control status tools invoke operations approvals decide inspect cancel resume egress audit network domains default register remove rebind action-nonces portal profiles prepare plan apply capture pipeline create result results figma-mcp config ping rpc pair exchange follower challenge abdicate'.split(
    ' ',
  ),
);

/** Only fixed route words survive. Never retain query, fragment, hostname or dynamic segments. */
export function diagnosticRoute(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return 'unknown';
  return (
    '/' +
    value
      .slice(0, 2048)
      .split(/[?#]/u, 1)[0]!
      .split('/')
      .slice(1, 9)
      .map(segment => (words.has(segment) ? segment : ':param'))
      .join('/')
  );
}

/** Closed projection: even accidentally supplied request bodies or headers are discarded. */
function fields(input: Fields): Fields {
  const output: Fields = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      [
        'requestId',
        'parentRequestId',
        'daemonRequestId',
        'jobId',
        'runId',
        'workflowId',
        'workspaceId',
      ].includes(key)
    ) {
      if (typeof value === 'string' && uuid.test(value)) output[key] = value;
    } else if (['operationId', 'leaderGeneration', 'buildId'].includes(key)) {
      // Operation/generation values can contain opaque credentials. Keep a stable correlation hash.
      if (typeof value === 'string' && value.length <= 512)
        output[`${key}Hash`] = `sha256:${digest(value)}`;
      else if (typeof value === 'number' && Number.isSafeInteger(value)) output[key] = value;
    } else if (key === 'route') output.route = diagnosticRoute(value);
    else if (key === 'method' && typeof value === 'string')
      output.method = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(value)
        ? value
        : 'OTHER';
    else if (key === 'errorCode' && typeof value === 'string')
      output[key] = diagnosticErrorCodes.has(value) ? value : `sha256:${digest(value)}`;
    else if (['functionName', 'phase', 'outcome'].includes(key) && typeof value === 'string') {
      if (diagnosticLabels.has(value)) output[key] = value;
      else output[`${key}Hash`] = `sha256:${digest(value.slice(0, 4096))}`;
    } else if (
      ['durationMs', 'status', 'attempt', 'outputBytes', 'operationCount'].includes(key) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0
    )
      output[key] = Math.round(value);
    else if (
      ['argsHash', 'outputHash'].includes(key) &&
      typeof value === 'string' &&
      /^sha256:[a-f0-9]{64}$/u.test(value)
    )
      output[key] = value;
  }
  return output;
}

/** Messages/inputs are intentionally opaque. Stack locations retain module basenames and lines. */
export function diagnosticError(error: unknown): unknown[] {
  const result: unknown[] = [],
    seen = new Set<unknown>();
  let current = error;
  try {
    while (current != null && result.length < 4 && !seen.has(current)) {
      seen.add(current);
      if (!(current instanceof Error)) {
        result.push({ type: typeof current });
        break;
      }
      const code = (current as Error & { code?: unknown }).code;
      const message = typeof current.message === 'string' ? current.message : '';
      const prefix = /^([A-Z][A-Z0-9_]{2,127})(?:[:(\s]|$)/u.exec(message.slice(0, 130))?.[1];
      const safeCode =
        typeof code === 'string' && diagnosticErrorCodes.has(code)
          ? code
          : prefix && diagnosticErrorCodes.has(prefix)
            ? prefix
            : 'UNCLASSIFIED';
      const stack = (current.stack ?? '')
        .slice(0, 8192)
        .split('\n')
        .slice(1, 25)
        .flatMap(line => {
          // Drop function names, absolute roots, URLs and the stack's message line.
          if (/https?:|wss?:|data:/iu.test(line)) return [];
          const match =
            /(?:[/\\])([A-Za-z][A-Za-z0-9_-]{0,159}\.(?:[cm]?js|ts)):(\d{1,7}):(\d{1,7})\)?$/u.exec(
              line.trim(),
            );
          const location = match ? stackModule(match[1]!) : undefined;
          return match && location
            ? [{ ...location, line: Number(match[2]), column: Number(match[3]) }]
            : [];
        })
        .slice(0, 8);
      result.push({
        type: [
          'Error',
          'TypeError',
          'RangeError',
          'SyntaxError',
          'AbortError',
          'AggregateError',
        ].includes(current.name)
          ? current.name
          : 'Error',
        code: safeCode,
        ...(typeof code === 'string' && safeCode === 'UNCLASSIFIED'
          ? { codeHash: `sha256:${digest(code)}` }
          : {}),
        messageHash: `sha256:${digest(message.slice(0, 4096))}`,
        messageCharacters: message.length,
        messageHashScope: 'first-4096-characters',
        stack,
      });
      current = current.cause;
    }
  } catch {
    result.push({ type: 'uninspectable' });
  }
  return result;
}

export class Diagnostics {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private dropped = 0;
  private writeFailures = 0;
  private flushTimeouts = 0;
  private preWriteRetries = 0;
  private recoveredWrites = 0;
  private written = 0;
  private readonly level: Level;
  private readonly maxBytes: number;
  private readonly retainedFiles: number;
  private readonly maxPending: number;
  readonly directory: string;
  constructor(
    stateRoot: string,
    private readonly component: 'portal' | 'daemon',
    options: {
      level?: Level;
      maxBytes?: number;
      retainedFiles?: number;
      maxPending?: number;
      signal?: (line: string) => void;
    } = {},
  ) {
    this.directory = join(stateRoot, 'diagnostics');
    const configured = options.level ?? process.env.SFP_DIAGNOSTICS_LEVEL ?? 'info';
    this.level = Object.hasOwn(levels, configured) ? (configured as Level) : 'info';
    this.maxBytes = Math.max(4096, Math.min(options.maxBytes ?? 1024 * 1024, 16 * 1024 * 1024));
    this.retainedFiles = Math.max(1, Math.min(Math.floor(options.retainedFiles ?? 4), 10));
    this.maxPending = Math.max(1, Math.min(Math.floor(options.maxPending ?? 128), 1024));
    this.signal =
      options.signal ??
      (line => {
        process.stderr.write(line + '\n');
      });
  }
  private readonly signal: (line: string) => void;
  status() {
    return {
      enabled: this.level !== 'off',
      level: this.level,
      location: `diagnostics/${this.component}.jsonl`,
      written: this.written,
      pending: this.pending,
      dropped: this.dropped,
      writeFailures: this.writeFailures,
      flushTimeouts: this.flushTimeouts,
      preWriteRetries: this.preWriteRetries,
      recoveredWrites: this.recoveredWrites,
      maxBytes: this.maxBytes,
      retainedFiles: this.retainedFiles,
    };
  }
  private notify(
    kind: 'dropped' | 'write-failed' | 'flush-unconfirmed' | 'pre-write-retry' | 'retry-recovered',
    error?: unknown,
  ) {
    try {
      this.signal(
        JSON.stringify({
          component: this.component,
          event:
            kind === 'pre-write-retry' || kind === 'retry-recovered'
              ? 'diagnostics.retry'
              : 'diagnostics.failure',
          outcome: kind,
          dropped: this.dropped,
          writeFailures: this.writeFailures,
          flushTimeouts: this.flushTimeouts,
          preWriteRetries: this.preWriteRetries,
          recoveredWrites: this.recoveredWrites,
          ...(error === undefined ? {} : { error: diagnosticError(error) }),
        }),
      );
    } catch {
      /* Counters remain available if stderr also fails. */
    }
  }
  record(event: string, data: Fields = {}, error?: unknown, level: Level = 'info'): void {
    try {
      this.enqueue(event, data, error, level);
    } catch (projectionError) {
      this.dropped++;
      if (this.dropped === 1 || this.dropped % 100 === 0) this.notify('dropped', projectionError);
    }
  }
  private enqueue(event: string, data: Fields, error: unknown, level: Level): void {
    if (level === 'off' || levels[level] < levels[this.level]) return;
    if (this.pending >= this.maxPending) {
      this.dropped++;
      if (this.dropped === 1 || this.dropped % 100 === 0) this.notify('dropped');
      return;
    }
    const inherited = context.getStore();
    const row = {
      version: 1,
      time: new Date().toISOString(),
      pid: process.pid,
      component: this.component,
      level,
      event:
        diagnosticLabels.has(event) && /^[a-z][a-z0-9.-]{0,63}$/u.test(event)
          ? event
          : 'diagnostics.event',
      ...(diagnosticLabels.has(event)
        ? {}
        : { eventHash: `sha256:${digest(event.slice(0, 4096))}` }),
      ...fields({ ...(inherited?.logger === this ? inherited.fields : {}), ...data }),
      ...(error === undefined ? {} : { error: diagnosticError(error) }),
    };
    const line = JSON.stringify(row) + '\n';
    if (Buffer.byteLength(line) > this.maxBytes) {
      this.dropped++;
      this.notify('dropped');
      return;
    }
    this.pending++;
    this.queue = this.queue
      .then(() => this.append(line))
      .then(() => {
        this.written++;
        return undefined;
      })
      .catch(writeError => {
        this.writeFailures++;
        if (this.writeFailures === 1 || this.writeFailures % 100 === 0)
          this.notify('write-failed', writeError);
      })
      .finally(() => {
        this.pending--;
      });
  }
  async flush(timeoutMs = 2000): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      this.queue.then(() => true),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(false), Math.max(1, Math.min(timeoutMs, 2000)));
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!completed) {
      this.flushTimeouts++;
      this.notify('flush-unconfirmed');
    }
    return completed;
  }
  private async inspect(path: string): Promise<number> {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw Error('DIAGNOSTICS_PATH_UNSAFE');
      return stat.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }
  private async append(line: string): Promise<void> {
    try {
      await this.appendTransaction(line);
    } catch (error) {
      if (typeof error !== 'object' || error === null || !preWriteDeadlines.has(error)) throw error;
      preWriteDeadlines.delete(error);
      // appendTransaction's finally has released the mutex; keep this row's FIFO queue position.
      this.preWriteRetries++;
      if (this.preWriteRetries === 1 || this.preWriteRetries % 100 === 0)
        this.notify('pre-write-retry', error);
      await delay(10);
      // Exactly one retry of the same already-sanitized row, never a new event or service operation.
      await this.appendTransaction(line);
      this.recoveredWrites++;
      if (this.recoveredWrites === 1 || this.recoveredWrites % 100 === 0)
        this.notify('retry-recovered');
    }
  }
  private async appendTransaction(line: string): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw Error('DIAGNOSTICS_PATH_UNSAFE');
    const writer = await acquireWriter(this.directory, this.component);
    const transaction = { appendIssued: false, rotationStarted: false, rotationCompleted: false };
    try {
      await this.appendOwned(line, performance.now() + WRITE_DEADLINE_MS, transaction);
    } catch (error) {
      if (
        transaction.appendIssued ||
        (transaction.rotationStarted && !transaction.rotationCompleted)
      )
        discardPreWriteDeadline(error);
      throw error;
    } finally {
      // Never timer-unlock while an issued filesystem mutation remains in flight.
      try {
        await writer.release();
      } catch (error) {
        discardPreWriteDeadline(error);
        // eslint-disable-next-line no-unsafe-finally -- unconfirmed mutex release must override a pre-write expiry and prevent retry
        throw error;
      }
    }
  }
  private async appendOwned(
    line: string,
    deadline: number,
    transaction: { appendIssued: boolean; rotationStarted: boolean; rotationCompleted: boolean },
  ): Promise<void> {
    const checkDeadline = () => {
      if (performance.now() >= deadline) throw preWriteDeadline();
    };
    checkDeadline();
    const path = join(this.directory, `${this.component}.jsonl`);
    const bytes = await this.inspect(path);
    if (bytes + Buffer.byteLength(line) > this.maxBytes) {
      // Fixed, bounded filenames. Refuse links rather than following or rotating them.
      /* eslint-disable no-await-in-loop -- descending rotation must finish each move before the next */
      for (let index = this.retainedFiles - 1; index >= 1; index--) {
        const source = index === 1 ? path : `${path}.${index - 1}`,
          target = `${path}.${index}`;
        await this.inspect(target);
        await this.inspect(source);
        checkDeadline();
        transaction.rotationStarted = true;
        await rm(target, { force: true });
        try {
          checkDeadline();
          await rename(source, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      /* eslint-enable no-await-in-loop */
      if (this.retainedFiles === 1) {
        checkDeadline();
        transaction.rotationStarted = true;
        await rm(path, { force: true });
      }
      transaction.rotationCompleted = true;
    }
    checkDeadline();
    const handle = await open(
      path,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw Error('DIAGNOSTICS_PATH_UNSAFE');
      checkDeadline();
      transaction.appendIssued = true;
      await handle.writeFile(line);
    } finally {
      try {
        await handle.close();
      } catch (error) {
        discardPreWriteDeadline(error);
        // eslint-disable-next-line no-unsafe-finally -- unconfirmed handle closure must override a pre-write expiry and prevent retry
        throw error;
      }
    }
  }
}

export function withDiagnostics<T>(logger: Diagnostics, data: Fields, execute: () => T): T {
  return context.run(
    { logger, fields: { ...context.getStore()?.fields, ...fields(data) } },
    execute,
  );
}
export function diagnosticContext() {
  return context.getStore();
}
export function diagnose(event: string, data: Fields = {}, error?: unknown, level: Level = 'info') {
  context.getStore()?.logger.record(event, data, error, level);
}
export function diagnosticHeaders(): Record<string, string> {
  const data = context.getStore()?.fields;
  return {
    ...(typeof data?.requestId === 'string' && uuid.test(data.requestId)
      ? { 'x-sfp-parent-request-id': data.requestId }
      : {}),
    ...(typeof data?.jobId === 'string' && uuid.test(data.jobId)
      ? { 'x-sfp-job-id': data.jobId }
      : {}),
  };
}
export function observeHttp<T>(
  logger: Diagnostics,
  request: IncomingMessage,
  response: ServerResponse,
  data: Fields,
  execute: (requestId: string) => T,
): T {
  const requestId = randomUUID(),
    started = performance.now();
  const inherited: Fields = {
    ...data,
    requestId,
    method: request.method,
    route: request.url,
    parentRequestId: request.headers['x-sfp-parent-request-id'],
    jobId: request.headers['x-sfp-job-id'],
  };
  return withDiagnostics(logger, inherited, () => {
    response.setHeader('x-sfp-request-id', requestId);
    logger.record('http.start', {}, undefined, 'debug');
    let finished = false;
    response.once('finish', () => {
      finished = true;
      logger.record('http.finish', {
        ...inherited,
        status: response.statusCode,
        durationMs: performance.now() - started,
        outcome: response.statusCode >= 400 ? 'failed' : 'responded',
      });
    });
    response.once('close', () => {
      if (!finished)
        logger.record(
          'http.close',
          { ...inherited, durationMs: performance.now() - started, outcome: 'disconnected' },
          undefined,
          'warn',
        );
    });
    request.once('error', error =>
      logger.record('http.transport-error', inherited, error, 'error'),
    );
    return execute(requestId);
  });
}
