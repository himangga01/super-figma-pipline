import { expect, it } from 'vitest';

import { normalizeFigmaNativeNodes, compareFigmaCaptureNodes } from '../src/figma-native-nodes.js';
import { mergeNativeReactions } from '../src/figma-native-reactions.js';

const interaction = () => ({
  id: { sessionID: 8, localID: 1 },
  event: { interactionType: 'ON_CLICK' },
  actions: [
    {
      transitionNodeID: { sessionID: 2, localID: 3 },
      connectionType: 'INTERNAL_NODE',
      navigationType: 'NAVIGATE',
    },
  ],
  isDeleted: false,
  stateManagementVersion: 1,
});
const normalize = (prototypeInteractions?: unknown, extra: Record<string, unknown> = {}) =>
  normalizeFigmaNativeNodes(
    {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: 'CANVAS', name: 'Page' },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 } },
          type: 'RECTANGLE',
          name: 'Open cart',
          ...(prototypeInteractions === undefined ? {} : { prototypeInteractions }),
          ...extra,
        },
      ],
    },
    '1:1',
  );

it('decodes recorded native click navigation without reference or plugin facts', () => {
  const result = normalize([
    interaction(),
    { ...interaction(), id: { sessionID: 8, localID: 2 }, isDeleted: true },
  ]);
  const action = {
    type: 'NODE',
    destinationId: '2:3',
    navigation: 'NAVIGATE',
    transition: null,
    resetVideoPosition: false,
  };
  const reactions = [{ trigger: { type: 'ON_CLICK' }, action, actions: [action] }];
  expect(result.nodes[0]?.reactions).toEqual(reactions);
  const compared = compareFigmaCaptureNodes(result.nodes, [{ id: '1:2', reactions }]);
  expect(compared.comparedFields).toContain('reactions');
  expect(compared.differences).toEqual([]);
  expect(normalize().nodes[0]?.reactions).toEqual([]);
  expect(result.complete).toBe(false);
});

it('does not turn legacy native transition data into an empty reaction list', () => {
  const result = normalize(undefined, { transitionNodeID: { sessionID: 2, localID: 3 } });
  expect(result.nodes[0]).not.toHaveProperty('reactions');
  expect(result.warnings).toContainEqual({ code: 'NATIVE_REACTIONS_UNSUPPORTED', nodeId: '1:2' });
});

it('merges recorded instance action fragments by interaction ID and retains deleted rows', () => {
  const changed = {
    id: interaction().id,
    actions: [{ transitionNodeID: { sessionID: 3, localID: 4 } }],
  };
  const base = [interaction()];
  const merged = mergeNativeReactions(base, [changed]);
  expect(normalize(merged).nodes[0]?.reactions).toMatchObject([
    { action: { destinationId: '3:4' }, trigger: { type: 'ON_CLICK' } },
  ]);
  expect(base[0]?.actions[0]?.transitionNodeID).toEqual({ sessionID: 2, localID: 3 });
  expect(
    normalize(mergeNativeReactions(merged, [{ id: changed.id, isDeleted: true }])).nodes[0]
      ?.reactions,
  ).toEqual([]);
  expect(mergeNativeReactions(base, [changed, changed])).toBeNull();
  expect(mergeNativeReactions([interaction(), interaction()], [changed])).toBeNull();
  expect(mergeNativeReactions(null, [changed])).toBeNull();
});

it('applies component reaction fragments in the actual instance expansion path', () => {
  const guid = (localID: number) => ({ sessionID: 1, localID });
  const result = normalizeFigmaNativeNodes(
    {
      nodeChanges: [
        { guid: guid(0), type: 'CANVAS', name: 'Page' },
        { guid: guid(10), type: 'SYMBOL', name: 'Card', prototypeInteractions: [interaction()] },
        {
          guid: guid(11),
          parentIndex: { guid: guid(10) },
          type: 'RECTANGLE',
          name: 'Child',
          prototypeInteractions: [interaction()],
        },
        {
          guid: guid(20),
          parentIndex: { guid: guid(0) },
          type: 'INSTANCE',
          name: 'Card instance',
          symbolData: {
            symbolID: guid(10),
            symbolOverrides: [
              {
                guidPath: { guids: [guid(10)] },
                prototypeInteractions: [
                  { id: interaction().id, actions: [{ transitionNodeID: guid(30) }] },
                ],
              },
              {
                guidPath: { guids: [guid(11)] },
                prototypeInteractions: [{ id: interaction().id, isDeleted: true }],
              },
            ],
          },
        },
      ],
    },
    '1:0',
  );
  expect(result.nodes[0]?.reactions).toMatchObject([{ action: { destinationId: '1:30' } }]);
  const children = result.nodes[0]!.children as Record<string, unknown>[];
  expect(children[0]?.reactions).toEqual([]);
});

it.each(
  [
    [{ ...interaction(), event: { interactionType: 'AFTER_TIMEOUT', timeout: 1 } }],
    [{ ...interaction(), actions: [{ ...interaction().actions[0], transition: { duration: 1 } }] }],
    [{ ...interaction(), actions: [{ ...interaction().actions[0], navigationType: 'OVERLAY' }] }],
    [{ ...interaction(), actions: [{ ...interaction().actions[0], resetVideoPosition: true }] }],
    [{ ...interaction(), actions: [{ ...interaction().actions[0], transitionNodeID: null }] }],
    [{ ...interaction(), isDeleted: 'false' }],
    [{ ...interaction(), actions: [] }],
    [interaction(), interaction()],
    [{ ...interaction(), actions: [interaction().actions[0], interaction().actions[0]] }],
    [{ ...interaction(), actions: Array.from({ length: 33 }, () => interaction().actions[0]) }],
    [null],
    Array.from({ length: 1025 }, interaction),
  ].map(input => ({ input })),
)('preserves unsupported or malformed prototype data as unknown: %#', ({ input }) => {
  const result = normalize(input);
  expect(result.nodes[0]).not.toHaveProperty('reactions');
  expect(result.warnings).toContainEqual({
    code: 'NATIVE_REACTIONS_UNSUPPORTED',
    nodeId: '1:2',
  });
  expect(
    compareFigmaCaptureNodes(result.nodes, [{ id: '1:2', reactions: [] }]).differenceCount,
  ).toBe(1);
});
