import type { McpSessionId } from './auth.js';

/** Owner-only service state and the user-approved roots visible to this process. */
export interface RuntimePaths {
  stateRoot: string;
  workspaceRoots: readonly WorkspaceRoot[];
}

/** One workspace registration persisted under owner-only service state. */
export interface WorkspaceRoot {
  workspaceId: string;
  path: string;
  realPath: string;
  /** Present on every v2 record; optional only for the read-only Task4 bootstrap seam. */
  rootIdentityKey?: string;
  addedAt: string;
}

export interface RegisteredWorkspaceRoot extends WorkspaceRoot {
  rootIdentityKey: string;
}

/** Resolves every project filesystem effect against an explicitly approved workspace. */
export interface WorkspacePolicy {
  resolveRoot?(workspaceId: string): Promise<string>;
  resolveRead(workspaceId: string, input: string): Promise<string>;
  resolveWrite(workspaceId: string, input: string): Promise<{ path: string; overwrites: boolean }>;
  resolveWriteDirectory?(
    workspaceId: string,
    input: string,
  ): Promise<{ path: string; exists: boolean }>;
  assertWithinRoot(workspaceId: string, path: string): Promise<void>;
}

export interface ResolvedWorkspaceRegistration {
  requestedPath: string;
  realPath: string;
  identityKey: string;
}

export interface WorkspaceRegistrationResolver {
  resolveForNonce(path: string): Promise<Readonly<ResolvedWorkspaceRegistration>>;
  revalidateInsideMutation(
    expected: Readonly<ResolvedWorkspaceRegistration>,
  ): Promise<Readonly<ResolvedWorkspaceRegistration>>;
}

/** Owner-state lifecycle for explicit, authenticated workspace registrations. */
export interface WorkspaceConfigStore {
  addResolved(
    actorId: string,
    expected: Readonly<ResolvedWorkspaceRegistration>,
    consumeNonceCas: (revalidateImmediatelyBeforeConsume: () => Promise<void>) => Promise<void>,
  ): Promise<RegisteredWorkspaceRoot>;
  list(): Promise<readonly WorkspaceRoot[]>;
  remove(actorId: string, workspaceId: string): Promise<void>;
  removeAuthorized(
    actorId: string,
    workspaceId: string,
    consumeNonceCas: () => Promise<void>,
  ): Promise<void>;
  setDefault(actorId: string, workspaceId: string | null): Promise<void>;
  setDefaultAuthorized(
    actorId: string,
    workspaceId: string | null,
    consumeNonceCas: () => Promise<void>,
  ): Promise<void>;
  getDefault(): Promise<string | null>;
}

/** Test/bootstrap-only convenience, deliberately excluded from authenticated WorkspaceConfigStore. */
export interface WorkspaceBootstrapStore extends WorkspaceConfigStore {
  add(actorId: string, path: string): Promise<RegisteredWorkspaceRoot>;
}

export interface McpWorkspaceBinding {
  resolveRequiredForMcpSession(mcpSession: McpSessionId): Promise<string>;
}

/** Task 7 supplies the journal-backed implementation; Task 4 depends only on this seam. */
export interface WorkspaceUsageGuard {
  hasUnsettled(workspaceId: string): Promise<boolean>;
}

/** Creates or verifies owner-only permissions without weakening a failed check. */
export interface StatePermissions {
  readonly stateRoot: string;
  ensureSecure(path: string): Promise<void>;
  verifySecure(path: string): Promise<void>;
}
