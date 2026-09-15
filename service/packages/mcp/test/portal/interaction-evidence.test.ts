import { afterEach, expect, it } from 'vitest';

import { derivePortalInteractionContract } from '../../src/portal/interaction-evidence.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
const nodes = (destinationId = '2:1', transition?: unknown) => [
  {
    id: '1:1',
    type: 'FRAME',
    width: 100,
    height: 100,
    children: [
      {
        id: '1:2',
        type: 'RECTANGLE',
        width: 10,
        height: 10,
        reactions: [
          {
            trigger: { type: 'ON_CLICK' },
            actions: [
              {
                type: 'NODE',
                destinationId,
                navigation: 'NAVIGATE',
                ...(transition ? { transition } : {}),
              },
            ],
          },
        ],
      },
    ],
  },
  { id: '2:1', type: 'FRAME', width: 100, height: 100 },
];
it('retains distinct source-root obligations and source-linked destinations', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const { captured } = await currentCaptureFixture(f, { nodes: nodes() });
  const value = derivePortalInteractionContract(captured, []);
  expect(value.complete).toBe(true);
  expect(value.interactions).toHaveLength(1);
  expect(value.interactions[0]).toMatchObject({
    rootNodeId: '1:1',
    sourceNodeId: '1:2',
    destinationNodeId: '2:1',
    action: 'navigate',
    trigger: 'click',
    status: 'supported',
  });
});
it('blocks uncaptured destinations and keeps temporal motion separate from still proofs', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const missing = await currentCaptureFixture(f, { nodes: nodes('9:9') });
  expect(derivePortalInteractionContract(missing.captured, []).interactions[0]?.reason).toBe(
    'PORTAL_INTERACTION_DESTINATION_NOT_CAPTURED',
  );
  const motion = await currentCaptureFixture(f, {
    nodes: nodes('2:1', { type: 'DISSOLVE', duration: 0.3 }),
  });
  expect(derivePortalInteractionContract(motion.captured, []).interactions[0]?.temporal).toMatchObject({
    durationMs: 300,
    type: 'DISSOLVE',
  });
});
it('rejects legacy and changed current capture before deriving assertions', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const { captured } = await currentCaptureFixture(f);
  expect(() =>
    derivePortalInteractionContract({ ...captured, captureVersion: undefined }, []),
  ).toThrow('PORTAL_CAPTURE_VERSION_EVIDENCE_REQUIRED');
  expect(() => derivePortalInteractionContract({ ...captured, raw: '{}' }, [])).toThrow(
    'PORTAL_CAPTURE_EVIDENCE_CHANGED',
  );
});
