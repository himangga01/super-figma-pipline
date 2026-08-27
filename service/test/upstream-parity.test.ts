import { expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';

it('starts at the exact Figwright baseline', () => {
  const toolNames = ALL_TOOL_SPECS.map(tool => tool.name);
  const handlerNames = Object.keys(createSandboxHandlers({} as never));
  const serverOnly = new Set(toolNames.filter(name => !handlerNames.includes(name)));

  expect(new Set(toolNames).size).toBe(112);
  expect(handlerNames).toHaveLength(105);
  expect(serverOnly).toEqual(
    new Set([
      'save_screenshots',
      'analyze_project',
      'scan_components',
      'component_map',
      'token_map',
      'icon_map',
      'design_diff',
    ]),
  );
});
