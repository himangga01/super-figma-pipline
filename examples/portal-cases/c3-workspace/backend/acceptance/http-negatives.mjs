import assert from 'node:assert/strict';

export async function runNotesHttpNegatives({ origin, owner, other, assertOwnedListener }) {
  assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.equal(new URL(origin).origin, origin);
  const checks = [], record = id => checks.push({ id, passed: true });
  class Agent {
    cookies = new Map(); csrf;
    async request(path, method = 'GET', data, extra = {}) {
      assert.ok(path.startsWith('/api/')); await assertOwnedListener();
      const headers = { cookie: [...this.cookies].map(([key, value]) => key + '=' + value).join(';') };
      if (method !== 'GET') Object.assign(headers, { origin, 'content-type': 'application/json', 'x-csrf-token': this.csrf ?? '' });
      Object.assign(headers, extra);
      const response = await fetch(origin + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'manual', signal: AbortSignal.timeout(10000) });
      for (const value of response.headers.getSetCookie()) { const [key, token] = value.split(';')[0].split('='); if (token) this.cookies.set(key, token); else this.cookies.delete(key); }
      const value = await response.json(); if (value.csrf) this.csrf = value.csrf;
      return { status: response.status, value };
    }
    async login(account) { await this.request('/api/session'); assert.equal((await this.request('/api/login', 'POST', account)).status, 200); }
  }
  const anonymous = new Agent(), own = new Agent(), foreign = new Agent();
  assert.equal((await anonymous.request('/api/notes')).status, 401); record('actual-app-anonymous-read-denied');
  await anonymous.request('/api/session');
  assert.equal((await anonymous.request('/api/login', 'POST', { username: owner.username, password: 'synthetic-wrong-password' })).status, 401); record('actual-app-wrong-password-denied');
  await own.login(owner); await foreign.login(other);
  const created = await own.request('/api/notes', 'POST', { title: 'Native negative transient', content: 'Delete after assertions' }); assert.equal(created.status, 201);
  const path = '/api/notes/' + created.value.note.id;
  for (const [method, data] of [['GET', undefined], ['PATCH', { title: 'foreign', content: '' }], ['DELETE', undefined]]) assert.equal((await foreign.request(path, method, data)).status, 404);
  record('actual-app-other-user-read-write-delete-denied');
  assert.equal((await own.request(path, 'PATCH', { title: '', content: '' })).status, 400);
  assert.equal((await own.request(path, 'PATCH', { title: 'valid', content: '', owner_id: 'forged' })).status, 400); record('actual-app-invalid-and-owner-field-denied');
  assert.equal((await own.request(path, 'DELETE', undefined, { origin: 'https://foreign.invalid' })).status, 403); record('actual-app-cross-origin-denied');
  assert.equal((await own.request(path, 'DELETE', undefined, { 'x-csrf-token': 'bad' })).status, 403); record('actual-app-csrf-denied');
  assert.equal((await own.request('/api/logout', 'POST', {}, { 'x-csrf-token': 'bad' })).status, 403); record('actual-app-logout-csrf-denied');
  assert.equal((await own.request(path, 'DELETE')).status, 200);
  const raw = own.cookies.get('notes_session'); assert.equal((await own.request('/api/logout', 'POST', {})).status, 200);
  own.cookies.set('notes_session', raw); assert.equal((await own.request('/api/notes')).status, 401); record('actual-app-logout-revocation-denied-replay');
  return checks;
}
