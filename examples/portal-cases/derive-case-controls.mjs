import assert from 'node:assert/strict';

/** Derive only current-case IDs from the newly verified tree, never old selector templates. */
export function deriveCurrentCaseLandingControls(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const descendants = node => [node, ...node.childIds.flatMap(id => descendants(byId.get(id)))];
  const controls = { signIn: [], home: [], forms: [], submits: [], emails: {} };
  for (const node of nodes) {
    const name = node.properties.name ?? '';
    if (/button/iu.test(name) && descendants(node).some(child => child.properties.type === 'TEXT' && /^(?:로그인|sign\s*in)$/iu.test(child.properties.characters?.trim() ?? ''))) controls.signIn.push(node.id);
    if (/logo/iu.test(name)) controls.home.push(node.id);
    if (/button/iu.test(name) && /arrow/iu.test(name)) controls.submits.push(node.id);
    if (/input/iu.test(name)) {
      const texts = node.childIds.map(id => byId.get(id)).filter(child => child.properties.type === 'TEXT');
      if (texts.length === 1) controls.emails[node.id] = texts[0].id;
    }
  }
  const outermost = ids => ids.filter(id => {
    for (let parent = byId.get(byId.get(id).parentId); parent; parent = byId.get(parent.parentId)) if (ids.includes(parent.id)) return false;
    return true;
  });
  controls.signIn = outermost(controls.signIn); controls.home = outermost(controls.home); controls.submits = outermost(controls.submits);
  for (const input of Object.keys(controls.emails)) {
    let at = byId.get(input)?.parentId ? byId.get(byId.get(input).parentId) : undefined;
    const seen = new Set();
    while (at) {
      assert(!seen.has(at.id)); seen.add(at.id);
      const ids = new Set(descendants(at).map(node => node.id));
      if (controls.submits.some(id => ids.has(id))) { controls.forms.push(at.id); break; }
      at = byId.get(at.parentId);
    }
    assert(at, 'Own source input/submit form ancestor required');
  }
  controls.forms = [...new Set(controls.forms)];
  assert(controls.signIn.length && controls.forms.length && controls.submits.length && Object.keys(controls.emails).length, 'Current source landing controls need explicit review if not structurally recognized');
  return controls;
}
