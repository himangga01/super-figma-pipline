import { sameToken, token } from './store.mjs';

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; } }
const fail = (status, code) => { throw new HttpError(status, code); };
function cookie(req, name) {
  const matches = (req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}
async function body(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') fail(415, 'JSON_REQUIRED');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes <= 16384) chunks.push(chunk); }
  if (bytes > 16384) fail(413, 'BODY_TOO_LARGE');
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, 'INVALID_INPUT'); return value; }
  catch (error) { if (error instanceof HttpError) throw error; fail(400, 'INVALID_JSON'); }
}
function fields(value, allowed) { if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'INVALID_INPUT'); }
function note(value) {
  fields(value, ['title', 'content']);
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120 || typeof value.content !== 'string' || value.content.length > 8000) fail(400, 'INVALID_INPUT');
  return { title: value.title.trim(), content: value.content };
}

/** Attach before the reference SSR handler: app.use(createNotesHandler(store, { origin })). */
export function createNotesHandler(store, { origin, secureCookies = false } = {}) {
  if (!origin || !['http:', 'https:'].includes(new URL(origin).protocol) || new URL(origin).origin !== origin) throw Error('Exact origin required');
  if (secureCookies !== origin.startsWith('https:')) throw Error('Cookie transport must match origin');
  const failures = new Map();
  const cookieLine = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  return async (req, res, next) => {
    let path;
    try { path = new URL(req.url, origin).pathname; } catch { send(res, 400, { error: 'INVALID_URL' }); return; }
    if (!path.startsWith('/api/')) { if (next) return next(); return send(res, 404, { error: 'NOT_FOUND' }); }
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    try {
      const method = req.method;
      const raw = cookie(req, 'notes_session');
      const session = store.session(raw);
      if (path === '/api/session' && method === 'GET') {
        if (session) return send(res, 200, { user: { id: session.id, username: session.username, role: session.role }, csrf: session.csrf });
        const csrf = token(); res.setHeader('set-cookie', cookieLine('notes_login_csrf', csrf, 600));
        return send(res, 200, { user: null, csrf });
      }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        // Cross-origin redirects/fetches cannot pass both exact Origin and token binding.
        if (req.headers.origin !== origin) fail(403, 'ORIGIN_REJECTED');
        const csrf = path === '/api/login' ? cookie(req, 'notes_login_csrf') : session?.csrf;
        if (!sameToken(req.headers['x-csrf-token'], csrf)) fail(403, 'CSRF_REJECTED');
      }
      if (path === '/api/login' && method === 'POST') {
        const value = await body(req); fields(value, ['username', 'password']);
        if (typeof value.username !== 'string' || !/^[a-z][a-z0-9_-]{2,31}$/u.test(value.username) || typeof value.password !== 'string' || value.password.length < 1 || value.password.length > 256) fail(400, 'INVALID_INPUT');
        const key = `${req.socket.remoteAddress}:${value.username}`, now = Date.now();
        for (const [id, entry] of failures) if (entry.until < now) failures.delete(id);
        if (failures.size > 10000 || (failures.get(key)?.count ?? 0) >= 10) fail(429, 'LOGIN_RATE_LIMITED');
        const result = await store.login(value.username, value.password);
        if (!result) { const previous = failures.get(key); failures.set(key, { count: (previous?.count ?? 0) + 1, until: previous?.until ?? now + 900000 }); fail(401, 'INVALID_CREDENTIALS'); }
        failures.delete(key);
        if (raw) store.logout(raw);
        res.setHeader('set-cookie', [cookieLine('notes_session', result.raw, 28800), cookieLine('notes_login_csrf', '', 0)]);
        return send(res, 200, { user: result.user, csrf: result.csrf });
      }
      if (!session) fail(401, 'AUTH_REQUIRED');
      if (path === '/api/logout' && method === 'POST') {
        fields(await body(req), []); store.logout(raw); res.setHeader('set-cookie', cookieLine('notes_session', '', 0));
        return send(res, 200, { loggedOut: true });
      }
      if (path === '/api/notes') {
        if (method === 'GET') return send(res, 200, { notes: store.list(session.id) });
        if (method === 'POST') { const value = note(await body(req)); return send(res, 201, { note: store.create(session.id, value.title, value.content) }); }
        fail(405, 'METHOD_NOT_ALLOWED');
      }
      const match = /^\/api\/notes\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.exec(path);
      if (match) {
        const id = match[1];
        if (method === 'GET') { const found = store.get(session.id, id); if (!found) fail(404, 'NOT_FOUND'); return send(res, 200, { note: found }); }
        if (method === 'PATCH') { const value = note(await body(req)); const found = store.update(session.id, id, value.title, value.content); if (!found) fail(404, 'NOT_FOUND'); return send(res, 200, { note: found }); }
        if (method === 'DELETE') { if (!store.remove(session.id, id)) fail(404, 'NOT_FOUND'); return send(res, 200, { deleted: true }); }
        fail(405, 'METHOD_NOT_ALLOWED');
      }
      fail(404, 'NOT_FOUND');
    } catch (error) { send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'INTERNAL_ERROR' }); }
  };
}
