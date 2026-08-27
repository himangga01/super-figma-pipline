/** A side effect resolved from already-parsed tool arguments. */
export type Effect =
  | { type: 'figma-read' }
  | { type: 'figma-write'; destructive: boolean; broad: boolean }
  | { type: 'figma-ui' }
  | { type: 'figma-library-import' }
  | { type: 'filesystem-read'; pathArgs: readonly string[] }
  | { type: 'filesystem-write'; pathArgs: readonly string[]; destructive: boolean }
  | { type: 'network'; urlArg: string };

/** Task 4's canonical workspace resolution, carried into pure effect classification. */
export interface ResolvedWorkspacePath {
  path: string;
  overwrites: boolean;
}

export interface WorkspaceInvocationContext {
  workspaceId: string | null;
  workspaceRoot: string | null;
}

/**
 * The policy-visible part of an invocation. Auth, approval execution, file identity, and dispatch
 * are deliberately absent here; later execution tasks may compose those authorities around this one
 * without making policy classification perform side effects.
 */
export interface InvocationContext {
  workspace: WorkspaceInvocationContext;
  /** Present after Task 4 resolves path arguments; absent means no overwrite has been observed. */
  resolvedPaths?: Readonly<Record<string, ResolvedWorkspacePath>>;
}

export type ApprovalRequirement = 'none' | 'client' | 'explicit-user';
export type IdempotencyRequirement = 'safe-retry' | 'operation-id' | 'never-auto-retry';
export type ConcurrencyRequirement = 'parallel-read' | 'file-write' | 'exclusive-heavy';

export interface OperationPolicy<I = Readonly<Record<string, unknown>>> {
  toolName: string;
  /** Worst-case union used for static MCP annotations. */
  possibleEffects: readonly Effect[];
  /** Worst retry behavior across all valid parsed argument branches. */
  possibleIdempotency: IdempotencyRequirement;
  effectsFor(args: Readonly<I>, context: InvocationContext): readonly Effect[];
  idempotencyFor(args: Readonly<I>): IdempotencyRequirement;
  approvalFor(effects: readonly Effect[], context: InvocationContext): ApprovalRequirement;
  concurrency: ConcurrencyRequirement;
}

export type OperationPolicyRegistry = Readonly<Record<string, OperationPolicy>>;
