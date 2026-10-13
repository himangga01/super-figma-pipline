import { mountSchemaForm, MAX_SCHEMA_JSON_BYTES } from './schema-form.js';

const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/gu,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const jobLabels = {
  queued: '요청 대기',
  running: '처리 중',
  'awaiting-confirmation': '영향 범위 확인 필요',
  'awaiting-approval': '서비스 승인 대기',
  succeeded: '요청 처리 성공',
  failed: '요청 처리 실패',
  cancelled: '취소됨',
  unknown: '결과 확인 필요',
};
const actionLabels = {
  approve: '승인',
  reject: '거절',
  cancel: '취소 요청',
  inspect: '결과 상태 확인',
  'prepare-recovery': '로컬 작업 차단 해제 검토',
};
const progressLabels = {
  connecting: 'Chrome 연결 중',
  'source-selected': '소스 선택됨',
  'capture-started': '수집 시작됨',
  exporting: '내보내는 중',
};
const activeStates = new Set(['queued', 'running', 'awaiting-confirmation', 'awaiting-approval']);

/** Catalog identity includes transport, preserving CLI aliases without inventing unique functions. */
export function catalogEntries(catalog) {
  const entries = [],
    seen = new Set();
  for (const [type, descriptors] of [
    ['tool', catalog.tools],
    ['feature', catalog.features],
  ]) {
    if (!Array.isArray(descriptors))
      throw new Error('서비스 기능 목록의 형식을 확인할 수 없습니다.');
    for (const descriptor of descriptors) {
      if (
        !descriptor ||
        typeof descriptor.name !== 'string' ||
        !descriptor.name ||
        !descriptor.inputSchema ||
        !['read', 'write', 'local'].includes(descriptor.kind) ||
        !Array.isArray(descriptor.prerequisites)
      )
        throw new Error('등록된 기능의 스키마 또는 연결 조건이 누락됐습니다.');
      const id = `${type}:${descriptor.name}`;
      if (seen.has(id)) throw new Error('서비스 기능 ID가 중복되었습니다. 목록을 다시 확인하세요.');
      seen.add(id);
      entries.push({ ...descriptor, type, id });
    }
  }
  return entries;
}

export function functionRequest(entry, args, workspaceId, selectorKind, selectorValue = '') {
  if (!entry || !['tool', 'feature'].includes(entry.type))
    throw new Error('등록된 기능을 먼저 선택하세요.');
  const targetSelector = { kind: selectorKind };
  if (!['none', 'active', 'session', 'stable-file', 'portal-source'].includes(selectorKind))
    throw new Error('대상 선택 방식을 확인하세요.');
  if (selectorKind === 'session') {
    if (!selectorValue.trim()) throw new Error('실제 Chrome 세션 ID를 입력하세요.');
    targetSelector.sessionId = selectorValue.trim();
  }
  if (selectorKind === 'stable-file') {
    if (!/^sha256:[0-9a-f]{64}$/u.test(selectorValue))
      throw new Error('실제 파일 식별 해시를 입력하세요.');
    targetSelector.fileIdentityHash = selectorValue;
  }
  const request = {
    type: entry.type,
    name: entry.name,
    args,
    workspaceId: workspaceId || null,
    targetSelector,
  };
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_SCHEMA_JSON_BYTES)
    throw new Error(
      '최종 요청 전체가 UTF-8 12 MiB 한도를 초과합니다. 원문을 자르지 말고 서비스가 허용하는 별도 요청으로 나누세요.',
    );
  return request;
}

export function mountServiceFunctions(
  container,
  { api, workspaces = [], administrative = false, onActivity = () => {}, onError = () => {} },
) {
  let disposed = false,
    entries = [],
    selected,
    schemaInput,
    preview,
    jobs = [],
    filter = '',
    group = '',
    transport = administrative ? 'feature' : '',
    activeJob,
    loading = false;
  let editTimer;
  let renderedJobSignature;
  let pollTimer,
    pollController,
    pollVersion = 0;
  const pollJob = () => {
    clearTimeout(pollTimer);
    pollController?.abort();
    const version = ++pollVersion;
    if (
      disposed ||
      !activeJob ||
      !activeStates.has(activeJob.status) ||
      Date.now() >= activeJob.deadlineAt
    )
      return;
    const jobId = activeJob.id;
    pollTimer = setTimeout(async () => {
      try {
        pollController = new AbortController();
        const { job } = await api.serviceJob(jobId, pollController.signal);
        if (disposed || version !== pollVersion || activeJob?.id !== jobId) return;
        activeJob = job;
        jobs = jobs.map(item => (item.id === job.id ? job : item));
        drawJobs();
        drawJob();
      } catch (error) {
        if (!disposed && version === pollVersion) {
          report(error);
          pollJob();
        }
      }
    }, 1000);
  };
  const recordEdit = entry => {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      if (!disposed)
        onActivity('service.input.edit', {
          functionType: entry.type,
          functionName: entry.name,
          hasValue: true,
        });
    }, 700);
  };
  const report = error => {
    if (disposed) return;
    const box = container.querySelector('#service-function-error');
    if (box) {
      box.hidden = false;
      box.textContent = `${error.code ?? 'REQUEST_FAILED'}: ${error.message}`;
    }
    onError(error);
  };
  const updateBusyControls = () => {
    container.setAttribute('aria-busy', String(loading));
    const holder = container.querySelector('#service-job-detail');
    holder?.querySelectorAll('[data-job-action], [data-local-recovery] button').forEach(button => {
      button.disabled = loading;
    });
    let status = container.querySelector('#service-request-pending');
    if (!status) {
      status = document.createElement('p');
      status.id = 'service-request-pending';
      status.setAttribute('role', 'status');
      container.querySelector('.function-filters')?.after(status);
    }
    status.textContent = loading
      ? '서비스 요청을 처리하고 있습니다. 완료된 뒤 다음 동작을 선택하세요.'
      : '';
  };
  const request = async work => {
    if (loading) return;
    pollVersion++;
    clearTimeout(pollTimer);
    pollController?.abort();
    loading = true;
    updateBusyControls();
    try {
      await work();
    } catch (error) {
      report(error);
    } finally {
      loading = false;
      if (!disposed) updateBusyControls();
      pollJob();
    }
  };
  const drawList = () => {
    const visible = entries.filter(
      entry =>
        (!transport || entry.type === transport) &&
        (!group || entry.group === group) &&
        (!filter ||
          `${entry.name} ${entry.description ?? ''} ${entry.group ?? ''}`
            .toLowerCase()
            .includes(filter.toLowerCase())),
    );
    const list = container.querySelector('#service-function-list');
    list.innerHTML =
      visible
        .map(
          entry =>
            `<button type="button" data-function-id="${escape(entry.id)}" class="function-entry ${selected?.id === entry.id ? 'active' : ''}"><strong>${escape(entry.name)}</strong><span>${entry.type === 'tool' ? 'MCP 도구' : 'CLI 기능'} · ${escape(entry.group ?? '기타')} · ${entry.kind === 'write' ? '변경' : entry.kind === 'read' ? '읽기' : '로컬 작업'}</span><small>${escape(entry.description ?? '')}</small></button>`,
        )
        .join('') || '<p>검색 조건에 맞는 등록 기능이 없습니다.</p>';
    list
      .querySelectorAll('[data-function-id]')
      .forEach(button =>
        button.addEventListener('click', () =>
          select(entries.find(entry => entry.id === button.dataset.functionId)),
        ),
      );
  };
  const drawJobs = () => {
    const list = container.querySelector('#service-job-list');
    list.innerHTML =
      jobs
        .map(
          job =>
            `<button type="button" data-job-id="${escape(job.id)}"><strong>${escape(job.name)}</strong><span>${escape(jobLabels[job.status] ?? '알 수 없는 상태')}</span><small>${escape(job.id)}</small></button>`,
        )
        .join('') || '<p>기록된 기능 요청이 없습니다.</p>';
    list.querySelectorAll('[data-job-id]').forEach(button =>
      button.addEventListener('click', () =>
        request(async () => {
          const { job } = await api.serviceJob(button.dataset.jobId);
          if (disposed) return;
          activeJob = job;
          drawJob();
        }),
      ),
    );
  };
  const drawJob = () => {
    const holder = container.querySelector('#service-job-detail');
    if (!activeJob) {
      holder.innerHTML = '';
      renderedJobSignature = undefined;
      return;
    }
    const job = activeJob;
    const signature = JSON.stringify({
      id: job.id,
      name: job.name,
      type: job.type,
      status: job.status,
      workspaceId: job.workspaceId,
      operationId: job.operationId,
      deadlineAt: job.deadlineAt,
      approvals: job.approvals,
      actions: (job.actions ?? []).filter(item => Object.hasOwn(actionLabels, item.action)),
      requestPreview: job.requestPreview,
      result: job.result,
      error: job.error,
      outputHash: job.outputHash,
      outputBytes: job.outputBytes,
      outputUnavailable: job.outputUnavailable,
      progressPhase: job.progress?.at(-1)?.phase,
      fenceDisposition: job.fenceDisposition,
      recovery: job.recovery,
    });
    if (holder.dataset.jobId === job.id && renderedJobSignature === signature) {
      // Preserve an unchanged confirmation element between native pointerdown/up.
      // Polling and server-side authority/deadline checks continue normally.
      updateBusyControls();
      pollJob();
      return;
    }
    const sameJob = holder.dataset.jobId === job.id;
    const disclosures = sameJob
      ? new Map(
          Array.from(holder.querySelectorAll('details'), detail => [
            detail.querySelector('summary')?.textContent,
            detail.open,
          ]),
        )
      : new Map();
    const focused =
      sameJob && holder.contains(document.activeElement) ? document.activeElement : null;
    const focusAction = focused?.dataset.jobAction;
    const focusApproval = focused?.dataset.approvalId;
    const focusDisclosure = focused?.tagName === 'SUMMARY' ? focused.textContent : null;
    holder.dataset.jobId = job.id;
    const actionStates = (job.actions ?? []).filter(item =>
      Object.hasOwn(actionLabels, item.action),
    );
    const actions = actionStates.filter(item => item.enabled === true).map(item => item.action);
    holder.innerHTML = `<h3>${escape(job.name)} · ${escape(jobLabels[job.status] ?? '알 수 없는 상태')}</h3><p class="tiny">요청 ID ${escape(job.id)} · 작업 공간 ${escape(job.workspaceId ?? '없음')} · 작업 ID ${escape(job.operationId ?? '미발급')}</p>${job.status === 'unknown' ? '<div class="error-box">결과가 확인되지 않았습니다. 같은 변경 요청을 재실행하지 말고 상태 확인으로 실제 결과를 조사하세요.</div>' : ''}<p>요청 성공은 해당 서비스 기능의 처리 결과입니다. 전체 Figma 수집·코드 구현·검증·적용 완료를 대신하지 않습니다.</p>${(job.approvals ?? []).map(approval => `<article class="function-approval"><h4>${escape(approval.target?.label ?? approval.operationName ?? '승인 대상')}</h4><ul>${(approval.effectSummary ?? []).map(effect => `<li>${escape(effect)}</li>`).join('')}</ul><p class="tiny">승인 ID ${escape(approval.approvalId)} · 만료 ${escape(approval.expiresAt)}</p>${actions.includes('approve') ? `<button data-job-action="approve" data-approval-id="${escape(approval.approvalId)}">영향 범위 확인 후 승인</button>` : ''}${actions.includes('reject') ? `<button data-job-action="reject" data-approval-id="${escape(approval.approvalId)}">거절</button>` : ''}</article>`).join('')}${actions
      .filter(action => !['approve', 'reject'].includes(action) || !(job.approvals ?? []).length)
      .map(action => `<button data-job-action="${action}">${escape(actionLabels[action])}</button>`)
      .join('')}${actionStates
      .filter(item => !item.enabled)
      .map(
        item =>
          `<p class="tiny muted">${escape(actionLabels[item.action])}: ${escape(item.reason)}</p>`,
      )
      .join(
        '',
      )}<details><summary>실제 응답과 오류</summary><pre class="json-output">${escape(JSON.stringify({ result: job.result, error: job.error, outputHash: job.outputHash, outputBytes: job.outputBytes, outputUnavailable: job.outputUnavailable }, null, 2))}</pre></details>`;
    const phase = job.progress?.at(-1)?.phase;
    const deadline = document.createElement('p');
    deadline.textContent = `원래 요청 만료 ${new Date(job.deadlineAt).toLocaleString()}`;
    holder.querySelector('h3').after(deadline);
    if (Object.hasOwn(progressLabels, phase)) {
      const progress = document.createElement('p');
      progress.dataset.jobProgress = phase;
      progress.textContent = `${progressLabels[phase]} · 원래 요청 만료 ${new Date(job.deadlineAt).toLocaleString()}. 연결 중이라는 표시는 Chrome 승인창이 표시됐다는 뜻이 아닙니다.`;
      holder.querySelector('h3').after(progress);
    }
    if (job.fenceDisposition) {
      const disposition = document.createElement('p');
      disposition.textContent = `소유자가 로컬 차단 해제를 기록했습니다 (${job.fenceDisposition.at}). 원래 결과는 확인되지 않았으며 재실행되지 않았습니다.`;
      holder.append(disposition);
    }
    const challenge = job.recovery?.challenge;
    if (challenge && challenge.expiresAt > Date.now() && !job.fenceDisposition) {
      const recovery = document.createElement('form');
      recovery.dataset.localRecovery = '';
      recovery.innerHTML = `<h4>원래 결과를 unknown으로 유지하고 이 로컬 차단만 해제</h4><p>기존 파일과 증거를 검토하세요. 이 결정은 원래 작업을 재실행하거나 성공·실패를 확정하지 않습니다. 새 요청은 별도로 검토해야 합니다. 확인 유효시간은 원래 작업 기한을 늘리지 않습니다.</p>${challenge.legacy ? '<label><input type="checkbox" name="retired" required/> 이전 실행 프로세스와 지연된 소스 변경이 완전히 종료됐음을 소유자가 확인했습니다. 서비스가 과거 종료를 증명한 것이 아닙니다.</label>' : ''}<label>검토 사유<input name="reason" required maxlength="512"/></label><label>검토한 증거 SHA-256<input name="evidence" required pattern="sha256:[a-f0-9]{64}"/></label><label><input type="checkbox" name="acknowledge" required/> 결과 불확실성이 남는 것을 이해하고 이 작업의 차단 해제를 직접 결정합니다.</label><button type="submit">이 로컬 차단만 해제 기록</button>`;
      recovery.addEventListener('submit', event => {
        event.preventDefault();
        void request(async () => {
          if (activeJob?.id !== job.id || activeJob.status !== 'unknown')
            throw new Error('작업을 다시 확인하세요.');
          const data = new FormData(recovery);
          if (!data.get('acknowledge') || (challenge.legacy && !data.get('retired')))
            throw new Error('소유자 확인이 필요합니다.');
          const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(String(data.get('reason'))),
          );
          const reasonHash = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
          const { job: updated } = await api.serviceJobAction(job.id, {
            action: 'abandon-local',
            challengeId: challenge.id,
            fingerprint: challenge.fingerprint,
            workspaceBinding: challenge.workspaceBinding,
            confirm: `${job.id}/${challenge.fingerprint}`,
            reasonHash,
            evidenceHash: String(data.get('evidence')),
            priorProducerRetired: !!data.get('retired'),
          });
          if (disposed || activeJob?.id !== job.id) return;
          activeJob = updated;
          jobs = jobs.map(item => (item.id === job.id ? updated : item));
          drawJobs();
          drawJob();
        });
      });
      holder.append(recovery);
    }
    if (job.outputUnavailable) {
      const warning = document.createElement('div');
      warning.className = 'error-box';
      warning.textContent = `응답 원문을 현재 보관하지 않습니다 (${job.outputUnavailable}). 기록된 해시와 크기는 원문 응답을 대신하지 않습니다. 결과를 되찾으려고 변경 작업을 재실행하지 마세요. 실제 작업의 상태 확인과 기록을 사용하세요.`;
      holder.querySelector('h3').after(warning);
    }
    holder.querySelectorAll('.function-approval').forEach((card, index) => {
      const label = document.createElement('p');
      label.className = 'tiny';
      label.textContent =
        job.approvals[index].source === 'portal'
          ? '포털의 관리 작업 영향 확인'
          : '서비스에서 발급한 승인 요청';
      card.querySelector('h4').after(label);
    });
    if (job.requestPreview !== null && job.requestPreview !== undefined) {
      const previewDetails = document.createElement('details'),
        summary = document.createElement('summary'),
        content = document.createElement('pre');
      summary.textContent = '현재 승인 대기 작업의 실제 입력과 대상';
      content.className = 'json-output';
      content.textContent = JSON.stringify(job.requestPreview, null, 2);
      previewDetails.append(summary, content);
      holder.querySelector('h3').after(previewDetails);
    }
    holder.querySelectorAll('[data-job-action]').forEach(button =>
      button.addEventListener('click', () =>
        request(async () => {
          pollVersion++;
          clearTimeout(pollTimer);
          pollController?.abort();
          onActivity('service.job.action.intent', {
            functionType: job.type,
            functionName: job.name,
            jobId: job.id,
            jobAction: button.dataset.jobAction,
          });
          const { job: updated } = await api.serviceJobAction(job.id, {
            action: button.dataset.jobAction,
            ...(button.dataset.approvalId ? { approvalId: button.dataset.approvalId } : {}),
          });
          if (disposed) return;
          activeJob = updated;
          jobs = jobs.map(item => (item.id === updated.id ? updated : item));
          drawJobs();
          drawJob();
        }),
      ),
    );
    for (const detail of holder.querySelectorAll('details')) {
      const label = detail.querySelector('summary')?.textContent;
      if (disclosures.has(label)) detail.open = disclosures.get(label);
      if (focusDisclosure === label)
        detail.querySelector('summary')?.focus({ preventScroll: true });
    }
    if (focusAction) {
      const selector = `[data-job-action="${CSS.escape(focusAction)}"]${focusApproval ? `[data-approval-id="${CSS.escape(focusApproval)}"]` : ''}`;
      holder.querySelector(selector)?.focus({ preventScroll: true });
    }
    renderedJobSignature = signature;
    updateBusyControls();
    pollJob();
  };
  const select = entry => {
    selected = entry;
    onActivity('view.change', {
      view: administrative ? 'admin' : 'functions',
      functionType: entry.type,
      functionName: entry.name,
    });
    preview = null;
    drawList();
    const detail = container.querySelector('#service-function-detail');
    detail.innerHTML = `<h3>${escape(entry.name)}</h3><p>${escape(entry.description ?? '')}</p><div class="info-box"><strong>필요한 연결과 권한</strong><ul>${entry.prerequisites.map(item => `<li>${escape(item)}</li>`).join('') || '<li>별도로 선언된 조건이 없습니다. 실제 서비스가 실행 시 권한과 대상을 확인합니다.</li>'}</ul><p>${entry.confirmationRequired || entry.kind !== 'read' ? '변경 또는 로컬 관리 작업입니다. 입력과 대상, 영향 범위를 직접 확인한 뒤 요청하세요. 실제 서비스 승인이 추가로 필요할 수 있습니다.' : '읽기 요청도 실제 연결과 승인 조건을 확인합니다.'}</p></div>${['portal_next', 'portal_submit'].includes(entry.name) ? '<div class="error-box">코딩 임대는 연결 세션에 묶입니다. 이 웹 연결에서 받은 임대를 외부 MCP/CLI에 복사하지 마세요. 일반 코딩 에이전트 전달은 워크플로 실행 화면을 사용하세요.</div>' : ''}<form id="service-function-form"><div id="service-schema-fields"></div><label class="field"><span>작업 공간</span><select name="workspaceId"><option value="">없음 / 기능이 직접 요구하는 입력 사용</option>${workspaces.map(space => `<option value="${escape(space.workspaceId)}">${escape(space.realPath)}</option>`).join('')}</select></label><label class="field"><span>서비스 대상 선택</span><select name="targetKind"><option value="none">대상 지정 없음</option><option value="active">현재 활성 대상</option><option value="session">실제 Chrome 세션</option><option value="stable-file">기록된 파일 식별 해시</option><option value="portal-source">현재 포털 소스 바인딩</option></select></label><label class="field"><span>세션 ID 또는 파일 식별 해시 (해당 시)</span><input name="targetValue"/></label><button type="submit">입력과 대상 검토</button></form><section id="service-request-preview" hidden><h4>이 요청을 직접 보냅니다</h4><p id="service-preview-summary"></p><details><summary>요청 입력 상세</summary><pre class="json-output" id="service-preview-json"></pre></details><button type="button" id="service-request-submit">확인 후 서비스에 요청</button></section>`;
    schemaInput = mountSchemaForm(
      detail.querySelector('#service-schema-fields'),
      entry.inputSchema,
      {
        workspaces,
        allowUnavailableWorkspaces:
          entry.type === 'feature' && ['workspace.remove', 'workspace.rebind'].includes(entry.name),
        onChange: () => {
          recordEdit(entry);
          preview = null;
          detail.querySelector('#service-request-preview').hidden = true;
        },
        onError: report,
      },
    );
    const aliasName =
      typeof entry.aliasOf === 'string'
        ? entry.aliasOf
        : entry.aliasOf?.type === 'tool' && typeof entry.aliasOf.name === 'string'
          ? entry.aliasOf.name
          : null;
    if (aliasName) {
      const alias = document.createElement('p');
      alias.className = 'tiny muted';
      alias.textContent = `같은 기능의 MCP 경로: ${aliasName}. 별도의 고유 기능으로 합산하지 않습니다.`;
      detail.querySelector('h3').after(alias);
    }
    const form = detail.querySelector('#service-function-form');
    form.addEventListener('input', () => {
      recordEdit(entry);
      preview = null;
      detail.querySelector('#service-request-preview').hidden = true;
    });
    form.addEventListener('change', () => {
      recordEdit(entry);
      preview = null;
      detail.querySelector('#service-request-preview').hidden = true;
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const data = Object.fromEntries(new FormData(form));
        preview = functionRequest(
          entry,
          schemaInput.read(),
          data.workspaceId,
          data.targetKind,
          data.targetValue,
        );
        detail.querySelector('#service-request-preview').hidden = false;
        detail.querySelector('#service-preview-summary').textContent =
          `${entry.type === 'tool' ? 'MCP 도구' : 'CLI 기능'} ${entry.name} · ${entry.kind === 'read' ? '읽기' : '변경/로컬 작업'} · 작업 공간 ${preview.workspaceId ?? '없음'} · 대상 ${preview.targetSelector.kind}`;
        detail.querySelector('#service-preview-json').textContent = JSON.stringify(
          preview,
          null,
          2,
        );
      } catch (error) {
        report(error);
      }
    });
    detail.querySelector('#service-request-submit').addEventListener('click', () =>
      request(async () => {
        if (!preview || selected?.id !== entry.id)
          throw new Error('입력과 대상을 다시 검토하세요.');
        const intent = structuredClone(preview);
        preview = null;
        detail.querySelector('#service-request-preview').hidden = true;
        onActivity('service.job.intent', { functionType: entry.type, functionName: entry.name });
        const { job } = await api.serviceJobCreate(intent);
        if (disposed) return;
        activeJob = job;
        jobs = [job, ...jobs.filter(item => item.id !== job.id)];
        drawJobs();
        drawJob();
      }),
    );
  };
  container.innerHTML = `<section class="service-functions"><header><h2>서비스 기능</h2><p>실제 등록된 MCP 도구와 공개 CLI 기능을 검색하고 입력 폼으로 요청합니다. 같은 기능의 여러 진입 경로를 별도 기능 수로 합산하지 않습니다. Desktop 플러그인 편집과 Chrome 읽기는 각각 필요한 연결을 따릅니다.</p></header><div id="service-function-error" class="error-box" role="alert" hidden></div><p id="service-catalog-count">서비스 목록을 불러오는 중입니다.</p><div class="function-filters"><label class="field"><span>기능 검색</span><input id="service-function-search"/></label><label class="field"><span>기능 그룹</span><select id="service-function-group"><option value="">모든 그룹</option></select></label><button id="service-jobs-refresh">요청 기록 새로고침</button></div><div class="function-columns"><aside id="service-function-list"></aside><section><div id="service-function-detail"><p>등록 기능을 선택하면 실제 입력 항목이 표시됩니다.</p></div><hr/><h3>기능 요청 기록</h3><div id="service-job-list"></div><div id="service-job-detail"></div></section></div></section>`;
  container.querySelector('#service-function-search').addEventListener('input', event => {
    filter = event.target.value;
    drawList();
  });
  container.querySelector('#service-function-group').addEventListener('change', event => {
    group = event.target.value;
    drawList();
  });
  const transportChoice = document.createElement('select');
  transportChoice.id = 'service-function-transport';
  transportChoice.setAttribute('aria-label', '기능 진입 경로');
  for (const [value, label] of [
    ['', '모든 공개 경로'],
    ['tool', 'MCP 도구'],
    ['feature', 'CLI·관리 기능'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    transportChoice.append(option);
  }
  transportChoice.value = transport;
  transportChoice.addEventListener('change', () => {
    transport = transportChoice.value;
    drawList();
  });
  container.querySelector('.function-filters').append(transportChoice);
  if (administrative) container.querySelector('h2').textContent = '관리';
  container.querySelector('#service-jobs-refresh').addEventListener('click', () =>
    request(async () => {
      const data = await api.serviceJobs();
      if (disposed) return;
      jobs = data.jobs;
      drawJobs();
      if (activeJob) {
        const { job } = await api.serviceJob(activeJob.id);
        if (disposed) return;
        activeJob = job;
        drawJob();
      }
    }),
  );
  void request(async () => {
    const catalog = await api.serviceCatalog();
    if (disposed) return;
    entries = catalogEntries(catalog);
    container.querySelector('#service-catalog-count').textContent =
      `등록 MCP 도구 ${catalog.tools.length}개 · 공개 CLI 진입 경로 ${catalog.features.length}개. 별칭이 겹치므로 고유 기능 합계가 아닙니다.`;
    const groupSelect = container.querySelector('#service-function-group');
    [...new Set(entries.map(entry => entry.group).filter(Boolean))].toSorted().forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      groupSelect.append(option);
    });
    drawList();
    const data = await api.serviceJobs();
    if (disposed) return;
    jobs = data.jobs;
    drawJobs();
  });
  return () => {
    disposed = true;
    pollVersion++;
    clearTimeout(pollTimer);
    pollController?.abort();
    clearTimeout(editTimer);
  };
}
