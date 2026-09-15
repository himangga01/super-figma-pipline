/** An internal live snapshot; transport JSON and expired callbacks cannot authorize a managed purge. */
export interface OperationRetentionScope {
  isHeld(operationId: string): boolean;
}
const active = new WeakSet<object>();
export function assertOperationRetentionScope(
  scope: unknown,
): asserts scope is OperationRetentionScope {
  if (typeof scope !== 'object' || scope === null || !active.has(scope))
    throw Object.assign(new Error('RECIPE_HOLD_RETENTION_SCOPE_INVALID'), {
      code: 'RECIPE_HOLD_RETENTION_SCOPE_INVALID',
    });
}
/** The retention manager calls this only while holding its durable state-root mutex. */
export async function withOperationRetentionScope<T>(
  operationIds: ReadonlySet<string>,
  work: (scope: OperationRetentionScope) => Promise<T>,
): Promise<T> {
  const held = new Set(operationIds);
  const scope: OperationRetentionScope = Object.freeze({
    isHeld(operationId: string) {
      assertOperationRetentionScope(scope);
      return held.has(operationId);
    },
  });
  active.add(scope);
  try {
    return await work(scope);
  } finally {
    active.delete(scope);
  }
}
