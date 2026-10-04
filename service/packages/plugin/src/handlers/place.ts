/**
 * Append a freshly-created node to the given parent (or the current page when parentId is omitted).
 * On an invalid parent the orphan node is removed so a failed create never litters the document.
 */
import type { SandboxExecutionContext } from '../dispatcher.js';

export const placeNode = async (
  figmaCtx: typeof figma,
  node: SceneNode,
  parentId: unknown,
  tool: string,
  execution?: Readonly<SandboxExecutionContext>,
): Promise<void> => {
  execution?.signal.throwIfAborted();
  if (typeof parentId !== 'string') {
    figmaCtx.currentPage.appendChild(node);
    execution?.recordOwnedWrite?.(node, ['parent']);
    return;
  }
  const parent = await figmaCtx.getNodeByIdAsync(parentId);
  execution?.signal.throwIfAborted();
  if (parent === null || !('appendChild' in parent)) {
    node.remove();
    throw new Error(`${tool}: parent ${parentId} not found or cannot contain children`);
  }
  (parent as ChildrenMixin).appendChild(node);
  execution?.recordOwnedWrite?.(node, ['parent']);
};
