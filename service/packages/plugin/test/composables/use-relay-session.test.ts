import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, nextTick } from 'vue';

// @vitest-environment happy-dom
import { createPluginContextEvent, type PluginContextEvent } from '../../protocol/bridge.js';
import type { ActivityEntry, RelayClientState } from '../../ui/relay/state.js';

/**
 * The composable constructs its own RelayClient and sandbox bridge, so both are mocked at the
 * module boundary rather than injected — production code stays free of test-only seams.
 */
const mocks = vi.hoisted(() => {
  const notifyActivity = vi.fn<(p: unknown) => void>();
  const wake = vi.fn<() => void>();
  const connect = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const disconnect = vi.fn<(_options?: { forgetCredential?: boolean }) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const configureHelloSeed =
    vi.fn<(seed: { pluginGeneration: string; provisionalSessionId?: string }) => void>();
  const setToolHandler = vi.fn<(h: unknown) => void>();
  const setToolCancelHandler = vi.fn<(h: unknown) => void>();
  const sendProgress = vi.fn<(binding: unknown, progress: unknown) => void>();
  const unsubscribe = vi.fn<() => void>();
  const bridgeDispose = vi.fn<() => void>();
  const bridgeHandler = vi.fn<() => void>();
  const bridgeCancel = vi.fn<() => boolean>(() => true);
  let bridgeOptions: { onProgress?: (binding: unknown, progress: unknown) => void } | null = null;
  const pairingDispose = vi.fn<() => void>();
  const pairingReset = vi.fn<() => void>();
  const pairingBegin = vi.fn<() => void>();
  const pairingCancel = vi.fn<() => void>();
  const pairingSubmit = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const pairing = {
    state: { value: { status: 'unpaired' as const } },
    challengeId: { value: '' },
    code: { value: '' },
    paste: { value: '' },
    begin: pairingBegin,
    submit: pairingSubmit,
    cancel: pairingCancel,
    reset: pairingReset,
    dispose: pairingDispose,
  };
  let pairingOptions: {
    client: unknown;
    resolveHello: (seed: { pluginGeneration: string; provisionalSessionId: string }) => unknown;
  } | null = null;
  /** Captured so tests can push a new state through the subscription. */
  let emitState: ((s: RelayClientState) => void) | null = null;

  const baseState: RelayClientState = {
    status: 'idle',
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
  };

  return {
    notifyActivity,
    wake,
    connect,
    disconnect,
    configureHelloSeed,
    setToolHandler,
    setToolCancelHandler,
    sendProgress,
    unsubscribe,
    bridgeDispose,
    bridgeHandler,
    bridgeCancel,
    pairing,
    pairingDispose,
    pairingReset,
    baseState,
    getEmitState: () => emitState,
    setEmitState: (fn: (s: RelayClientState) => void) => {
      emitState = fn;
    },
    getBridgeOptions: () => bridgeOptions,
    setBridgeOptions: (options: typeof bridgeOptions) => {
      bridgeOptions = options;
    },
    getPairingOptions: () => pairingOptions,
    setPairingOptions: (options: typeof pairingOptions) => {
      pairingOptions = options;
    },
  };
});

vi.mock('../../ui/relay/client.js', () => ({
  RelayClient: class {
    sessionId = 'session-abcdef123456';
    helloSeed: { pluginGeneration: string; provisionalSessionId: string } | null = null;
    setToolHandler = mocks.setToolHandler;
    setApprovalHandler = vi.fn<(handler: unknown) => void>();
    setBindingOfferHandler = vi.fn<(handler: unknown) => void>();
    setToolCancelHandler = mocks.setToolCancelHandler;
    sendProgress = mocks.sendProgress;
    getState = (): RelayClientState => mocks.baseState;
    subscribe = (fn: (s: RelayClientState) => void): (() => void) => {
      mocks.setEmitState(fn);
      return mocks.unsubscribe;
    };
    notifyActivity = mocks.notifyActivity;
    wake = mocks.wake;
    connect = mocks.connect;
    disconnect = mocks.disconnect;
    configureHelloSeed = (seed: {
      pluginGeneration: string;
      provisionalSessionId?: string;
    }): void => {
      mocks.configureHelloSeed(seed);
      this.helloSeed = {
        pluginGeneration: seed.pluginGeneration,
        provisionalSessionId: seed.provisionalSessionId ?? 'ui-provisional-session-test',
      };
      this.sessionId = this.helloSeed.provisionalSessionId;
    };
  },
}));

vi.mock('../../ui/sandbox/tool-bridge.js', () => ({
  createToolBridge: (options: { onProgress?: (binding: unknown, progress: unknown) => void }) => {
    mocks.setBridgeOptions(options);
    return {
      handler: mocks.bridgeHandler,
      cancel: mocks.bridgeCancel,
      pendingCount: 0,
      dispose: mocks.bridgeDispose,
    };
  },
}));

vi.mock('../../ui/composables/usePairing.js', () => ({
  usePairing: (options: {
    client: unknown;
    resolveHello: (seed: { pluginGeneration: string; provisionalSessionId: string }) => unknown;
  }) => {
    mocks.setPairingOptions(options);
    return mocks.pairing;
  },
}));

const { useRelaySession } = await import('../../ui/composables/useRelaySession.js');

/**
 * Flip the tab's visibility. Awaits a tick because the composable reacts through a Vue `watch`,
 * which flushes on the microtask queue rather than synchronously with the event.
 */
const setVisibility = async (value: DocumentVisibilityState): Promise<void> => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  await nextTick();
};

const pushContext = (overrides: Partial<PluginContextEvent> = {}): void => {
  const event = {
    ...createPluginContextEvent({
      fileName: 'Design File',
      pageId: 'page-1',
      pageName: 'Page 1',
      selectionCount: 0,
      selection: [],
      editorType: 'figma',
      mode: 'default',
      apiVersion: '1.0.0',
      pluginGeneration: 'plugin-generation-test',
      fileIdentity: {
        kind: 'unstable-readonly',
        sessionId: 'provisional-session-test',
        pluginGeneration: 'plugin-generation-test',
      },
      capabilities: [],
    }),
    ...overrides,
  };
  globalThis.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: event } }));
};

/**
 * Mount the composable inside a real component so onMounted and scope disposal both fire. Mounted
 * apps are tracked and unmounted in afterEach — a failing assertion must not leave a live window
 * listener behind to contaminate the next test.
 */
const mounted: App[] = [];
const withSession = (): ReturnType<typeof useRelaySession> => {
  let session!: ReturnType<typeof useRelaySession>;
  const app = createApp({
    setup() {
      session = useRelaySession('1.2.3');
      return () => h('div');
    },
  });
  app.mount(document.createElement('div'));
  mounted.push(app);
  return session;
};

describe('useRelaySession', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.pairing.challengeId.value = '';
    mocks.pairing.code.value = '';
    mocks.pairing.paste.value = '';
    await setVisibility('visible');
  });

  afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
    vi.unstubAllGlobals();
  });

  it('automatically submits the local pairing seed once after valid sandbox context arrives', () => {
    const seed = document.createElement('script');
    seed.id = 'sfp-pair-bootstrap';
    seed.textContent = JSON.stringify({ pairCode: 'SFP-ABCDEFGHIJ-12345678' });
    document.body.append(seed);
    withSession();
    expect(seed.isConnected).toBe(false);
    expect(seed.textContent).toBe('');
    expect(mocks.pairing.submit).not.toHaveBeenCalled();
    pushContext();
    pushContext();
    expect(mocks.pairing.paste.value).toBe('SFP-ABCDEFGHIJ-12345678');
    expect(mocks.pairing.submit).toHaveBeenCalledOnce();
  });

  describe('activity routing (the multi-file routing invariant)', () => {
    it('claims routing when a context arrives while this tab is in the foreground', () => {
      withSession();

      pushContext();

      expect(mocks.notifyActivity).toHaveBeenCalledWith({
        fileName: 'Design File',
        pageId: 'page-1',
        pageName: 'Page 1',
      });
    });

    // The bug this guards: a background file claiming routing and stealing tool calls from the file
    // the user is actually looking at.
    it('never claims routing while the tab is hidden', async () => {
      await setVisibility('hidden');
      withSession();

      pushContext();

      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('still wakes the connection on a context push while hidden', async () => {
      await setVisibility('hidden');
      withSession();

      pushContext();

      // wake() is deliberately outside the visibility gate: a stalled reconnect should recover even
      // in a background tab, it just must not claim routing.
      expect(mocks.wake).toHaveBeenCalled();
      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('re-claims routing when the tab returns to the foreground', async () => {
      await setVisibility('hidden');
      withSession();
      pushContext();
      expect(mocks.notifyActivity).not.toHaveBeenCalled();

      await setVisibility('visible');

      expect(mocks.wake).toHaveBeenCalled();
      expect(mocks.notifyActivity).toHaveBeenCalledWith({
        fileName: 'Design File',
        pageId: 'page-1',
        pageName: 'Page 1',
      });
    });

    // Going to the background must be silent — emitting there is exactly how a background file used
    // to steal routing from the foreground one.
    it('emits nothing when the tab leaves the foreground', async () => {
      withSession();
      pushContext();
      vi.clearAllMocks();

      await setVisibility('hidden');

      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('does not claim routing before any context has arrived', async () => {
      await setVisibility('hidden');
      withSession();

      await setVisibility('visible');

      // No context yet means no file/page identity to report, so there is nothing to claim.
      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('reports the newest file and page after the user switches page', () => {
      withSession();
      pushContext();
      pushContext({ pageId: 'page-2', pageName: 'Page 2' });

      expect(mocks.notifyActivity).toHaveBeenLastCalledWith({
        fileName: 'Design File',
        pageId: 'page-2',
        pageName: 'Page 2',
      });
    });

    it('ignores window messages that are not plugin context events', () => {
      withSession();

      globalThis.dispatchEvent(
        new MessageEvent('message', { data: { pluginMessage: { type: 'something-else' } } }),
      );

      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('exposes the pairing controller owned by the relay session scope', () => {
      expect(withSession().pairing).toBe(mocks.pairing);
    });

    it('wires the sandbox bridge but opens no socket before pairing', () => {
      withSession();

      expect(mocks.setToolHandler).toHaveBeenCalledWith(mocks.bridgeHandler);
      expect(mocks.connect).not.toHaveBeenCalled();
    });

    it('wires exact cancellation and progress bindings between relay and sandbox bridge', () => {
      withSession();
      const binding = {
        requestId: 'request-1',
        operationId: 'operation-1',
        actionNonce: 'nonce-1',
      };
      const progress = { operationId: 'operation-1', phase: 'running', completed: 1, total: 2 };

      const cancelHandler = mocks.setToolCancelHandler.mock.calls[0]?.[0] as
        | ((value: typeof binding) => boolean)
        | undefined;
      expect(cancelHandler?.(binding)).toBe(true);
      expect(mocks.bridgeCancel).toHaveBeenCalledWith(binding);

      mocks.getBridgeOptions()?.onProgress?.(binding, progress);
      expect(mocks.sendProgress).toHaveBeenCalledWith(binding, progress);
    });

    it('configures the single hello seed from sandbox identity without opening a socket', () => {
      withSession();

      pushContext();

      expect(mocks.configureHelloSeed).toHaveBeenCalledWith({
        pluginGeneration: 'plugin-generation-test',
        provisionalSessionId: 'provisional-session-test',
      });
      expect(mocks.connect).not.toHaveBeenCalled();
    });

    it('builds an immutable hello snapshot from the exact configured context', () => {
      withSession();
      pushContext();
      const resolveHello = mocks.getPairingOptions()?.resolveHello;

      const hello = resolveHello?.({
        pluginGeneration: 'plugin-generation-test',
        provisionalSessionId: 'provisional-session-test',
      }) as {
        protocolVersion: string;
        productVersion: string;
        pluginVersion: string;
        pluginGeneration: string;
        fileIdentity: { kind: string; sessionId: string };
        capabilities: readonly string[];
      };

      expect(hello).toMatchObject({
        productVersion: '1.2.3',
        pluginVersion: '1.2.3',
        pluginGeneration: 'plugin-generation-test',
        fileIdentity: { kind: 'unstable-readonly', sessionId: 'provisional-session-test' },
        capabilities: [],
      });
      expect(Object.isFrozen(hello)).toBe(true);
      expect(Object.isFrozen(hello.fileIdentity)).toBe(true);
      expect(Object.isFrozen(hello.capabilities)).toBe(true);
    });

    it('fails closed when hello context is absent or does not match the seed', () => {
      withSession();
      const resolveHello = mocks.getPairingOptions()?.resolveHello;
      const seed = {
        pluginGeneration: 'plugin-generation-test',
        provisionalSessionId: 'provisional-session-test',
      };

      expect(() => resolveHello?.(seed)).toThrowError('PAIR_CONTEXT_REQUIRED');
      pushContext();
      expect(() =>
        resolveHello?.({ ...seed, pluginGeneration: 'different-generation' }),
      ).toThrowError('PAIR_CONTEXT_REQUIRED');
      expect(() =>
        resolveHello?.({ ...seed, provisionalSessionId: 'different-session' }),
      ).toThrowError('PAIR_CONTEXT_REQUIRED');
    });

    it('rejects legacy context missing authenticated facts and forgets any credential', () => {
      withSession();

      pushContext({
        pluginGeneration: undefined,
        fileIdentity: undefined,
        capabilities: undefined,
      });

      expect(mocks.configureHelloSeed).not.toHaveBeenCalled();
      expect(mocks.pairingReset).toHaveBeenCalled();
      expect(mocks.disconnect).toHaveBeenCalledWith({ forgetCredential: true });
      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('pins the first file identity and rejects a same-generation identity swap', () => {
      withSession();
      pushContext();
      vi.clearAllMocks();

      pushContext({
        fileIdentity: {
          kind: 'document-plugin-uuid',
          value: '2d1dc805-e625-4d07-a219-476b3dd30b51',
        },
      });

      expect(mocks.configureHelloSeed).not.toHaveBeenCalled();
      expect(mocks.pairingReset).toHaveBeenCalled();
      expect(mocks.disconnect).toHaveBeenCalledWith({ forgetCredential: true });
      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('mirrors relay state into a ref', () => {
      const session = withSession();
      expect(session.state.value.status).toBe('idle');

      mocks.getEmitState()?.({ ...mocks.baseState, status: 'connected', port: 3055 });

      expect(session.state.value.status).toBe('connected');
      expect(session.state.value.port).toBe(3055);
    });

    it('tears down subscription, bridge and socket on unmount', () => {
      withSession();

      mounted.pop()?.unmount();

      expect(mocks.unsubscribe).toHaveBeenCalled();
      expect(mocks.pairingDispose).toHaveBeenCalled();
      expect(mocks.bridgeDispose).toHaveBeenCalled();
      expect(mocks.setToolHandler).toHaveBeenLastCalledWith(null);
      expect(mocks.setToolCancelHandler).toHaveBeenLastCalledWith(null);
      expect(mocks.disconnect).toHaveBeenCalledWith({ forgetCredential: true });
    });

    it('continues closing every owner when one synchronous disposer throws', () => {
      mocks.pairingDispose.mockImplementationOnce(() => {
        throw new Error('synthetic dispose failure');
      });
      withSession();

      mounted.pop()?.unmount();

      expect(mocks.bridgeDispose).toHaveBeenCalled();
      expect(mocks.setToolHandler).toHaveBeenLastCalledWith(null);
      expect(mocks.setToolCancelHandler).toHaveBeenLastCalledWith(null);
      expect(mocks.disconnect).toHaveBeenCalledWith({ forgetCredential: true });
    });

    it('exposes the context pushed from the sandbox', () => {
      const session = withSession();
      expect(session.context.value).toBeNull();

      pushContext();

      expect(session.context.value?.fileName).toBe('Design File');
    });

    it('stops listening for context once unmounted', () => {
      const session = withSession();
      mounted.pop()?.unmount();

      pushContext();

      expect(session.context.value).toBeNull();
    });
  });

  // Derived here rather than in the panel: "the agent is working" is a fact about the session, and
  // more than one piece of chrome reads it.
  describe('busy', () => {
    const entry = (id: string, status: ActivityEntry['status']): ActivityEntry => ({
      id,
      method: 'get_node',
      startedAt: 1000,
      status,
    });

    const withActivity = (activity: ActivityEntry[]): void => {
      mocks.getEmitState()?.({ ...mocks.baseState, activity });
    };

    it('is quiet before anything has happened', () => {
      expect(withSession().busy.value).toBe(false);
    });

    it('stays quiet once every call has settled', () => {
      const session = withSession();

      withActivity([entry('a', 'ok'), entry('b', 'error')]);

      expect(session.busy.value).toBe(false);
    });

    // The sweep has to appear even when the pending row itself is scrolled out of view.
    it('reports a call in flight wherever it sits in the list', () => {
      const session = withSession();

      withActivity([entry('a', 'ok'), entry('b', 'pending')]);

      expect(session.busy.value).toBe(true);
    });

    it('goes quiet again when the last call settles', () => {
      const session = withSession();
      withActivity([entry('a', 'pending')]);
      expect(session.busy.value).toBe(true);

      withActivity([entry('a', 'ok')]);

      expect(session.busy.value).toBe(false);
    });
  });

  describe('diagnostics', () => {
    it('builds a bundle carrying the session id, versions and context', () => {
      const session = withSession();
      pushContext();

      const bundle = JSON.parse(session.buildDiagnostics()) as {
        versions: { plugin: string; editorType: string | null };
        session: { id: string };
        context: { fileName: string } | null;
      };

      expect(bundle.versions.plugin).toBe('1.2.3');
      expect(bundle.versions.editorType).toBe('figma');
      expect(bundle.session.id).toBe('provisional-session-test');
      expect(bundle.context?.fileName).toBe('Design File');
    });

    it('never serializes pairing code or pasted credential', () => {
      const session = withSession();
      mocks.pairing.code.value = '12345678';
      mocks.pairing.paste.value = 'SFP-ABCDEFGHJK-12345678';

      const bundle = session.buildDiagnostics();

      expect(bundle).not.toContain('12345678');
      expect(bundle).not.toContain('SFP-');
    });
  });
});
