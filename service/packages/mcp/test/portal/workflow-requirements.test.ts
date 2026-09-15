import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import {
  analyzePortalWorkflows,
  inferPortalWorkflows,
} from '../../src/portal/workflow-requirements.js';
it('requires real service behavior for commerce designs in operational cases', () => {
  const requirements = inferPortalWorkflows(
    {
      nodes: [
        { id: '1:1', name: 'Checkout', children: [{ id: '1:2', characters: 'Place order' }] },
      ],
    },
    'operational-portal',
  );
  expect(requirements).toContainEqual(
    expect.objectContaining({
      id: 'figma-commerce-checkout',
      required: true,
      layers: expect.arrayContaining(['frontend', 'backend', 'api', 'database', 'authorization']),
    }),
  );
});
it('keeps the same checkout design frontend-only with honest demo state in C4', () => {
  const requirements = inferPortalWorkflows(
    { nodes: [{ id: '1:1', name: 'Checkout' }] },
    'frontend-only',
  );
  expect(requirements[0]).toMatchObject({
    layers: ['frontend'],
    description: expect.stringContaining('local demo state'),
  });
});
it('does not invent commerce workflows when no matching design evidence was captured', () => {
  expect(inferPortalWorkflows(null, 'operational-portal')).toEqual([]);
  expect(
    inferPortalWorkflows(
      { nodes: [{ id: '1:1', name: 'Cartoon illustration' }] },
      'operational-portal',
    ),
  ).toEqual([]);
});

const click = [
  { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: 'error' }] },
];
const button = (id: string, name: string) => ({
  id,
  type: 'FRAME',
  name: 'Button',
  reactions: click,
  children: [{ id: `${id}:text`, type: 'TEXT', characters: name }],
});

it('infers draft document and task mutation requirements from nested controls', () => {
  const result = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'root',
          type: 'FRAME',
          name: 'Documents',
          children: [
            button('create', 'Create document'),
            button('edit', 'Edit document'),
            button('task', 'Create task'),
          ],
        },
      ],
    },
    'operational-portal',
  );
  expect(result.candidates.map(item => item.kind)).toEqual(
    expect.arrayContaining(['document-create', 'document-edit', 'task-create']),
  );
  expect(result.candidates.every(item => item.requirement.workflow?.status === 'draft')).toBe(true);
  expect(
    result.candidates.find(item => item.kind === 'document-create')?.requirement.layers,
  ).toEqual(expect.arrayContaining(['frontend', 'backend', 'api', 'database']));
  expect(result.candidates.every(item => item.evidenceIds.length > 0)).toBe(true);
  expect(result.interactionCoverage).toBe('draft');
});

it('does not invent authentication or database for a readonly dashboard and search control', () => {
  const result = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'dashboard',
          name: 'Dashboard',
          children: [
            button('search', 'Search'),
            { id: 'total', type: 'TEXT', characters: 'Active users: 42' },
          ],
        },
      ],
    },
    'operational-portal',
  );
  expect(result.candidates.map(item => item.kind)).toEqual(
    expect.arrayContaining(['read-dashboard', 'search-filter']),
  );
  expect(
    result.candidates.every(item => item.requirement.layers.every(layer => layer === 'frontend')),
  ).toBe(true);
});

it('links form submission and failure states without declaring verified contracts', () => {
  const result = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'form',
          type: 'FRAME',
          name: 'Contact form',
          children: [
            { id: 'email', type: 'INPUT', name: 'Email' },
            button('submit', 'Submit'),
            { id: 'error', type: 'TEXT', characters: 'Email is required' },
          ],
        },
      ],
    },
    'operational-portal',
  );
  const form = result.candidates.find(item => item.kind === 'form-submit');
  expect(form?.requirement.workflow?.states).toContain('validation-error');
  expect(form?.requirement.layers).toEqual(expect.arrayContaining(['frontend', 'api', 'backend']));
  expect(form?.requirement.workflow?.apiContracts).toEqual([]);
});

it('requires source-bound configured integration hints and rejects corrupt source evidence', () => {
  const design = {
    nodes: [{ id: 'settings', name: 'Integrations', children: [button('sync', 'Sync calendar')] }],
  };
  const text = `export const integration = 'calendar';`;
  const hint = {
    kind: 'configured-integration' as const,
    sourceId: 'reference:0',
    path: 'src/integrations.ts',
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    text,
    designNodeIds: ['sync'],
  };
  const result = analyzePortalWorkflows(design, 'operational-portal', { sourceHints: [hint] });
  expect(
    result.candidates.find(item => item.kind === 'configured-integration')?.requirement.layers,
  ).toContain('integration');
  expect(
    result.evidence.some(item => item.kind === 'source' && item.sourceId === 'reference:0'),
  ).toBe(true);
  expect(
    analyzePortalWorkflows(design, 'operational-portal').unclassifiedInteractions,
  ).toHaveLength(1);
  expect(
    analyzePortalWorkflows(design, 'operational-portal', {
      sourceHints: [{ ...hint, hash: 'sha256:wrong' }],
    }).issues.some(item => item.code === 'SOURCE_HASH_MISMATCH'),
  ).toBe(true);
});

it('retains unmatched required interactions and avoids prose-only mutation inference', () => {
  const unknown = analyzePortalWorkflows(
    { nodes: [button('unknown', 'Launch wonder')] },
    'operational-portal',
  );
  expect(unknown.unclassifiedInteractions).toHaveLength(1);
  expect(unknown.interactionCoverage).toBe('incomplete');
  const marketing = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'home',
          name: 'Home',
          children: [
            {
              id: 'copy',
              type: 'TEXT',
              characters: 'Create your future with our document tools. Save money today.',
            },
            { id: 'save', type: 'TEXT', characters: 'Save' },
          ],
        },
      ],
    },
    'operational-portal',
  );
  expect(marketing.candidates).toEqual([]);
});

it('records duplicate/missing IDs and finite traversal without spreading wide child arrays', () => {
  const invalid = analyzePortalWorkflows(
    {
      nodes: [
        { name: 'Dashboard' },
        button('same', 'Create document'),
        button('same', 'Edit document'),
      ],
    },
    'operational-portal',
  );
  expect(invalid.issues.map(item => item.code)).toEqual(
    expect.arrayContaining(['MISSING_NODE_ID', 'DUPLICATE_NODE_ID']),
  );
  const wide = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'root',
          name: 'Dashboard',
          children: Array.from({ length: 80_000 }, (_, i) => ({ id: `n${i}`, name: 'Text' })),
        },
      ],
    },
    'operational-portal',
    { limits: { maxNodes: 100 } },
  );
  expect(wide.issues.some(item => item.code === 'NODE_LIMIT')).toBe(true);
  expect(wide.analysisComplete).toBe(false);
});

it('keeps every C4 candidate frontend-only and hashes observations deterministically', () => {
  const design = {
    nodes: [
      {
        id: 'root',
        name: 'Documents',
        children: [button('create', 'Create document'), button('checkout', 'Place order')],
      },
    ],
  };
  const result = analyzePortalWorkflows(design, 'frontend-only');
  expect(result.candidates.every(item => item.requirement.layers.join() === 'frontend')).toBe(true);
  expect(result.analysisHash).toBe(analyzePortalWorkflows(design, 'frontend-only').analysisHash);
  expect(result.candidates.every(item => item.requirement.workflow?.status === 'draft')).toBe(true);
});

it('reports null, empty and cyclic captures without serializing the raw object', () => {
  expect(analyzePortalWorkflows(null, 'operational-portal').analysisComplete).toBe(false);
  expect(analyzePortalWorkflows({ nodes: [] }, 'operational-portal').analysisComplete).toBe(false);
  const cyclic: Record<string, unknown> = { id: 'root', name: 'Dashboard' };
  cyclic.children = [cyclic];
  const result = analyzePortalWorkflows({ nodes: [cyclic] }, 'operational-portal');
  expect(result.issues.some(item => item.code === 'CYCLIC_OR_SHARED_NODE')).toBe(true);
  expect(result.analysisHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
});

it('does not infer persistence from marketing ancestors or hide conflicting control labels', () => {
  const marketing = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'root',
          name: 'Create documents and save money today',
          children: [button('save', 'Save')],
        },
      ],
    },
    'operational-portal',
  );
  expect(marketing.candidates).toEqual([]);
  expect(marketing.unclassifiedInteractions).toHaveLength(1);
  const ambiguous = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'root',
          name: 'Documents',
          children: [
            { id: 'control', type: 'BUTTON', name: 'Create document', characters: 'Edit document' },
          ],
        },
      ],
    },
    'operational-portal',
  );
  expect(ambiguous.issues.some(item => item.code === 'AMBIGUOUS_WORKFLOW')).toBe(true);
  expect(ambiguous.unclassifiedInteractions).toHaveLength(1);
});

it('keeps generic settings changes and source-backed remote dashboard data draft', () => {
  const design = {
    nodes: [
      { id: 'root', name: 'Settings', children: [button('save', 'Save changes')] },
      { id: 'dashboard', name: 'Dashboard' },
    ],
  };
  const text = `export const load = () => fetch('/metrics');`;
  const result = analyzePortalWorkflows(design, 'operational-portal', {
    sourceHints: [
      {
        sourceId: 'reference:1',
        path: 'metrics.ts',
        text,
        hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
        kind: 'read-api',
        designNodeIds: ['dashboard'],
      },
    ],
  });
  expect(
    result.candidates.find(item => item.kind === 'settings-update')?.requirement.workflow?.status,
  ).toBe('draft');
  expect(
    result.candidates.find(item => item.kind === 'read-dashboard')?.requirement.layers,
  ).toEqual(expect.arrayContaining(['frontend', 'api', 'backend']));
  expect(
    result.candidates.find(item => item.kind === 'read-dashboard')?.requirement.layers,
  ).not.toContain('database');
});

it('rejects conflicting source snapshots and reports retained evidence limits', () => {
  const design = { nodes: [{ id: 'dashboard', name: 'Dashboard' }] };
  const hints = ['export const version = 1;', 'export const version = 2;'].map(text => ({
    sourceId: 'reference:0',
    path: 'metrics.ts',
    text,
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    kind: 'read-api' as const,
    designNodeIds: ['dashboard'],
  }));
  const conflict = analyzePortalWorkflows(design, 'operational-portal', { sourceHints: hints });
  expect(conflict.issues.some(item => item.code === 'SOURCE_HINT_CONFLICT')).toBe(true);
  expect(conflict.candidates[0]?.requirement.layers).toEqual(['frontend']);
  const bounded = analyzePortalWorkflows(
    { nodes: [{ id: 'root', name: 'Documents', children: [button('create', 'Create document')] }] },
    'operational-portal',
    { limits: { maxEvidence: 1 } },
  );
  expect(bounded.evidence).toHaveLength(1);
  expect(bounded.issues.some(item => item.code === 'EVIDENCE_LIMIT')).toBe(true);
  expect(bounded.interactionCoverage).toBe('incomplete');
});

it('binds the exact child action label to its workflow and keeps interaction identity on the control', () => {
  const result = analyzePortalWorkflows(
    { nodes: [button('create', 'Create document')] },
    'operational-portal',
  );
  const label = result.evidence.find(item => item.nodeId === 'create:text')!;
  const control = result.evidence.find(item => item.nodeId === 'create')!;
  const candidate = result.candidates.find(item => item.kind === 'document-create')!;
  expect(candidate.evidenceIds).toContain(label.id);
  expect(candidate.interactionIds).toEqual([control.id]);
  expect(
    candidate.requirement.workflow?.decisions.every(item => item.evidence.includes(label.id)),
  ).toBe(true);
});

it('reports control-label interpretation limits instead of hiding later conflicts', () => {
  const children = Array.from({ length: 33 }, (_, index) => ({
    id: `label${index}`,
    type: 'TEXT',
    characters: index === 0 ? 'Create document' : index === 32 ? 'Edit document' : `Label ${index}`,
  }));
  const result = analyzePortalWorkflows(
    { nodes: [{ id: 'control', type: 'BUTTON', name: 'Button', children }] },
    'operational-portal',
  );
  expect(result.issues.some(item => item.code === 'CONTROL_LABEL_LIMIT')).toBe(true);
  expect(result.analysisComplete).toBe(false);
  expect(result.unclassifiedInteractions.some(item => item.nodeId === 'control')).toBe(true);
});

it('reports sibling-state interpretation limits and retains the affected control as uncertain', () => {
  const siblings = Array.from({ length: 128 }, (_, index) => ({
    id: `sibling${index}`,
    type: 'TEXT',
    characters: index === 127 ? 'Submission failed' : `Text ${index}`,
  }));
  const form = analyzePortalWorkflows(
    {
      nodes: [
        { id: 'form', name: 'Contact form', children: [button('submit', 'Submit'), ...siblings] },
      ],
    },
    'operational-portal',
  );
  expect(form.issues.some(item => item.code === 'SIBLING_CONTEXT_LIMIT')).toBe(true);
  expect(form.interactionCoverage).toBe('incomplete');
  expect(form.unclassifiedInteractions.some(item => item.nodeId === 'submit')).toBe(true);
});

it.each([
  { outer: 'Documents', inner: 'Task editor', expected: 'task-edit' },
  { outer: 'Tasks', inner: 'Document editor', expected: 'document-edit' },
])(
  'uses nearest specific mutation context inside $outer / $inner',
  ({ outer, inner, expected }) => {
    const result = analyzePortalWorkflows(
      {
        nodes: [
          {
            id: 'outer',
            name: outer,
            children: [{ id: 'inner', name: inner, children: [button('save', 'Save')] }],
          },
        ],
      },
      'operational-portal',
    );
    expect(result.candidates.map(item => item.kind)).toEqual([expected]);
  },
);

it('retains same-level mutation ambiguity and honors nearer settings context', () => {
  const ambiguous = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'editor',
          name: 'Task editor',
          characters: 'Document editor',
          children: [button('save', 'Save')],
        },
      ],
    },
    'operational-portal',
  );
  expect(ambiguous.issues.some(item => item.code === 'AMBIGUOUS_MUTATION_CONTEXT')).toBe(true);
  expect(ambiguous.unclassifiedInteractions.some(item => item.nodeId === 'save')).toBe(true);
  expect(ambiguous.candidates).toEqual([]);
  const settings = analyzePortalWorkflows(
    {
      nodes: [
        {
          id: 'outer',
          name: 'Documents',
          children: [{ id: 'inner', name: 'Settings', children: [button('save', 'Save')] }],
        },
      ],
    },
    'operational-portal',
  );
  expect(settings.candidates.map(item => item.kind)).toEqual(['settings-update']);
});
