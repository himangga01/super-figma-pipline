import { contentHash } from '@sfp/ir';

import type { BrowserNode } from './scripter-bridge.js';

const nonRenderingFields = new Set([
  'id',
  'name',
  'x',
  'y',
  'visible',
  'locked',
  'absoluteBoundingBox',
  'absoluteRenderBounds',
  'reactions',
  'annotations',
  'exportSettings',
]);

/** Match full captured vector state, excluding identity, translation and editor metadata. */
export const equivalentVisibleVectorSources = (nodes: BrowserNode[]) => {
  const visible = new Map<string, string>();
  const hidden: Array<{ nodeId: string; geometryHash: string }> = [];
  const walk = (node: BrowserNode, ancestorHidden = false) => {
    const isHidden = ancestorHidden || node.visible === false;
    if (
      node.type === 'VECTOR' &&
      Array.isArray(node.fillGeometry) &&
      Array.isArray(node.strokeGeometry)
    ) {
      const rendering = Object.fromEntries(
        Object.entries(node).filter(([key]) => !nonRenderingFields.has(key)),
      );
      for (const key of ['relativeTransform', 'absoluteTransform']) {
        const transform = rendering[key];
        if (Array.isArray(transform))
          rendering[key] = transform.map(row => (Array.isArray(row) ? row.slice(0, 2) : row));
      }
      const geometryHash = contentHash('sfp-vector-export-equivalence-v1', rendering);
      if (isHidden || node.absoluteRenderBounds === null)
        hidden.push({ nodeId: node.id, geometryHash });
      else if (!visible.has(geometryHash)) visible.set(geometryHash, node.id);
    }
    node.children?.forEach(child => walk(child, isHidden));
  };
  nodes.forEach(node => walk(node));
  return new Map(
    hidden.flatMap(({ nodeId, geometryHash }) => {
      const source = visible.get(geometryHash);
      return source ? [[nodeId, { nodeId: source, geometryHash }] as const] : [];
    }),
  );
};
