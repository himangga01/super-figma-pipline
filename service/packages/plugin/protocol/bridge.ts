/**
 * Tool RPC across the plugin's own iframe boundary: the panel hands a tool call down to the
 * sandbox, which executes it against the Figma API and answers with a result or an error. Plus the
 * one-way context event the sandbox pushes back up so the panel can show what the plugin sees.
 *
 * This binds the panel and the sandbox — the same two parties as `panel-control.ts`, which is why
 * both live here rather than in `@figwright/shared`. The relay carries these calls, but the MCP
 * server never constructs or reads one: it addresses tools by name over the wire protocol in
 * `shared`, and what crosses this boundary afterwards is the plugin's own business.
 *
 * Zod, unlike the panel-control channel next door, is warranted here: `params` and `result` are
 * `unknown` by construction — they carry whatever the agent asked for and whatever the Figma API
 * returned — so the tag and envelope are the only things a receiver can check before trusting the
 * message at all.
 */

import { FileIdentitySchema, ProgressEventSchema } from '@sfp/shared';
import { z } from 'zod';

export const PLUGIN_BRIDGE_TAG = '@figwright/bridge';

const baseFields = {
  tag: z.literal(PLUGIN_BRIDGE_TAG),
  id: z.string(),
};

export const PluginExecutionBindingSchema = z
  .object({
    requestId: z.string().min(1).max(384),
    operationId: z.string().min(1).max(384),
    actionNonce: z.string().min(1).max(256),
  })
  .strict();
export type PluginExecutionBinding = z.infer<typeof PluginExecutionBindingSchema>;

export const PluginToolCallSchema = z
  .object({
    ...baseFields,
    kind: z.literal('tool-call'),
    method: z.string(),
    params: z.unknown().optional(),
    binding: PluginExecutionBindingSchema.optional(),
  })
  .strict();

export const PluginToolResultSchema = z
  .object({
    ...baseFields,
    kind: z.literal('tool-result'),
    result: z.unknown().optional(),
  })
  .strict();

export const PluginToolErrorSchema = z
  .object({
    ...baseFields,
    kind: z.literal('tool-error'),
    code: z.string(),
    message: z.string(),
  })
  .strict();

export const PluginToolProgressSchema = z
  .object({
    ...baseFields,
    kind: z.literal('tool-progress'),
    binding: PluginExecutionBindingSchema,
    progress: ProgressEventSchema,
  })
  .strict()
  .refine(value => value.binding.operationId === value.progress.operationId, {
    message: 'sandbox progress operation does not match its execution binding',
  });

export const PluginToolCancelSchema = z
  .object({
    ...baseFields,
    kind: z.literal('tool-cancel'),
    binding: PluginExecutionBindingSchema,
  })
  .strict();

export const PluginBridgeMessageSchema = z.discriminatedUnion('kind', [
  PluginToolCallSchema,
  PluginToolResultSchema,
  PluginToolErrorSchema,
  PluginToolProgressSchema,
  PluginToolCancelSchema,
]);

export type PluginToolCall = z.infer<typeof PluginToolCallSchema>;
export type PluginToolResult = z.infer<typeof PluginToolResultSchema>;
export type PluginToolError = z.infer<typeof PluginToolErrorSchema>;
export type PluginToolProgress = z.infer<typeof PluginToolProgressSchema>;
export type PluginToolCancel = z.infer<typeof PluginToolCancelSchema>;
export type PluginBridgeMessage = z.infer<typeof PluginBridgeMessageSchema>;

export const createToolCall = (input: {
  id: string;
  method: string;
  params?: unknown;
  binding?: Readonly<PluginExecutionBinding>;
}): PluginToolCall => ({
  tag: PLUGIN_BRIDGE_TAG,
  kind: 'tool-call',
  id: input.id,
  method: input.method,
  ...(input.params === undefined ? {} : { params: input.params }),
  ...(input.binding === undefined ? {} : { binding: input.binding }),
});

export const createToolResult = (input: { id: string; result?: unknown }): PluginToolResult => ({
  tag: PLUGIN_BRIDGE_TAG,
  kind: 'tool-result',
  id: input.id,
  ...(input.result === undefined ? {} : { result: input.result }),
});

export const createToolError = (input: {
  id: string;
  code: string;
  message: string;
}): PluginToolError => ({
  tag: PLUGIN_BRIDGE_TAG,
  kind: 'tool-error',
  id: input.id,
  code: input.code,
  message: input.message,
});

export const createToolProgress = (input: {
  id: string;
  binding: Readonly<PluginExecutionBinding>;
  progress: z.input<typeof ProgressEventSchema>;
}): PluginToolProgress =>
  PluginToolProgressSchema.parse({
    tag: PLUGIN_BRIDGE_TAG,
    kind: 'tool-progress',
    id: input.id,
    binding: input.binding,
    progress: input.progress,
  });

export const createToolCancel = (input: {
  id: string;
  binding: Readonly<PluginExecutionBinding>;
}): PluginToolCancel =>
  PluginToolCancelSchema.parse({
    tag: PLUGIN_BRIDGE_TAG,
    kind: 'tool-cancel',
    id: input.id,
    binding: input.binding,
  });

export const isPluginBridgeMessage = (raw: unknown): raw is PluginBridgeMessage => {
  if (typeof raw !== 'object' || raw === null) return false;
  if (!('tag' in raw) || (raw as { tag: unknown }).tag !== PLUGIN_BRIDGE_TAG) return false;
  return PluginBridgeMessageSchema.safeParse(raw).success;
};

// ── sandbox → UI context push ────────────────────────────────────────────────
// A one-way event the sandbox emits (on init / page change / selection change) so the UI can show
// what the plugin currently sees. Kept out of the tool-call request/response variant on purpose.

/**
 * Cap on per-node selection detail carried in a context event (selectionCount keeps the true
 * total).
 */
export const SELECTION_DETAIL_LIMIT = 25;

export const SelectionItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    width: z.number(),
    height: z.number(),
  })
  .strict();

export const PluginContextEventSchema = z
  .object({
    tag: z.literal(PLUGIN_BRIDGE_TAG),
    kind: z.literal('context'),
    fileName: z.string(),
    pageId: z.string(),
    pageName: z.string(),
    selectionCount: z.number(),
    /** Per-node detail for the first SELECTION_DETAIL_LIMIT selected nodes. */
    selection: z.array(SelectionItemSchema),
    editorType: z.enum(['figma', 'figjam', 'dev']),
    /**
     * `figma.mode` — how the plugin was launched, not which editor it is in. The two are
     * independent and the panel needs both: `editorType` says what the document allows, while
     * `mode` says whether our UI is a floating window (`default`) or an iframe filling Dev Mode's
     * Inspect panel (`inspect`), where the window chrome we draw ourselves has nothing to act on.
     */
    mode: z.string(),
    apiVersion: z.string(),
    pluginGeneration: z.string().min(1).max(256).optional(),
    fileIdentity: FileIdentitySchema.optional(),
    capabilities: z.tuple([]).readonly().optional(),
  })
  .strict()
  .refine(
    value => {
      const facts = [value.pluginGeneration, value.fileIdentity, value.capabilities];
      const present = facts.filter(fact => fact !== undefined).length;
      return present === 0 || present === facts.length;
    },
    { message: 'plugin hello identity facts must be present together' },
  );
export type PluginContextEvent = z.infer<typeof PluginContextEventSchema>;

export const createPluginContextEvent = (
  input: Omit<PluginContextEvent, 'tag' | 'kind'>,
): PluginContextEvent => ({ tag: PLUGIN_BRIDGE_TAG, kind: 'context', ...input });

export const isPluginContextEvent = (raw: unknown): raw is PluginContextEvent => {
  if (typeof raw !== 'object' || raw === null) return false;
  if (!('tag' in raw) || (raw as { tag: unknown }).tag !== PLUGIN_BRIDGE_TAG) return false;
  return PluginContextEventSchema.safeParse(raw).success;
};
