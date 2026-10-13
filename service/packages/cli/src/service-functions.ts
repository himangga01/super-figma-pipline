import { createHash, randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { GroundingRefreshArgsSchema, SnapshotCaptureArgsSchema } from '@sfp/ir';
import {
  hashActionRequest,
  InvocationTargetSelectorSchema,
  PortalValidateArgsSchema,
  type InvocationTargetSelector,
} from '@sfp/shared';
import { z } from 'zod';

import {
  FigmaOAuthCleanupInputSchema,
  FigmaOAuthConfigureInputSchema,
  FigmaOAuthStartInputSchema,
  FigmaOAuthRefreshInputSchema,
  parseFigmaOAuth,
} from '../../mcp/src/control/figma-oauth-contract.js';
import {
  OFFICIAL_FIGMA_DESKTOP,
  OFFICIAL_FIGMA_READ_TOOLS,
  OFFICIAL_FIGMA_REMOTE,
  officialFigmaConfiguration,
} from '../../mcp/src/official-figma-mcp.js';
import {
  PortalNativeRegistrationSchema,
  PortalPreparedNativeProfileSchema,
} from '../../mcp/src/portal/native-work.js';
import { ALL_TOOL_SPECS } from '../../mcp/src/tools/registry.js';
import { runAdminCommand } from './admin-commands.js';
import type { ChromeSessionOwner } from './browser-session.js';
import { runCommand } from './commands.js';
import { ControlClient } from './control-client.js';
import { parseFigmaTarget } from './figma-url.js';
import {
  localCaptureExecution,
  localCaptureFeatures,
  type LocalCapturePhase,
} from './local-capture-execution.js';
import {
  executeOfficialFigmaAuth,
  type OfficialFigmaAuthAction,
} from './official-figma-mcp-command.js';
import { parseServiceTool, serviceTools } from './service-tool-catalog.js';

type Kind = 'local' | 'read' | 'write';
type Proof = 'single-operation' | 'composite' | 'local';
export interface ServiceFeatureContext {
  workspaceId: string | null;
  targetSelector: InvocationTargetSelector;
  signal: AbortSignal;
  deadlineAt?: number;
  emit: (value: unknown) => void;
  beforeInvoke?: (input: Parameters<ControlClient['invoke']>[0]) => Promise<void>;
  chromeSessionOwner?: ChromeSessionOwner;
  executionId?: string;
  progress?: (phase: LocalCapturePhase) => void;
}
type Definition = {
  name: string;
  description: string;
  group: string;
  kind: Kind;
  schema: z.ZodType;
  confirmationRequired: boolean;
  executionProof: Proof;
  prerequisites: string[];
  tool?: string;
  service?: 'snapshot.capture' | 'grounding.refresh';
  argv?: (args: Record<string, unknown>) => string[];
};
const definitions: Definition[] = [];
const empty = z.object({}).strict();
const text = z.string().trim().min(1).max(4096);
const id = z.string().min(1).max(384);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const path = text.describe('Absolute local path on the service PC');
const uuid = z.string().uuid();
const normalizedLocalPath = (value: string) =>
  process.platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value;
const obj = (shape: z.ZodRawShape) => z.object(shape).strict();
function define(
  name: string,
  description: string,
  schema: z.ZodType,
  kind: Kind,
  argv?: Definition['argv'],
  extra: Partial<Definition> = {},
) {
  definitions.push({
    name,
    description,
    schema,
    kind,
    group: name.split('.')[0]!,
    confirmationRequired: kind === 'write',
    executionProof: 'composite',
    prerequisites: [
      'The local service must be running. The service validates permissions before each action.',
    ],
    ...(argv ? { argv } : {}),
    ...extra,
  });
}
const jsonArgs = (value: unknown) => ['--args', JSON.stringify(value)];
const flagArgs = (args: Record<string, unknown>, fields: Record<string, string>) =>
  Object.entries(fields).flatMap(([key, flag]) =>
    args[key] === undefined || args[key] === false
      ? []
      : args[key] === true
        ? [`--${flag}`]
        : [`--${flag}`, String(args[key])],
  );

define('status', 'Read service and source connection state', empty, 'read', () => ['status']);
define('tools.list', 'Discover all implemented tool schemas', empty, 'local', undefined, {
  executionProof: 'local',
  prerequisites: [],
});
define(
  'tools.call',
  'Invoke any registered tool with service authority',
  obj({
    name: z.enum(ALL_TOOL_SPECS.map(spec => spec.name)),
    args: z.record(z.string(), z.unknown()),
  }),
  'write',
  undefined,
  { confirmationRequired: false, executionProof: 'single-operation' },
);
define('workspace.list', 'List registered workspaces', empty, 'read', () => ['workspace', 'list']);
define('workspace.add', 'Register an existing local folder', obj({ folder: path }), 'write', a => [
  'workspace',
  'add',
  String(a.folder),
]);
define(
  'workspace.remove',
  'Remove a workspace registration',
  obj({ workspaceId: uuid }),
  'write',
  a => ['workspace', 'remove', String(a.workspaceId)],
);
define('workspace.default.get', 'Read the default workspace', empty, 'read', () => [
  'workspace',
  'default',
]);
define(
  'workspace.default.set',
  'Set the default workspace',
  obj({ workspaceId: uuid }),
  'write',
  a => ['workspace', 'default', String(a.workspaceId)],
);
define('workspace.default.clear', 'Clear the default workspace', empty, 'write', () => [
  'workspace',
  'default',
  'none',
]);
define(
  'workspace.rebind',
  'Rebind a moved workspace after identity review',
  obj({ workspaceId: uuid, folder: path }),
  'write',
  a => ['workspace', 'rebind', String(a.workspaceId), String(a.folder)],
);
for (const action of ['status', 'allow', 'reset', 'audit'] as const)
  define(
    `egress.${action}`,
    action === 'allow'
      ? 'Allow the existing four model-data classes for eight hours'
      : `Read or update model-data policy: ${action}`,
    empty,
    action === 'allow' || action === 'reset' ? 'write' : 'read',
    () => ['egress', action],
  );
define('network.list', 'List permitted remote domains', empty, 'read', () => ['network', 'list']);
for (const action of ['add', 'remove'] as const)
  define(
    `network.${action}`,
    `${action === 'add' ? 'Permit' : 'Remove'} a remote domain`,
    obj({ domain: text }),
    'write',
    a => ['network', action, String(a.domain)],
  );
define('approval.list', 'List pending service approvals', empty, 'read', () => [
  'approval',
  'list',
]);
define(
  'approval.decide',
  'Approve or reject an exact pending service operation',
  obj({ approvalId: id, decision: z.enum(['approved', 'rejected']) }),
  'write',
  a => ['approval', 'decide', String(a.approvalId), '--decision', String(a.decision)],
);
define('operations.list', 'List retained operations', empty, 'read', () => ['operations', 'list']);
for (const action of ['show', 'evidence'] as const)
  define(
    `operations.${action}`,
    `Read original operation ${action}`,
    obj({ operationId: id }),
    'read',
    a => ['operations', action, String(a.operationId)],
  );
define(
  'operations.cancel',
  'Request cancellation using the originating service identity',
  obj({ operationId: id }),
  'write',
);
define(
  'operations.resolve',
  'Resolve an unknown operation against explicitly reviewed evidence',
  obj({
    operationId: id,
    decision: z.enum(['resolved-applied', 'resolved-not-applied', 'abandoned']),
    reasonHash: hash,
    evidenceHash: hash,
    confirmedResultHash: hash.nullable().default(null),
    confirm: text.describe(
      'Exact operation ID followed by / and the confirmed result hash, or /unknown',
    ),
  }),
  'write',
);
define('pair', 'Issue a short-lived Desktop plugin pairing code', empty, 'write', () => ['pair'], {
  prerequisites: [
    'The bundled plugin must be imported and running in Figma Desktop. Pairing codes are displayed temporarily and are not retained in history.',
  ],
});
define(
  'desktop.prepare',
  'Prepare the bundled Figma Desktop development plugin',
  empty,
  'write',
  () => ['desktop-prepare'],
);
define(
  'desktop.connect',
  'Connect and inspect a paired Figma Desktop file',
  obj({
    url: text,
    workspace: path.optional(),
    out: path,
    wait: z.number().int().min(1).max(900).default(300),
    persistent: z.boolean().default(false),
  }),
  'write',
  a => [
    'connect',
    ...flagArgs(a, {
      url: 'url',
      workspace: 'workspace',
      out: 'out',
      wait: 'wait',
      persistent: 'persistent',
    }),
  ],
  {
    prerequisites: [
      'Import the prepared plugin in Figma Desktop, start it, and confirm the exact source file.',
    ],
  },
);
const chrome = {
  url: text,
  cdp: text.optional(),
  wait: z.number().int().min(1).max(900).default(300),
};
const capture = {
  ...chrome,
  out: path,
  open: z.boolean().default(false),
  depth: z.number().int().min(0).max(100).default(40),
  maxNodes: z.number().int().min(1).max(2000).default(2000),
};
const chromeFlags = {
  url: 'url',
  cdp: 'cdp',
  wait: 'wait',
  out: 'out',
  open: 'open',
  depth: 'depth',
  maxNodes: 'max-nodes',
};
const chromePrerequisites = [
  'Use the existing authorized Google Chrome session. Native browser security approvals must be completed manually. Capture outputs are written to the selected local folder.',
];
for (const action of ['open', 'tabs'] as const)
  define(
    `chrome.${action}`,
    `${action === 'open' ? 'Open' : 'Inspect'} the selected Figma tab in Google Chrome`,
    obj(chrome),
    action === 'open' ? 'write' : 'read',
    a => [`chrome-${action}`, ...flagArgs(a, chromeFlags)],
    { prerequisites: chromePrerequisites },
  );
for (const collector of ['ui', 'runtime', 'page-api', 'scripter'] as const)
  define(
    `chrome.inspect.${collector}`,
    `Inspect Figma Web through Chrome using ${collector}`,
    obj(capture),
    'write',
    a => [
      'chrome-inspect',
      ...flagArgs(a, chromeFlags),
      ...(collector === 'ui'
        ? ['--ui-only']
        : collector === 'runtime'
          ? ['--ui-only', '--probe-runtime']
          : collector === 'page-api'
            ? ['--page-api']
            : ['--scripter']),
    ],
    { prerequisites: chromePrerequisites },
  );
define(
  'chrome.export',
  'Export a native Figma document through Chrome',
  obj(capture),
  'write',
  a => ['chrome-export', ...flagArgs(a, chromeFlags)],
  { prerequisites: chromePrerequisites },
);
for (const format of ['svg', 'png'] as const)
  define(
    `chrome.copy.${format}`,
    `Copy the selected Figma node as ${format.toUpperCase()} through Chrome`,
    obj({ ...chrome, out: path }),
    'write',
    a => ['chrome-copy', ...flagArgs(a, chromeFlags), '--format', format],
    { prerequisites: chromePrerequisites },
  );
define(
  'chrome.decode',
  'Decode an exported native Figma document',
  obj({ input: path, url: text, out: path }),
  'write',
  a => ['chrome-decode', ...flagArgs(a, { input: 'input', url: 'url', out: 'out' })],
);
define(
  'chrome.compare',
  'Compare an independently exported native document with recorded design facts',
  obj({ input: path, reference: path, url: text, referenceAssets: path.optional(), out: path }),
  'write',
  a => [
    'chrome-compare',
    ...flagArgs(a, {
      input: 'input',
      reference: 'reference',
      url: 'url',
      referenceAssets: 'reference-assets',
      out: 'out',
    }),
  ],
);
define(
  'chrome.compare-reads',
  'Compare independently collected design facts and asset bytes',
  obj({
    input: path,
    reference: path,
    inputAssets: path.optional(),
    referenceAssets: path.optional(),
    inputRoot: path.optional(),
    referenceRoot: path.optional(),
    out: path,
  }),
  'write',
  a => [
    'chrome-compare-reads',
    ...flagArgs(a, {
      input: 'input',
      reference: 'reference',
      inputAssets: 'input-assets',
      referenceAssets: 'reference-assets',
      inputRoot: 'input-root',
      referenceRoot: 'reference-root',
      out: 'out',
    }),
  ],
);
const endpoint = z
  .enum([OFFICIAL_FIGMA_REMOTE, OFFICIAL_FIGMA_DESKTOP])
  .default(OFFICIAL_FIGMA_REMOTE);
define(
  'figma-mcp.config',
  'Read the official Figma MCP client configuration',
  obj({ endpoint }),
  'local',
  undefined,
  { executionProof: 'local', prerequisites: [] },
);
define(
  'figma-mcp.probe',
  'Probe the official server with the running daemon credentials',
  obj({ endpoint }),
  'read',
  undefined,
  {
    prerequisites: [
      'Use an official Figma MCP endpoint. Remote access requires authorized service OAuth credentials in the daemon environment.',
    ],
  },
);
define(
  'figma-mcp.read',
  'Read from one of the five supported official Figma MCP tools',
  obj({ endpoint, url: text, tool: z.enum(OFFICIAL_FIGMA_READ_TOOLS).default('get_metadata') }),
  'read',
  undefined,
  {
    prerequisites: [
      'Configure official Figma MCP and its authorization first. A single read does not establish complete design capture.',
    ],
  },
);
for (const [action, schema] of [
  ['status', empty],
  ['configure', FigmaOAuthConfigureInputSchema],
  ['start', FigmaOAuthStartInputSchema],
  ['cancel', FigmaOAuthCleanupInputSchema],
  ['logout', FigmaOAuthCleanupInputSchema],
  ['refresh', FigmaOAuthRefreshInputSchema],
] as const)
  define(
    `figma-mcp.auth.${action}`,
    `Daemon-owned official Figma OAuth ${action}; safe status and references only`,
    schema,
    action === 'status' ? 'read' : 'write',
    undefined,
    {
      prerequisites: [
        'Requires this service own approved client contract and daemon environment references. Login does not grant model data permissions or prove full capture. Consent remains manual in a separate portal tab.',
      ],
    },
  );
define(
  'snapshot.capture',
  'Capture a service design snapshot',
  SnapshotCaptureArgsSchema,
  'write',
  undefined,
  { service: 'snapshot.capture', confirmationRequired: false, executionProof: 'single-operation' },
);
define(
  'grounding.refresh',
  'Refresh project grounding',
  GroundingRefreshArgsSchema,
  'write',
  undefined,
  { service: 'grounding.refresh', confirmationRequired: false, executionProof: 'single-operation' },
);
const aliases = {
  'portal.plan': 'portal_plan',
  'portal.start': 'portal_start',
  'portal.next': 'portal_next',
  'portal.status': 'portal_status',
  'portal.cancel': 'portal_cancel',
  'portal.resume': 'portal_resume',
  'portal.submit': 'portal_submit',
  'portal.validate.candidate': 'portal_validate',
  'portal.apply': 'portal_apply',
  'portal.validate.applied': 'portal_validate',
  'portal.prepare-source': 'portal_prepare_source',
} as const;
for (const [name, tool] of Object.entries(aliases)) {
  const spec = ALL_TOOL_SPECS.find(row => row.name === tool)!;
  const schema =
    name === 'portal.validate.candidate'
      ? PortalValidateArgsSchema.extend({ target: z.literal('candidate').default('candidate') })
      : name === 'portal.validate.applied'
        ? PortalValidateArgsSchema.extend({ target: z.literal('applied').default('applied') })
        : spec.inputSchema;
  define(name, spec.description, schema, spec.kind, undefined, {
    tool,
    confirmationRequired: false,
    executionProof: 'single-operation',
  });
}
define(
  'portal.profile.status',
  'Read an owner-bound retained source profile job',
  obj({ preparationId: uuid }),
  'read',
  a => ['portal', 'profile-status', String(a.preparationId)],
);
define(
  'portal.profile.preparations',
  'List owner-bound source profile jobs for a signed plan',
  obj({
    planId: z.string().regex(/^sfp_portal1_[a-f0-9]{32}$/u),
    requestId: uuid.optional(),
    requestHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
  }),
  'read',
  a => ['portal', 'profile-status', ...jsonArgs(a)],
);
define(
  'portal.profile.result',
  'Read the currently issued prepared source profile',
  obj({ preparationId: uuid }),
  'read',
  a => ['portal', 'profile-result', String(a.preparationId)],
);
define(
  'portal.profile.cancel',
  'Cancel a retained source profile producer without replay',
  obj({ preparationId: uuid }),
  'write',
  a => ['portal', 'profile-cancel', String(a.preparationId), '--yes'],
);
define(
  'portal.profile.prepare',
  'Prepare a complete native validation profile for review',
  PortalNativeRegistrationSchema,
  'write',
  a => ['portal', 'profile', ...jsonArgs(a)],
);
define(
  'portal.profile.register',
  'Register the exact previously prepared and reviewed profile',
  PortalPreparedNativeProfileSchema,
  'write',
  a => ['portal', 'profile', ...jsonArgs(a), '--yes'],
);
for (const action of ['inspect', 'reconcile'] as const)
  define(
    `portal.environment-${action}`,
    `${action === 'inspect' ? 'Inspect' : 'Reconcile'} a retained native environment attempt`,
    obj({ attemptId: z.string().regex(/^[a-f0-9]{64}$/u) }),
    action === 'inspect' ? 'read' : 'write',
    a => [
      'portal',
      `environment-${action}`,
      String(a.attemptId),
      ...(action === 'reconcile' ? ['--yes'] : []),
    ],
  );

export function serviceFeatures() {
  return definitions.map(({ schema, argv: _argv, tool, service: _service, ...metadata }) => ({
    ...metadata,
    ...(tool ? { aliasOf: tool } : {}),
    inputSchema: schema.toJSONSchema(),
  }));
}
const find = (name: string) => {
  const definition = definitions.find(row => row.name === name);
  if (!definition)
    throw Object.assign(Error('SERVICE_FEATURE_UNKNOWN'), { code: 'SERVICE_FEATURE_UNKNOWN' });
  return definition;
};
export function parseServiceFeature(name: string, input: unknown) {
  const definition = find(name);
  if (name.startsWith('figma-mcp.auth.'))
    return {
      args: parseFigmaOAuth(definition.schema, input) as Record<string, unknown>,
      kind: definition.kind,
      targetRequirement: 'forbidden' as const,
    };
  const parsed = definition.schema.safeParse(input);
  if (!parsed.success)
    throw Object.assign(Error('SERVICE_FEATURE_ARGUMENTS_INVALID'), {
      code: 'SERVICE_FEATURE_ARGUMENTS_INVALID',
      issues: parsed.error.issues
        .slice(0, 30)
        .map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    });
  const args = parsed.data as Record<string, unknown>;
  for (const key of [
    'folder',
    'workspace',
    'out',
    'input',
    'reference',
    'inputAssets',
    'referenceAssets',
    'inputRoot',
    'referenceRoot',
  ]) {
    const value = args[key];
    if (typeof value === 'string' && (!isAbsolute(value) || /^[/\\]{2}|^\\[?.]\\/u.test(value)))
      throw Object.assign(Error('SERVICE_FEATURE_LOCAL_PATH_REQUIRED'), {
        code: 'SERVICE_FEATURE_LOCAL_PATH_REQUIRED',
      });
  }
  if (name === 'tools.call') {
    const tool = parseServiceTool(String(args.name), args.args);
    return {
      args: { name: args.name, args: tool.args },
      kind: tool.kind,
      targetRequirement: tool.targetRequirement,
    };
  }
  const tool = definition.tool ? parseServiceTool(definition.tool, args) : undefined;
  return {
    args,
    kind: definition.kind,
    targetRequirement:
      tool?.targetRequirement ??
      (definition.service === 'snapshot.capture' ? 'required' : 'forbidden'),
  };
}

/** Fixed public feature dispatch. No shell evaluation or arbitrary control routes are accepted. */
export async function executeServiceFeature(
  client: ControlClient,
  name: string,
  input: unknown,
  context: ServiceFeatureContext,
): Promise<unknown> {
  context.signal.throwIfAborted();
  InvocationTargetSelectorSchema.parse(context.targetSelector);
  const definition = find(name);
  const { args } = parseServiceFeature(name, input);
  const request = <T = unknown>(
    route: string,
    method = 'GET',
    body?: unknown,
    options: Parameters<ControlClient['request']>[3] = {},
  ) =>
    client.request<T>(route, method, body, {
      ...options,
      signal:
        options.signal && options.signal !== context.signal
          ? AbortSignal.any([context.signal, options.signal])
          : context.signal,
    });
  const invoke = async (value: Parameters<ControlClient['invoke']>[0]) => {
    context.signal.throwIfAborted();
    if (name === 'desktop.connect' && context.workspaceId !== null) {
      if (value.workspaceId !== null && value.workspaceId !== context.workspaceId)
        throw Error('SERVICE_JOB_SCOPE_MISMATCH');
      value.workspaceId = context.workspaceId;
    }
    value.signal = context.signal;
    value.emit = context.emit;
    value.approve = false;
    await context.beforeInvoke?.(value);
    context.signal.throwIfAborted();
    return client.invoke(value);
  };
  if (name === 'tools.list') return { tools: serviceTools() };
  if (name === 'figma-mcp.config') return officialFigmaConfiguration(String(args.endpoint));
  if (name.startsWith('figma-mcp.auth.'))
    return executeOfficialFigmaAuth(
      client,
      name.slice('figma-mcp.auth.'.length) as OfficialFigmaAuthAction,
      args,
      context.signal,
    );
  if (name === 'figma-mcp.probe')
    return request('/control/figma-mcp/probe', 'POST', { endpoint: args.endpoint });
  if (name === 'figma-mcp.read') {
    const target = parseFigmaTarget(String(args.url));
    if (!target.nodeId) throw Error('FIGMA_MCP_TARGET_REQUIRED');
    return request('/control/figma-mcp/read', 'POST', {
      endpoint: args.endpoint,
      target: { fileKey: target.fileKey, nodeId: target.nodeId },
      tool: args.tool,
    });
  }
  const tool = name === 'tools.call' ? String(args.name) : (definition.tool ?? definition.service);
  if (tool)
    return invoke({
      name: tool,
      kind: definition.service ? 'service' : 'tool',
      args: name === 'tools.call' ? args.args : args,
      workspaceId: context.workspaceId,
      targetSelector: context.targetSelector,
      approve: false,
      captureResult: true,
      signal: context.signal,
      emit: context.emit,
      timeoutMs: 900_000,
    });
  if (name === 'operations.cancel')
    return request(
      `/control/operations/${encodeURIComponent(String(args.operationId))}/cancel`,
      'POST',
      {
        version: 1,
        requestId: `sfp_req1_${randomBytes(16).toString('base64url')}`,
        operationId: args.operationId,
      },
    );
  if (name === 'operations.resolve') {
    const confirmationHash = `sha256:${createHash('sha256')
      .update('sfp-operation-resolution-confirmation-v1')
      .update(Buffer.from([0]))
      .update(String(args.confirm))
      .digest('hex')}`;
    if (args.confirm !== `${args.operationId}/${args.confirmedResultHash ?? 'unknown'}`)
      throw Error('OPERATION_RESOLUTION_CONFIRMATION_INVALID');
    const semantic = {
      operationId: args.operationId,
      decision: args.decision,
      reasonHash: args.reasonHash,
      evidenceHash: args.evidenceHash,
      confirmedResultHash: args.confirmedResultHash,
      confirmationHash,
    };
    const nonce = await request<{ value: string }>('/control/action-nonces', 'POST', {
      action: 'operation.resolve',
      requestHash: hashActionRequest('operation.resolve', semantic),
    });
    const { operationId, ...body } = args;
    return request(
      `/control/operations/${encodeURIComponent(String(operationId))}/resolve`,
      'POST',
      { ...body, confirmationHash, actionNonce: nonce.value },
    );
  }
  if (!definition.argv) throw Error('SERVICE_FEATURE_HANDLER_MISSING');
  if (name === 'desktop.connect' && args.workspace !== undefined) {
    if (context.workspaceId === null) throw Error('SERVICE_WORKSPACE_REQUIRED');
    const rows =
      await request<Array<{ workspaceId: string; realPath: string; availability?: string }>>(
        '/control/workspaces',
      );
    const selected = rows.find(
      row =>
        row.workspaceId === context.workspaceId &&
        (!row.availability || row.availability === 'available'),
    );
    const canonical = await realpath(String(args.workspace));
    if (!selected || normalizedLocalPath(canonical) !== normalizedLocalPath(selected.realPath))
      throw Error('SERVICE_JOB_SCOPE_MISMATCH');
  }
  // Binding methods to the facade also carries the same abort signal through nested requests.
  const facade = new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'request') return request;
      if (key === 'invoke') return invoke;
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(receiver) : value;
    },
  });
  let output: unknown = null;
  const captureExecution =
    localCaptureFeatures.some(feature => feature === name) ||
    name === 'chrome.tabs' ||
    name === 'chrome.open'
      ? localCaptureExecution(context.executionId, context.progress)
      : undefined;
  try {
    if (name.startsWith('portal.profile.')) {
      await runAdminCommand(
        definition.argv(args),
        value => {
          output = value;
          context.emit(value);
        },
        {
          client: facade,
          signal: context.signal,
          ...(context.deadlineAt ? { deadlineAt: context.deadlineAt } : {}),
          cancelSourceProfile: async (preparationId, deadline) => {
            if (Date.now() >= deadline) throw Error('PORTAL_BUDGET_EXHAUSTED');
            return client.request(
              '/control/portal/profile-preparations/' + preparationId + '/cancel',
              'POST',
              {},
              { timeoutMs: Math.min(3000, deadline - Date.now()) },
            );
          },
        },
      );
    } else
      await runCommand(
        definition.argv(args),
        value => {
          output = value;
          context.emit(value);
        },
        {
          client: facade,
          signal: context.signal,
          allowServerStart: false,
          ...(context.chromeSessionOwner ? { chromeSessionOwner: context.chromeSessionOwner } : {}),
          ...(captureExecution ? { captureExecution } : {}),
        },
      );
  } catch (error) {
    throw captureExecution && localCaptureFeatures.some(feature => feature === name)
      ? captureExecution.failure(error)
      : error;
  }
  context.signal.throwIfAborted();
  return output;
}
