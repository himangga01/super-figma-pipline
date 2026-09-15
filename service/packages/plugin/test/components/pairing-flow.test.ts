// @vitest-environment happy-dom
import {
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  type PairErrorCode,
  PROTOCOL_VERSION,
  type RequestEnvelope,
} from '@sfp/shared';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import TabPairing, {
  type PairingSubmission,
  type PairingUiStatus,
} from '../../ui/components/TabPairing.vue';
import { usePairing } from '../../ui/composables/usePairing.js';
import { RelayClient, type WebSocketCtor } from '../../ui/relay/client.js';

const mountPairing = (
  status: PairingUiStatus = 'entering',
  errorCode: PairErrorCode | null = null,
  attemptsRemaining: number | null = null,
) => mount(TabPairing, { props: { status, errorCode, attemptsRemaining } });

const secretInput = (wrapper: ReturnType<typeof mountPairing>) =>
  wrapper.get<HTMLInputElement>('[data-testid="pair-secret"]');

class ResumeExpirySocket {
  static readonly sockets: ResumeExpirySocket[] = [];
  binaryType: BinaryType = 'blob';
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: Uint8Array[] = [];

  constructor(readonly url: string) {
    const index = ResumeExpirySocket.sockets.push(this) - 1;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
      if (index !== 0 || this.sent.length === 0) return;
      const request = decodeEnvelope(this.sent[0]!) as RequestEnvelope;
      this.receive(
        createResponse({
          id: request.id,
          sessionId: 'authenticated-session',
          result: {
            serverVersion: '1.0.0',
            protocolVersion: PROTOCOL_VERSION,
            sessionResumed: false,
            sessionId: 'authenticated-session',
            rotatedResumeToken: 'R'.repeat(22),
            resumeExpiresAt: 1_001,
          },
        }),
      );
    });
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
  }

  close(code = 1_000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
  }

  serverClose(): void {
    this.close(1_001, 'test reconnect');
  }

  private receive(envelope: Envelope): void {
    const bytes = encodeEnvelope(envelope);
    this.onmessage?.(
      new MessageEvent('message', {
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
    );
  }
}

const appPairingState = ref<{
  status: PairingUiStatus;
  errorCode: PairErrorCode | null;
  attemptsRemaining: number | null;
}>({
  status: 'unpaired',
  errorCode: null,
  attemptsRemaining: null,
});
const appChallengeId = ref('');
const appCode = ref('');
const appPaste = ref('');
const submittedByApp: PairingSubmission[] = [];
const appSubmit = vi.fn<() => Promise<void>>(() => {
  submittedByApp.push(
    appPaste.value === ''
      ? { challengeId: appChallengeId.value, code: appCode.value }
      : { pairCode: appPaste.value },
  );
  appCode.value = '';
  appPaste.value = '';
  return Promise.resolve();
});
const appCancel = vi.fn<() => void>();
const appBegin = vi.fn<() => void>(() => {
  if (appPairingState.value.status === 'unpaired') {
    appPairingState.value = {
      status: 'entering',
      errorCode: null,
      attemptsRemaining: null,
    };
  }
});

vi.mock('../../ui/composables/useRelaySession.js', () => ({
  useRelaySession: () => ({
    state: ref({
      status: 'disconnected',
      port: null,
      sessionResumed: false,
      serverVersion: null,
      lastError: null,
      versionNotice: null,
      connectedAt: null,
      reconnectCount: 0,
      totalCalls: 0,
      failedCalls: 0,
      activity: [],
    }),
    context: ref(null),
    busy: ref(false),
    sessionId: 'session-redacted',
    buildDiagnostics: (): string => '{}',
    approvals: { prompts: ref([]), decide: () => {}, clear: () => {} },
    binding: {
      url: ref(''),
      persistent: ref(false),
      status: ref('idle'),
      error: ref(null),
      bind: async () => {},
      dispose: () => {},
    },

    pairing: {
      state: appPairingState,
      challengeId: appChallengeId,
      code: appCode,
      paste: appPaste,
      begin: appBegin,
      submit: appSubmit,
      cancel: appCancel,
      reset: vi.fn<() => void>(),
      dispose: vi.fn<() => void>(),
    },
  }),
}));

const { default: App } = await import('../../ui/App.vue');

beforeEach(() => {
  appPairingState.value = { status: 'unpaired', errorCode: null, attemptsRemaining: null };
  appChallengeId.value = '';
  appCode.value = '';
  appPaste.value = '';
  submittedByApp.length = 0;
  appBegin.mockClear();
  appSubmit.mockClear();
  appCancel.mockClear();
});

describe('TabPairing', () => {
  it('moves the real controller into entering without submitting or fetching', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const disconnect = vi.fn<() => Promise<void>>(async () => undefined);
    const client = {
      helloSeed: null,
      subscribe: (listener: (state: { status: string; lastError: null }) => void) => {
        listener({ status: 'idle', lastError: null });
        return () => undefined;
      },
      disconnect,
    } as unknown as RelayClient;
    const pairing = usePairing({
      client,
      fetch,
      resolveHello: () => {
        throw new Error('begin must not resolve hello');
      },
    });

    pairing.begin();

    expect(pairing.state.value.status).toBe('entering');
    expect(fetch).not.toHaveBeenCalled();
    expect(pairing.code.value).toBe('');
    expect(pairing.paste.value).toBe('');
    pairing.begin();
    expect(pairing.state.value.status).toBe('entering');
    expect(fetch).not.toHaveBeenCalled();

    pairing.reset();
    expect(pairing.state.value.status).toBe('unpaired');
    pairing.begin();
    expect(pairing.state.value.status).toBe('entering');
    pairing.dispose();
  });

  it('submits separate exact credentials and removes the code from the DOM immediately', async () => {
    const wrapper = mountPairing();
    await wrapper.get<HTMLInputElement>('[data-testid="pair-challenge"]').setValue('ABCDEFGHIJ');
    await secretInput(wrapper).setValue('12345678');

    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted<PairingSubmission[]>('submit')).toEqual([
      [{ challengeId: 'ABCDEFGHIJ', code: '12345678' }],
    ]);
    expect(secretInput(wrapper).element.value).toBe('');
    expect(wrapper.html()).not.toContain('12345678');
  });

  it('accepts a pasted SFP credential without retaining it in the DOM', async () => {
    const wrapper = mountPairing();
    const pasted = 'SFP-ABCDEFGHIJ-12345678';
    await secretInput(wrapper).setValue(pasted);

    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted<PairingSubmission[]>('submit')).toEqual([[{ pairCode: pasted }]]);
    expect(secretInput(wrapper).element.value).toBe('');
    expect(wrapper.html()).not.toContain(pasted);
  });

  it('clears the secret before emitting cancel', async () => {
    const wrapper = mountPairing('exchange-pending');
    const input = secretInput(wrapper);
    await input.setValue('12345678');

    await wrapper.get('[data-testid="pair-cancel"]').trigger('click');

    expect(input.element.value).toBe('');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('scrubs the detached input node during unmount', async () => {
    const wrapper = mountPairing();
    const input = secretInput(wrapper);
    await input.setValue('12345678');

    wrapper.unmount();

    expect(input.element.value).toBe('');
  });

  it.each([
    ['wrong', 'PAIR_CODE_WRONG', 'incorrect'],
    ['expired', 'PAIR_CODE_EXPIRED', 'expired'],
    ['used', 'PAIR_CODE_USED', 'already been used'],
    ['rate-limited', 'PAIR_RATE_LIMITED', 'Too many'],
    ['resume-expired', 'PAIR_RESUME_EXPIRED', 'Pair again'],
    ['protocol-mismatch', null, 'Update'],
  ] as const)('renders the typed %s state without exposing an exception', (status, error, copy) => {
    const wrapper = mountPairing(status, error, status === 'wrong' ? 2 : null);

    expect(wrapper.text()).toContain(copy);
    expect(wrapper.text()).not.toContain('Error:');
    expect(wrapper.text().includes('2 attempts remaining')).toBe(status === 'wrong');
  });

  it.each([
    ['unpaired', 'Enter the challenge'],
    ['entering', 'Enter the challenge'],
    ['exchange-pending', 'Exchanging'],
    ['hello-pending', 'Authenticating'],
    ['connected', 'Paired and connected'],
    ['reconnecting', 'Reconnecting'],
  ] as const)('renders the %s lifecycle state', (status, copy) => {
    expect(mountPairing(status).text()).toContain(copy);
  });

  it('shows the re-pair form when a real relay resume credential expires on reconnect', async () => {
    ResumeExpirySocket.sockets.length = 0;
    let now = 1_000;
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.1.0',
      WS: ResumeExpirySocket as unknown as WebSocketCtor,
      now: () => now,
      randomBytes: size => new Uint8Array(size).fill(7),
      reconnectInitialDelayMs: 1,
    });
    client.configureHelloSeed({
      pluginGeneration: 'plugin-generation',
      provisionalSessionId: 'provisional-session',
    });
    const pairing = usePairing({
      client,
      resolveHello: seed => ({
        protocolVersion: PROTOCOL_VERSION,
        productVersion: '0.1.0',
        pluginVersion: '0.1.0',
        pluginGeneration: seed.pluginGeneration,
        editorType: 'figma',
        mode: 'default',
        fileIdentity: { kind: 'figma-file-key', value: 'file-key' },
        fileName: 'Design',
        capabilities: [],
      }),
    });

    await client.connectWithTicket(
      { wsTicket: 'T'.repeat(22), expiresAt: 2_000 },
      {
        protocolVersion: PROTOCOL_VERSION,
        productVersion: '0.1.0',
        pluginVersion: '0.1.0',
        pluginGeneration: 'plugin-generation',
        editorType: 'figma',
        mode: 'default',
        fileIdentity: { kind: 'figma-file-key', value: 'file-key' },
        fileName: 'Design',
        capabilities: [],
      },
    );
    expect(pairing.state.value.status).toBe('connected');

    now = 1_001;
    ResumeExpirySocket.sockets[0]!.serverClose();
    await vi.waitFor(() => expect(pairing.state.value.status).toBe('resume-expired'));
    const wrapper = mountPairing(
      pairing.state.value.status,
      pairing.state.value.errorCode,
      pairing.state.value.attemptsRemaining,
    );

    expect(wrapper.find('form').exists()).toBe(true);
    expect(wrapper.text()).toContain('Pair again');
    wrapper.unmount();
    pairing.dispose();
  });

  it('never renders approval or control-plane actions', () => {
    const text = mountPairing().text();

    expect(text).not.toContain('Approve');
    expect(text).not.toContain('/control');
  });
});

describe('App pairing flow', () => {
  it('enters pairing once per unpaired cycle without submitting or retaining a secret', async () => {
    const wrapper = mount(App);
    const tab = (label: string) =>
      wrapper.findAll('button').find(button => button.text() === label);

    await tab('Pairing')?.trigger('click');
    await nextTick();

    expect(appBegin).toHaveBeenCalledOnce();
    expect(appPairingState.value.status).toBe('entering');
    expect(appSubmit).not.toHaveBeenCalled();
    expect(appCode.value).toBe('');
    expect(appPaste.value).toBe('');

    await tab('Activity')?.trigger('click');
    await tab('Pairing')?.trigger('click');
    expect(appBegin).toHaveBeenCalledOnce();

    appPairingState.value = { status: 'unpaired', errorCode: null, attemptsRemaining: null };
    await tab('Activity')?.trigger('click');
    await tab('Pairing')?.trigger('click');
    expect(appBegin).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('mounts the real panel, opens the pairing tab and forwards credentials to usePairing', async () => {
    const wrapper = mount(App);
    const pairingTab = wrapper.findAll('button').find(button => button.text() === 'Pairing');

    await pairingTab?.trigger('click');
    await nextTick();
    await wrapper.get<HTMLInputElement>('[data-testid="pair-challenge"]').setValue('ABCDEFGHIJ');
    await wrapper.get<HTMLInputElement>('[data-testid="pair-secret"]').setValue('12345678');
    await wrapper.get('form').trigger('submit');

    expect(appSubmit).toHaveBeenCalledOnce();
    expect(submittedByApp).toEqual([{ challengeId: 'ABCDEFGHIJ', code: '12345678' }]);
    expect(wrapper.html()).not.toContain('12345678');
    wrapper.unmount();
  });

  it('forwards cancellation from the real panel without adding approval actions', async () => {
    const wrapper = mount(App);
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Pairing')
      ?.trigger('click');
    await nextTick();

    await wrapper.get('[data-testid="pair-cancel"]').trigger('click');

    expect(appCancel).toHaveBeenCalledOnce();
    expect(wrapper.text()).not.toContain('Approve');
    wrapper.unmount();
  });

  it('keeps separate and pasted submission modes mutually exclusive across retries', async () => {
    appChallengeId.value = 'STALEVALUE';
    appCode.value = '';
    appPaste.value = '';
    const wrapper = mount(App);
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Pairing')
      ?.trigger('click');
    await nextTick();
    await wrapper
      .get<HTMLInputElement>('[data-testid="pair-secret"]')
      .setValue('SFP-ABCDEFGHIJ-12345678');

    await wrapper.get('form').trigger('submit');

    expect(appChallengeId.value).toBe('');
    expect(appCode.value).toBe('');
    wrapper.unmount();

    submittedByApp.length = 0;
    appPaste.value = 'SFP-STALEVALUE-87654321';
    const retry = mount(App);
    await retry
      .findAll('button')
      .find(button => button.text() === 'Pairing')
      ?.trigger('click');
    await nextTick();
    await retry.get<HTMLInputElement>('[data-testid="pair-challenge"]').setValue('ABCDEFGHIJ');
    await retry.get<HTMLInputElement>('[data-testid="pair-secret"]').setValue('12345678');
    await retry.get('form').trigger('submit');

    expect(submittedByApp).toEqual([{ challengeId: 'ABCDEFGHIJ', code: '12345678' }]);
    retry.unmount();
  });
});
