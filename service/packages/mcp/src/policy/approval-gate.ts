import type { ResolvedInvocationScope } from '@sfp/shared';

export type ApprovalChannel = 'plugin-session' | 'owner-control-session';

export const selectApprovalChannel = (
  scope: Readonly<ResolvedInvocationScope>,
): ApprovalChannel | null => {
  if (scope.actor.entryPath === 'control') return 'owner-control-session';
  if (scope.actor.entryPath === 'internal-system') {
    return scope.target.fileExecutionKey === null ? null : 'plugin-session';
  }
  return scope.target.fileExecutionKey === null ? null : 'plugin-session';
};
