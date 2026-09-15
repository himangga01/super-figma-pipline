import {
  ApprovalDecisionV1Schema,
  type ActorContext,
  type ApprovalBindingV1,
  type ApprovalDecisionV1,
  type ApprovalPromptV1,
} from '@sfp/shared';

import type { ApprovalDecisionPort } from '../execution/execution-plane.js';
import { selectApprovalChannel } from './approval-gate.js';
import { createApprovalPrompt } from './approval-prompt.js';

export interface PluginApprovalPrincipal {
  pairedSessionId: string;
  leaderGeneration: string;
  pluginGeneration: string;
  fileExecutionKey: string;
}

export interface ApprovalBrokerOptions {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  deliverPluginPrompt(prompt: Readonly<ApprovalPromptV1>): Promise<void>;
  deliverControlPrompt(prompt: Readonly<ApprovalPromptV1>): Promise<void>;
}

export class ApprovalBrokerError extends Error {
  constructor(
    readonly code:
      | 'APPROVAL_ALREADY_SETTLED'
      | 'APPROVAL_CONTROL_SESSION_MISMATCH'
      | 'APPROVAL_EXPIRED'
      | 'APPROVAL_GENERATION_MISMATCH'
      | 'APPROVAL_HASH_MISMATCH'
      | 'APPROVAL_NOT_FOUND'
      | 'APPROVAL_SESSION_MISMATCH'
      | 'APPROVAL_TARGET_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'ApprovalBrokerError';
  }
}

interface PendingApproval {
  prompt: Readonly<ApprovalPromptV1>;
  binding: ApprovalBindingV1;
  published: boolean;
  deliveryStarted: boolean;
  delivered: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  promise: Promise<Readonly<{ decision: 'approved' | 'rejected' | 'expired' }>>;
  resolve(decision: Readonly<{ decision: 'approved' | 'rejected' | 'expired' }>): void;
  reject(error: unknown): void;
}

const settled = (state: ApprovalBindingV1['state']): boolean => state !== 'pending';
const finishApproval = (
  pending: PendingApproval,
  decision: ApprovalDecisionV1['decision'],
): void => {
  pending.binding = { ...pending.binding, state: decision } as ApprovalBindingV1;
  if (pending.timer !== null) clearTimeout(pending.timer);
  pending.timer = null;
  pending.resolve(Object.freeze({ decision }));
};

export interface ApprovalBroker extends ApprovalDecisionPort {
  dispose(): void;
  settleControl(
    principal: Readonly<ActorContext>,
    decision: unknown,
    leaderGeneration: string,
  ): Promise<void>;
  settlePlugin(principal: PluginApprovalPrincipal, decision: unknown): Promise<void>;
  getPrompt(approvalId: string): Readonly<ApprovalPromptV1> | undefined;
  getBinding(approvalId: string): Readonly<ApprovalBindingV1> | undefined;
  listPending(principal: Readonly<ActorContext>): readonly ApprovalPromptV1[];
  redeliverPlugin(principal: PluginApprovalPrincipal): Promise<number>;
}

export const createApprovalBroker = (options: ApprovalBrokerOptions): ApprovalBroker => {
  const now = options.now ?? Date.now;
  const pendingById = new Map<string, PendingApproval>();

  const expire = (pending: PendingApproval): void => {
    if (settled(pending.binding.state)) return;
    pending.binding = { ...pending.binding, state: 'expired' } as ApprovalBindingV1;
    pending.resolve(Object.freeze({ decision: 'expired' }));
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.timer = null;
  };
  const deliver = async (pending: PendingApproval): Promise<void> => {
    if (pending.delivered || settled(pending.binding.state)) return;
    if (pending.binding.channel === 'plugin-session') {
      await options.deliverPluginPrompt(pending.prompt);
    } else {
      await options.deliverControlPrompt(pending.prompt);
    }
    pending.delivered = true;
  };
  const activate = (pending: PendingApproval): void => {
    if (pending.published) return;
    pending.published = true;
    const delay = Math.max(0, pending.binding.expiresAt - now());
    pending.timer = setTimeout(() => expire(pending), delay);
    pending.timer.unref?.();
    pending.deliveryStarted = true;
    void deliver(pending).catch(error => {
      if (settled(pending.binding.state)) return;
      pending.binding = { ...pending.binding, state: 'rejected' } as ApprovalBindingV1;
      if (pending.timer !== null) clearTimeout(pending.timer);
      pending.timer = null;
      pending.reject(error);
    });
  };
  const request: ApprovalDecisionPort['request'] = async (
    scope,
    operationName,
    effects,
    operationId,
  ) => {
    for (const [id, pending] of pendingById) {
      if (now() >= pending.binding.expiresAt) {
        expire(pending);
        pendingById.delete(id);
      } else if (pendingById.size >= 256 && settled(pending.binding.state)) pendingById.delete(id);
    }
    if (pendingById.size >= 256)
      throw Object.assign(new Error('approval capacity exceeded'), {
        code: 'APPROVAL_CAPACITY_EXCEEDED',
      });
    const channel = selectApprovalChannel(scope);
    if (channel === null) return null;
    const prompt = createApprovalPrompt({
      scope,
      operationName,
      effects,
      operationId,
      channel,
      now: now(),
      ...(options.randomBytes === undefined ? {} : { randomBytes: options.randomBytes }),
    });
    let resolveDecision!: PendingApproval['resolve'];
    let rejectDecision!: PendingApproval['reject'];
    const promise = new Promise<Readonly<{ decision: 'approved' | 'rejected' | 'expired' }>>(
      (resolvePromise, rejectPromise) => {
        resolveDecision = resolvePromise;
        rejectDecision = rejectPromise;
      },
    );
    const binding: ApprovalBindingV1 =
      channel === 'plugin-session'
        ? {
            approvalId: prompt.approvalId as `sfp_ap1_${string}`,
            operationId,
            promptHash: prompt.promptHash as `sha256:${string}`,
            actorId: scope.actor.actorId,
            issuedAt: prompt.issuedAt,
            expiresAt: prompt.expiresAt,
            state: 'pending',
            channel,
            pairedSessionId: scope.target.sessionId! as Extract<
              ApprovalBindingV1,
              { channel: 'plugin-session' }
            >['pairedSessionId'],
            leaderGeneration: scope.leaderGeneration,
            pluginGeneration: scope.target.pluginGeneration!,
            fileExecutionKey: scope.target.fileExecutionKey!,
            decisionTransport: 'paired-ws',
          }
        : ({
            approvalId: prompt.approvalId as `sfp_ap1_${string}`,
            operationId,
            promptHash: prompt.promptHash as `sha256:${string}`,
            actorId: scope.actor.actorId,
            issuedAt: prompt.issuedAt,
            expiresAt: prompt.expiresAt,
            state: 'pending',
            channel,
            originControlAuthSessionId: scope.actor.authSessionId,
            leaderGeneration: scope.leaderGeneration,
            pairedSessionId: scope.target.sessionId as Extract<
              ApprovalBindingV1,
              { channel: 'owner-control-session' }
            >['pairedSessionId'],
            pluginGeneration: scope.target.pluginGeneration,
            fileExecutionKey: scope.target.fileExecutionKey,
            decisionTransport: 'authenticated-control',
          } as ApprovalBindingV1);
    const pending: PendingApproval = {
      prompt,
      binding,
      published: false,
      deliveryStarted: false,
      delivered: false,
      timer: null,
      promise,
      resolve: resolveDecision,
      reject: rejectDecision,
    };
    pendingById.set(prompt.approvalId, pending);
    return Object.freeze({
      approvalId: prompt.approvalId,
      waitForDecision: async () => {
        activate(pending);
        return pending.promise;
      },
    });
  };

  const decisionAndPending = (
    input: unknown,
  ): { decision: ApprovalDecisionV1; pending: PendingApproval } => {
    const decision = ApprovalDecisionV1Schema.parse(input);
    const pending = pendingById.get(decision.approvalId);
    if (pending === undefined || !pending.published) {
      throw new ApprovalBrokerError('APPROVAL_NOT_FOUND', 'approval was not found');
    }
    if (settled(pending.binding.state)) {
      throw new ApprovalBrokerError('APPROVAL_ALREADY_SETTLED', 'approval is already settled');
    }
    if (now() >= pending.binding.expiresAt) {
      expire(pending);
      throw new ApprovalBrokerError('APPROVAL_EXPIRED', 'approval has expired');
    }
    if (
      decision.operationId !== pending.binding.operationId ||
      decision.promptHash !== pending.binding.promptHash
    ) {
      throw new ApprovalBrokerError('APPROVAL_HASH_MISMATCH', 'approval decision does not match');
    }
    return { decision, pending };
  };
  const broker: ApprovalBroker = {
    cancel: operationId => {
      for (const pending of pendingById.values())
        if (pending.binding.operationId === operationId) expire(pending);
    },
    dispose: () => {
      for (const pending of pendingById.values()) expire(pending);
      pendingById.clear();
    },
    request,
    settleControl: async (principal, input, leaderGeneration) => {
      const { decision, pending } = decisionAndPending(input);
      if (pending.binding.channel !== 'owner-control-session') {
        throw new ApprovalBrokerError(
          'APPROVAL_CONTROL_SESSION_MISMATCH',
          'plugin approval cannot be settled over control',
        );
      }
      if (
        principal.actorId !== pending.binding.actorId ||
        principal.authSessionId !== pending.binding.originControlAuthSessionId
      ) {
        throw new ApprovalBrokerError(
          'APPROVAL_CONTROL_SESSION_MISMATCH',
          'control approval is bound to its origin auth session',
        );
      }
      if (leaderGeneration !== pending.binding.leaderGeneration) {
        throw new ApprovalBrokerError(
          'APPROVAL_GENERATION_MISMATCH',
          'approval leader generation changed',
        );
      }
      finishApproval(pending, decision.decision);
    },
    settlePlugin: async (principal, input) => {
      const { decision, pending } = decisionAndPending(input);
      if (pending.binding.channel !== 'plugin-session') {
        throw new ApprovalBrokerError(
          'APPROVAL_SESSION_MISMATCH',
          'control approval cannot be settled by a plugin',
        );
      }
      if (principal.pairedSessionId !== pending.binding.pairedSessionId) {
        throw new ApprovalBrokerError(
          'APPROVAL_SESSION_MISMATCH',
          'approval paired session does not match',
        );
      }
      if (
        principal.leaderGeneration !== pending.binding.leaderGeneration ||
        principal.pluginGeneration !== pending.binding.pluginGeneration
      ) {
        throw new ApprovalBrokerError(
          'APPROVAL_GENERATION_MISMATCH',
          'approval generation does not match',
        );
      }
      if (principal.fileExecutionKey !== pending.binding.fileExecutionKey) {
        throw new ApprovalBrokerError('APPROVAL_TARGET_MISMATCH', 'approval target does not match');
      }
      finishApproval(pending, decision.decision);
    },
    getPrompt: approvalId => {
      const pending = pendingById.get(approvalId);
      return pending?.published === true ? pending.prompt : undefined;
    },
    getBinding: approvalId => {
      const pending = pendingById.get(approvalId);
      const binding = pending?.published === true ? pending.binding : undefined;
      return binding === undefined ? undefined : Object.freeze({ ...binding });
    },
    listPending: principal =>
      Object.freeze(
        [...pendingById.values()]
          .filter(
            pending =>
              pending.published &&
              pending.binding.channel === 'owner-control-session' &&
              pending.binding.actorId === principal.actorId &&
              pending.binding.originControlAuthSessionId === principal.authSessionId &&
              pending.binding.state === 'pending',
          )
          .map(pending => pending.prompt),
      ),
    redeliverPlugin: async principal => {
      let count = 0;
      for (const pending of pendingById.values()) {
        if (
          pending.binding.channel !== 'plugin-session' ||
          !pending.published ||
          pending.binding.state !== 'pending' ||
          pending.binding.pairedSessionId !== principal.pairedSessionId ||
          pending.binding.leaderGeneration !== principal.leaderGeneration ||
          pending.binding.pluginGeneration !== principal.pluginGeneration ||
          pending.binding.fileExecutionKey !== principal.fileExecutionKey ||
          now() >= pending.binding.expiresAt
        ) {
          if (now() >= pending.binding.expiresAt) expire(pending);
          continue;
        }
        // Preserve the broker's prompt order across a reconnect; parallel sends can reorder frames.
        // eslint-disable-next-line no-await-in-loop
        await options.deliverPluginPrompt(pending.prompt);
        pending.delivered = true;
        count += 1;
      }
      return count;
    },
  };
  return Object.freeze(broker);
};
