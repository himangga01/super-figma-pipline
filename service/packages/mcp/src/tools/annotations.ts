import type { ToolAnnotations } from '@modelcontextprotocol/server';

import { operationPolicyFor } from '../policy/operation-policy.js';
import type { ToolSpec } from './spec.js';

/**
 * Static MCP hints are the conservative union of a tool's possible dynamic effects. Runtime
 * approval still uses parsed args; these hints never claim a conditional filesystem writer is
 * read-only or that URL import is closed-world.
 *
 * Lives here rather than inline in index.ts so the wire gate can assert what a client actually
 * receives against this same function, instead of restating the rule and drifting from it.
 */
export const annotationsFor = (spec: ToolSpec<unknown, unknown>): ToolAnnotations => {
  const policy = operationPolicyFor(spec.name);
  const possible = policy.possibleEffects;
  const readOnlyHint = possible.every(
    effect => effect.type === 'figma-read' || effect.type === 'filesystem-read',
  );
  const destructiveHint = possible.some(
    effect =>
      (effect.type === 'figma-write' && effect.destructive) ||
      (effect.type === 'filesystem-write' && effect.destructive),
  );
  return {
    readOnlyHint,
    destructiveHint,
    idempotentHint: policy.idempotencyFor({}) === 'safe-retry',
    openWorldHint: possible.some(effect => effect.type === 'network'),
  };
};
