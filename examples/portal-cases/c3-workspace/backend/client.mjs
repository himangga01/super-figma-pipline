/** Same-origin adapter for the independently generated CDD React/Vite frontend. */
export function createNotesClient(fetcher = globalThis.fetch.bind(globalThis)) {
  let csrf;
  async function request(path, method = 'GET', data) {
    const response = await fetcher(path, { method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const value = await response.json();
    if (!response.ok) { const error = Error(value.error ?? 'REQUEST_FAILED'); error.status = response.status; throw error; }
    if (value.csrf) csrf = value.csrf;
    return value;
  }
  return {
    session: () => request('/api/session'),
    login: async (username, password) => { await request('/api/session'); return request('/api/login', 'POST', { username, password }); },
    logout: async () => { const result = await request('/api/logout', 'POST', {}); csrf = undefined; return result; },
    list: () => request('/api/notes'),
    create: (title, content) => request('/api/notes', 'POST', { title, content }),
    update: (id, title, content) => request(`/api/notes/${encodeURIComponent(id)}`, 'PATCH', { title, content }),
    remove: id => request(`/api/notes/${encodeURIComponent(id)}`, 'DELETE'),
  };
}
