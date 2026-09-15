import { z } from 'zod';

export const BrowserReadQuerySchema = z
  .object({
    nodeId: z
      .string()
      .max(512)
      .regex(/^I?\d+:\d+(?:;I?\d+:\d+)*$/u)
      .nullable()
      .default(null),
    depth: z.number().int().min(0).max(40).default(12),
    maxNodes: z.number().int().min(1).max(2_000).default(1_000),
    includeTokens: z.boolean().default(true),
    mode: z.enum(['tree', 'roots', 'tokens', 'references']).default('tree'),
    variableIds: z.array(z.string().min(1).max(512)).max(256).default([]),
    collectionIds: z.array(z.string().min(1).max(512)).max(256).default([]),
    styleIds: z.array(z.string().min(1).max(512)).max(256).default([]),
    childrenOnly: z.boolean().default(false),
    offset: z.number().int().min(0).max(100_000).default(0),
    tokenOffset: z.number().int().min(0).max(100_000).default(0),
    collectionOffset: z.number().int().min(0).max(100_000).default(0),
    paintOffset: z.number().int().min(0).max(100_000).default(0),
    textOffset: z.number().int().min(0).max(100_000).default(0),
    effectOffset: z.number().int().min(0).max(100_000).default(0),
    gridOffset: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export type FigmaCaptureReadQuery = z.infer<typeof BrowserReadQuerySchema>;

export interface BrowserNode {
  id: string;
  name: string;
  type: string;
  children?: BrowserNode[] | undefined;
  omittedChildren?: number | undefined;
  omissionReason?: 'depth' | 'node-budget' | undefined;
  [key: string]: unknown;
}
export const BrowserNodeSchema: z.ZodType<BrowserNode> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).max(512),
      name: z.string().max(20000),
      type: z.string().min(1).max(128),
      children: z.array(BrowserNodeSchema).max(2000).optional(),
      omittedChildren: z.number().int().nonnegative().optional(),
      omissionReason: z.enum(['depth', 'node-budget']).optional(),
    })
    .passthrough(),
);

export const FigmaCaptureReadResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.enum(['figma-plugin-api-via-scripter', 'figma-plugin-api-pinned']),
    fileName: z.string(),
    pageId: z.string(),
    pageName: z.string(),
    nodes: z.array(BrowserNodeSchema).max(2_000),
    tokens: z.array(z.unknown()).max(256),
    collections: z.array(z.unknown()).max(256),
    references: z
      .object({
        variables: z.array(z.unknown()).max(256),
        collections: z.array(z.unknown()).max(256),
        styles: z.array(z.unknown()).max(256),
        unresolved: z
          .array(
            z
              .object({
                family: z.enum(['variables', 'collections', 'styles']),
                id: z.string().min(1).max(512),
                status: z.enum(['unsupported', 'unavailable', 'failed']),
              })
              .strict(),
          )
          .max(768),
      })
      .strict()
      .optional(),
    styles: z
      .object({
        paints: z.array(z.unknown()).max(256),
        texts: z.array(z.unknown()).max(256),
        effects: z.array(z.unknown()).max(256),
        grids: z.array(z.unknown()).max(256),
      })
      .strict(),
    catalogs: z.record(
      z.enum([
        'variables',
        'collections',
        'paintStyles',
        'textStyles',
        'effectStyles',
        'gridStyles',
      ]),
      z
        .object({
          state: z.enum(['complete', 'empty', 'partial', 'unsupported', 'failed']),
          valueTruncated: z.boolean(),
          count: z.number().int().nonnegative().nullable(),
          nextOffset: z.number().int().positive().max(100000).nullable(),
        })
        .strict(),
    ),
    rootIds: z.array(z.string().min(1).max(512)).max(100000),
    scopeNodeId: z.string(),
    scopeType: z.string(),
    valueTruncated: z.boolean(),
    warningCount: z.number().int().nonnegative(),
    rootCount: z.number().int().nonnegative(),
    rootSignature: z.string(),
    nextRootOffset: z.number().int().positive().nullable(),
    nextTokenOffset: z.number().int().positive().nullable(),
    nextCollectionOffset: z.number().int().positive().nullable(),
    coverage: z.object({
      version: z.literal(1),
      fields: z.array(z.string()),
      images: z.literal('references'),
      textGeometry: z.literal('characters-and-fonts').optional(),
      variables: z.boolean(),
    }),
    nodeCount: z.number().int().max(2_000),
    truncated: z.boolean(),
    warnings: z.array(z.unknown()).max(256),
  })
  .strict();
