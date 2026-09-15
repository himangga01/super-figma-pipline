/** Abandon a logical waiter without cancelling the shared operation it observes. */
export const waitLogically = <T>(
  pending: Promise<T>,
  signal?: AbortSignal,
  releaseLate?: (value: T) => Promise<void>,
): Promise<T> => {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    let abandoned = false;
    const abort = () => {
      abandoned = true;
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void pending.then(
      value => {
        signal.removeEventListener('abort', abort);
        if (abandoned) {
          // A late cleanup failure cannot replace the already delivered cancellation.
          void releaseLate?.(value).catch(() => {});
        } else resolve(value);
        return undefined;
      },
      error => {
        signal.removeEventListener('abort', abort);
        if (!abandoned) reject(error);
        return undefined;
      },
    );
  });
};
