import { contentHash } from '@sfp/ir';
import type { PortalRequirementSchema, PortalWorkflowCoverageSchema } from '@sfp/shared';
import type { z } from 'zod';

import {
  PortalInteractionContractSchema,
  type PortalInteractionContract,
} from '../../../shared/src/portal-observations.js';
import {
  portalDesignFingerprint,
  requireCurrentPortalCapture,
  type PortalCapturedDesign,
} from './design-capture.js';
import { normalizeDesignObservation } from './design-normalization.js';

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
/**
 * Source evidence determines obligations. Proposed preview actions cannot erase a captured
 * reaction.
 */
export function derivePortalInteractionContract(
  captured: PortalCapturedDesign,
  requirements: z.infer<typeof PortalRequirementSchema>[],
  coverage?: z.infer<typeof PortalWorkflowCoverageSchema>,
): PortalInteractionContract {
  requireCurrentPortalCapture(captured);
  const observed = normalizeDesignObservation(JSON.parse(captured.raw), captured.collectorEvidence);
  const nodes = new Map(observed.nodes.map(node => [node.id, node]));
  const roots = new Map<string, string>();
  for (const root of observed.roots) {
    const pending = [root];
    while (pending.length) {
      const id = pending.pop()!;
      roots.set(id, root);
      pending.push(...(nodes.get(id)?.childIds ?? []));
    }
  }
  const issues: string[] = [];
  const capability = observed.capabilities.find(value => value.name === 'interactions');
  if (!capability || !['complete', 'empty'].includes(capability.status))
    issues.push('PORTAL_INTERACTION_CAPTURE_INCOMPLETE');
  const evidence = new Map(coverage?.evidence.map(value => [value.id, value]) ?? []);
  const requiredIds = new Set(requirements.filter(value => value.required).map(value => value.id));
  const related = (nodeId: string) => [
    ...new Set(
      (coverage?.scopes ?? [])
        .filter(scope =>
          scope.evidenceIds.some(id => {
            const ev = evidence.get(id);
            return ev?.nodeId === nodeId || roots.get(ev?.nodeId ?? '') === roots.get(nodeId);
          }),
        )
        .flatMap(scope => scope.requirementIds)
        .filter(id => requiredIds.has(id)),
    ),
  ];
  const interactions: PortalInteractionContract['interactions'] = [];
  for (const reaction of observed.interactions) {
    if (interactions.length + Math.max(1, reaction.actions.length) > 4096) {
      issues.push('PORTAL_INTERACTION_LIMIT');
      break;
    }
    const trigger = record(reaction.trigger);
    for (const [index, raw] of (reaction.actions.length ? reaction.actions : [null]).entries()) {
      const action = record(raw),
        destination = typeof action.destinationId === 'string' ? action.destinationId : null;
      const semantics =
        action.type === 'NODE'
          ? (
              {
                NAVIGATE: 'navigate',
                OVERLAY: 'overlay',
                SWAP: 'swap',
                CHANGE_TO: 'change-state',
                SCROLL_TO: 'scroll',
              } as const
            )[action.navigation as 'NAVIGATE' | 'OVERLAY' | 'SWAP' | 'CHANGE_TO' | 'SCROLL_TO']
          : action.type === 'BACK'
            ? 'back'
            : action.type === 'CLOSE'
              ? 'close'
              : undefined;
      const kind = (
        {
          ON_CLICK: 'click',
          ON_HOVER: 'hover',
          ON_KEY_DOWN: 'key',
          AFTER_TIMEOUT: 'delay',
        } as const
      )[trigger.type as 'ON_CLICK' | 'ON_HOVER' | 'ON_KEY_DOWN' | 'AFTER_TIMEOUT'];
      const codes = Array.isArray(trigger.keyCodes) ? trigger.keyCodes : [];
      const keyNames: Record<number, string> = {
        9: 'Tab',
        13: 'Enter',
        16: 'Shift',
        17: 'Control',
        18: 'Alt',
        27: 'Escape',
        32: 'Space',
        37: 'ArrowLeft',
        38: 'ArrowUp',
        39: 'ArrowRight',
        40: 'ArrowDown',
        91: 'Meta',
      };
      const keys = codes.map((code: unknown) =>
        typeof code === 'number'
          ? (keyNames[code] ??
            (code >= 65 && code <= 90 ? String.fromCharCode(code).toLowerCase() : null))
          : null,
      );
      const key =
        keys.length > 0 && keys.length <= 4 && keys.every(Boolean) ? keys.join('+') : null;
      const transition = record(action.transition);
      const durationMs = typeof transition.duration === 'number' ? transition.duration * 1000 : 0;
      const easingType = record(transition.easing).type;
      const easings: Record<string, string> = {
        LINEAR: 'linear',
        EASE_IN: 'ease-in',
        EASE_OUT: 'ease-out',
        EASE_IN_AND_OUT: 'ease-in-out',
      };
      const easing = typeof easingType === 'string' ? (easings[easingType] ?? null) : null;
      const direction = ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].includes(transition.direction)
        ? transition.direction
        : null;
      const temporal =
        durationMs > 0 && Number.isFinite(durationMs) && durationMs <= 300000
          ? { durationMs, type: String(transition.type ?? 'unknown'), easing, direction }
          : null;
      const reason =
        !semantics || !kind || reaction.status === 'unsupported'
          ? 'PORTAL_INTERACTION_SEMANTICS_UNSUPPORTED'
          : destination !== null && !nodes.has(destination)
            ? 'PORTAL_INTERACTION_DESTINATION_NOT_CAPTURED'
            : ['navigate', 'overlay', 'swap', 'change-state', 'scroll'].includes(semantics) &&
                !destination
              ? 'PORTAL_INTERACTION_DESTINATION_REQUIRED'
              : Object.keys(transition).length &&
                  (typeof transition.duration !== 'number' ||
                    !Number.isFinite(durationMs) ||
                    (transition.easing !== undefined && easing === null) ||
                    (transition.direction !== undefined && direction === null) ||
                    durationMs < 0 ||
                    durationMs > 10000 ||
                    ![
                      'DISSOLVE',
                      'MOVE_IN',
                      'MOVE_OUT',
                      'PUSH',
                      'SLIDE_IN',
                      'SLIDE_OUT',
                      'SMART_ANIMATE',
                    ].includes(String(transition.type)))
                ? 'PORTAL_INTERACTION_MOTION_UNSUPPORTED'
                : kind === 'key' && !key
                  ? 'PORTAL_INTERACTION_KEY_UNSUPPORTED'
                  : kind === 'delay' &&
                      !(
                        typeof trigger.timeout === 'number' &&
                        trigger.timeout >= 0 &&
                        trigger.timeout <= 300
                      )
                    ? 'PORTAL_INTERACTION_DELAY_UNSUPPORTED'
                    : null;
      interactions.push({
        id: contentHash('sfp-required-interaction-v1', { reaction: reaction.id, index }),
        sourceNodeId: reaction.nodeId,
        rootNodeId: roots.get(reaction.nodeId)!,
        destinationNodeId: destination,
        sourceHash: reaction.rawHash,
        trigger: kind ?? 'unsupported',
        key,
        delayMs:
          kind === 'delay' && typeof trigger.timeout === 'number' ? trigger.timeout * 1000 : null,
        action: semantics ?? 'unsupported',
        temporal,
        required: true,
        status: reason ? 'blocked' : 'supported',
        reason,
        requirementIds: related(reaction.nodeId),
      });
    }
  }
  const workflowIds = requirements
    .filter(
      value =>
        value.required &&
        /interact|form|navigation|journey|checkout|cart|submit|sign.?in|login|search|filter|settings|upload|create|update|delete|save/iu.test(
          value.id + ' ' + value.description,
        ),
    )
    .map(value => value.id);
  const workflows = workflowIds.map(id => {
    const scoped = [
      ...new Set(
        (coverage?.scopes ?? [])
          .filter(scope => scope.requirementIds.includes(id))
          .flatMap(scope => scope.evidenceIds)
          .flatMap(evidenceId => {
            const value = evidence.get(evidenceId);
            return value?.nodeId ? [value.nodeId] : [];
          }),
      ),
    ];
    const rootIds = [
      ...new Set(
        scoped.map(nodeId => roots.get(nodeId)).filter((value): value is string => Boolean(value)),
      ),
    ];
    return {
      id,
      rootIds: rootIds.length ? rootIds : observed.roots,
      nodeIds: [...nodes.keys()].filter(
        nodeId => !rootIds.length || rootIds.includes(roots.get(nodeId)!),
      ),
    };
  });
  return PortalInteractionContractSchema.parse({
    version: 1,
    captureFingerprint: portalDesignFingerprint(captured),
    scopeHash: contentHash(
      'sfp-observation-scope-v1',
      observed.sourceBinding.status === 'observed' ? observed.sourceBinding.scopeId : null,
    ),
    interactions,
    workflowIds,
    workflows,
    complete: issues.length === 0 && interactions.every(value => value.status === 'supported'),
    issues,
  });
}
