import { createApi } from './api.js';
import {
  nodeTypes,
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
  startingChecklist,
  decisionReviewContext,
  stageWorkflowDecisions,
  safeActivityMetadata,
  upsertActivities,
  agentHandoffSummary,
} from './model.js';

const api = createApi(globalThis.fetch.bind(globalThis), () => {
  state.activityError =
    '서버가 활동 감사 기록의 누락 가능성을 알렸습니다. 실제 요청 결과는 유지되며 활동 기록을 새로고침해서 확인하세요.';
  notify(state.activityError, true);
});
const state = {
  bootstrap: null,
  workflows: [],
  workflow: null,
  selected: null,
  dirty: false,
  view: 'builder',
  tab: 'configure',
  busy: false,
  run: null,
  runs: [],
  events: [],
  cursor: 0,
  connectFrom: null,
  filter: 'all',
  search: '',
  pollError: null,
  jsonDraft: null,
  activities: [],
  activityCursor: 0,
  activityHasMore: false,
  activityError: null,
  activityAudit: null,
  activityRetention: null,
  activityFilters: {},
  activityFilterDraft: {},
  activityLost: 0,
};
const app = document.querySelector('#app');
let viewCleanup;
let viewMountEpoch = 0;

function modulePanel() {
  const settings = state.view === 'settings';
  return `<main id="main" class="module-panel"><div id="${settings ? 'connection-settings' : 'service-functions'}" aria-live="polite">등록된 ${settings ? '연결 설정' : '서비스 기능'}을 불러오는 중입니다.</div></main>`;
}
async function mountModuleView(epoch) {
  if (!['settings', 'functions', 'admin'].includes(state.view)) return;
  const settings = state.view === 'settings';
  const container = document.getElementById(settings ? 'connection-settings' : 'service-functions');
  try {
    const module = await import(settings ? './figma-settings.js' : './service-functions.js');
    if (epoch !== viewMountEpoch || !container?.isConnected) return;
    const options = {
      api,
      workspaces: state.bootstrap.workspaces,
      administrative: state.view === 'admin',
      onActivity: activity,
      onError: report,
      onApplyToDraft: endpoint => {
        if (!['https://mcp.figma.com/mcp', 'http://127.0.0.1:3845/mcp'].includes(endpoint)) {
          report(new Error('지원하는 공식 Figma MCP 주소를 선택하세요.'));
          return;
        }
        commitJsonDraft();
        state.workflow.plan.design = {
          ...state.workflow.plan.design,
          source: 'official-mcp',
          officialEndpoint: endpoint,
        };
        delete state.workflow.plan.design.collector;
        activity('draft.edit', { field: 'collector', hasValue: true });
        dirty();
        notify('공식 MCP 경로를 초안에 반영했습니다. 저장하거나 실행하지 않았습니다.');
      },
    };
    viewCleanup = settings
      ? module.mountFigmaSettings(container, options)
      : module.mountServiceFunctions(container, options);
  } catch (error) {
    if (epoch !== viewMountEpoch || !container?.isConnected) return;
    container.textContent =
      '이 화면을 불러오지 못했습니다. 연결 상태와 실제 서버 오류를 확인하세요.';
    report(error);
  }
}
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  graph:
    '<rect x="3" y="3" width="6" height="5" rx="1.5"/><rect x="15" y="9" width="6" height="5" rx="1.5"/><rect x="3" y="16" width="6" height="5" rx="1.5"/><path d="M9 5h3v7h3M12 12v7H9"/>',
  pulse: '<path d="M3 13h4l3-8 4 14 3-6h4"/>',
  figma:
    '<path d="M12 3H8a4 4 0 0 0 0 8h4V3ZM12 3h4a4 4 0 0 1 0 8h-4M12 11H8a4 4 0 0 0 0 8h4v-8ZM12 19v1a4 4 0 1 1-4-4"/><circle cx="16" cy="15" r="4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/>',
  check: '<path d="M20 11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9m-7 7 4 4 10-10"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9M7 5l9 5"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 10M20 3v5h-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  link: '<path d="m10 14 4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
const icon = name =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.box}</svg>`;
const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const json = value => escape(JSON.stringify(value, null, 2));
const labels = {
  queued: '실행 대기',
  active: '실행 중',
  'awaiting-input': '입력 필요',
  'awaiting-agent': '에이전트 대기',
  'awaiting-approval': '승인 대기',
  failed: '실패',
  unknown: '결과 확인 필요',
  completed: '완료',
  cancelled: '취소됨',
  pending: '대기',
  waiting: '입력 대기',
};
const actionLabels = {
  refresh: '서비스 상태 확인',
  next: '코딩 컨텍스트 요청',
  submit: '에이전트 결과 제출',
  validate: '결과 검증',
  apply: '후보 결과 적용',
  resume: '실행 재개',
  cancel: '실행 취소',
  approve: '승인',
  reject: '거절',
};
const date = value =>
  value
    ? new Date(value).toLocaleString('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
const badge = (status, fallback = '미실행') =>
  `<span class="badge ${escape(status ?? 'draft')}">${escape(labels[status] ?? fallback)}</span>`;
const activeGraph = () =>
  state.view === 'live' && state.run?.graph
    ? { ...state.run.graph, viewport: state.liveViewport ?? state.run.graph.viewport }
    : state.workflow?.graph;
const selectedNode = () => activeGraph()?.nodes.find(node => node.id === state.selected);
const nodeRun = id => state.run?.nodes?.find(node => node.nodeId === id);
const field = (label, name, value, options = {}) =>
  `<label class="field"><span>${label}</span>${options.select ? `<select data-field="${name}" ${options.disabled ? 'disabled' : ''}>${options.select.map(([key, text]) => `<option value="${escape(key)}" ${value === key ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select>` : options.textarea ? `<textarea data-field="${name}" ${options.json ? 'class="code" spellcheck="false"' : ''} ${options.disabled ? 'disabled' : ''}>${escape(value)}</textarea>` : `<input data-field="${name}" value="${escape(value)}" ${options.type ? `type="${options.type}"` : ''} ${options.placeholder ? `placeholder="${escape(options.placeholder)}"` : ''} ${options.disabled ? 'disabled' : ''}/>`}${options.help ? `<small>${options.help}</small>` : ''}</label>`;

const formField = (label, name, value = '', options = {}) =>
  `<label class="field"><span>${label}</span>${options.select ? `<select name="${name}" ${options.required ? 'required' : ''}>${options.select.map(([key, text]) => `<option value="${escape(key)}" ${value === key ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select>` : options.textarea ? `<textarea name="${name}" ${options.required ? 'required' : ''} maxlength="${options.max ?? 2048}" placeholder="${escape(options.placeholder ?? '')}">${escape(value)}</textarea>` : `<input name="${name}" value="${escape(value)}" ${options.required ? 'required' : ''} ${options.readonly ? 'readonly' : ''} maxlength="${options.max ?? 2048}" placeholder="${escape(options.placeholder ?? '')}"/>`}${options.help ? `<small>${escape(options.help)}</small>` : ''}</label>`;
const workspaceOptions = () => [
  ['', '등록된 작업 공간 선택'],
  ...(state.bootstrap?.workspaces ?? []).map(space => [space.workspaceId, space.realPath]),
];
const layerNames = {
  frontend: '화면·프론트엔드',
  backend: '서버',
  api: 'API',
  database: '데이터베이스',
  authentication: '로그인',
  authorization: '접근 권한',
  jobs: '백그라운드 작업',
  storage: '파일 저장',
  integration: '외부 연동',
  configuration: '설정',
};

const activityQueue = [];
let activityWriter;
let activityReadEpoch = 0;
const activityTimers = new Map();
function activity(type, metadata = {}) {
  const item = { type, metadata: safeActivityMetadata(metadata) };
  const scope =
    type.startsWith('service.') || metadata.functionType
      ? {}
      : {
          workflowId: state.workflow?.id,
          runId: state.run?.id,
          workspaceId: state.workflow?.workspaceId,
        };
  for (const [key, value] of Object.entries(scope))
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value ?? ''))
      item[key] = value;
  if (activityQueue.length >= 200) {
    state.activityLost++;
    state.activityError =
      '클라이언트 활동 기록 대기열이 가득 찼습니다. 일부 입력 기록이 저장되지 않았습니다.';
    return;
  }
  activityQueue.push(item);
  if (state.bootstrap) void flushActivity();
}
function flushActivity() {
  if (activityWriter) return activityWriter;
  activityWriter = (async () => {
    while (activityQueue.length) {
      try {
        // Preserve the user's action order in the persisted audit sequence.
        // oxlint-disable-next-line no-await-in-loop
        await api.activity(activityQueue.shift());
      } catch (error) {
        state.activityLost++;
        state.activityError = `활동 기록을 저장하지 못했습니다: ${error.code ?? 'CONNECTION_FAILED'}. 작업 결과는 서버 기록으로 확인하세요.`;
      }
    }
  })().finally(() => {
    activityWriter = null;
  });
  return activityWriter;
}
function deferredActivity(key, type, metadata) {
  clearTimeout(activityTimers.get(key));
  activityTimers.set(
    key,
    setTimeout(() => {
      activityTimers.delete(key);
      activity(type, metadata);
    }, 700),
  );
}
function activityInput(element) {
  if (!element.dataset.field && !element.closest('#guided-setup-form, #workflow-decision-form'))
    return;
  const key = element.dataset.field ?? element.name;
  const fieldMap = {
    source: 'collector',
    figmaUrl: 'designUrl',
    nodeId: 'designUrl',
    'plan.design.url': 'designUrl',
    'plan.design.freshness': 'freshness',
    'plan.case': 'case',
    'plan.targetPath': 'targetPath',
    'plan.stack': 'stack',
    'node.profileId': 'profileId',
    'node.label': 'nodes',
    'requirement.description': 'requirements',
    'requirement.layers': 'requirements',
    'requirements-json': 'requirements',
    requirementChoice: 'requirements',
    requirementId: 'requirements',
    roles: 'requirements',
    states: 'requirements',
    routes: 'requirements',
    apiContracts: 'requirements',
    dataContracts: 'requirements',
    decisionEvidence: 'requirements',
    confirmed: 'requirements',
    layers: 'requirements',
    referenceWorkspaceId: 'requirements',
    referenceRootPath: 'requirements',
    decision: 'workflowDecisions',
    rationale: 'workflowDecisions',
  };
  const fieldName =
    fieldMap[key] ??
    (['name', 'description', 'workspaceId', 'case', 'targetPath'].includes(key) ? key : null);
  if (!fieldName) return;
  const metadata = {
    field: fieldName,
    hasValue: element.type === 'checkbox' ? element.checked : Boolean(element.value?.trim()),
  };
  if (key === 'figmaUrl' || key === 'plan.design.url')
    try {
      const url = new URL(element.value);
      if (
        url.protocol === 'https:' &&
        ['figma.com', 'www.figma.com'].includes(url.hostname) &&
        !url.port &&
        !url.username &&
        !url.password &&
        /^\/(?:design|file|proto)\/[A-Za-z0-9]{10,128}(?:\/|$)/u.test(url.pathname)
      ) {
        metadata.figmaFileKey = url.pathname.split('/')[2];
        const id = url.searchParams.get('node-id')?.replaceAll('-', ':');
        if (id) metadata.figmaNodeId = id;
      }
    } catch {
      /* Partial URLs only record field presence. */
    }
  if (key === 'nodeId') metadata.figmaNodeId = element.value.replaceAll('-', ':');
  deferredActivity(`field:${key}`, 'draft.edit', metadata);
}

function trackButton(button) {
  if (button.dataset.view) activity('view.change', { view: button.dataset.view });
  if (button.dataset.openWorkflow) activity('workflow.select');
  if (button.dataset.openRun) activity('view.change', { view: 'live' });
  if (button.dataset.add) activity('node.add', { nodeType: button.dataset.add });
  if (button.dataset.nudge) activity('node.move', { nodeId: state.selected });
  if (button.dataset.removeEdge) activity('graph.disconnect');
  if (button.dataset.runAction)
    activity('run.action.intent', { actionName: button.dataset.runAction });
  const types = {
    'usage-guide': 'guide.open',
    'guided-setup': 'setup.open',
    'guide-setup': 'setup.open',
    'edit-setup': 'setup.open',
    new: 'workflow.new',
    save: 'workflow.save.intent',
    start: 'run.start.intent',
    health: 'connection.refresh',
    'refresh-run': 'run.action.intent',
    'remove-node': 'node.remove',
    'connect-selected': 'graph.connect',
    fit: 'graph.reset',
    'review-decisions': 'decision.review.open',
    'copy-agent-handoff': 'agent.handoff.copy',
  };
  if (types[button.dataset.action])
    activity(types[button.dataset.action], {
      ...(button.dataset.action === 'refresh-run' ? { actionName: 'refresh' } : {}),
      ...(button.dataset.action === 'remove-node' ? { nodeId: state.selected } : {}),
    });
}

const activityStatuses = {
  intent: '사용자 요청',
  started: '처리 시작',
  succeeded: '요청 처리 성공',
  failed: '요청 처리 실패',
  unknown: '결과 미확정',
  observed: '상태 관찰',
};
const activitySources = { client: '사용자 입력', server: '포털 서버', service: '서비스 결과' };
function readActivityFilterDraft(form) {
  const value = name => form.elements.namedItem(name)?.value ?? '';
  return {
    type: value('action'),
    workflowId: value('workflowId'),
    status: value('status'),
    source: value('source'),
    fromLocal: value('from'),
    toLocal: value('to'),
  };
}
function retainActivityFilterInput() {
  const form = document.getElementById('activity-filter-form');
  if (!form) return null;
  state.activityFilterDraft = readActivityFilterDraft(form);
  const focused = document.activeElement;
  if (!focused?.name || !form.contains(focused)) return null;
  return {
    name: focused.name,
    start: focused.selectionStart,
    end: focused.selectionEnd,
    direction: focused.selectionDirection,
  };
}
function activityPanel() {
  const filters = state.activityFilterDraft;
  const warning =
    state.activityError ||
    state.activityAudit?.available === false ||
    state.activityAudit?.complete === false ||
    state.activityRetention?.full ||
    state.activityLost > 0;
  return `<main class="activity-panel" id="main"><div class="activity-heading"><div><h2>활동 기록</h2><p>사용자 입력 의도와 서버·서비스의 실제 처리 상태를 구분합니다. 성공 기록은 해당 요청의 성공이며 전체 코드 생성 완료가 아닙니다.</p></div><button data-action="refresh-activities">${icon('refresh')}기록 새로고침</button></div><section id="activity-panel" aria-label="지속 저장된 활동 기록"><form id="activity-filter-form" class="activity-filters">${formField('작업명 (정확한 이름)', 'action', filters.type ?? '', { placeholder: 'guide.open 또는 workflow.save' })}${formField('워크플로', 'workflowId', filters.workflowId ?? '', { select: [['', '모든 워크플로'], ...state.workflows.map(workflow => [workflow.id, workflow.name])] })}${formField('처리 상태', 'status', filters.status ?? '', { select: [['', '모든 상태'], ...Object.entries(activityStatuses)] })}${formField('기록 출처', 'source', filters.source ?? '', { select: [['', '모든 출처'], ...Object.entries(activitySources)] })}<label class="field"><span>시작 시각</span><input type="datetime-local" name="from" value="${escape(filters.fromLocal ?? '')}"/></label><label class="field"><span>종료 시각</span><input type="datetime-local" name="to" value="${escape(filters.toLocal ?? '')}"/></label><button type="submit">필터 적용</button></form>${warning ? `<div class="error-box" role="alert">${escape(state.activityError ?? '활동 감사 기록이 완전하지 않거나 저장 한도에 도달했습니다.')}<p>저장되지 못한 클라이언트 기록: ${state.activityLost}. 서버 감사 누락: ${escape(state.activityAudit?.unrecordedCount ?? '미확인')}. 이 화면에서 완료를 추정하지 않습니다.</p></div>` : ''}<p class="tiny muted">현재 불러온 ${state.activities.length}개 · 저장 ${escape(state.activityRetention?.count ?? '미확인')}/2000. 수정 중인 초안은 이 보기를 열어도 그대로 유지됩니다.</p><div class="activity-rows">${state.activities.map(row => `<article data-activity-id="${escape(row.id)}" class="activity-row"><div><time datetime="${escape(row.updatedAt ?? row.at)}">${escape(new Date(row.updatedAt ?? row.at).toLocaleString('ko-KR'))}</time><span class="badge ${escape(row.status)}">${escape(activityStatuses[row.status] ?? row.status)}</span><span class="tiny">${escape(activitySources[row.source] ?? '알 수 없는 출처')}</span></div><h3>${escape(row.type)}</h3><details><summary>안전한 식별자 보기</summary><dl><dt>워크플로</dt><dd>${escape(row.workflowId ?? '초안/없음')}</dd><dt>실행</dt><dd>${escape(row.runId ?? '없음')}</dd><dt>요청</dt><dd>${escape(row.requestId ?? '없음')}</dd><dt>세션</dt><dd>${escape(row.sessionId ?? '없음')}</dd><dt>변경 순서</dt><dd>${escape(row.sequence)}</dd></dl><pre class="json-output">${json(safeActivityMetadata(row.metadata))}</pre></details></article>`).join('') || '<div class="empty-state">불러온 기록이 없습니다. 필터와 연결 상태를 확인하세요.</div>'}</div>${state.activityHasMore ? '<button data-action="more-activities">다음 기록 더 보기</button>' : ''}</section></main>`;
}
async function loadActivities(reset = true) {
  const epoch = ++activityReadEpoch;
  const selectedFilters = structuredClone(state.activityFilters);
  await Promise.race([flushActivity(), new Promise(resolveWait => setTimeout(resolveWait, 2000))]);
  try {
    const { fromLocal: _fromLocal, toLocal: _toLocal, ...filters } = selectedFilters;
    const data = await api.activities({
      ...filters,
      after: reset ? 0 : state.activityCursor,
      limit: 50,
    });
    if (epoch !== activityReadEpoch) return;
    state.activities = upsertActivities(reset ? [] : state.activities, data.activities);
    if (!state.activityLost) state.activityError = null;
    state.activityCursor = data.nextCursor;
    state.activityHasMore = data.hasMore;
    state.activityAudit = data.audit;
    state.activityRetention = data.retention;
  } catch (error) {
    if (epoch !== activityReadEpoch) return;
    state.activityError = `활동 기록을 불러오지 못했습니다: ${error.code ?? 'CONNECTION_FAILED'}. 이전에 불러온 기록을 최신 기록으로 간주하지 마세요.`;
  }
  if (state.view === 'activities') render();
}

function openPanel(id, content) {
  const dialog = document.getElementById(id);
  const action = document.activeElement?.dataset?.action;
  dialog.innerHTML = content;
  dialog.returnAction = action;
  dialog.returnFocus = document.activeElement;
  if (!dialog.open) dialog.showModal();
}
function closePanel(id) {
  const dialog = document.getElementById(id),
    action = dialog.returnAction;
  dialog.close();
  if (dialog.returnFocus?.isConnected) dialog.returnFocus.focus();
  else if (action) document.querySelector(`button[data-action="${CSS.escape(action)}"]`)?.focus();
}
function checklist() {
  const items = startingChecklist(state.workflow, state.bootstrap, state.dirty);
  return `<section id="first-run-checklist" class="starting-checklist" aria-label="첫 실행 체크리스트"><div class="checklist-heading"><div><strong>처음이라면 이 순서로 시작하세요</strong><p>입력 → 저장 → 검사 → 실행 → 승인 확인 → 실행 맵</p></div><button data-action="guided-setup">${icon('plus')}새 작업 설정</button><button class="quiet" data-action="edit-setup">기본 설정·요구사항 편집</button></div><ol>${items.map(item => `<li class="${item.done ? 'ready' : ''}"><span aria-hidden="true">${item.done ? '✓' : '○'}</span>${escape(item.label)}</li>`).join('')}</ol><p class="tiny muted">이 체크리스트는 입력 상태입니다. 실제 Figma 수집·검증·적용 성공은 실행 맵의 기록으로 확인하세요.</p></section>`;
}
function updateChecklist() {
  const element = document.getElementById('first-run-checklist');
  if (element) element.outerHTML = checklist();
}
function usageGuide() {
  const canSetup = Boolean(state.bootstrap && state.workflow);
  openPanel(
    'usage-guide-dialog',
    `<div class="dialog-heading"><h2 id="usage-guide-title">사용 가이드</h2><button class="quiet" data-action="close-guide" aria-label="사용 가이드 닫기">${icon('close')}</button></div><p class="guide-intro">Figma 디자인을 읽고, 필요한 기능을 정한 뒤 코딩 에이전트와 검증·적용을 이어가는 로컬 작업 도구입니다. 로그인은 없지만 서비스와 Chrome의 승인은 각각 필요할 수 있습니다.</p><nav class="guide-nav" aria-label="가이드 목차"><a href="#guide-start">처음 시작</a><a href="#guide-flow">5단계</a><a href="#guide-approval">두 종류의 승인</a><a href="#guide-status">대기·오류</a><a href="#guide-agent">에이전트 전달</a></nav><section id="guide-start"><h3>1. 기본 작업 만들기</h3><ol class="guide-steps"><li><strong>연결 확인</strong>에서 로컬 서비스 상태를 확인합니다. Chrome이 아직 연결되지 않았어도 첫 실행으로 연결을 요청할 수 있습니다.</li><li><strong>작업 공간 등록</strong>에서 이미 존재하는 로컬 폴더를 등록하고 선택합니다. 이 폴더가 소스·출력의 기준입니다. 새 폴더를 대신 만드는 기능은 아닙니다.</li><li><strong>새 작업 설정</strong>에 Figma 파일 주소와 노드 ID를 입력합니다. 노드 ID는 링크의 <code>node-id=1378-120</code> 또는 <code>1378:120</code>처럼 지정합니다.</li><li><strong>결과 폴더</strong>는 <code>generated/my-first-screen</code> 같은 작업 공간 안의 상대 경로입니다. Figma URL이나 <code>C:\\...</code> 절대 경로를 넣지 않습니다. 새 작업에는 사용하지 않은 경로를 고르고, 실제 경로 조건은 서비스가 확인합니다.</li><li><strong>Case 4</strong>는 참조 없는 새 프론트엔드입니다. Case 2는 기존 포털 확장, Case 3은 참조를 사용하는 새 전체 포털입니다. Case 1도 참조 유무에 따라 전체 포털 또는 프론트엔드로 결정됩니다.</li><li>요구사항과 사용자 역할·화면 상태·페이지 경로를 작성합니다. 필요한 API·데이터 동작도 적고 <strong>업무 흐름 확인</strong>을 직접 체크합니다. 편집하지 않은 기존 계약은 보존됩니다.</li><li><strong>초안에 적용 → 저장 → 검사 → 실행</strong>을 차례로 누릅니다. 실행 중에는 실행 맵의 해당 노드를 선택하고 <strong>실행 정보</strong>를 봅니다.</li></ol><button data-action="guide-setup" class="primary" ${!canSetup ? 'disabled' : ''}>새 작업 설정 열기</button></section><section id="guide-flow"><h3>2. 현재 지원하는 5단계</h3><div class="guide-stage-grid">${Object.values(
      nodeTypes,
    )
      .map(
        (type, index) =>
          `<div><span>${index + 1}</span><strong>${escape(type.label)}</strong><p>${escape(type.subtitle)}</p></div>`,
      )
      .join(
        '',
      )}</div><p>5개 노드를 이 순서로 연결합니다. 분기 그래프는 현재 실행하지 않습니다. 수집이 완료돼도 요구사항 범위 결정이 남으면 입력 대기입니다. <strong>미해결 범위 검토</strong>에서 실제 근거와 확인된 요구사항을 연결한 뒤 초안에 반영하고, 저장 후 새 실행을 직접 요청합니다. 기존 실행은 자동 재시도되지 않습니다.</p></section><section id="guide-approval"><h3>3. 서비스 승인과 Chrome Allow</h3><p><strong>서비스 승인</strong>은 포털의 실행 정보에 나타납니다. 대상·영향·만료를 읽고 해당 요청의 승인 또는 거절 버튼을 누릅니다.</p><p><strong>Chrome의 Allow</strong>는 기존 Figma Chrome 창에 나타나는 원격 디버깅 연결 권한입니다. 필요한 경우 그 창으로 이동해 직접 확인합니다. 포털의 승인 버튼이 이 권한을 대신하지 않으며 자동으로 누르지 않습니다.</p><p>‘서비스 연결됨’과 ‘Chrome 연결됨’은 디자인 수집 완료를 뜻하지 않습니다. 공식 Figma MCP는 별도 서버 인증과 호환성이 필요합니다.</p></section><section id="guide-status"><h3>4. 상태별 다음 행동</h3><dl class="guide-status-list"><dt>입력 필요</dt><dd>실행 정보의 누락 항목을 보완합니다. 수집이 완료된 현재 근거에만 범위 결정을 입력할 수 있습니다.</dd><dt>승인 대기</dt><dd>현재 실행에 유효한 서비스 승인 요청을 확인합니다. Chrome 연결 대기는 별도의 Chrome 창에서 확인합니다.</dd><dt>에이전트 대기</dt><dd>아래 전달 정보를 코딩 에이전트에 전달합니다. 포털은 뒤에서 모델을 자동 실행하지 않습니다.</dd><dt>실패·시간 초과</dt><dd>기록된 오류 코드와 대상을 확인하고 원인을 해결합니다. 상태를 먼저 확인하고, 필요하면 새 실행을 직접 요청합니다.</dd><dt>결과 확인 필요</dt><dd>변경이 이미 일어났을 수 있습니다. 같은 작업을 반복하지 말고 서비스 상태와 원래 작업 결과를 확인합니다.</dd><dt>후보·적용 후 검증 대기</dt><dd>후보 검증, 명시적 적용, 적용 결과 검증은 각각 다릅니다. 화면에 제공되는 동작과 근거를 확인합니다.</dd></dl></section><section id="guide-agent"><h3>5. 코딩 에이전트에게 전달하기</h3><p>실행 정보의 <strong>에이전트 전달 정보</strong>를 복사해 실제 코딩 에이전트에게 전달합니다. 에이전트는 같은 OS 사용자·서비스 상태와 작업 공간을 사용하는 자신의 MCP 또는 CLI 연결에서 <code>portal_next</code>를 요청하고, <strong>그 동일한 연결</strong>에서 결과를 제출해야 합니다.</p><p>웹 연결에서 받은 코딩 임대를 다른 MCP 연결에 붙여 넣지 마세요. 이미 웹이 임대를 보유하면 에이전트가 서비스 상태와 유효 임대 처리·만료를 확인해야 하며 강제로 인계하지 않습니다. 웹의 컨텍스트 요청·결과 JSON 제출은 고급 기능입니다.</p><p>에이전트 작업 뒤에는 <strong>서비스 상태 확인</strong>을 눌러 실제 진행 결과를 가져옵니다. 3초 자동 새로고침은 포털에 저장된 기록만 읽으며 외부 에이전트의 새 결과를 스스로 수집하지 않습니다.</p></section>`,
  );
}

function setupDialog(mode = 'new', choice) {
  if (!state.bootstrap || !state.workflow) return;
  if (mode === 'new' && state.dirty) {
    notify('현재 변경 사항을 먼저 저장하거나 다시 불러온 뒤 새 작업을 만드세요.', true);
    return;
  }
  commitJsonDraft();
  const source = mode === 'edit' ? state.workflow : state.bootstrap.template;
  const requirements = source.plan.requirements ?? [];
  const selected = choice ?? (mode === 'edit' ? requirements[0]?.id : null);
  const requirement = requirements.find(item => item.id === selected);
  let nextId = 1;
  while (requirements.some(item => item.id === `requirement-${nextId}`)) nextId++;
  const root = source.plan.references?.[0];
  let sourceNodeId = '';
  try {
    sourceNodeId = new URL(source.plan.design?.url ?? '').searchParams.get('node-id') ?? '';
  } catch {
    /* Invalid drafts remain editable. */
  }
  const formContent =
    formField('작업 이름', 'name', mode === 'edit' ? source.name : '내 첫 Figma 작업', {
      required: true,
      max: 128,
    }) +
    formField('작업 공간', 'workspaceId', mode === 'edit' ? (source.workspaceId ?? '') : '', {
      select: workspaceOptions(),
      required: true,
    }) +
    `<button type="button" data-action="register-workspace" ${state.bootstrap.service.readiness?.workspaceRegistrationAvailable !== true ? 'disabled' : ''}>작업 공간 등록</button>` +
    `<div class="setup-grid">${formField('Figma 파일 주소', 'figmaUrl', mode === 'edit' ? (source.plan.design?.url ?? '') : '', { required: true, placeholder: 'https://www.figma.com/design/파일키?node-id=0-1', help: '디자인을 읽을 주소입니다. 결과 폴더와 다릅니다.' })}${formField('수집할 노드 ID', 'nodeId', mode === 'edit' ? sourceNodeId : '', { placeholder: '0:1 또는 링크의 node-id', help: '주소에 node-id가 있으면 비워 둘 수 있습니다.' })}${formField(
      '작업 유형',
      'case',
      mode === 'edit' ? source.plan.case : 'new-blank',
      {
        select: [
          ['new-blank', 'Case 4 · 참조 없는 새 프론트엔드'],
          ['new', 'Case 1 · 참조 유무에 따른 새 작업'],
          ['legacy', 'Case 2 · 기존 전체 포털 확장'],
          ['new-reference', 'Case 3 · 참조 기반 새 전체 포털'],
        ],
      },
    )}${formField('결과 폴더', 'targetPath', mode === 'edit' ? (source.plan.targetPath ?? '') : '', { required: true, placeholder: 'generated/my-first-screen', help: '작업 공간 안의 상대 경로입니다. 새 작업에는 사용하지 않은 폴더를 지정하세요.' })}${formField('참조 작업 공간 (해당 시)', 'referenceWorkspaceId', root?.workspaceId ?? '', { select: workspaceOptions(), help: 'Case 3에는 필수입니다. Case 4는 참조를 읽지 않습니다.' })}${formField('참조 폴더', 'referenceRootPath', root?.rootPath ?? '.', { help: '참조 작업 공간 전체는 점 하나(.)입니다.' })}</div><div class="info-box">새 작업의 기본 수집은 Chrome 독립 페이지 API입니다. 기존 작업의 수집 경로·최신성·기타 고급 설정은 유지되며 선택한 노드의 설정에서 확인할 수 있습니다.</div><hr/><h3>무엇을 만들까요?</h3>${mode === 'edit' ? formField('편집할 요구사항', 'requirementChoice', selected ?? '__new__', { select: [...requirements.map(item => [item.id, `${item.id} · ${item.description.slice(0, 70)}`]), ['__new__', '새 요구사항 추가']] }) : ''}${formField('필요한 화면과 동작', 'description', requirement?.description ?? '', { textarea: true, required: true, placeholder: '예: 사용자가 언어를 선택하면 화면의 문구와 선택 표시가 함께 바뀝니다.' })}<fieldset class="setup-layers"><legend>새로 구현하거나 검토할 범위</legend>${Object.entries(
      layerNames,
    )
      .map(
        ([key, text]) =>
          `<label><input type="checkbox" name="layers" value="${key}" ${(requirement?.layers ?? ['frontend']).includes(key) ? 'checked' : ''}/>${escape(text)}</label>`,
      )
      .join(
        '',
      )}</fieldset><div class="setup-grid">${formField('누가 사용하나요? (한 줄에 하나)', 'roles', requirement?.workflow?.roles?.join('\n') ?? '', { textarea: true, placeholder: '방문자', help: '사용자 역할을 직접 정하세요.' })}${formField('어떤 상태를 확인하나요? (한 줄에 하나)', 'states', requirement?.workflow?.states?.join('\n') ?? '', { textarea: true, placeholder: '기본 화면\n입력 오류\n완료 화면' })}${formField('페이지 경로 (한 줄에 하나)', 'routes', requirement?.workflow?.routes?.join('\n') ?? '', { textarea: true, placeholder: '/\n/register' })}${formField('구현 판단 근거', 'decisionEvidence', requirement?.workflow?.decisions?.[0]?.evidence ?? '', { textarea: true, placeholder: '이 요구사항의 동작과 구현 범위를 직접 확인한 이유를 적으세요.', help: '비워 두면 기존 근거를 유지하며, 새 항목은 입력한 요구사항 확인을 근거로 기록합니다.' })}</div><details><summary>API·데이터 계약과 식별자</summary><div class="setup-grid">${formField('API 동작 (한 줄에 하나)', 'apiContracts', requirement?.workflow?.apiContracts?.join('\n') ?? '', { textarea: true, help: '서버/API 범위를 확인하려면 필요합니다.' })}${formField('데이터 동작 (한 줄에 하나)', 'dataContracts', requirement?.workflow?.dataContracts?.join('\n') ?? '', { textarea: true, help: '데이터베이스/파일 저장 범위를 확인하려면 필요합니다. 편집하지 않은 계약은 유지합니다.' })}${formField('요구사항 ID (선택)', 'requirementId', requirement?.id ?? (mode === 'edit' ? `requirement-${nextId}` : 'requirement-1'), { max: 128, readonly: Boolean(requirement), help: '기존 ID는 유지합니다. 새 항목에는 자동 ID를 쓰거나 원하는 고유 ID를 입력하세요.' })}</div></details><label class="confirmation-field"><input type="checkbox" name="confirmed"/><span>위 사용자 역할·상태·페이지·구현 범위와 계약을 직접 확인했습니다. 변경한 항목은 다시 확인해야 합니다.</span></label><p class="tiny muted">확인하지 않으면 초안/입력 대기로 남습니다. 이 입력은 구현·수집·검증 완료 증거가 아닙니다. 다른 요구사항과 편집하지 않은 계약은 보존합니다.</p><div class="error-box" id="setup-error" role="alert" hidden></div><div class="dialog-actions"><button type="button" data-action="close-setup">닫기</button><button type="submit" class="primary">초안에 적용</button></div>`;
  openPanel(
    'setup-dialog',
    `<form id="guided-setup-form" data-mode="${mode}" data-choice="${escape(selected ?? '__new__')}"><div class="dialog-heading"><h2 id="setup-title">${mode === 'edit' ? '기본 설정·요구사항 편집' : '새 작업 설정'}</h2><button type="button" class="quiet" data-action="close-setup" aria-label="새 작업 설정 닫기">${icon('close')}</button></div><p class="dialog-note">${mode === 'edit' ? '선택한 요구사항과 기본 입력만 초안에서 편집합니다.' : '새 5단계 초안을 만듭니다.'} 저장과 실행은 자동으로 하지 않습니다.</p>${formContent}</form>`,
  );
  const form = document.getElementById('guided-setup-form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(form));
      values.mode = mode;
      values.layers = new FormData(form).getAll('layers');
      values.confirmed = form.elements.confirmed.checked;
      values.addRequirement = mode === 'edit' && form.dataset.choice === '__new__';
      for (const key of [
        'roles',
        'states',
        'routes',
        'apiContracts',
        'dataContracts',
        'decisionEvidence',
      ])
        if (mode === 'edit' && form.elements[key].value === form.elements[key].defaultValue)
          delete values[key];
      if (!values.decisionEvidence) delete values.decisionEvidence;
      state.workflow = createGuidedWorkflow(source, values);
      activity('setup.apply', {
        changedFields: ['name', 'workspaceId', 'designUrl', 'case', 'targetPath', 'requirements'],
        nodeCount: state.workflow.graph.nodes.length,
        edgeCount: state.workflow.graph.edges.length,
      });
      state.selected = state.workflow.graph.nodes.find(node => node.type === 'requirements')?.id;
      state.view = 'builder';
      state.tab = 'configure';
      state.jsonDraft = null;
      if (mode === 'new') state.run = null;
      dirty();
      closePanel('setup-dialog');
      render();
      notify('초안에 반영했습니다. 내용을 확인하고 저장 → 검사 → 실행을 직접 요청하세요.');
    } catch (error) {
      activity('error', { errorCode: error.code ?? 'CLIENT_ERROR' });
      const box = document.getElementById('setup-error');
      box.textContent = error.message;
      box.hidden = false;
    }
  });
  let editedSetup = false;
  const markSetupEdit = event => {
    if (event.target.name !== 'requirementChoice') editedSetup = true;
  };
  form.addEventListener('input', markSetupEdit);
  form.addEventListener('change', markSetupEdit);
  form.elements.requirementChoice?.addEventListener('change', event => {
    if (
      editedSetup ||
      [...form.elements].some(
        element =>
          element.name !== 'requirementChoice' &&
          (element.type === 'checkbox'
            ? element.checked !== element.defaultChecked
            : typeof element.defaultValue === 'string' && element.value !== element.defaultValue),
      )
    ) {
      event.target.value = form.dataset.choice;
      const box = document.getElementById('setup-error');
      box.textContent = '편집한 내용을 먼저 초안에 적용한 뒤 다른 요구사항을 선택하세요.';
      box.hidden = false;
      return;
    }
    setupDialog('edit', event.target.value);
  });
}

function workspaceDialog() {
  const available = state.bootstrap?.service?.readiness?.workspaceRegistrationAvailable === true;
  openPanel(
    'workspace-dialog',
    `<form id="workspace-registration-form"><div class="dialog-heading"><h2 id="workspace-title">작업 공간 등록</h2><button type="button" class="quiet" data-action="close-workspace">닫기</button></div><p class="dialog-note">이미 존재하는 로컬 폴더의 절대 경로를 등록합니다. 폴더 생성이나 기존 등록 변경은 하지 않습니다.</p>${formField('기존 로컬 폴더', 'folder', '', { required: true, placeholder: 'C:\\projects\\my-app' })}${!available ? '<div class="info-box">로컬 서비스 연결과 등록 기능을 먼저 확인하세요.</div>' : ''}<div class="error-box" id="workspace-error" role="alert" hidden></div><div class="dialog-actions"><button type="button" data-action="close-workspace">취소</button><button type="submit" class="primary" ${!available ? 'disabled' : ''}>등록</button></div></form>`,
  );
  document.getElementById('workspace-registration-form').addEventListener('submit', async event => {
    event.preventDefault();
    activity('workspace.register.intent');
    const submit = event.target.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const { workspace } = await api.registerWorkspace(event.target.elements.folder.value.trim());
      if (!workspace?.workspaceId || !workspace?.realPath)
        throw new Error('실제 등록 결과를 확인할 수 없습니다. 연결 상태를 다시 확인하세요.');
      state.bootstrap.workspaces = [
        ...state.bootstrap.workspaces.filter(item => item.workspaceId !== workspace.workspaceId),
        workspace,
      ];
      if (!state.workflow.workspaceId && state.view !== 'live') {
        const pristine = !state.workflow.id && !state.dirty && state.jsonDraft === null;
        state.workflow.workspaceId = workspace.workspaceId;
        if (!pristine) dirty();
      }
      for (const select of document.querySelectorAll(
        '#guided-setup-form select[name=workspaceId],#guided-setup-form select[name=referenceWorkspaceId]',
      )) {
        const previous = select.value;
        select.innerHTML = workspaceOptions()
          .map(([id, label]) => `<option value="${escape(id)}">${escape(label)}</option>`)
          .join('');
        select.value = previous || (select.name === 'workspaceId' ? workspace.workspaceId : '');
      }
      closePanel('workspace-dialog');
      render();
      notify(`등록된 작업 공간: ${workspace.realPath}`);
    } catch (error) {
      activity('error', { errorCode: error.code ?? 'CLIENT_ERROR' });
      const box = document.getElementById('workspace-error');
      box.textContent = `[${error.code ?? '등록 실패'}] ${error.message}`;
      box.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

function decisionsDialog() {
  commitJsonDraft();
  const context = decisionReviewContext(state.run, state.workflow);
  if (!context.available) {
    notify(context.reason, true);
    return;
  }
  if (!context.evidence.length) {
    notify('현재 기록에 미해결 범위가 없습니다. 실제 서비스 상태를 확인하세요.');
    return;
  }
  const disabled = !context.requirements.length;
  openPanel(
    'decision-dialog',
    `<form id="workflow-decision-form" data-analysis-hash="${escape(context.analysisHash)}" data-run-id="${escape(state.run.id)}"><div class="dialog-heading"><h2 id="decision-title">미해결 범위 검토</h2><button type="button" data-action="close-decisions">닫기</button></div><p class="dialog-note">현재 완료된 수집의 실제 근거 ${context.evidence.length}개입니다. 각 항목을 확인된 요구사항에 연결하고 판단을 직접 정하세요. 초안만 변경하며 현재 실행의 승인·완료를 바꾸지 않습니다.</p>${disabled ? '<div class="error-box">확인된 필수 요구사항이 없습니다. 기본 설정·요구사항 편집에서 흐름을 직접 확인한 뒤 검토하세요.</div>' : ''}<div class="decision-cards">${context.evidence
      .map(
        item =>
          `<article class="decision-card" data-decision-evidence="${escape(item.id)}"><h3>${escape(item.labels?.join(' · ') || item.path || item.nodeId || '기록된 범위')}</h3><p class="tiny muted">${escape(item.kind === 'design' ? 'Figma 디자인 근거' : '소스 근거')} · ${escape(item.nodePath || item.path || item.nodeId || '')}</p>${item.rationale ? `<p>${escape(item.rationale)}</p>` : ''}${formField('연결할 확인된 요구사항', 'requirementId', '', { required: true, select: [['', '직접 선택하세요'], ...context.requirements.map(requirement => [requirement.id, `${requirement.id} · ${requirement.description.slice(0, 90)}`])] })}${formField(
            '범위 판단',
            'decision',
            '',
            {
              required: true,
              select: [
                ['', '직접 선택하세요'],
                ['implement', '구현'],
                ['reuse', '재사용'],
                ['extend', '확장'],
              ],
            },
          )}${formField('판단 이유 (20자 이상)', 'rationale', '', { textarea: true, required: true, help: '해당 근거가 요구사항과 어떻게 연결되는지 설명하세요. 재사용·확장에는 실제 소스 근거가 필요합니다.' })}</article>`,
      )
      .join(
        '',
      )}</div><p class="tiny muted">범위 제외는 이 계약의 선택지가 아닙니다. 미해결 범위를 숨기거나 자동 확정하지 않습니다. 수집 근거가 바뀌면 새 근거를 다시 검토해야 합니다.</p><div class="error-box" id="decision-error" role="alert" hidden></div><div class="dialog-actions"><button type="button" data-action="close-decisions">닫기</button><button type="submit" class="primary" ${disabled ? 'disabled' : ''}>검토 내용을 초안에 반영</button></div></form>`,
  );
  document.getElementById('workflow-decision-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (state.run?.id !== event.target.dataset.runId)
        throw new Error('선택한 실행이 변경되었습니다. 검토를 다시 열어 주세요.');
      const choices = [...event.target.querySelectorAll('[data-decision-evidence]')].map(card => ({
        evidenceId: card.dataset.decisionEvidence,
        requirementIds: [card.querySelector('[name=requirementId]').value],
        decision: card.querySelector('[name=decision]').value,
        rationale: card.querySelector('[name=rationale]').value,
      }));
      state.workflow = stageWorkflowDecisions(
        state.workflow,
        state.run,
        event.target.dataset.analysisHash,
        choices,
      );
      activity('decision.review.apply', {
        changedFields: ['workflowDecisions'],
        changeCount: choices.length,
      });
      state.view = 'builder';
      state.tab = 'configure';
      state.jsonDraft = null;
      dirty();
      closePanel('decision-dialog');
      render();
      notify(
        '판단을 초안에 반영했습니다. 저장하고 새 실행을 직접 요청하세요. 원래 실행은 재시도되지 않습니다.',
      );
    } catch (error) {
      activity('error', { errorCode: error.code ?? 'CLIENT_ERROR' });
      const box = document.getElementById('decision-error');
      box.textContent = error.message;
      box.hidden = false;
    }
  });
}

function notify(message, error = false) {
  const element = document.querySelector('#notice');
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle('error', error);
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(
    () => {
      element.hidden = true;
    },
    error ? 10000 : 4500,
  );
}
function report(error) {
  activity('error', { errorCode: error.code ?? 'CLIENT_ERROR' });
  notify(
    `${error.code ? `[${error.code}] ` : ''}${error.message}${error.issues?.length ? ' · ' + error.issues.map(issue => `${issue.path}: ${issue.message}`).join(' · ') : ''}`,
    true,
  );
}
function dirty() {
  state.dirty = true;
  updateSaveState();
  updateChecklist();
}
function updateSaveState() {
  const text = document.querySelector('#save-state');
  if (text)
    text.textContent = state.dirty
      ? '저장되지 않은 변경'
      : state.workflow?.id
        ? `리비전 ${state.workflow.revision} · 저장됨`
        : '아직 저장하지 않은 초안';
}
async function busy(task) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await task();
  } catch (error) {
    report(error);
  } finally {
    state.busy = false;
    render();
  }
}

function sidebar() {
  const live = state.view !== 'builder';
  return `<aside class="sidebar" id="sidebar" aria-label="워크플로 탐색"><div class="sidebar-header"><span class="overline">Workspace</span><span class="tiny muted">LOCAL</span></div><label class="field"><span>작업 공간</span><select data-field="workspaceId"><option value="">작업 공간 선택</option>${state.bootstrap.workspaces.map(workspace => `<option value="${escape(workspace.workspaceId)}" ${state.workflow.workspaceId === workspace.workspaceId ? 'selected' : ''}>${escape(workspace.realPath?.split(/[\\/]/).at(-1) ?? workspace.workspaceId)}</option>`).join('')}</select></label><button class="quiet workspace-register-trigger" data-action="register-workspace" ${state.bootstrap.service.readiness?.workspaceRegistrationAvailable !== true ? 'disabled' : ''}>작업 공간 등록</button><div class="section-label">워크플로 <span>${state.workflows.length}</span></div><div class="workflow-list">${state.workflows.map(workflow => `<button data-open-workflow="${escape(workflow.id)}" class="${state.workflow.id === workflow.id ? 'selected' : ''}">${icon('graph')}${escape(workflow.name)}</button>`).join('') || '<p class="tiny muted">저장된 워크플로가 없습니다.</p>'}</div><div class="workflow-actions"><button data-action="new">${icon('plus')}새 초안</button><button data-action="reload">${icon('refresh')}다시 불러오기</button></div>${
    live
      ? `<div class="section-label">실행 기록 <span>${state.runs.length}</span></div><div class="run-history">${state.runs.map(run => `<button class="run-item ${state.run?.id === run.id ? 'selected' : ''}" data-open-run="${escape(run.id)}"><strong>${escape(run.workflowName)}</strong><span class="run-info"><span>${escape(date(run.createdAt))}</span>${badge(run.status)}</span></button>`).join('') || '<div class="empty-state">아직 실행한 워크플로가 없습니다.<br/>빌더에서 초안을 저장하고 실행하세요.</div>'}</div>`
      : `<div class="section-label">노드 라이브러리 <span>5 유형</span></div><div class="search">${icon('search')}<input id="node-search" aria-label="노드 검색" placeholder="노드 검색…" value="${escape(state.search)}"/></div><div class="palette" style="margin-top:14px">${Object.entries(
          nodeTypes,
        )
          .filter(([, type]) => `${type.label}${type.subtitle}`.includes(state.search))
          .map(
            ([key, type]) =>
              `<button class="palette-button" data-add="${key}" aria-label="${type.label} 노드 추가"><span class="node-icon ${type.color}">${icon(type.icon)}</span><span><strong>${type.label}</strong><small>${type.subtitle}</small></span><span class="plus">+</span></button>`,
          )
          .join(
            '',
          )}</div><div class="sidebar-note"><strong>${icon('info')} 초안에서 시작하세요</strong>설정과 연결을 저장한 뒤 실행하세요. 현재 실행 엔진은 5단계 순차 흐름을 지원합니다. 추가 노드와 분기는 초안에 저장할 수 있으며, 실행 전 검사를 통과해야 합니다.</div>`
  }<div class="connection-card"><div class="connection-title"><span class="local-dot ${state.bootstrap.service.available ? 'online' : ''}"></span>로컬 서비스 ${state.bootstrap.service.available ? '연결됨' : '연결되지 않음'}</div><p>${escape(state.bootstrap.service.message)}</p><p class="browser-readiness" data-browser-state="${escape(state.bootstrap.service.readiness?.browserConnection ?? 'unknown')}">${escape(state.bootstrap.service.readiness?.browserMessage ?? 'Chrome 상태는 실행과 연결 확인에서 확인합니다.')} 연결은 수집 완료가 아닙니다.</p><button class="quiet" data-action="health">${icon('refresh')}연결 확인</button></div></aside>`;
}

function canvas() {
  const live = state.view === 'live';
  return `<main class="main-panel" id="main"><div class="canvas-top"><div class="view-tabs" role="tablist" aria-label="작업 보기"><button role="tab" aria-selected="${!live}" class="${!live ? 'active' : ''}" data-view="builder">${icon('graph')}워크플로 빌더</button><button role="tab" aria-selected="${live}" class="${live ? 'active' : ''}" data-view="live">${icon('pulse')}실행 맵</button></div><div class="canvas-meta">${icon('layers')}<span>${state.workflow.graph.nodes.length} 노드</span><span>${state.workflow.graph.edges.length} 연결</span></div><button class="mobile-toggle icon-button" data-action="sidebar" aria-label="노드 라이브러리 열기">${icon('menu')}</button></div>${live && state.run ? `<div class="run-state-strip"><div>${badge(state.run.status)} <span class="tiny muted">${escape(state.run.id.slice(0, 12))} · 리비전 ${escape(state.run.workflowRevision)}</span></div><button class="quiet tiny" data-action="refresh-run">${icon('refresh')}상태 확인</button></div>` : ''}${!live ? checklist() : ''}<div class="canvas" id="canvas" aria-label="워크플로 캔버스. 배경을 드래그하여 이동하고 노드를 선택하여 설정하세요."><div class="graph-plane" id="graph-plane"><svg class="edge-layer" id="edges" aria-hidden="true"></svg><div id="nodes"></div></div><div class="canvas-banner"><span>${live ? '실제 실행 상태 · 새로고침 3초' : 'WORKFLOW · 미실행 초안'}</span>${state.connectFrom ? '<span class="connect-hint">연결할 노드의 입력 포트를 선택하세요 · Esc 취소</span>' : ''}${live ? `<span class="status-key"><span class="running">실행 중</span><span class="waiting">입력 대기</span><span class="failed">확인 필요</span></span>` : ''}</div><div class="canvas-toolbar" aria-label="캔버스 확대 및 축소"><button data-action="zoom-out" aria-label="축소">${icon('minus')}</button><span class="zoom-value" id="zoom-value"></span><button data-action="zoom-in" aria-label="확대">${icon('plus')}</button><button data-action="fit" aria-label="모든 노드 보기">${icon('fit')}</button></div><span class="canvas-help">드래그로 이동 · 포트로 연결 · 방향키로 노드 이동</span></div>${live ? timeline() : ''}</main>`;
}
function timeline() {
  const events = state.events.filter(
    event => state.filter === 'all' || eventCategory(event) === state.filter,
  );
  return `<section class="timeline" aria-label="실행 이벤트"><div class="timeline-header"><h2>${icon('clock')}실행 타임라인</h2><select class="filter-select" id="event-filter" aria-label="이벤트 필터"><option value="all">전체 이벤트</option><option value="failed" ${state.filter === 'failed' ? 'selected' : ''}>실패</option><option value="waiting" ${state.filter === 'waiting' ? 'selected' : ''}>대기</option><option value="completed" ${state.filter === 'completed' ? 'selected' : ''}>완료</option></select></div>${state.pollError ? `<div class="error-box">${escape(state.pollError)} <button data-action="refresh-run">다시 확인</button></div>` : ''}${
    events.length
      ? events
          .slice(-60)
          .toReversed()
          .map(
            event =>
              `<div class="event-row"><span class="event-dot"></span><time>${escape(event.at || event.timestamp || event.createdAt ? new Date(event.at ?? event.timestamp ?? event.createdAt).toLocaleTimeString('ko-KR', { hour12: false }) : '')}</time><div><strong>${escape(event.message ?? event.type ?? event.kind ?? '서비스 이벤트')}</strong><p>${escape(event.nodeId ?? event.stage ?? '')}${event.data ? ` · ${escape(JSON.stringify(event.data))}` : ''}</p></div></div>`,
          )
          .join('')
      : `<div class="empty-state">${icon('clock')}<p>${state.run ? '아직 기록된 이벤트가 없습니다.' : '실행을 선택하면 실제 서비스 이벤트가 여기에 표시됩니다.'}</p></div>`
  }</section>`;
}

function configure(node) {
  const workflow = state.workflow,
    plan = workflow.plan;
  if (state.view === 'live')
    return `<div class="info-box"><strong>실행 리비전 ${escape(state.run?.workflowRevision ?? '없음')}</strong>실행 맵은 저장된 실행 그래프를 표시합니다. 설정을 변경하려면 워크플로 빌더로 이동하세요. 변경한 설정은 새 실행에 적용됩니다.</div><pre class="json-output">${json(node)}</pre><button data-view="builder">${icon('graph')}빌더에서 설정하기</button>`;
  let content =
    field('워크플로 이름', 'name', workflow.name) + field('노드 이름', 'node.label', node.label);
  if (node.type === 'source') {
    const source =
      plan.design?.source === 'official-mcp'
        ? 'official-mcp'
        : plan.design?.collector === 'scripter'
          ? 'chrome-scripter'
          : 'chrome-page-api';
    content += field('Figma 디자인 URL', 'plan.design.url', plan.design?.url ?? '', {
      placeholder: 'https://www.figma.com/design/…',
      help: '수집할 파일과 node-id 범위를 지정하세요.',
    });
    content += field('수집 경로', 'source', source, {
      select: [
        ['chrome-page-api', 'Chrome · 독립 페이지 API'],
        ['chrome-scripter', 'Chrome · Scripter'],
        ['official-mcp', '공식 Figma MCP'],
      ],
    });
    if (source === 'official-mcp')
      content += field(
        '공식 서버',
        'plan.design.officialEndpoint',
        plan.design?.officialEndpoint ?? 'https://mcp.figma.com/mcp',
        {
          select: [
            ['https://mcp.figma.com/mcp', 'Figma 원격 MCP'],
            ['http://127.0.0.1:3845/mcp', 'Figma Desktop MCP'],
          ],
        },
      );
    content += field(
      '소스 최신성',
      'plan.design.freshness',
      plan.design?.freshness ?? 'require-live',
      {
        select: [
          ['require-live', '실시간 수집 필수'],
          ['allow-pinned', '고정된 소스 허용'],
        ],
      },
    );
    content += `<div class="info-box"><strong>연결과 권한은 실행 중 확인합니다</strong>${source === 'official-mcp' ? '공식 Figma 서버의 승인이 필요합니다. 포털에 로그인 절차는 없으며 Figma 권한은 별도입니다.' : '서비스에 승인된 Chrome 원격 디버깅 연결이 필요합니다. 기존 Figma 창의 권한 승인은 직접 진행해 주세요.'}</div>`;
  }
  if (node.type === 'requirements') {
    content += field('작업 유형', 'plan.case', plan.case ?? 'new-blank', {
      select: [
        ['new-blank', 'Case 4 · 새 프론트엔드'],
        ['new', 'Case 1 · 새 포털'],
        ['legacy', 'Case 2 · 기존 포털 확장'],
        ['new-reference', 'Case 3 · 참조 기반 새 포털'],
      ],
    });
    content += field('대상 경로', 'plan.targetPath', plan.targetPath ?? '', {
      placeholder: 'apps/portal',
      help: '작업 공간 안의 상대 경로. 기존 포털 확장에 필요합니다.',
    });
    const requirement = plan.requirements?.[0];
    content += field('요구사항', 'requirement.description', requirement?.description ?? '', {
      textarea: true,
      help: '저장한 요구사항은 서비스 실행 계획에 전달됩니다.',
    });
    content += field(
      '구현 범위',
      'requirement.layers',
      (requirement?.layers ?? ['frontend']).join(','),
      { help: '쉼표로 구분: frontend, backend, api, database 등. Case 4는 frontend만 지원합니다.' },
    );
    if (plan.case === 'new-reference')
      content +=
        field('참조 작업 공간', 'reference.workspaceId', plan.references?.[0]?.workspaceId ?? '', {
          select: [
            ['', '참조 작업 공간 선택'],
            ...state.bootstrap.workspaces.map(space => [space.workspaceId, space.realPath]),
          ],
          help: '선택한 작업 공간을 primary 참조로 사용합니다.',
        }) +
        field('참조 경로', 'reference.rootPath', plan.references?.[0]?.rootPath ?? '.', {
          help: '참조 작업 공간 안의 상대 경로입니다.',
        });
    content += `<details ${state.jsonDraft !== null ? 'open' : ''}><summary class="tiny muted">구조화된 요구사항 및 업무 흐름</summary>${field('서비스 요구사항 JSON', 'requirements-json', state.jsonDraft ?? JSON.stringify(plan.requirements ?? [], null, 2), { textarea: true, json: true, help: 'roles, states, routes, API 및 데이터 계약을 확인하고 workflow.status를 confirmed로 설정하세요. 부족한 정보는 실행 시 입력 대기로 표시됩니다.' })}</details>`;
  }
  if (node.type === 'generation') {
    content += field('프론트엔드 스택', 'plan.stack', plan.stack ?? 'auto', {
      select: [
        ['auto', '서비스가 계획에서 결정'],
        ['react-vite', 'React + Vite'],
        ['vue-vite', 'Vue + Vite'],
      ],
    });
    content += `<div class="info-box"><strong>코딩 에이전트가 필요합니다</strong>실행 시작은 코드 생성 완료를 의미하지 않습니다. 서비스가 코딩 임대를 발급하면 실행 맵에서 컨텍스트를 확인하고 에이전트 결과를 제출할 수 있습니다.</div>`;
  }
  if (node.type === 'validation') {
    content += field('검증 프로필 ID', 'node.profileId', node.config?.profileId ?? '', {
      help: '비워 두면 서비스 기본 프로필을 사용합니다. 저장한 값은 검증 단계에 전달됩니다.',
    });
    content += `<div class="info-box"><strong>기록된 검증 결과를 확인하세요</strong>후보 결과와 적용 결과는 별도로 검증합니다. 브라우저 검증은 서비스가 소유한 Google Chrome에서 실행합니다.</div>`;
  }
  if (node.type === 'output')
    content +=
      `<div class="info-box"><strong>검토 후 명시적으로 적용합니다</strong>검증과 승인 조건을 통과한 후보에만 적용 동작이 열립니다. 결과가 불명확한 작업은 자동으로 재시도하지 않습니다.</div>` +
      field('워크플로 설명', 'description', workflow.description ?? '', { textarea: true });
  content += `<hr class="inspector-divider"/><div class="section-label" style="margin-top:0">연결 설정</div><label class="field"><span>다음 노드</span><select id="connect-target"><option value="">연결할 노드 선택</option>${workflow.graph.nodes
    .filter(item => item.id !== node.id)
    .map(item => `<option value="${escape(item.id)}">${escape(item.label)}</option>`)
    .join(
      '',
    )}</select></label><button data-action="connect-selected">${icon('link')}연결 추가</button>${workflow.graph.edges
    .filter(edge => edge.source === node.id || edge.target === node.id)
    .map(
      edge =>
        `<div class="schema-row"><span>${escape(workflow.graph.nodes.find(item => item.id === edge.source)?.label)} → ${escape(workflow.graph.nodes.find(item => item.id === edge.target)?.label)}</span><button class="quiet icon-button" data-remove-edge="${escape(edge.id)}" aria-label="이 연결 삭제">${icon('close')}</button></div>`,
    )
    .join(
      '',
    )}<div class="node-position-controls" aria-label="선택한 노드 위치 이동"><button data-nudge="-20,0" aria-label="왼쪽으로 이동">←</button><button data-nudge="0,-20" aria-label="위로 이동">↑</button><button data-nudge="0,20" aria-label="아래로 이동">↓</button><button data-nudge="20,0" aria-label="오른쪽으로 이동">→</button><button class="quiet danger" data-action="remove-node">${icon('trash')}노드 삭제</button></div>`;
  return content;
}
function schema(node) {
  const fields = [
    ['nodeId', 'string'],
    ['type', 'string'],
    ['status', 'pending | active | waiting | completed | failed | unknown'],
    ['message', 'string'],
  ];
  return `<div class="info-box"><strong>서비스 응답 계약</strong>단계 상태는 아래 필드로 기록됩니다. 실행의 context와 result는 서비스가 반환한 객체이며, outputs는 실제 결과 목록입니다.</div>${fields.map(([name, type]) => `<div class="schema-row"><code>${name}</code><span>${type}</span></div>`).join('')}<div class="section-label">선택한 단계의 실제 응답</div>${nodeRun(node.id) ? `<pre class="json-output">${json(nodeRun(node.id))}</pre>` : '<div class="empty-state">기록된 단계 응답이 없습니다.</div>'}<div class="section-label">실제 기록된 출력</div>${state.run?.outputs?.length ? `<pre class="json-output">${json(state.run.outputs)}</pre>` : '<div class="empty-state">기록된 출력이 없습니다.</div>'}`;
}
function testPanel(node) {
  if (!state.run)
    return `<div class="empty-state">${icon('play')}<p>저장한 워크플로를 실행하면 단계별 상태와 결과를 확인할 수 있습니다.</p></div><button class="primary" data-action="start" ${state.busy || !state.bootstrap.service.available ? 'disabled' : ''}>${icon('play')}저장 후 실행</button>`;
  const status = nodeRun(node.id);
  const coverage = decisionReviewContext(state.run, state.workflow);
  const actionRows = actions =>
    actions
      .map(
        action =>
          `<div class="action-row"><button data-run-action="${escape(action.action)}" ${!action.enabled || state.busy ? 'disabled' : ''}>${icon(action.action === 'cancel' ? 'close' : action.action === 'refresh' ? 'refresh' : 'arrow')}${escape(actionLabels[action.action] ?? action.action)}</button>${action.reason ? `<small>${escape(action.reason)}</small>` : ''}</div>`,
      )
      .join('');
  const commonActions = actionRows(
    (state.run.actions ?? []).filter(action => !['next', 'submit'].includes(action.action)),
  );
  const advancedActions = `<details class="advanced-coding"><summary>고급: 현재 웹 연결에서 코딩</summary><p>웹 연결의 코딩 임대를 다른 MCP 연결에 전달하지 마세요. 일반적인 외부 에이전트 작업은 실행 ID 전달 방식으로 시작합니다.</p>${actionRows((state.run.actions ?? []).filter(action => ['next', 'submit'].includes(action.action)))}</details>`;
  const decisionPanel = `<div class="info-box"><strong>수집 후 범위 확인</strong><p>${coverage.available ? `현재 미해결 근거 ${coverage.evidence.length}개를 요구사항에 직접 연결하세요.` : escape(coverage.reason)}</p><button data-action="review-decisions" ${!coverage.available || !coverage.evidence.length || state.busy ? 'disabled' : ''}>미해결 범위 검토</button></div>`;
  const handoff = `<div class="info-box"><strong>외부 코딩 에이전트에게 이어서 작업 요청</strong><p>실행 ID와 작업 공간을 전달합니다. 에이전트가 자신의 MCP/CLI 연결에서 컨텍스트·임대를 요청하고 같은 연결로 제출해야 합니다. 이미 웹 임대가 있으면 서비스에서 유효 처리를 먼저 확인하세요.</p><button data-action="copy-agent-handoff">에이전트 전달 정보</button><p class="tiny">에이전트 작업 후 ‘서비스 상태 확인’을 누르세요. 3초 갱신은 포털 기록만 읽습니다.</p></div>`;
  return `${state.run.error ? `<div class="error-box"><strong>${escape(state.run.error.code)}</strong><p>${escape(state.run.error.message)}</p><button data-action="usage-guide">오류 다음 단계 안내</button></div>` : ''}<div class="info-box"><strong>${badge(status?.status)} ${escape(node.label)}</strong>${escape(status?.message ?? '이 노드의 실행 정보가 아직 없습니다.')}</div>${decisionPanel}${handoff}<div class="section-label">사용 가능한 실행 동작</div><div class="action-list">${commonActions}</div>${advancedActions}${state.run.context ? `<details><summary class="tiny muted">고급: 현재 웹 연결의 컨텍스트 기록</summary><p>다른 MCP 연결에 임대를 복사하지 마세요.</p><pre class="json-output">${json(state.run.context)}</pre><button data-action="copy-context">컨텍스트 복사</button></details>` : ''}${state.run.result ? `<details><summary class="tiny muted">서비스 결과와 근거</summary><pre class="json-output">${json(state.run.result)}</pre></details>` : ''}${state.run.approvals?.length ? `<details open><summary class="tiny muted">승인 요청</summary><pre class="json-output">${json(state.run.approvals)}</pre></details>` : ''}`;
}
function inspector() {
  const node = selectedNode();
  if (!node)
    return `<aside class="inspector" aria-label="노드 설정"><div class="inspector-header"><span class="overline">Inspector</span><h2 style="margin-top:15px">노드를 선택하세요</h2></div><div class="inspector-body empty-state">캔버스의 노드를 선택하면<br/>설정, 출력 계약과 실행 정보를 볼 수 있습니다.</div></aside>`;
  const type = nodeTypes[node.type];
  return `<aside class="inspector" aria-label="선택한 노드 설정"><div class="inspector-header"><span class="overline">Selected node</span><div class="inspector-title"><span class="node-icon ${type.color}">${icon(type.icon)}</span><div><h2>${escape(node.label)}</h2><p>${escape(type.subtitle)}</p></div></div><div class="inspector-tabs" role="tablist" aria-label="노드 정보"><button role="tab" aria-selected="${state.tab === 'configure'}" data-tab="configure" class="${state.tab === 'configure' ? 'active' : ''}">설정</button><button role="tab" aria-selected="${state.tab === 'schema'}" data-tab="schema" class="${state.tab === 'schema' ? 'active' : ''}">출력 스키마</button><button role="tab" aria-selected="${state.tab === 'test'}" data-tab="test" class="${state.tab === 'test' ? 'active' : ''}">실행 정보</button></div></div><div class="inspector-body">${state.tab === 'configure' ? configure(node) : state.tab === 'schema' ? schema(node) : testPanel(node)}</div><div class="inspector-footer"><span>${icon('layers')} ${escape(node.type)}</span><span>설정은 워크플로에 저장됩니다</span></div></aside>`;
}

function render() {
  const activityFocus = retainActivityFilterInput();
  viewCleanup?.();
  viewCleanup = null;
  const mountEpoch = ++viewMountEpoch;
  if (!state.workflow || !state.bootstrap) return;
  app.innerHTML = `<div class="app-shell"><aside class="rail" aria-label="주 탐색"><div class="brand-mark" aria-label="Super Figma Pipeline">S</div><nav><button class="rail-button ${state.view === 'builder' ? 'active' : ''}" data-view="builder" aria-label="워크플로 빌더">${icon('graph')}빌더</button><button class="rail-button ${state.view === 'live' ? 'active' : ''}" data-view="live" aria-label="실행 맵">${icon('pulse')}실행</button><button class="rail-button ${state.view === 'functions' ? 'active' : ''}" data-view="functions" aria-label="서비스 기능">${icon('menu')}서비스 기능</button><button class="rail-button ${state.view === 'settings' ? 'active' : ''}" data-view="settings" aria-label="연결 설정">${icon('link')}연결 설정</button><button class="rail-button ${state.view === 'admin' ? 'active' : ''}" data-view="admin" aria-label="관리">${icon('box')}관리</button></nav><button class="rail-button ${state.view === 'activities' ? 'active' : ''}" data-view="activities" aria-label="활동 기록">${icon('clock')}활동 기록</button><div class="rail-bottom"><span class="local-dot ${state.bootstrap.service.available ? 'online' : ''}"></span><span class="tiny muted">LOCAL</span></div></aside><header class="topbar"><div><div class="breadcrumb"><span class="brand-name">Super Figma Pipeline</span><span>›</span><span>워크플로</span></div><div class="title-row"><h1>${escape(state.workflow.name)}</h1>${badge(state.workflow.id ? null : 'draft', state.workflow.id ? '저장된 초안' : '초안')}</div></div><div class="top-actions"><button class="quiet" data-action="usage-guide">${icon('info')}사용 가이드</button>${state.activityLost || state.activityError ? '<button class="activity-warning" data-view="activities">활동 기록 경고</button>' : ''}<span class="save-state" id="save-state"></span><button data-action="check" ${state.busy ? 'disabled' : ''}>${icon('check')}검사</button><button data-action="save" ${state.busy ? 'disabled' : ''}>${icon('save')}${state.busy ? '처리 중…' : '저장'}</button><button class="primary" data-action="start" ${state.busy || !state.bootstrap.service.available ? 'disabled' : ''} title="${state.bootstrap.service.available ? '저장한 그래프와 설정으로 실제 서비스 실행' : '로컬 서비스 연결이 필요합니다'}">${icon('play')}실행</button></div></header>${sidebar()}${['settings', 'functions', 'admin'].includes(state.view) ? modulePanel() : state.view === 'activities' ? activityPanel() : canvas()}${['settings', 'functions', 'admin'].includes(state.view) ? '<aside class="inspector activity-info"><h2>실제 서비스 권한</h2><p>설정 저장과 요청 처리 성공은 전체 수집·코드 구현 완료 증거가 아닙니다. 연결 조건과 실제 승인 범위를 확인하세요.</p><p>이 보기는 수정 중인 워크플로 초안을 유지합니다.</p></aside>' : state.view === 'activities' ? '<aside class="inspector activity-info"><h2>기록의 의미</h2><p>사용자 입력 의도와 실제 서버 결과는 다른 출처로 표시됩니다. 일반 새로고침은 기록을 읽을 뿐 코드를 생성하지 않습니다.</p><p>원문 입력·헤더·비밀번호·토큰·코딩 임대·코드는 활동 기록으로 보내지 않습니다. 필터 변경과 기록 보기에서도 수정 중인 초안을 보존합니다.</p></aside>' : inspector()}</div>`;
  document.querySelector('[data-field="workspaceId"]').disabled = state.view !== 'builder';
  if (state.busy) {
    app.querySelectorAll('button,input,select,textarea').forEach(element => {
      element.disabled = true;
    });
    app
      .querySelectorAll('[data-node]')
      .forEach(element => element.setAttribute('aria-disabled', 'true'));
    app.querySelector('[data-action="usage-guide"]').disabled = false;
  }
  updateSaveState();
  const filterForm = document.getElementById('activity-filter-form');
  const retainDraft = () => {
    state.activityFilterDraft = readActivityFilterDraft(filterForm);
  };
  filterForm?.addEventListener('input', retainDraft);
  filterForm?.addEventListener('change', retainDraft);
  filterForm?.addEventListener('submit', async event => {
    event.preventDefault();
    activity('view.change', { view: 'activities', hasValue: true });
    const draft = readActivityFilterDraft(event.target);
    state.activityFilterDraft = draft;
    try {
      state.activityFilters = {
        ...draft,
        ...(draft.fromLocal ? { from: new Date(draft.fromLocal).toISOString() } : {}),
        ...(draft.toLocal ? { to: new Date(draft.toLocal).toISOString() } : {}),
      };
      await loadActivities();
    } catch {
      state.activityError = '필터의 날짜와 시간을 확인하세요.';
      render();
    }
  });
  renderGraph();
  bindCanvas();
  const activityField = activityFocus && filterForm?.elements.namedItem(activityFocus.name);
  if (activityField?.focus) {
    activityField.focus({ preventScroll: true });
    if (typeof activityFocus.start === 'number' && typeof activityFocus.end === 'number')
      activityField.setSelectionRange(
        activityFocus.start,
        activityFocus.end,
        activityFocus.direction,
      );
  }
  void mountModuleView(mountEpoch);
}
function renderGraph() {
  const workflow = state.workflow;
  if (!workflow || !document.querySelector('#graph-plane')) return;
  const { nodes, edges, viewport } = activeGraph();
  document.querySelector('#graph-plane').style.transform =
    `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`;
  document.querySelector('#zoom-value').textContent = `${Math.round(viewport.zoom * 100)}%`;
  document.querySelector('#nodes').innerHTML = nodes
    .map((node, index) => {
      const type = nodeTypes[node.type],
        execution = state.view === 'live' ? nodeRun(node.id) : null;
      let sub = type.subtitle;
      if (node.type === 'source')
        sub =
          state.workflow.plan.design?.source === 'official-mcp'
            ? 'Official Figma MCP'
            : state.workflow.plan.design?.collector === 'scripter'
              ? 'Chrome · Scripter'
              : 'Chrome · Page API';
      if (state.view === 'live') sub = `실행 리비전 ${state.run?.workflowRevision ?? '없음'}`;
      return `<article class="workflow-node ${node.id === state.selected ? 'selected' : ''} ${escape(execution?.status ?? '')}" data-node="${escape(node.id)}" style="left:${node.position.x}px;top:${node.position.y}px" role="button" tabindex="0" aria-label="${escape(node.label)}, ${escape(labels[execution?.status] ?? '미실행')}. 선택하여 설정, 방향키로 위치 이동."><button class="port in" data-port-in="${escape(node.id)}" ${state.view === 'live' ? 'disabled' : ''} aria-label="${escape(node.label)} 입력 포트"></button><div class="node-kicker">${String(index + 1).padStart(2, '0')} · ${escape(node.type)}</div><div class="node-main"><span class="node-icon ${type.color}">${icon(type.icon)}</span><div><strong>${escape(node.label)}</strong><p>${escape(sub)}</p></div></div><div class="node-footer"><span>${escape(execution?.message ? execution.message.slice(0, 26) : state.view === 'live' ? '실행 기록 없음' : '설정 가능')}</span>${badge(execution?.status)}</div><button class="port out ${state.connectFrom === node.id ? 'connecting' : ''}" data-port-out="${escape(node.id)}" ${state.view === 'live' ? 'disabled' : ''} aria-label="${escape(node.label)} 출력 포트"></button></article>`;
    })
    .join('');
  document.querySelector('#edges').innerHTML = edges
    .map(edge => {
      const from = nodes.find(node => node.id === edge.source),
        to = nodes.find(node => node.id === edge.target);
      if (!from || !to) return '';
      const x1 = from.position.x + 236,
        y1 = from.position.y + 74,
        x2 = to.position.x,
        y2 = to.position.y + 74;
      const bend = Math.max(70, Math.abs(x2 - x1) * 0.48);
      const middleY = y1 === y2 ? y1 - 105 : (y1 + y2) / 2;
      const path =
        x2 > x1
          ? `M ${x1} ${y1} C ${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1 + 40} ${y1},${x1 + 40} ${middleY},${x1} ${middleY} L ${x2} ${middleY} C ${x2 - 40} ${middleY},${x2 - 40} ${y2},${x2} ${y2}`;
      return `<path class="edge ${edge.source === state.selected || edge.target === state.selected ? 'selected' : ''} ${state.view === 'live' && nodeRun(edge.target)?.status === 'active' ? 'active' : ''}" d="${path}"/><circle class="edge-dot" cx="${x2}" cy="${y2}" r="3"/>`;
    })
    .join('');
}

function bindCanvas() {
  const canvasElement = document.querySelector('#canvas');
  if (!canvasElement) return;
  let drag = null;
  canvasElement.addEventListener('pointerdown', event => {
    if (state.busy || event.button !== 0 || event.target.closest('button')) return;
    const nodeElement = event.target.closest('[data-node]');
    const viewport = activeGraph().viewport;
    const node = nodeElement
      ? activeGraph().nodes.find(item => item.id === nodeElement.dataset.node)
      : null;
    if (node) activity('node.select', { nodeId: node.id, nodeType: node.type });
    drag = {
      node,
      startX: event.clientX,
      startY: event.clientY,
      x: node?.position.x ?? viewport.x,
      y: node?.position.y ?? viewport.y,
      moved: false,
      pointerId: event.pointerId,
    };
    canvasElement.setPointerCapture(event.pointerId);
    canvasElement.classList.add('dragging');
  });
  canvasElement.addEventListener('pointermove', event => {
    if (!drag || state.busy) return;
    if (drag.node && state.view === 'live') return;
    const viewport = activeGraph().viewport;
    const dx = event.clientX - drag.startX,
      dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.node) {
      if (state.view === 'live') return;
      moveNode(
        state.workflow,
        drag.node.id,
        drag.x + dx / state.workflow.graph.viewport.zoom,
        drag.y + dy / state.workflow.graph.viewport.zoom,
      );
    } else {
      if (state.view === 'live')
        state.liveViewport = { ...viewport, x: drag.x + dx, y: drag.y + dy };
      else {
        state.workflow.graph.viewport.x = drag.x + dx;
        state.workflow.graph.viewport.y = drag.y + dy;
      }
    }
    if (state.view !== 'live') dirty();
    renderGraph();
  });
  const finish = () => {
    if (!drag) return;
    const selection = drag.node?.id;
    if (drag.moved)
      activity(drag.node ? 'node.move' : 'graph.reset', {
        nodeId: selection,
        field: drag.node ? 'nodes' : 'viewport',
      });
    drag = null;
    canvasElement.classList.remove('dragging');
    if (selection) {
      state.selected = selection;
      render();
    }
  };
  canvasElement.addEventListener('pointerup', finish);
  canvasElement.addEventListener('pointercancel', finish);
  canvasElement.addEventListener(
    'wheel',
    event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    },
    { passive: false },
  );
}
function zoom(factor, clientX, clientY) {
  deferredActivity('zoom', 'graph.zoom', { field: 'viewport' });
  if (state.busy) return;
  const element = document.querySelector('#canvas'),
    rect = element.getBoundingClientRect(),
    view = { ...activeGraph().viewport };
  const x = (clientX ?? rect.left + rect.width / 2) - rect.left,
    y = (clientY ?? rect.top + rect.height / 2) - rect.top;
  const next = Math.max(0.25, Math.min(1.6, view.zoom * factor));
  view.x = x - ((x - view.x) * next) / view.zoom;
  view.y = y - ((y - view.y) * next) / view.zoom;
  view.zoom = next;
  if (state.view === 'live') state.liveViewport = view;
  else {
    state.workflow.graph.viewport = view;
    dirty();
  }
  renderGraph();
}
function fit(markDirty = true) {
  const element = document.querySelector('#canvas'),
    nodes = activeGraph().nodes;
  if (!element || !nodes.length) return;
  const minX = Math.min(...nodes.map(node => node.position.x)),
    minY = Math.min(...nodes.map(node => node.position.y));
  const width = Math.max(...nodes.map(node => node.position.x + 236)) - minX,
    height = Math.max(...nodes.map(node => node.position.y + 145)) - minY;
  const zoomValue = Math.max(
    0.25,
    Math.min(1, (element.clientWidth - 100) / width, (element.clientHeight - 140) / height),
  );
  const viewport = {
    x: (element.clientWidth - width * zoomValue) / 2 - minX * zoomValue,
    y: (element.clientHeight - height * zoomValue) / 2 - minY * zoomValue,
    zoom: zoomValue,
  };
  if (state.view === 'live') state.liveViewport = viewport;
  else {
    state.workflow.graph.viewport = viewport;
    if (markDirty) dirty();
  }
  renderGraph();
}

function commitJsonDraft() {
  if (state.jsonDraft === null) return;
  applyRequirementsDraft(state.workflow, state.jsonDraft);
  state.jsonDraft = null;
}
async function save() {
  commitJsonDraft();
  const input = workflowInput(state.workflow);
  const saved = await api.save(
    state.workflow.id
      ? { ...input, id: state.workflow.id, revision: state.workflow.revision }
      : input,
  );
  state.workflow = saved;
  state.dirty = false;
  state.workflows = (await api.workflows()).workflows;
  notify('워크플로와 설정을 저장했습니다.');
  return saved;
}
async function openRun(id) {
  const run = await api.run(id);
  if (state.workflow.id !== run.workflowId) {
    if (state.dirty)
      throw new Error('변경한 초안을 먼저 저장하거나 다시 불러온 뒤 다른 실행을 선택하세요.');
    state.workflow = await api.workflow(run.workflowId);
    state.selected = state.workflow.graph.nodes[0]?.id ?? null;
  }
  state.run = run;
  state.selected = run.graph?.nodes[0]?.id ?? state.selected;
  state.events = [];
  state.cursor = 0;
  state.pollError = null;
  state.liveViewport = null;
  state.view = 'live';
  state.tab = 'test';
  await poll();
}
async function poll() {
  if (!state.run || state.busy || poll.active) return;
  poll.active = true;
  const id = state.run.id;
  try {
    const [run, data] = await Promise.all([api.run(id), api.events(id, state.cursor)]);
    if (state.run?.id !== id) return;
    state.run = run;
    state.events.push(...data.events);
    state.events = state.events.slice(-200);
    state.cursor = data.nextCursor;
    state.pollError = null;
    const index = state.runs.findIndex(item => item.id === id);
    if (index >= 0) state.runs[index] = run;
    if (
      state.view === 'live' &&
      !document.activeElement?.matches('input,textarea,select') &&
      !document.querySelector('#action-dialog').open
    ) {
      renderGraph();
      const timelineElement = document.querySelector('.timeline');
      if (timelineElement) timelineElement.outerHTML = timeline();
      if (state.tab === 'test') {
        const body = document.querySelector('.inspector-body');
        if (body && selectedNode()) body.innerHTML = testPanel(selectedNode());
      }
      const strip = document.querySelector('.run-state-strip');
      if (strip)
        strip.querySelector('div').innerHTML =
          `${badge(run.status)} <span class="tiny muted">${escape(run.id.slice(0, 12))} · 리비전 ${escape(run.workflowRevision)}</span>`;
    }
  } catch (error) {
    if (state.run?.id === id) {
      state.pollError = error.message;
      const timelineElement = document.querySelector('.timeline');
      if (timelineElement) timelineElement.outerHTML = timeline();
    }
  } finally {
    poll.active = false;
  }
}

function editField(element) {
  if (state.busy || state.view === 'live') return;
  const name = element.dataset.field,
    value = element.value,
    workflow = state.workflow,
    node = selectedNode();
  try {
    if (name === 'workspaceId') workflow.workspaceId = value || null;
    else if (name === 'name') {
      workflow.name = value;
      const title = document.querySelector('.title-row h1');
      if (title) title.textContent = value;
    } else if (name === 'node.label') node.label = value;
    else if (name === 'node.profileId') {
      if (value) node.config.profileId = value;
      else delete node.config.profileId;
    } else if (name === 'description') workflow.description = value;
    else if (name === 'source') {
      workflow.plan.design.source = value === 'official-mcp' ? 'official-mcp' : 'chrome';
      if (value !== 'official-mcp')
        workflow.plan.design.collector = value === 'chrome-scripter' ? 'scripter' : 'page-api';
      else delete workflow.plan.design.collector;
      if (value !== 'official-mcp') delete workflow.plan.design.officialEndpoint;
    } else if (name === 'requirements-json') {
      state.jsonDraft = value;
      commitJsonDraft();
    } else if (name.startsWith('requirement.')) {
      workflow.plan.requirements ??= [];
      workflow.plan.requirements[0] ??= {
        id: 'requirement-1',
        description: '',
        layers: ['frontend'],
        required: true,
      };
      if (name === 'requirement.layers')
        workflow.plan.requirements[0].layers = value
          .split(',')
          .map(item => item.trim())
          .filter(Boolean);
      else workflow.plan.requirements[0].description = value;
    } else if (name.startsWith('reference.')) {
      workflow.plan.references ??= [];
      workflow.plan.references[0] ??= { workspaceId: '', rootPath: '.', role: 'primary' };
      workflow.plan.references[0][name.split('.')[1]] = value;
    } else if (name.startsWith('plan.')) {
      setPlanField(workflow, name.slice(5), value || undefined);
      if (name === 'plan.case' && value === 'new-blank') workflow.plan.references = [];
    }
    dirty();
    renderGraph();
    if (name === 'source' || name === 'plan.case') render();
    element.removeAttribute('aria-invalid');
  } catch (error) {
    element.setAttribute('aria-invalid', 'true');
    report(error);
  }
}

function actionDialog(action) {
  const dialog = document.querySelector('#action-dialog');
  const defaults = {
    next: {},
    submit: {
      leaseId: '',
      leaseEpoch: 0,
      blueprintHash: '',
      contextHash: '',
      files: [],
      assets: [],
      finished: false,
    },
    validate: {
      target: 'candidate',
      ...(selectedNode()?.config?.profileId ? { profileId: selectedNode().config.profileId } : {}),
    },
    resume: { reconcile: 'inspect' },
    apply: {},
    cancel: {},
    refresh: {},
  };
  const simple = ['apply', 'cancel', 'refresh'].includes(action);
  const requiresApproval = ['approve', 'reject'].includes(action);
  const prompts = requiresApproval ? pendingApprovals(state.run) : [];
  const approvalSelection =
    prompts.length > 1
      ? `<label class="field"><span>검토할 승인 요청</span><select id="approval-choice">${prompts.map((prompt, index) => `<option value="${index}">${escape(prompt.target?.label ?? prompt.operationName ?? `승인 요청 ${index + 1}`)}</option>`).join('')}</select></label>`
      : '';
  const argumentContent = requiresApproval
    ? `${approvalSelection}<div id="approval-summary"></div>`
    : !simple
      ? `<label class="field"><span>동작 인자 JSON</span><textarea id="action-args" class="code" spellcheck="false">${json(defaults[action] ?? {})}</textarea><small>${['next', 'submit'].includes(action) ? '현재 웹 연결 안에서만 사용하는 고급 동작입니다. 웹에서 받은 임대를 외부 MCP/CLI 연결로 복사하지 마세요. 일반 코딩 에이전트는 전달 정보의 실행 ID로 자신이 연결한 세션에서 컨텍스트를 요청하고 결과를 제출해야 합니다.' : '잘못된 인자는 서비스가 거절하며 자동 재시도하지 않습니다.'}</small></label>`
      : '';
  dialog.innerHTML = `<form id="run-action-form"><div class="dialog-heading"><h2>${escape(actionLabels[action] ?? action)}</h2><button type="button" class="quiet icon-button" data-action="close-dialog" aria-label="닫기">${icon('close')}</button></div><p class="dialog-note">${requiresApproval ? '현재 실행에서 요청한 영향 범위를 확인하고 승인 또는 거절하세요. 선택한 요청을 서비스가 다시 확인합니다.' : action === 'apply' ? '현재 실행의 검증된 후보 결과를 작업 공간에 적용합니다. 서비스가 승인과 최신성을 다시 확인합니다.' : action === 'cancel' ? '현재 실행에 취소를 요청합니다. 이미 시작한 변경의 결과는 서비스 상태에서 확인하세요.' : '현재 실행에 서비스 동작을 명시적으로 요청합니다. 실제 서비스가 허용하는 인자를 입력하세요.'}</p>${argumentContent}<div class="error-box" id="dialog-error" hidden></div><div class="dialog-actions"><button type="button" data-action="close-dialog">닫기</button><button class="primary" type="submit" ${requiresApproval && !prompts.length ? 'disabled' : ''}>${escape(actionLabels[action] ?? action)} 요청</button></div></form>`;
  const drawApproval = () => {
    const prompt = prompts[Number(document.querySelector('#approval-choice')?.value ?? 0)];
    document.querySelector('#approval-summary').innerHTML = prompt
      ? `<div class="info-box"><strong>영향 범위</strong><p>${escape(prompt.target?.label ?? '대상 범위 정보가 없습니다.')}</p><p class="tiny">${escape(prompt.operationName ?? '서비스 작업')} · 만료 ${escape(date(Number(prompt.expiresAt)))}</p>${Array.isArray(prompt.effectSummary) && prompt.effectSummary.length ? `<ul class="issue-list">${prompt.effectSummary.map(effect => `<li>${escape(effect)}</li>`).join('')}</ul>` : '<p>기록된 영향 요약이 없습니다.</p>'}</div><details><summary class="tiny muted">승인 요청의 상세 기록</summary><pre class="json-output">${json(prompt)}</pre></details>`
      : '<div class="error-box">현재 실행에 유효한 승인 요청이 없습니다. 실행 상태를 다시 확인하세요.</div>';
  };
  if (requiresApproval) {
    drawApproval();
    document.querySelector('#approval-choice')?.addEventListener('change', drawApproval);
  }
  dialog.showModal();
  document.querySelector('#run-action-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      let args;
      if (requiresApproval) {
        const prompt = prompts[Number(document.querySelector('#approval-choice')?.value ?? 0)];
        if (
          !prompt ||
          !pendingApprovals(state.run).some(item => item.approvalId === prompt.approvalId)
        )
          throw new Error(
            '승인 요청이 만료되었거나 현재 실행에 속하지 않습니다. 상태를 다시 확인하세요.',
          );
        args = { approvalId: prompt.approvalId };
      } else args = simple ? {} : JSON.parse(document.querySelector('#action-args').value);
      if (!args || typeof args !== 'object' || Array.isArray(args))
        throw new Error('인자는 JSON 객체여야 합니다.');
      state.run = await api.action(state.run.id, action, args);
      dialog.close();
      notify('동작을 요청했습니다. 실행 상태에서 결과를 확인하세요.');
      render();
      await poll();
    } catch (error) {
      activity('error', { errorCode: error.code ?? 'CLIENT_ERROR' });
      const box = document.querySelector('#dialog-error');
      box.hidden = false;
      box.textContent = `${error.code ?? ''} ${error.message}`;
    } finally {
      submit.disabled = false;
    }
  });
}

document.addEventListener('click', async event => {
  const guideLink = event.target.closest('#usage-guide-dialog a[href^="#guide-"]');
  if (guideLink) activity('guide.step', { step: guideLink.getAttribute('href').slice(1) });
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  trackButton(button);
  if (button.dataset.view) {
    state.view = button.dataset.view;
    if (state.view === 'live') state.tab = 'test';
    render();
    if (state.view === 'activities') await loadActivities();
    return;
  }
  if (button.dataset.tab) {
    state.tab = button.dataset.tab;
    render();
    return;
  }
  if (button.dataset.add) {
    const node = addNode(state.workflow, button.dataset.add);
    state.selected = node.id;
    dirty();
    render();
    return;
  }
  if (button.dataset.portOut) {
    state.connectFrom = button.dataset.portOut;
    render();
    return;
  }
  if (button.dataset.portIn) {
    if (!state.connectFrom) {
      notify('먼저 연결을 시작할 출력 포트를 선택하세요.');
      return;
    }
    try {
      connectNodes(state.workflow, state.connectFrom, button.dataset.portIn);
      activity('graph.connect');
      state.connectFrom = null;
      dirty();
      render();
    } catch (error) {
      report(error);
    }
    return;
  }
  if (button.dataset.removeEdge) {
    state.workflow.graph.edges = state.workflow.graph.edges.filter(
      edge => edge.id !== button.dataset.removeEdge,
    );
    dirty();
    render();
    return;
  }
  if (button.dataset.nudge) {
    const [x, y] = button.dataset.nudge.split(',').map(Number),
      node = selectedNode();
    moveNode(state.workflow, node.id, node.position.x + x, node.position.y + y);
    dirty();
    renderGraph();
    return;
  }
  if (button.dataset.openWorkflow) {
    await busy(async () => {
      if (state.dirty) throw new Error('변경한 초안을 먼저 저장하거나 다시 불러오세요.');
      state.workflow = await api.workflow(button.dataset.openWorkflow);
      state.selected = state.workflow.graph.nodes[0]?.id;
      state.run = null;
      state.view = 'builder';
    });
    return;
  }
  if (button.dataset.openRun) {
    await busy(() => openRun(button.dataset.openRun));
    return;
  }
  if (button.dataset.runAction) {
    actionDialog(button.dataset.runAction);
    return;
  }
  const action = button.dataset.action;
  if (action === 'refresh-activities') await loadActivities();
  else if (action === 'more-activities') await loadActivities(false);
  else if (action === 'usage-guide') usageGuide();
  else if (action === 'close-guide') closePanel('usage-guide-dialog');
  else if (action === 'guide-setup') {
    closePanel('usage-guide-dialog');
    setupDialog();
  } else if (action === 'guided-setup' || action === 'edit-setup') {
    try {
      setupDialog(action === 'edit-setup' ? 'edit' : 'new');
    } catch (error) {
      report(error);
    }
  } else if (action === 'register-workspace') workspaceDialog();
  else if (action === 'close-setup') closePanel('setup-dialog');
  else if (action === 'close-workspace') closePanel('workspace-dialog');
  else if (action === 'review-decisions') {
    try {
      decisionsDialog();
    } catch (error) {
      report(error);
    }
  } else if (action === 'close-decisions') closePanel('decision-dialog');
  else if (action === 'copy-agent-handoff') {
    try {
      const text = `이 서비스 실행의 실제 코딩 작업을 도와주세요.\nserviceRunId: ${state.run.serviceRunId ?? state.run.planId ?? '미발급'}\nworkspaceId: ${state.run.workspaceId}\n결과 상대 폴더: ${agentHandoffSummary(state.run).targetPath ?? '기록된 계획에서 확인 필요'}\n같은 OS 사용자와 서비스 상태·작업 공간을 사용하는 MCP/CLI 연결에서 먼저 portal_status로 상태를 확인하세요. 필요하면 그 연결에서 portal_next를 요청하고 동일한 연결에서 결과를 제출하세요. 웹 임대는 복사하지 마세요. 이미 유효한 웹 임대가 있다면 강제로 인계하거나 작업을 재실행하지 말고 서비스의 유효 임대 처리·만료를 확인하세요. 코드는 아직 생성 완료로 기록되지 않았으며 실제 파일과 검증 근거가 필요합니다.`;
      await navigator.clipboard.writeText(text);
      notify('에이전트 전달 정보를 복사했습니다. 임대나 완료 결과는 자동으로 만들지 않습니다.');
    } catch {
      notify(
        '클립보드에 복사할 수 없습니다. 실행 ID와 작업 공간을 실행 정보에서 확인하세요.',
        true,
      );
    }
  } else if (action === 'close-dialog') document.querySelector('#action-dialog').close();
  else if (action === 'sidebar') document.querySelector('#sidebar').classList.toggle('open');
  else if (action === 'zoom-in') zoom(1.15);
  else if (action === 'zoom-out') zoom(1 / 1.15);
  else if (action === 'fit') fit();
  else if (action === 'remove-node') {
    removeNode(state.workflow, state.selected);
    state.selected = state.workflow.graph.nodes[0]?.id;
    dirty();
    render();
  } else if (action === 'connect-selected') {
    try {
      connectNodes(state.workflow, state.selected, document.querySelector('#connect-target').value);
      dirty();
      render();
    } catch (error) {
      report(error);
    }
  } else if (action === 'new') {
    if (state.dirty) {
      notify('변경한 초안을 먼저 저장하거나 다시 불러오세요.', true);
      return;
    }
    state.workflow = structuredClone(state.bootstrap.template);
    state.jsonDraft = null;
    state.selected = state.workflow.graph.nodes[0]?.id;
    state.run = null;
    state.view = 'builder';
    state.tab = 'configure';
    state.dirty = false;
    render();
    fit(false);
  } else if (action === 'save') await busy(save);
  else if (action === 'reload')
    await busy(async () => {
      state.workflow = state.workflow.id
        ? await api.workflow(state.workflow.id)
        : structuredClone(state.bootstrap.template);
      state.dirty = false;
      state.jsonDraft = null;
      state.selected = state.workflow.graph.nodes[0]?.id;
      notify('서버에 저장된 워크플로를 다시 불러왔습니다.');
    });
  else if (action === 'check')
    await busy(async () => {
      commitJsonDraft();
      const result = await api.validate(workflowInput(state.workflow));
      if (result.valid) notify('실행 전 그래프 검사를 통과했습니다.');
      else {
        const dialog = document.querySelector('#action-dialog');
        dialog.innerHTML = `<div class="dialog-heading"><h2>워크플로를 확인하세요</h2><button data-action="close-dialog" class="quiet" aria-label="닫기">${icon('close')}</button></div><p class="dialog-note">초안은 저장할 수 있습니다. 실행하려면 아래 조건을 해결하세요.</p><ul class="issue-list">${result.issues.map(issue => `<li><code>${escape(issue.path)}</code><p>${escape(issue.message)}</p></li>`).join('')}</ul>`;
        dialog.showModal();
      }
    });
  else if (action === 'start')
    await busy(async () => {
      const saved = state.dirty || !state.workflow.id ? await save() : state.workflow;
      const run = await api.start(saved.id, saved.revision);
      state.run = run;
      state.liveViewport = null;
      state.runs.unshift(run);
      state.events = [];
      state.cursor = 0;
      state.view = 'live';
      state.tab = 'test';
      notify('실제 서비스 실행을 요청했습니다. 단계별 상태를 확인하세요.');
    });
  else if (action === 'health')
    await busy(async () => {
      state.bootstrap = await api.bootstrap();
      state.activityAudit = state.bootstrap.activityLog?.audit;
      state.activityRetention = state.bootstrap.activityLog?.retention;
      notify(state.bootstrap.service.message);
    });
  else if (action === 'refresh-run') {
    if (state.run)
      await busy(async () => {
        state.run = await api.action(state.run.id, 'refresh');
      });
  } else if (action === 'copy-context') {
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.run.context, null, 2));
      notify('코딩 컨텍스트를 복사했습니다.');
    } catch {
      notify('복사할 수 없습니다. 표시된 컨텍스트를 선택해 복사하세요.', true);
    }
  }
});
document.addEventListener('change', event => {
  activityInput(event.target);
  if (event.target.dataset.field) editField(event.target);
  if (event.target.id === 'event-filter') {
    state.filter = event.target.value;
    document.querySelector('.timeline').outerHTML = timeline();
  }
});
document.addEventListener('input', event => {
  activityInput(event.target);
  if (event.target.dataset.field && !state.busy && state.view !== 'live') {
    if (event.target.dataset.field === 'requirements-json') {
      state.jsonDraft = event.target.value;
      dirty();
    } else editField(event.target);
  }
  if (event.target.id === 'node-search') {
    state.search = event.target.value;
    const position = event.target.selectionStart;
    render();
    const search = document.querySelector('#node-search');
    search.focus();
    search.setSelectionRange(position, position);
  }
});
for (const id of ['usage-guide-dialog', 'setup-dialog', 'workspace-dialog', 'decision-dialog'])
  document.getElementById(id).addEventListener('close', () => {
    if (id === 'usage-guide-dialog') activity('guide.close');
    const action = document.getElementById(id).returnAction;
    if (document.getElementById(id).returnFocus?.isConnected)
      document.getElementById(id).returnFocus.focus();
    else if (action) document.querySelector(`button[data-action="${CSS.escape(action)}"]`)?.focus();
  });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.connectFrom) {
    state.connectFrom = null;
    render();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    activity('workflow.save.intent');
    busy(save);
  }
  const nodeElement = event.target.closest('[data-node]');
  if (!nodeElement || event.target.closest('button') || state.busy) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    state.selected = nodeElement.dataset.node;
    activity('node.select', { nodeId: state.selected });
    render();
    document.querySelector(`[data-node="${CSS.escape(state.selected)}"]`)?.focus();
  }
  const shifts = {
    ArrowLeft: [-20, 0],
    ArrowRight: [20, 0],
    ArrowUp: [0, -20],
    ArrowDown: [0, 20],
  };
  if (shifts[event.key] && state.view !== 'live') {
    event.preventDefault();
    const node = state.workflow.graph.nodes.find(item => item.id === nodeElement.dataset.node),
      [x, y] = shifts[event.key];
    moveNode(state.workflow, node.id, node.position.x + x, node.position.y + y);
    activity('node.move', { nodeId: node.id });
    dirty();
    renderGraph();
    document.querySelector(`[data-node="${CSS.escape(node.id)}"]`)?.focus();
  }
});
window.addEventListener('beforeunload', event => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function initialize() {
  try {
    state.bootstrap = await api.bootstrap();
    state.activityAudit = state.bootstrap.activityLog?.audit;
    state.activityRetention = state.bootstrap.activityLog?.retention;
    void flushActivity();
    const [workflows, runs] = await Promise.all([api.workflows(), api.runs()]);
    state.workflows = workflows.workflows;
    state.runs = runs.runs;
    state.workflow = structuredClone(state.workflows[0] ?? state.bootstrap.template);
    state.selected = state.workflow.graph.nodes[0]?.id ?? null;
    render();
    if (!state.workflow.id) fit(false);
    setInterval(poll, 3000);
  } catch (error) {
    app.innerHTML = `<main class="startup"><div class="brand-mark">S</div><h1>포털에 연결할 수 없습니다</h1><p>${escape(error.message)}</p><button id="retry-bootstrap">${icon('refresh')}다시 연결</button><button data-action="usage-guide">사용 가이드</button></main>`;
    document.querySelector('#retry-bootstrap').addEventListener('click', initialize);
  }
}
initialize();
