import {
  AuthenticatedHelloSchema,
  ErrorCode,
  PairErrorCodeSchema,
  PairExchangeRequestSchema,
  PairExchangeResultSchema,
  type PairErrorCode,
  type PairExchangeRequest,
  type PairExchangeResult,
} from '@sfp/shared';
import { tryOnScopeDispose } from '@vueuse/core';
import { readonly, type Ref, ref } from 'vue';
import { z } from 'zod';

import { type RelayClient, type RelayHelloSeed, type RelayHelloSnapshot } from '../relay/client.js';

export const PAIR_RESPONSE_MAX_BYTES = 16_384;
const PAIR_EXCHANGE_URL = 'http://127.0.0.1:3055/pair/exchange';

const PairSubmissionSchema = z
  .object({ challengeId: z.string(), code: z.string(), paste: z.string() })
  .strict();
const PairErrorResponseSchema = z
  .object({
    code: PairErrorCodeSchema,
    attemptsRemaining: z.number().int().min(0).max(5).optional(),
  })
  .strict();
const RelayHelloSnapshotSchema = AuthenticatedHelloSchema.omit({ credential: true, nonce: true })
  .strict()
  .readonly();

class PairingUiError extends Error {
  constructor(
    readonly code: PairErrorCode | 'PAIR_BODY_TOO_LARGE',
    readonly attemptsRemaining?: number,
  ) {
    super(code);
    this.name = 'PairingUiError';
  }
}

export type PairingStatus =
  | 'unpaired'
  | 'entering'
  | 'exchange-pending'
  | 'wrong'
  | 'expired'
  | 'used'
  | 'rate-limited'
  | 'hello-pending'
  | 'connected'
  | 'reconnecting'
  | 'resume-expired'
  | 'protocol-mismatch';

export interface PairingViewState {
  status: PairingStatus;
  errorCode: PairErrorCode | null;
  attemptsRemaining: number | null;
  expiresAt: number | null;
}

export interface PairingController {
  state: Readonly<Ref<Readonly<PairingViewState>>>;
  challengeId: Ref<string>;
  code: Ref<string>;
  paste: Ref<string>;
  begin(): void;
  submit(): Promise<void>;
  cancel(): void;
  reset(): void;
  dispose(): void;
}

export const parsePairSubmission = (input: unknown): PairExchangeRequest => {
  const parsed = PairSubmissionSchema.safeParse(input);
  if (!parsed.success) throw new PairingUiError('PAIR_BODY_INVALID');
  const separate = parsed.data.challengeId !== '' || parsed.data.code !== '';
  const pasted = parsed.data.paste !== '';
  let candidate: unknown;
  if (separate && !pasted) {
    candidate = { challengeId: parsed.data.challengeId, code: parsed.data.code };
  } else if (!separate && pasted) {
    const match = /^SFP-([A-Z2-7]{10})-(\d{8})$/u.exec(parsed.data.paste);
    if (match === null) throw new PairingUiError('PAIR_BODY_INVALID');
    candidate = { challengeId: match[1], code: match[2] };
  } else {
    throw new PairingUiError('PAIR_BODY_INVALID');
  }
  const request = PairExchangeRequestSchema.safeParse(candidate);
  if (!request.success) throw new PairingUiError('PAIR_BODY_INVALID');
  return request.data;
};

const readBoundedResponse = async (
  response: Response,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    if (!/^(?:0|[1-9]\d*)$/u.test(declared)) {
      await response.body?.cancel().catch(() => undefined);
      throw new PairingUiError('PAIR_BODY_INVALID');
    }
    if (Number(declared) > PAIR_RESPONSE_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new PairingUiError('PAIR_BODY_TOO_LARGE');
    }
  }
  signal.throwIfAborted();
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = (): void => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- streamed admission is deliberately sequential
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      const bytes = next.value;
      if (bytes.byteLength > PAIR_RESPONSE_MAX_BYTES - total) {
        // eslint-disable-next-line no-await-in-loop -- cancel the exact stream before rejecting
        await reader.cancel().catch(() => undefined);
        throw new PairingUiError('PAIR_BODY_TOO_LARGE');
      }
      total += bytes.byteLength;
      chunks.push(bytes);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

export const exchangePairCode = async (
  untrustedRequest: PairExchangeRequest,
  signal: AbortSignal,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): Promise<PairExchangeResult> => {
  const parsedRequest = PairExchangeRequestSchema.safeParse(untrustedRequest);
  if (!parsedRequest.success) throw new PairingUiError('PAIR_BODY_INVALID');
  const request = parsedRequest.data;
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetchImplementation(PAIR_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new PairingUiError('PAIR_INTERNAL');
  }
  const bytes = await readBoundedResponse(response, signal);
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new PairingUiError('PAIR_BODY_INVALID');
  }
  if (response.ok) {
    const result = PairExchangeResultSchema.safeParse(decoded);
    if (!result.success) throw new PairingUiError('PAIR_BODY_INVALID');
    return result.data;
  }
  const failure = PairErrorResponseSchema.safeParse(decoded);
  if (!failure.success) throw new PairingUiError('PAIR_BODY_INVALID');
  throw new PairingUiError(failure.data.code, failure.data.attemptsRemaining);
};

const statusForError = (code: PairErrorCode): PairingStatus => {
  if (code === 'PAIR_CODE_WRONG') return 'wrong';
  if (code === 'PAIR_RATE_LIMITED') return 'rate-limited';
  if (code.includes('EXPIRED'))
    return code.startsWith('PAIR_RESUME_') ? 'resume-expired' : 'expired';
  if (code.includes('USED')) return 'used';
  return 'unpaired';
};

const sameHelloSnapshot = (
  left: Readonly<RelayHelloSnapshot>,
  right: Readonly<RelayHelloSnapshot>,
): boolean => {
  const leftIdentity = left.fileIdentity;
  const rightIdentity = right.fileIdentity;
  const sameIdentity =
    leftIdentity.kind === rightIdentity.kind &&
    (leftIdentity.kind === 'unstable-readonly' && rightIdentity.kind === 'unstable-readonly'
      ? leftIdentity.sessionId === rightIdentity.sessionId &&
        leftIdentity.pluginGeneration === rightIdentity.pluginGeneration
      : leftIdentity.kind !== 'unstable-readonly' &&
        rightIdentity.kind !== 'unstable-readonly' &&
        leftIdentity.value === rightIdentity.value);
  return (
    sameIdentity &&
    left.protocolVersion === right.protocolVersion &&
    left.productVersion === right.productVersion &&
    left.pluginVersion === right.pluginVersion &&
    left.pluginGeneration === right.pluginGeneration &&
    left.editorType === right.editorType &&
    left.mode === right.mode &&
    left.fileName === right.fileName &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every((capability, index) => capability === right.capabilities[index])
  );
};

export const usePairing = (options: {
  client: RelayClient;
  resolveHello(seed: Readonly<RelayHelloSeed>): RelayHelloSnapshot | Promise<RelayHelloSnapshot>;
  fetch?: typeof globalThis.fetch;
}): PairingController => {
  const state = ref<Readonly<PairingViewState>>({
    status: 'unpaired',
    errorCode: null,
    attemptsRemaining: null,
    expiresAt: null,
  });
  const challengeId = ref('');
  const code = ref('');
  const paste = ref('');
  let active: AbortController | null = null;
  let disposed = false;

  const setState = (next: PairingViewState): void => {
    if (!disposed) state.value = Object.freeze(next);
  };
  const clearSecrets = (): void => {
    code.value = '';
    paste.value = '';
  };
  const stopRelay = options.client.subscribe(relay => {
    if (relay.status === 'connected') {
      setState({ status: 'connected', errorCode: null, attemptsRemaining: null, expiresAt: null });
    } else if (relay.status === 'reconnecting') {
      setState({
        status: 'reconnecting',
        errorCode: null,
        attemptsRemaining: null,
        expiresAt: null,
      });
    } else if (relay.status === 'disconnected' && relay.lastError !== null) {
      const parsedCode = PairErrorCodeSchema.safeParse(relay.lastError);
      const protocolMismatch = relay.lastError === ErrorCode.ProtocolMismatch;
      const errorCode = parsedCode.success ? parsedCode.data : null;
      setState({
        status: protocolMismatch
          ? 'protocol-mismatch'
          : errorCode === null
            ? 'unpaired'
            : statusForError(errorCode),
        errorCode,
        attemptsRemaining: null,
        expiresAt: null,
      });
    }
  });

  const submit = async (): Promise<void> => {
    if (disposed) throw new PairingUiError('PAIR_CREDENTIAL_REQUIRED');
    if (active !== null) throw new PairingUiError('PAIR_HELLO_PENDING');
    const raw = { challengeId: challengeId.value, code: code.value, paste: paste.value };
    clearSecrets();
    const controller = new AbortController();
    active = controller;
    setState({
      status: 'hello-pending',
      errorCode: null,
      attemptsRemaining: null,
      expiresAt: null,
    });
    try {
      const request = parsePairSubmission(raw);
      const seed = options.client.helloSeed;
      if (seed === null) throw new PairingUiError('PAIR_CREDENTIAL_REQUIRED');
      const parsedHello = RelayHelloSnapshotSchema.safeParse(await options.resolveHello(seed));
      if (!parsedHello.success) throw new PairingUiError('PAIR_BODY_INVALID');
      const hello = parsedHello.data;
      controller.signal.throwIfAborted();
      setState({
        status: 'exchange-pending',
        errorCode: null,
        attemptsRemaining: null,
        expiresAt: null,
      });
      const ticket = await exchangePairCode(request, controller.signal, options.fetch);
      const currentSeed = options.client.helloSeed;
      const currentHello =
        currentSeed === null
          ? null
          : RelayHelloSnapshotSchema.safeParse(await options.resolveHello(currentSeed));
      if (
        currentSeed === null ||
        currentSeed.pluginGeneration !== seed.pluginGeneration ||
        currentSeed.provisionalSessionId !== seed.provisionalSessionId ||
        currentHello === null ||
        !currentHello.success ||
        !sameHelloSnapshot(currentHello.data, hello)
      ) {
        await options.client.disconnect({ forgetCredential: true });
        throw new PairingUiError('PAIR_GENERATION_MISMATCH');
      }
      controller.signal.throwIfAborted();
      setState({
        status: 'hello-pending',
        errorCode: null,
        attemptsRemaining: null,
        expiresAt: ticket.expiresAt,
      });
      await options.client.connectWithTicket(ticket, hello);
      controller.signal.throwIfAborted();
      if (options.client.getState().status === 'connected') {
        setState({
          status: 'connected',
          errorCode: null,
          attemptsRemaining: null,
          expiresAt: null,
        });
      }
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const observed =
        typeof error === 'object' && error !== null
          ? (error as { code?: unknown; attemptsRemaining?: unknown })
          : {};
      const parsedCode = PairErrorCodeSchema.safeParse(observed.code);
      const errorCode = parsedCode.success ? parsedCode.data : 'PAIR_INTERNAL';
      const protocolMismatch = observed.code === ErrorCode.ProtocolMismatch;
      setState({
        status: protocolMismatch ? 'protocol-mismatch' : statusForError(errorCode),
        errorCode: protocolMismatch ? null : errorCode,
        attemptsRemaining:
          typeof observed.attemptsRemaining === 'number' ? observed.attemptsRemaining : null,
        expiresAt: null,
      });
      throw error;
    } finally {
      if (active === controller) active = null;
      clearSecrets();
    }
  };

  const begin = (): void => {
    if (state.value.status !== 'unpaired') return;
    setState({ status: 'entering', errorCode: null, attemptsRemaining: null, expiresAt: null });
  };

  const reset = (): void => {
    active?.abort(new DOMException('pairing reset', 'AbortError'));
    active = null;
    clearSecrets();
    setState({ status: 'unpaired', errorCode: null, attemptsRemaining: null, expiresAt: null });
  };
  const cancel = (): void => {
    reset();
    void options.client.disconnect({ forgetCredential: true });
  };
  const dispose = (): void => {
    if (disposed) return;
    reset();
    disposed = true;
    stopRelay();
    void options.client.disconnect({ forgetCredential: true });
  };
  tryOnScopeDispose(dispose);

  return {
    state: readonly(state),
    challengeId,
    code,
    paste,
    begin,
    submit,
    cancel,
    reset,
    dispose,
  };
};
