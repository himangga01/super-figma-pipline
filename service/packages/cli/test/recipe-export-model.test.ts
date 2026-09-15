import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { AtomicFileStore } from '../../mcp/src/fs/atomic-file.js';
import { handleExportTokens } from '../../mcp/src/tools/safe-union.js';
import { composeFramePdfExport, deriveTokenExportRecipe, verifyFramePdfMetadata, verifyTokenExportRecipe } from '../src/recipe-export-model.js';

const variables = {
  collections: [{ id: 'C', key: 'collection-key', name: 'Theme', defaultModeId: 'L', modes: [{ modeId: 'L', name: 'Light' }, { modeId: 'D', name: 'Dark' }], variableIds: ['V', 'Alias'] }],
  variables: [
    { id: 'V', key: 'variable-key', name: 'Space/Zero', collectionId: 'C', resolvedType: 'FLOAT', valuesByMode: { L: 0, D: 8 } },
    { id: 'Alias', key: 'alias-key', name: 'Space/Alias', collectionId: 'C', resolvedType: 'FLOAT', valuesByMode: { L: { type: 'VARIABLE_ALIAS', id: 'V' }, D: { type: 'VARIABLE_ALIAS', id: 'V' } } },
  ],
};
const styles = { paints: [], texts: [], effects: [], grids: [] };
const dispatch = async (name: string) => {
  if(name === 'get_variable_defs') return variables;
  if(name === 'get_styles') return styles;
  throw new Error('unexpected read');
};
it('JSON token export previews the actual canonical exporter and preserves all modes and aliases', async () => {
  const plan = await deriveTokenExportRecipe({ variables, styles, request: { format: 'json' } });
  expect(plan.status).toBe('ready-to-plan');
  expect(JSON.parse(plan.preview).variables[0].valuesByMode).toEqual({ L: 0, D: 8 });
  expect(plan.preview).toContain('VARIABLE_ALIAS');
  const actual = await handleExportTokens(dispatch, { format: 'json' });
  expect(verifyTokenExportRecipe(plan, actual).tokenCount).toBe(2);
  expect(() => verifyTokenExportRecipe(plan, { ...actual, content: plan.preview + ' ' })).toThrow('RECIPE_EXPORT_BYTES_CHANGED');
});
it('CSS requires an explicit mode decision and rejects unavailable modes instead of default fallback', async () => {
  await expect(deriveTokenExportRecipe({ variables, styles, request: { format: 'css' } })).rejects.toThrow('RECIPE_EXPORT_MODE_DECISION_REQUIRED');
  await expect(deriveTokenExportRecipe({ variables, styles, request: { format: 'css', mode: { kind: 'exact', value: 'Missing' } } })).rejects.toThrow('RECIPE_EXPORT_MODE_MISSING_OR_AMBIGUOUS');
  const plan = await deriveTokenExportRecipe({ variables, styles, request: { format: 'css', mode: { kind: 'exact', value: 'Dark' } } });
  expect(plan.preview).toContain('--space-zero: 8;');
  expect(plan.expected.warnings).toContain('FLOAT values are unitless; apply units at their usage sites.');
  expect(plan.status).toBe('ready-to-plan');
});
it('actual atomic token export bytes are required and an existing destination is never overwritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-recipe-token-')), outPath = join(root, 'tokens.json');
  const plan = await deriveTokenExportRecipe({ variables, styles, request: { format: 'json', outPath } });
  const result = await handleExportTokens(dispatch, plan.args, new AtomicFileStore()), bytes = await readFile(outPath);
  expect(() => verifyTokenExportRecipe(plan, result)).toThrow('RECIPE_EXPORT_ARTIFACT_MISSING');
  expect(verifyTokenExportRecipe(plan, result, bytes).bytes).toBe(bytes.length);
  await expect(handleExportTokens(dispatch, plan.args, new AtomicFileStore())).rejects.toThrow(/already exists/u);
  expect(await readFile(outPath)).toEqual(bytes);
});
it('PDF planning keeps explicit ordered frame identities and does not accept metadata for another target', () => {
  const root = { id: '1:1', parentId: null, type: 'PAGE', children: [{ id: '1:2', parentId: '1:1', type: 'FRAME' }, { id: '1:3', parentId: '1:1', type: 'FRAME' }] };
  const plan = composeFramePdfExport({ root, nodeIds: ['1:3', '1:2'], outPath: 'exports/frames.pdf' });
  expect(plan.args.nodeIds).toEqual(['1:3', '1:2']);
  const result = { path: 'exports/frames.pdf', nodeIds: ['1:3', '1:2'], pageCount: 2, bytesWritten: 100, warnings: [] };
  expect(verifyFramePdfMetadata(plan, result)).toEqual(result);
  expect(() => verifyFramePdfMetadata(plan, { ...result, nodeIds: ['1:2', '1:3'] })).toThrow('RECIPE_PDF_RESULT_CHANGED');
  expect(() => composeFramePdfExport({ root, nodeIds: ['missing'], outPath: 'exports/frames.pdf' })).toThrow('RECIPE_PDF_TARGET_UNAVAILABLE');
});
