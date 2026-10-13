export const nodeTypes = {
  source: { label: 'Figma 소스', subtitle: '디자인 수집', icon: 'figma', color: 'blue' },
  requirements: {
    label: '요구사항 분석',
    subtitle: '범위와 구현 계획',
    icon: 'layers',
    color: 'violet',
  },
  generation: { label: '코드 생성', subtitle: '코딩 에이전트 작업', icon: 'code', color: 'amber' },
  validation: { label: '검증', subtitle: '후보와 적용 결과 확인', icon: 'check', color: 'green' },
  output: { label: '결과 및 적용', subtitle: '검토 후 보호된 적용', icon: 'box', color: 'slate' },
};

export function addNode(workflow, type) {
  if (!nodeTypes[type]) throw new Error('Unknown node type');
  const node = {
    id: `${type}-${globalThis.crypto.randomUUID()}`,
    type,
    label: nodeTypes[type].label,
    position: {
      x: 320 + (workflow.graph.nodes.length % 3) * 280,
      y: 140 + Math.floor(workflow.graph.nodes.length / 3) * 190,
    },
    config: {},
  };
  workflow.graph.nodes.push(node);
  return node;
}

export function connectNodes(workflow, source, target) {
  const { nodes, edges } = workflow.graph;
  if (
    source === target ||
    !nodes.some(node => node.id === source) ||
    !nodes.some(node => node.id === target)
  )
    throw new Error('Select two different nodes');
  if (edges.some(edge => edge.source === source && edge.target === target))
    throw new Error('Connection already exists');
  const visit = (id, seen = new Set()) => {
    if (id === source) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return edges.filter(edge => edge.source === id).some(edge => visit(edge.target, seen));
  };
  if (visit(target)) throw new Error('Connection would create a cycle');
  edges.push({ id: globalThis.crypto.randomUUID(), source, target });
}

export function removeNode(workflow, id) {
  workflow.graph.nodes = workflow.graph.nodes.filter(node => node.id !== id);
  workflow.graph.edges = workflow.graph.edges.filter(
    edge => edge.source !== id && edge.target !== id,
  );
}

export function moveNode(workflow, id, x, y) {
  const node = workflow.graph.nodes.find(item => item.id === id);
  if (node && Number.isFinite(x) && Number.isFinite(y))
    node.position = { x: Math.round(x), y: Math.round(y) };
}

export function workflowInput(workflow) {
  return structuredClone({
    name: workflow.name,
    description: workflow.description,
    workspaceId: workflow.workspaceId,
    plan: workflow.plan,
    graph: workflow.graph,
  });
}

export function setPlanField(workflow, path, value) {
  const parts = path.split('.');
  if (parts.some(part => ['__proto__', 'constructor', 'prototype'].includes(part)))
    throw new Error('Invalid field');
  let target = workflow.plan;
  for (const part of parts.slice(0, -1)) target = target[part] ??= {};
  const key = parts.at(-1);
  if (value === undefined) delete target[key];
  else target[key] = value;
}

export function eventCategory(event) {
  const state = event.data?.state ?? event.data?.status ?? event.type;
  if (event.type === 'error' || ['failed', 'outcome-unknown', 'conflict'].includes(state))
    return 'failed';
  if (state === 'completed') return 'completed';
  if (
    [
      'needs-input',
      'waiting-agent',
      'generating',
      'candidate-ready',
      'ready-to-apply',
      'applied-awaiting-validation',
      'blocked',
      'planned',
      'approval-required',
    ].includes(state)
  )
    return 'waiting';
  return 'other';
}

export function applyRequirementsDraft(workflow, text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('요구사항은 JSON 배열이어야 합니다.');
  workflow.plan.requirements = data;
}

export function pendingApprovals(run, now = Date.now()) {
  if (!run?.operationId) return [];
  return (run.approvals ?? []).filter(
    prompt =>
      typeof prompt.approvalId === 'string' &&
      prompt.operationId === run.operationId &&
      Number(prompt.expiresAt) > now,
  );
}

export function figmaScopeUrl(value, nodeValue = '') {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Figma 파일의 HTTPS 주소를 입력하세요.');
  }
  if (
    url.protocol !== 'https:' ||
    !['figma.com', 'www.figma.com'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/(?:design|file|proto)\/[A-Za-z0-9]{10,128}(?:\/|$)/u.test(url.pathname)
  )
    throw new Error(
      'Figma 파일 주소를 입력하세요. 출력 폴더나 다른 사이트 주소는 사용할 수 없습니다.',
    );
  const node = (nodeValue.trim() || url.searchParams.get('node-id') || '').replaceAll('-', ':');
  if (!/^\d+:\d+$/u.test(node))
    throw new Error('수집할 노드 ID를 입력하세요. 예: 0:1 또는 1378:120.');
  url.searchParams.set('node-id', node);
  return url.href;
}

const lines = value =>
  String(value ?? '')
    .split(/\r?\n/u)
    .map(item => item.trim())
    .filter(Boolean);
const layers = new Set([
  'frontend',
  'backend',
  'api',
  'database',
  'authentication',
  'authorization',
  'jobs',
  'storage',
  'integration',
  'configuration',
]);
const relativeTarget = (value, allowRoot) =>
  (allowRoot && value === '.') ||
  (value.length > 0 &&
    value.length <= 2048 &&
    !/[\\:]/u.test(value) &&
    ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    value
      .split('/')
      .every(
        part =>
          part &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/u.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      ));

/** User-authored draft only. This function never saves, runs, grants approval or verifies capture. */
export function createGuidedWorkflow(template, input) {
  const name = String(input.name ?? '').trim(),
    description = String(input.description ?? '').trim();
  if (!name || name.length > 128) throw new Error('작업 이름을 1~128자로 입력하세요.');
  if (!description || description.length > 2048)
    throw new Error('만들려는 동작을 요구사항에 1~2048자로 입력하세요.');
  if (!input.workspaceId) throw new Error('등록된 작업 공간을 선택하세요.');
  if (!['new-blank', 'new', 'new-reference', 'legacy'].includes(input.case))
    throw new Error('지원하는 작업 유형을 선택하세요.');
  const target = String(input.targetPath ?? '').trim();
  if (!relativeTarget(target, input.case === 'legacy'))
    throw new Error(
      '결과 경로는 작업 공간 안의 상대 폴더입니다. 예: generated/my-first-screen. Figma URL이나 절대 경로를 넣지 마세요.',
    );
  const referenceId = String(input.referenceWorkspaceId ?? '').trim();
  if (input.case === 'new-reference' && !referenceId)
    throw new Error('참조 기반 포털은 등록된 참조 작업 공간이 필요합니다.');
  const referenceRoot = String(input.referenceRootPath ?? '.').trim() || '.';
  if (referenceId && !relativeTarget(referenceRoot, true))
    throw new Error('참조 경로는 참조 작업 공간 안의 상대 경로입니다.');
  const selectedLayers = [...new Set(input.layers ?? ['frontend'])];
  if (
    !selectedLayers.length ||
    selectedLayers.length > 10 ||
    selectedLayers.some(layer => !layers.has(layer))
  )
    throw new Error('실제로 필요한 구현 범위를 선택하세요.');
  if (
    (input.case === 'new-blank' || (input.case === 'new' && !referenceId)) &&
    selectedLayers.some(layer => !['frontend', 'configuration'].includes(layer))
  )
    throw new Error(
      '참조 없는 새 작업은 프론트엔드만 지원합니다. 전체 포털에는 참조 작업 공간이나 기존 포털이 필요합니다.',
    );
  const requirementId =
    String(input.requirementId ?? '').trim() ||
    template.plan.requirements?.[0]?.id ||
    'requirement-1';
  if (requirementId.length > 128) throw new Error('요구사항 ID는 128자 이내로 입력하세요.');
  const previous =
    input.mode === 'edit'
      ? template.plan.requirements?.find(item => item.id === requirementId)
      : undefined;
  if (input.addRequirement && previous)
    throw new Error('이미 사용 중인 요구사항 ID입니다. 해당 항목을 선택해 편집하세요.');
  if (
    input.decisionEvidence !== undefined &&
    (!String(input.decisionEvidence).trim() || String(input.decisionEvidence).length > 2048)
  )
    throw new Error('구현 판단 근거를 1~2048자로 입력하세요.');
  const entered = (field, fallback) =>
    input[field] === undefined ? [...(fallback ?? [])] : lines(input[field]);
  const roles = entered('roles', previous?.workflow?.roles),
    states = entered('states', previous?.workflow?.states),
    routes = entered('routes', previous?.workflow?.routes),
    apiContracts = entered('apiContracts', previous?.workflow?.apiContracts),
    dataContracts = entered('dataContracts', previous?.workflow?.dataContracts);
  if (
    roles.length > 32 ||
    states.length > 64 ||
    routes.length > 64 ||
    apiContracts.length > 64 ||
    dataContracts.length > 64 ||
    roles.some(v => v.length > 128) ||
    states.some(v => v.length > 256) ||
    routes.some(v => v.length > 512) ||
    [...apiContracts, ...dataContracts].some(v => v.length > 2048)
  )
    throw new Error('업무 흐름의 항목 수 또는 길이가 지원 범위를 넘었습니다.');
  if (
    input.confirmed &&
    (!roles.length ||
      !states.length ||
      (selectedLayers.some(layer => ['backend', 'api'].includes(layer)) && !apiContracts.length) ||
      (selectedLayers.some(layer => ['database', 'storage'].includes(layer)) &&
        !dataContracts.length))
  )
    throw new Error(
      '흐름을 확인하려면 사용자 역할과 화면 상태, 선택한 범위의 API·데이터 동작을 입력하세요.',
    );
  const workflow = structuredClone(template);
  if (input.mode !== 'edit') {
    delete workflow.id;
    delete workflow.revision;
    delete workflow.createdAt;
    delete workflow.updatedAt;
  }
  workflow.name = name;
  workflow.description = input.mode === 'edit' ? workflow.description : description;
  workflow.workspaceId = input.workspaceId;
  const requirement = {
    ...previous,
    id: requirementId,
    description,
    layers: selectedLayers,
    required: true,
    ...(input.confirmed || previous?.workflow
      ? {
          workflow: {
            ...previous?.workflow,
            status: input.confirmed ? 'confirmed' : 'draft',
            roles,
            states,
            routes,
            apiContracts,
            dataContracts,
            decisions: selectedLayers.map(layer =>
              Object.assign(
                {},
                structuredClone(
                  previous?.workflow?.decisions?.find(item => item.layer === layer),
                ) ?? { layer, action: 'implement' },
                {
                  evidence:
                    input.decisionEvidence === undefined
                      ? (previous?.workflow?.decisions?.find(item => item.layer === layer)
                          ?.evidence ??
                        `사용자가 새 작업 설정에서 새 구현 범위와 동작을 확인함: ${description}`)
                      : String(input.decisionEvidence).trim(),
                },
              ),
            ),
          },
        }
      : {}),
  };
  const requirements =
    input.mode === 'edit'
      ? previous
        ? workflow.plan.requirements.map(item => (item.id === requirementId ? requirement : item))
        : [...(workflow.plan.requirements ?? []), requirement]
      : [requirement];
  if (requirements.length > 128) throw new Error('요구사항은 최대 128개까지 저장할 수 있습니다.');
  workflow.plan = {
    ...(input.mode === 'edit' ? workflow.plan : {}),
    case: input.case,
    targetPath: target,
    references:
      input.case === 'new-blank'
        ? []
        : referenceId
          ? [
              {
                ...workflow.plan.references?.[0],
                workspaceId: referenceId,
                rootPath: referenceRoot,
                role: 'primary',
              },
              ...(input.mode === 'edit' ? (workflow.plan.references?.slice(1) ?? []) : []),
            ]
          : [],
    design: {
      ...(input.mode === 'edit' ? workflow.plan.design : {}),
      url: figmaScopeUrl(String(input.figmaUrl ?? ''), String(input.nodeId ?? '')),
      ...(input.mode !== 'edit'
        ? { source: 'chrome', collector: 'page-api', freshness: 'require-live' }
        : {}),
    },
    stack: workflow.plan.stack ?? 'auto',
    requirements,
    ...(input.mode !== 'edit' ? { workflowDecisions: [] } : {}),
  };
  return workflow;
}

export function startingChecklist(workflow, bootstrap, dirty = false) {
  const registered = bootstrap?.workspaces?.find(
    space => space.workspaceId === workflow?.workspaceId,
  );
  let designReady = false;
  try {
    figmaScopeUrl(workflow?.plan?.design?.url ?? '');
    designReady = true;
  } catch {
    /* Missing fields remain visible to the user. */
  }
  return [
    { key: 'service', label: '로컬 서비스 연결', done: bootstrap?.service?.available === true },
    {
      key: 'workspace',
      label: '기존 폴더 등록 후 작업 공간 선택',
      done:
        Boolean(registered) &&
        (!registered.availability || registered.availability === 'available'),
    },
    { key: 'design', label: 'Figma 주소와 수집할 노드 ID 입력', done: designReady },
    {
      key: 'target',
      label: '결과를 쓸 상대 폴더 지정',
      done: Boolean(
        workflow?.plan?.targetPath &&
        relativeTarget(workflow.plan.targetPath, workflow.plan.case === 'legacy'),
      ),
    },
    {
      key: 'requirements',
      label: '요구사항과 업무 흐름 확인',
      done: Boolean(
        workflow?.plan?.requirements?.length &&
        workflow.plan.requirements.every(
          item => item.required === false || item.workflow?.status === 'confirmed',
        ),
      ),
    },
    { key: 'save', label: '초안 저장', done: Boolean(workflow?.id && !dirty) },
  ];
}

export function decisionReviewContext(run, workflow) {
  const envelope = run?.context,
    context = envelope?.workflowCoverage ? envelope : envelope?.blueprint,
    coverage = context?.workflowCoverage;
  if (
    !run?.planId ||
    (envelope?.planId ?? envelope?.runId ?? context?.planId) !== run.planId ||
    workflow?.id !== run.workflowId ||
    !workflow?.plan
  )
    return { available: false, reason: '이 실행의 저장된 계획을 먼저 선택하세요.', evidence: [] };
  if (!context)
    return { available: false, reason: '검토할 계획 근거가 기록되지 않았습니다.', evidence: [] };
  if (
    context.design?.complete !== true ||
    (workflow.plan.design?.freshness !== 'allow-pinned' && context.design?.liveVerified !== true)
  )
    return {
      available: false,
      reason:
        '현재 실행의 Figma 수집이 완료되지 않았습니다. Chrome 연결·Allow와 오류를 확인한 뒤 새 실행으로 수집하세요.',
      evidence: [],
    };
  if (
    coverage?.version !== 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(coverage.analysisHash ?? '') ||
    !Array.isArray(coverage.evidence) ||
    !Array.isArray(coverage.scopes)
  )
    return { available: false, reason: '검토할 분석 근거가 기록되지 않았습니다.', evidence: [] };
  const byId = new Map(coverage.evidence.map(item => [item.id, item]));
  if (
    byId.size !== coverage.evidence.length ||
    coverage.evidence.some(item => typeof item.id !== 'string' || !item.id) ||
    coverage.scopes.some(scope => !Array.isArray(scope.evidenceIds))
  )
    return {
      available: false,
      reason: '분석 근거 ID가 모호합니다. 서비스에서 상태를 다시 확인하세요.',
      evidence: [],
    };
  const ids = new Set(
    coverage.scopes
      .filter(scope => scope.status === 'unresolved')
      .flatMap(scope => scope.evidenceIds),
  );
  if ([...ids].some(id => !byId.has(id)))
    return {
      available: false,
      reason: '미해결 범위의 근거가 누락되어 검토할 수 없습니다.',
      evidence: [],
    };
  return {
    available: true,
    analysisHash: coverage.analysisHash,
    evidence: [...ids].map(id => byId.get(id)),
    requirements: (workflow.plan.requirements ?? []).filter(
      item => item.required !== false && item.workflow?.status === 'confirmed',
    ),
  };
}

export function stageWorkflowDecisions(workflow, run, analysisHash, choices) {
  const context = decisionReviewContext(run, workflow);
  if (!context.available || context.analysisHash !== analysisHash)
    throw new Error(context.reason ?? '분석 근거가 변경됐습니다. 검토 화면을 다시 열어 주세요.');
  const evidence = new Set(context.evidence.map(item => item.id)),
    requirementIds = new Set(context.requirements.map(item => item.id)),
    selected = new Set();
  if (!Array.isArray(choices) || !choices.length || choices.length > 512)
    throw new Error('검토할 근거를 선택하세요.');
  for (const choice of choices) {
    if (
      !evidence.has(choice.evidenceId) ||
      selected.has(choice.evidenceId) ||
      !['implement', 'reuse', 'extend'].includes(choice.decision) ||
      !Array.isArray(choice.requirementIds) ||
      !choice.requirementIds.length ||
      choice.requirementIds.some(id => !requirementIds.has(id)) ||
      new Set(choice.requirementIds).size !== choice.requirementIds.length ||
      typeof choice.rationale !== 'string' ||
      choice.rationale.trim().length < 20 ||
      choice.rationale.length > 2048
    )
      throw new Error(
        '실제 근거마다 확인된 요구사항, 구현·재사용·확장 방식과 20자 이상의 판단 이유를 입력하세요.',
      );
    selected.add(choice.evidenceId);
  }
  const draft = structuredClone(workflow);
  draft.plan.workflowDecisions = [
    ...(draft.plan.workflowDecisions ?? []).filter(
      item => item.analysisHash === analysisHash && !selected.has(item.evidenceId),
    ),
    ...choices.map(choice => ({
      analysisHash,
      evidenceId: choice.evidenceId,
      requirementIds: [...choice.requirementIds],
      decision: choice.decision,
      rationale: choice.rationale.trim(),
    })),
  ];
  return draft;
}

const activityFields = new Set([
  'name',
  'description',
  'workspaceId',
  'case',
  'designUrl',
  'collector',
  'freshness',
  'targetPath',
  'stack',
  'profileId',
  'requirements',
  'workflowDecisions',
  'nodes',
  'edges',
  'viewport',
]);
/** Fixed telemetry allowlist: never retain raw field values, paths, headers, secrets or code. */
export function safeActivityMetadata(input = {}) {
  const output = {};
  if (activityFields.has(input.field)) output.field = input.field;
  if (typeof input.hasValue === 'boolean') output.hasValue = input.hasValue;
  if (typeof input.nodeId === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(input.nodeId))
    output.nodeId = input.nodeId;
  if (typeof input.nodeType === 'string' && Object.hasOwn(nodeTypes, input.nodeType))
    output.nodeType = input.nodeType;
  if (
    [
      'refresh',
      'next',
      'submit',
      'validate',
      'apply',
      'resume',
      'cancel',
      'approve',
      'reject',
    ].includes(input.actionName)
  )
    output.actionName = input.actionName;
  if (typeof input.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(input.errorCode))
    output.errorCode = input.errorCode;
  if (typeof input.figmaFileKey === 'string' && /^[A-Za-z0-9]{10,128}$/u.test(input.figmaFileKey))
    output.figmaFileKey = input.figmaFileKey;
  if (typeof input.figmaNodeId === 'string' && /^\d+:\d+$/u.test(input.figmaNodeId))
    output.figmaNodeId = input.figmaNodeId;
  if (Array.isArray(input.changedFields))
    output.changedFields = [
      ...new Set(input.changedFields.filter(field => activityFields.has(field))),
    ];
  for (const key of ['nodeCount', 'edgeCount', 'changeCount'])
    if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 1000)
      output[key] = input[key];
  if (
    typeof input.step === 'string' &&
    /^guide-(?:start|flow|approval|status|agent)$/u.test(input.step)
  )
    output.step = input.step;
  if (['builder', 'live', 'activities', 'settings', 'functions', 'admin'].includes(input.view))
    output.view = input.view;
  if (['tool', 'feature'].includes(input.functionType)) output.functionType = input.functionType;
  if (
    typeof input.functionName === 'string' &&
    /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(input.functionName)
  )
    output.functionName = input.functionName;
  if (
    typeof input.jobId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.jobId)
  )
    output.jobId = input.jobId;
  if (['approve', 'reject', 'cancel', 'inspect'].includes(input.jobAction))
    output.jobAction = input.jobAction;
  return output;
}

export function upsertActivities(previous, incoming) {
  const rows = new Map(previous.map(row => [row.id, row]));
  for (const row of incoming)
    if (!rows.has(row.id) || row.sequence >= rows.get(row.id).sequence) rows.set(row.id, row);
  return [...rows.values()].toSorted((a, b) => b.sequence - a.sequence);
}

export function agentHandoffSummary(run) {
  const envelope = run?.context,
    context = envelope?.blueprint ?? envelope;
  const bound =
    run?.planId && (envelope?.planId ?? envelope?.runId ?? context?.planId) === run.planId;
  return {
    serviceRunId: run?.serviceRunId ?? run?.planId ?? null,
    workspaceId: run?.workspaceId ?? null,
    targetPath: bound && typeof context?.targetPath === 'string' ? context.targetPath : null,
  };
}
