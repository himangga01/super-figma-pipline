export type Tab = 'activity' | 'context' | 'pairing' | 'approvals' | 'debug';

/** Tab order drives both the button row and the sliding indicator's offset. */
export const TABS = [
  ['activity', 'Activity'],
  ['context', 'Context'],
  ['pairing', 'Pairing'],
  ['approvals', '승인'],
  ['debug', 'Debug'],
] as const satisfies ReadonlyArray<readonly [Tab, string]>;
