import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  addNode,
  connectNodes,
  removeNode,
  moveNode,
  workflowInput,
  setPlanField,
  eventCategory,
  applyRequirementsDraft,
  pendingApprovals,
  createGuidedWorkflow,
  figmaScopeUrl,
  startingChecklist,
  decisionReviewContext,
  stageWorkflowDecisions,
  safeActivityMetadata,
  upsertActivities,
  agentHandoffSummary,
} from '../model.js';

const draft = () => ({
  name: 'Draft',
  description: '',
  workspaceId: null,
  revision: 7,
  id: 'wf1',
  plan: { design: { source: 'chrome-page-api', fileKey: '' }, output: {} },
  graph: {
    nodes: [
      { id: 'a', type: 'source', label: 'Source', position: { x: 10, y: 20 }, config: {} },
      {
        id: 'b',
        type: 'requirements',
        label: 'Requirements',
        position: { x: 200, y: 20 },
        config: {},
      },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
});

test('activity metadata excludes raw inputs, credentials and code while retaining known field presence', () => {
  const safe = safeActivityMetadata({
    field: 'designUrl',
    hasValue: true,
    value: 'Bearer synthetic-secret',
    token: 'synthetic-secret',
    headers: { Authorization: 'synthetic-secret' },
    leaseId: 'secret-lease',
    code: 'private code',
    targetPath: 'C:/private',
    figmaFileKey: 'ly06O8jAcrd7oWmwhz5Vr6',
    figmaNodeId: '1378:120',
    view: 'settings',
    changedFields: ['requirements', 'password', 'requirements'],
  });
  assert.deepEqual(safe, {
    field: 'designUrl',
    hasValue: true,
    figmaFileKey: 'ly06O8jAcrd7oWmwhz5Vr6',
    figmaNodeId: '1378:120',
    changedFields: ['requirements'],
    view: 'settings',
  });
  assert.equal(JSON.stringify(safe).includes('synthetic-secret'), false);
  assert.deepEqual(
    safeActivityMetadata({
      nodeId: '../secret',
      errorCode: 'Bearer secret',
      figmaFileKey: 'https://secret',
      step: 'password',
      nodeType: 'fake',
      view: 'fake',
    }),
    {},
  );
});

test('activity settlements replace the same record and reject older observed versions', () => {
  const rows = upsertActivities(
    [
      { id: 'a', sequence: 2, status: 'started' },
      { id: 'b', sequence: 3 },
    ],
    [
      { id: 'a', sequence: 4, status: 'succeeded' },
      { id: 'b', sequence: 1 },
    ],
  );
  assert.deepEqual(rows, [
    { id: 'a', sequence: 4, status: 'succeeded' },
    { id: 'b', sequence: 3 },
  ]);
});

test('function telemetry retains only bounded function/job identifiers and never argument values', () => {
  assert.deepEqual(
    safeActivityMetadata({
      functionType: 'tool',
      functionName: 'get_node',
      jobId: '00000000-0000-4000-8000-000000000001',
      jobAction: 'inspect',
      args: { Authorization: 'synthetic-secret', path: 'C:/private' },
      body: 'private code',
    }),
    {
      functionType: 'tool',
      functionName: 'get_node',
      jobId: '00000000-0000-4000-8000-000000000001',
      jobAction: 'inspect',
    },
  );
  assert.deepEqual(
    safeActivityMetadata({
      functionType: 'shell',
      functionName: 'Bearer synthetic-secret',
      jobId: 'private-session',
      jobAction: 'execute',
    }),
    {},
  );
});

test('agent handoff uses the retained run target instead of a later edited workflow', () => {
  const run = {
    planId: 'plan-old',
    serviceRunId: 'core-old',
    workspaceId: 'space-old',
    context: { runId: 'plan-old', targetPath: 'old-output' },
  };
  assert.equal(agentHandoffSummary(run).targetPath, 'old-output');
  assert.equal(
    agentHandoffSummary({ ...run, context: { runId: 'different', targetPath: 'new-output' } })
      .targetPath,
    null,
  );
  assert.equal(
    agentHandoffSummary({
      ...run,
      context: { runId: 'plan-old', blueprint: { targetPath: 'bound-output' } },
    }).targetPath,
    'bound-output',
  );
});

test('deleting a node removes incident edges while preserving other node configuration', () => {
  const workflow = draft();
  removeNode(workflow, 'a');
  assert.deepEqual(
    workflow.graph.nodes.map(node => node.id),
    ['b'],
  );
  assert.deepEqual(workflow.graph.edges, []);
});

test('connections reject cycles and duplicate edges without silently changing graph', () => {
  const workflow = draft();
  assert.throws(() => connectNodes(workflow, 'b', 'a'), /cycle/);
  assert.throws(() => connectNodes(workflow, 'a', 'b'), /already/);
  assert.equal(workflow.graph.edges.length, 1);
});

test('saved input carries inspector edits and dragged positions without response metadata', () => {
  const workflow = draft();
  setPlanField(workflow, 'design.fileKey', 'figma123');
  moveNode(workflow, 'a', 110, 220);
  const input = workflowInput(workflow);
  assert.equal(input.plan.design.fileKey, 'figma123');
  assert.deepEqual(input.graph.nodes[0].position, { x: 110, y: 220 });
  assert.equal(input.id, undefined);
  assert.equal(input.revision, undefined);
  input.graph.nodes[0].label = 'Mutated copy';
  assert.equal(workflow.graph.nodes[0].label, 'Source');
});

test('adding an optional node does not manufacture a connection or execution result', () => {
  const workflow = draft();
  const node = addNode(workflow, 'validation');
  assert.equal(node.type, 'validation');
  assert.equal(workflow.graph.nodes.length, 3);
  assert.equal(workflow.graph.edges.length, 1);
  assert.equal(node.status, undefined);
});

test('timeline filters read actual service result states and never treat a candidate as completed', () => {
  assert.equal(eventCategory({ type: 'error', data: { code: 'SERVICE_UNAVAILABLE' } }), 'failed');
  assert.equal(eventCategory({ type: 'result', data: { state: 'failed' } }), 'failed');
  assert.equal(eventCategory({ type: 'result', data: { state: 'waiting-agent' } }), 'waiting');
  assert.equal(eventCategory({ type: 'approval-required', data: {} }), 'waiting');
  assert.equal(eventCategory({ type: 'result', data: { state: 'candidate-ready' } }), 'waiting');
  assert.equal(eventCategory({ type: 'result', data: { state: 'completed' } }), 'completed');
  assert.equal(eventCategory({ type: 'result', data: { state: 'cancelled' } }), 'other');
  assert.equal(eventCategory({ type: 'operation', data: {} }), 'other');
});

test('invalid requirement JSON never replaces the last valid plan and valid drafts commit before saving', () => {
  const workflow = draft();
  workflow.plan.requirements = [
    { id: 'original', description: 'Keep this plan', layers: ['frontend'], required: true },
  ];
  assert.throws(() => applyRequirementsDraft(workflow, '[{'), /JSON|property|Unexpected/);
  assert.equal(workflow.plan.requirements[0].description, 'Keep this plan');
  assert.throws(() => applyRequirementsDraft(workflow, '{}'), /JSON/);
  applyRequirementsDraft(
    workflow,
    '[{"id":"edited","description":"Committed JSON","layers":["frontend"],"required":true}]',
  );
  assert.equal(workflowInput(workflow).plan.requirements[0].description, 'Committed JSON');
});

test('approval choices retain only current-operation unexpired prompt IDs', () => {
  const run = {
    operationId: 'current-operation',
    approvals: [
      { approvalId: 'expired', operationId: 'current-operation', expiresAt: 99 },
      { approvalId: 'foreign', operationId: 'other-operation', expiresAt: 200 },
      { approvalId: 'selected', operationId: 'current-operation', expiresAt: 200 },
    ],
  };
  assert.deepEqual(
    pendingApprovals(run, 100).map(prompt => prompt.approvalId),
    ['selected'],
  );
  assert.deepEqual(pendingApprovals({ ...run, operationId: null }, 100), []);
});

const setupInput = () => ({
  name: 'My first screen',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  figmaUrl: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/Example',
  nodeId: '1378:120',
  case: 'new-blank',
  targetPath: 'generated/first-screen',
  description: 'Visitors choose a language and see the selected language.',
  roles: 'visitor',
  states: 'default\nselected',
  routes: '/',
  layers: ['frontend'],
  confirmed: true,
});

test('guided setup creates an explicit user-confirmed draft without copying execution metadata', () => {
  const original = draft();
  const workflow = createGuidedWorkflow(original, setupInput());
  assert.equal(workflow.id, undefined);
  assert.equal(workflow.revision, undefined);
  assert.equal(workflow.plan.design.source, 'chrome');
  assert.equal(new URL(workflow.plan.design.url).searchParams.get('node-id'), '1378:120');
  assert.equal(workflow.plan.targetPath, 'generated/first-screen');
  assert.equal(workflow.plan.requirements[0].workflow.status, 'confirmed');
  assert.deepEqual(workflow.plan.requirements[0].workflow.states, ['default', 'selected']);
  assert.deepEqual(workflow.plan.workflowDecisions, []);
  assert.equal(original.id, 'wf1');
  const waiting = createGuidedWorkflow(original, { ...setupInput(), confirmed: false });
  assert.equal(waiting.plan.requirements[0].workflow, undefined);
});

test('guided setup rejects URL/output confusion, missing node and unsupported no-reference backend scope', () => {
  assert.throws(
    () =>
      createGuidedWorkflow(draft(), {
        ...setupInput(),
        targetPath: 'https://www.figma.com/design/abc',
      }),
    /상대/,
  );
  assert.throws(() => figmaScopeUrl('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS'), /노드/);
  assert.throws(
    () => figmaScopeUrl('https://attacker.example/design/4IBhv1d8hEclifZQrOYxHS', '0:1'),
    /Figma/,
  );
  assert.throws(
    () => createGuidedWorkflow(draft(), { ...setupInput(), layers: ['frontend', 'backend'] }),
    /프론트엔드/,
  );
  assert.throws(() => createGuidedWorkflow(draft(), { ...setupInput(), roles: '' }), /역할/);
});

test('editing preserves original requirement IDs, other requirements and unedited data contracts', () => {
  const source = createGuidedWorkflow(draft(), {
    ...setupInput(),
    requirementId: 'language-selection',
    decisionEvidence: 'The owner explicitly confirmed local locale storage.',
  });
  source.id = 'wf1';
  source.revision = 7;
  source.plan.requirements[0].workflow.dataContracts = [
    'Store selected locale\nwithout sending it to a server',
  ];
  source.plan.requirements.push({
    id: 'other',
    description: 'Other confirmed scope',
    layers: ['frontend'],
    required: true,
  });
  const edited = createGuidedWorkflow(source, {
    ...setupInput(),
    mode: 'edit',
    requirementId: 'language-selection',
    roles: undefined,
    states: undefined,
    routes: undefined,
    confirmed: false,
  });
  assert.equal(edited.id, 'wf1');
  assert.equal(edited.revision, 7);
  assert.deepEqual(
    edited.plan.requirements[0].workflow.dataContracts,
    source.plan.requirements[0].workflow.dataContracts,
  );
  assert.deepEqual(edited.plan.requirements[1], source.plan.requirements[1]);
  assert.equal(edited.plan.requirements[0].workflow.status, 'draft');
  assert.equal(
    edited.plan.requirements[0].workflow.decisions[0].evidence,
    source.plan.requirements[0].workflow.decisions[0].evidence,
  );
  assert.throws(
    () =>
      createGuidedWorkflow(source, {
        ...setupInput(),
        mode: 'edit',
        addRequirement: true,
        requirementId: 'language-selection',
      }),
    /이미/,
  );
});

test('readiness checklist separates daemon connection, capture and explicit confirmation', () => {
  const workflow = createGuidedWorkflow(draft(), { ...setupInput(), confirmed: false });
  const checklist = startingChecklist(workflow, {
    service: { available: true, readiness: { browserConnection: 'not-requested' } },
    workspaces: [{ workspaceId: workflow.workspaceId }],
  });
  assert.equal(checklist.find(item => item.key === 'service').done, true);
  assert.equal(checklist.find(item => item.key === 'requirements').done, false);
  assert.equal(checklist.find(item => item.key === 'save').done, false);
  for (const availability of ['identity-mismatch', 'missing', 'access-denied'])
    assert.equal(
      startingChecklist(workflow, {
        workspaces: [{ workspaceId: workflow.workspaceId, availability }],
      }).find(item => item.key === 'workspace').done,
      false,
    );
});

const reviewFixture = () => {
  const workflow = createGuidedWorkflow(draft(), {
    ...setupInput(),
    requirementId: 'language-selection',
  });
  workflow.id = 'wf1';
  workflow.revision = 7;
  const planId = 'sfp_portal1_' + 'a'.repeat(32),
    hash = 'sha256:' + 'b'.repeat(64);
  const run = {
    id: 'run1',
    workflowId: 'wf1',
    planId,
    context: {
      planId,
      design: { complete: true, liveVerified: true },
      workflowCoverage: {
        version: 1,
        analysisHash: hash,
        evidence: [
          {
            id: 'observed-select',
            kind: 'design',
            hash: 'sha256:' + 'c'.repeat(64),
            labels: ['Select'],
          },
        ],
        scopes: [{ id: 'observed-select', status: 'unresolved', evidenceIds: ['observed-select'] }],
        decisions: [],
      },
    },
  };
  const choice = {
    evidenceId: 'observed-select',
    requirementIds: ['language-selection'],
    decision: 'implement',
    rationale: 'This actual captured selector is the confirmed local language control.',
  };
  return { workflow, run, hash, choice };
};

test('observed workflow decisions stage exact hash/ID bindings into draft and preserve the original run', () => {
  const { workflow, run, hash, choice } = reviewFixture();
  const before = structuredClone(run);
  const updated = stageWorkflowDecisions(workflow, run, hash, [choice]);
  assert.deepEqual(updated.plan.workflowDecisions, [{ analysisHash: hash, ...choice }]);
  assert.equal(updated.plan.targetPath, workflow.plan.targetPath);
  assert.deepEqual(workflow.plan.workflowDecisions, []);
  assert.deepEqual(run, before);
});

test('decision editing rejects incomplete capture, stale hash, foreign IDs and unconfirmed requirements', () => {
  const { workflow, run, hash, choice } = reviewFixture();
  assert.throws(
    () => stageWorkflowDecisions(workflow, run, 'sha256:' + 'e'.repeat(64), [choice]),
    /변경/,
  );
  assert.throws(
    () => stageWorkflowDecisions(workflow, run, hash, [{ ...choice, evidenceId: 'invented' }]),
    /실제/,
  );
  assert.throws(
    () => stageWorkflowDecisions(workflow, run, hash, [{ ...choice, decision: 'exclude' }]),
    /실제/,
  );
  workflow.plan.requirements[0].workflow.status = 'draft';
  assert.throws(() => stageWorkflowDecisions(workflow, run, hash, [choice]), /확인/);
  run.context.design.complete = false;
  assert.equal(decisionReviewContext(run, workflow).available, false);
  assert.equal(
    decisionReviewContext({ ...run, context: { planId: run.planId } }, workflow).available,
    false,
  );
});
