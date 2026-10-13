import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { ControlStatusV1Schema, type InvocationTargetSelector } from '@sfp/shared';
import { z } from 'zod';

import type { ChromeSessionOwner } from '../../cli/src/browser-session.js';
import type { ControlClient } from '../../cli/src/library.js';
import { localCaptureFeatures } from '../../cli/src/local-capture-execution.js';
import type { ControlPort } from './bridge.js';
import { parse, PortalError, WorkspaceSchema, type Workspace } from './contract.js';
import type { ServiceJobRuntime } from './service-jobs.js';

export async function createServiceControl(
  options: { stateRoot?: string; port?: number } = {},
): Promise<ControlPort> {
  // Resolve the public package entry without importing private daemon credentials into the browser.
  const entry = createRequire(import.meta.url).resolve('@sfp/cli');
  const { pathToFileURL } = await import('node:url');
  const library = (await import(
    pathToFileURL(entry).href
  )) as typeof import('../../cli/src/library.js');
  const client = new library.ControlClient(options);
  const chromeSessionOwner = new library.ChromeSessionOwner();
  const workspaces = async (): Promise<Workspace[]> =>
    parse(
      z.array(WorkspaceSchema).max(1000),
      await client.request('/control/workspaces', 'GET', undefined, { timeoutMs: 10000 }),
    );
  const serviceJobs = createServiceJobRuntime(client, library, workspaces, chromeSessionOwner);
  return {
    close: () => chromeSessionOwner.close(),
    serviceJobs,
    figmaMcpStatus: () =>
      client.request('/control/figma-mcp/status', 'GET', undefined, { timeoutMs: 10000 }),
    figmaMcpProbe: endpoint =>
      client.request('/control/figma-mcp/probe', 'POST', { endpoint }, { timeoutMs: 25000 }),
    figmaMcpRead: input =>
      client.request('/control/figma-mcp/read', 'POST', input, { timeoutMs: 25000 }),
    figmaMcpAuthStatus: () =>
      client.request('/control/figma-mcp/auth/status', 'GET', undefined, { timeoutMs: 10000 }),
    figmaMcpAuthConfigure: (input, beforeRequest) =>
      client.request('/control/figma-mcp/auth/configure', 'POST', input, {
        timeoutMs: 10000,
        ...(beforeRequest ? { beforeRequest } : {}),
      }),
    figmaMcpAuthAction: (action, input, beforeRequest) =>
      client.request(`/control/figma-mcp/auth/${action}`, 'POST', input, {
        timeoutMs: 30000,
        ...(beforeRequest ? { beforeRequest } : {}),
      }),
    figmaMcpAuthHandoff: (input, deliverLocation, beforeRequest) =>
      client.officialFigmaOAuthHandoff(
        input,
        deliverLocation,
        beforeRequest ? { beforeRequest } : {},
      ),
    inspectOriginalOperation: operationId =>
      client.request(`/control/operations/${encodeURIComponent(operationId)}`, 'GET', undefined, {
        timeoutMs: 10000,
      }),
    health: () => client.health(),
    status: async () =>
      ControlStatusV1Schema.parse(
        await client.request('/control/status', 'GET', undefined, { timeoutMs: 5000 }),
      ),
    registerWorkspace: async folder => {
      // The public client owns canonicalization, authenticated nonce issuance and identity binding.
      const workspaceId = parse(z.string().uuid(), await client.workspace(folder));
      const registered = (await workspaces()).find(row => row.workspaceId === workspaceId);
      if (!registered)
        throw new PortalError(
          'WORKSPACE_REGISTRATION_UNCONFIRMED',
          'Workspace registration could not be confirmed.',
          409,
        );
      return registered;
    },
    invoke: call => client.invoke(call),
    decide: (id, decision) => client.decide(id, decision),
    workspaces,
  };
}

export function createServiceJobRuntime(
  client: ControlClient,
  library: Pick<
    typeof import('../../cli/src/library.js'),
    | 'serviceTools'
    | 'parseServiceTool'
    | 'serviceFeatures'
    | 'parseServiceFeature'
    | 'executeServiceFeature'
  > &
    Partial<Pick<typeof import('../../cli/src/library.js'), 'isLocalCapturePreEffectFailure'>>,
  workspaces: () => Promise<Workspace[]>,
  chromeSessionOwner?: ChromeSessionOwner,
): ServiceJobRuntime {
  return {
    localCaptureQuiescence: () => chromeSessionOwner?.captureQuiescence() ?? 'unconfirmed',
    recoveryWorkspaceBinding: async workspaceId => {
      const row = (await workspaces()).find(
        value =>
          value.workspaceId === workspaceId &&
          (!value.availability || value.availability === 'available'),
      );
      if (!row) return null;
      try {
        const identity = await lstat(row.realPath, { bigint: true });
        if (
          !identity.isDirectory() ||
          identity.isSymbolicLink() ||
          (await realpath(row.realPath)) !== row.realPath
        )
          return null;
        return `sha256:${createHash('sha256')
          .update(
            JSON.stringify([
              workspaceId,
              row.realPath,
              String(identity.dev),
              String(identity.ino),
              String(identity.birthtimeNs),
            ]),
          )
          .digest('hex')}`;
      } catch {
        return null;
      }
    },
    preEffectFailure: (error, executionId) =>
      library.isLocalCapturePreEffectFailure?.(error, executionId) === true,
    catalog: async () => ({ tools: library.serviceTools(), features: library.serviceFeatures() }),
    prepare: async input => {
      const parsed =
        input.type === 'tool'
          ? library.parseServiceTool(input.name, input.args)
          : library.parseServiceFeature(input.name, input.args);
      const catalog = input.type === 'tool' ? library.serviceTools() : library.serviceFeatures();
      const descriptor = catalog.find(row => row.name === input.name);
      if (!descriptor)
        throw new PortalError('SERVICE_FUNCTION_UNKNOWN', 'Unknown registered function.');
      const toolName =
        input.type === 'tool'
          ? input.name
          : input.name === 'tools.call'
            ? String(parsed.args.name)
            : input.name.startsWith('portal.')
              ? `portal_${input.name.split('.')[1]}`
              : null;
      const toolArgs =
        input.name === 'tools.call'
          ? (parsed.args.args as Record<string, unknown>)
          : (parsed.args as Record<string, unknown>);
      const portalSource =
        toolName !== null && ['portal_plan', 'portal_validate'].includes(toolName);
      if (
        parsed.targetRequirement === 'forbidden' &&
        input.targetSelector.kind !== 'none' &&
        !(portalSource && input.targetSelector.kind === 'portal-source')
      )
        throw new PortalError(
          'SERVICE_TARGET_FORBIDDEN',
          'This function does not accept a Figma target.',
        );
      if (
        parsed.targetRequirement === 'required' &&
        ['none', 'portal-source'].includes(input.targetSelector.kind)
      )
        throw new PortalError(
          'SERVICE_TARGET_REQUIRED',
          'Select an authorized paired Figma target.',
        );
      if (
        input.workspaceId !== null &&
        !(await workspaces()).some(
          row =>
            row.workspaceId === input.workspaceId &&
            (!row.availability || row.availability === 'available'),
        )
      )
        throw new PortalError('WORKSPACE_ROOT_UNAVAILABLE', 'Select an available workspace.');
      return {
        descriptor: { ...descriptor, kind: parsed.kind },
        args: parsed.args as Record<string, unknown>,
        readOnly:
          parsed.kind === 'read' ||
          toolName === 'portal_status' ||
          (toolName === 'doctor' && toolArgs.roundTrip !== true) ||
          (input.type === 'feature' && ['tools.list', 'figma-mcp.config'].includes(input.name)),
        recovery:
          toolName === 'portal_cancel' ||
          (toolName === 'portal_resume' && toolArgs.reconcile === 'inspect') ||
          (input.type === 'feature' &&
            ['operations.cancel', 'operations.resolve', 'portal.profile.cancel'].includes(
              input.name,
            )),
      };
    },
    execute: async (input, context) => {
      const assertActive = () => {
        context.signal.throwIfAborted();
        if (Date.now() >= context.deadlineAt)
          throw new PortalError(
            'SERVICE_JOB_DEADLINE',
            'The original job deadline has expired.',
            409,
          );
      };
      const beforeInvoke = async (call: Parameters<ControlClient['invoke']>[0]) => {
        assertActive();
        call.operationId ??= await client.issueOperationId();
        call.approve = false;
        call.signal = context.signal;
        call.timeoutMs = Math.max(1, context.deadlineAt - Date.now());
        await context.beforeInvoke({
          operationId: call.operationId,
          name: call.name,
          kind: call.kind,
          workspaceId: call.workspaceId,
        });
        assertActive();
        call.timeoutMs = Math.max(1, context.deadlineAt - Date.now());
      };
      const targetSelector = input.targetSelector as InvocationTargetSelector;
      if (input.type === 'feature') {
        const result = await library.executeServiceFeature(client, input.name, input.args, {
          workspaceId: input.workspaceId,
          targetSelector,
          signal: context.signal,
          deadlineAt: context.deadlineAt,
          emit: context.emit,
          beforeInvoke,
          ...(context.executionId ? { executionId: context.executionId } : {}),
          ...(context.progress ? { progress: context.progress } : {}),
          ...(chromeSessionOwner ? { chromeSessionOwner } : {}),
        });
        if (
          localCaptureFeatures.some(name => name === input.name) &&
          chromeSessionOwner &&
          !chromeSessionOwner.captureExecutionQuiescent(context.executionId)
        )
          throw new PortalError(
            'CHROME_SOURCE_CLEANUP_UNCONFIRMED',
            'Source cleanup is unconfirmed. Preserve the capture and inspect the original job.',
            409,
          );
        return result;
      }
      const call: Parameters<ControlClient['invoke']>[0] = {
        name: input.name,
        kind: 'tool',
        args: input.args,
        workspaceId: input.workspaceId,
        targetSelector,
        approve: false,
        captureResult: true,
        signal: context.signal,
        emit: context.emit,
      };
      await beforeInvoke(call);
      return client.invoke(call);
    },
    decide: (approvalId, decision) => client.decide(approvalId, decision),
    inspect: operationId =>
      client.request(`/control/operations/${encodeURIComponent(operationId)}`, 'GET', undefined, {
        timeoutMs: 10000,
      }),
  };
}
