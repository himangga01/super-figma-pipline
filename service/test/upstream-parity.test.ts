import { expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';
import { UNION_MANIFEST } from '../packages/shared/src/capability-manifest.js';

// Parity is a relation to the pinned upstream inventories, so it is asserted as containment rather
// than as a tool count: new service tools never break it, and dropping an upstream tool always does.
const SAFE_UNION = ['doctor', 'export_frames_to_pdf', 'export_tokens', 'import_library_variable'];

it('extends the Figwright baseline with the safe union', () => {
  const toolNames = ALL_TOOL_SPECS.map(tool => tool.name);
  const registered = new Set(toolNames);
  const handlerNames = Object.keys(createSandboxHandlers({} as never));
  const serverOnly = new Set(toolNames.filter(name => !handlerNames.includes(name)));
  const figwright = UNION_MANIFEST.sourceSurfaces.lexicalTools.filter(row =>
    row.sources.includes('figwright'),
  );

  expect(registered.size).toBe(toolNames.length);
  expect(figwright.length).toBeGreaterThan(0);
  expect(figwright.filter(row => !registered.has(row.canonicalName)).map(row => row.name)).toEqual(
    [],
  );
  expect(SAFE_UNION.filter(name => !registered.has(name))).toEqual([]);
  expect(handlerNames.filter(name => !registered.has(name))).toEqual([]);
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
