import type { CaseFacts, IndexedFacts } from './types';

/** Structural validation only. The caller must establish its own genuine current plan/capsule authority. */
export function indexFacts(value: CaseFacts, expected: CaseFacts['binding']): IndexedFacts {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.geometry?.nodes) || !Array.isArray(value.geometry?.resources) || !Array.isArray(value.assets)) throw Error('OWN_CASE_FACTS_REQUIRED');
  for (const key of ['caseId', 'planId', 'contextHash', 'coreResultId', 'captureId', 'documentHash'] as const) if (!expected[key] || value.binding[key] !== expected[key]) throw Error('OWN_CASE_BINDING_CHANGED');
  const nodeIndex = Object.fromEntries(value.nodes.map(node => [node.id, node]));
  const geometryIndex = Object.fromEntries(value.geometry.nodes.map(node => [node.nodeId, node]));
  const resourceIndex = Object.fromEntries(value.geometry.resources.map(resource => [resource.resourceId, resource]));
  if (Object.keys(nodeIndex).length !== value.nodes.length || Object.keys(geometryIndex).length !== value.geometry.nodes.length || Object.keys(resourceIndex).length !== value.geometry.resources.length) throw Error('OWN_CASE_DUPLICATE_FACTS');
  for (const node of value.nodes) {
    if (!node.properties || node.properties.id !== node.id || ![node.properties.width, node.properties.height, node.properties.x, node.properties.y].every(Number.isFinite) || node.properties.width < 0 || node.properties.height < 0 || !Array.isArray(node.childIds) || new Set(node.childIds).size !== node.childIds.length || node.childIds.some(id => !nodeIndex[id] || nodeIndex[id].parentId !== node.id)) throw Error('OWN_CASE_NODE_GRAPH_INCOMPLETE');
    if (node.parentId && nodeIndex[node.parentId] && !nodeIndex[node.parentId].childIds.includes(node.id)) throw Error('OWN_CASE_PARENT_CHANGED');
    if (node.properties.type === 'TEXT' && !geometryIndex[node.id]) throw Error('OWN_CASE_TEXT_GEOMETRY_REQUIRED');
  }
  const visited = new Set<string>(), active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw Error('OWN_CASE_NODE_CYCLE');
    if (visited.has(id)) return;
    active.add(id); for (const child of nodeIndex[id].childIds) visit(child); active.delete(id); visited.add(id);
  }
  for (const node of value.nodes) visit(node.id);
  for (const root of Object.values(value.views)) if (!nodeIndex[root.rootId] || !Number.isFinite(root.width) || root.width <= 0 || !Number.isFinite(root.contentHeight) || root.contentHeight <= 0) throw Error('OWN_CASE_VIEW_INVALID');
  for (const asset of value.assets) if (!/^assets\/[A-Za-z0-9._-]+$/u.test(asset.path) || !/^sha256:[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) throw Error('OWN_CASE_ASSET_INVALID');
  const imageAssets: IndexedFacts['imageAssets'] = {}, vectorAssets: IndexedFacts['vectorAssets'] = {};
  for (const asset of value.assets) {
    const table = asset.query.kind === 'image' ? imageAssets : vectorAssets;
    const key = asset.query.kind === 'image' ? asset.query.imageHash : asset.query.nodeId;
    if (Object.hasOwn(table, key)) throw Error('OWN_CASE_DUPLICATE_ASSET');
    table[key] = asset;
  }
  return { ...value, nodeIndex, geometryIndex, resourceIndex, imageAssets, vectorAssets };
}

export function normalizeGlyphPath(value: string): string {
  if (typeof value !== 'string' || value.length > 1048576) throw Error('OWN_CASE_GLYPH_PATH_INVALID');
  const pattern = /[MLQCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/gu;
  const tokens = [...value.matchAll(pattern)];
  if (value.replace(pattern, '').replace(/\s/gu, '') !== '') throw Error('OWN_CASE_GLYPH_PATH_INVALID');
  const counts: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  let cursor = 0, firstMove = -1;
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (!Object.hasOwn(counts, command[0])) throw Error('OWN_CASE_GLYPH_PATH_INVALID');
    if (firstMove < 0) { if (command[0] === 'Z') continue; if (command[0] !== 'M') throw Error('OWN_CASE_GLYPH_PATH_INVALID'); firstMove = command.index; }
    for (let index = 0; index < counts[command[0]]; index++) { const operand = tokens[cursor++]; if (!operand || Object.hasOwn(counts, operand[0]) || !Number.isFinite(Number(operand[0]))) throw Error('OWN_CASE_GLYPH_PATH_INVALID'); }
  }
  return firstMove < 0 ? '' : value.slice(firstMove).trim();
}
