import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const snapshot = databasePath => {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    // Password hashes remain in memory. Reports contain assertion outcomes only.
    return Object.fromEntries(['User', 'Password', 'Note', 'NoteImage', 'UserImage', 'Role', 'Permission', '_RoleToUser', '_PermissionToRole'].map(table => {
      const exists = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n;
      return [table, exists ? db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() : null];
    }));
  } finally { db.close(); }
};

/** Service-owned Chrome/process/resource adapters must supply these explicit arguments. */
export async function runEpicJourney({ origin, databasePath, browser, assertOwnedListener, restartOwned, accounts }) {
  const url = new URL(origin);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.protocol, 'http:'); assert.equal(url.origin, origin);
  assert.ok(databasePath && browser && assertOwnedListener && restartOwned);
  for (const key of ['owner', 'other', 'noRole', 'admin']) assert.ok(accounts[key]?.username && accounts[key]?.password);
  const baseline = snapshot(databasePath), checks = [], contexts = [];
  const record = id => checks.push({ id, passed: true });
  const owned = async () => { await assertOwnedListener(); };
  async function context() {
    const result = await browser.newContext(); contexts.push(result);
    await result.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    return result;
  }
  async function request(ctx, path, { method = 'GET', form, multipart, originHeader = origin } = {}) {
    assert.ok(path.startsWith('/') && !path.startsWith('//')); await owned();
    const cookies = (await ctx.cookies()).filter(c => c.domain === '127.0.0.1' && path.startsWith(c.path));
    const headers = { cookie: cookies.map(c => c.name + '=' + c.value).join(';') };
    if (method !== 'GET' && originHeader !== null) headers.origin = originHeader;
    let body;
    if (form) { body = new URLSearchParams(form); headers['content-type'] = 'application/x-www-form-urlencoded'; }
    if (multipart) { body = new FormData(); for (const [key, value] of Object.entries(multipart)) body.set(key, value); }
    const response = await fetch(origin + path, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    return { status: response.status, headers: response.headers, text: await response.text() };
  }
  async function login(ctx, account) {
    await owned(); const page = await ctx.newPage(); await page.goto(origin + '/login');
    await page.locator('input[name=username]').fill(account.username);
    await page.locator('input[name=password]').fill(account.password);
    await page.locator('form#login-form button[type=submit]').click();
    await page.waitForURL(next => next.pathname !== '/login', { timeout: 10000 }); return page;
  }
  const ownerRoot = '/users/' + encodeURIComponent(accounts.owner.username) + '/notes';
  try {
    const anonymous = await context(), owner = await context(), other = await context(), noRole = await context(), admin = await context();
    const anon = await request(anonymous, ownerRoot + '/new'); assert.equal(anon.status, 302); assert.match(anon.headers.get('location'), /\/login/u); record('epic-anonymous-write-denied');
    const wrong = await anonymous.newPage(); await wrong.goto(origin + '/login');
    await wrong.locator('input[name=username]').fill(accounts.owner.username); await wrong.locator('input[name=password]').fill('synthetic-definitely-wrong-password');
    await wrong.locator('form#login-form button[type=submit]').click(); await wrong.getByText('Invalid username or password', { exact: true }).waitFor();
    assert.equal(new URL(wrong.url()).pathname, '/login'); record('epic-wrong-password-denied');
    const page = await login(owner, accounts.owner); await login(other, accounts.other); await login(noRole, accounts.noRole); await login(admin, accounts.admin); record('epic-real-password-session-login');
    await page.goto(origin + ownerRoot + '/new');
    await page.locator('input[name=title]').fill('Acceptance transient note'); await page.locator('textarea[name=content]').fill('Acceptance content');
    await page.locator('button[form="note-editor"][type="submit"]').click();
    await page.waitForURL(next => next.pathname.startsWith(ownerRoot + '/') && !next.pathname.endsWith('/new'), { timeout: 10000 });
    const id = new URL(page.url()).pathname.split('/').at(-1); assert.ok(id && id !== 'new'); record('epic-real-browser-create');
    const path = ownerRoot + '/' + encodeURIComponent(id);
    await page.goto(origin + path + '/edit'); await page.locator('textarea[name=content]').fill('Acceptance persisted edit');
    await page.locator('button[form="note-editor"][type="submit"]').click(); await page.waitForURL(next => next.pathname === path); record('epic-real-browser-edit');
    assert.equal((await request(other, path + '/edit')).status, 404);
    assert.equal((await request(other, path, { method: 'POST', form: { intent: 'delete-note', noteId: id } })).status, 403); record('epic-other-owner-edit-delete-denied');
    assert.equal((await request(noRole, path, { method: 'POST', form: { intent: 'delete-note', noteId: id } })).status, 403); record('epic-no-role-delete-denied');
    assert.equal((await request(owner, '/admin/cache')).status, 403); record('epic-nonadmin-denied');
    assert.equal((await request(owner, path + '/edit', { method: 'POST', multipart: { id, title: '', content: 'invalid' } })).status, 400); record('epic-invalid-input-denied');
    assert.equal((await request(owner, path, { method: 'POST', originHeader: 'https://foreign.invalid', form: { intent: 'delete-note', noteId: id } })).status, 403); record('epic-cross-origin-csrf-denied');
    assert.equal((await request(owner, path, { method: 'POST', originHeader: null, form: { intent: 'delete-note', noteId: id } })).status, 403); record('epic-missing-origin-denied');
    assert.equal((await request(owner, '/logout', { method: 'POST', originHeader: 'https://foreign.invalid', form: {} })).status, 403); record('epic-cross-origin-logout-denied');
    await restartOwned(); await owned();
    const reread = await request(owner, path); assert.equal(reread.status, 200); assert.ok(reread.text.includes('Acceptance persisted edit')); record('epic-real-restart-persistence');
    assert.equal((await request(owner, path, { method: 'POST', form: { intent: 'delete-note', noteId: id } })).status, 302); record('epic-owner-delete');
    await page.goto(origin + ownerRoot + '/new');
    await page.locator('input[name=title]').fill('Acceptance admin transient note'); await page.locator('textarea[name=content]').fill('Delete through actual delete:any permission');
    await page.locator('button[form="note-editor"][type="submit"]').click();
    await page.waitForURL(next => next.pathname.startsWith(ownerRoot + '/') && !next.pathname.endsWith('/new'), { timeout: 10000 });
    const adminNotePath = new URL(page.url()).pathname, adminNoteId = adminNotePath.split('/').at(-1);
    assert.ok(adminNoteId && adminNoteId !== 'new');
    assert.equal((await request(admin, adminNotePath, { method: 'POST', form: { intent: 'delete-note', noteId: adminNoteId } })).status, 302);
    assert.equal((await request(owner, adminNotePath)).status, 404); record('epic-admin-delete-any-owner-note');
    // Direct fetch intentionally retains the old cookie to test server-side revocation.
    assert.equal((await request(owner, '/logout', { method: 'POST', form: {} })).status, 302);
    assert.equal((await request(owner, ownerRoot + '/new')).status, 302); record('epic-logout-revokes-session');
    assert.deepEqual(snapshot(databasePath), baseline); record('epic-baseline-users-password-notes-roles-images-preserved');
    return { checks, passed: true, servicePipelineAccepted: false };
  } finally {
    for (const ctx of contexts) await ctx.close();
    // Browser ownership stays with the caller; never close retained Chrome here.
  }
}
