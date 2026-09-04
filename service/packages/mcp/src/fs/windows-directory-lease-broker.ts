import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

export interface DirectoryLeaseBrokerOptions {
  spawnChild(): ChildProcessWithoutNullStreams;
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

interface PendingRequest {
  action: 'acquire' | 'release';
  resolve(response: { identity?: string }): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

const brokerError = (code: string, message: string, cause?: unknown): Error & { code: string } =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });

const validPositive = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

export class DirectoryLeaseBroker {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private stdoutBuffer = '';
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private state: 'starting' | 'open' | 'closing' | 'closed' = 'starting';
  private readonly readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly exitPromise: Promise<void>;
  private readonly closedPromise: Promise<void>;
  private closedResolve!: () => void;
  private invalidation: Promise<void> | null = null;
  private terminationFailure: Error | null = null;

  private constructor(private readonly options: DirectoryLeaseBrokerOptions) {
    if (
      !validPositive(options.requestTimeoutMs) ||
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
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.acceptStdout(chunk));
    this.child.stderr.on('data', (chunk: string) => this.acceptStderr(chunk));
    this.child.once('error', error => {
      void this.invalidate(
        brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease child failed', error),
      );
    });
    this.child.once('exit', () => {
      if (this.state === 'starting' || this.state === 'open') {
        void this.invalidate(
          brokerError(
            'DIRECTORY_LEASE_PROTOCOL_INVALID',
            'directory lease child exited unexpectedly',
          ),
        );
      }
    });
  }

  static async start(options: DirectoryLeaseBrokerOptions): Promise<DirectoryLeaseBroker> {
    const broker = new DirectoryLeaseBroker(options);
    const startupTimeout = setTimeout(() => {
      void broker.invalidate(
        brokerError('DIRECTORY_LEASE_TIMEOUT', 'directory lease broker startup timed out'),
      );
    }, options.requestTimeoutMs);
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

  private acceptStdout(chunk: string): void {
    if (this.state === 'closing' || this.state === 'closed') return;
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    this.stdoutBytes += chunkBytes;
    if (this.stdoutBytes > this.options.maxStdoutBytes) {
      void this.invalidate(
        brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease stdout exceeded its cap'),
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
          brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease line exceeded its cap'),
        );
        return;
      }
      this.acceptLine(line);
      if (this.outputIsClosed()) return;
    }
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > this.options.maxLineBytes) {
      void this.invalidate(
        brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease line exceeded its cap'),
      );
    }
  }

  private outputIsClosed(): boolean {
    return this.state === 'closing' || this.state === 'closed';
  }

  private acceptStderr(chunk: string): void {
    if (this.state === 'closing' || this.state === 'closed') return;
    this.stderrBytes += Buffer.byteLength(chunk, 'utf8');
    if (this.stderrBytes > this.options.maxStderrBytes) {
      void this.invalidate(
        brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease stderr exceeded its cap'),
      );
    }
  }

  private acceptLine(line: string): void {
    if (this.state === 'starting') {
      if (line !== 'READY') {
        void this.invalidate(
          brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease broker was not ready'),
        );
        return;
      }
      this.state = 'open';
      this.readyResolve();
      return;
    }
    let response: { id?: unknown; ok?: unknown; identity?: unknown; error?: unknown };
    try {
      response = JSON.parse(line) as typeof response;
    } catch (cause) {
      void this.invalidate(
        brokerError(
          'DIRECTORY_LEASE_PROTOCOL_INVALID',
          'directory lease response is not JSON',
          cause,
        ),
      );
      return;
    }
    if (typeof response.id !== 'string' || typeof response.ok !== 'boolean') {
      void this.invalidate(
        brokerError(
          'DIRECTORY_LEASE_PROTOCOL_INVALID',
          'directory lease response shape is invalid',
        ),
      );
      return;
    }
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      void this.invalidate(
        brokerError(
          'DIRECTORY_LEASE_PROTOCOL_INVALID',
          'directory lease response has no pending owner',
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
    if (
      (pending.action === 'acquire' && typeof response.identity !== 'string') ||
      (pending.action === 'release' && response.identity !== undefined)
    ) {
      pending.reject(
        brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease response is inconsistent'),
      );
      void this.invalidate(
        brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease response is inconsistent'),
      );
      return;
    }
    pending.resolve(pending.action === 'acquire' ? { identity: response.identity as string } : {});
  }

  private async writeCommand(command: object): Promise<void> {
    if (this.state !== 'open') {
      throw brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease broker is not open');
    }
    const bytes = Buffer.from(`${JSON.stringify(command)}\n`, 'utf8');
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
      const error = brokerError(
        'DIRECTORY_LEASE_PROTOCOL_INVALID',
        'directory lease command write failed',
        cause,
      );
      await this.invalidate(error);
      throw error;
    }
  }

  private async request(
    command: { action: 'acquire'; id: string; path: string } | { action: 'release'; id: string },
  ): Promise<{ identity?: string }> {
    if (this.pending.size >= (this.options.maxPending ?? 256)) {
      throw brokerError('DIRECTORY_LEASE_PROTOCOL_INVALID', 'directory lease pending cap reached');
    }
    const response = new Promise<{ identity?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        void this.invalidate(
          brokerError('DIRECTORY_LEASE_TIMEOUT', 'directory lease request timed out'),
        );
      }, this.options.requestTimeoutMs);
      this.pending.set(command.id, { action: command.action, resolve, reject, timeout });
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
    const id = randomUUID().replaceAll('-', '');
    const response = await this.request({ action: 'acquire', id, path });
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

  replacementFailure(): Error | null {
    return this.terminationFailure;
  }
}

export class DirectoryLeaseBrokerPool {
  private active: DirectoryLeaseBroker | null = null;
  private flight: Promise<DirectoryLeaseBroker> | null = null;
  private retirement: Promise<void> = Promise.resolve();
  private fatal: Error | null = null;

  constructor(private readonly create: () => Promise<DirectoryLeaseBroker>) {}

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

  async acquire(path: string): Promise<{ identity: string; release(): Promise<void> }> {
    const broker = await this.get();
    let lease: Awaited<ReturnType<DirectoryLeaseBroker['acquire']>>;
    try {
      lease = await broker.acquire(path);
    } catch (error) {
      if (!broker.isOpen()) await this.retire(broker, false);
      throw error;
    }
    return {
      identity: lease.identity,
      release: async () => {
        try {
          await lease.release();
        } catch (error) {
          await this.retire(broker, false);
          throw error;
        }
      },
    };
  }

  async close(): Promise<void> {
    await this.retirement;
    if (this.active === null) return;
    await this.retire(this.active, true);
  }
}
