import { SetAnnotationsArgsSchema, annotationStateKey, type MutateResult } from '@sfp/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeAnnotation } from '../serializer.js';

type AnnotationNode = BaseNode & AnnotationsMixin;
interface WriteOutcome {
  nodeId: string;
  before: readonly Annotation[];
  after: readonly Annotation[] | null;
}
// Internal outcomes never enter the public mutation result or transport arguments.
const outcomes = new WeakMap<object, WriteOutcome>();
const snapshot = (node: AnnotationNode): readonly Annotation[] =>
  Object.freeze(
    node.annotations.map(annotation =>
      Object.freeze(
        Object.assign(
          {},
          annotation,
          annotation.properties === undefined
            ? {}
            : {
                properties: Object.freeze(
                  annotation.properties.map(property => Object.freeze({ ...property })),
                ),
              },
        ),
      ),
    ),
  );
const state = (annotations: readonly Annotation[]) =>
  annotationStateKey(annotations.map(serializeAnnotation));
const getOutcome = (value: unknown) =>
  value !== null && typeof value === 'object' ? outcomes.get(value) : undefined;

/** Only restore our observed write; an unrelated current value is a conflict, never an undo target. */
export const annotationBatchInverse = {
  async capture(figmaCtx: typeof figma, params: unknown) {
    const request = SetAnnotationsArgsSchema.parse(params);
    const node = await figmaCtx.getNodeByIdAsync(request.nodeId);
    if (!node || !('annotations' in node) || !Array.isArray(node.annotations))
      throw Error('ANNOTATION_NODE_UNSUPPORTED');
    return { nodeId: node.id };
  },
  async undo(
    figmaCtx: typeof figma,
    _params: unknown,
    captured: unknown,
    result: unknown,
    failure?: unknown,
  ) {
    const outcome = getOutcome(result) ?? getOutcome(failure);
    if (!outcome) {
      if (result !== undefined) throw Error('ANNOTATION_ROLLBACK_UNVERIFIED');
      // A preflight rejection has no annotation write to undo. Preserve concurrent edits.
      return;
    }
    if (outcome.nodeId !== (captured as { nodeId: string }).nodeId)
      throw Error('ANNOTATION_ROLLBACK_IDENTITY_MISMATCH');
    const node = await figmaCtx.getNodeByIdAsync(outcome.nodeId);
    if (!node || !('annotations' in node) || !Array.isArray(node.annotations))
      throw Error('ANNOTATION_ROLLBACK_NODE_UNAVAILABLE');
    const annotated = node as AnnotationNode;
    const current = state(annotated.annotations);
    if (current === state(outcome.before)) return;
    if (outcome.after === null || current !== state(outcome.after))
      throw Error('ANNOTATION_ROLLBACK_CONFLICT');
    annotated.annotations = outcome.before;
    if (state(annotated.annotations) !== state(outcome.before))
      throw Error('ANNOTATION_ROLLBACK_READBACK_MISMATCH');
  },
};

export const createSetAnnotationsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async (params, context) => {
    const request = SetAnnotationsArgsSchema.parse(params);
    const node = await figmaCtx.getNodeByIdAsync(request.nodeId);
    if (!node || !('annotations' in node) || !Array.isArray(node.annotations))
      throw Error('ANNOTATION_NODE_UNSUPPORTED');
    const annotated = node as AnnotationNode;
    const categoryIds = new Set(
      request.annotations.flatMap(value => (value.categoryId ? [value.categoryId] : [])),
    );
    if (categoryIds.size) {
      if (!figmaCtx.annotations?.getAnnotationCategoriesAsync)
        throw Error('ANNOTATION_CATEGORIES_UNSUPPORTED');
      const categories = await figmaCtx.annotations.getAnnotationCategoriesAsync();
      if ([...categoryIds].some(id => !categories.some(category => category.id === id)))
        throw Error('ANNOTATION_CATEGORY_NOT_FOUND');
    }
    // Category lookup may yield. Compare immediately before the synchronous property write.
    context?.signal.throwIfAborted();
    if (
      annotationStateKey(annotated.annotations.map(serializeAnnotation)) !==
      annotationStateKey(request.expectedAnnotations)
    )
      throw Error('ANNOTATION_PREIMAGE_CHANGED');
    const before = snapshot(annotated);
    try {
      annotated.annotations = request.annotations.map(value =>
        Object.assign(
          {},
          value.label === undefined ? {} : { label: value.label },
          value.labelMarkdown === undefined ? {} : { labelMarkdown: value.labelMarkdown },
          value.categoryId === undefined ? {} : { categoryId: value.categoryId },
          value.properties === undefined
            ? {}
            : { properties: value.properties.map(type => ({ type })) },
        ),
      );
      const actual = annotated.annotations.map(serializeAnnotation);
      if (
        actual.length !== request.annotations.length ||
        request.annotations.some((expected, index) =>
          Object.entries(expected).some(
            ([field, value]) =>
              JSON.stringify((actual[index] as Record<string, unknown>)[field]) !==
              JSON.stringify(value),
          ),
        )
      )
        throw Error('ANNOTATION_READBACK_MISMATCH');
      const result: MutateResult = { ok: true, nodeId: node.id };
      outcomes.set(result, { nodeId: node.id, before, after: snapshot(annotated) });
      return result;
    } catch (cause) {
      const error =
        cause instanceof Error ? cause : new Error('ANNOTATION_WRITE_FAILED', { cause });
      let after: readonly Annotation[] | null = null;
      try {
        after = snapshot(annotated);
      } catch {
        /* Unknown current state must not be overwritten. */
      }
      outcomes.set(error, { nodeId: node.id, before, after });
      throw error;
    }
  };
