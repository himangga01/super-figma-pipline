import { contentHash } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { portalDesignFingerprint } from '../../src/portal/design-capture.js';
import { normalizeDesignObservation } from '../../src/portal/design-normalization.js';
import { derivePortalInteractionContract } from '../../src/portal/interaction-evidence.js';
import {
  preparePortalObservationManifest,
  sameObservationIdentity,
} from '../../src/portal/observation-manifest.js';
import { deriveCoreRecipeBundle } from '../../src/portal/recipes/core-derivation.js';
import { coverPortalWorkflows } from '../../src/portal/service-selection.js';
import { analyzePortalWorkflows } from '../../src/portal/workflow-requirements.js';
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
it('retains a reviewed incidental unsupported action without blocking the required action', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const design = nodes();
  design[0]!.children!.push({
    id: '1:3',
    type: 'RECTANGLE',
    width: 10,
    height: 10,
    reactions: [
      {
        trigger: { type: 'ON_CLICK' },
        actions: [{ type: 'URL', url: 'https://example.com/footer' }],
      },
    ],
  } as never);
  const { captured } = await currentCaptureFixture(f, { nodes: design });
  const blocked = derivePortalInteractionContract(captured, []);
  const incidental = blocked.interactions.find(value => value.sourceNodeId === '1:3')!;
  const reviewed = derivePortalInteractionContract(captured, [], undefined, {
    version: 1,
    captureFingerprint: portalDesignFingerprint(captured),
    exclusions: [
      {
        interactionId: incidental.id,
        sourceHash: incidental.sourceHash,
        reason:
          'External attribution link is incidental to the owner-selected application workflow.',
      },
    ],
  });
  expect(reviewed.complete).toBe(true);
  expect(reviewed.interactions).toHaveLength(1);
  expect(reviewed.excludedInteractions).toMatchObject([
    { id: incidental.id, sourceHash: incidental.sourceHash, reason: expect.any(String) },
  ]);
  expect(reviewed.scopeHash).not.toBe(blocked.scopeHash);
  expect(JSON.parse(captured.raw).nodes[0].children[1].reactions[0].actions[0].type).toBe('URL');
  const input = {
    observation: normalizeDesignObservation(JSON.parse(captured.raw), captured.collectorEvidence),
    strategy: 'blank-frontend' as const,
    assets: [],
    interactionContract: reviewed,
  };
  const bundle = deriveCoreRecipeBundle(input);
  const interactionResult = bundle.results.find(value => value.recipeId === 'derive-interactions')!;
  expect(interactionResult.output.status).toBe('ready');
  const rows = bundle.pages.flatMap(value => value.page.rows);
  const excluded = rows.find(value => value.kind === 'interaction' && value.nodeId === '1:3');
  expect(excluded).toMatchObject({
    expectations: [
      {
        status: 'excluded',
        exclusion: {
          interactionId: incidental.id,
          sourceHash: incidental.sourceHash,
          selectionHash: reviewed.selectionHash,
          reason: reviewed.excludedInteractions![0]!.exclusionReason,
        },
      },
    ],
  });
  expect(
    rows.filter(
      value =>
        value.kind === 'obligation' && value.obligation.kind === 'review-incidental-interaction',
    ),
  ).toHaveLength(1);
  for (const result of bundle.results)
    expect(result.output).toMatchObject({
      interactionContractHash: contentHash('sfp-interaction-contract-v1', reviewed),
      interactionSelectionHash: reviewed.selectionHash,
    });
  expect(bundle.inputHash).not.toBe(
    deriveCoreRecipeBundle({ ...input, interactionContract: blocked }).inputHash,
  );
  expect(
    deriveCoreRecipeBundle({ ...input, interactionContract: blocked }).results.find(
      value => value.recipeId === 'derive-interactions',
    )!.output.status,
  ).toBe('blocked');
  expect(() =>
    deriveCoreRecipeBundle({
      ...input,
      interactionContract: {
        ...reviewed,
        excludedInteractions: [
          {
            ...reviewed.excludedInteractions![0]!,
            sourceHash: contentHash('changed', 'raw reaction'),
          },
        ],
      },
    }),
  ).toThrow('CORE_INTERACTION_CONTRACT_SOURCE_MISMATCH');
  expect(() =>
    derivePortalInteractionContract({ ...captured, complete: false }, [], undefined, {
      version: 1,
      captureFingerprint: reviewed.captureFingerprint,
      exclusions: [
        {
          interactionId: incidental.id,
          sourceHash: incidental.sourceHash,
          reason: 'Still incidental',
        },
      ],
    }),
  ).toThrow('PORTAL_CAPTURE_CURRENT_REQUIRED');
});
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
it('refuses exclusions of directly required nodes even when owner wording has no workflow keyword', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const { captured } = await currentCaptureFixture(f, { nodes: nodes() });
  const contract = derivePortalInteractionContract(captured, []);
  const action = contract.interactions[0]!;
  expect(() =>
    derivePortalInteractionContract(
      captured,
      [
        {
          id: 'primary',
          description: 'Primary card behavior',
          required: true,
          layers: ['frontend'],
        },
      ],
      {
        version: 1,
        analysisHash: contentHash('test', 'coverage'),
        evidence: [
          { id: 'button', kind: 'design', hash: action.sourceHash, nodeId: action.sourceNodeId },
        ],
        scopes: [
          {
            id: 'primary',
            evidenceIds: ['button'],
            requirementIds: ['primary'],
            status: 'covered',
          },
        ],
        decisions: [],
        complete: true,
        issues: [],
      },
      {
        version: 1,
        captureFingerprint: contract.captureFingerprint,
        exclusions: [
          {
            interactionId: action.id,
            sourceHash: action.sourceHash,
            reason: 'Attempt to exclude primary behavior',
          },
        ],
      },
    ),
  ).toThrow('PORTAL_REQUIRED_INTERACTION_EXCLUSION_FORBIDDEN');
});
it('rejects stale capture, substituted source, unknown IDs and duplicate exclusions', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const { captured } = await currentCaptureFixture(f, { nodes: nodes() });
  const contract = derivePortalInteractionContract(captured, []),
    action = contract.interactions[0]!;
  const exclusion = {
    interactionId: action.id,
    sourceHash: action.sourceHash,
    reason: 'Incidental behavior reviewed by owner',
  };
  const scope = {
    version: 1 as const,
    captureFingerprint: contract.captureFingerprint,
    exclusions: [exclusion],
  };
  expect(() =>
    derivePortalInteractionContract(captured, [], undefined, {
      ...scope,
      captureFingerprint: contentHash('different', 'capture'),
    }),
  ).toThrow('SELECTION_CAPTURE_CHANGED');
  expect(() =>
    derivePortalInteractionContract(captured, [], undefined, {
      ...scope,
      exclusions: [{ ...exclusion, sourceHash: contentHash('different', 'source') }],
    }),
  ).toThrow('SELECTION_SOURCE_CHANGED');
  expect(() =>
    derivePortalInteractionContract(captured, [], undefined, {
      ...scope,
      exclusions: [{ ...exclusion, interactionId: contentHash('different', 'id') }],
    }),
  ).toThrow('SELECTION_SOURCE_CHANGED');
  expect(() =>
    derivePortalInteractionContract(captured, [], undefined, {
      ...scope,
      exclusions: [exclusion, exclusion],
    }),
  ).toThrow('Duplicate interaction exclusion');
});
it('covers only reviewed unclassified scopes whose every retained action is incidental', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const { captured } = await currentCaptureFixture(f, {
    nodes: [
      {
        id: '1:1',
        type: 'FRAME',
        children: [
          {
            id: '1:2',
            type: 'RECTANGLE',
            name: 'Footer',
            reactions: [
              {
                trigger: { type: 'ON_CLICK' },
                actions: [{ type: 'URL', url: 'https://example.com/' }],
              },
              { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'BACK' }] },
            ],
          },
        ],
      },
    ],
  });
  const analysis = analyzePortalWorkflows(JSON.parse(captured.raw), 'frontend-only');
  const original = derivePortalInteractionContract(captured, []);
  const exclusion = (action: (typeof original.interactions)[number]) => ({
    interactionId: action.id,
    sourceHash: action.sourceHash,
    reason: 'Owner-reviewed incidental footer behavior.',
  });
  const mixed = derivePortalInteractionContract(captured, [], undefined, {
    version: 1,
    captureFingerprint: original.captureFingerprint,
    exclusions: [exclusion(original.interactions[0]!)],
  });
  expect(coverPortalWorkflows(analysis, [], [], mixed).complete).toBe(false);
  const reviewed = derivePortalInteractionContract(captured, [], undefined, {
    version: 1,
    captureFingerprint: original.captureFingerprint,
    exclusions: original.interactions.map(exclusion),
  });
  const coverage = coverPortalWorkflows(analysis, [], [], reviewed);
  expect(coverage.complete).toBe(true);
  expect(coverage.evidence).toEqual(analysis.evidence);
  expect(coverage.scopes).toMatchObject([
    {
      status: 'covered',
      requirementIds: [],
      evidenceIds: [analysis.unclassifiedInteractions[0]!.evidenceId],
    },
  ]);
  expect(
    coverPortalWorkflows(
      {
        ...analysis,
        issues: [
          { code: 'AMBIGUOUS_WORKFLOW', nodePath: analysis.unclassifiedInteractions[0]!.nodePath },
        ],
      },
      [],
      [],
      reviewed,
    ).complete,
  ).toBe(false);
  const required = {
    id: 'required-journey',
    description: 'Required journey',
    required: true,
    layers: ['frontend' as const],
  };
  expect(
    coverPortalWorkflows(
      {
        ...analysis,
        candidates: [
          {
            kind: 'account-session',
            requirement: required,
            evidenceIds: [analysis.unclassifiedInteractions[0]!.evidenceId],
            interactionIds: [analysis.unclassifiedInteractions[0]!.evidenceId],
          },
        ],
      },
      [required],
      [],
      reviewed,
    ).complete,
  ).toBe(false);
});
it('keeps empty-action reactions blocked instead of declaring a nonexistent action incidental', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  await expect(
    currentCaptureFixture(f, {
      nodes: [
        { id: '1:1', type: 'FRAME', reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [] }] },
      ],
    }),
  ).rejects.toThrow('PORTAL_CAPTURE_CURRENT_REQUIRED');
});
it('invalidates old preview observation identity when selection changes while retaining every root', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const { captured } = await currentCaptureFixture(f, { nodes: nodes() });
  const original = derivePortalInteractionContract(captured, []),
    action = original.interactions[0]!;
  const reviewed = derivePortalInteractionContract(captured, [], undefined, {
    version: 1,
    captureFingerprint: original.captureFingerprint,
    exclusions: [
      {
        interactionId: action.id,
        sourceHash: action.sourceHash,
        reason: 'Owner-declared incidental prototype link',
      },
    ],
  });
  const manifest = (contract: typeof original) =>
    preparePortalObservationManifest(
      captured,
      contract,
      captured.assets.map((asset, index) => ({
        id: `screen-${index}`,
        rootNodeId: 'nodeId' in asset.query ? asset.query.nodeId : '',
        path: '/',
        state: `source:${'nodeId' in asset.query ? asset.query.nodeId : ''}`,
        viewport: { width: 100, height: 100 },
        oraclePath: asset.path!,
        oracleRoot: captured.assetRoot,
        oracleHash: asset.sha256!,
        assertionIds: contract.interactions
          .filter(value => value.rootNodeId === ('nodeId' in asset.query ? asset.query.nodeId : ''))
          .map(value => value.id),
      })),
      [],
    );
  const before = manifest(original),
    after = manifest(reviewed);
  expect(after.screens.map(value => value.rootNodeId)).toEqual(
    before.screens.map(value => value.rootNodeId),
  );
  expect(after.screens).toHaveLength(2);
  expect(before.interactionContractHash).not.toBe(after.interactionContractHash);
  expect(sameObservationIdentity(before.screens[0]!, after.screens[0]!)).toBe(false);
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
  expect(
    derivePortalInteractionContract(motion.captured, []).interactions[0]?.temporal,
  ).toMatchObject({
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
