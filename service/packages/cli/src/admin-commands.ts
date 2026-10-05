import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { contentHash, GroundingRefreshArgsSchema, SnapshotCaptureArgsSchema } from '@sfp/ir';
import { hashActionRequest, type InvocationTargetSelector } from '@sfp/shared';

import { normalizeRemoteDomain } from '../../mcp/src/network/remote-domain-config-store.js';
import {
  PortalNativeRegistrationSchema,
  PortalPreparedNativeProfileSchema,
} from '../../mcp/src/portal/native-work.js';
import { createStatePermissions } from '../../mcp/src/security/state-permissions.js';
import { ALL_TOOL_SPECS } from '../../mcp/src/tools/registry.js';
import { ControlClient } from './control-client.js';

const commandError = (message: string) =>
  Object.assign(new Error(message), { code: 'CLI_USAGE', exitCode: 2 });
const jsonArgs = async (values: { args?: string; 'args-file'?: string }): Promise<unknown> => {
  if (values.args !== undefined && values['args-file'] !== undefined)
    throw commandError('Use --args or --args-file, not both');
  const text =
    values['args-file'] === undefined
      ? (values.args ?? '{}')
      : await readFile(values['args-file'], 'utf8');
  if (Buffer.byteLength(text) > 8_388_608) throw commandError('Arguments exceed 8 MiB');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw commandError('Arguments must be valid JSON');
  }
};

const commands = new Set([
  'tools',
  'tool',
  'workspace',
  'egress',
  'approval',
  'operations',
  'network',
  'pair',
  'snapshot',
  'grounding',
  'portal',
]);
export const runAdminCommand = async (
  args: string[],
  emit: (value: unknown) => void,
): Promise<boolean> => {
  if (!commands.has(args[0] ?? '')) return false;
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    tokens: true,
    options: {
      args: { type: 'string' },
      'args-file': { type: 'string' },
      'prepared-file': { type: 'string' },
      workspace: { type: 'string' },
      'workspace-id': { type: 'string' },
      session: { type: 'string' },
      target: { type: 'string' },
      yes: { type: 'boolean', default: false },
      'capture-result': { type: 'boolean', default: false },
      'operation-id': { type: 'string' },
      timeout: { type: 'string', default: '900' },
      decision: { type: 'string' },
    },
  });
  const [command, action, value] = parsed.positionals,
    opts = parsed.values;
  const invocation =
    command === 'tool' ||
    (command === 'tools' && action === 'call') ||
    command === 'snapshot' ||
    command === 'grounding' ||
    command === 'portal';
  const allowed = invocation
    ? new Set([
        'args',
        'args-file',
        'workspace',
        'workspace-id',
        'session',
        'target',
        'yes',
        'capture-result',
        'operation-id',
        'timeout',
      ])
    : command === 'approval' && action === 'decide'
      ? new Set(['decision'])
      : command === 'operations' && ['cancel', 'resolve'].includes(action ?? '')
        ? new Set(['args', 'args-file'])
        : new Set<string>();
  if (command === 'portal' && action === 'profile') allowed.add('prepared-file');
  for (const token of parsed.tokens)
    if (token.kind === 'option' && !allowed.has(token.name))
      throw commandError(`--${token.name} is not supported by this command`);
  const maximumPositionals = command === 'workspace' && action === 'rebind' ? 4 : 3;
  if (parsed.positionals.length > maximumPositionals)
    throw commandError('Too many positional arguments');
  if (opts.workspace !== undefined && opts['workspace-id'] !== undefined)
    throw commandError('Choose --workspace or --workspace-id');
  if (opts.session !== undefined && opts.target !== undefined)
    throw commandError('Choose --session or --target');
  const client = new ControlClient();
  const nonce = async (
    name: Parameters<typeof hashActionRequest>[0],
    semantic: unknown,
    extra: Record<string, unknown> = {},
  ) => {
    const issued = await client.request<{ value: string }>('/control/action-nonces', 'POST', {
      action: name,
      requestHash: hashActionRequest(name, semantic),
      ...extra,
    });
    return issued.value;
  };
  if (command === 'pair') {
    emit({ pairCode: await client.pairCode() });
    return true;
  }
  if (command === 'portal' && action === 'profile') {
    if (value !== undefined)
      throw commandError('portal profile --args-file <reviewed-native-profile.json> --yes');
    const rawProfile = await jsonArgs(opts);
    if (!opts.yes) {
      const profile = PortalNativeRegistrationSchema.parse(rawProfile);
      const folder = join(client.stateRoot, 'prepared-profiles');
      const preparedFile = resolve(
        opts['prepared-file'] ??
          join(folder, `${profile.native.id}.${randomBytes(12).toString('hex')}.json`),
      );
      if (resolve(dirname(preparedFile)).toLowerCase() !== resolve(folder).toLowerCase())
        throw commandError(`--prepared-file must be directly inside ${folder}`);
      const prepared = PortalPreparedNativeProfileSchema.parse(
        await client.request('/control/portal/profiles/prepare', 'POST', profile),
      );
      const permissions = createStatePermissions(client.stateRoot);
      await permissions.verifySecure(client.stateRoot);
      await mkdir(folder, { mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      });
      await permissions.ensureSecure(folder);
      const file = await open(preparedFile, 'wx', 0o600);
      try {
        // Apply/verify owner permissions before any protected configuration is written.
        await permissions.ensureSecure(preparedFile);
        await permissions.verifySecure(preparedFile);
        await file.writeFile(`${JSON.stringify(prepared, null, 2)}\n`, 'utf8');
        await file.sync();
        const identity = await permissions.inspectSecure(preparedFile);
        const held = await file.stat({ bigint: true });
        if (identity.key !== `${held.dev}:${held.ino}:${held.birthtimeNs}`)
          throw commandError('Prepared profile file identity changed');
      } finally {
        await file.close();
      }
      emit({
        status: 'review-required',
        preparedFile,
        preparedContractVersion: prepared.preparedContractVersion,
        profileHash: contentHash('sfp-portal-profile-request-v1', prepared),
        preparation: {
          environmentAuthority: prepared.native.environmentAuthority,
          artifactAuthority: prepared.native.artifactAuthority,
          externalArtifacts: prepared.native.externalArtifacts,
          serviceEnvironment: Object.fromEntries(
            Object.entries(prepared.native.environment).filter(([key]) =>
              [
                'SFP_FIGMA_ASSET_ROOT',
                'SFP_PORTAL_VALIDATOR_URL',
                'SFP_PORTAL_CHROME_EXECUTABLE',
              ].includes(key),
            ),
          ),
        },
        profileId: prepared.native.id,
        planId: prepared.planId,
        sourceHash: prepared.native.sourceHash,
        executionMode: 'native-working-copy',
        isolation: 'local-owner-account-no-os-sandbox',
        commands: prepared.native.commands.map(step => ({
          id: step.id,
          executable: step.executable,
          args: step.args,
          cwd: step.cwd,
          timeoutMs: step.timeoutMs,
          allowLifecycleScripts: step.allowLifecycleScripts,
        })),
        environmentNames: Object.keys(prepared.native.environment),
        consumption: prepared.recipeUse.prepared,
        observationManifest: prepared.observationManifest,
        instruction:
          'Review the complete prepared file, including commands, environment, source closure, observations and recipe use. Register that exact file using portal profile --args-file <preparedFile> --yes. Registration does not run commands.',
      });
      return true;
    }
    if (opts['prepared-file'] !== undefined)
      throw commandError('--prepared-file is only supported while preparing a profile');
    if (!PortalPreparedNativeProfileSchema.safeParse(rawProfile).success)
      throw commandError('Prepare and review this profile without --yes before registration.');
    const profile = PortalPreparedNativeProfileSchema.parse(rawProfile);
    const semantic = {
      planId: profile.planId,
      profileHash: contentHash('sfp-portal-profile-request-v1', profile),
    };
    emit(
      await client.request('/control/portal/profiles', 'POST', {
        profile,
        actionNonce: await nonce('portal.profile.register', semantic),
      }),
    );
    return true;
  }
  if (
    command === 'portal' &&
    (action === 'environment-inspect' || action === 'environment-reconcile')
  ) {
    if (!value || !/^[a-f0-9]{64}$/u.test(value))
      throw commandError('portal environment-inspect <attempt-id>');
    const inspected = (await client.request('/control/portal/environments/inspect', 'POST', {
      attemptId: value,
    })) as { record: unknown; receiptHash: string };
    if (action === 'environment-inspect' || !opts.yes) {
      emit(inspected);
      return true;
    }
    const semantic = { attemptId: value, receiptHash: inspected.receiptHash };
    emit(
      await client.request('/control/portal/environments/reconcile', 'POST', {
        ...semantic,
        actionNonce: await nonce('portal.environment.reconcile', semantic),
      }),
    );
    return true;
  }
  if (command === 'tools' && (action === undefined || action === 'list')) {
    emit({
      tools: ALL_TOOL_SPECS.map(spec => ({
        name: spec.name,
        kind: spec.kind,
        description: spec.description,
        inputSchema: spec.inputSchema.toJSONSchema(),
      })),
    });
    return true;
  }
  if (command === 'approval') {
    if (action === undefined || action === 'list') emit(await client.approvals());
    else if (
      action === 'decide' &&
      value !== undefined &&
      ['approved', 'rejected'].includes(opts.decision ?? '')
    ) {
      await client.decide(value, opts.decision as 'approved' | 'rejected');
      emit({ status: 'decision-sent', approvalId: value });
    } else throw commandError('approval list | approval decide <id> --decision approved|rejected');
    return true;
  }
  if (command === 'workspace') {
    if (action === undefined || action === 'list')
      emit(await client.request('/control/workspaces'));
    else if (action === 'add' && value !== undefined)
      emit({ workspaceId: await client.workspace(value) });
    else if (action === 'default' && value === undefined)
      emit(await client.request('/control/workspaces/default'));
    else if (action === 'default' && value !== undefined) {
      const workspaceId = value === 'none' ? null : value;
      const actionNonce = await nonce('workspace.set-default', { workspaceId });
      emit(
        await client.request(
          '/control/workspaces/default',
          workspaceId === null ? 'DELETE' : 'POST',
          { ...(workspaceId === null ? {} : { workspaceId }), actionNonce },
        ),
      );
    } else if (action === 'remove' && value !== undefined) {
      const actionNonce = await nonce('workspace.remove', { workspaceId: value });
      emit(
        await client.request(`/control/workspaces/${encodeURIComponent(value)}`, 'DELETE', {
          actionNonce,
        }),
      );
    } else if (action === 'rebind' && value !== undefined && parsed.positionals[3] !== undefined) {
      // The daemon resolves the path again and binds the nonce to that root identity.
      const realPath = await realpath(parsed.positionals[3]);
      const actionNonce = await nonce(
        'workspace.rebind',
        { workspaceId: value, realPath },
        { registrationPath: realPath, workspaceId: value },
      );
      emit(
        await client.request(`/control/workspaces/${encodeURIComponent(value)}/rebind`, 'POST', {
          path: realPath,
          actionNonce,
        }),
      );
    } else
      throw commandError(
        'workspace list|add <path>|default [id|none]|remove <id>|rebind <id> <path>',
      );
    return true;
  }
  if (command === 'egress') {
    if (action === undefined || action === 'status') emit(await client.request('/control/egress'));
    else if (action === 'allow') {
      await client.allowModelData();
      emit(await client.request('/control/egress'));
    } else if (action === 'reset') {
      const actionNonce = await nonce('egress.reset', {});
      emit(await client.request('/control/egress', 'DELETE', { actionNonce }));
    } else if (action === 'audit') emit(await client.request('/control/admin-audit?kind=egress'));
    else throw commandError('egress status|allow|reset|audit');
    return true;
  }
  if (command === 'network') {
    if (action === undefined || action === 'list')
      emit(await client.request('/control/network/domains'));
    else if (['add', 'remove'].includes(action) && value !== undefined) {
      // The server canonicalizes and binds the exact domain before consuming the nonce.
      const domain = normalizeRemoteDomain(value);
      const name = action === 'add' ? 'network-domain.add' : 'network-domain.remove';
      const actionNonce = await nonce(name, { domain });
      emit(
        await client.request(
          action === 'add'
            ? '/control/network/domains'
            : `/control/network/domains/${encodeURIComponent(domain)}`,
          action === 'add' ? 'POST' : 'DELETE',
          action === 'add' ? { fqdn: value, actionNonce } : { actionNonce },
        ),
      );
    } else throw commandError('network list|add <domain>|remove <domain>');
    return true;
  }
  if (command === 'operations') {
    if (action === undefined || action === 'list')
      emit(await client.request('/control/operations'));
    else if (value !== undefined && ['show', 'evidence'].includes(action))
      emit(
        await client.request(
          `/control/operations/${encodeURIComponent(value)}${action === 'evidence' ? '/evidence' : ''}`,
        ),
      );
    else if (value !== undefined && action === 'cancel') {
      const body = await jsonArgs(opts);
      emit(
        await client.request(
          `/control/operations/${encodeURIComponent(value)}/cancel`,
          'POST',
          body,
        ),
      );
    } else if (value !== undefined && action === 'resolve') {
      const body = await jsonArgs(opts);
      emit(
        await client.request(
          `/control/operations/${encodeURIComponent(value)}/resolve`,
          'POST',
          body,
        ),
      );
    } else
      throw commandError(
        'operations list|show <id>|evidence <id>|cancel <id> --args <envelope>|resolve <id> --args <resolution>',
      );
    return true;
  }
  const toolName =
    command === 'portal' && action !== undefined
      ? `portal_${action === 'run' ? 'start' : action}`
      : command === 'tool'
        ? action
        : command === 'tools' && action === 'call'
          ? value
          : undefined;
  const name =
    toolName ??
    (command === 'snapshot' && action === 'capture'
      ? 'snapshot.capture'
      : command === 'grounding' && action === 'refresh'
        ? 'grounding.refresh'
        : undefined);
  if (name === undefined)
    throw commandError(
      'tools call <name> | snapshot capture | grounding refresh; supply --args JSON',
    );
  let rawArgs = await jsonArgs(opts);
  if (command === 'portal' && value !== undefined) {
    if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs))
      throw commandError('Portal arguments must be an object');
    const key = action === 'start' || action === 'run' ? 'planId' : 'runId';
    if (Object.hasOwn(rawArgs, key)) throw commandError(`Do not supply ${key} twice`);
    rawArgs = { ...rawArgs, [key]: value };
  }
  const spec = ALL_TOOL_SPECS.find(candidate => candidate.name === name);
  const input =
    name === 'snapshot.capture'
      ? SnapshotCaptureArgsSchema.parse(rawArgs)
      : name === 'grounding.refresh'
        ? GroundingRefreshArgsSchema.parse(rawArgs)
        : spec?.inputSchema.parse(rawArgs);
  if (input === undefined) throw commandError(`Unknown tool: ${name}`);
  const workspaceId =
    opts['workspace-id'] ??
    (opts.workspace === undefined ? null : await client.workspace(opts.workspace));
  const requirement =
    name === 'snapshot.capture'
      ? 'required'
      : name === 'grounding.refresh'
        ? 'forbidden'
        : spec!.targetRequirementFor(input);
  const targetSelector: InvocationTargetSelector =
    opts.session !== undefined
      ? { kind: 'session', sessionId: opts.session }
      : opts.target === undefined && (name === 'portal_plan' || name === 'portal_validate')
        ? { kind: 'portal-source' }
        : opts.target === 'none' || (opts.target === undefined && requirement === 'forbidden')
          ? { kind: 'none' }
          : { kind: 'active' };
  if (opts.target !== undefined && !['active', 'none'].includes(opts.target))
    throw commandError('--target must be active or none');
  const seconds = Number(opts.timeout);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600)
    throw commandError('--timeout must be between 1 and 3600 seconds');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    emit(
      await client.invoke({
        name,
        kind: spec === undefined ? 'service' : 'tool',
        args: input,
        workspaceId,
        targetSelector,
        approve: opts.yes,
        captureResult: opts['capture-result'],
        timeoutMs: seconds * 1000,
        signal: controller.signal,
        emit,
        ...(opts['operation-id'] === undefined ? {} : { operationId: opts['operation-id'] }),
      }),
    );
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
  return true;
};
