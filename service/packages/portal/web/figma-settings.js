import {
  activeAuth,
  authBinding,
  authProblem,
  contractDigest,
  contractReference,
  envName,
  figmaDesktop as desktop,
  figmaRemote as remote,
  safeAuthError,
  safeAuthStatus,
  stageText,
} from './figma-auth-public.js';
const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/gu,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const textStatus = status =>
  ({
    connected: '연결 확인',
    'auth-required': '인증 필요',
    unavailable: '연결 불가',
    cancelled: '검사 취소 또는 시간 초과',
  })[status] ?? '아직 검사하지 않음';
const fields = [
  'endpoint',
  'mode',
  'oauthTokenEnv',
  'clientIdEnv',
  'clientSecretEnv',
  'contractReference',
  'contractDigest',
];
const emptyConfig = endpoint => ({
  endpoint,
  mode: 'external-token',
  oauthTokenEnv: null,
  clientIdEnv: null,
  clientSecretEnv: null,
  contractReference: null,
  contractDigest: null,
});

/** Configuration references only. OAuth values and handoff URLs never enter this view. */
export function mountFigmaSettings(container, { api, onActivity, onError, onApplyToDraft }) {
  let active = true,
    busy = false,
    view = null,
    auth = null,
    draft = null,
    error = '',
    notice = '',
    timer,
    pollController,
    pollUntil = 0,
    polling = false,
    authEpoch = 0,
    renderedAuth = '';
  const bound = () =>
    auth && (!view?.daemon || view.daemon.providerInstanceId === auth.providerInstanceId);
  function snapshotFocus() {
    const element = document.activeElement;
    if (!container.contains(element)) return null;
    return {
      name: element.name,
      action: element.dataset?.figmaAuth,
      value: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
    };
  }
  function restoreFocus(saved) {
    if (!saved) return;
    const element =
      saved.name && fields.includes(saved.name)
        ? container.querySelector(`[name=${saved.name}]`)
        : saved.action &&
            ['status', 'start', 'cancel', 'logout', 'refresh', 'consent'].includes(saved.action)
          ? container.querySelector(`[data-figma-auth=${saved.action}]`)
          : null;
    if (element && !element.disabled) {
      element.focus();
      if (
        element.value === saved.value &&
        typeof element.setSelectionRange === 'function' &&
        Number.isInteger(saved.start) &&
        Number.isInteger(saved.end)
      )
        element.setSelectionRange(saved.start, saved.end);
    }
  }
  function authMarkup() {
    if (!auth)
      return '<p>OAuth 로그인: 이 앱에서 미구현 또는 현재 서비스가 인증 상태를 제공하지 않음. 서비스 클라이언트 등록 자격은 확인되지 않았습니다.</p><button type="button" data-figma-auth="status">인증 상태 읽기</button>';
    const c = auth.configuration;
    const missing =
      !c.clientIdEnv || !c.clientSecretEnv || !c.contractReference || !c.contractDigest;
    const canStart =
      bound() &&
      c.endpoint === remote &&
      c.mode === 'own-oauth' &&
      !missing &&
      !activeAuth(auth) &&
      auth.stage !== 'authorized' &&
      (auth.stage !== 'blocked' || auth.code === null);
    const remoteAuth = c.endpoint === remote && c.mode === 'own-oauth' && bound();
    return `<h3>이 서비스의 공식 OAuth 세션</h3><p role="status">${escape(stageText(auth.stage))}</p>
      <p>로그인 경로 구현됨 · 자격 근거: ${auth.eligibilitySource === 'operator-contract' ? '운영자가 설치한 계약 선언' : '미설정'}. 계약 선언은 Figma가 서버에서 자격을 검증했다는 뜻이 아닙니다.</p>
      <p>서버 인증 관측: ${auth.serverAuthorizationObserved ? '기록 있음' : '아직 없음'} · 메모리 세션만 사용</p>
      <p>서비스 인스턴스: <code>${escape(auth.providerInstanceId)}</code> · 설정 세대 ${auth.configurationGeneration} · 인증 세대 ${auth.authGeneration}</p>
      ${!bound() ? '<p>현재 설정과 서비스 인스턴스가 다릅니다. 서비스 설정을 다시 읽으세요.</p>' : ''}
      ${auth.expiresAt !== null ? `<p>기록된 만료: ${escape(new Date(auth.expiresAt).toISOString())}. 로그인은 수집 권한이나 8시간 데이터 허용을 부여하지 않습니다.</p>` : ''}
      ${auth.code ? `<p>${escape(authProblem(auth.code))}</p>` : ''}
      ${c.endpoint === desktop ? '<p>Desktop 연결에는 원격 인증 정보나 이 OAuth 동의를 사용하지 않습니다.</p>' : c.mode === 'external-token' ? '<p>외부에서 준비한 이 서비스 전용 토큰 참조 모드입니다. 값의 존재만으로 유효한 인증이나 수집 성공을 확인하지 않습니다.</p>' : missing ? '<p>승인된 클라이언트 계약 참조·해시와 클라이언트 환경 변수 이름이 필요합니다. 이 상태에서는 외부 로그인 요청을 시작하지 않습니다.</p>' : ''}
      <div class="dialog-actions"><button type="button" data-figma-auth="status" ${busy ? 'disabled' : ''}>인증 상태 읽기</button>
      <button type="button" data-figma-auth="start" ${busy || !canStart ? 'disabled' : ''}>새 로그인 시작</button>
      <button type="button" data-figma-auth="cancel" ${busy || !remoteAuth || !activeAuth(auth) ? 'disabled' : ''}>현재 로그인 취소</button>
      <button type="button" data-figma-auth="logout" ${busy || !remoteAuth || auth.stage === 'logged-out' ? 'disabled' : ''}>로컬 세션 로그아웃</button>
      <button type="button" data-figma-auth="refresh" ${busy || !remoteAuth || auth.stage !== 'authorized' ? 'disabled' : ''}>인증 명시적으로 갱신</button>
      ${auth.handoffAvailable && auth.flowId && remoteAuth ? '<a data-figma-auth="consent" href="/figma-auth-consent" target="_blank" rel="noopener noreferrer">별도 탭에서 동의 화면 열기</a>' : ''}</div>
      <p>동의는 별도 탭의 계속 버튼과 Figma 화면에서 직접 진행합니다. 이 포털 탭을 유지합니다. 취소·로그아웃은 서비스 세션만 정리하며 Figma 원격 허용을 취소했다고 주장하지 않습니다. 기존 미확정 작업은 다시 실행하거나 해제하지 않습니다.</p>`;
  }
  function renderAuth() {
    const target = container.querySelector('#figma-auth-state');
    if (!active || !target) return;
    const markup = authMarkup();
    if (markup === renderedAuth) return;
    const focus = snapshotFocus();
    target.innerHTML = markup;
    renderedAuth = markup;
    bindAuth();
    restoreFocus(focus);
  }
  function render() {
    if (!active) return;
    const focus = snapshotFocus();
    if (!view) {
      container.innerHTML = `<section class="guide-panel"><h2>Figma MCP 연결 설정</h2><p role="status">${escape(error || '실제 서비스 설정을 읽고 있습니다.')}</p><button type="button" data-figma-setting="reload" ${busy ? 'disabled' : ''}>다시 읽기</button></section>`;
      bind();
      return;
    }
    const c = draft,
      remoteSelected = c.endpoint === remote,
      own = c.mode === 'own-oauth';
    const result = view.lastProbe?.result;
    const stale =
      result &&
      (view.lastProbe.settingsRevision !== view.revision ||
        result.authentication?.providerInstanceId !== view.daemon?.providerInstanceId ||
        (auth &&
          (view.lastProbe.authBinding?.providerInstanceId !== auth.providerInstanceId ||
            view.lastProbe.authBinding?.configurationGeneration !== auth.configurationGeneration ||
            view.lastProbe.authBinding?.authGeneration !== auth.authGeneration)));
    const names = [
      ['oauthTokenEnv', '서비스 전용 외부 토큰 환경 변수 이름'],
      ['clientIdEnv', '서비스 전용 클라이언트 ID 환경 변수 이름'],
      ['clientSecretEnv', '서비스 전용 클라이언트 비밀 환경 변수 이름'],
      ['contractReference', '운영자가 설치한 승인 계약 참조'],
      ['contractDigest', '설치된 계약 해시'],
    ];
    container.innerHTML = `<section class="guide-panel" aria-labelledby="figma-settings-title"><h2 id="figma-settings-title">Figma MCP 연결 설정</h2>
      <p>공식 서버만 사용합니다. 이름과 계약 참조만 입력하세요. 클라이언트 값·토큰·인증 코드·동의 주소를 입력하거나 저장하지 않습니다.</p>
      <form id="figma-settings-form"><label class="field"><span>공식 서버</span><select name="endpoint" ${busy ? 'disabled' : ''}><option value="${remote}" ${remoteSelected ? 'selected' : ''}>Figma 원격 MCP</option><option value="${desktop}" ${!remoteSelected ? 'selected' : ''}>Figma Desktop MCP</option></select></label>
      <label class="field"><span>원격 인증 방식</span><select name="mode" ${busy || !remoteSelected ? 'disabled' : ''}><option value="external-token" ${!own ? 'selected' : ''}>이 서비스 전용 외부 토큰 참조</option><option value="own-oauth" ${own ? 'selected' : ''}>이 서비스의 승인된 OAuth 클라이언트</option></select></label>
      ${names.map(([name, label]) => `<label class="field"><span>${label}</span><input name="${name}" value="${escape(c[name] ?? '')}" maxlength="${name === 'contractDigest' ? 71 : name === 'contractReference' ? 64 : 128}" autocomplete="off" spellcheck="false" ${busy || !remoteSelected || (name === 'oauthTokenEnv' ? own : !own) ? 'disabled' : ''}/></label>`).join('')}
      <p>환경 변수 이름 저장은 데몬의 값을 설정하지 않습니다. 계약은 운영자가 Figma의 서비스 전용 승인·인증 방식·콜백 계약을 확인한 뒤 설치합니다. 이 화면의 선택이나 입력으로 등록 자격을 검증하지 않습니다.</p>
      <div class="dialog-actions"><button type="submit" ${busy ? 'disabled' : ''}>설정 저장</button><button type="button" data-figma-setting="probe" ${busy || !view.setup?.daemonSupportAvailable ? 'disabled' : ''}>공식 서버 검사</button><button type="button" data-figma-setting="reload" ${busy ? 'disabled' : ''}>서비스 설정 다시 읽기</button></div></form>
      ${error ? `<div class="error-box" role="alert">${escape(error)}</div>` : ''}${notice ? `<p role="status">${escape(notice)}</p>` : ''}
      <section id="figma-auth-state" class="info-box">${authMarkup()}</section>
      <div class="info-box"><strong>실제 생성 경로의 설정</strong><p>저장된 서버: ${escape(view.configuration.endpoint)}</p><p>현재 인증 작업은 저장·적용된 서비스 설정을 사용합니다. 위 입력 중인 초안은 저장 전까지 적용되지 않습니다.</p>
      ${view.authentication?.restartRequired ? '<p>외부 환경 참조를 바꾸면 실제 데몬 환경과 다시 맞춰야 합니다. 진행 중인 Chrome 작업과 미확정 작업을 먼저 확인하세요.</p>' : ''}</div>
      <div class="info-box"><strong>검사와 수집은 다릅니다</strong><p>공식 서버: ${escape(textStatus(result?.status))}${stale ? ' · 이전 설정 또는 이전 서비스의 결과' : ''}</p><p>전체 수집용 고정 프로그램 도구: ${result ? (result.programCaptureSupported ? '지원 확인' : '지원하지 않음') : '미확인'}</p>
      <p>${view.readyForCaptureAttempt && !stale ? '현재 기록으로 수집 시도 준비를 확인했습니다. 파일 권한·완전성·최신성은 실제 실행에서 확인합니다.' : '현재 기록만으로 전체 파일 수집 준비를 확인할 수 없습니다.'}</p><p>로그인·연결 검사만으로 실제 파일 수집·생성·검증 완료를 판정하지 않습니다.</p></div>
      <section><h3>연결 준비</h3><p>${remoteSelected ? '이 서비스 전용 승인 계약과 데몬 환경 참조를 준비하세요. 다른 앱의 토큰·쿠키·클라이언트 정보를 복사하지 마세요.' : 'Figma Desktop Dev Mode에서 공식 서버를 활성화하세요. Desktop에는 원격 인증 정보를 보내지 않습니다.'}</p><a href="https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/" target="_blank" rel="noreferrer">공식 Figma 설치·인증 안내</a></section>
      <hr/><button type="button" data-figma-setting="apply" ${busy || !onApplyToDraft ? 'disabled' : ''}>저장한 연결을 현재 초안에 적용</button><p class="tiny muted">저장한 서버 주소만 새 초안에 반영합니다. 기존 실행·미확정 작업·데이터 허용·원래 기한은 변경하지 않습니다.</p></section>`;
    renderedAuth = authMarkup();
    bind();
    bindAuth();
    restoreFocus(focus);
  }
  async function authStatus(signal) {
    const epoch = authEpoch;
    if (!api.connectionAuthStatus) {
      auth = null;
      return;
    }
    const next = safeAuthStatus(await api.connectionAuthStatus(signal));
    if (!active || epoch !== authEpoch) return;
    if (!next)
      throw Object.assign(new Error('인증 상태 응답을 확인할 수 없습니다.'), {
        code: 'FIGMA_MCP_OAUTH_RESPONSE_REJECTED',
      });
    auth = next;
  }
  function schedulePoll() {
    clearTimeout(timer);
    if (!active || !activeAuth(auth) || Date.now() >= pollUntil) return;
    timer = setTimeout(async () => {
      if (!active) return;
      if (!busy && !polling) {
        polling = true;
        pollController = new AbortController();
        try {
          await authStatus(
            AbortSignal.any([
              pollController.signal,
              AbortSignal.timeout(Math.max(1, Math.min(10000, pollUntil - Date.now()))),
            ]),
          );
          if (active) renderAuth();
        } catch {
          /* Explicit status remains available. Never retry a mutation. */
        } finally {
          polling = false;
        }
      }
      schedulePoll();
    }, 1000);
  }
  async function load() {
    view = await api.connectionSettingsGet();
    try {
      await authStatus();
    } catch {
      auth = null;
    }
    if (!draft)
      draft = {
        ...(auth?.configuration ?? {
          ...emptyConfig(view.configuration.endpoint),
          oauthTokenEnv: view.configuration.oauthTokenEnv,
        }),
      };
    if (activeAuth(auth) && !pollUntil)
      pollUntil = Math.min(auth.expiresAt ?? Date.now() + 30000, Date.now() + 600000);
    schedulePoll();
  }
  async function perform(action) {
    if (busy || !active) return;
    busy = true;
    authEpoch++;
    pollController?.abort();
    error = '';
    notice = '';
    render();
    try {
      await action();
    } catch (cause) {
      const safe = safeAuthError(cause);
      error = safe.message;
      onError?.(safe);
    } finally {
      busy = false;
      if (active) render();
      schedulePoll();
    }
  }
  function configuration() {
    const c = { ...draft };
    if (
      ![remote, desktop].includes(c.endpoint) ||
      !['external-token', 'own-oauth'].includes(c.mode)
    )
      throw Error('INVALID');
    if (c.endpoint === desktop) return emptyConfig(desktop);
    if (c.mode === 'own-oauth') c.oauthTokenEnv = null;
    else {
      c.clientIdEnv = null;
      c.clientSecretEnv = null;
      c.contractReference = null;
      c.contractDigest = null;
    }
    for (const name of ['oauthTokenEnv', 'clientIdEnv', 'clientSecretEnv'])
      if (c[name] !== null && !envName(c[name])) throw Error('INVALID');
    if (
      (c.contractReference !== null && !contractReference(c.contractReference)) ||
      (c.contractDigest !== null && !contractDigest(c.contractDigest))
    )
      throw Error('INVALID');
    return c;
  }
  function bindAuth() {
    for (const button of container.querySelectorAll('button[data-figma-auth]'))
      button.addEventListener('click', () => {
        const action = button.dataset.figmaAuth;
        void perform(async () => {
          if (action === 'status') {
            await authStatus();
            notice = '서비스의 현재 인증 상태를 읽었습니다. 입력 중인 초안은 유지합니다.';
            return;
          }
          if (!bound()) throw Error('AUTH_UNAVAILABLE');
          const binding = authBinding(auth);
          if (action === 'start' || action === 'refresh') {
            const deadlineAt = Date.now() + (action === 'start' ? 300000 : 15000);
            pollUntil = deadlineAt;
            const method = action === 'start' ? api.connectionAuthStart : api.connectionAuthRefresh;
            const next = safeAuthStatus(await method({ ...binding, deadlineAt }));
            if (!next) throw Error('AUTH_RESPONSE_INVALID');
            auth = next;
          } else {
            const method =
              action === 'cancel' ? api.connectionAuthCancel : api.connectionAuthLogout;
            const next = safeAuthStatus(await method({ ...binding, flowId: auth.flowId }));
            if (!next) throw Error('AUTH_RESPONSE_INVALID');
            auth = next;
          }
        });
      });
  }
  function bind() {
    const form = container.querySelector('#figma-settings-form');
    for (const name of fields)
      form?.querySelector(`[name=${name}]`)?.addEventListener('input', event => {
        draft[name] = event.target.value.trim() || null;
      });
    for (const name of ['endpoint', 'mode'])
      form?.querySelector(`[name=${name}]`)?.addEventListener('change', () => render());
    form?.addEventListener('submit', event => {
      event.preventDefault();
      let c;
      try {
        c = configuration();
      } catch {
        error = '환경 변수 이름과 설치된 계약 참조·해시만 입력하세요. 인증 값은 입력하지 않습니다.';
        render();
        return;
      }
      void perform(async () => {
        onActivity?.('connection.settings.intent');
        const input = auth
          ? { revision: view.revision, ...authBinding(auth), configuration: c }
          : { revision: view.revision, endpoint: c.endpoint, oauthTokenEnv: c.oauthTokenEnv };
        if (!auth && c.mode === 'own-oauth') throw Error('AUTH_UNAVAILABLE');
        view = await api.connectionSettingsSave(input);
        draft = c;
        await authStatus();
        notice =
          '참조 설정을 저장했습니다. 실제 환경·자격·연결 준비는 서비스 상태와 검사 결과로 확인하세요.';
      });
    });
    for (const button of container.querySelectorAll('[data-figma-setting]'))
      button.addEventListener('click', () => {
        const action = button.dataset.figmaSetting;
        if (action === 'reload')
          void perform(async () => {
            onActivity?.('connection.refresh');
            await load();
          });
        else if (action === 'probe')
          void perform(async () => {
            onActivity?.('connection.probe.intent');
            view = await api.connectionSettingsProbe(view.revision);
            notice = '현재 서비스의 인증 설정으로 검사했습니다. 파일 수집 완료를 뜻하지 않습니다.';
          });
        else if (action === 'apply') {
          onApplyToDraft?.(view.configuration.endpoint);
          onActivity?.('draft.edit', { field: 'collector' });
          notice = '저장한 연결을 초안에 반영했습니다.';
          render();
        }
      });
  }
  void perform(load);
  return () => {
    active = false;
    clearTimeout(timer);
    pollController?.abort();
  };
}
