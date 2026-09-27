import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { win32 } from 'node:path';

/**
 * Directory-lease wire protocol. Bump it whenever the lease script, its wire format or its spawn
 * changes: stored native artifact authorities bind the exact script and spawn.
 */
export const WINDOWS_DIRECTORY_LEASE_PROTOCOL = 'windows-directory-lease-v2' as const;
const READY_LINE = `READY ${WINDOWS_DIRECTORY_LEASE_PROTOCOL}`;
const RESTRICTED_PREFIX = 'RESTRICTED ';
/** Leading stderr bytes kept for diagnostics; the full stream is only counted against its cap. */
const STDERR_EXCERPT_BYTES = 4_096;
/** Output that arrives after an exit is drained for at most this long before failing startup. */
const EXIT_OUTPUT_SETTLE_MS = 500;
const MAX_WINDOWS_PATH_UNITS = 32_767;
const PRINTABLE_ASCII_LINE = /^[\x20-\x7e]*$/u;
const NON_PRINTABLE_ASCII = /[^\x20-\x7e]/gu;

export interface DirectoryLeaseBrokerOptions {
  spawnChild(): ChildProcessWithoutNullStreams;
  /** READY budget: a cold start includes Add-Type compilation and antivirus scanning. */
  startupTimeoutMs?: number;
  requestTimeoutMs: number;
  maxLineBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxCommandBytes: number;
  maxPending?: number;
  unrefChild?: boolean;
  shutdownTimeoutMs?: number;
  forceKillTimeoutMs?: number;
}

export interface DirectoryLeaseBrokerPoolOptions {
  /** Closes the broker after this long with no held or in-flight lease. */
  idleRetirementMs?: number;
}

interface PendingRequest {
  action: 'acquire' | 'release';
  pathSha256?: string;
  resolve(response: { identity?: string }): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

type DirectoryLeaseCommand =
  | { action: 'acquire'; id: string; pathUtf16B64: string }
  | { action: 'release'; id: string };

const brokerError = (code: string, message: string, cause?: unknown): Error & { code: string } =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });

const validPositive = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const pathError = (message: string): Error & { code: string } =>
  brokerError('DIRECTORY_LEASE_PATH_INVALID', message);

/**
 * Maps a path to the extended-length form that the broker opens, which is the same form that Node's
 * fs opens: drive paths gain `\\?\`, UNC paths gain `\\?\UNC\`, and paths that already carry a
 * `\\?\` or `\\.\` prefix are kept verbatim. Unicode normalization is never applied.
 */
export const directoryLeaseTarget = (path: string): string => {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    throw pathError('directory lease path is empty or contains NUL');
  }
  if (path.startsWith('\\\\?\\') || path.startsWith('\\\\.\\')) return path;
  const resolved = win32.resolve(path);
  if (resolved.startsWith('\\\\')) return `\\\\?\\UNC\\${resolved.slice(2)}`;
  if (/^[A-Za-z]:\\/u.test(resolved)) return `\\\\?\\${resolved}`;
  throw pathError('directory lease path is not fully qualified');
};

/**
 * Encodes a lease target for the ASCII-only wire: base64 of its exact UTF-16LE code units, plus the
 * SHA-256 that the broker must echo for the bytes it received.
 */
export const encodeDirectoryLeasePath = (
  target: string,
): { pathUtf16B64: string; pathSha256: string } => {
  if (target.length === 0 || target.length > MAX_WINDOWS_PATH_UNITS || target.includes('\0')) {
    throw pathError('directory lease path exceeds the Windows path limit');
  }
  const bytes = Buffer.from(target, 'utf16le');
  return {
    pathUtf16B64: bytes.toString('base64'),
    pathSha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

/** Escapes every code unit outside printable ASCII so no console code page can alter a line. */
const asciiJsonLine = (value: object): string =>
  `${JSON.stringify(value).replace(NON_PRINTABLE_ASCII, character => {
    let escaped = '';
    for (let index = 0; index < character.length; index += 1) {
      escaped += `\\u${character.charCodeAt(index).toString(16).padStart(4, '0')}`;
    }
    return escaped;
  })}\n`;

const XML_ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

/** PowerShell writes redirected errors as CLIXML; keep only the error-stream text. */
const stderrExcerptText = (bytes: Buffer): string => {
  const text = new TextDecoder('utf-8').decode(bytes);
  const readable = text.startsWith('#< CLIXML')
    ? [...text.matchAll(/<S S="Error">([^<]*)<\/S>/gu)]
        .map(match =>
          (match[1] ?? '')
            .replace(/&(?:lt|gt|quot|apos|amp);/gu, entity => XML_ENTITIES[entity] ?? entity)
            .replace(/_x([0-9A-Fa-f]{4})_/gu, (_, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            ),
        )
        .join('')
    : text;
  return readable.replace(/\s+/gu, ' ').trim();
};

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const streamSettled = (stream: NodeJS.ReadableStream): Promise<void> =>
  new Promise<void>(resolve => {
    stream.once('end', () => resolve());
    stream.once('close', () => resolve());
    stream.once('error', () => resolve());
  });

export class DirectoryLeaseBroker {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private stdoutBuffer = '';
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private readonly stderrHead: Buffer[] = [];
  private stderrHeadBytes = 0;
  private antivirusBlocked = false;
  private state: 'starting' | 'open' | 'closing' | 'closed' = 'starting';
  private readonly readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly exitPromise: Promise<void>;
  private readonly outputSettled: Promise<unknown>;
  private readonly closedPromise: Promise<void>;
  private closedResolve!: () => void;
  private invalidation: Promise<void> | null = null;
  private terminationFailure: Error | null = null;

  private constructor(private readonly options: DirectoryLeaseBrokerOptions) {
    if (
      !validPositive(options.requestTimeoutMs) ||
      !validPositive(options.startupTimeoutMs ?? options.requestTimeoutMs) ||
      !validPositive(options.maxLineBytes) ||
      !validPositive(options.maxStdoutBytes) ||
      !validPositive(options.maxStderrBytes) ||
      !validPositive(options.maxCommandBytes) ||
      !validPositive(options.maxPending ?? 256) ||
      !validPositive(options.shutdownTimeoutMs ?? options.requestTimeoutMs) ||
      !validPositive(options.forceKillTimeoutMs ?? options.requestTimeoutMs)
    ) {
      throw brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease bounds are invalid');
    }
    this.child = options.spawnChild();
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.closedPromise = new Promise<void>(resolve => {
      this.closedResolve = resolve;
    });
    this.exitPromise = new Promise<void>(resolve => {
      this.child.once('exit', () => resolve());
    });
    this.outputSettled = Promise.all([
      streamSettled(this.child.stdout),
      streamSettled(this.child.stderr),
    ]);
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.acceptStdout(chunk));
    this.child.stderr.on('data', (chunk: Buffer | string) => this.acceptStderr(chunk));
    this.child.once('error', error => {
      void this.invalidate(
        this.failure('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease child failed', error),
      );
    });
    this.child.once('exit', () => {
      if (this.state === 'open') {
        void this.invalidate(
          this.failure(
            'DIRECTORY_LEASE_PROTOCOL_INVALID',
            'directory lease child exited unexpectedly',
          ),
        );
      } else if (this.state === 'starting') {
        void this.startupExited();
      }
    });
  }

  static async start(options: DirectoryLeaseBrokerOptions): Promise<DirectoryLeaseBroker> {
    const broker = new DirectoryLeaseBroker(options);
    const startupTimeout = setTimeout(() => {
      void broker.invalidate(
        broker.failure('DIRECTORY_LEASE_TIMEOUT', 'directory lease broker startup timed out'),
      );
    }, options.startupTimeoutMs ?? options.requestTimeoutMs);
    try {
      await broker.readyPromise;
    } catch (error) {
      await broker.waitForClosed();
      if (broker.terminationFailure !== null) throw broker.terminationFailure;
      throw error;
    } finally {
      clearTimeout(startupTimeout);
    }
    if (options.unrefChild === true) {
      broker.child.unref();
      (broker.child.stdin as typeof broker.child.stdin & { unref?: () => void }).unref?.();
      (broker.child.stdout as typeof broker.child.stdout & { unref?: () => void }).unref?.();
      (broker.child.stderr as typeof broker.child.stderr & { unref?: () => void }).unref?.();
    }
    return broker;
  }

  /** Builds a broker failure that carries the first 4 KiB of stderr seen so far. */
  private failure(code: string, message: string, cause?: unknown): Error & { code: string } {
    if (this.stderrHeadBytes === 0) return brokerError(code, message, cause);
    const head = Buffer.concat(this.stderrHead);
    const excerpt = stderrExcerptText(head);
    return Object.assign(
      brokerError(code, excerpt === '' ? message : `${message} (stderr: ${excerpt})`, cause),
      { stderr: excerpt, stderrBytes: this.stderrBytes, stderrBase64: head.toString('base64') },
    );
  }

  /** A child that exits before READY may still be flushing why; classify it after the drain. */
  private async startupExited(): Promise<void> {
    await Promise.race([this.outputSettled, delay(EXIT_OUTPUT_SETTLE_MS)]);
    if (this.state !== 'starting') return;
    void this.invalidate(
      this.antivirusBlocked
        ? this.failure(
            'HOST_POWERSHELL_RESTRICTED',
            'antivirus (AMSI) blocked the Windows directory lease helper script',
          )
        : this.failure(
            'DIRECTORY_LEASE_PROTOCOL_INVALID',
            'directory lease child exited unexpectedly',
          ),
    );
  }

  private restricted(detail: string): Error & { code: string } {
    const [kind = '', ...rest] = detail.split(' ');
    if (kind === 'language-mode') {
      return this.failure(
        'HOST_POWERSHELL_RESTRICTED',
        `Windows PowerShell runs in ${rest.join(' ') || 'a restricted'} language mode; the directory lease helper requires FullLanguage`,
      );
    }
    if (kind === 'add-type') {
      const reason = Buffer.from(rest.join(''), 'base64').toString('utf16le').trim();
      return this.failure(
        'HOST_POWERSHELL_RESTRICTED',
        `Windows PowerShell cannot compile the directory lease helper (Add-Type)${reason === '' ? '' : `: ${reason}`}`,
      );
    }
    return this.failure(
      'HOST_POWERSHELL_RESTRICTED',
      `Windows PowerShell is restricted: ${detail}`,
    );
  }

  private acceptStdout(chunk: string): void {
    if (this.state === 'closing' || this.state === 'closed') return;
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    this.stdoutBytes += chunkBytes;
    if (this.stdoutBytes > this.options.maxStdoutBytes) {
      void this.invalidate(
        this.failure('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease stdout exceeded its cap'),
      );
      return;
    }
    this.stdoutBuffer += chunk;
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > this.options.maxLineBytes) {
        void this.invalidate(
          this.failure('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease line exceeded its cap'),
        );
        return;
      }
      if (!PRINTABLE_ASCII_LINE.test(line)) {
        void this.invalidate(
          this.failure('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease output is not ASCII'),
        );
        return;
      }
      this.acceptLine(line);
      if (this.outputIsClosed()) return;
    }
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > this.options.maxLineBytes) {
      void this.invalidate(
        this.failure('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease line exceeded its cap'),
      );
    }
  }

  private outputIsClosed(): boolean {
    return this.state === 'closing' || this.state === 'closed';
  }

  private acceptStderr(chunk: Buffer | string): void {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    this.stderrBytes += bytes.byteLength;
    if (this.stderrHeadBytes < STDERR_EXCERPT_BYTES) {
      const kept = Buffer.from(bytes.subarray(0, STDERR_EXCERPT_BYTES - this.stderrHeadBytes));
      this.stderrHead.push(kept);
      this.stderrHeadBytes += kept.byteLength;
    }
    if (bytes.includes('ScriptContainedMaliciousContent')) this.antivirusBlocked = true;
    if (this.state === 'closing' || this.state === 'closed') return;
    if (this.stderrBytes > this.options.maxStderrBytes) {
      void this.invalidate(
        this.failure('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease stderr exceeded its cap'),
      );
    }
  }

  private acceptLine(line: string): void {
    if (this.state === 'starting') {
      if (line === READY_LINE) {
        this.state = 'open';
        this.readyResolve();
        return;
      }
      void this.invalidate(
        line.startsWith(RESTRICTED_PREFIX)
          ? this.restricted(line.slice(RESTRICTED_PREFIX.length))
          : this.failure(
              'DIRECTORY_LEASE_PROTOCOL_INVALID',
              'directory lease broker was not ready',
            ),
      );
      return;
    }
    let response: {
      id?: unknown;
      ok?: unknown;
      identity?: unknown;
      pathSha256?: unknown;
      error?: unknown;
    };
    try {
      response = JSON.parse(line) as typeof response;
    } catch (cause) {
      void this.invalidate(
        this.failure(
          'DIRECTORY_LEASE_PROTOCOL_INVALID',
          'directory lease response is not JSON',
          cause,
        ),
      );
      return;
    }
    if (
      typeof response !== 'object' ||
      response === null ||
      Array.isArray(response) ||
      typeof response.id !== 'string' ||
      typeof response.ok !== 'boolean'
    ) {
      void this.invalidate(
        this.failure(
          'DIRECTORY_LEASE_PROTOCOL_INVALID',
          'directory lease response shape is invalid',
        ),
      );
      return;
    }
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      // The broker answers requests it could not parse with an empty id; Node never sends one.
      const detail = typeof response.error === 'string' ? `: ${response.error}` : '';
      void this.invalidate(
        this.failure(
          'DIRECTORY_LEASE_PROTOCOL_INVALID',
          `directory lease response has no pending owner${detail}`,
        ),
      );
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.ok !== true) {
      pending.reject(
        brokerError(
          pending.action === 'release'
            ? 'DIRECTORY_LEASE_RELEASE_FAILED'
            : 'DIRECTORY_LEASE_ACQUIRE_FAILED',
          typeof response.error === 'string' ? response.error : 'directory lease command failed',
        ),
      );
      return;
    }
    const consistent =
      pending.action === 'acquire'
        ? typeof response.identity === 'string' &&
          /^[0-9]+:[0-9]+$/u.test(response.identity) &&
          typeof response.pathSha256 === 'string' &&
          /^[0-9a-f]{64}$/u.test(response.pathSha256)
        : response.identity === undefined && response.pathSha256 === undefined;
    if (!consistent) {
      const error = this.failure(
        'DIRECTORY_LEASE_PROTOCOL_INVALID',
        'directory lease response is inconsistent',
      );
      pending.reject(error);
      void this.invalidate(error);
      return;
    }
    if (pending.action === 'acquire' && response.pathSha256 !== pending.pathSha256) {
      // The child now holds a handle to a path Node did not ask for; closing it releases that.
      const error = brokerError(
        'DIRECTORY_LEASE_ECHO_MISMATCH',
        'directory lease broker echoed a different path than requested',
      );
      pending.reject(error);
      void this.invalidate(error);
      return;
    }
    pending.resolve(pending.action === 'acquire' ? { identity: response.identity as string } : {});
  }

  private async writeCommand(command: DirectoryLeaseCommand): Promise<void> {
    if (this.state !== 'open') {
      throw brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease broker is not open');
    }
    const line = asciiJsonLine(command);
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.byteLength !== line.length) {
      throw brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease command is not ASCII');
    }
    if (bytes.byteLength > this.options.maxCommandBytes) {
      throw brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease command exceeds cap');
    }
    let callbackResolve!: () => void;
    let callbackReject!: (error: Error) => void;
    const callback = new Promise<void>((resolve, reject) => {
      callbackResolve = resolve;
      callbackReject = reject;
    });
    const accepted = this.child.stdin.write(bytes, error => {
      if (error === null || error === undefined) callbackResolve();
      else callbackReject(error);
    });
    try {
      await Promise.all([callback, accepted ? Promise.resolve() : once(this.child.stdin, 'drain')]);
    } catch (cause) {
      const error = this.failure(
        'DIRECTORY_LEASE_PROTOCOL_INVALID',
        'directory lease command write failed',
        cause,
      );
      await this.invalidate(error);
      throw error;
    }
  }

  private async request(
    command: DirectoryLeaseCommand,
    pathSha256?: string,
  ): Promise<{ identity?: string }> {
    if (this.pending.size >= (this.options.maxPending ?? 256)) {
      throw brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease pending cap reached');
    }
    const response = new Promise<{ identity?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        void this.invalidate(
          this.failure('DIRECTORY_LEASE_TIMEOUT', 'directory lease request timed out'),
        );
      }, this.options.requestTimeoutMs);
      this.pending.set(command.id, {
        action: command.action,
        ...(pathSha256 === undefined ? {} : { pathSha256 }),
        resolve,
        reject,
        timeout,
      });
    });
    try {
      await this.writeCommand(command);
    } catch (error) {
      const pending = this.pending.get(command.id);
      if (pending !== undefined) {
        this.pending.delete(command.id);
        clearTimeout(pending.timeout);
        pending.reject(error as Error);
      }
    }
    return response;
  }

  async acquire(path: string): Promise<{ identity: string; release(): Promise<void> }> {
    const encoded = encodeDirectoryLeasePath(directoryLeaseTarget(path));
    const id = randomUUID().replaceAll('-', '');
    const response = await this.request(
      { action: 'acquire', id, pathUtf16B64: encoded.pathUtf16B64 },
      encoded.pathSha256,
    );
    if (typeof response.identity !== 'string') {
      const error = brokerError(
        'DIRECTORY_LEASE_PROTOCOL_INVALID',
        'directory lease acquire omitted identity',
      );
      await this.invalidate(error);
      throw error;
    }
    let released = false;
    return {
      identity: response.identity,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await this.request({ action: 'release', id });
        } catch (cause) {
          const error =
            (cause as { code?: unknown }).code === 'DIRECTORY_LEASE_RELEASE_FAILED'
              ? (cause as Error)
              : brokerError(
                  'DIRECTORY_LEASE_RELEASE_FAILED',
                  'directory lease release failed',
                  cause,
                );
          await this.invalidate(error);
          throw error;
        }
      },
    };
  }

  private invalidate(error: Error): Promise<void> {
    if (this.invalidation !== null) return this.invalidation;
    this.invalidation = this.terminate(error);
    return this.invalidation;
  }

  private async terminate(error: Error): Promise<void> {
    const wasStarting = this.state === 'starting';
    this.state = 'closing';
    if (wasStarting) this.readyReject(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.child.stdin.destroy();
    try {
      await this.terminateChild(false);
    } catch (terminationError) {
      this.terminationFailure = terminationError as Error;
    } finally {
      this.state = 'closed';
      this.closedResolve();
    }
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.exitPromise.then(() => true),
        new Promise<false>(resolve => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async terminateChild(graceful: boolean): Promise<void> {
    const shutdownTimeoutMs = this.options.shutdownTimeoutMs ?? this.options.requestTimeoutMs;
    const forceKillTimeoutMs = this.options.forceKillTimeoutMs ?? this.options.requestTimeoutMs;
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    if (graceful) {
      this.child.stdin.end();
      if (await this.waitForExit(shutdownTimeoutMs)) return;
    }
    this.child.stdin.destroy();
    this.child.kill();
    if (await this.waitForExit(shutdownTimeoutMs)) return;
    this.child.kill('SIGKILL');
    if (await this.waitForExit(forceKillTimeoutMs)) return;
    throw brokerError(
      'DIRECTORY_LEASE_TERMINATION_UNCONFIRMED',
      'directory lease child termination could not be confirmed',
    );
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;
    if (this.invalidation !== null) {
      await this.invalidation;
      if (this.terminationFailure !== null) throw this.terminationFailure;
      return;
    }
    this.state = 'closing';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease broker is closing'),
      );
    }
    this.pending.clear();
    try {
      await this.terminateChild(true);
      this.state = 'closed';
      this.closedResolve();
    } catch (error) {
      this.terminationFailure = error as Error;
      this.state = 'closed';
      this.closedResolve();
      throw error;
    }
  }

  waitForClosed(): Promise<void> {
    return this.closedPromise;
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  /** True once half of the lifetime stdout cap is used, so an idle pool can recycle early. */
  outputBudgetExhausted(): boolean {
    return this.stdoutBytes * 2 >= this.options.maxStdoutBytes;
  }

  replacementFailure(): Error | null {
    return this.terminationFailure;
  }
}

export class DirectoryLeaseBrokerPool {
  private active: DirectoryLeaseBroker | null = null;
  private flight: Promise<DirectoryLeaseBroker> | null = null;
  private retirement: Promise<void> = Promise.resolve();
  private fatal: Error | null = null;
  /** Held leases plus in-flight acquisitions; the broker is retired only when this is zero. */
  private busy = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly create: () => Promise<DirectoryLeaseBroker>,
    private readonly options: DirectoryLeaseBrokerPoolOptions = {},
  ) {
    if (options.idleRetirementMs !== undefined && !validPositive(options.idleRetirementMs)) {
      throw brokerError(
        'DIRECTORY_LEASE_PROTOCOL_INVALID',
        'directory lease pool bounds are invalid',
      );
    }
  }

  private async get(): Promise<DirectoryLeaseBroker> {
    await this.retirement;
    if (this.fatal !== null) throw this.fatal;
    if (this.active !== null) return this.active;
    this.flight ??= this.create();
    try {
      this.active = await this.flight;
      return this.active;
    } catch (error) {
      if ((error as { code?: unknown }).code === 'DIRECTORY_LEASE_TERMINATION_UNCONFIRMED') {
        this.fatal = error as Error;
      }
      throw error;
    } finally {
      this.flight = null;
    }
  }

  private async retire(broker: DirectoryLeaseBroker, requestClose: boolean): Promise<void> {
    if (this.active === broker) this.active = null;
    const retirement = requestClose ? broker.close() : broker.waitForClosed();
    this.retirement = retirement.catch(() => undefined);
    try {
      await retirement;
    } finally {
      const failure = broker.replacementFailure();
      if (failure !== null) this.fatal = failure;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === undefined) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private settle(): void {
    this.busy -= 1;
    if (this.busy > 0) return;
    const broker = this.active;
    if (broker === null) return;
    if (broker.outputBudgetExhausted()) {
      void this.retire(broker, true).catch(() => undefined);
      return;
    }
    if (this.options.idleRetirementMs === undefined) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.busy === 0 && this.active === broker) {
        void this.retire(broker, true).catch(() => undefined);
      }
    }, this.options.idleRetirementMs);
    this.idleTimer.unref();
  }

  async acquire(path: string): Promise<{ identity: string; release(): Promise<void> }> {
    this.busy += 1;
    this.clearIdleTimer();
    let held = false;
    try {
      const broker = await this.get();
      let lease: Awaited<ReturnType<DirectoryLeaseBroker['acquire']>>;
      try {
        lease = await broker.acquire(path);
      } catch (error) {
        if (!broker.isOpen()) await this.retire(broker, false);
        throw error;
      }
      held = true;
      let released = false;
      return {
        identity: lease.identity,
        release: async () => {
          if (released) return;
          released = true;
          try {
            await lease.release();
          } catch (error) {
            await this.retire(broker, false);
            throw error;
          } finally {
            this.settle();
          }
        },
      };
    } finally {
      if (!held) this.settle();
    }
  }

  async close(): Promise<void> {
    this.clearIdleTimer();
    await this.retirement;
    if (this.active === null) return;
    await this.retire(this.active, true);
  }
}
