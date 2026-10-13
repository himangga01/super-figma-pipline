import type { Note, User } from '../../server-types';
export interface SessionResponse { user: User | null; csrf: string }
export interface NotesClient {
  session(): Promise<SessionResponse>;
  login(username: string, password: string): Promise<SessionResponse>;
  logout(): Promise<{ loggedOut: boolean }>;
  list(): Promise<{ notes: Note[] }>;
  create(title: string, content: string): Promise<{ note: Note }>;
  update(id: string, title: string, content: string): Promise<{ note: Note }>;
  remove(id: string): Promise<{ deleted: boolean }>;
}
export class NotesRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function createNotesClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): NotesClient {
  let csrf: string | undefined;
  async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await fetcher(path, { method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null) throw Error('INVALID_RESPONSE');
    const fields = value as Record<string, unknown>;
    if (!response.ok) throw new NotesRequestError(typeof fields.error === 'string' ? fields.error : 'REQUEST_FAILED', response.status);
    if (typeof fields.csrf === 'string') csrf = fields.csrf;
    return value as T;
  }
  return {
    session: () => request<SessionResponse>('/api/session'),
    login: async (username, password) => { await request('/api/session'); return request<SessionResponse>('/api/login', 'POST', { username, password }); },
    logout: async () => { const result = await request<{ loggedOut: boolean }>('/api/logout', 'POST', {}); csrf = undefined; return result; },
    list: () => request<{ notes: Note[] }>('/api/notes'),
    create: (title, content) => request<{ note: Note }>('/api/notes', 'POST', { title, content }),
    update: (id, title, content) => request<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`, 'PATCH', { title, content }),
    remove: id => request<{ deleted: boolean }>(`/api/notes/${encodeURIComponent(id)}`, 'DELETE'),
  };
}
