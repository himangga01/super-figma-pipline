import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
  type Tool,
} from '@modelcontextprotocol/client';
import { z } from 'zod';

import {
  officialCaptureProgram,
  OfficialCaptureQuerySchema,
  OfficialCaptureTargetSchema,
  type OfficialCaptureQuery,
} from './official-figma-mcp-program.js';

export const OFFICIAL_FIGMA_REMOTE = 'https://mcp.figma.com/mcp';
export const OFFICIAL_FIGMA_DESKTOP = 'http://127.0.0.1:3845/mcp';
export const OFFICIAL_FIGMA_READ_TOOLS = [
  'get_design_context',
  'get_metadata',
  'get_variable_defs',
  'get_screenshot',
  'get_code_connect_map',
] as const;
export type OfficialFigmaReadTool = (typeof OFFICIAL_FIGMA_READ_TOOLS)[number];
export type OfficialFigmaTarget = { fileKey: string; nodeId: string };
export type OfficialFigmaRequestBounds = {
  signal?: AbortSignal;
  deadlineAt?: number;
  credentialActive?: () => void;
  assertPublicResult?: (value: unknown) => void;
};
export interface OfficialFigmaCredentialLease {
  signal: AbortSignal;
  oauthToken: () => Promise<string | undefined>;
  assertActive: () => void;
  release: () => void;
  assertPublicResult?: (value: unknown) => void;
}
export type OfficialFigmaConnectionOptions = OfficialFigmaRequestBounds & {
  /** Current, externally authorized OAuth credentials, held only in memory. */
  oauthToken?: () => Promise<string | undefined>;
  fetch?: FetchLike;
  acquireCredentialLease?: () => OfficialFigmaCredentialLease;
};
const connectionBounds = new WeakMap<Client, OfficialFigmaConnectionOptions>();
const connectionRelease = new WeakMap<Client, () => void>();
async function closeOfficial(client: Client) {
  const release = connectionRelease.get(client);
  connectionRelease.delete(client);
  try {
    await client.close();
  } finally {
    release?.();
  }
}
// Legacy SDK wire mode does not forward per-RPC cancellation to fetch. Retain it across awaits.
const officialRequestContext = new AsyncLocalStorage<OfficialFigmaRequestBounds>();

/** Configuration names a variable; credentials are resolved only for an authorized remote call. */
export function officialFigmaConnectionFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OfficialFigmaConnectionOptions {
  const name = environment.SFP_FIGMA_MCP_OAUTH_TOKEN_ENV;
  if (name === undefined) return {};
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
    fail(
      'FIGMA_MCP_OAUTH_ENV_REQUIRED',
      'Configure the name of an authorized OAuth environment variable.',
    );
  return {
    oauthToken: async () => {
      const value = environment[name];
      if (!value)
        fail(
          'FIGMA_MCP_OAUTH_ENV_REQUIRED',
          'The configured OAuth environment variable is unavailable.',
        );
      return value;
    },
  };
}

const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
};

function requestBounds(
  base: OfficialFigmaRequestBounds,
  scoped: OfficialFigmaRequestBounds = {},
): OfficialFigmaRequestBounds {
  const signals = [base.signal, scoped.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const deadlines = [base.deadlineAt, scoped.deadlineAt].filter(
    (value): value is number => value !== undefined,
  );
  const checks = [base.credentialActive, scoped.credentialActive].filter(
    (check): check is () => void => check !== undefined,
  );
  const resultChecks = [base.assertPublicResult, scoped.assertPublicResult].filter(
    (check): check is (value: unknown) => void => check !== undefined,
  );
  return {
    ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
    ...(deadlines.length ? { deadlineAt: Math.min(...deadlines) } : {}),
    ...(checks.length
      ? {
          credentialActive: () => {
            for (const check of checks) check();
          },
        }
      : {}),
    ...(resultChecks.length
      ? {
          assertPublicResult: (value: unknown) => {
            for (const check of resultChecks) check(value);
          },
        }
      : {}),
  };
}
function assertRequestActive(bounds: OfficialFigmaRequestBounds): void {
  bounds.credentialActive?.();
  bounds.signal?.throwIfAborted();
  if (
    bounds.deadlineAt !== undefined &&
    (!Number.isSafeInteger(bounds.deadlineAt) || Date.now() >= bounds.deadlineAt)
  )
    fail('FIGMA_MCP_DEADLINE_EXCEEDED', 'The original official capture deadline has expired.');
}
/** The absolute budget is inherited, never renewed by another RPC or another image chunk. */
async function boundedRequest<T>(
  bounds: OfficialFigmaRequestBounds,
  action: (options: { timeout: number; signal: AbortSignal }) => Promise<T>,
): Promise<T> {
  assertRequestActive(bounds);
  const timeout = Math.min(
    15_000,
    bounds.deadlineAt === undefined ? 15_000 : bounds.deadlineAt - Date.now(),
  );
  const cancellation = new AbortController();
  const signal = AbortSignal.any([
    ...(bounds.signal ? [bounds.signal] : []),
    AbortSignal.timeout(Math.max(1, timeout)),
    cancellation.signal,
  ]);
  try {
    const result = await officialRequestContext.run({ ...bounds, signal }, () =>
      action({ timeout: Math.max(1, timeout), signal }),
    );
    assertRequestActive(bounds);
    signal.throwIfAborted();
    bounds.assertPublicResult?.(result);
    return result;
  } catch (error) {
    // The SDK's timeout can win the timer race. Abort the actual HTTP request before rejecting.
    cancellation.abort(error);
    assertRequestActive(bounds);
    signal.throwIfAborted();
    throw error;
  }
}

export function assertOfficialFigmaEndpoint(endpoint: string): string {
  if (endpoint !== OFFICIAL_FIGMA_REMOTE && endpoint !== OFFICIAL_FIGMA_DESKTOP)
    fail(
      'FIGMA_MCP_ENDPOINT_UNSUPPORTED',
      'Use https://mcp.figma.com/mcp or http://127.0.0.1:3845/mcp exactly.',
    );
  return endpoint;
}

export function officialFigmaConfiguration(endpoint = OFFICIAL_FIGMA_REMOTE) {
  assertOfficialFigmaEndpoint(endpoint);
  const remote = endpoint === OFFICIAL_FIGMA_REMOTE;
  return {
    source: 'official-figma-mcp' as const,
    endpoint,
    transport: 'streamable-http' as const,
    connected: false,
    browser: 'chrome' as const,
    configuration: { servers: { figma: { url: endpoint, type: 'http' } } },
    authentication: remote ? 'external-oauth' : 'figma-desktop-dev-mode',
    approvedClientRequired: remote,
    handoff: remote
      ? 'Configure this service’s own accepted Figma client contract and credential environment names, then explicitly start service-owned OAuth. An externally provisioned token must also belong to this service. Login never registers a client automatically and does not establish full capture.'
      : 'Enable the official MCP server in the Figma desktop app Dev Mode. Reads use the active desktop file; its identity must be verified separately.',
    documentation: remote
      ? 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/'
      : 'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/',
  };
}

const allowedRead = (name: string): name is OfficialFigmaReadTool =>
  (OFFICIAL_FIGMA_READ_TOOLS as readonly string[]).includes(name);

function captureArguments(tool: Tool | undefined, fileKey: string): Record<string, string> {
  if (!tool)
    return fail(
      'FIGMA_MCP_CAPTURE_UNSUPPORTED',
      'The official server does not advertise use_figma.',
    );
  const properties = tool.inputSchema.properties ?? {};
  const isString = (key: string) => {
    const property = properties[key];
    return (
      property && typeof property === 'object' && 'type' in property && property.type === 'string'
    );
  };
  if (!isString('fileKey') || !isString('code'))
    fail(
      'FIGMA_MCP_CAPTURE_UNSUPPORTED',
      'The official tool cannot bind string fileKey and fixed code.',
    );
  const common = {
    fileKey,
    skillNames: 'figma-use',
    title: 'Read bounded portal design evidence',
    description: 'Read design properties and export assets with the fixed service collector.',
  };
  const args = Object.fromEntries(Object.entries(common).filter(([key]) => isString(key)));
  if (tool.inputSchema.required?.some(key => key !== 'code' && !Object.hasOwn(args, key)))
    fail('FIGMA_MCP_INPUT_UNSUPPORTED', 'The capture tool requires unsupported arguments.');
  return args;
}

async function connectOfficial(endpoint: string, supplied: OfficialFigmaConnectionOptions) {
  assertOfficialFigmaEndpoint(endpoint);
  const remote = endpoint === OFFICIAL_FIGMA_REMOTE;
  const lease = remote ? supplied.acquireCredentialLease?.() : undefined;
  const options: OfficialFigmaConnectionOptions = {
    ...supplied,
    ...requestBounds(
      supplied,
      lease
        ? {
            signal: lease.signal,
            credentialActive: lease.assertActive,
            ...(lease.assertPublicResult ? { assertPublicResult: lease.assertPublicResult } : {}),
          }
        : {},
    ),
    ...(lease ? { oauthToken: lease.oauthToken } : {}),
  };
  const guardedFetch: FetchLike = async (input, init) => {
    if (String(input) !== endpoint)
      fail(
        'FIGMA_MCP_DESTINATION_REJECTED',
        'MCP requests must stay at the configured official endpoint.',
      );
    const response = await boundedRequest(
      requestBounds(
        requestBounds(options, officialRequestContext.getStore()),
        init?.signal ? { signal: init.signal } : {},
      ),
      async request =>
        (options.fetch ?? fetch)(input, { ...init, redirect: 'manual', signal: request.signal }),
    );
    if (response.status >= 300 && response.status < 400)
      fail(
        'FIGMA_MCP_REDIRECT_REJECTED',
        'The official endpoint redirected; credentials were not forwarded.',
      );
    if (response.redirected || (response.url && response.url !== endpoint))
      fail(
        'FIGMA_MCP_DESTINATION_REJECTED',
        'The response did not originate at the configured official endpoint.',
      );
    if (response.status === 401 || response.status === 403)
      fail('FIGMA_MCP_AUTH_REQUIRED', officialFigmaConfiguration(endpoint).handoff);
    return response;
  };
  const client = new Client(
    { name: 'super-figma-pipeline', version: '0.1.0' },
    { capabilities: {} },
  );
  connectionBounds.set(client, options);
  if (lease) connectionRelease.set(client, lease.release);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: guardedFetch,
    onInsufficientScope: 'throw',
    ...(remote && options.oauthToken ? { authProvider: { token: options.oauthToken } } : {}),
  });
  try {
    await boundedRequest(options, request => client.connect(transport, request));
    return client;
  } catch (error) {
    await closeOfficial(client);
    throw error;
  }
}

async function connected<T>(
  endpoint: string,
  options: OfficialFigmaConnectionOptions,
  action: (client: Client, bounds: OfficialFigmaConnectionOptions) => Promise<T>,
): Promise<T> {
  const client = await connectOfficial(endpoint, options);
  try {
    return await action(client, connectionBounds.get(client)!);
  } finally {
    await closeOfficial(client);
  }
}

async function readTools(
  client: Client,
  capture = false,
  bounds: OfficialFigmaRequestBounds = {},
): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 10; page++) {
    // Bound remote pagination; each cursor depends on the preceding response.
    // eslint-disable-next-line no-await-in-loop
    const result = await boundedRequest(bounds, request =>
      client.listTools(cursor === undefined ? {} : { cursor }, request),
    );
    tools.push(
      ...result.tools.filter(
        tool => allowedRead(tool.name) || (capture && tool.name === 'use_figma'),
      ),
    );
    if (result.nextCursor === undefined) return tools;
    if (seen.has(result.nextCursor)) break;
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return fail(
    'FIGMA_MCP_TOOL_LIST_INCOMPLETE',
    'The official server tool list exceeded the pagination limit.',
  );
}

const CaptureResultSchema = z
  .object({
    protocol: z.literal('sfp-official-capture-v1'),
    nonce: z.string().uuid(),
    fileKey: z.string(),
    pageId: z.string().regex(/^\d+:\d+$/u),
    scopeNodeId: z.string(),
    result: z.unknown(),
  })
  .strict();

/** An official tool's generated code/text never establishes native capture completeness. */
function programResult(result: Awaited<ReturnType<Client['callTool']>>) {
  if (result.isError) fail('FIGMA_MCP_TOOL_FAILED', 'The official server returned a tool error.');
  if (Buffer.byteLength(JSON.stringify(result)) > 16_777_216)
    fail('FIGMA_MCP_RESULT_LIMIT', 'The official tool exceeded the bounded response size.');
  const candidates: unknown[] = [];
  const append = (value: unknown) => {
    const direct = CaptureResultSchema.safeParse(value);
    if (direct.success) candidates.push(direct.data);
    else if (value && typeof value === 'object' && 'result' in value) {
      const nested = CaptureResultSchema.safeParse(value.result);
      if (nested.success) candidates.push(nested.data);
    }
  };
  if ('structuredContent' in result) append(result.structuredContent);
  if (Array.isArray(result.content))
    for (const block of result.content) {
      if (block.type !== 'text') continue;
      try {
        append(JSON.parse(block.text));
      } catch {
        // Non-JSON context/prose is never native collector evidence.
      }
    }
  if (
    candidates.length === 0 ||
    candidates.some(value => JSON.stringify(value) !== JSON.stringify(candidates[0]))
  )
    fail(
      'FIGMA_MCP_RESULT_UNSUPPORTED',
      'The official tool did not return one exact capture envelope.',
    );
  return CaptureResultSchema.parse(candidates[0]);
}

/**
 * Discover the official endpoint's actual capability and retain one client session. Only fixed
 * service read/export programs are callable; the general use_figma tool remains absent from the
 * public read API. An endpoint without this capability cannot produce a complete portal capture.
 */
export async function openOfficialFigmaCapture(
  request: { endpoint: string; target: OfficialFigmaTarget },
  supplied: OfficialFigmaConnectionOptions = {},
) {
  const endpoint = assertOfficialFigmaEndpoint(request.endpoint);
  const target = OfficialCaptureTargetSchema.parse(request.target);
  const client = await connectOfficial(endpoint, supplied);
  const options = connectionBounds.get(client)!;
  try {
    const tool = (await readTools(client, true, options)).find(
      candidate => candidate.name === 'use_figma',
    );
    const args = captureArguments(tool, target.fileKey);
    let pageId: string | undefined;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await closeOfficial(client);
    };
    const assertActive = (scoped?: OfficialFigmaRequestBounds) =>
      assertRequestActive(requestBounds(options, scoped));
    const execute = async (
      query: OfficialCaptureQuery,
      scoped: OfficialFigmaRequestBounds = {},
    ) => {
      const bounded = OfficialCaptureQuerySchema.parse(query);
      const bounds = requestBounds(options, scoped);
      assertRequestActive(bounds);
      if (closed) fail('FIGMA_MCP_SESSION_CLOSED', 'The official capture session is closed.');
      const nonce = randomUUID();
      const code = officialCaptureProgram(target, bounded, nonce);
      const result = programResult(
        await boundedRequest(bounds, rpc =>
          client.callTool({ name: 'use_figma', arguments: { ...args, code } }, rpc),
        ),
      );
      assertRequestActive(bounds);
      if (result.nonce !== nonce || result.fileKey !== target.fileKey)
        fail(
          'FIGMA_MCP_FILE_IDENTITY_UNVERIFIED',
          'The runtime did not bind the current requested file.',
        );
      if (
        result.scopeNodeId !== target.nodeId ||
        (pageId !== undefined && pageId !== result.pageId)
      )
        fail('FIGMA_MCP_SCOPE_MISMATCH', 'The runtime scope or page changed.');
      if (bounded.kind === 'read') {
        const inner = result.result;
        if (
          !inner ||
          typeof inner !== 'object' ||
          !('pageId' in inner) ||
          !('scopeNodeId' in inner) ||
          inner.pageId !== result.pageId ||
          inner.scopeNodeId !== bounded.query.nodeId
        )
          fail(
            'FIGMA_MCP_SCOPE_MISMATCH',
            'The read result did not retain its requested query scope.',
          );
      }
      pageId = result.pageId;
      assertRequestActive(bounds);
      return result.result;
    };
    await execute({ kind: 'identity' });
    return { execute, assertActive, close, sessionId: 'official-mcp:' + randomUUID(), endpoint };
  } catch (error) {
    await closeOfficial(client);
    throw error;
  }
}

export async function probeOfficialFigmaMcp(
  endpoint = OFFICIAL_FIGMA_REMOTE,
  options: OfficialFigmaConnectionOptions = {},
) {
  return connected(endpoint, options, async (client, bounds) => {
    const discovered = await readTools(client, true, bounds);
    let captureCapability;
    try {
      captureArguments(
        discovered.find(tool => tool.name === 'use_figma'),
        'probe-file-key',
      );
      captureCapability = {
        supported: true,
        method: 'fixed-plugin-api-program',
        liveVerified: false,
      };
    } catch (error) {
      captureCapability = {
        supported: false,
        reason: String((error as { code: string }).code),
        liveVerified: false,
      };
    }
    return {
      source: 'official-figma-mcp' as const,
      endpoint,
      connected: true,
      server: client.getServerVersion(),
      tools: discovered.filter(tool => allowedRead(tool.name)),
      captureCapability,
      fullCapture: false,
    };
  });
}

export async function readOfficialFigmaMcp(
  request: { endpoint: string; target: OfficialFigmaTarget; tool: OfficialFigmaReadTool },
  options: OfficialFigmaConnectionOptions = {},
) {
  const endpoint = assertOfficialFigmaEndpoint(request.endpoint);
  const toolName = request.tool;
  if (!allowedRead(toolName)) fail('FIGMA_MCP_READ_TOOL_REQUIRED', 'Choose an official read tool.');
  if (
    !/^[A-Za-z0-9_-]{10,128}$/.test(request.target.fileKey) ||
    !/^\d+:\d+$/.test(request.target.nodeId)
  )
    fail('FIGMA_MCP_TARGET_REQUIRED', 'Supply an explicit Figma file key and numeric node ID.');
  const requestedTarget = { fileKey: request.target.fileKey, nodeId: request.target.nodeId };
  return connected(endpoint, options, async (client, bounds) => {
    const tool = (await readTools(client, false, bounds)).find(
      candidate => candidate.name === toolName,
    );
    if (!tool)
      return fail(
        'FIGMA_MCP_TOOL_UNAVAILABLE',
        'The official server does not expose the requested read tool.',
      );
    const properties = tool.inputSchema.properties ?? {};
    if (!Object.hasOwn(properties, 'nodeId'))
      fail('FIGMA_MCP_TARGET_UNSUPPORTED', 'The tool does not support an explicit node ID.');
    const acceptsFile = Object.hasOwn(properties, 'fileKey');
    if (endpoint === OFFICIAL_FIGMA_REMOTE && !acceptsFile)
      fail('FIGMA_MCP_TARGET_UNSUPPORTED', 'The remote tool cannot bind the explicit file key.');
    const args = acceptsFile ? requestedTarget : { nodeId: requestedTarget.nodeId };
    if (tool.inputSchema.required?.some(key => !Object.hasOwn(args, key)))
      fail(
        'FIGMA_MCP_INPUT_UNSUPPORTED',
        'The read tool requires arguments this adapter cannot supply.',
      );
    const result = await boundedRequest(bounds, rpc =>
      client.callTool(
        {
          name: toolName,
          arguments: args,
        },
        rpc,
      ),
    );
    if (result.isError) fail('FIGMA_MCP_TOOL_FAILED', 'The official server returned a tool error.');
    return {
      source: 'official-figma-mcp' as const,
      endpoint,
      requestedTarget,
      tool: toolName,
      identityBinding: acceptsFile
        ? ('request-only' as const)
        : ('desktop-active-file-unverified' as const),
      result,
      fullCapture: false,
    };
  });
}
