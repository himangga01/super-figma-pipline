import { diagnosticError } from '../../mcp/src/diagnostics.js';

export const localCaptureFeatures = [
  'chrome.inspect.ui',
  'chrome.inspect.runtime',
  'chrome.inspect.page-api',
  'chrome.inspect.scripter',
  'chrome.export',
  'chrome.copy.svg',
  'chrome.copy.png',
] as const;
export type LocalCapturePhase = 'connecting' | 'source-selected' | 'capture-started' | 'exporting';
export interface LocalCaptureExecution {
  readonly executionId: string | undefined;
  beforeEffect(): void;
  progress(phase: LocalCapturePhase): void;
  failure(error: unknown): unknown;
}
const failures = new WeakSet<object>();
const invocations = new WeakMap<object, { executionId: string; effectIssued: boolean }>();

/** Only the creating public-library instance can attest its own exact invocation failure. */
export function isLocalCapturePreEffectFailure(error: unknown, executionId: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    failures.has(error) &&
    invocations.get(error)?.executionId === executionId &&
    invocations.get(error)?.effectIssued === false
  );
}

/** Internal origin: this factory is deliberately absent from the public package exports. */
export function localCaptureExecution(
  executionId: string | undefined,
  onProgress?: (phase: LocalCapturePhase) => void,
): LocalCaptureExecution {
  const state = { executionId: executionId ?? '', effectIssued: false };
  return {
    executionId,
    beforeEffect: () => {
      state.effectIssued = true;
    },
    progress: phase => {
      // Progress is observational and cannot change execution/cancellation outcomes.
      try {
        onProgress?.(phase);
      } catch {
        return;
      }
    },
    failure: error => {
      if (state.effectIssued || !executionId) return error;
      // Use a fresh wrapper: a previously branded identity cannot survive a later effect.
      const projection = diagnosticError(error)[0] as { code?: unknown } | undefined;
      const code =
        typeof projection?.code === 'string' && projection.code !== 'UNCLASSIFIED'
          ? projection.code
          : 'LOCAL_CAPTURE_PRE_EFFECT_FAILURE';
      const proof = Object.assign(new Error(code, { cause: error }), { code });
      failures.add(proof);
      invocations.set(proof, state);
      return proof;
    },
  };
}
