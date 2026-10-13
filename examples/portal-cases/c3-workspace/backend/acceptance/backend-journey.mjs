import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { openStore } from '../store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(root, '.acceptance-'));
const database = join(scratch, 'notes.sqlite');
const checks = [], processes = [];
const secret = randomBytes(24).toString('base64url');
let child, origin;
const record = id => checks.push({ id, passed: true });
const before = openStore(database);
await before.createUser('owner', secret); await before.createUser('other', secret);
const ownerId = before.db.prepare('SELECT id FROM users WHERE username=?').get('owner').id;
const original = before.create(ownerId, 'Preserve original', 'Original synthetic note');
const userBaseline = before.db.prepare('SELECT id,username,password_hash,role FROM users ORDER BY id').all();
before.close();
function environment() {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
  return { ...env, NODE_ENV: 'test', DATABASE_PATH: database, PORT: '0' };
}
async function start() {
  child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: environment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  processes.push(child.pid);
  let stdout = '';
  const ready = new Promise((resolveReady, reject) => {
    child.stdout.on('data', data => { stdout += data; const line = stdout.split('\n').find(line => line.includes('"event":"ready"')); if (line) { try { resolveReady(JSON.parse(line).origin); } catch { reject(Error('Invalid readiness')); } } });
    child.once('exit', () => reject(Error('Owned child exited before readiness')));
  });
  origin = await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(Error('Startup timed out')), 10000).unref())]);
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child; const exited = once(current, 'exit'); current.kill('SIGTERM');
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(Error('Owned child did not stop')), 10000).unref())]);
  child = undefined;
}
class Agent {
  cookies = new Map(); csrf;
  async request(path, { method = 'GET', data, originHeader = origin, csrf = this.csrf, rawBody } = {}) {
    assert.ok(path.startsWith('/api/'));
    const headers = { cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join(';') };
    if (method !== 'GET') { headers.origin = originHeader; headers['x-csrf-token'] = csrf ?? ''; headers['content-type'] = 'application/json'; }
    const response = await fetch(origin + path, { method, headers, redirect: 'manual', body: rawBody ?? (data === undefined ? undefined : JSON.stringify(data)), signal: AbortSignal.timeout(10000) });
    for (const value of response.headers.getSetCookie()) { const [key, cookie] = value.split(';')[0].split('='); if (cookie) this.cookies.set(key, cookie); else this.cookies.delete(key); }
    const value = await response.json(); if (value.csrf) this.csrf = value.csrf;
    return { status: response.status, value, headers: response.headers };
  }
  async login(username) { await this.request('/api/session'); const result = await this.request('/api/login', { method: 'POST', data: { username, password: secret } }); assert.equal(result.status, 200); }
}
try {
  await start(); record('migration-start');
  const anonymous = new Agent(), owner = new Agent(), other = new Agent();
  assert.equal((await anonymous.request('/api/notes')).status, 401); record('anonymous-read-denied');
  await anonymous.request('/api/session');
  assert.equal((await anonymous.request('/api/login', { method: 'POST', data: { username: 'owner', password: 'wrong-password' } })).status, 401); record('wrong-password-denied');
  assert.equal((await anonymous.request('/api/login', { method: 'POST', csrf: 'bad', data: { username: 'owner', password: secret } })).status, 403); record('login-csrf-denied');
  await owner.login('owner'); await other.login('other'); record('real-password-two-isolated-sessions');
  const sessionCookie = owner.cookies.get('notes_session');
  assert.ok(sessionCookie); assert.match((await owner.request('/api/session')).value.user.username, /^owner$/u);
  const made = await owner.request('/api/notes', { method: 'POST', data: { title: 'New note', content: 'Persisted content' } });
  assert.equal(made.status, 201); const id = made.value.note.id; record('real-create-to-sqlite');
  for (const [method, data] of [['GET', undefined], ['PATCH', { title: 'Stolen', content: '' }], ['DELETE', undefined]]) assert.equal((await other.request(`/api/notes/${id}`, { method, data })).status, 404);
  record('other-user-read-edit-delete-denied');
  assert.equal((await owner.request(`/api/notes/${id}`, { method: 'PATCH', originHeader: 'https://foreign.invalid', data: { title: 'Stolen', content: '' } })).status, 403); record('cross-origin-mutation-denied');
  assert.equal((await owner.request(`/api/notes/${id}`, { method: 'DELETE', csrf: 'bad' })).status, 403); record('session-csrf-denied');
  for (const data of [{ title: '', content: '' }, { title: 'valid', content: '', owner_id: 'other' }, { title: 'valid', content: 'x'.repeat(8001) }]) assert.equal((await owner.request(`/api/notes/${id}`, { method: 'PATCH', data })).status, 400);
  record('invalid-empty-overlimit-unknown-fields-denied');
  assert.equal((await owner.request('/api/notes', { method: 'POST', rawBody: 'x'.repeat(17000) })).status, 413); record('bounded-body-denied');
  assert.equal((await owner.request(`/api/notes/${id}`, { method: 'PATCH', data: { title: 'Edited', content: 'Durable edited content' } })).status, 200); record('real-update');
  await stop(); await start();
  const persisted = await owner.request(`/api/notes/${id}`); assert.equal(persisted.status, 200); assert.equal(persisted.value.note.content, 'Durable edited content'); record('session-and-note-persist-after-real-owned-restart');
  assert.equal((await owner.request('/api/logout', { method: 'POST', csrf: 'bad', data: {} })).status, 403); record('logout-csrf-denied');
  assert.equal((await owner.request(`/api/notes/${id}`, { method: 'DELETE' })).status, 200); record('owner-delete');
  const retainedCsrf = owner.csrf;
  assert.equal((await owner.request('/api/logout', { method: 'POST', data: {} })).status, 200); record('logout');
  owner.cookies.set('notes_session', sessionCookie); owner.csrf = retainedCsrf;
  assert.equal((await owner.request('/api/notes')).status, 401); record('revoked-session-cannot-replay');
  await stop();
  const after = openStore(database);
  assert.deepEqual(after.db.prepare('SELECT id,username,password_hash,role FROM users ORDER BY id').all(), userBaseline);
  assert.deepEqual(after.list(ownerId), [original]); after.close(); record('baseline-users-passwords-and-notes-preserved');
  assert.equal((await lstat(database)).isFile(), true);
} catch (error) { checks.push({ id: 'failure', passed: false, message: error.message }); process.exitCode = 1; }
finally {
  await stop().catch(error => { checks.push({ id: 'cleanup-failed', passed: false, message: error.message }); process.exitCode = 1; });
  const receipt = { at: new Date().toISOString(), node: process.version, scope: 'new-backend-owned-local-fixture', servicePipelineAccepted: false, currentDesignAccepted: false, checks, processes, passed: checks.every(check => check.passed) };
  await writeFile(join(scratch, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...receipt, receipt: join(scratch, 'receipt.json') }, null, 2));
}
