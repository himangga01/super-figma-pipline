import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { win32 } from 'node:path';

export interface WindowsBoundaryProbeRecord {
  path: string;
  attributes: number;
}

export interface WindowsStateAclProbeRecord extends WindowsBoundaryProbeRecord {
  sddl: string;
}

type InspectionKind = 'boundary' | 'acl';

export interface WindowsBoundaryProbePoolOptions {
  spawnChild?: () => ChildProcessWithoutNullStreams;
  requestTimeoutMs?: number;
  queueTimeoutMs?: number;
  idleTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  forceKillTimeoutMs?: number;
  maxLineBytes?: number;
  maxStderrBytes?: number;
  maxCommandBytes?: number;
  maxPaths?: number;
  maxPending?: number;
}

interface RequiredProbeOptions {
  spawnChild: () => ChildProcessWithoutNullStreams;
  requestTimeoutMs: number;
  queueTimeoutMs: number;
  idleTimeoutMs: number;
  shutdownTimeoutMs: number;
  forceKillTimeoutMs: number;
  maxLineBytes: number;
  maxStderrBytes: number;
  maxCommandBytes: number;
  maxPaths: number;
  maxPending: number;
}

interface QueuedProbe {
  kind: InspectionKind;
  paths: readonly string[];
  started: boolean;
  settled: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve(records: WindowsBoundaryProbeRecord[]): void;
  reject(error: Error): void;
}

const WINDOWS_BOUNDARY_WORKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
# A PowerShell 7 caller can contribute incompatible modules through PSModulePath.
# Bind ACL commands to this trusted native executable's own security module.
Import-Module ($PSHOME + '\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$encoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $encoding
[Console]::OutputEncoding = $encoding
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $id = ''
  try {
    $request = ConvertFrom-Json -InputObject $line
    if ($null -eq $request -or $request.id -isnot [string] -or $request.id.Length -eq 0) {
      throw 'boundary request id is invalid'
    }
    $id = $request.id
    if ($null -eq $request.paths -or $request.paths -isnot [array]) {
      throw 'boundary request paths are invalid'
    }
    if ($request.kind -ne 'boundary' -and $request.kind -ne 'acl') {
      throw 'inspection request kind is invalid'
    }
    if ($request.kind -eq 'acl' -and $request.paths.Count -ne 1) {
      throw 'ACL request requires exactly one path'
    }
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($path in $request.paths) {
      if ($path -isnot [string] -or $path.Length -eq 0) {
        throw 'boundary request path is invalid'
      }
      $item = Get-Item -LiteralPath $path -Force
      $record = [ordered]@{
        path = $item.FullName
        attributes = [int64]$item.Attributes
      }
      if ($request.kind -eq 'acl') {
        $acl = Get-Acl -LiteralPath $item.FullName
        $record.sddl = $acl.Sddl
      }
      $records.Add([pscustomobject]$record)
    }
    $response = [pscustomobject]@{ id = $id; ok = $true; records = $records }
  } catch {
    $response = [pscustomobject]@{
      id = $id
      ok = $false
      error = $_.Exception.Message
    }
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
`;

const probeError = (code: string, message: string, cause?: unknown): Error & { code: string } =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });

const validPositive = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const resolvePowerShellExecutable = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const systemRoot = environment.SystemRoot;
  if (
    systemRoot === undefined ||
    !win32.isAbsolute(systemRoot) ||
    systemRoot.includes('\0') ||
    [...systemRoot].some(
      character => (character.codePointAt(0) as number) <= 0x1f || '"<>|'.includes(character),
    )
  ) {
    throw probeError(
      'WINDOWS_BOUNDARY_EXECUTABLE_INVALID',
      'Windows SystemRoot is not one validated absolute path',
    );
  }
  const normalizedRoot = win32.normalize(systemRoot);
  const executable = win32.join(
    normalizedRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  if (
    !win32.isAbsolute(executable) ||
    win32.relative(normalizedRoot, executable).startsWith('..')
  ) {
    throw probeError(
      'WINDOWS_BOUNDARY_EXECUTABLE_INVALID',
      'Windows PowerShell path escapes SystemRoot',
    );
  }
  return executable;
};

export const spawnWindowsBoundaryProbeProcess = (): ChildProcessWithoutNullStreams =>
  spawn(
    resolvePowerShellExecutable(),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(WINDOWS_BOUNDARY_WORKER_SCRIPT, 'utf16le').toString('base64'),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false },
  );

class WindowsBoundaryProbeWorker {
  private readonly child: ChildProcessWithoutNullStreams;
  private state: 'starting' | 'open' | 'closing' | 'closed' = 'starting';
  private stdoutBuffer = '';
  private stderrBytes = 0;
  private active:
    | {
        id: string;
        kind: InspectionKind;
        paths: readonly string[];
        resolve(records: WindowsBoundaryProbeRecord[]): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  private readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly exited: Promise<void>;
  private readonly closed: Promise<void>;
  private closedResolve!: () => void;
  private invalidation: Promise<void> | undefined;
  private terminationFailure: Error | undefined;
  private readonly parentExitHandler: () => void;

  private constructor(private readonly options: RequiredProbeOptions) {
    this.child = options.spawnChild();
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.closed = new Promise<void>(resolve => {
      this.closedResolve = resolve;
    });
    this.exited = new Promise<void>(resolve => {
      this.child.once('exit', () => resolve());
    });
    this.parentExitHandler = () => {
      this.child.stdin.destroy();
      this.child.kill();
    };
    process.once('exit', this.parentExitHandler);
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.acceptStdout(chunk));
    this.child.stderr.on('data', (chunk: string) => this.acceptStderr(chunk));
    this.child.once('error', cause => {
      void this.invalidate(
        probeError('WINDOWS_BOUNDARY_WORKER_EXITED', 'Windows boundary worker failed', cause),
      );
    });
    this.child.once('exit', () => {
      if (this.state === 'starting' || this.state === 'open') {
        void this.invalidate(
          probeError(
            'WINDOWS_BOUNDARY_WORKER_EXITED',
            'Windows boundary worker exited unexpectedly',
          ),
        );
      }
    });
  }

  static create(options: RequiredProbeOptions): WindowsBoundaryProbeWorker {
    return new WindowsBoundaryProbeWorker(options);
  }

  async start(): Promise<void> {
    const timer = setTimeout(() => {
      void this.invalidate(
        probeError('WINDOWS_BOUNDARY_TIMEOUT', 'Windows boundary worker startup timed out'),
      );
    }, this.options.requestTimeoutMs);
    try {
      await this.ready;
    } catch (error) {
      await this.waitForClosed();
      if (this.terminationFailure !== undefined) throw this.terminationFailure;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    this.setReferenced(false);
  }

  private setReferenced(referenced: boolean): void {
    const method = referenced ? 'ref' : 'unref';
    this.child[method]();
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      (stream as typeof stream & { ref?: () => void; unref?: () => void })[method]?.();
    }
  }

  private acceptStdout(chunk: string): void {
    if (this.state === 'closing' || this.state === 'closed') return;
    this.stdoutBuffer += chunk;
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > this.options.maxLineBytes) {
        void this.invalidate(
          probeError(
            'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
            'Windows boundary worker response exceeded its byte cap',
          ),
        );
        return;
      }
      this.acceptLine(line);
      if (this.outputIsClosed()) return;
    }
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > this.options.maxLineBytes) {
      void this.invalidate(
        probeError(
          'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
          'Windows boundary worker response exceeded its byte cap',
        ),
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
        probeError(
          'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
          'Windows boundary worker stderr exceeded its byte cap',
        ),
      );
    }
  }

  private acceptLine(line: string): void {
    if (this.state === 'starting') {
      if (line !== 'READY') {
        void this.invalidate(
          probeError('WINDOWS_BOUNDARY_PROTOCOL_INVALID', 'Windows boundary worker was not ready'),
        );
        return;
      }
      this.state = 'open';
      this.readyResolve();
      return;
    }
    const active = this.active;
    if (active === undefined) {
      void this.invalidate(
        probeError(
          'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
          'Windows boundary response has no pending request',
        ),
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (cause) {
      void this.invalidate(
        probeError(
          'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
          'Windows boundary response is not JSON',
          cause,
        ),
      );
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      void this.invalidate(
        probeError(
          'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
          'Windows boundary response shape is invalid',
        ),
      );
      return;
    }
    const response = parsed as {
      id?: unknown;
      ok?: unknown;
      records?: unknown;
      error?: unknown;
    };
    if (response.id !== active.id || typeof response.ok !== 'boolean') {
      void this.invalidate(
        probeError(
          'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
          'Windows boundary response ownership is invalid',
        ),
      );
      return;
    }
    if (!response.ok) {
      if (typeof response.error !== 'string') {
        void this.invalidate(
          probeError(
            'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
            'Windows boundary error response is invalid',
          ),
        );
        return;
      }
      this.finishActive();
      active.reject(
        probeError('WINDOWS_BOUNDARY_PROBE_FAILED', response.error || 'boundary probe failed'),
      );
      return;
    }
    if (
      !Array.isArray(response.records) ||
      response.records.length !== active.paths.length ||
      response.records.some(
        (record, index) =>
          typeof record !== 'object' ||
          record === null ||
          Array.isArray(record) ||
          typeof (record as { path?: unknown }).path !== 'string' ||
          win32.resolve((record as { path: string }).path).toLowerCase() !==
            win32.resolve(active.paths[index] as string).toLowerCase() ||
          !Number.isSafeInteger((record as { attributes?: unknown }).attributes) ||
          (active.kind === 'acl' && typeof (record as { sddl?: unknown }).sddl !== 'string'),
      )
    ) {
      void this.invalidate(
        probeError(
          'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
          'Windows boundary response records are invalid',
        ),
      );
      return;
    }
    this.finishActive();
    active.resolve(response.records as WindowsBoundaryProbeRecord[]);
  }

  private finishActive(): void {
    if (this.active === undefined) return;
    clearTimeout(this.active.timer);
    this.active = undefined;
    this.setReferenced(false);
  }

  private async writeRequest(bytes: Buffer): Promise<void> {
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
    await Promise.all([callback, accepted ? Promise.resolve() : once(this.child.stdin, 'drain')]);
  }

  async inspect(
    paths: readonly string[],
    kind: InspectionKind,
  ): Promise<WindowsBoundaryProbeRecord[]> {
    if (this.state !== 'open' || this.active !== undefined) {
      throw probeError(
        'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
        'Windows boundary worker is not available for a serialized request',
      );
    }
    const id = randomUUID().replaceAll('-', '');
    const bytes = Buffer.from(`${JSON.stringify({ id, kind, paths })}\n`, 'utf8');
    if (bytes.byteLength > this.options.maxCommandBytes) {
      throw probeError(
        'WINDOWS_BOUNDARY_REQUEST_TOO_LARGE',
        'Windows boundary request exceeded its byte cap',
      );
    }
    this.setReferenced(true);
    const response = new Promise<WindowsBoundaryProbeRecord[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.invalidate(
          probeError('WINDOWS_BOUNDARY_TIMEOUT', 'Windows boundary request timed out'),
        );
      }, this.options.requestTimeoutMs);
      this.active = { id, kind, paths, resolve, reject, timer };
    });
    const responseOutcome = response.then(
      records => ({ records }),
      error => ({ error: error as Error }),
    );
    const writeOutcome = this.writeRequest(bytes).then(
      () => undefined,
      async cause => {
        await this.invalidate(
          probeError(
            'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
            'Windows boundary request could not be written',
            cause,
          ),
        );
      },
    );
    const first = await Promise.race([
      responseOutcome.then(() => 'response' as const),
      writeOutcome.then(() => 'write' as const),
    ]);
    if (first === 'write') await writeOutcome;
    const outcome = await responseOutcome;
    if ('error' in outcome) throw outcome.error;
    return outcome.records;
  }

  private invalidate(error: Error): Promise<void> {
    this.invalidation ??= this.terminate(error, false);
    return this.invalidation;
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.exited.then(() => true),
        new Promise<false>(resolve => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async terminate(error: Error, graceful: boolean): Promise<void> {
    const wasStarting = this.state === 'starting';
    this.state = 'closing';
    if (wasStarting) this.readyReject(error);
    if (this.active !== undefined) {
      const active = this.active;
      this.finishActive();
      active.reject(error);
    }
    this.setReferenced(true);
    try {
      if (graceful) {
        this.child.stdin.end();
        if (await this.waitForExit(this.options.shutdownTimeoutMs)) return;
      }
      this.child.stdin.destroy();
      this.child.kill();
      if (await this.waitForExit(this.options.shutdownTimeoutMs)) return;
      this.child.kill('SIGKILL');
      if (await this.waitForExit(this.options.forceKillTimeoutMs)) return;
      throw probeError(
        'WINDOWS_BOUNDARY_TERMINATION_UNCONFIRMED',
        'Windows boundary worker termination could not be confirmed',
      );
    } catch (terminationError) {
      this.terminationFailure = terminationError as Error;
    } finally {
      process.removeListener('exit', this.parentExitHandler);
      this.state = 'closed';
      this.closedResolve();
    }
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;
    if (this.invalidation !== undefined) {
      await this.invalidation;
      if (this.terminationFailure !== undefined) throw this.terminationFailure;
      return;
    }
    this.invalidation = this.terminate(
      probeError('WINDOWS_BOUNDARY_WORKER_CLOSED', 'Windows boundary worker is closing'),
      true,
    );
    await this.invalidation;
    if (this.terminationFailure !== undefined) throw this.terminationFailure;
  }

  waitForClosed(): Promise<void> {
    return this.closed;
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  replacementFailure(): Error | undefined {
    return this.terminationFailure;
  }
}

const normalizeOptions = (options: WindowsBoundaryProbePoolOptions): RequiredProbeOptions => {
  const normalized: RequiredProbeOptions = {
    spawnChild: options.spawnChild ?? spawnWindowsBoundaryProbeProcess,
    requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
    queueTimeoutMs: options.queueTimeoutMs ?? 5_000,
    idleTimeoutMs: options.idleTimeoutMs ?? 5_000,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 1_000,
    forceKillTimeoutMs: options.forceKillTimeoutMs ?? 1_000,
    maxLineBytes: options.maxLineBytes ?? 1_048_576,
    maxStderrBytes: options.maxStderrBytes ?? 65_536,
    maxCommandBytes: options.maxCommandBytes ?? 262_144,
    maxPaths: options.maxPaths ?? 4_096,
    maxPending: options.maxPending ?? 64,
  };
  if (
    !validPositive(normalized.requestTimeoutMs) ||
    !validPositive(normalized.queueTimeoutMs) ||
    !validPositive(normalized.idleTimeoutMs) ||
    !validPositive(normalized.shutdownTimeoutMs) ||
    !validPositive(normalized.forceKillTimeoutMs) ||
    !validPositive(normalized.maxLineBytes) ||
    !validPositive(normalized.maxStderrBytes) ||
    !validPositive(normalized.maxCommandBytes) ||
    !validPositive(normalized.maxPaths) ||
    !validPositive(normalized.maxPending)
  ) {
    throw probeError('WINDOWS_BOUNDARY_PROTOCOL_INVALID', 'Windows boundary bounds are invalid');
  }
  return normalized;
};

export class WindowsBoundaryProbePool {
  private readonly options: RequiredProbeOptions;
  private readonly queue: QueuedProbe[] = [];
  private pending = 0;
  private draining: Promise<void> | undefined;
  private active: WindowsBoundaryProbeWorker | undefined;
  private retirement: Promise<void> = Promise.resolve();
  private fatal: Error | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private closing = false;
  private closeFlight: Promise<void> | undefined;

  constructor(options: WindowsBoundaryProbePoolOptions = {}) {
    this.options = normalizeOptions(options);
  }

  inspect(paths: readonly string[]): Promise<WindowsBoundaryProbeRecord[]> {
    return this.enqueue(paths, 'boundary');
  }

  async inspectAcl(path: string): Promise<WindowsStateAclProbeRecord> {
    const records = await this.enqueue([path], 'acl');
    // The worker validates the ACL record shape and exact count before resolving.
    return records[0] as WindowsStateAclProbeRecord;
  }

  private enqueue(
    paths: readonly string[],
    kind: InspectionKind,
  ): Promise<WindowsBoundaryProbeRecord[]> {
    if (this.closing) {
      return Promise.reject(
        probeError('WINDOWS_BOUNDARY_WORKER_CLOSED', 'Windows boundary pool is closing'),
      );
    }
    if (
      paths.length > this.options.maxPaths ||
      paths.some(path => typeof path !== 'string' || path.length === 0)
    ) {
      return Promise.reject(
        probeError('WINDOWS_BOUNDARY_REQUEST_TOO_LARGE', 'Windows boundary paths are invalid'),
      );
    }
    const sizingId = '0'.repeat(32);
    const bytes = Buffer.byteLength(`${JSON.stringify({ id: sizingId, kind, paths })}\n`, 'utf8');
    if (bytes > this.options.maxCommandBytes) {
      return Promise.reject(
        probeError(
          'WINDOWS_BOUNDARY_REQUEST_TOO_LARGE',
          'Windows boundary request exceeded its byte cap',
        ),
      );
    }
    if (this.pending >= this.options.maxPending) {
      return Promise.reject(
        probeError('WINDOWS_BOUNDARY_QUEUE_FULL', 'Windows boundary request queue is full'),
      );
    }
    this.clearIdleTimer();
    this.pending += 1;
    const result = new Promise<WindowsBoundaryProbeRecord[]>((resolve, reject) => {
      const queued: QueuedProbe = {
        kind,
        paths: [...paths],
        started: false,
        settled: false,
        timer: setTimeout(() => {
          if (queued.started || queued.settled) return;
          queued.settled = true;
          this.pending -= 1;
          reject(
            probeError(
              'WINDOWS_BOUNDARY_QUEUE_TIMEOUT',
              'Windows boundary request expired in the queue',
            ),
          );
        }, this.options.queueTimeoutMs),
        resolve,
        reject,
      };
      this.queue.push(queued);
    });
    this.startDrain();
    return result;
  }

  private startDrain(): void {
    if (this.draining !== undefined) return;
    this.draining = this.drain().finally(() => {
      this.draining = undefined;
      if (this.queue.length > 0) this.startDrain();
      else this.scheduleIdleRetirement();
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const queued = this.queue.shift() as QueuedProbe;
      if (queued.settled) continue;
      queued.started = true;
      clearTimeout(queued.timer);
      try {
        // eslint-disable-next-line no-await-in-loop -- the worker protocol intentionally serializes requests
        const worker = await this.getWorker();
        // eslint-disable-next-line no-await-in-loop -- the worker protocol intentionally serializes requests
        queued.resolve(await worker.inspect(queued.paths, queued.kind));
      } catch (error) {
        queued.reject(error as Error);
        if (this.active !== undefined && !this.active.isOpen()) {
          // eslint-disable-next-line no-await-in-loop -- replacement waits for confirmed child cleanup
          await this.retire(this.active, false).catch(() => undefined);
        }
      } finally {
        queued.settled = true;
        this.pending -= 1;
      }
    }
  }

  private async getWorker(): Promise<WindowsBoundaryProbeWorker> {
    await this.retirement;
    if (this.fatal !== undefined) throw this.fatal;
    if (this.active !== undefined) {
      if (this.active.isOpen()) return this.active;
      await this.retire(this.active, false).catch(() => undefined);
      if (this.fatal !== undefined) throw this.fatal;
    }
    const worker = WindowsBoundaryProbeWorker.create(this.options);
    this.active = worker;
    try {
      await worker.start();
      return worker;
    } catch (error) {
      await this.retire(worker, false).catch(() => undefined);
      if (this.fatal !== undefined) throw this.fatal;
      throw error;
    }
  }

  private async retire(worker: WindowsBoundaryProbeWorker, requestClose: boolean): Promise<void> {
    if (this.active === worker) this.active = undefined;
    const retirement = requestClose ? worker.close() : worker.waitForClosed();
    this.retirement = retirement.catch(() => undefined);
    try {
      await retirement;
    } finally {
      const failure = worker.replacementFailure();
      if (failure !== undefined) this.fatal = failure;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === undefined) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private scheduleIdleRetirement(): void {
    if (this.closing || this.active === undefined || this.idleTimer !== undefined) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      const worker = this.active;
      if (worker !== undefined) void this.retire(worker, true).catch(() => undefined);
    }, this.options.idleTimeoutMs);
    this.idleTimer.unref();
  }

  close(): Promise<void> {
    this.closeFlight ??= this.closeOnce();
    return this.closeFlight;
  }

  private async closeOnce(): Promise<void> {
    this.closing = true;
    this.clearIdleTimer();
    for (const queued of this.queue.splice(0)) {
      if (queued.settled) continue;
      clearTimeout(queued.timer);
      queued.settled = true;
      this.pending -= 1;
      queued.reject(
        probeError('WINDOWS_BOUNDARY_WORKER_CLOSED', 'Windows boundary pool is closing'),
      );
    }
    await this.draining;
    await this.retirement;
    if (this.active !== undefined) await this.retire(this.active, true);
    if (this.fatal !== undefined) throw this.fatal;
  }
}

const defaultWindowsBoundaryProbePool = new WindowsBoundaryProbePool();

export const inspectWindowsBoundaries = (
  paths: readonly string[],
): Promise<WindowsBoundaryProbeRecord[]> => defaultWindowsBoundaryProbePool.inspect(paths);

export const inspectWindowsStateAcl = (path: string): Promise<WindowsStateAclProbeRecord> =>
  defaultWindowsBoundaryProbePool.inspectAcl(path);
