import { z } from 'zod';

import { applyAnimationStyleTool } from './apply-animation-style.js';
import { applyManualKeyframeTrackTool } from './apply-manual-keyframe-track.js';
import { cloneNodeTool } from './clone-node.js';
import { createComponentTool } from './create-component.js';
import { createEllipseTool } from './create-ellipse.js';
import { createFrameTool } from './create-frame.js';
import { createInstanceTool } from './create-instance.js';
import { createRectangleTool } from './create-rectangle.js';
import { createSectionTool } from './create-section.js';
import { createTextTool } from './create-text.js';
import { importImageTool } from './import-image.js';
import { importSvgTool } from './import-svg.js';
import { lockNodesTool } from './lock-nodes.js';
import { moveNodesTool } from './move-nodes.js';
import { renameNodeTool } from './rename-node.js';
import { resizeNodesTool } from './resize-nodes.js';
import { rotateNodesTool } from './rotate-nodes.js';
import { setArcTool } from './set-arc.js';
import { setBlendModeTool } from './set-blend-mode.js';
import { setConstraintsTool } from './set-constraints.js';
import { setCornerRadiusTool } from './set-corner-radius.js';
import { setEffectsTool } from './set-effects.js';
import { setFillsTool } from './set-fills.js';
import { setOpacityTool } from './set-opacity.js';
import { setStrokesTool } from './set-strokes.js';
import { setTextPropertiesTool } from './set-text-properties.js';
import { setTextTool } from './set-text.js';
import { setTimelineDurationTool } from './set-timeline-duration.js';
import { setVisibleTool } from './set-visible.js';
import type { RawToolSpec } from './spec.js';
import { unlockNodesTool } from './unlock-nodes.js';

export const BATCH_TOOL_NAME = 'batch';

/** Exact policy-side mirror of the plugin's invertible batch allowlist. */
export const BATCHABLE_TOOL_SPECS = Object.freeze([
  setFillsTool,
  setStrokesTool,
  setOpacityTool,
  setVisibleTool,
  setCornerRadiusTool,
  setArcTool,
  setBlendModeTool,
  setEffectsTool,
  setConstraintsTool,
  renameNodeTool,
  setTextTool,
  setTextPropertiesTool,
  moveNodesTool,
  resizeNodesTool,
  rotateNodesTool,
  lockNodesTool,
  unlockNodesTool,
  createFrameTool,
  createRectangleTool,
  createTextTool,
  createEllipseTool,
  createComponentTool,
  createSectionTool,
  importImageTool,
  importSvgTool,
  createInstanceTool,
  cloneNodeTool,
  applyAnimationStyleTool,
  applyManualKeyframeTrackTool,
  setTimelineDurationTool,
] as const satisfies readonly RawToolSpec[]);

const batchableByName = new Map(BATCHABLE_TOOL_SPECS.map(spec => [spec.name, spec] as const));
export const BATCHABLE_TOOL_NAMES = Object.freeze(BATCHABLE_TOOL_SPECS.map(spec => spec.name));

const batchOpSchema = z
  .object({
    tool: z.string().describe('An invertible write tool name'),
    params: z.record(z.string(), z.unknown()).optional().describe("The tool's parameters"),
  })
  .superRefine((operation, context) => {
    const childSpec = batchableByName.get(operation.tool);
    if (childSpec === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['tool'],
        message: `batch child ${operation.tool} is not a supported invertible operation`,
      });
      return;
    }
    const parsed = childSpec.inputSchema.safeParse(operation.params ?? {});
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        path: ['params'],
        message: `invalid ${operation.tool} parameters: ${parsed.error.message}`,
      });
    }
  });

export interface ParsedBatchOperation {
  tool: string;
  params: Readonly<Record<string, unknown>>;
}

const inputSchema = z.object({
  ops: z.array(batchOpSchema).min(1).describe('Ordered write ops applied atomically'),
});

/** Parse child schemas again to return their normalized values to dynamic policy classification. */
export const parseBatchOperations = (
  args: Readonly<Record<string, unknown>>,
): readonly ParsedBatchOperation[] => {
  const parsed = inputSchema.parse(args);
  return Object.freeze(
    parsed.ops.map(operation => {
      const childSpec = batchableByName.get(operation.tool);
      if (childSpec === undefined) throw new Error(`unsupported batch child: ${operation.tool}`);
      return Object.freeze({
        tool: operation.tool,
        params: childSpec.inputSchema.parse(operation.params ?? {}) as Readonly<
          Record<string, unknown>
        >,
      });
    }),
  );
};

/**
 * Apply several invertible write ops atomically. The plugin validates every op's target first, then
 * applies them in order; if any op fails it rolls the already-applied ops back and the call
 * rejects. Only invertible writes are accepted (property mutations + create/clone/import_image) —
 * destructive ops (delete_*, ungroup, …) can't be restored and are rejected, so the all-or-nothing
 * guarantee holds.
 */
export const batchTool: RawToolSpec = {
  name: BATCH_TOOL_NAME,
  description:
    'Apply multiple invertible write ops atomically (all-or-nothing with rollback). ops is an ordered ' +
    'list of { tool, params } where tool is an invertible write (e.g. set_fills, rename_node, ' +
    'move_nodes, create_frame). Destructive ops (delete_*, ungroup_nodes, …) are rejected. ' +
    'Returns { ok, results } with one result per op in order.',
  inputSchema,
  kind: 'write',
};
