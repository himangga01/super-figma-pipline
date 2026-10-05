/** Internal observer marker: snapshot a new node immediately, before any asynchronous placement. */
export const CREATED_NODE_PROPERTY = '__sfp_created_node__';

export interface CreatedNodeSnapshot {
  node: BaseNode;
  parent: BaseNode | null | undefined;
  values: Record<string, unknown>;
  children: CreatedNodeSnapshot[];
}

const copy = (value: unknown): unknown =>
  typeof value === 'symbol' || value === undefined ? value : JSON.parse(JSON.stringify(value));

export const captureCreatedNode = (node: BaseNode): CreatedNodeSnapshot => {
  let remaining = 4096;
  const capture = (target: BaseNode): CreatedNodeSnapshot => {
    if (--remaining < 0) throw new Error('created node snapshot limit exceeded');
    const names = new Set<string>();
    let prototype: object | null = target;
    while (prototype !== null && prototype !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(prototype)) names.add(name);
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    const bag = target as unknown as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const key of names) {
      if (key === 'parent' || key === 'children' || key === 'constructor' || key === '__proto__')
        continue;
      const value = bag[key];
      if (typeof value !== 'function') values[key] = copy(value);
    }
    const children = 'children' in target ? (target as ChildrenMixin).children : [];
    return { node: target, parent: target.parent, values, children: children.map(capture) };
  };
  return capture(node);
};

/** Refresh only fields whose writes were actually observed, retaining every unowned field. */
export const observeCreatedFields = (
  snapshot: CreatedNodeSnapshot,
  properties: readonly string[],
): void => {
  const bag = snapshot.node as unknown as Record<string, unknown>;
  for (const key of properties) {
    if (key === 'parent') snapshot.parent = snapshot.node.parent;
    else if (key in bag) snapshot.values[key] = copy(bag[key]);
  }
};

const equal = (left: CreatedNodeSnapshot, right: CreatedNodeSnapshot): boolean =>
  left.node === right.node &&
  left.parent === right.parent &&
  Object.keys(left.values).length === Object.keys(right.values).length &&
  Object.entries(left.values).every(
    ([key, value]) =>
      Object.is(value, right.values[key]) ||
      (typeof value === 'object' &&
        value !== null &&
        JSON.stringify(value) === JSON.stringify(right.values[key])),
  ) &&
  left.children.length === right.children.length &&
  left.children.every((child, index) => equal(child, right.children[index]!));
export const createdNodeStillOwned = (snapshot: CreatedNodeSnapshot): boolean =>
  equal(snapshot, captureCreatedNode(snapshot.node));
