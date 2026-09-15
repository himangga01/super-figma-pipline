import { contentHash } from '@sfp/ir';
import {
  canonicalFileIdentityHash,
  type InvocationTargetSelector,
  type PluginTarget,
} from '@sfp/shared';

import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import {
  PortalCaptureGrantSchema,
  type PortalCaptureGrant,
} from '../../../shared/src/portal-capture-source.js';
import type { SessionDocumentBinding } from '../execution/identity-bootstrap-coordinator.js';
import type {
  AuthenticatedSessionIndex,
  AuthenticatedTargetSession,
} from '../execution/target-resolver.js';
import { TargetResolver } from '../execution/target-resolver.js';
import type { DocumentBindingStore } from '../security/document-binding-store.js';
import { portalError } from './store.js';
export interface PortalSourceRequest {
  source: 'chrome' | 'desktop';
  url: string;
}
export interface PortalDocumentBinding {
  fileKeyHash: string;
  bindingHash: string;
}
export interface PortalCaptureAdmissionPorts {
  sessions: AuthenticatedSessionIndex;
  bindingFor(session: AuthenticatedTargetSession): Promise<PortalDocumentBinding | null>;
}
export async function resolvePortalCaptureSource(
  request: PortalSourceRequest,
  selector: InvocationTargetSelector,
  ports: PortalCaptureAdmissionPorts,
): Promise<{ grant: PortalCaptureGrant; target: Readonly<PluginTarget> }> {
  const requested = parseFigmaTarget(request.url);
  const fileKeyHash = canonicalFileIdentityHash({
    kind: 'figma-file-key',
    value: requested.fileKey,
  });
  const common = { version: 1, url: requested.url, fileKeyHash, requestedNodeId: requested.nodeId };
  const resolver = new TargetResolver(ports.sessions);
  const automatic = selector.kind === 'portal-source';
  if (request.source === 'chrome') {
    const target = resolver.resolve(automatic ? { kind: 'none' } : selector, 'forbidden');
    return {
      grant: PortalCaptureGrantSchema.parse({
        ...common,
        kind: 'chrome',
        phase: 'requested-source',
        binding: 'selected-page-after-approved-connection',
      }),
      target,
    };
  }
  if (selector.kind === 'none') throw portalError('TARGET_REQUIRED');
  const observed = ports.sessions
    .list()
    .filter(row => row.healthy)
    .map(row =>
      Object.assign({}, row, {
        fileIdentity: Object.freeze({ ...row.fileIdentity }),
        capabilities: [...row.capabilities],
      }),
    );
  const bindings = await Promise.all(
    observed.map(async session => ({
      session,
      binding:
        session.fileIdentity.kind === 'figma-file-key'
          ? {
              fileKeyHash: canonicalFileIdentityHash(session.fileIdentity),
              bindingHash: contentHash('sfp-portal-direct-file-binding-v1', session.fileIdentity),
            }
          : await ports.bindingFor(session),
    })),
  );
  const matches = bindings.filter(row => row.binding?.fileKeyHash === fileKeyHash);
  if (matches.length === 0)
    throw portalError(
      !observed.length
        ? 'PLUGIN_NOT_CONNECTED'
        : bindings.some(row => row.binding !== null)
          ? 'DESKTOP_FILE_MISMATCH'
          : 'DESKTOP_FILE_IDENTITY_UNVERIFIED',
    );
  let selected;
  if (selector.kind === 'session')
    selected = matches.find(row => row.session.sessionId === selector.sessionId);
  else {
    if (matches.length !== 1) throw portalError('TARGET_SELECTOR_AMBIGUOUS');
    selected = matches[0];
    if (!automatic) {
      const explicit = resolver.resolve(selector, 'required');
      if (explicit.sessionId !== selected?.session.sessionId)
        throw portalError('DESKTOP_FILE_MISMATCH');
    }
  }
  if (!selected?.binding) throw portalError('DESKTOP_FILE_MISMATCH');
  const target = resolver.resolve(
    { kind: 'session', sessionId: selected.session.sessionId },
    'required',
  );
  if (
    target.pluginGeneration !== selected.session.pluginGeneration ||
    !target.fileIdentity ||
    canonicalFileIdentityHash(target.fileIdentity) !==
      canonicalFileIdentityHash(selected.session.fileIdentity)
  )
    throw portalError('PORTAL_CAPTURE_TARGET_CHANGED');
  if (
    target.editorType !== 'figma' ||
    !target.sessionId ||
    !target.pluginGeneration ||
    !target.fileExecutionKey
  )
    throw portalError('PORTAL_DESKTOP_EDITOR_UNSUPPORTED');
  return {
    target,
    grant: PortalCaptureGrantSchema.parse({
      ...common,
      kind: 'desktop',
      phase: 'pinned-target',
      sessionId: target.sessionId,
      pluginGeneration: target.pluginGeneration,
      fileIdentityHash: canonicalFileIdentityHash(target.fileIdentity),
      fileExecutionKey: target.fileExecutionKey,
      bindingMethod:
        target.fileIdentity.kind === 'figma-file-key' ? 'file-key' : 'owner-confirmed-document',
      bindingHash: selected.binding.bindingHash,
    }),
  };
}
export async function revalidatePortalCaptureGrant(
  grant: PortalCaptureGrant,
  target: Readonly<PluginTarget>,
  ports: PortalCaptureAdmissionPorts,
): Promise<void> {
  if (grant.kind === 'chrome') {
    if (target.sessionId !== null) throw portalError('TARGET_FORBIDDEN');
    return;
  }
  const current = await resolvePortalCaptureSource(
    { source: 'desktop', url: grant.url },
    { kind: 'session', sessionId: grant.sessionId },
    ports,
  );
  if (
    JSON.stringify(current.grant) !== JSON.stringify(grant) ||
    current.target.sessionId !== target.sessionId ||
    current.target.pluginGeneration !== target.pluginGeneration ||
    !target.fileIdentity ||
    canonicalFileIdentityHash(target.fileIdentity) !== grant.fileIdentityHash
  )
    throw portalError('PORTAL_CAPTURE_TARGET_CHANGED');
}

/**
 * Consumes only the existing authenticated owner binding stores, never status output or caller
 * claims.
 */
export const createPortalBindingResolver =
  (dependencies: {
    fileName(sessionId: string): string | null | undefined;
    documents: Pick<DocumentBindingStore, 'get'>;
    sessions: ReadonlyMap<string, SessionDocumentBinding>;
  }): PortalCaptureAdmissionPorts['bindingFor'] =>
  async target => {
    const fileName = dependencies.fileName(target.sessionId);
    if (fileName == null) return null;
    const bound = dependencies.sessions.get(target.sessionId);
    if (
      bound &&
      bound.pluginGeneration === target.pluginGeneration &&
      bound.fileIdentityHash === canonicalFileIdentityHash(target.fileIdentity) &&
      bound.fileName === fileName
    )
      return {
        fileKeyHash: bound.fileKeyHash,
        bindingHash: contentHash('sfp-portal-owner-session-binding-v1', bound),
      };
    if (target.fileIdentity.kind !== 'document-plugin-uuid') return null;
    const document = await dependencies.documents.get(target.fileIdentity);
    return document && document.fileName === fileName
      ? {
          fileKeyHash: document.fileKeyHash,
          bindingHash: contentHash('sfp-portal-owner-document-binding-v1', document),
        }
      : null;
  };
