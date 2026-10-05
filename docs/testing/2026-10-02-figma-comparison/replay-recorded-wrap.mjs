import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
const ts = createRequire(resolve('package.json'))('typescript');

const folder = resolve('../../../docs/testing/2026-10-02-figma-comparison');
const captureBytes = await readFile(resolve(folder, 'chrome-lossless.json'));
const comparisonBytes = await readFile(resolve(folder, 'comparison-lossless.json'));
const capture = JSON.parse(captureBytes);
const comparison = JSON.parse(comparisonBytes);
const sourceBytes = await readFile('packages/shared/src/figma-capture-read.ts');
const source = ts.transpileModule(sourceBytes.toString('utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
runInNewContext(source, { exports });
const differences = comparison.batches.flatMap(batch => batch.differences);
assert.equal(differences.length, 70);
const byId = new Map(capture.nodes.map(node => [node.id, node]));
const page = { id: comparison.pageNodeId, name: 'Recorded text-only replay', type: 'PAGE', parent: null, selection: [], children: [] };
const inputs = capture.textRows.map(row => {
  const omission = differences.find(value => value.id === row.id);
  assert.equal(omission.path, 'segments/0/textWrapStyle');
  assert.equal(omission.actualPresent, false);
  assert.equal(omission.nodeWrap, row.segments[0].textWrapStyle);
  const segments = structuredClone(row.segments);
  delete segments[0].textWrapStyle;
  return {
    ...structuredClone(byId.get(row.id)),
    characters: row.characters,
    textWrapStyle: omission.nodeWrap,
    parent: page,
    getStyledTextSegments: () => segments,
  };
});
page.children = inputs;
const api = { root: { name: 'Recorded bounded comparison replay' }, currentPage: page, getNodeById: id => inputs.find(node => node.id === id) ?? null };
const query = { nodeId: null, depth: 12, maxNodes: 100, includeTokens: false, mode: 'tree', childrenOnly: false, offset: 0, tokenOffset: 0, collectionOffset: 0, paintOffset: 0, textOffset: 0, effectOffset: 0, gridOffset: 0, variableIds: [], collectionIds: [], styleIds: [] };
const result = JSON.parse(await exports.readFigmaCapture(query, api));
assert.equal(result.nodeCount, 70);
assert.equal(result.valueTruncated, false);
const recoveries = result.warnings.filter(row => row.code === 'TEXT_SEGMENT_FIELD_RECOVERED');
assert.equal(recoveries.length, 70);
assert.equal(result.warnings.length, 70);
for (const expected of capture.textRows) {
  const actual = result.nodes.find(node => node.id === expected.id);
  assert.equal(actual.characters, expected.characters);
  assert.deepEqual(actual.textSegments, expected.segments);
  assert.deepEqual(recoveries.find(row => row.nodeId === expected.id), { code: 'TEXT_SEGMENT_FIELD_RECOVERED', nodeId: expected.id, segmentIndex: 0, field: 'textWrapStyle', source: 'node.textWrapStyle' });
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = {
  schemaVersion: 1,
  executedAt: new Date().toISOString(),
  kind: 'recorded-value-replay',
  liveCapture: false,
  fullCapture: false,
  sourcePath: 'service/packages/shared/src/figma-capture-read.ts',
  sourceSha256: sha256(sourceBytes),
  chromeCaptureSha256: sha256(captureBytes),
  comparisonSha256: sha256(comparisonBytes),
  textNodes: 70,
  recordedOfficialSegmentOmissions: 70,
  nodeWrapValues: ['AUTO'],
  recoveredWithExactProvenance: 70,
  remainingTextDifferences: 0,
  valueTruncated: false,
  unicodeCodeUnitsPreserved: { U2028: capture.textRows.reduce((sum, row) => sum + [...row.characters].filter(value => value === '\u2028').length, 0), UFEFF: capture.textRows.reduce((sum, row) => sum + [...row.characters].filter(value => value === '\uFEFF').length, 0) },
  limits: ['The API surface is reconstructed from the recorded bounded comparison and matching Chrome values.', 'This executes the current production reader on retained facts; it is not a new official MCP or Chrome request.', 'Only text values and recovery provenance are asserted; catalogs, assets, component APIs, full capture and frontend acceptance are excluded.'],
};
await writeFile(resolve(folder, 'production-reader-replay.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
