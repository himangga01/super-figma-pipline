import type { ConcurrencyRequirement, FileExecutionKey } from '@sfp/shared';

export interface FileExecutionResource {
  /** Already canonicalized by the caller; this queue grants no filesystem permissions. */
  readonly key: string;
  readonly mode: 'read' | 'write';
}

const MAX_RESOURCES = 64;
const MAX_KEY_LENGTH = 1024;

interface QueueEntry {
  readonly resources: readonly FileExecutionResource[];
  readonly operation: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
  readonly detachAbort: () => void;
}

interface FileQueueState {
  activeReaders: number;
  activeWriter: boolean;
}

function normalizeResources(resources: readonly FileExecutionResource[]): FileExecutionResource[] {
  if (!Array.isArray(resources) || resources.length === 0 || resources.length > MAX_RESOURCES) {
    throw new RangeError(`Execution requests require 1 to ${MAX_RESOURCES} resources`);
  }
  const modes = new Map<string, FileExecutionResource['mode']>();
  for (const resource of resources) {
    if (
      resource === null ||
      typeof resource !== 'object' ||
      typeof resource.key !== 'string' ||
      resource.key.length === 0 ||
      resource.key.length > MAX_KEY_LENGTH ||
      (resource.mode !== 'read' && resource.mode !== 'write')
    ) {
      throw new TypeError('Invalid execution resource key or mode');
    }
    if (modes.get(resource.key) !== 'write') modes.set(resource.key, resource.mode);
  }
  // Canonical keys remain opaque: no path, case, whitespace or Unicode rewriting here.
  return [...modes]
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, mode]) => ({ key, mode }));
}

export class FileExecutionQueue {
  private readonly states = new Map<string, FileQueueState>();
  private readonly waiting: QueueEntry[] = [];

  run<T>(
    key: FileExecutionKey | `portal:${string}` | null,
    concurrency: ConcurrencyRequirement,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.enqueue(
      [{ key: key ?? 'target:none', mode: concurrency === 'parallel-read' ? 'read' : 'write' }],
      operation,
    );
  }

  /**
   * Acquire all resources atomically. Raw declarations are bounded to 64 entries and keys to 1024
   * UTF-16 code units. Duplicate keys use their strongest requested mode. Pending requests have no
   * global capacity limit, preserving independent control lanes. Abort removes only a pending
   * request; after grant, the operation owns cancellation and keeps every resource until
   * settlement. Declare the complete resource set here: nested acquisition of a held resource is
   * not reentrant and can deadlock.
   */
  runResources<T>(
    resources: readonly FileExecutionResource[],
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return this.enqueue(normalizeResources(resources), operation, signal);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private enqueue<T>(
    resources: readonly FileExecutionResource[],
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const promise = new Promise<T>((resolve, reject) => {
      const abort = () => {
        const index = this.waiting.indexOf(entry);
        if (index === -1) return;
        this.waiting.splice(index, 1);
        entry.detachAbort();
        reject(signal?.reason);
        this.drain();
      };
      const entry: QueueEntry = {
        resources,
        operation,
        resolve: value => resolve(value as T | PromiseLike<T>),
        reject,
        detachAbort: () => signal?.removeEventListener('abort', abort),
      };
      this.waiting.push(entry);
      signal?.addEventListener('abort', abort, { once: true });
    });
    this.drain();
    return promise;
  }

  private drain(): void {
    // Earlier blocked requests are fairness barriers only for conflicting keys.
    // They hold no active grants, so disjoint work can still start immediately.
    const blocked = new Map<string, FileExecutionResource['mode']>();
    for (let index = 0; index < this.waiting.length;) {
      const entry = this.waiting[index]!;
      const conflicts = entry.resources.some(({ key, mode }) => {
        const state = this.states.get(key);
        const prior = blocked.get(key);
        return (
          state?.activeWriter ||
          (mode === 'write' && (state?.activeReaders ?? 0) > 0) ||
          prior === 'write' ||
          (mode === 'write' && prior === 'read')
        );
      });
      if (conflicts) {
        for (const { key, mode } of entry.resources) {
          if (blocked.get(key) !== 'write') blocked.set(key, mode);
        }
        index += 1;
        continue;
      }
      this.waiting.splice(index, 1);
      entry.detachAbort();
      for (const { key, mode } of entry.resources) {
        const state = this.states.get(key) ?? { activeReaders: 0, activeWriter: false };
        if (mode === 'write') state.activeWriter = true;
        else state.activeReaders += 1;
        this.states.set(key, state);
      }
      void Promise.resolve()
        .then(entry.operation)
        .then(
          value => {
            this.release(entry);
            return entry.resolve(value);
          },
          error => {
            this.release(entry);
            return entry.reject(error);
          },
        );
    }
  }

  private release(entry: QueueEntry): void {
    for (const { key, mode } of entry.resources) {
      const state = this.states.get(key)!;
      if (mode === 'write') state.activeWriter = false;
      else state.activeReaders -= 1;
      if (!state.activeWriter && state.activeReaders === 0) this.states.delete(key);
    }
    this.drain();
  }
}
