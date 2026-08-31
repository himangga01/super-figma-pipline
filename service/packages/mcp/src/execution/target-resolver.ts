import type {
  FileIdentity,
  InvocationTargetSelector,
  PluginTarget,
  TargetRequirement,
} from '@sfp/shared';
import { Base64Url128Schema, canonicalFileIdentityHash } from '@sfp/shared';

export interface AuthenticatedTargetSession {
  sessionId: string;
  pluginGeneration: string;
  fileIdentity: Readonly<FileIdentity>;
  editorType: 'figma' | 'figjam' | 'dev';
  capabilities: readonly string[];
  connectedSequence: number;
  healthy: boolean;
}

export interface AuthenticatedSessionIndex {
  active(): AuthenticatedTargetSession | undefined;
  list(): readonly AuthenticatedTargetSession[];
}

export type TargetResolutionErrorCode =
  | 'TARGET_FORBIDDEN'
  | 'TARGET_REQUIRED'
  | 'TARGET_SESSION_INVALID'
  | 'TARGET_SESSION_NOT_FOUND'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_SELECTOR_AMBIGUOUS'
  | 'PLUGIN_NOT_CONNECTED';

export class TargetResolutionError extends Error {
  constructor(
    readonly code: TargetResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TargetResolutionError';
  }
}

const fileExecutionKeyFor = (
  session: AuthenticatedTargetSession,
): PluginTarget['fileExecutionKey'] => {
  const identity = session.fileIdentity;
  if (identity.kind === 'figma-file-key') return `figma:${identity.value}`;
  if (identity.kind === 'document-plugin-uuid') return `plugin-uuid:${identity.value}`;
  return `unstable:${session.sessionId}:${session.pluginGeneration}`;
};

const freezeTarget = (session?: AuthenticatedTargetSession): Readonly<PluginTarget> => {
  if (session === undefined) {
    return Object.freeze({
      sessionId: null,
      pluginGeneration: null,
      fileIdentity: null,
      fileExecutionKey: null,
      editorType: null,
      capabilities: null,
    });
  }
  const fileIdentity = Object.freeze({ ...session.fileIdentity });
  return Object.freeze({
    sessionId: session.sessionId,
    pluginGeneration: session.pluginGeneration,
    fileIdentity,
    fileExecutionKey: fileExecutionKeyFor(session),
    editorType: session.editorType,
    capabilities: Object.freeze([...session.capabilities]),
  });
};

export class TargetResolver {
  constructor(private readonly sessions: AuthenticatedSessionIndex) {}

  resolve(
    selector: InvocationTargetSelector,
    requirement: TargetRequirement,
  ): Readonly<PluginTarget> {
    if (requirement === 'forbidden' && selector.kind !== 'none') {
      throw new TargetResolutionError('TARGET_FORBIDDEN', 'this operation forbids a plugin target');
    }
    if (selector.kind === 'none') {
      if (requirement === 'required') {
        throw new TargetResolutionError(
          'TARGET_REQUIRED',
          'this operation requires a plugin target',
        );
      }
      return freezeTarget();
    }

    let selected: AuthenticatedTargetSession | undefined;
    if (selector.kind === 'active') {
      selected = this.sessions.active();
      if (selected === undefined || !selected.healthy) {
        throw new TargetResolutionError(
          'PLUGIN_NOT_CONNECTED',
          'no healthy authenticated plugin session is connected',
        );
      }
    } else if (selector.kind === 'session') {
      if (!Base64Url128Schema.safeParse(selector.sessionId).success) {
        throw new TargetResolutionError('TARGET_SESSION_INVALID', 'session selector is invalid');
      }
      selected = this.sessions
        .list()
        .find(candidate => candidate.healthy && candidate.sessionId === selector.sessionId);
      if (selected === undefined) {
        throw new TargetResolutionError(
          'TARGET_SESSION_NOT_FOUND',
          'authenticated target session was not found',
        );
      }
    } else {
      const matches = this.sessions
        .list()
        .filter(
          candidate =>
            candidate.healthy &&
            canonicalFileIdentityHash(candidate.fileIdentity) === selector.fileIdentityHash,
        );
      if (matches.length === 0) {
        throw new TargetResolutionError(
          'TARGET_NOT_FOUND',
          'no healthy authenticated session matches the stable file selector',
        );
      }
      const identityRepresentations = new Set(
        matches.map(candidate => JSON.stringify(candidate.fileIdentity)),
      );
      if (identityRepresentations.size !== 1) {
        throw new TargetResolutionError(
          'TARGET_SELECTOR_AMBIGUOUS',
          'stable file selector matches different authenticated identities',
        );
      }
      selected = matches.toSorted(
        (left, right) =>
          right.connectedSequence - left.connectedSequence ||
          (left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0),
      )[0];
    }
    return freezeTarget(selected);
  }
}
