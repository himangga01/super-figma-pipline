import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CURRENT_CDD_URL = 'https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120';
export const ORIGINAL_SOURCE_REQUEST_SECONDS = 1800;
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const workflow = (roles, states, routes, apiContracts, dataContracts, layers, action, evidence) => ({ status: 'confirmed', roles, states, routes, apiContracts, dataContracts, decisions: layers.map(layer => ({ layer, action, evidence })) });
const requirement = (id, description, layers, value) => ({ id, description, layers, required: true, workflow: value });

/** Requirement contracts use defaults derived from screened Epic under owner-authorized C2/C3 scope. */
export async function createActualCasePlanInputs({ caseId, legacyRoot, implementationRoot, referenceWorkspaceId, referenceRootPath = 'node-custom-server', newTargetPath }) {
  const design = { url: CURRENT_CDD_URL, source: 'chrome', collector: 'page-api', freshness: 'require-live' };
  if (caseId === 'c2') {
    if (!legacyRoot) throw Error('Actual secret-free registered Epic target required');
    const source = async path => path + ':' + digest(await readFile(join(legacyRoot, path)));
    const authEvidence = await source('app/utils/auth.server.ts'), dbEvidence = await source('prisma/schema.prisma');
    const auth = ['frontend', 'backend', 'api', 'database', 'authentication', 'configuration'];
    const notes = ['frontend', 'backend', 'api', 'database', 'authentication', 'authorization', 'configuration'];
    return { case: 'legacy', targetPath: '.', references: [], services: ['.'], design, requirements: [
      requirement('c2-design-extension', 'Implement the current CDD presentation as an actual Epic landing extension, preserving existing login/signup/owner-note handlers and all unrelated routes.', ['frontend', 'configuration'],
        workflow(['visitor', 'local-user'], ['loading', 'ready', 'desktop', 'mobile', 'guide', 'login-entry', 'registration-entry', 'owner-notes-entry'], ['/', '/guide', '/mobile', '/desktop', '/signup', '/resources/own-notes'], [], [], ['frontend', 'configuration'], 'extend', 'Owner selected current CDD1378:120; generate only from this case own current capture. Existing Epic auth/session/Honeypot providers and real handlers remain. Registration entry is real /signup, not a claimed external email-provider success. ' + authEvidence)),
      requirement('c2-local-auth', 'Preserve Epic password login, HttpOnly signed session, logout and existing user/password data; add explicit mutation Origin protection without changing the login-free service portal.', auth,
        workflow(['anonymous', 'local-user'], ['anonymous', 'authenticated', 'invalid-credentials', 'logged-out'], ['/login', '/logout'],
          ['GET /login remains anonymous-only. POST /login validates actual password and creates persisted Session. POST /logout retires the actual session. Missing/foreign Origin mutation requests return403.'],
          ['Retain User, Password and Session Prisma contracts and cookie flags. Use only fresh broker-owned synthetic acceptance state. Do not reset/copy original private DB or credentials.'], auth, 'extend', authEvidence + '; ' + dbEvidence)),
      requirement('c2-notes', 'Preserve Epic public note reads, owner create/edit/delete and delete:any permission; attach current CDD presentation to existing handlers, retaining all unrelated source and data.', notes,
        workflow(['anonymous-reader', 'note-owner', 'other-user', 'admin'], ['list', 'detail', 'editing', 'invalid-input', 'not-owner', 'deleted', 'restarted'], ['/users/:username/notes', '/users/:username/notes/new', '/users/:username/notes/:noteId', '/users/:username/notes/:noteId/edit'],
          ['Existing React Router loaders/actions remain the API. Anonymous writes redirect to login; other-user edits return404; unauthorized deletion returns403; owner form writes persist and invalid input returns400.'],
          ['Retain Note.ownerId, users/passwords, baseline notes, role/permission and image metadata rows. A real restart rereads accepted writes from the same broker SQLite. Current scoped workflow is text notes; preserved optional upload code is not a claimed provider journey.'], notes, 'extend', dbEvidence + '; existing app/routes/users and permissions.server.ts; current CDD1378:120 scope selected by owner')),
    ] };
  }
  if (caseId !== 'c3' || !/^[0-9a-f-]{36}$/u.test(referenceWorkspaceId ?? '') || !newTargetPath || !implementationRoot) throw Error('Actual registered reference and genuinely new C3 target required');
  const source = async path => path + ':' + digest(await readFile(join(implementationRoot, path)));
  const store = await source('c3-workspace/framework/server/notes/store.ts'), handlers = await source('c3-workspace/framework/server/notes/handler.ts'), server = await source('c3-workspace/framework/server.js');
  const front = ['frontend', 'configuration'], data = ['frontend', 'backend', 'api', 'database', 'configuration'], auth = ['frontend', 'backend', 'api', 'authentication', 'authorization', 'database'];
  return { case: 'new-reference', stack: 'react-vite', targetPath: newTargetPath, references: [{ workspaceId: referenceWorkspaceId, rootPath: referenceRootPath, role: 'primary' }], design, requirements: [
    requirement('c3-design-portal', 'Independently generate the current CDD1378:120 portal and its applicable interactions; add the operational notes workspace default using real same-origin services.', front,
      workflow(['visitor', 'local-user'], ['loading', 'ready', 'empty', 'validation-error', 'service-error'], ['/', '/guide', '/mobile', '/desktop', '/notes'], [], [], front, 'implement', 'Owner selected current CDD1378:120. The minimal local notes domain is an implementation default derived from screened Epic under the authorized C2/C3 scope. Reuse reference Express/React Router architecture only. No reference frontend or C4 lease is candidate authority; ' + server)),
    requirement('c3-server-data-journey', 'Implement independent durable notes handlers, schema migration, actual SSR/static startup and frontend-to-SQLite writes; preserve initial synthetic baseline rows through restart and deletion.', data,
      workflow(['signed-in-owner', 'other-user'], ['initial', 'read', 'validated-write', 'persisted', 'restarted', 'invalid-request', 'not-found'], ['/notes', '/api/notes', '/api/notes/:id'],
        ['GET /api/notes lists only current owner notes. POST /api/notes {title,content} creates201. PATCH /api/notes/:id validates and updates200. DELETE owned note returns200. Foreign/missing rows return404; malformed/empty/overlimit/unknown fields return400; excessive body returns413.'],
        ['SQLite users/sessions/notes and schema_version1 are independent of the reference. Unsupported schema is rejected before mutation; migrations are repeatable for version1. Durable owner rows/session persist after actual owned restart. Static Figma assets are frontend resources; no object upload/payment/email/OAuth provider journey is required by the selected text-note domain.'], data, 'implement', store + '; ' + handlers + '; ' + server)),
    requirement('c3-auth-ownership', 'Implement real local password authentication, durable HttpOnly session and owner checks with exact-Origin/CSRF/logout negatives and actual generated UI.', auth,
      workflow(['anonymous', 'owner', 'other-user'], ['signed-out', 'signed-in', 'expired-session', 'logged-out', 'unauthorized', 'csrf-rejected'], ['/notes', '/api/session', '/api/login', '/api/logout'],
        ['GET /api/session returns user/null and CSRF token. POST /api/login {username,password} validates scrypt password, rotates session200 or rejects401. Mutations require exact Origin and bound CSRF token403. POST /api/logout revokes server session; replaying old cookie fails401.'],
        ['Fresh synthetic owner/other accounts only. Store salted scrypt password hashes and hashed random session identifiers in owned SQLite, with eight-hour expiry. Never copy legacy database/password or production .env values.'], auth, 'implement', store + '; ' + handlers)),
  ] };
}
