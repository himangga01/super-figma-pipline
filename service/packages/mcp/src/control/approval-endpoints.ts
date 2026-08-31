import { ApprovalDecisionV1Schema, type ActorContext } from '@sfp/shared';

import type { ApprovalBroker } from '../policy/approval-broker.js';

export const createApprovalEndpoints = (dependencies: {
  broker: ApprovalBroker;
  leaderGeneration(): string;
}) =>
  Object.freeze({
    list: async (principal: Readonly<ActorContext>) => dependencies.broker.listPending(principal),
    settle: async (principal: Readonly<ActorContext>, input: unknown): Promise<{ ok: true }> => {
      const decision = ApprovalDecisionV1Schema.parse(input);
      await dependencies.broker.settleControl(principal, decision, dependencies.leaderGeneration());
      return { ok: true };
    },
  });
