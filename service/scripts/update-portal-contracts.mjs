import './register-source.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const { schemaContractJson } = await import('../packages/shared/src/capability-manifest.ts');
const { PORTAL_INPUT_SCHEMAS, PORTAL_RESULT_SCHEMAS, PORTAL_TOOL_NAMES } =
  await import('../packages/shared/src/portal.ts');

const path = new URL('../capabilities/union-manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(path, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
for (const name of PORTAL_TOOL_NAMES) {
  const row = {
    name,
    sourceRefs: [`super-figma-pipeline:packages/shared/src/portal.ts#${name}`],
    sourceContracts: [
      {
        source: 'super-figma-pipeline',
        schemaHash: hash(
          JSON.stringify(PORTAL_INPUT_SCHEMAS[name].toJSONSchema({ unrepresentable: 'any' })),
        ),
      },
    ],
    targetContractHash: hash(
      schemaContractJson(PORTAL_INPUT_SCHEMAS[name], PORTAL_RESULT_SCHEMAS[name]),
    ),
    disposition: 'adapter',
    registration: 'advertised',
    availability: [
      'registered-workspace',
      'authenticated-owner',
      ...(name === 'portal_validate' ? ['owner-native-profile-required', 'no-docker'] : []),
      ...(name === 'portal_apply' ? ['complete-candidate-acceptance-required'] : []),
    ],
    investment: 'active',
    implementationStatus: 'implemented',
    implementation: 'packages/mcp/src/portal/coordinator.ts',
    test:
      name === 'portal_validate' || name === 'portal_apply'
        ? 'packages/mcp/test/portal/native-work.test.ts'
        : 'packages/mcp/test/portal/coordinator.test.ts',
    policyId: `tool:${name}:v1`,
  };
  const index = manifest.canonicalTools.findIndex(candidate => candidate.name === name);
  if (index < 0) manifest.canonicalTools.push(row);
  else manifest.canonicalTools[index] = row;
}
await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `${PORTAL_TOOL_NAMES.length} portal contracts updated; ${manifest.canonicalTools.length} canonical tools.\n`,
);
