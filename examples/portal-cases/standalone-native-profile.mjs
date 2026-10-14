import { readFile, lstat } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const hash = /^sha256:[a-f0-9]{64}$/u;
const bootstrap = 'const pipe=process.env.SFP_NATIVE_PREVIEW_PIPE,token=process.env.SFP_NATIVE_PREVIEW_TOKEN;delete process.env.SFP_NATIVE_PREVIEW_PIPE;delete process.env.SFP_NATIVE_PREVIEW_TOKEN;import(process.env.SFP_PORTAL_VALIDATOR_URL).then(m=>m.runNativePreviewWorker({pipe,token})).catch(e=>{process.stderr.write(String(e.code||e.message));process.exitCode=1})';

/** Return actual raw registration input. Service preparation supplies immutable artifact/grant authority. */
export async function createNativeCaseProfile({ caseId, root, ownerId, planId, contextHash, sourceHash, closure, nodeExecutable, chromeExecutable, externalArtifacts, previewSpec, requirementIds, sourceReviews = [], recipeUse, port, notesRoute = '/notes', dependencySharedRoot, dependencyLocalRoot, includeOwner = false }) {
  if (!['c2', 'c3'].includes(caseId) || !ownerId || !planId || !hash.test(contextHash) || !hash.test(sourceHash) || !Array.isArray(closure) || !closure.length || !Array.isArray(externalArtifacts) || !externalArtifacts.length) throw Error('Actual current registration and artifact bindings required');
  if (!isAbsolute(nodeExecutable) || !isAbsolute(chromeExecutable) || !Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Actual executable and owned loopback port required');
  if (!previewSpec?.manifest || !previewSpec?.interactionContract || new URL(previewSpec.baseUrl).origin !== 'http://127.0.0.1:' + port) throw Error('Actual source-bound service preview manifest/contract required');
  for (const path of [dependencySharedRoot, dependencyLocalRoot]) if (!path || !isAbsolute(path)) throw Error('Actual screened shared/local dependency roots required');
  for (const name of ['data', 'auth', 'frontend']) if (!Array.isArray(requirementIds?.[name]) || !requirementIds[name].length) throw Error('Confirmed actual workflow requirement IDs required');
  const mandatory = ['acceptance/native-case-entry.mjs', 'acceptance/provision-case.mjs', 'acceptance/compile-case.mjs', 'acceptance/serve-case.mjs', caseId === 'c2' ? 'acceptance/epic-journey.mjs' : 'acceptance/application-journey.mjs', caseId === 'c2' ? 'acceptance/migrate-case.mjs' : 'server/notes/migrate.mjs'];
  if (!caseId.endsWith('2')) mandatory.push('acceptance/http-negatives.mjs');
  for (const path of mandatory) {
    const file = await lstat(join(root, path)); if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) throw Error('Actual reviewed harness file required');
    const recorded = closure.find(item => item.path === path); if (!recorded || recorded.hash !== sha(await readFile(join(root, path)))) throw Error('Harness is not in the exact current closure');
  }
  const executableHash = sha(await readFile(nodeExecutable));
  const command = (id, args, produces = [], timeoutMs = 120000) => ({ id, executable: nodeExecutable, executableHash, args, cwd: '.', timeoutMs, maxOutputBytes: 1048576, allowLifecycleScripts: false, ...(produces.length ? { produces } : {}) });
  const c2 = caseId === 'c2', cli = c2 ? 'node_modules/@react-router/dev/bin.js' : 'node_modules/@react-router/dev/bin.cjs';
  const environment = { NODE_ENV: 'production', PORTAL_CASE: caseId, PORTAL_NATIVE_CASE: caseId, PORT: String(port), SFP_PORTAL_CHROME_EXECUTABLE: chromeExecutable, NOTES_ROUTE: notesRoute, CASE_DEPENDENCY_SHARED: dependencySharedRoot, CASE_DEPENDENCY_LOCAL: dependencyLocalRoot, CI: 'true', DO_NOT_TRACK: '1' };
  if (c2) Object.assign(environment, {
    APPLICATION_ORIGIN: 'http://127.0.0.1:' + port,
    SESSION_SECRET: randomBytes(32).toString('base64url'), INTERNAL_COMMAND_TOKEN: randomBytes(32).toString('base64url'), HONEYPOT_SECRET: randomBytes(32).toString('base64url'),
    AWS_ACCESS_KEY_ID: 'SYNTHETIC_UNUSED_LOCAL_ONLY', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_UNUSED_LOCAL_ONLY', AWS_REGION: 'local', AWS_ENDPOINT_URL_S3: 'http://127.0.0.1:9', BUCKET_NAME: 'synthetic-unused',
    MOCKS: 'false', ALLOW_INDEXING: 'false', ALLOWED_HOSTS: '127.0.0.1,localhost', SENTRY_DSN: '', RESEND_API_KEY: '', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', GITHUB_TOKEN: '',
  });
  const prefix = 'native-workspace/source';
  const output = [{ path: prefix + '/acceptance-output', kind: 'generated-output' }];
  const inner = command => ({ ...command, cwd: prefix });
  const assertion = (commandId, kind, requirementIds) => ({ commandId, check: { id: caseId + '-' + kind, kind, requirementIds, required: true } });
  return {
    schemaVersion: 1, sourceAuthorityVersion: 2, ...(includeOwner ? { ownerId } : {}), planId, contextHash, purpose: 'acceptance', sourceReviews,
    native: {
      schemaVersion: 1, sourceAuthorityVersion: 2, id: caseId + '-native-' + randomUUID(), executionMode: 'native-working-copy', environmentKind: 'disposable-test', sourceHash, closure,
      resources: [{ id: caseId + '-app-data', provider: 'owned-sqlite', binding: 'DATABASE_PATH', actions: ['read', 'write', 'create'] }, ...(c2 ? [{ id: 'c2-cache-data', provider: 'owned-sqlite', binding: 'CACHE_DATABASE_PATH', actions: ['read', 'write', 'create'] }] : [])],
      externalArtifacts, environment,
      commands: [
        command('dependency-provisioning', ['acceptance/provision-case.mjs'], [{ path: 'native-workspace', kind: 'provisioned-dependencies' }], 300000),
        { ...inner(command('actual-compiler', ['acceptance/compile-case.mjs'], ['.react-router', 'build', 'node_modules/.vite-temp', 'compiler-diagnostics', ...(c2 ? [] : ['tsconfig.node.tsbuildinfo', 'tsconfig.vite.tsbuildinfo'])].map(path => ({ path: prefix + '/' + path, kind: 'generated-output' })), 300000)), moduleLoader: 'tailwindcss-node-esm-cache-v1', moduleResolver: 'vite-import-meta-resolve-v1' },
        inner(command('migrate', [c2 ? 'acceptance/migrate-case.mjs' : 'server/notes/migrate.mjs'])),
        inner(command('actual-application-journey', ['acceptance/native-case-entry.mjs'], output, 300000)),
        { ...command('service-owned-chrome-preview', ['-e', bootstrap], [{ path: '.sfp-native-preview', kind: 'generated-output' }], 300000), preview: { protocol: 'sfp-owned-preview-v1', bootstrapHash: sha(bootstrap), serverArgs: ['acceptance/serve-case.mjs'], spec: { ...previewSpec, outputDirectory: '.sfp-native-preview/' + caseId } } },
      ],
    },
    ...(recipeUse ? { recipeUse } : {}),
    assertions: [
      assertion('actual-compiler', 'typecheck', [...requirementIds.data, ...requirementIds.auth]), assertion('actual-compiler', 'build', [...requirementIds.data, ...requirementIds.frontend]),
      assertion('migrate', 'migration', requirementIds.data), assertion('actual-application-journey', 'journey', [...requirementIds.data, ...requirementIds.auth]),
      assertion('actual-application-journey', 'authorization', requirementIds.auth), assertion('actual-application-journey', 'persistence', requirementIds.data),
      assertion('service-owned-chrome-preview', 'visual', requirementIds.frontend),
    ],
  };
}
