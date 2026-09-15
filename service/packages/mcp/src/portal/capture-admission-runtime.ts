import type { ActorContext, InvocationTargetSelector, PortalToolName } from '@sfp/shared';

import { TargetResolver } from '../execution/target-resolver.js';
import {
  resolvePortalCaptureSource,
  type PortalCaptureAdmissionPorts,
} from './capture-source-admission.js';
import type { PortalCoordinator } from './coordinator.js';
/** Canonical preparation shared by the real index adapter and authority integration tests. */
export async function preparePortalCaptureAuthority(
  input: {
    name: PortalToolName;
    args: unknown;
    principal: Readonly<ActorContext>;
    workspaceId: string | null;
    operationId: string;
    targetSelector: InvocationTargetSelector;
  },
  portal: PortalCoordinator,
  admission: PortalCaptureAdmissionPorts,
) {
  const source = await portal.captureRequest(input.name, input.args, input.principal);
  const capture = source
    ? await resolvePortalCaptureSource(source, input.targetSelector, admission)
    : null;
  const target =
    capture?.target ??
    new TargetResolver(admission.sessions).resolve(
      input.targetSelector.kind === 'portal-source' &&
        (input.name === 'portal_plan' || input.name === 'portal_validate')
        ? { kind: 'none' }
        : input.targetSelector,
      'forbidden',
    );
  const authority = await portal.prepare(
    input.name,
    input.args,
    input.principal,
    input.workspaceId,
    input.operationId,
  );
  if (capture) {
    authority.captureSource = capture.grant;
    const resources = authority.executionResources ?? [
      { key: authority.resource.key, mode: 'write' as const },
    ];
    authority.executionResources = [
      ...resources,
      {
        key:
          capture.grant.kind === 'desktop'
            ? capture.grant.fileExecutionKey
            : 'portal:browser:' + capture.grant.fileKeyHash,
        mode: 'write',
      },
    ];
  }
  return { authority, target };
}
