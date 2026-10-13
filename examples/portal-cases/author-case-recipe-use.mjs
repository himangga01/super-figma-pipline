import assert from 'node:assert/strict';

/** Computational port of the reviewed current public authoring helper. No prepared authority is emitted. */
export function authorCurrentCaseRecipeUse({ pages, nodes, nativeNodes, views, catalogs, composition, reviewRationales }) {
  const byId = new Map(nodes.map(node => [node.id, node])), reviews = new Map();
  const capturedRootIds = new Set(Object.values(views).map(view => view.rootId));
  const recipeUse = { version: 1, targets: [], nativeContours: nativeNodes.map(node => ({ nodeId: node.nodeId, representation: 'native-contour' })), components: [], cssVariables: [], assets: [], catalogs: [], reviews: [] };
  const rect = value => value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key])) && value.width > 0 && value.height > 0 ? value : null;
  function hidden(node) {
    const rendered = rect(node.properties.absoluteRenderBounds), seen = new Set();
    for (let at = node; at; at = byId.get(at.parentId)) {
      assert(!seen.has(at.id), 'Own source tree cycle'); seen.add(at.id);
      if (at.properties.visible === false || at.properties.opacity === 0) return true;
      const clip = at.properties.clipsContent ? rect(at.properties.absoluteBoundingBox) : null;
      if (at.id !== node.id && rendered && clip && (rendered.x + rendered.width <= clip.x || rendered.x >= clip.x + clip.width || rendered.y + rendered.height <= clip.y || rendered.y >= clip.y + clip.height)) return true;
    }
    return false;
  }
  function review(item, row, kind) {
    const key = item.resultId + ':' + kind, value = reviews.get(key) ?? { resultId: item.resultId, kind, rowIds: [] };
    assert(!value.rowIds.includes(row.id), 'Duplicate current recipe review'); value.rowIds.push(row.id); reviews.set(key, value);
  }
  for (const page of pages) for (const row of page.rows) {
    const node = byId.get(row.nodeId ?? row.obligation?.itemId), inactive = node && hidden(node);
    if (row.kind === 'scope') { if (inactive) review(page.item, row, 'inactive'); else if (row.componentApi || row.overrides) review(page.item, row, 'component'); }
    else if (row.kind === 'style-audit') review(page.item, row, inactive ? 'inactive' : 'material');
    else if (row.kind === 'asset' && row.property !== 'root-oracle') {
      if (inactive) review(page.item, row, 'inactive');
      else {
        assert(node, 'Actual asset row requires current captured node');
        assert(row.property === 'vector' || row.property === 'fills' || /^\/fills\/\d+$/u.test(row.property), 'Explicit current asset property mapping required');
        recipeUse.assets.push({ nodeId: row.nodeId, property: row.property, usage: composition.heroes.includes(node.id) || composition.videos.includes(node.id) ? 'background-image' : 'img' });
      }
    } else if (['style', 'collection', 'variable', 'token-export'].includes(row.kind)) {
      const catalog = catalogs.find(value => value.resultId === page.item.resultId && value.rowIds.includes(row.id));
      assert(catalog, 'Exact current catalog row missing'); recipeUse.catalogs.push({ resultId: page.item.resultId, rowId: row.id, path: 'public/' + catalog.path });
    } else if (row.kind === 'strategy') review(page.item, row, 'strategy');
    else if (row.kind === 'obligation') { if (['implement-root', 'construct-component', 'construct-icon'].includes(row.obligation.kind) && node) { if (inactive) review(page.item, row, 'inactive'); } else review(page.item, row, 'strategy'); }
    else if (!['scope', 'asset'].includes(row.kind)) throw Error('Unsupported own current recipe row: ' + row.kind);
  }
  for (const group of reviews.values()) {
    const rationale = reviewRationales?.[group.kind];
    assert(typeof rationale === 'string' && rationale.length >= 20 && rationale.length <= 4096, 'Actual source-specific reviewed rationale required: ' + group.kind);
    for (let index = 0; index < group.rowIds.length; index += 256) recipeUse.reviews.push({ ...group, rowIds: group.rowIds.slice(index, index + 256), rationale });
  }
  for (const node of nodes) {
    let root = node; const visited = new Set();
    while (!capturedRootIds.has(root.id)) { assert(!visited.has(root.id)); visited.add(root.id); root = byId.get(root.parentId); assert(root, 'Current parent missing before captured root'); }
    const entry = Object.entries(views).find(([, view]) => view.rootId === root.id); assert(entry, 'Current captured root view missing');
    const [viewName] = entry;
    recipeUse.targets.push({ nodeId: node.id, rootNodeId: root.id, selector: `[data-sfp-node="${node.id}"]`, route: '/' + viewName, state: 'source:' + root.id, phase: 'source' });
  }
  for (const rows of [recipeUse.targets.map(row => row.nodeId), recipeUse.assets.map(row => row.nodeId + '/' + row.property), recipeUse.catalogs.map(row => row.resultId + '/' + row.rowId)]) assert.equal(new Set(rows).size, rows.length, 'Duplicate current recipe declaration');
  return recipeUse;
}
