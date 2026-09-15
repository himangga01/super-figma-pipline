import './register-source.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const { ALL_TOOL_SPECS } = await import('../packages/mcp/src/tools/registry.ts');
const { schemaContractJson } = await import('../packages/shared/src/capability-manifest.ts');
const path = new URL('../capabilities/union-manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(path, 'utf8'));
for (const spec of ALL_TOOL_SPECS) {
  const row = manifest.canonicalTools.find(item => item.name === spec.name);
  if (!row) throw new Error(`Missing source provenance for ${spec.name}`);
  row.targetContractHash = createHash('sha256')
    .update(schemaContractJson(spec.inputSchema, spec.resultSchema))
    .digest('hex');
  if (
    ['doctor', 'export_tokens', 'export_frames_to_pdf', 'import_library_variable'].includes(
      spec.name,
    )
  ) {
    row.implementationStatus = 'implemented';
    row.implementation =
      spec.name === 'import_library_variable'
        ? 'packages/plugin/src/handlers/import-library-variable.ts'
        : 'packages/mcp/src/tools/safe-union.ts';
    row.test =
      spec.name === 'import_library_variable'
        ? 'packages/plugin/test/handlers/import-library-variable.test.ts'
        : 'packages/mcp/test/tools/safe-union.test.ts';
  }
}
await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
