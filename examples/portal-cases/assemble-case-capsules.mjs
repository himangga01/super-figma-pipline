import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, join, isAbsolute, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { indexFacts } from './shared-design/facts.ts';
import { composeSourceLayers } from './shared-design/composition.ts';
import { authorCurrentCaseRecipeUse } from './author-case-recipe-use.mjs';
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => digest(Buffer.from(JSON.stringify(value)));
const hash = /^sha256:[a-f0-9]{64}$/u;
const safePath = value => typeof value === 'string' && /^assets\/[A-Za-z0-9._-]+$/u.test(value);

/** Offline materialization only. The controller supplies own current public outputs and actual lease authority. */
export async function assembleOwnCaseCapsules({ expected, inputs, ownedOutputParent, outputRoot, responsiveBreakpoint, viewNames = {}, reviewRationales }) {
  assert(['c2', 'c3'].includes(expected?.caseId));
  assert(/^sfp_portal1_[a-f0-9]{32}$/u.test(expected.planId));
  for (const key of ['contextHash', 'blueprintHash', 'sourceRuntimeHash']) assert(hash.test(expected[key]));
  assert(Number.isSafeInteger(expected.originalDeadlineAt) && Date.now() < expected.originalDeadlineAt, 'Immutable original own-case deadline must remain live');
  assert(expected.materialBinding && expected.recipeBinding && expected.designCapture && expected.inputFiles, 'Complete protected receipt bindings required');
  assert(Number.isFinite(responsiveBreakpoint) && responsiveBreakpoint > 0, 'Actual authored responsive decision required');
  const output = resolve(outputRoot), parent = resolve(ownedOutputParent), within = relative(parent, output);
  assert(within && !within.startsWith('..') && !isAbsolute(within), 'New owned assembly descendant required');
  assert.equal((await realpath(parent)).toLowerCase(), parent.toLowerCase(), 'Owned parent must not be an alias');
  const outputParent = dirname(output), actualOutputParent = await realpath(outputParent);
  assert.equal(actualOutputParent.toLowerCase(), outputParent.toLowerCase(), 'Output ancestor must not be an alias');
  assert.equal(await lstat(output).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false, 'Do not overwrite another candidate');
  const sourceInputs = {}, read = async name => {
    const path = resolve(inputs[name]), info = await lstat(path), pin = expected.inputFiles[name];
    assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Current public input must be a regular single-link file');
    assert.equal((await realpath(path)).toLowerCase(), path.toLowerCase(), 'Current public input must not use an alias');
    assert(pin && hash.test(pin.sha256) && Number.isSafeInteger(pin.bytes) && pin.bytes > 0, 'Five exact protected input pins required');
    assert.equal(info.size, pin.bytes);
    const bytes = await readFile(path); assert.equal(bytes.length, pin.bytes); assert.equal(digest(bytes), pin.sha256);
    sourceInputs[name] = pin; return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, ''));
  };
  const [design, material, assets, ui, pages] = await Promise.all(['design', 'material', 'assets', 'ui', 'pages'].map(read));
  const blueprint = ui.run?.context?.blueprint ?? ui.run?.context;
  assert.equal(blueprint?.workflowCoverage?.complete, true);
  assert.equal(blueprint.design?.complete, true); assert.equal(blueprint.design?.liveVerified, true);
  assert.equal(ui.run.serviceRunId, expected.planId);
  assert.equal(design.coreRunId, expected.planId);
  assert.equal(design.contextHash, expected.contextHash);
  assert.equal(design.blueprintHash, expected.blueprintHash);
  assert.equal(blueprint.contextHash, expected.contextHash); assert.equal(blueprint.blueprintHash, expected.blueprintHash);
  assert.deepEqual(design.capture, expected.designCapture);
  assert.deepEqual(material.binding, expected.materialBinding);
  assert.equal(material.binding.deadlineAt, expected.originalDeadlineAt);
  assert.equal(material.binding.planId, expected.planId);
  assert.equal(material.binding.contextHash, expected.contextHash);
  assert.equal(material.binding.blueprintHash, expected.blueprintHash);
  assert.equal(assets.planId, expected.planId);
  assert.equal(assets.captureHash, material.binding.captureRawHash);
  assert.equal(pages.contextHash, expected.contextHash);
  assert.equal(pages.blueprintHash, expected.blueprintHash);
  assert.equal(pages.planId, expected.planId);
  assert.deepEqual(pages.binding, expected.recipeBinding);
  assert.equal(pages.binding.status, 'ready');
  assert.equal(pages.pages.length, pages.binding.workItemCount);
  assert.equal(new Set(pages.pages.map(page => page.item.id)).size, pages.pages.length);
  for (const page of pages.pages) {
    assert.equal(page.rows.length, page.item.rows, 'Exact current recipe continuation row count');
    const required = pages.binding.requiredResults.find(row => row.resultId === page.item.resultId);
    assert(required && required.resultHash === page.item.resultHash && required.recipeId === page.item.recipeId, 'Current recipe continuation belongs to required results');
  }
  assert(pages.binding.requiredResults.every(row => pages.pages.some(page => page.item.resultId === row.resultId && page.item.resultHash === row.resultHash)), 'All current required recipe results present');
  assert(hash.test(pages.binding?.bindingHash) && hash.test(pages.binding?.contextHash));
  const evidence = new Set(blueprint.workflowCoverage.evidence.map(row => row.id));
  const decisions = ui.workflow?.plan?.workflowDecisions;
  assert(Array.isArray(decisions) && decisions.length, 'Confirmed current workflow decisions required');
  for (const decision of decisions) { assert.equal(decision.analysisHash, blueprint.workflowCoverage.analysisHash); assert(evidence.has(decision.evidenceId)); }
  const binding = {
    caseId: expected.caseId, planId: expected.planId, contextHash: expected.contextHash, coreResultId: design.coreRunId,
    captureId: material.binding.captureFingerprint, documentHash: material.binding.documentHash,
    blueprintHash: expected.blueprintHash, captureRawHash: material.binding.captureRawHash,
    captureFingerprint: material.binding.captureFingerprint, materializationHash: material.binding.materializationHash,
    geometryBindingHash: material.binding.bindingHash,
  };
  for (const key of ['captureRawHash', 'captureFingerprint', 'materializationHash', 'documentHash', 'geometryBindingHash']) assert(hash.test(binding[key]));
  const nodes = design.nodes, byId = new Map(nodes.map(node => [node.id, node]));
  assert.equal(byId.size, nodes.length);
  assert.equal(nodes.length, expected.counts.designNodes);
  assert.equal(material.nodes.length, expected.counts.nativeNodes);
  assert.equal(material.resources.length, expected.counts.nativeResources);
  assert.equal(assets.inventory.length, expected.counts.assetInventory);
  assert.equal(pages.pages.reduce((sum, page) => sum + page.rows.length, 0), expected.counts.recipeRows);
  const views = {}, oracles = [], mappings = [], references = [], pending = [];
  const add = (path, bytes) => { assert(!pending.some(row => row.path === path)); pending.push({ path, bytes: Buffer.from(bytes) }); };
  const contentById = new Map(assets.contents.map(row => [row.id, row]));
  assert.equal(contentById.size, assets.contents.length);
  if (inputs.smallAssets) {
    const small = await read('smallAssets'); assert.equal(small.planId, expected.planId); assert.equal(small.captureHash, binding.captureRawHash);
    for (const content of small.contents) { const original = contentById.get(content.id); assert(original && original.hash === content.hash); contentById.set(content.id, content); }
  }
  const roots = nodes.filter(node => assets.inventory.some(asset => asset.query.kind === 'png' && asset.query.nodeId === node.id));
  assert(roots.length, 'Current source root PNG oracles required');
  for (const node of roots) {
    const asset = assets.inventory.find(row => row.query.kind === 'png' && row.query.nodeId === node.id), content = contentById.get(asset.id);
    assert.equal(content?.delivery, 'base64');
    const bytes = Buffer.from(content.data, 'base64');
    assert.equal(bytes.length, asset.bytes); assert.equal(digest(bytes), asset.sha256);
    assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.equal(width, node.properties.width);
    const name = viewNames[node.id] ?? (/guide/iu.test(node.properties.name) ? 'guide' : width < responsiveBreakpoint ? 'mobile' : 'desktop');
    assert(/^[a-z][a-z0-9-]{0,31}$/u.test(name) && !views[name], 'Distinct actual view name required');
    views[name] = { rootId: node.id, width, capturedHeight: node.properties.height, contentHeight: height };
    oracles.push({ nodeId: node.id, assetId: asset.id, sha256: asset.sha256, bytes: asset.bytes, width, height, sourceOracleOnly: true });
  }
  for (const asset of assets.inventory.filter(row => row.query.kind !== 'png')) {
    assert(['image', 'svg'].includes(asset.query.kind), 'Current implementation asset kind required');
    assert(safePath(asset.path) && hash.test(asset.sha256) && Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
    const content = contentById.get(asset.id); assert(asset.status === 'captured' && content && content.hash === asset.sha256);
    if (content.delivery === 'artifact-reference') assert.equal(content.reference?.planId, expected.planId);
    const candidatePath = 'public/' + asset.path, protectedReferenceRequired = asset.bytes > 1048576;
    if (content.delivery === 'base64') { const bytes = Buffer.from(content.data, 'base64'); assert.equal(bytes.length, asset.bytes); assert.equal(digest(bytes), asset.sha256); if (!protectedReferenceRequired) add(candidatePath, bytes); }
    if (!protectedReferenceRequired) assert.equal(content.delivery, 'base64');
    else references.push({ path: candidatePath, assetId: asset.id, bytes: asset.bytes, sha256: asset.sha256, query: asset.query, encoding: 'protected-current-capture-reference' });
    mappings.push({ id: asset.id, query: asset.query, path: asset.path, candidatePath, sha256: asset.sha256, bytes: asset.bytes, protectedReferenceRequired });
  }
  const packetBindingHash = jsonHash(binding);
  function packs(rows, kind, prefix) {
    const groups = []; let group = [];
    const packet = rows => Buffer.from(JSON.stringify({ schemaVersion: 1, kind, bindingHash: packetBindingHash, rows }));
    for (const row of rows) { if (group.length && packet([...group, row]).length > 390000) { groups.push(group); group = []; } group.push(row); }
    if (group.length) groups.push(group);
    return groups.map((rows, index) => { const path = `facts/${prefix}-${index + 1}.json`, bytes = packet(rows); assert(bytes.length <= 400000, 'Fixed fact packet bound'); add('public/' + path, bytes); return { path, sha256: digest(bytes), bytes: bytes.length, count: rows.length }; });
  }
  const catalogs = [], groups = new Map();
  for (const page of pages.pages) {
    const rows = page.rows.filter(row => ['style', 'collection', 'variable', 'token-export'].includes(row.kind));
    if (!rows.length) continue;
    assert(hash.test(page.item.resultId) && hash.test(page.item.resultHash));
    let group = groups.get(page.item.resultId);
    if (!group) { group = { schema: 'sfp.core-materials.v1', resultId: page.item.resultId, resultHash: page.item.resultHash, rows: [] }; groups.set(group.resultId, group); }
    assert.equal(group.resultHash, page.item.resultHash); group.rows.push(...rows);
  }
  assert(groups.size, 'Actual current catalog rows required');
  let catalogIndex = 0;
  for (const group of groups.values()) {
    assert(group.rows.length <= 16384);
    const bytes = Buffer.from(JSON.stringify(group)); assert(bytes.length <= 1048576, 'Strict catalog submit bound');
    const path = `core-materials-${++catalogIndex}.json`; add('public/' + path, bytes);
    catalogs.push({ resultId: group.resultId, resultHash: group.resultHash, path, sha256: digest(bytes), bytes: bytes.length, rowIds: group.rows.map(row => row.id) });
  }
  const facts = { schemaVersion: 1, binding, views, assets: mappings.map(({ candidatePath, protectedReferenceRequired, ...asset }) => asset), packetBindingHash, packs: { nodes: packs(nodes, 'nodes', 'nodes'), resources: packs(material.resources, 'resources', 'resources'), geometryNodes: packs(material.nodes, 'geometry-nodes', 'geometry-nodes') }, coreCatalogs: catalogs };
  const composition = { templates: {}, heroes: [], videos: [], dividers: [] };
  for (const root of roots) { const template = root.childIds.map(id => byId.get(id)).find(node => node?.properties.type === 'INSTANCE' && node.properties.name === 'Template'); if (template) composition.templates[root.id] = template.id; }
  for (const node of nodes) {
    const paints = (node.properties.fills ?? []).filter(paint => paint.visible !== false), image = paints.find(paint => paint.type === 'IMAGE');
    if (node.properties.type === 'RECTANGLE' && image && paints.some(paint => paint.type === 'GRADIENT_LINEAR')) composition.heroes.push(node.id);
    if (node.properties.type === 'RECTANGLE' && image && mappings.find(asset => asset.query.kind === 'image' && asset.query.imageHash === image.imageHash)?.path.endsWith('.gif')) composition.videos.push(node.id);
    if (node.properties.type === 'RECTANGLE' && node.properties.name === 'divider') composition.dividers.push(node.id);
  }
  const indexed = indexFacts({ schemaVersion: 1, nodes, geometry: { nodes: material.nodes, resources: material.resources }, assets: facts.assets, views, binding }, binding);
  composeSourceLayers(indexed, composition);
  add('public/current-facts.json', JSON.stringify(facts));
  add('current-case-design.json', JSON.stringify({ binding, responsiveBreakpoint, composition, views, sourceOracles: oracles, coreCatalogs: catalogs }, null, 2));
  const recipeUse = authorCurrentCaseRecipeUse({ pages: pages.pages, nodes, nativeNodes: material.nodes, views, catalogs, composition, reviewRationales });
  add('recipe-use-input.json', JSON.stringify(recipeUse, null, 2));
  const manifest = { schemaVersion: 1, kind: 'own-case-current-capsule-materialization', sourceRuntimeHash: expected.sourceRuntimeHash, binding, files: pending.map(row => ({ path: row.path, bytes: row.bytes.length, sha256: digest(row.bytes), encoding: /\.(?:png|gif|jpe?g|woff2?)$/u.test(row.path) ? 'base64' : 'utf8' })), assetReferences: references, sourceInputHashes: sourceInputs, rootPngUiProxies: false, oldDataOrAssetsCopied: false, leaseOrAuthCopied: false, serviceAcceptance: false, preparedCoreConsumptionClaim: false };
  // Validate everything before creating the owned output. Captured oracles are metadata only, never UI.
  assert(Date.now() < expected.originalDeadlineAt, 'Original own-case deadline expired during materialization');
  await mkdir(output); for (const row of pending) { await mkdir(join(output, row.path, '..'), { recursive: true }); await writeFile(join(output, row.path), row.bytes, { flag: 'wx' }); }
  await writeFile(join(output, 'capsule-files-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { output, manifest, recipeUse, composition, needsActualCoreConsumptionPreparation: true };
}
