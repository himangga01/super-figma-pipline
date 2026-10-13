import type { CapturedNode, IndexedFacts } from './types';

/** Selectors must be derived from the same actual case facts. No historical source IDs are defaults. */
export type CompositionConfig = { templates: Record<string, string>; heroes: string[]; videos: string[]; dividers: string[] };
export type Composition = { children: Record<string, string[]>; parent: Record<string, string | null>; heroIds: Set<string> };
function box(node: CapturedNode) { const value = node.properties.absoluteBoundingBox; if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) throw Error('OWN_CASE_COMPOSITE_BOUNDS_REQUIRED'); return value; }

/** Reviewed R5 sibling-slot composition generalized to explicit current-case selectors. */
export function composeSourceLayers(facts: IndexedFacts, config: CompositionConfig): Composition {
  const heroes = new Set(config.heroes), videos = new Set(config.videos), dividers = new Set(config.dividers);
  for (const id of [...heroes, ...videos, ...dividers, ...Object.keys(config.templates), ...Object.values(config.templates)]) if (!facts.nodeIndex[id]) throw Error('OWN_CASE_COMPOSITION_NODE_REQUIRED');
  const children = Object.fromEntries(facts.nodes.map(node => [node.id, [...node.childIds]]));
  const parent = Object.fromEntries(facts.nodes.map(node => [node.id, node.parentId]));
  for (const [root, template] of Object.entries(config.templates)) {
    if (!children[root].includes(template)) throw Error('OWN_CASE_TEMPLATE_PARENT_REQUIRED');
    const slots = children[root].filter(id => id !== template);
    children[root] = [template]; children[template].push(...slots);
    for (const id of slots) parent[id] = template;
  }
  function receives(receiver: CapturedNode, child: CapturedNode) {
    if (!heroes.has(receiver.id) && !videos.has(receiver.id) && !(dividers.has(receiver.id) && dividers.has(child.id))) return false;
    const a = box(receiver), b = box(child);
    if (heroes.has(receiver.id)) return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const x = a.x + a.width / 2, y = a.y + a.height / 2;
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  }
  const done = new Set<string>(), active = new Set<string>();
  function arrange(id: string) {
    if (active.has(id)) throw Error('OWN_CASE_COMPOSITION_CYCLE');
    if (done.has(id)) return;
    active.add(id);
    const entries: string[] = [];
    for (const child of children[id]) {
      const receiver = [...entries].reverse().find(candidate => receives(facts.nodeIndex[candidate], facts.nodeIndex[child]));
      if (receiver) { children[receiver].push(child); parent[child] = receiver; } else entries.push(child);
    }
    if (new Set(entries).size !== entries.length) throw Error('OWN_CASE_COMPOSITION_DUPLICATE');
    children[id] = entries;
    for (const child of entries) arrange(child);
    active.delete(id); done.add(id);
  }
  for (const view of Object.values(facts.views)) arrange(view.rootId);
  for (const node of facts.nodes) if (new Set(children[node.id]).size !== children[node.id].length || children[node.id].some(child => parent[child] !== node.id)) throw Error('OWN_CASE_COMPOSITION_PARENT_CHANGED');
  return { children, parent, heroIds: heroes };
}

export function sourceBackdrop(node: CapturedNode, facts: IndexedFacts) {
  for (let parent = node.parentId ? facts.nodeIndex[node.parentId] : undefined; parent; parent = parent.parentId ? facts.nodeIndex[parent.parentId] : undefined) {
    const fill = parent.properties.fills?.find(paint => paint.visible !== false && paint.type === 'SOLID' && paint.color && (paint.opacity ?? 1) === 1 && (paint.color.a ?? 1) === 1);
    if (fill?.color && (parent.properties.opacity ?? 1) === 1) return fill.color;
  }
  throw Error('OWN_CASE_OPAQUE_BACKDROP_REQUIRED');
}
