import { parseArgs } from 'node:util';

import {
  assertOfficialFigmaEndpoint,
  OFFICIAL_FIGMA_READ_TOOLS,
  OFFICIAL_FIGMA_REMOTE,
  officialFigmaConfiguration,
  probeOfficialFigmaMcp,
  readOfficialFigmaMcp,
  type OfficialFigmaConnectionOptions,
  type OfficialFigmaReadTool,
} from '../../mcp/src/official-figma-mcp.js';
import { parseFigmaTarget } from './figma-url.js';

export async function runOfficialFigmaMcpCommand(
  args: string[],
  emit: (value: unknown) => void,
): Promise<boolean> {
  if (args[0] !== 'figma-mcp') return false;
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
  const options: OfficialFigmaConnectionOptions = {};
  const tokenEnv = parsed.values['oauth-token-env'];
  if (tokenEnv !== undefined) {
    if (endpoint !== OFFICIAL_FIGMA_REMOTE)
      throw new Error(
        'FIGMA_MCP_OAUTH_REMOTE_ONLY: desktop reads do not accept remote OAuth credentials',
      );
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv) || !process.env[tokenEnv])
      throw new Error(
        'FIGMA_MCP_OAUTH_ENV_REQUIRED: designate an environment variable containing current externally authorized OAuth credentials',
      );
    options.oauthToken = async () => process.env[tokenEnv];
  }
  if (command === 'probe') emit(await probeOfficialFigmaMcp(endpoint, options));
  else {
    if (!parsed.values.url)
      throw new Error('FIGMA_MCP_TARGET_REQUIRED: use --url with an explicit Figma node-id');
    const target = parseFigmaTarget(parsed.values.url);
    if (!target.nodeId)
      throw new Error('FIGMA_MCP_TARGET_REQUIRED: use --url with an explicit Figma node-id');
    if (!(OFFICIAL_FIGMA_READ_TOOLS as readonly string[]).includes(parsed.values.tool))
      throw new Error(
        `FIGMA_MCP_READ_TOOL_REQUIRED: choose ${OFFICIAL_FIGMA_READ_TOOLS.join(', ')}`,
      );
    emit(
      await readOfficialFigmaMcp(
        {
          endpoint,
          target: { fileKey: target.fileKey, nodeId: target.nodeId },
          tool: parsed.values.tool as OfficialFigmaReadTool,
        },
        options,
      ),
    );
  }
  return true;
}
