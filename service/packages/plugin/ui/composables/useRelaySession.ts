import { DEFAULT_PORT, type FileIdentity, PROTOCOL_VERSION } from '@sfp/shared';
import { tryOnScopeDispose, useDocumentVisibility } from '@vueuse/core';
import { computed, type ComputedRef, type Ref, ref, watch } from 'vue';

import { type PluginContextEvent } from '../../protocol/bridge.js';
import { createPluginIdentityLifetime } from '../../src/file-identity.js';
import { consumePairBootstrap } from '../relay/bootstrap.js';
import { RelayClient, type RelayHelloSeed, type RelayHelloSnapshot } from '../relay/client.js';
import { buildDiagnosticBundle } from '../relay/diagnostics.js';
import type { RelayClientState } from '../relay/state.js';
import { onSandboxContext, postToSandbox } from '../sandbox/messaging.js';
import { createToolBridge } from '../sandbox/tool-bridge.js';
import { useApprovals } from './useApprovals.js';
import { useDocumentBinding } from './useDocumentBinding.js';
import { usePairing } from './usePairing.js';

export interface RelaySession {
  /** Live mirror of the relay client's state. */
  state: Ref<RelayClientState>;
  /** Latest context pushed up from the sandbox, or null before the first push. */
  context: Ref<PluginContextEvent | null>;
  /** True while at least one tool call is in flight. */
  busy: ComputedRef<boolean>;
  /** Tracks the provisional id and then the authenticated id rotated by hello. */
  sessionId: Ref<string>;
  pairing: ReturnType<typeof usePairing>;
  approvals: ReturnType<typeof useApprovals>;
  binding: ReturnType<typeof useDocumentBinding>;
  /** Serialized bundle (versions + context + calls) for pasting into a bug report. */
  buildDiagnostics: () => string;
}

const sameIdentity = (left: Readonly<FileIdentity>, right: Readonly<FileIdentity>): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'unstable-readonly' && right.kind === 'unstable-readonly') {
    return left.sessionId === right.sessionId && left.pluginGeneration === right.pluginGeneration;
  }
  return 'value' in left && 'value' in right && left.value === right.value;
};

/**
 * Owns the relay connection for the panel: the client and sandbox bridge, their lifecycle, and the
 * activity/visibility signalling that decides which open file the leader routes tool calls to.
 *
 * That routing behaviour is the reason this lives in one composable rather than being spread across
 * components — the invariants below are subtle and were arrived at empirically.
 */
export const useRelaySession = (appVersion: string): RelaySession => {
  const client = new RelayClient({
    // The relay leader always binds DEFAULT_PORT — the server never hops to a fallback — so we probe
    // exactly that one port. Scanning a range would only risk stalling on unrelated local services.
    ports: [DEFAULT_PORT],
    clientVersion: appVersion,
    log: msg => console.log(msg),
  });
  const bridge = createToolBridge({
    log: msg => console.log(msg),
    onProgress: (binding, progress) => {
      client.sendProgress(binding, progress);
    },
  });
  client.setToolHandler(bridge.handler);
  client.setToolCancelHandler(binding => bridge.cancel(binding));

  const state = ref<RelayClientState>(client.getState());
  const sessionId = ref(client.sessionId);
  const context = ref<PluginContextEvent | null>(null);
  const visibility = useDocumentVisibility();
  let pinnedIdentity: Readonly<FileIdentity> | null = null;

  const resolveHello = (seed: Readonly<RelayHelloSeed>): RelayHelloSnapshot => {
    const current = context.value;
    if (
      current === null ||
      current.pluginGeneration === undefined ||
      current.fileIdentity === undefined ||
      current.capabilities === undefined ||
      current.capabilities.length !== 0 ||
      appVersion.length < 1 ||
      appVersion.length > 128 ||
      current.mode.length < 1 ||
      current.mode.length > 128 ||
      current.fileName.length < 1 ||
      current.fileName.length > 1024 ||
      current.pluginGeneration !== seed.pluginGeneration ||
      pinnedIdentity === null ||
      !sameIdentity(current.fileIdentity, pinnedIdentity) ||
      (current.fileIdentity.kind === 'unstable-readonly' &&
        (current.fileIdentity.pluginGeneration !== seed.pluginGeneration ||
          current.fileIdentity.sessionId !== seed.provisionalSessionId))
    ) {
      throw new Error('PAIR_CONTEXT_REQUIRED');
    }

    return Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      productVersion: appVersion,
      pluginVersion: appVersion,
      pluginGeneration: current.pluginGeneration,
      editorType: current.editorType,
      mode: current.mode,
      fileIdentity: Object.freeze({ ...current.fileIdentity }),
      fileName: current.fileName,
      // Task 9A has no negotiated plugin capability taxonomy. Never forward a UI/context value.
      capabilities: Object.freeze([]),
    });
  };

  const pairing = usePairing({ client, resolveHello });
  const approvals = useApprovals();
  client.setApprovalHandler(approvals.receive);
  let cancelTransition: (() => void) | undefined;
  const binding = useDocumentBinding({
    client,
    fileName: () => context.value?.fileName ?? null,
    transition: (identity, nonce) =>
      new Promise((resolve, reject) => {
        cancelTransition?.();
        pinnedIdentity = Object.freeze({ ...identity });
        const stop = onSandboxContext(event => {
          if (event.fileIdentity === undefined || !sameIdentity(event.fileIdentity, identity))
            return;
          clearTimeout(timer);
          stop();
          cancelTransition = undefined;
          try {
            resolve(resolveHello(client.helloSeed!));
          } catch (error) {
            reject(error);
          }
        });
        const timer = setTimeout(() => {
          stop();
          cancelTransition = undefined;
          reject(new Error('IDENTITY_CONTEXT_TIMEOUT'));
        }, 10_000);
        cancelTransition = () => {
          clearTimeout(timer);
          stop();
          reject(new Error('IDENTITY_CONTEXT_CANCELLED'));
        };
        postToSandbox({ tag: '@sfp/identity-publish', nonce });
      }),
  });
  let automaticPairCode = consumePairBootstrap(document);

  const configureHelloSeed = (event: PluginContextEvent): boolean => {
    const generation = event.pluginGeneration;
    const identity = event.fileIdentity;
    if (
      generation === undefined ||
      identity === undefined ||
      event.capabilities === undefined ||
      event.capabilities.length !== 0 ||
      (identity.kind === 'unstable-readonly' && identity.pluginGeneration !== generation)
    ) {
      return false;
    }

    try {
      if (pinnedIdentity !== null && !sameIdentity(identity, pinnedIdentity)) return false;
      const existing = client.helloSeed;
      if (existing === null) {
        client.configureHelloSeed({
          pluginGeneration: generation,
          ...(identity.kind === 'unstable-readonly'
            ? { provisionalSessionId: identity.sessionId }
            : {}),
        });
        sessionId.value = client.sessionId;
        pinnedIdentity = Object.freeze({ ...identity });
        return true;
      }

      const matches =
        existing.pluginGeneration === generation &&
        (identity.kind !== 'unstable-readonly' ||
          existing.provisionalSessionId === identity.sessionId);
      if (matches && pinnedIdentity === null) pinnedIdentity = Object.freeze({ ...identity });
      return matches;
    } catch {
      return false;
    }
  };

  // Re-assert this session's activity from the latest known context. The leader routes to the
  // most-recently-active session, so emitting bumps this plugin to the front. No-op until the sandbox
  // has pushed at least one context (file/page identity is required by ActivityParams).
  const emitActivity = (): void => {
    const c = context.value;
    if (c === null) return;
    // Only the foreground tab reports `visible`; background tabs are `hidden` (verified empirically on
    // Figma desktop). Gating activity on visibility means only the file the user is actually looking at
    // ever claims routing — so switching tabs auto-follows the foreground file, and a background tab can
    // never steal routing via a broadcast focus/visibility event. This is the core of selection/visibility
    // -driven routing. See [[project-routing-stability-backlog]].
    if (visibility.value !== 'visible') return;
    client.notifyActivity({ fileName: c.fileName, pageId: c.pageId, pageName: c.pageName });
  };

  const stopContext = onSandboxContext(event => {
    context.value = event;
    if (!configureHelloSeed(event)) {
      pairing.reset();
      void client.disconnect({ forgetCredential: true }).catch(() => {});
      return;
    }
    if (automaticPairCode !== null) {
      const code = automaticPairCode;
      automaticPairCode = null;
      pairing.paste.value = code;
      void pairing.submit().catch(() => {
        /* typed pairing state displays the failure */
      });
    }
    // A context push is proof the user is active here right now — a throttle-immune signal (postMessage
    // isn't clamped like background-tab timers). Nudge the relay to probe now in case a reconnect
    // stalled while backgrounded; wake() no-ops when already connected.
    client.wake();
    // Each context push from sandbox means the user just interacted (open / selection-change /
    // page-change). Tell the leader — params carry file/page identity so ping can report which
    // file is being routed instead of an opaque session id.
    emitActivity();
  });

  // Register the context listener before asking the sandbox to bootstrap. Randomness belongs to
  // this browser iframe: Figma's document sandbox does not guarantee Web Crypto globals.
  postToSandbox({ tag: '@sfp/identity-seed', ...createPluginIdentityLifetime() });

  // When this tab becomes the foreground (visibility → 'visible'), re-assert activity so routing follows
  // the file the user switched to — even with no canvas click. `useDocumentVisibility` is backed solely by
  // the `visibilitychange` event, which only fires on the tab whose visibility actually changed. We
  // deliberately do NOT react to window `focus`: that fires on EVERY tab when the user returns to the Figma
  // app (it's not per-tab), which is exactly the broadcast that made background files steal routing.
  // emitActivity's `visible` gate keeps the background side (going → hidden) silent.
  watch(visibility, v => {
    if (v !== 'visible') return;
    // Returning to the foreground unfreezes throttled timers. Browsers throttle (and after a few minutes
    // freeze) timers in hidden tabs, so a reconnect back-off that began while the user switched away — the
    // classic "opened the plugin, then launched the MCP client" flow — can stall long past when the server
    // came up. Nudge the client to probe now so it connects immediately instead of waiting out that sleep.
    client.wake();
    emitActivity();
  });

  // Mirror the relay client's state into a ref — subscribe synchronously so the panel reflects the
  // initial state, then tear everything down when the component's reactive scope is disposed.
  const stopSubscribe = client.subscribe(s => {
    if (s.status !== 'connected') approvals.clear();
    state.value = s;
    sessionId.value = client.sessionId;
  });
  tryOnScopeDispose(() => {
    // Every teardown is attempted even if another callback unexpectedly throws: leaving a socket,
    // pairing fetch, sandbox listener or pending operation alive is worse than losing one error.
    for (const dispose of [
      stopSubscribe,
      stopContext,
      pairing.dispose,
      approvals.clear,
      binding.dispose,
      () => cancelTransition?.(),
      () => client.setApprovalHandler(null),
      () => client.setToolHandler(null),
      () => client.setToolCancelHandler(null),
      bridge.dispose,
    ]) {
      try {
        dispose();
      } catch {
        // Cleanup remains fail-safe and never logs credentials held by the failed owner.
      }
    }
    void client.disconnect({ forgetCredential: true }).catch(() => {});
  });

  return {
    state,
    context,
    // Derived here rather than in the panel: "the agent is working" is a fact about the session, and
    // more than one piece of chrome reads it.
    busy: computed(() => state.value.activity.some(e => e.status === 'pending')),
    sessionId,
    pairing,
    approvals,
    binding,
    buildDiagnostics: () =>
      buildDiagnosticBundle(state.value, context.value, {
        pluginVersion: appVersion,
        protocolVersion: PROTOCOL_VERSION,
        sessionId: client.sessionId,
        userAgent: navigator.userAgent,
      }),
  };
};
