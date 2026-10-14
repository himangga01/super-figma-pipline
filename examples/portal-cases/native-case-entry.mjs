import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join, dirname, isAbsolute, basename } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// This is an executable native-profile command, not a self-issued service authority.
const root = process.cwd(), caseId = process.env.PORTAL_CASE;
if (!['c2', 'c3'].includes(caseId) || process.platform !== 'win32') throw Error('Actual Windows C2/C3 native case required');
for (const name of ['SFP_NATIVE_MODULE_POLICY', 'SFP_NATIVE_MODULE_POLICY_HASH', 'SFP_PORTAL_VALIDATOR_URL', 'DATABASE_PATH', 'SFP_PORTAL_CHROME_EXECUTABLE', 'PORT']) if (!process.env[name]) throw Error('Service native binding missing: ' + name);
const database = process.env.DATABASE_PATH, chrome = process.env.SFP_PORTAL_CHROME_EXECUTABLE;
if (!isAbsolute(database) || !isAbsolute(chrome) || basename(chrome).toLowerCase() !== 'chrome.exe') throw Error('Owned database and installed Chrome required');
const dbInfo = await lstat(database); if (!dbInfo.isFile() || dbInfo.isSymbolicLink() || dbInfo.nlink !== 1) throw Error('Fresh regular broker database required');
if (await realpath(database) !== resolve(database)) throw Error('Database alias rejected');
const policyHash = 'sha256:' + createHash('sha256').update(await readFile(process.env.SFP_NATIVE_MODULE_POLICY)).digest('hex');
if (policyHash !== process.env.SFP_NATIVE_MODULE_POLICY_HASH) throw Error('Native module policy changed');
const port = Number(process.env.PORT); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Admitted fixed loopback PORT required');
const origin = 'http://127.0.0.1:' + port;
const netstat = join(process.env.SystemRoot, 'System32', 'netstat.exe');
const req = createRequire(join(root, 'package.json'));
// Use the service's own hash-bound installed Playwright package, never a caller path.
const { chromium } = createRequire(fileURLToPath(process.env.SFP_PORTAL_VALIDATOR_URL))('playwright');
const accounts = {};
const password = 'SyntheticOnly-' + randomBytes(24).toString('base64url');
const fixtureId = randomUUID().replaceAll('-', '');
const output = resolve(root, 'acceptance-output'); await mkdir(output, { recursive: true });
try { await lstat(join(root, '.env')); throw Error('Nonexample environment file forbidden'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const syntheticEnvironment = caseId === 'c2' ? {
  SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(32).toString('base64url'),
  INTERNAL_COMMAND_TOKEN: process.env.INTERNAL_COMMAND_TOKEN ?? randomBytes(32).toString('base64url'),
  HONEYPOT_SECRET: process.env.HONEYPOT_SECRET ?? randomBytes(32).toString('base64url'),
  LITEFS_DIR: join(output, 'litefs-metadata'),
  AWS_ACCESS_KEY_ID: 'SYNTHETIC_UNUSED_LOCAL_ONLY', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_UNUSED_LOCAL_ONLY',
  AWS_REGION: 'local', AWS_ENDPOINT_URL_S3: 'http://127.0.0.1:9', BUCKET_NAME: 'synthetic-unused',
  SENTRY_DSN: '', SENTRY_AUTH_TOKEN: '', RESEND_API_KEY: '', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', GITHUB_TOKEN: '',
  MOCKS: 'false', ALLOW_INDEXING: 'false', ALLOWED_HOSTS: '127.0.0.1,localhost',
} : {};
if (caseId === 'c2') await mkdir(syntheticEnvironment.LITEFS_DIR, { recursive: true });
let app, browser; const processes = [], checks = [];
function exactListenerPids(stdout) {
  const pids = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*TCP(?:v6)?\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/u.exec(line);
    if (!match || !match[1].endsWith(':' + port)) continue;
    if (!['127.0.0.1:' + port, '0.0.0.0:' + port, '[::]:' + port, '[::1]:' + port].includes(match[1])) continue;
    if (match[1] !== '127.0.0.1:' + port) throw Error('Nonexclusive loopback listener');
    pids.push(Number(match[2]));
  }
  return pids;
}
async function listenerPids() {
  const outputs = await Promise.all(['tcp', 'tcpv6'].map(family => new Promise((done, reject) => execFile(netstat, ['-ano', '-p', family], { encoding: 'utf8', timeout: 5000, maxBuffer: 1048576, windowsHide: true }, (error, stdout) => error ? reject(error) : done(stdout)))));
  return exactListenerPids(outputs.join('\n'));
}
async function assertOwnedListener() {
  if (!app || app.exitCode !== null || app.signalCode !== null || !app.pid) throw Error('Owned application is not alive');
  const pids = await listenerPids(); if (!pids.length || pids.some(pid => pid !== app.pid)) throw Error('Application listener not owned');
}
async function stopApp() {
  if (!app || app.exitCode !== null || app.signalCode !== null) return;
  const current = app, exit = once(current, 'exit'); current.kill('SIGTERM');
  await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(Error('Owned stop unknown; broker must retire job')), 10000).unref())]);
  app = undefined;
  if ((await listenerPids()).length) throw Error('Listener remains after owned stop');
}
async function startApp() {
  if ((await listenerPids()).length) throw Error('Selected listener is already occupied');
  const env = { ...process.env, ...syntheticEnvironment, APPLICATION_ORIGIN: origin };
  delete env.PORTAL_CASE;
  if (caseId === 'c2') {
    env.DATABASE_URL = 'file:' + database.replaceAll('\\', '/');
    if (!env.CACHE_DATABASE_PATH || !isAbsolute(env.CACHE_DATABASE_PATH)) throw Error('Separate fresh broker CACHE_DATABASE_PATH required');
  }
  app = spawn(process.execPath, [caseId === 'c2' ? 'index.ts' : 'server.js'], { cwd: root, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  processes.push(app.pid);
  // Bound logs are withheld because application stderr can contain private fixture state.
  const ownedChild = app;
  let bytes = 0; const drain = chunk => { bytes += chunk.length; if (bytes > 1048576) { ownedChild.kill('SIGTERM'); } };
  ownedChild.stdout.on('data', drain); ownedChild.stderr.on('data', drain);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null || app.signalCode !== null) throw Error('Owned app failed to start');
    try {
      await assertOwnedListener();
      const response = await fetch(origin + (caseId === 'c2' ? '/resources/healthcheck' : '/api/session'), { signal: AbortSignal.timeout(1000), redirect: 'manual' });
      await response.body?.cancel(); if (response.status === 200) return;
    } catch (error) { if (error.message === 'Nonexclusive loopback listener' || error.message === 'Application listener not owned') throw error; }
    await new Promise(done => setTimeout(done, 200));
  }
  throw Error('Owned application readiness exceeded');
}
async function seedFresh() {
  if (caseId === 'c3') {
    const { openStore } = await import('../server/notes/store.mjs'); const store = openStore(database);
    try {
      if (store.db.prepare('SELECT count(*) n FROM users').get().n || store.db.prepare('SELECT count(*) n FROM notes').get().n) throw Error('Fresh C3 resource required; refusing reset');
      for (const kind of ['owner', 'other']) { const username = kind + fixtureId.slice(0, 12); await store.createUser(username, password); accounts[kind] = { username, password }; }
      const id = store.db.prepare('SELECT id FROM users WHERE username=?').get(accounts.owner.username).id;
      store.create(id, 'Original acceptance note', 'Preserve original synthetic row');
    } finally { store.close(); }
    return;
  }
  const bcrypt = req('bcryptjs'), db = new DatabaseSync(database);
  try {
    if (db.prepare('SELECT count(*) n FROM User').get().n || db.prepare('SELECT count(*) n FROM Note').get().n) throw Error('Fresh C2 resource required; refusing reset');
    const now = Date.now(); db.exec('BEGIN IMMEDIATE');
    const roleIds = {};
    for (const name of ['user', 'admin']) {
      let role = db.prepare('SELECT id FROM Role WHERE name=?').get(name);
      if (!role) { const id = fixtureId + '-role-' + name; db.prepare('INSERT INTO Role(id,name,description,createdAt,updatedAt) VALUES(?,?,?,?,?)').run(id, name, 'Synthetic acceptance role', now, now); role = { id }; }
      roleIds[name] = role.id;
    }
    for (const action of ['create', 'read', 'update', 'delete']) for (const entity of ['note', 'user']) for (const access of ['own', 'any']) {
      let permission = db.prepare('SELECT id FROM Permission WHERE action=? AND entity=? AND access=?').get(action, entity, access);
      if (!permission) { const id = fixtureId + '-' + action + '-' + entity + '-' + access; db.prepare('INSERT INTO Permission(id,action,entity,access,description,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run(id, action, entity, access, 'Synthetic acceptance permission', now, now); permission = { id }; }
      for (const role of ['admin', ...(access === 'own' ? ['user'] : [])]) db.prepare('INSERT OR IGNORE INTO _PermissionToRole(A,B) VALUES(?,?)').run(permission.id, roleIds[role]);
    }
    for (const kind of ['owner', 'other', 'noRole', 'admin']) {
      const username = kind.toLowerCase() + fixtureId.slice(0, 10), id = fixtureId + '-' + kind;
      db.prepare('INSERT INTO User(id,email,username,name,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id, username + '@example.invalid', username, 'Synthetic acceptance account', now, now);
      db.prepare('INSERT INTO Password(hash,userId) VALUES(?,?)').run(bcrypt.hashSync(password, 10), id);
      if (kind !== 'noRole') db.prepare('INSERT INTO _RoleToUser(A,B) VALUES(?,?)').run(kind === 'admin' ? roleIds.admin : roleIds.user, id);
      accounts[kind] = { username, password };
    }
    db.prepare('INSERT INTO Note(id,title,content,createdAt,updatedAt,ownerId) VALUES(?,?,?,?,?,?)').run(fixtureId + '-baseline-note', 'Original acceptance note', 'Preserved synthetic row', now, now, fixtureId + '-owner');
    db.exec('COMMIT');
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
try {
  await seedFresh(); await startApp();
  browser = await chromium.launch({ channel: 'chrome', executablePath: chrome, headless: true, timeout: 30000, args: ['--disable-background-networking'] });
  const restartOwned = async () => { await stopApp(); await startApp(); };
  if (caseId === 'c2') {
    const { runEpicJourney } = await import('./epic-journey.mjs');
    checks.push(...(await runEpicJourney({ origin, databasePath: database, browser, assertOwnedListener, restartOwned, accounts })).checks);
  } else {
    const { openStore } = await import('../server/notes/store.mjs');
    const baseline = openStore(database), ownerId = baseline.db.prepare('SELECT id FROM users WHERE username=?').get(accounts.owner.username).id;
    const original = baseline.list(ownerId); baseline.close();
    const { runNotesApplicationJourney } = await import('./application-journey.mjs');
    checks.push(...(await runNotesApplicationJourney({ browser, origin, route: process.env.NOTES_ROUTE ?? '/notes', owner: accounts.owner, assertOwnedListener, restartOwned, verifyBaseline: async () => {
      const current = openStore(database); try { if (JSON.stringify(current.list(ownerId)) !== JSON.stringify(original)) throw Error('Baseline notes changed'); } finally { current.close(); }
    } })).checks);
    const { runNotesHttpNegatives } = await import('./http-negatives.mjs');
    checks.push(...await runNotesHttpNegatives({ origin, owner: accounts.owner, other: accounts.other, assertOwnedListener }));
    const final = openStore(database); try { if (JSON.stringify(final.list(ownerId)) !== JSON.stringify(original)) throw Error('Negative probes changed baseline notes'); } finally { final.close(); }
  }
} catch (error) { checks.push({ id: 'failure', passed: false, code: error.code ?? 'NATIVE_CASE_FAILED', messageHash: createHash('sha256').update(String(error.message)).digest('hex') }); process.exitCode = 1; }
finally {
  if (browser) await browser.close().catch(() => { checks.push({ id: 'chrome-close-unknown', passed: false }); process.exitCode = 1; });
  await stopApp().catch(() => { checks.push({ id: 'app-stop-unknown', passed: false }); process.exitCode = 1; });
  const receipt = { at: new Date().toISOString(), caseId, scope: 'actual-candidate-native-handler-and-ui-journey', processes, checks, passed: checks.length > 0 && checks.every(check => check.passed), publicPipelineAccepted: false, designVisualAccepted: false, brokerCleanupMustBeVerifiedByService: true };
  await writeFile(join(output, caseId + '-journey.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(receipt));
}
