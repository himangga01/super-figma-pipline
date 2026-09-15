import { z } from 'zod';

import { isBoundedDesignJson } from './design-observation.js';

const property = z.enum([
  'width',
  'height',
  'maxWidth',
  'minWidth',
  'maxHeight',
  'minHeight',
  'fills',
  'strokes',
  'effects',
  'strokeWeight',
  'cornerRadius',
  'textStyleId',
  'textAlignHorizontal',
  'fontFamily',
  'fontStyle',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'itemSpacing',
  'padding',
  'layoutMode',
  'alignItems',
  'opacity',
  'mainComponent',
  'gridRowGap',
  'gridColumnGap',
  'gridRowCount',
  'gridColumnCount',
  'gridRowAnchorIndex',
  'gridColumnAnchorIndex',
  'gridRowSpan',
  'gridColumnSpan',
]);
const observed = z
  .object({
    label: z.string().max(16384).optional(),
    labelMarkdown: z.string().max(16384).optional(),
    categoryId: z.string().min(1).max(256).optional(),
    properties: z.array(z.string().min(1).max(256)).max(64).optional(),
  })
  .strict();
const writable = observed
  .extend({
    properties: z
      .array(property)
      .max(33)
      .refine(values => new Set(values).size === values.length, 'Duplicate annotation property')
      .optional(),
  })
  .refine(
    value => !(value.label !== undefined && value.labelMarkdown !== undefined),
    'Specify one annotation label format',
  )
  .refine(
    value =>
      value.label !== undefined ||
      value.labelMarkdown !== undefined ||
      (value.properties?.length ?? 0) > 0,
    'An annotation needs a label or pinned property',
  );

/** Exact observed preimage is required; this never means append to an unknown current array. */
export const SetAnnotationsArgsSchema = z
  .object({
    nodeId: z.string().min(1).max(256),
    expectedAnnotations: z.array(observed).max(128),
    annotations: z.array(writable).max(128),
  })
  .strict()
  .refine(
    (value): boolean => isBoundedDesignJson(value, 4_194_304, 50_000),
    'ANNOTATION_INPUT_LIMIT',
  );

export function annotationStateKey(annotations: readonly z.infer<typeof observed>[]): string {
  return JSON.stringify(
    annotations.map(value => [
      value.label ?? null,
      value.labelMarkdown ?? null,
      value.categoryId ?? null,
      value.properties ?? null,
    ]),
  );
}
