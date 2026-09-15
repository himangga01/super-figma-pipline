import { expect, it } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSandboxHandlers } from '../../src/handlers/registry.js';
import { createRenameNodeHandler } from '../../src/handlers/rename-node.js';
import { createSetAnnotationsHandler } from '../../src/handlers/set-annotations.js';
import { MUTATION_CONTRACTS, withMutationOutcome } from '../../src/mutation.js';

const fixture = () => {
  const node = {
    id: '1:2',
    type: 'FRAME',
    name: 'Original',
    annotations: [{ label: 'Existing' }] as Annotation[],
  };
  const figmaCtx = {
    getNodeByIdAsync: async (id: string) => (id === node.id ? node : null),
    annotations: { getAnnotationCategoriesAsync: async () => [{ id: 'category' }] },
  } as unknown as typeof figma;
  return { node, figmaCtx, handler: createSetAnnotationsHandler(figmaCtx) };
};

it('registers a canonical mutation-aware plugin handler', () => {
  expect(MUTATION_CONTRACTS.set_annotations).toBe('state');
  expect(createSandboxHandlers(fixture().figmaCtx).set_annotations).toBeTypeOf('function');
});

it('does not report success when the host ignores the annotation setter', async () => {
  const f = fixture();
  Object.defineProperty(f.node, 'annotations', {
    get: () => [{ label: 'Existing' }],
    set: () => {},
  });
  await expect(
    f.handler({ nodeId: f.node.id, expectedAnnotations: [{ label: 'Existing' }], annotations: [] }),
  ).rejects.toThrow('ANNOTATION_READBACK_MISMATCH');
});

it('honors cancellation during category lookup before writing', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.figmaCtx.annotations.getAnnotationCategoriesAsync = async () => {
    controller.abort();
    return [{ id: 'category' }] as AnnotationCategory[];
  };
  await expect(
    f.handler(
      {
        nodeId: f.node.id,
        expectedAnnotations: [{ label: 'Existing' }],
        annotations: [{ label: 'New', categoryId: 'category' }],
      },
      { signal: controller.signal, report: () => {} },
    ),
  ).rejects.toThrow(/abort/iu);
  expect(f.node.annotations).toEqual([{ label: 'Existing' }]);
});

it('replays the original canonical request without a second annotation write', async () => {
  const f = fixture();
  const handler = createSandboxHandlers(f.figmaCtx).set_annotations!;
  const args = {
    nodeId: f.node.id,
    expectedAnnotations: [{ label: 'Existing' }],
    annotations: [{ label: 'New' }],
  };
  const context = {
    requestId: 'same-operation',
    signal: new AbortController().signal,
    report: () => {},
  };
  expect(await handler(args, context)).toEqual(await handler(args, context));
  expect(f.node.annotations).toEqual([{ label: 'New' }]);
});

it('writes plain, rich, pinned and categorized annotations without changing the node', async () => {
  const f = fixture();
  const result = await f.handler({
    nodeId: f.node.id,
    expectedAnnotations: [{ label: 'Existing' }],
    annotations: [
      { label: 'New' },
      { labelMarkdown: '**Important**', categoryId: 'category' },
      { properties: ['width', 'fills'] },
    ],
  });
  expect(result).toEqual({ ok: true, nodeId: f.node.id });
  expect(f.node.annotations).toEqual([
    { label: 'New' },
    { labelMarkdown: '**Important**', categoryId: 'category' },
    { properties: [{ type: 'width' }, { type: 'fills' }] },
  ]);
  expect(f.node.name).toBe('Original');
});

it('refuses stale preimages and unknown categories before changing anything', async () => {
  const f = fixture();
  await expect(
    f.handler({ nodeId: f.node.id, expectedAnnotations: [], annotations: [] }),
  ).rejects.toThrow('ANNOTATION_PREIMAGE_CHANGED');
  await expect(
    f.handler({
      nodeId: f.node.id,
      expectedAnnotations: [{ label: 'Existing' }],
      annotations: [{ label: 'New', categoryId: 'missing' }],
    }),
  ).rejects.toThrow('ANNOTATION_CATEGORY_NOT_FOUND');
  expect(f.node.annotations).toEqual([{ label: 'Existing' }]);
});

it('rechecks annotations after asynchronous category resolution', async () => {
  const f = fixture();
  f.figmaCtx.annotations.getAnnotationCategoriesAsync = async () => {
    f.node.annotations = [{ label: 'Concurrent' }];
    return [{ id: 'category' }] as AnnotationCategory[];
  };
  await expect(
    f.handler({
      nodeId: f.node.id,
      expectedAnnotations: [{ label: 'Existing' }],
      annotations: [{ label: 'New', categoryId: 'category' }],
    }),
  ).rejects.toThrow('ANNOTATION_PREIMAGE_CHANGED');
  expect(f.node.annotations).toEqual([{ label: 'Concurrent' }]);
});

it('rejects unknown fields, duplicate pins and unsupported properties', async () => {
  const f = fixture();
  for (const annotations of [
    [{ label: 'One', script: 'arbitrary' }],
    [{ properties: ['width', 'width'] }],
    [{ properties: ['unknown'] }],
    [{ label: 'One', labelMarkdown: 'Two' }],
  ])
    await expect(
      f.handler({ nodeId: f.node.id, expectedAnnotations: [{ label: 'Existing' }], annotations }),
    ).rejects.toThrow(/annotation|property|Unknown|Unrecognized|Invalid/iu);
  expect(f.node.annotations).toEqual([{ label: 'Existing' }]);
});

it('clears only the admitted annotation preimage and observes the actual mutation', async () => {
  const f = fixture();
  const wrapped = withMutationOutcome(f.figmaCtx, 'set_annotations', f.handler);
  const result = await wrapped({
    nodeId: f.node.id,
    expectedAnnotations: [{ label: 'Existing' }],
    annotations: [],
  });
  expect(result).toMatchObject({ mutated: true, value: { ok: true, nodeId: f.node.id } });
  expect(f.node.annotations).toEqual([]);
});

it('restores annotation preimages if a later invertible batch step fails', async () => {
  const f = fixture();
  const batch = createBatchHandler(f.figmaCtx, {
    set_annotations: f.handler,
    rename_node: createRenameNodeHandler(f.figmaCtx),
  });
  await expect(
    batch({
      ops: [
        {
          tool: 'set_annotations',
          params: {
            nodeId: f.node.id,
            expectedAnnotations: [{ label: 'Existing' }],
            annotations: [{ label: 'Changed' }],
          },
        },
        { tool: 'rename_node', params: { nodeId: f.node.id, name: '' } },
      ],
    }),
  ).rejects.toThrow(/non-empty/iu);
  expect(f.node.annotations).toEqual([{ label: 'Existing' }]);
});

it('preserves concurrent annotations when batch preflight fails after category lookup', async () => {
  const f = fixture();
  f.figmaCtx.annotations.getAnnotationCategoriesAsync = async () => {
    f.node.annotations = [{ label: 'Concurrent user edit' }];
    return [{ id: 'category' }] as AnnotationCategory[];
  };
  const batch = createBatchHandler(f.figmaCtx, { set_annotations: f.handler });
  await expect(
    batch({
      ops: [
        {
          tool: 'set_annotations',
          params: {
            nodeId: f.node.id,
            expectedAnnotations: [{ label: 'Existing' }],
            annotations: [{ label: 'Desired', categoryId: 'category' }],
          },
        },
      ],
    }),
  ).rejects.toThrow('ANNOTATION_PREIMAGE_CHANGED');
  expect(f.node.annotations).toEqual([{ label: 'Concurrent user edit' }]);
});

it('reports partial change if the host ignores annotation rollback', async () => {
  const f = fixture();
  let annotations: readonly Annotation[] = [{ label: 'Existing' }];
  Object.defineProperty(f.node, 'annotations', {
    get: () => annotations,
    set: (value: readonly Annotation[]) => {
      if (value[0]?.label !== 'Existing') annotations = value;
    },
  });
  const batch = createBatchHandler(f.figmaCtx, {
    set_annotations: f.handler,
    rename_node: createRenameNodeHandler(f.figmaCtx),
  });
  const error = await Promise.resolve(
    batch({
      ops: [
        {
          tool: 'set_annotations',
          params: {
            nodeId: f.node.id,
            expectedAnnotations: [{ label: 'Existing' }],
            annotations: [{ label: 'Desired' }],
          },
        },
        { tool: 'rename_node', params: { nodeId: f.node.id, name: '' } },
      ],
    }),
  ).catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: 'BATCH_PARTIAL_CHANGE' });
  expect((error as Error).message).toContain('ANNOTATION_ROLLBACK_READBACK_MISMATCH');
  expect(f.node.annotations).toEqual([{ label: 'Desired' }]);
});

it('does not overwrite a later concurrent edit during rollback', async () => {
  const f = fixture();
  const batch = createBatchHandler(f.figmaCtx, {
    set_annotations: f.handler,
    rename_node: async () => {
      f.node.annotations = [{ label: 'Concurrent after write' }];
      throw Error('Later operation failed');
    },
  });
  const error = await Promise.resolve(
    batch({
      ops: [
        {
          tool: 'set_annotations',
          params: {
            nodeId: f.node.id,
            expectedAnnotations: [{ label: 'Existing' }],
            annotations: [{ label: 'Desired' }],
          },
        },
        { tool: 'rename_node', params: { nodeId: f.node.id, name: 'Next' } },
      ],
    }),
  ).catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: 'BATCH_PARTIAL_CHANGE' });
  expect((error as Error).message).toContain('ANNOTATION_ROLLBACK_CONFLICT');
  expect(f.node.annotations).toEqual([{ label: 'Concurrent after write' }]);
});

it('unwinds repeated annotation writes through their actual intermediate preimages', async () => {
  const f = fixture();
  const batch = createBatchHandler(f.figmaCtx, {
    set_annotations: f.handler,
    rename_node: createRenameNodeHandler(f.figmaCtx),
  });
  await expect(
    batch({
      ops: [
        {
          tool: 'set_annotations',
          params: {
            nodeId: f.node.id,
            expectedAnnotations: [{ label: 'Existing' }],
            annotations: [{ label: 'First' }],
          },
        },
        {
          tool: 'set_annotations',
          params: {
            nodeId: f.node.id,
            expectedAnnotations: [{ label: 'First' }],
            annotations: [{ label: 'Second' }],
          },
        },
        { tool: 'rename_node', params: { nodeId: f.node.id, name: '' } },
      ],
    }),
  ).rejects.toThrow('rolled back 2 applied op(s)');
  expect(f.node.annotations).toEqual([{ label: 'Existing' }]);
});

it('restores a setter that mutates and then throws using the recorded failure outcome', async () => {
  const f = fixture();
  let annotations: readonly Annotation[] = [{ label: 'Existing' }];
  Object.defineProperty(f.node, 'annotations', {
    get: () => annotations,
    set: (value: readonly Annotation[]) => {
      annotations = value;
      if (value[0]?.label === 'Desired') throw Error('Host failed after write');
    },
  });
  const batch = createBatchHandler(f.figmaCtx, { set_annotations: f.handler });
  await expect(
    batch({
      ops: [
        {
          tool: 'set_annotations',
          params: {
            nodeId: f.node.id,
            expectedAnnotations: [{ label: 'Existing' }],
            annotations: [{ label: 'Desired' }],
          },
        },
      ],
    }),
  ).rejects.toThrow('restored the failing op');
  expect(f.node.annotations).toEqual([{ label: 'Existing' }]);
});
