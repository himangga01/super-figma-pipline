// Fresh eCommerce preparation R6 with the instrumented daemon. It never reuses or replays the R3/R4
// operations: it issues a new operation, uses a new context folder and a new unused target.
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ControlClient } from '../packages/cli/dist/library.mjs';

const previous = '../../_cache/ecommerce-service-context-20261004-prep-r2';
const folder = '../../_cache/ecommerce-service-context-20261004-prep-r6';
const workspace = resolve('../../_cache/cdd-service-outputs');
const targetPath = 'ecommerce-chrome-preparation-20261004-r6';
for (const path of [folder, resolve(workspace, targetPath)])
  if (
    await stat(path).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })
  )
    throw Error('Preserve existing context and target');
const p = JSON.parse(await readFile(previous + '/plan.json', 'utf8'));
const design = JSON.parse(await readFile(previous + '/reference-tree.json', 'utf8'));
const nodes = new Map();
const visit = (node, root) => {
  nodes.set(node.id, { node, root });
  for (const child of node.children ?? []) visit(child, root);
};
design.nodes.forEach(root => visit(root, root));
const define = (id, description, states, routes, dataContracts = []) => ({
  id,
  description,
  layers: ['frontend'],
  required: true,
  workflow: {
    status: 'confirmed',
    roles: ['visitor'],
    states,
    routes,
    apiContracts: [],
    dataContracts,
    decisions: [
      {
        layer: 'frontend',
        action: 'implement',
        evidence:
          'The owner requires a new frontend without reference frontend code. Implement the captured eCommerce screens and interactions using honest local demo state, without claiming a real order, payment, account or message delivery.',
      },
    ],
  },
});
const requirements = [
  define(
    'figma-commerce-catalog',
    'Render the captured Home, Shop, Single Product and Product Comparison screens; support local product browsing, filtering, sorting, pagination, product selection and comparison, with source navigation retained.',
    ['catalog', 'filtered', 'empty-results', 'product-detail', 'comparison'],
    ['/', '/shop', '/product', '/comparison'],
    [
      'Use only captured product data and original assets; locally derive filtered lists and comparison selections.',
    ],
  ),
  define(
    'figma-commerce-cart',
    'Implement captured add-to-cart controls, cart sidebar and Cart screen, quantity changes, removal, subtotal calculation and navigation to checkout using frontend demo state.',
    ['empty', 'sidebar-open', 'cart-populated', 'quantity-changed', 'item-removed'],
    ['/cart'],
    [
      'Store only local demo product IDs and quantities; validate quantities and derive totals from captured prices.',
    ],
  ),
  define(
    'figma-commerce-checkout',
    'Render captured Checkout, validate required billing fields, expose captured payment choices and show an explicit local demo confirmation without sending payment or billing data.',
    ['editing', 'invalid', 'valid', 'demo-confirmed'],
    ['/checkout'],
    [
      'Keep billing inputs in memory; perform no external payment, order creation or personal-data persistence.',
    ],
  ),
  define(
    'figma-contact-demo',
    'Render captured Contact content and form with accessible local validation and an explicit local demo result.',
    ['editing', 'invalid', 'demo-confirmed'],
    ['/contact'],
    ['Keep contact inputs in memory and do not transmit messages.'],
  ),
  define(
    'figma-content-navigation',
    'Render captured Blog, navigation and footer content; implement local blog filtering/pagination and newsletter validation where corresponding controls appear, with explicit demo-only outcomes.',
    ['browse', 'filtered', 'empty-results', 'newsletter-invalid', 'newsletter-demo-confirmed'],
    ['/blog', '/contact', '/'],
    ['Use captured content only; do not imply remote subscription or delivery.'],
  ),
];
const candidates = new Set(requirements.map(r => r.id));
const unresolved = new Set(
  p.workflowCoverage.scopes.filter(s => s.status === 'unresolved').flatMap(s => s.evidenceIds),
);
const workflowDecisions = p.workflowCoverage.evidence
  .filter(e => unresolved.has(e.id))
  .map(e => {
    const entry = nodes.get(e.nodeId);
    if (!entry) throw Error('Missing evidence node');
    const destinations = new Set(
      p.interactionContract.interactions
        .filter(i => i.sourceNodeId === e.nodeId)
        .map(i => i.destinationNodeId),
    );
    const ids = new Set();
    for (const id of destinations) {
      if (['117:960', '117:1259'].includes(id)) ids.add('figma-commerce-cart');
      else if (id === '117:1143') ids.add('figma-commerce-checkout');
      else ids.add('figma-commerce-catalog');
    }
    if (!ids.size) {
      const root = entry.root.id;
      ids.add(
        ['117:960', '117:1259'].includes(root)
          ? 'figma-commerce-cart'
          : root === '117:1143'
            ? 'figma-commerce-checkout'
            : root === '63:107'
              ? 'figma-contact-demo'
              : root === '71:2'
                ? 'figma-content-navigation'
                : 'figma-commerce-catalog',
      );
    }
    if ([...ids].some(id => !candidates.has(id))) throw Error('Unknown requirement');
    return {
      analysisHash: p.workflowCoverage.analysisHash,
      evidenceId: e.id,
      requirementIds: [...ids],
      decision: 'implement',
      rationale: `Implement the captured ${entry.root.name.trim()} control ${e.labels.join(' / ').slice(0, 200)} (${e.nodeId}) within the declared local frontend workflow. Retain its captured click destinations and all source visual/interaction obligations; this decision excludes no node or asset.`,
    };
  });
if (workflowDecisions.length !== 89) throw Error('Recheck the recorded unresolved scope');
const request = {
  case: 'new-blank',
  targetPath,
  references: [],
  design: {
    url: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
    source: 'chrome',
    freshness: 'require-live',
  },
  stack: 'react-vite',
  requirements,
  workflowDecisions,
};
await mkdir(folder, { recursive: true });
await writeFile(folder + '/request.json', JSON.stringify(request, null, 2) + '\n');
const client = new ControlClient();
const workspaceId = await client.workspace(workspace);
let operationId = null;
const progress = value => {
  if (typeof value?.operationId === 'string') operationId = value.operationId;
  if (typeof value?.status === 'string')
    appendFileSync(
      folder + '/progress.jsonl',
      JSON.stringify({
        recordedAt: new Date().toISOString(),
        status: value.status,
        operationId: value.operationId ?? null,
        requestId: value.requestId ?? null,
      }) + '\n',
    );
};
const savePublicStatus = async () => {
  if (operationId === null) return;
  // One read of this operation's public record; never a replay of its effects.
  const record = await client
    .request(`/control/operations/${encodeURIComponent(operationId)}`)
    .catch(error => ({ readError: error.message, code: error.code ?? null }));
  await writeFile(folder + '/public-operation-status.json', JSON.stringify(record, null, 2) + '\n');
};
try {
  const plan = await client.invoke({
    name: 'portal_plan',
    kind: 'tool',
    args: request,
    workspaceId,
    targetSelector: { kind: 'none' },
    approve: true,
    captureResult: true,
    timeoutMs: 600000,
    emit: progress,
  });
  await writeFile(folder + '/plan.json', JSON.stringify(plan, null, 2) + '\n');
  const result = {
    recordedAt: new Date().toISOString(),
    purpose: 'Preparation only; no generation, submission, application or frontend acceptance.',
    planId: plan.planId,
    complete: plan.design.complete,
    liveVerified: plan.design.liveVerified,
    workflowComplete: plan.workflowCoverage.complete,
    workflowIssues: plan.workflowCoverage.issues,
    issues: plan.issues,
    requirements: plan.requirements.map(r => ({ id: r.id, status: r.workflow?.status })),
    targetCreated: !!(await stat(resolve(workspace, targetPath)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })),
  };
  await writeFile(folder + '/summary.json', JSON.stringify(result, null, 2) + '\n');
  await savePublicStatus();
  console.log(JSON.stringify(result));
} catch (error) {
  const result = {
    recordedAt: new Date().toISOString(),
    message: error.message,
    code: error.code ?? null,
    status: error.status ?? null,
    operationId,
  };
  await writeFile(folder + '/failure.json', JSON.stringify(result, null, 2) + '\n');
  await savePublicStatus().catch(() => undefined);
  console.error(JSON.stringify(result));
  process.exitCode = 1;
}
