/** The Figma sandbox does not require the browser's AbortController/DOMException globals. */
export const createSandboxCancellation = () => {
  let aborted = false;
  let reason: unknown;
  const signal = Object.freeze({
    get aborted() {
      return aborted;
    },
    get reason() {
      return reason;
    },
    throwIfAborted() {
      if (aborted) throw reason;
    },
  });
  return Object.freeze({
    signal,
    abort(cause: unknown = new Error('sandbox operation cancelled')) {
      if (aborted) return;
      reason = cause;
      aborted = true;
    },
  });
};
