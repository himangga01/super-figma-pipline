import { expect, it } from 'vitest';

import {
  safeRunnerFailure,
  selectOwnedPortalPage,
  validateDecisionReceipt,
} from './live-usage-check.mjs';

const analysisHash = `sha256:${'a'.repeat(64)}`;
const evidenceId = `design-${'b'.repeat(64)}`;
const workflow = {
  id: 'workflow',
  plan: { requirements: [{ id: 'required-1', required: true, workflow: { status: 'confirmed' } }] },
};
const run = {
  workflowId: 'workflow',
  planId: 'plan',
  serviceRunId: 'plan',
  context: {
    planId: 'plan',
    design: { complete: true, liveVerified: true },
    workflowCoverage: {
      analysisHash,
      scopes: [{ status: 'unresolved', evidenceIds: [evidenceId] }],
    },
  },
};
const receipt = {
  analysisHash,
  decisions: [
    {
      evidenceId,
      requirementIds: ['required-1'],
      decision: 'implement',
      rationale: 'Explicit product requirement reviewed against the current captured evidence.',
    },
  ],
};

const browser = pages => ({ contexts: () => [{ pages: () => pages }] });
it('retains assertion source locations without copying private endpoints or full stacks', () => {
  const failure = new Error('A check failed with synthetic-private-value');
  failure.stack =
    'Error: synthetic-private-value\n at runUsage (file:///private/path/live-usage-check.mjs:1210:18)\n at unrelated (file:///private/session.js:10:2)';
  expect(safeRunnerFailure(failure, ['synthetic-private-value'])).toEqual({
    message: 'A check failed with [redacted]',
    locations: ['live-usage-check.mjs:1210:18'],
  });
});
it('reuses exactly the existing portal tab and refuses missing or ambiguous ownership', () => {
  const portal = { url: () => 'http://127.0.0.1:4310/' };
  const figma = { url: () => 'https://www.figma.com/design/example' };
  expect(selectOwnedPortalPage(browser([figma, portal]), 'http://127.0.0.1:4310')).toBe(portal);
  expect(() => selectOwnedPortalPage(browser([figma]), 'http://127.0.0.1:4310')).toThrow(
    /exactly one existing portal tab/u,
  );
  expect(() => selectOwnedPortalPage(browser([portal, portal]), 'http://127.0.0.1:4310')).toThrow(
    /exactly one existing portal tab/u,
  );
});

it('accepts actual design-prefixed evidence IDs bound to the current analysis and required scope', () => {
  expect(validateDecisionReceipt(receipt, run, workflow)).toEqual(receipt.decisions);
});

it('still rejects stale analysis, foreign or duplicate evidence, missing rows and unconfirmed requirements', () => {
  for (const change of [
    value => {
      value.analysisHash = `sha256:${'c'.repeat(64)}`;
    },
    value => {
      value.decisions[0].evidenceId = `design-${'d'.repeat(64)}`;
    },
    value => {
      value.decisions.push(value.decisions[0]);
    },
    value => {
      value.decisions = [];
    },
    value => {
      value.decisions[0].requirementIds = ['foreign'];
    },
  ]) {
    const changed = structuredClone(receipt);
    change(changed);
    expect(() => validateDecisionReceipt(changed, run, workflow)).toThrow(/.+/u);
  }
  expect(() =>
    validateDecisionReceipt(receipt, run, { ...workflow, plan: { requirements: [] } }),
  ).toThrow(/.+/u);
});

it('matches the shared one-to-256-character evidence ID constraint without relaxing current-set binding', () => {
  for (const id of ['', 'x'.repeat(257)]) {
    const changedRun = structuredClone(run),
      changedReceipt = structuredClone(receipt);
    changedRun.context.workflowCoverage.scopes[0].evidenceIds = [id];
    changedReceipt.decisions[0].evidenceId = id;
    expect(() => validateDecisionReceipt(changedReceipt, changedRun, workflow)).toThrow(/.+/u);
  }
});
