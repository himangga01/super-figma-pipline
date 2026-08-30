import type { ConcurrencyRequirement, FileExecutionKey } from '@sfp/shared';

interface QueueEntry {
  readonly mode: 'read' | 'write';
  readonly operation: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

interface FileQueueState {
  readonly waiting: QueueEntry[];
  activeReaders: number;
  activeWriter: boolean;
}

export class FileExecutionQueue {
  private readonly states = new Map<string, FileQueueState>();

  run<T>(
    key: FileExecutionKey | null,
    concurrency: ConcurrencyRequirement,
    operation: () => Promise<T>,
  ): Promise<T> {
    const queueKey = key ?? 'target:none';
    const state = this.states.get(queueKey) ?? {
      waiting: [],
      activeReaders: 0,
      activeWriter: false,
    };
    this.states.set(queueKey, state);
    const promise = new Promise<T>((resolve, reject) => {
      state.waiting.push({
        mode: concurrency === 'parallel-read' ? 'read' : 'write',
        operation: operation as () => Promise<unknown>,
        resolve: value => resolve(value as T | PromiseLike<T>),
        reject,
      });
    });
    this.drain(queueKey, state);
    return promise;
  }

  private drain(queueKey: string, state: FileQueueState): void {
    if (state.activeWriter) return;
    const first = state.waiting[0];
    if (first === undefined) {
      if (state.activeReaders === 0) this.states.delete(queueKey);
      return;
    }
    if (first.mode === 'write') {
      if (state.activeReaders !== 0) return;
      state.waiting.shift();
      state.activeWriter = true;
      void Promise.resolve()
        .then(first.operation)
        .then(first.resolve, first.reject)
        .finally(() => {
          state.activeWriter = false;
          this.drain(queueKey, state);
        });
      return;
    }
    while (state.waiting[0]?.mode === 'read' && !state.activeWriter) {
      const reader = state.waiting.shift()!;
      state.activeReaders += 1;
      void Promise.resolve()
        .then(reader.operation)
        .then(reader.resolve, reader.reject)
        .finally(() => {
          state.activeReaders -= 1;
          this.drain(queueKey, state);
        });
    }
  }
}
