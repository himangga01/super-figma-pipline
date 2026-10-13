export class PortalError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'PortalError';
    this.code = code;
    this.issues = issues;
  }
}

export function createApi(
  fetcher = globalThis.fetch.bind(globalThis),
  onActivityWarning = () => {},
) {
  let token;
  async function request(path, method = 'GET', body, signal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetcher(`/api${path}`, {
        method,
        credentials: 'same-origin',
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        ...(path === '/activities' && method === 'POST' ? { keepalive: true } : {}),
        headers: {
          Accept: 'application/json',
          ...(body === undefined
            ? {}
            : { 'Content-Type': 'application/json', 'X-SFP-CSRF': token ?? '' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (response.headers?.get('x-sfp-activity-warning')) onActivityWarning();
      if (!response.ok)
        throw new PortalError(
          data.error?.code ?? 'HTTP_ERROR',
          data.error?.message ?? `HTTP ${response.status}`,
          data.error?.issues,
        );
      return data;
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalError(
        error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'CONNECTION_FAILED',
        error.name === 'AbortError'
          ? '응답 시간이 초과되었습니다. 실행 상태를 확인한 뒤 다음 동작을 선택하세요.'
          : '서버에 연결할 수 없습니다. 로컬 포털 서버가 실행 중인지 확인하세요.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    async bootstrap() {
      const data = await request('/bootstrap');
      token = data.csrfToken;
      return data;
    },
    workflows: () => request('/workflows'),
    registerWorkspace: folder => request('/workspaces', 'POST', { folder }),
    activity: event => request('/activities', 'POST', event),
    connectionSettingsGet: () => request('/figma-settings'),
    connectionSettingsSave: value => request('/figma-settings', 'PUT', value),
    connectionSettingsProbe: revision => request('/figma-settings/probe', 'POST', { revision }),
    connectionAuthStatus: signal => request('/figma-settings/auth', 'GET', undefined, signal),
    connectionAuthStart: (value, signal) =>
      request('/figma-settings/auth/start', 'POST', value, signal),
    connectionAuthCancel: (value, signal) =>
      request('/figma-settings/auth/cancel', 'POST', value, signal),
    connectionAuthLogout: (value, signal) =>
      request('/figma-settings/auth/logout', 'POST', value, signal),
    connectionAuthRefresh: (value, signal) =>
      request('/figma-settings/auth/refresh', 'POST', value, signal),
    serviceCatalog: () => request('/service/catalog'),
    serviceJobs: () => request('/service/jobs'),
    serviceJobCreate: input => request('/service/jobs', 'POST', input),
    serviceJob: (id, signal) =>
      request(`/service/jobs/${encodeURIComponent(id)}`, 'GET', undefined, signal),
    serviceJobAction: (id, input) =>
      request(`/service/jobs/${encodeURIComponent(id)}/actions`, 'POST', input),
    activities: filters => {
      const query = new URLSearchParams(
        Object.entries(filters ?? {})
          .filter(([, value]) => value !== '' && value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      );
      return request(`/activities?${query}`);
    },
    workflow: id => request(`/workflows/${encodeURIComponent(id)}`),
    save: workflow => {
      const { id, ...body } = workflow;
      return request(
        id ? `/workflows/${encodeURIComponent(id)}` : '/workflows',
        id ? 'PUT' : 'POST',
        body,
      );
    },
    validate: input => request('/workflows/validate', 'POST', input),
    runs: () => request('/runs'),
    start: (id, revision) =>
      request(`/workflows/${encodeURIComponent(id)}/runs`, 'POST', { revision }),
    run: id => request(`/runs/${encodeURIComponent(id)}`),
    events: (id, after) =>
      request(`/runs/${encodeURIComponent(id)}/events?after=${encodeURIComponent(after)}`),
    action: (id, action, args = {}) =>
      request(`/runs/${encodeURIComponent(id)}/actions`, 'POST', { action, args }),
  };
}
