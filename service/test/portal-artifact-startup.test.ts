import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, expect, it } from 'vitest';

const serviceRoot = resolve(import.meta.dirname, '..');
const roots: string[] = [];
const oauthAssets = [
  'figma-auth-public.js',
  'figma-auth-consent.html',
  'figma-auth-consent.js',
  'figma-auth-consent.css',
] as const;
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const fixture = async (
  failure?:
    | 'missing-asset'
    | 'missing-cli-export'
    | 'missing-feature-export'
    | 'missing-chrome-owner-export'
    | 'missing-capture-proof-export'
    | 'schema-form.js'
    | 'service-functions.js'
    | 'figma-settings.js'
    | (typeof oauthAssets)[number]
    | 'consent-template-exposed'
    | 'consent-wrong-nonce'
    | 'consent-wrong-csp'
    | 'consent-wrong-body'
    | 'consent-wrong-referrer'
    | 'consent-wrong-cache'
    | 'consent-static-nonce'
    | 'consent-query-exposed'
    | 'consent-missing-placeholder'
    | 'consent-duplicate-placeholder',
) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-portal-artifact-'));
  roots.push(root);
  const source = join(root, 'service');
  const manifest = (name: string, version: string, extra: Record<string, unknown>) =>
    JSON.stringify({ name, version, private: true, type: 'module', ...extra });
  const portal = `#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {ControlClient,serviceTools,serviceFeatures,ChromeSessionOwner} from '@sfp/cli';
const client=new ControlClient();
const chromeOwner=new ChromeSessionOwner();
const failure=${JSON.stringify(failure ?? null)};
if(client.basis!=='extracted-mcp')throw Error('FIXTURE_RUNTIME_DEPENDENCY');
const server=createServer(async(request,response)=>{
 if(request.url==='/api/bootstrap'){response.setHeader('content-type','application/json');response.end(JSON.stringify({service:{available:await client.health()}}));return;}
 if(request.url==='/api/service/catalog'){response.setHeader('content-type','application/json');response.end(JSON.stringify({tools:serviceTools(),features:serviceFeatures()}));return;}
 if(request.url==='/figma-auth-consent'||(failure==='consent-query-exposed'&&request.url.startsWith('/figma-auth-consent?'))){
  const template=await readFile(join(import.meta.dirname,'../web/figma-auth-consent.html'),'utf8');
  const nonce=failure==='consent-wrong-nonce'?'malformed!':failure==='consent-static-nonce'?'A'.repeat(32):randomBytes(24).toString('base64url');
  const cspNonce=failure==='consent-wrong-csp'?'B'.repeat(32):nonce;
  response.setHeader('content-type','text/html; charset=utf-8');
  response.setHeader('cache-control',failure==='consent-wrong-cache'?'public, max-age=86400':'no-store');
  response.setHeader('referrer-policy',failure==='consent-wrong-referrer'?'no-referrer':'same-origin');
  response.setHeader('content-security-policy',"default-src 'none'; script-src 'self' 'nonce-"+cspNonce+"'; style-src 'self'; connect-src 'self'; form-action 'self' https://www.figma.com/oauth/mcp; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
  response.end(template.replace('__SFP_FIGMA_CONSENT_NONCE__',nonce)+(failure==='consent-wrong-body'?'<p>Unarchived body</p>':''));return;
 }
 if(request.url==='/figma-auth-consent.html'&&failure!=='consent-template-exposed'){response.writeHead(404);response.end();return;}
 const file=request.url==='/'?'index.html':request.url.slice(1);
 try{response.end(await readFile(join(import.meta.dirname,'../web',file)));}catch{response.writeHead(404);response.end();}
});
server.listen(Number(process.env.SFP_PORTAL_PORT),'127.0.0.1');
process.once('SIGTERM',()=>server.close(()=>chromeOwner.close().then(()=>process.exit(0))));`;
  const files: Record<string, string> = {
    LICENSE: 'MIT fixture',
    'THIRD_PARTY_NOTICES.md': '# Fixture notices',
    'PROVENANCE.md': '# Fixture provenance',
    'SBOM.spdx.json': '{}',
    'README.md': '# Fixture',
    'licenses/fixture.txt': 'fixture',
    'capabilities/union-manifest.json': '{}',
    'capabilities/rust-tool-compat.json': '{}',
    'capabilities/figmosha-feature-map.json': '{}',
    'packages/mcp/package.json': manifest('@sfp/mcp', '0.3.0', {
      exports: { '.': './dist/index.mjs' },
      dependencies: {},
    }),
    'packages/mcp/dist/index.mjs': 'export const basis="extracted-mcp";',
    'packages/mcp/dist/daemon-entry.mjs': '#!/usr/bin/env node\nprocess.exit(0);',
    'packages/cli/package.json': manifest('@sfp/cli', '0.3.0', {
      exports: { '.': './dist/library.mjs' },
      dependencies: { '@sfp/mcp': 'workspace:*' },
    }),
    'packages/cli/dist/index.mjs': '#!/usr/bin/env node\nprocess.exit(0);',
    'packages/cli/dist/library.mjs':
      failure === 'missing-cli-export'
        ? 'export const unavailable=true;'
        : 'import {basis} from "@sfp/mcp";export class ControlClient {basis=basis;async health(){return false;}}' +
          (failure === 'missing-chrome-owner-export'
            ? ''
            : 'export class ChromeSessionOwner {async close(){}}') +
          (failure === 'missing-capture-proof-export'
            ? ''
            : 'export const isLocalCapturePreEffectFailure=()=>false;') +
          'export const serviceTools=()=>[{name:"ping",inputSchema:{type:"object"}}];export const serviceFeatures=()=>[{name:"status",inputSchema:{type:"object"}}];export const parseServiceTool=()=>({});export const executeServiceFeature=()=>({});' +
          (failure === 'missing-feature-export'
            ? ''
            : 'export const parseServiceFeature=()=>({});'),
    'packages/portal/package.json': manifest('@sfp/portal', '0.7.0', {
      bin: { 'sfp-portal': './dist/index.mjs' },
      dependencies: { '@sfp/cli': 'workspace:*', '@sfp/shared': 'workspace:*' },
    }),
    'packages/portal/dist/index.mjs': portal,
    'packages/portal/DEBUGGING.md': '# Server diagnostics fixture\n',
    'packages/portal/web/index.html':
      '<!doctype html><link rel="stylesheet" href="/styles.css"><script type="module" src="/app.js"></script>',
    'packages/portal/web/app.js': 'import "./api.js";import "./model.js";',
    'packages/portal/web/api.js': 'export const unavailable=true;',
    'packages/portal/web/model.js': 'export const draft=true;',
    'packages/portal/web/schema-form.js': 'export const fields=true;',
    'packages/portal/web/service-functions.js': 'export const functions=true;',
    'packages/portal/web/figma-settings.js': 'export const settings=true;',
    'packages/portal/web/figma-auth-public.js': 'export const safeStatus=true;',
    'packages/portal/web/figma-auth-consent.html':
      '<!doctype html><meta name="referrer" content="same-origin"><link rel="stylesheet" href="/figma-auth-consent.css"><script type="module" nonce="__SFP_FIGMA_CONSENT_NONCE__" src="/figma-auth-consent.js"></script>',
    'packages/portal/web/figma-auth-consent.js': 'import "./figma-auth-public.js";',
    'packages/portal/web/figma-auth-consent.css': 'body { color: black; }',
    'packages/portal/web/styles.css': 'body { color: black; }',
    'packages/portal/web/tests/private.test.js': 'throw Error("must not ship");',
    'packages/plugin/manifest.json':
      '{"name":"fixture","main":"dist/code.js","ui":"dist/index.html"}',
    'packages/plugin/dist/code.js': 'figma.closePlugin();',
    'packages/plugin/dist/index.html': '<!doctype html><title>plugin</title>',
  };
  if (failure === 'missing-asset') delete files['packages/portal/web/styles.css'];
  if (failure?.endsWith('.js') || oauthAssets.some(asset => asset === failure))
    delete files[`packages/portal/web/${failure}`];
  if (failure === 'consent-missing-placeholder')
    files['packages/portal/web/figma-auth-consent.html'] =
      '<!doctype html><script nonce="fixed"></script>';
  if (failure === 'consent-duplicate-placeholder')
    files['packages/portal/web/figma-auth-consent.html'] += '<p>__SFP_FIGMA_CONSENT_NONCE__</p>';
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), text);
  }
  await cp(join(serviceRoot, 'scripts'), join(source, 'scripts'), { recursive: true });
  await symlink(
    join(serviceRoot, 'node_modules'),
    join(source, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const run = (script: string) =>
    spawnSync(process.execPath, [join(source, 'scripts', script)], {
      cwd: source,
      env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000', NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
  for (const script of ['package-artifacts.mjs', 'generate-checksums.mjs']) {
    const result = run(script);
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  }
  return { source, run };
};

it('packages and starts portal with extracted CLI/MCP and all public web assets without a build or install', async () => {
  const { source, run } = await fixture();
  const result = run('verify-artifacts.mjs');
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  expect(result.stdout).toContain('Verified 4 archives');
  expect(result.stdout).toContain('Verified portable portal startup and 12 packaged web assets');
  const receipt = JSON.parse(
    await readFile(join(source, 'artifacts/artifact-manifest.v1.json'), 'utf8'),
  ) as { archives: Array<{ name: string; files: Array<{ path: string }> }> };
  const portal = receipt.archives.find(archive => archive.name === 'portal.tgz');
  expect(portal?.files.map(file => file.path)).toEqual(
    expect.arrayContaining([
      'dist/index.mjs',
      'DEBUGGING.md',
      'web/index.html',
      'web/app.js',
      'web/api.js',
      'web/model.js',
      'web/schema-form.js',
      'web/service-functions.js',
      'web/figma-settings.js',
      ...oauthAssets.map(asset => 'web/' + asset),
      'web/styles.css',
    ]),
  );
  expect(portal?.files.some(file => file.path.includes('/tests/'))).toBe(false);
}, 45_000);

it('declares every OAuth consent/public resource in the portal package files authority', async () => {
  const metadata = JSON.parse(
    await readFile(join(serviceRoot, 'packages/portal/package.json'), 'utf8'),
  ) as { files: string[] };
  expect(metadata.files).toEqual(expect.arrayContaining(oauthAssets.map(asset => 'web/' + asset)));
});
it.each(oauthAssets)(
  'rejects missing OAuth archive resource %s despite matching archive receipts',
  async asset => {
    const { run } = await fixture(asset);
    const result = run('verify-artifacts.mjs');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`PORTAL_ARTIFACT_REQUIRED_FILE:web/${asset}`);
  },
  45_000,
);
it.each([
  ['consent-template-exposed', 'PORTAL_ARTIFACT_CONSENT_EXPOSED'],
  ['consent-wrong-nonce', 'PORTAL_ARTIFACT_CONSENT_NONCE_INVALID'],
  ['consent-wrong-csp', 'PORTAL_ARTIFACT_CONSENT_POLICY_INVALID'],
  ['consent-wrong-body', 'PORTAL_ARTIFACT_CONSENT_BODY_MISMATCH'],
  ['consent-wrong-referrer', 'PORTAL_ARTIFACT_CONSENT_POLICY_INVALID'],
  ['consent-wrong-cache', 'PORTAL_ARTIFACT_CONSENT_POLICY_INVALID'],
  ['consent-static-nonce', 'PORTAL_ARTIFACT_CONSENT_NONCE_REUSED'],
  ['consent-query-exposed', 'PORTAL_ARTIFACT_CONSENT_QUERY_EXPOSED'],
  ['consent-missing-placeholder', 'PORTAL_ARTIFACT_CONSENT_TEMPLATE_INVALID'],
  ['consent-duplicate-placeholder', 'PORTAL_ARTIFACT_CONSENT_TEMPLATE_INVALID'],
] as const)(
  'rejects an unsafe dynamic consent artifact: %s',
  async (failure, code) => {
    const { run } = await fixture(failure);
    const result = run('verify-artifacts.mjs');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(code);
  },
  45_000,
);

it('rejects a missing web asset despite matching archive/checksum receipts', async () => {
  const { run } = await fixture('missing-asset');
  const result = run('verify-artifacts.mjs');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('PORTAL_ARTIFACT_REQUIRED_FILE:web/styles.css');
}, 45_000);

it('rejects a CLI archive without the real public ControlClient export', async () => {
  const { run } = await fixture('missing-cli-export');
  const result = run('verify-artifacts.mjs');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('PORTAL_CLI_EXPORT_MISSING');
}, 45_000);

it.each(['schema-form.js', 'service-functions.js', 'figma-settings.js'] as const)(
  'rejects a missing all-function runtime asset: %s',
  async asset => {
    const { run } = await fixture(asset);
    const result = run('verify-artifacts.mjs');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`PORTAL_ARTIFACT_REQUIRED_FILE:web/${asset}`);
  },
  45_000,
);

it('rejects missing public feature dispatch exports even when ControlClient is present', async () => {
  const { run } = await fixture('missing-feature-export');
  const result = run('verify-artifacts.mjs');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('PORTAL_CLI_EXPORT_MISSING:parseServiceFeature');
}, 45_000);

it('rejects an older CLI archive missing the required public ChromeSessionOwner export before portal startup', async () => {
  const { run } = await fixture('missing-chrome-owner-export');
  const result = run('verify-artifacts.mjs');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('PORTAL_CLI_EXPORT_MISSING:ChromeSessionOwner');
}, 45_000);

it('rejects an older CLI archive without the trusted capture proof getter', async () => {
  const { run } = await fixture('missing-capture-proof-export');
  const result = run('verify-artifacts.mjs');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('PORTAL_CLI_EXPORT_MISSING:isLocalCapturePreEffectFailure');
}, 45_000);
