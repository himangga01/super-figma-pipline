import { parseArgs } from 'node:util';

import { z } from 'zod';

import {
  FigmaOAuthCleanupInputSchema,
  FigmaOAuthCodeSchema,
  FigmaOAuthConfigureInputSchema,
  FigmaOAuthRefreshInputSchema,
  FigmaOAuthStartInputSchema,
  FigmaOAuthStatusSchema,
  figmaOAuthError,
  parseFigmaOAuth,
  type FigmaOAuthStatus,
} from '../../mcp/src/control/figma-oauth-contract.js';
import {
  assertOfficialFigmaEndpoint,
  OFFICIAL_FIGMA_READ_TOOLS,
  OFFICIAL_FIGMA_REMOTE,
  officialFigmaConfiguration,
} from '../../mcp/src/official-figma-mcp.js';
import { ControlClient } from './control-client.js';
import { parseFigmaTarget } from './figma-url.js';

const authActions = ['status', 'configure', 'start', 'cancel', 'logout', 'refresh'] as const;
export type OfficialFigmaAuthAction = (typeof authActions)[number];
const authInputs = {
  status: z.object({}).strict(),
  configure: FigmaOAuthConfigureInputSchema,
  start: FigmaOAuthStartInputSchema,
  refresh: FigmaOAuthRefreshInputSchema,
  cancel: FigmaOAuthCleanupInputSchema,
  logout: FigmaOAuthCleanupInputSchema,
};
/** Fixed daemon-owner commands. No private handoff or credential values are returned. */
export async function executeOfficialFigmaAuth(
  client: Pick<ControlClient, 'request'>,
  action: OfficialFigmaAuthAction,
  input: unknown,
  signal?: AbortSignal,
): Promise<{
  authentication: FigmaOAuthStatus;
  fullCapture: false;
  consent?: { available: boolean; portalPath: string; instructions: string };
}> {
  if (signal?.aborted) throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
  const parsed = parseFigmaOAuth(authInputs[action] as z.ZodType, input);
  let response: unknown;
  try {
    response = await client.request(
      `/control/figma-mcp/auth/${action}`,
      action === 'status' ? 'GET' : 'POST',
      action === 'status' ? undefined : parsed,
      signal ? { signal } : {},
    );
  } catch (cause) {
    if (signal?.aborted) throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
    let code;
    try {
      code = FigmaOAuthCodeSchema.safeParse((cause as { code?: unknown })?.code);
    } catch {
      /* Closed error below. */
    }
    throw figmaOAuthError(code?.success ? code.data : 'FIGMA_MCP_OAUTH_RESPONSE_REJECTED');
  }
  let status;
  try {
    status = FigmaOAuthStatusSchema.safeParse(response);
  } catch {
    /* Closed response below. */
  }
  if (!status?.success) throw figmaOAuthError('FIGMA_MCP_OAUTH_RESPONSE_REJECTED');
  if (signal?.aborted) throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
  return {
    authentication: status.data,
    fullCapture: false,
    ...(action === 'start'
      ? {
          consent: {
            available: status.data.handoffAvailable,
            portalPath: '/figma-auth-consent',
            instructions:
              'Open /figma-auth-consent in the same running service portal, in a separate tab. Choose Continue and review Figma consent manually. This command never prints an authorization URL or opens a browser.',
          },
        }
      : {}),
  };
}

async function runAuth(
  args: string[],
  emit: (value: unknown) => void,
  options: { client?: ControlClient; signal?: AbortSignal },
) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        'provider-instance-id': { type: 'string' },
        'configuration-generation': { type: 'string' },
        'auth-generation': { type: 'string' },
        'deadline-at': { type: 'string' },
        'flow-id': { type: 'string' },
        endpoint: { type: 'string' },
        mode: { type: 'string' },
        'oauth-token-env': { type: 'string' },
        'client-id-env': { type: 'string' },
        'client-secret-env': { type: 'string' },
        'contract-reference': { type: 'string' },
        'contract-digest': { type: 'string' },
      },
    });
  } catch {
    throw figmaOAuthError('FIGMA_MCP_OAUTH_INPUT_INVALID');
  }
  const action = parsed.positionals[0] ?? 'status';
  if (parsed.positionals.length > 1 || !authActions.some(value => value === action))
    throw figmaOAuthError('FIGMA_MCP_OAUTH_INPUT_INVALID');
  const values = parsed.values;
  const bindingKeys = ['provider-instance-id', 'configuration-generation', 'auth-generation'];
  const allowed =
    action === 'status'
      ? []
      : [
          ...bindingKeys,
          ...(action === 'configure'
            ? [
                'endpoint',
                'mode',
                'oauth-token-env',
                'client-id-env',
                'client-secret-env',
                'contract-reference',
                'contract-digest',
              ]
            : action === 'start' || action === 'refresh'
              ? ['deadline-at']
              : ['flow-id']),
        ];
  if (Object.keys(values).some(key => !allowed.includes(key)))
    throw figmaOAuthError('FIGMA_MCP_OAUTH_INPUT_INVALID');
  const binding = {
    providerInstanceId: values['provider-instance-id'],
    configurationGeneration: Number(values['configuration-generation']),
    authGeneration: Number(values['auth-generation']),
  };
  const input =
    action === 'status'
      ? {}
      : action === 'configure'
        ? {
            ...binding,
            configuration: {
              endpoint: values.endpoint ?? OFFICIAL_FIGMA_REMOTE,
              mode: values.mode ?? 'own-oauth',
              oauthTokenEnv: values['oauth-token-env'] ?? null,
              clientIdEnv: values['client-id-env'] ?? null,
              clientSecretEnv: values['client-secret-env'] ?? null,
              contractReference: values['contract-reference'] ?? null,
              contractDigest: values['contract-digest'] ?? null,
            },
          }
        : action === 'start' || action === 'refresh'
          ? { ...binding, deadlineAt: Number(values['deadline-at']) }
          : { ...binding, flowId: values['flow-id'] ?? null };
  emit(
    await executeOfficialFigmaAuth(
      options.client ?? new ControlClient(),
      action as OfficialFigmaAuthAction,
      input,
      options.signal,
    ),
  );
}

export async function runOfficialFigmaMcpCommand(
  args: string[],
  emit: (value: unknown) => void,
  context: { client?: ControlClient; signal?: AbortSignal } = {},
): Promise<boolean> {
  if (args[0] !== 'figma-mcp') return false;
  if (args[1] === 'auth') {
    await runAuth(args.slice(2), emit, context);
    return true;
  }
  const parsed = parseArgs({
    args: args.slice(1),
    allowPositionals: true,
    strict: true,
    options: {
      endpoint: { type: 'string', default: OFFICIAL_FIGMA_REMOTE },
      url: { type: 'string' },
      tool: { type: 'string', default: 'get_metadata' },
      'oauth-token-env': { type: 'string' },
    },
  });
  const command = parsed.positionals[0] ?? 'config';
  if (parsed.positionals.length > 1 || !['config', 'probe', 'read'].includes(command))
    throw new Error('FIGMA_MCP_COMMAND_INVALID: use config, probe or read');
  const endpoint = assertOfficialFigmaEndpoint(parsed.values.endpoint);
  if (command === 'config') {
    emit(officialFigmaConfiguration(endpoint));
    return true;
  }
  const tokenEnv = parsed.values['oauth-token-env'];
  if (tokenEnv !== undefined) {
    if (endpoint !== OFFICIAL_FIGMA_REMOTE)
      throw new Error(
        'FIGMA_MCP_OAUTH_REMOTE_ONLY: desktop reads do not accept remote OAuth credentials',
      );
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(tokenEnv))
      throw new Error(
        'FIGMA_MCP_OAUTH_ENV_REQUIRED: designate the configured daemon environment variable name',
      );
  }
  let input: unknown = { endpoint };
  if (command === 'read') {
    if (!parsed.values.url)
      throw new Error('FIGMA_MCP_TARGET_REQUIRED: use --url with an explicit Figma node-id');
    const target = parseFigmaTarget(parsed.values.url);
    if (!target.nodeId)
      throw new Error('FIGMA_MCP_TARGET_REQUIRED: use --url with an explicit Figma node-id');
    if (!(OFFICIAL_FIGMA_READ_TOOLS as readonly string[]).includes(parsed.values.tool))
      throw new Error(
        `FIGMA_MCP_READ_TOOL_REQUIRED: choose ${OFFICIAL_FIGMA_READ_TOOLS.join(', ')}`,
      );
    input = {
      endpoint,
      target: { fileKey: target.fileKey, nodeId: target.nodeId },
      tool: parsed.values.tool,
    };
  }
  const client = context.client ?? new ControlClient();
  if (tokenEnv !== undefined) {
    const { authentication } = await executeOfficialFigmaAuth(client, 'status', {}, context.signal);
    if (
      authentication.configuration.mode !== 'external-token' ||
      authentication.configuration.oauthTokenEnv !== tokenEnv
    )
      throw figmaOAuthError('FIGMA_MCP_OAUTH_BINDING_MISMATCH');
  }
  const result = await client.request(
    `/control/figma-mcp/${command}`,
    'POST',
    input,
    context.signal ? { signal: context.signal } : {},
  );
  if (context.signal?.aborted) throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
  emit(result);
  return true;
}
