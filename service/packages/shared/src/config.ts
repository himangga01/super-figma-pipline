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
  addedAt: string;
}

/** Resolves every project filesystem effect against an explicitly approved workspace. */
export interface WorkspacePolicy {
  resolveRead(workspaceId: string, input: string): Promise<string>;
  resolveWrite(workspaceId: string, input: string): Promise<{ path: string; overwrites: boolean }>;
  assertWithinRoot(workspaceId: string, path: string): Promise<void>;
}

/** Owner-state lifecycle for explicit, authenticated workspace registrations. */
export interface WorkspaceConfigStore {
  add(actorId: string, path: string): Promise<WorkspaceRoot>;
  list(): Promise<readonly WorkspaceRoot[]>;
  remove(actorId: string, workspaceId: string): Promise<void>;
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
