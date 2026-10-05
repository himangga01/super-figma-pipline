import { nativeNodeId } from './figma-native-document.js';

type Row = Record<string, unknown>;
const object = (value: unknown): Row | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
const only = (row: Row, keys: readonly string[]) =>
  Object.keys(row).every(key => keys.includes(key));

/** Native instance overrides can contain only changed action fields under a stable interaction ID. */
export function mergeNativeReactions(base: unknown, update: unknown): unknown {
  if (base === undefined) return update;
  if (!Array.isArray(base) || !Array.isArray(update) || base.length + update.length > 2048)
    return null;
  const merged = new Map<string, Row>();
  for (const entries of [base, update]) {
    const seen = new Set<string>();
    for (const value of entries) {
      const row = object(value),
        id = nativeNodeId(row?.id);
      if (!row || id === null || seen.has(id)) return null;
      seen.add(id);
      const previous = merged.get(id);
      const next = { ...previous, ...row };
      if (
        previous &&
        Array.isArray(previous.actions) &&
        Array.isArray(row.actions) &&
        previous.actions.length === 1 &&
        row.actions.length === 1 &&
        object(previous.actions[0]) &&
        object(row.actions[0])
      )
        next.actions = [{ ...object(previous.actions[0]), ...object(row.actions[0]) }];
      merged.set(id, next);
    }
  }
  return [...merged.values()];
}

/** Decode the closed native click-navigation form; preserve every other form as unknown. */
export function readNativeReactions(value: unknown): Row[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1024) return null;
  const reactions: Row[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = object(entry);
    if (!row || (row.isDeleted !== undefined && typeof row.isDeleted !== 'boolean')) return null;
    const id = nativeNodeId(row.id);
    if (id === null || seen.has(id)) return null;
    seen.add(id);
    if (row.isDeleted === true) continue;
    if (
      !only(row, ['id', 'event', 'actions', 'isDeleted', 'stateManagementVersion']) ||
      (row.stateManagementVersion !== undefined && row.stateManagementVersion !== 1)
    )
      return null;
    const event = object(row.event);
    if (
      !event ||
      !only(event, ['interactionType']) ||
      event.interactionType !== 'ON_CLICK' ||
      !Array.isArray(row.actions) ||
      row.actions.length !== 1
    )
      return null;
    const actions: Row[] = [];
    for (const input of row.actions) {
      const action = object(input);
      if (
        !action ||
        !only(action, ['transitionNodeID', 'connectionType', 'navigationType']) ||
        action.connectionType !== 'INTERNAL_NODE' ||
        action.navigationType !== 'NAVIGATE'
      )
        return null;
      const guid = object(action.transitionNodeID);
      const destinationId = nativeNodeId(guid);
      if (
        !guid ||
        !only(guid, ['sessionID', 'localID']) ||
        destinationId === null ||
        Number(guid.sessionID) < 0 ||
        Number(guid.localID) < 0
      )
        return null;
      actions.push({
        type: 'NODE',
        destinationId,
        navigation: 'NAVIGATE',
        transition: null,
        resetVideoPosition: false,
      });
    }
    reactions.push({ trigger: { type: 'ON_CLICK' }, action: actions[0], actions });
  }
  return reactions;
}
