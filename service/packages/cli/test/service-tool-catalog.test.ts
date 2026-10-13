import { expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../../mcp/src/tools/registry.js';
import { parseServiceTool, serviceTools } from '../src/service-tool-catalog.js';

it('publishes every actual tool schema and distinguishes paired-target prerequisites from portal capture', () => {
  const tools = serviceTools();
  expect(tools.map(tool => tool.name)).toEqual(ALL_TOOL_SPECS.map(tool => tool.name));
  expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
  expect(tools.find(tool => tool.name === 'get_pages')).toMatchObject({
    kind: 'read',
    inputSchema: { type: 'object' },
    approval: 'service-policy',
  });
  expect(tools.find(tool => tool.name === 'delete_nodes')?.destructive).toBe(true);
  expect(tools.find(tool => tool.name === 'portal_plan')?.prerequisites.join(' ')).toContain(
    'guided workflow',
  );
  expect(tools.find(tool => tool.name === 'portal_prepare_source')).toMatchObject({
    group: 'portal-tools',
    handlerAuthority: 'server-only',
    inputSchema: { type: 'object' },
    approval: 'service-policy',
  });
});

it('refuses unknown names and invalid arguments and preserves the actual input-dependent target policy', () => {
  expect(() => parseServiceTool('run_shell', {})).toThrow('SERVICE_TOOL_UNKNOWN');
  expect(() => parseServiceTool('get_node', { nodeId: 5 })).toThrow(
    'SERVICE_TOOL_ARGUMENTS_INVALID',
  );
  expect(parseServiceTool('doctor', { roundTrip: false })).toMatchObject({
    targetRequirement: 'forbidden',
  });
  expect(parseServiceTool('doctor', { roundTrip: true })).toMatchObject({
    targetRequirement: 'required',
  });
});
