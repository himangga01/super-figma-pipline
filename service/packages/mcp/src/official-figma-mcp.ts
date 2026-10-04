import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
  type Tool,
} from '@modelcontextprotocol/client';

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
export type OfficialFigmaConnectionOptions = {
  /** Current, externally authorized OAuth credentials, held only in memory. */
  oauthToken?: () => Promise<string | undefined>;
  fetch?: FetchLike;
};

const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
};

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
      ? 'Configure the official Figma plugin in an approved MCP client and authenticate there. The service accepts current externally authorized OAuth credentials in memory; it does not register itself as an approved client or persist tokens.'
      : 'Enable the official MCP server in the Figma desktop app Dev Mode. Reads use the active desktop file; its identity must be verified separately.',
    documentation: remote
      ? 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/'
      : 'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/',
  };
}

const allowedRead = (name: string): name is OfficialFigmaReadTool =>
  (OFFICIAL_FIGMA_READ_TOOLS as readonly string[]).includes(name);

async function connected<T>(
  endpoint: string,
  options: OfficialFigmaConnectionOptions,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  assertOfficialFigmaEndpoint(endpoint);
  const remote = endpoint === OFFICIAL_FIGMA_REMOTE;
  const guardedFetch: FetchLike = async (input, init) => {
    if (String(input) !== endpoint)
      fail(
        'FIGMA_MCP_DESTINATION_REJECTED',
        'MCP requests must stay at the configured official endpoint.',
      );
    const response = await (options.fetch ?? fetch)(input, {
      ...init,
      redirect: 'manual',
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
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
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: guardedFetch,
    onInsufficientScope: 'throw',
    ...(remote && options.oauthToken ? { authProvider: { token: options.oauthToken } } : {}),
  });
  try {
    await client.connect(transport, { timeout: 15_000 });
    return await action(client);
  } finally {
    await client.close();
  }
}

async function readTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 10; page++) {
    // Bound remote pagination; each cursor depends on the preceding response.
    // eslint-disable-next-line no-await-in-loop
    const result = await client.listTools(cursor === undefined ? {} : { cursor });
    tools.push(...result.tools.filter(tool => allowedRead(tool.name)));
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

export async function probeOfficialFigmaMcp(
  endpoint = OFFICIAL_FIGMA_REMOTE,
  options: OfficialFigmaConnectionOptions = {},
) {
  return connected(endpoint, options, async client => ({
    source: 'official-figma-mcp' as const,
    endpoint,
    connected: true,
    server: client.getServerVersion(),
    tools: await readTools(client),
    fullCapture: false,
  }));
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
  return connected(endpoint, options, async client => {
    const tool = (await readTools(client)).find(candidate => candidate.name === toolName);
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
    const result = await client.callTool(
      {
        name: toolName,
        arguments: args,
      },
      { timeout: 15_000 },
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
