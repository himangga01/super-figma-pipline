import { expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';

it('extends the Figwright baseline with the safe union', () => {
  const toolNames = ALL_TOOL_SPECS.map(tool => tool.name);
  const handlerNames = Object.keys(createSandboxHandlers({} as never));
  const serverOnly = new Set(toolNames.filter(name => !handlerNames.includes(name)));

  expect(new Set(toolNames).size).toBe(125);
  expect(handlerNames).toHaveLength(106);
  expect(serverOnly).toEqual(
    new Set([
      'portal_plan',
      'portal_start',
      'portal_next',
      'portal_submit',
      'portal_apply',
      'portal_validate',
      'portal_status',
      'portal_resume',
      'portal_cancel',
      'doctor',
      'export_tokens',
      'export_frames_to_pdf',
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
