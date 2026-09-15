import { IdentityPublishSchema, IdentityReadySchema } from '@sfp/shared';

import {
  createPluginContextEvent,
  createToolProgress,
  isPluginBridgeMessage,
  SELECTION_DETAIL_LIMIT,
  type PluginExecutionBinding,
} from '../protocol/bridge.js';
import { createToolError } from '../protocol/bridge.js';
import { PluginIdentitySeedSchema } from '../protocol/identity-seed.js';
import { parsePanelControl } from '../protocol/panel-control.js';
import { createSandboxCancellation } from './cancellation.js';
import { dispatchSandboxMessage } from './dispatcher.js';
import { createPluginHelloIdentityFacts, type PluginIdentityLifetime } from './file-identity.js';
import { createSandboxHandlers } from './handlers/registry.js';
import { createIdentityBootstrap } from './identity-bootstrap.js';
import { createPanelController } from './panel.js';

const log = (msg: string): void => console.log(msg);

const panel = createPanelController(figma);
panel.open(__html__);
let identityLifetime: Readonly<PluginIdentityLifetime> | null = null;
let identityHeld = false;
let heldIdentity: ReturnType<typeof createPluginHelloIdentityFacts> | null = null;
let advertisedIdentity: string | null = null;
const activeExecutions = new Map<
  string,
  Readonly<{
    binding: Readonly<PluginExecutionBinding>;
    controller: ReturnType<typeof createSandboxCancellation>;
  }>
>();

const sameBinding = (
  left: Readonly<PluginExecutionBinding>,
  right: Readonly<PluginExecutionBinding>,
): boolean =>
  left.requestId === right.requestId &&
  left.operationId === right.operationId &&
  left.actionNonce === right.actionNonce;

const supportedEditorType = (): 'figma' | 'figjam' | 'dev' => {
  const editorType = figma.editorType;
  if (editorType === 'figma' || editorType === 'figjam' || editorType === 'dev') return editorType;
  throw Object.assign(new Error('unsupported plugin editor'), {
    code: 'PLUGIN_EDITOR_UNSUPPORTED',
  });
};

// Push the current Figma context to the UI so its Context tab reflects what the plugin sees.
const emitContext = (): void => {
  if (identityLifetime === null) return;
  const page = figma.currentPage;
  const editorType = supportedEditorType();
  const selection = page.selection.slice(0, SELECTION_DETAIL_LIMIT).map(n => ({
    id: n.id,
    name: n.name,
    type: n.type,
    width: 'width' in n ? Math.round(n.width) : 0,
    height: 'height' in n ? Math.round(n.height) : 0,
  }));
  const identity = heldIdentity ?? createPluginHelloIdentityFacts(figma, identityLifetime);
  advertisedIdentity = JSON.stringify(identity.fileIdentity);
  const event = createPluginContextEvent({
    fileName: figma.root.name,
    pageId: page.id,
    pageName: page.name,
    selectionCount: page.selection.length,
    selection,
    editorType,
    // The typings declare `mode` as always present, but it is Figma's value to supply, not ours —
    // and a declaration is not a guarantee, which is the whole lesson of this file's editor
    // handling. The context event is schema-validated on arrival, so an absent `mode` would fail
    // the parse and strand the panel on "Waiting for plugin context…" — a far worse failure than
    // not knowing how the plugin was launched. `default` is the assumption that degrades safely.
    mode: figma.mode ?? 'default',
    apiVersion: figma.apiVersion,
    pluginGeneration: identity.pluginGeneration,
    fileIdentity: identity.fileIdentity,
    capabilities: identity.capabilities,
  });
  // figma.ui.postMessage is the Figma plugin API — there is no targetOrigin parameter
  // eslint-disable-next-line unicorn/require-post-message-target-origin
  figma.ui.postMessage(event);
};

const handlers = createSandboxHandlers(figma);
const identityBootstrap = createIdentityBootstrap(
  figma,
  () => identityLifetime?.pluginGeneration ?? '',
  value => {
    if (value && identityLifetime !== null)
      heldIdentity ??= createPluginHelloIdentityFacts(figma, identityLifetime);
    if (!value) heldIdentity = null;
    identityHeld = value;
  },
);

figma.ui.onmessage = (raw: unknown) => {
  const publication = IdentityPublishSchema.safeParse(raw);
  if (publication.success) {
    if (identityBootstrap.publish(publication.data.nonce)) {
      identityHeld = true;
      emitContext();
    }
    return;
  }
  const identityReady = IdentityReadySchema.safeParse(raw);
  if (identityReady.success) {
    if (identityBootstrap.ready(identityReady.data.nonce)) emitContext();
    return;
  }
  const seed = PluginIdentitySeedSchema.safeParse(raw);
  if (seed.success) {
    // Pin once per sandbox lifetime. A remounted UI can request context but cannot rotate identity.
    identityLifetime ??= Object.freeze({
      provisionalSessionId: seed.data.provisionalSessionId,
      pluginGeneration: seed.data.pluginGeneration,
    });
    emitContext();
    return;
  }
  // Panel control (resize / hide / reveal) is driven by the user's own clicks, not the agent, so
  // it's carried out here and never produces a relay reply. Anything else is tool traffic.
  const control = parsePanelControl(raw);
  if (control !== null) {
    panel.apply(control);
    return;
  }
  if (isPluginBridgeMessage(raw) && raw.kind === 'tool-cancel') {
    const active = activeExecutions.get(raw.id);
    if (active !== undefined && sameBinding(active.binding, raw.binding)) {
      active.controller.abort(
        Object.assign(new Error('sandbox operation cancelled'), { code: 'OPERATION_CANCELLED' }),
      );
      activeExecutions.delete(raw.id);
    }
    return;
  }
  void (async (): Promise<void> => {
    const call = isPluginBridgeMessage(raw) && raw.kind === 'tool-call' ? raw : null;
    if (call === null) return;
    if (
      !identityHeld &&
      identityLifetime !== null &&
      advertisedIdentity !== null &&
      JSON.stringify(createPluginHelloIdentityFacts(figma, identityLifetime).fileIdentity) !==
        advertisedIdentity &&
      !call.method.startsWith('$identity.')
    ) {
      emitContext();
      /* eslint-disable unicorn/require-post-message-target-origin -- Figma host API has no origin argument */
      figma.ui.postMessage(
        createToolError({
          id: call.id,
          code: 'FILE_IDENTITY_CHANGED',
          message: 'Reconnect to the current document identity before continuing.',
        }),
      );
      /* eslint-enable unicorn/require-post-message-target-origin */
      return;
    }
    if (identityHeld && !call.method.startsWith('$identity.')) {
      /* eslint-disable unicorn/require-post-message-target-origin -- Figma host API has no origin parameter */
      figma.ui.postMessage(
        createToolError({
          id: call.id,
          code: 'FILE_IDENTITY_TRANSITION_PENDING',
          message: 'file identity is being rebound',
        }),
      );
      /* eslint-enable unicorn/require-post-message-target-origin */
      return;
    }
    const controller = createSandboxCancellation();
    const binding = call.binding;
    if (binding !== undefined) {
      if (activeExecutions.has(call.id)) return;
      activeExecutions.set(call.id, Object.freeze({ binding, controller }));
    }
    const outcome = await dispatchSandboxMessage({
      raw: call,
      handlers: call.method.startsWith('$identity.') ? identityBootstrap.handlers : handlers,
      editorType: supportedEditorType(),
      log,
      ...(binding === undefined
        ? {}
        : {
            execution: {
              requestId: binding.requestId,
              signal: controller.signal,
              report: progress => {
                if (controller.signal.aborted) return;
                const message = createToolProgress({
                  id: call.id,
                  binding,
                  progress: {
                    ...progress,
                    operationId: binding.operationId,
                    emittedAt: Date.now(),
                  },
                });
                // figma.ui.postMessage is the Figma plugin API and has no targetOrigin parameter.
                // eslint-disable-next-line unicorn/require-post-message-target-origin
                figma.ui.postMessage(message);
              },
            },
          }),
    });
    if (binding !== undefined) {
      const active = activeExecutions.get(call.id);
      if (active?.controller !== controller) return;
      activeExecutions.delete(call.id);
    }
    if (outcome.kind === 'reply') {
      // figma.ui.postMessage is the Figma plugin API — there is no targetOrigin parameter
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      figma.ui.postMessage(outcome.reply);
    }
  })();
};

emitContext();
figma.on('currentpagechange', emitContext);
figma.on('selectionchange', emitContext);
