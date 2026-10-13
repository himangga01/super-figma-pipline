/* eslint-disable no-await-in-loop -- each archive is verified independently */
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, mkdir, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveArchiveTar } from './archive-command.mjs';
import { root, artifactRoot, filesUnder, sha256 } from './release-common.mjs';

/** @param {unknown} value */
const validCatalogEntries = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    entry =>
      entry &&
      typeof entry.name === 'string' &&
      /^[a-z][a-z0-9_.-]{0,127}$/u.test(entry.name) &&
      entry.inputSchema &&
      typeof entry.inputSchema === 'object',
  ) &&
  new Set(value.map(entry => entry.name)).size === value.length;

/** Resolve installed third-party dependencies without installing or following workspace sources. */
const dependencyRoot = async (owner, name) => {
  const require = createRequire(join(root, 'packages', owner, 'package.json'));
  let directory;
  try {
    directory = dirname(require.resolve(`${name}/package.json`));
  } catch {
    directory = dirname(require.resolve(name));
  }
  for (let depth = 0; depth < 16; depth++) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (metadata.name === name) return directory;
    } catch {
      /* An entry can be nested below its package manifest. */
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`ARTIFACT_DEPENDENCY_ROOT_MISSING:${name}`);
};

/** Verify archived template bytes before checking its protected dynamic HTTP representation. */
const verifyPortalConsent = async (origin, directory, file) => {
  const raw = await readFile(join(directory, file.path));
  if (sha256(raw) !== file.sha256 || raw.length !== file.bytes)
    throw new Error(`PORTAL_ARTIFACT_WEB_MISMATCH:${file.path}`);
  const marker = '__SFP_FIGMA_CONSENT_NONCE__';
  let template;
  try {
    template = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new Error('PORTAL_ARTIFACT_CONSENT_TEMPLATE_INVALID');
  }
  if (
    raw.length > 32768 ||
    template.split(marker).length !== 2 ||
    !template.includes(`nonce="${marker}"`)
  )
    throw new Error('PORTAL_ARTIFACT_CONSENT_TEMPLATE_INVALID');
  const hidden = await fetch(origin + '/figma-auth-consent.html', {
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  await hidden.arrayBuffer();
  if (hidden.status !== 404) throw new Error('PORTAL_ARTIFACT_CONSENT_EXPOSED');
  const query = await fetch(origin + '/figma-auth-consent?artifact_probe=1', {
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  await query.arrayBuffer();
  if (query.status !== 404) throw new Error('PORTAL_ARTIFACT_CONSENT_QUERY_EXPOSED');
  let previous;
  for (let round = 0; round < 2; round++) {
    const response = await fetch(origin + '/figma-auth-consent', {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let body;
    try {
      body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error('PORTAL_ARTIFACT_CONSENT_BODY_MISMATCH');
    }
    const nonces = [...body.matchAll(/\bnonce="([A-Za-z0-9_-]{32})"/gu)];
    const nonce = nonces[0]?.[1];
    if (nonces.length !== 1 || !nonce) throw new Error('PORTAL_ARTIFACT_CONSENT_NONCE_INVALID');
    if (nonce === previous) throw new Error('PORTAL_ARTIFACT_CONSENT_NONCE_REUSED');
    previous = nonce;
    const expected = Buffer.from(template.replace(marker, nonce));
    if (response.status !== 200 || !bytes.equals(expected))
      throw new Error('PORTAL_ARTIFACT_CONSENT_BODY_MISMATCH');
    const csp = `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; form-action 'self' https://www.figma.com/oauth/mcp; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`;
    if (
      response.headers.get('content-type') !== 'text/html; charset=utf-8' ||
      response.headers.get('content-security-policy') !== csp ||
      response.headers.get('cache-control') !== 'no-store' ||
      response.headers.get('referrer-policy') !== 'same-origin'
    )
      throw new Error('PORTAL_ARTIFACT_CONSENT_POLICY_INVALID');
  }
};

const verifyPortalStartup = async (unpacked, archive, temp) => {
  const isolated = join(temp, 'portable-runtime');
  const packages = new Map();
  for (const kind of ['mcp', 'cli', 'portal']) {
    const destination = join(isolated, 'node_modules/@sfp', kind);
    await mkdir(dirname(destination), { recursive: true });
    await cp(unpacked.get(`${kind}.tgz`), destination, { recursive: true });
    const metadata = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'));
    if (metadata.name !== `@sfp/${kind}` || typeof metadata.version !== 'string')
      throw new Error(`ARTIFACT_PACKAGE_IDENTITY:${kind}`);
    packages.set(kind, { destination, metadata });
  }
  const portal = packages.get('portal'),
    cli = packages.get('cli'),
    mcp = packages.get('mcp');
  if (
    portal.metadata.dependencies?.['@sfp/cli'] !== cli.metadata.version ||
    cli.metadata.dependencies?.['@sfp/mcp'] !== mcp.metadata.version
  )
    throw new Error('PORTAL_ARTIFACT_DEPENDENCY_VERSION');
  if (
    portal.metadata.bin?.['sfp-portal']?.replace(/^\.\//u, '') !== 'dist/index.mjs' ||
    cli.metadata.exports?.['.'] !== './dist/library.mjs'
  )
    throw new Error('PORTAL_ARTIFACT_ENTRY_INVALID');
  for (const [owner, pkg] of packages) {
    for (const [name, selector] of Object.entries(pkg.metadata.dependencies ?? {})) {
      if (typeof selector !== 'string' || selector.startsWith('workspace:'))
        throw new Error(`ARTIFACT_WORKSPACE_DEPENDENCY:${name}`);
      if (name.startsWith('@sfp/')) {
        if (!['@sfp/cli', '@sfp/mcp'].includes(name))
          throw new Error(`ARTIFACT_UNBUNDLED_WORKSPACE:${name}`);
        continue;
      }
      if (!/^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/u.test(name))
        throw new Error('ARTIFACT_DEPENDENCY_NAME_INVALID');
      const target = join(pkg.destination, 'node_modules', name);
      await mkdir(dirname(target), { recursive: true });
      await symlink(
        await dependencyRoot(owner, name),
        target,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
  }
  // The synthetic unavailable control endpoint never reads owner daemon state or credentials.
  const unavailable = createServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  await new Promise(resolveListen =>
    unavailable.listen(0, '127.0.0.1', () => resolveListen(undefined)),
  );
  const control = unavailable.address();
  const reserve = createServer();
  await new Promise(resolveListen =>
    reserve.listen(0, '127.0.0.1', () => resolveListen(undefined)),
  );
  const address = reserve.address();
  if (!control || typeof control === 'string' || !address || typeof address === 'string')
    throw new Error('PORTAL_ARTIFACT_PORT_INVALID');
  const port = address.port;
  await new Promise((resolveClose, reject) =>
    reserve.close(error => (error ? reject(error) : resolveClose(undefined))),
  );
  /** @type {NodeJS.ProcessEnv} */
  const environment = {};
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP'])
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  Object.assign(environment, {
    HOME: isolated,
    USERPROFILE: isolated,
    APPDATA: isolated,
    LOCALAPPDATA: isolated,
    SFP_PORTAL_STATE_ROOT: join(isolated, 'portal-state'),
    SFP_STATE_ROOT: join(isolated, 'service-state'),
    SFP_PORTAL_PORT: String(port),
    SFP_CONTROL_PORT: String(control.port),
  });
  // The portal must import the public CLI library from these extracted deliverables.
  const program = `import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
    const require=createRequire(${JSON.stringify(join(portal.destination, 'package.json'))});
    const library=await import(pathToFileURL(require.resolve('@sfp/cli')).href);
    for(const name of ['ControlClient','ChromeSessionOwner','isLocalCapturePreEffectFailure','serviceTools','parseServiceTool','serviceFeatures','parseServiceFeature','executeServiceFeature'])
      if(typeof library[name]!=='function')throw Error('PORTAL_CLI_EXPORT_MISSING:'+name);
    await import(pathToFileURL(${JSON.stringify(join(portal.destination, 'dist/index.mjs'))}).href);`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: isolated,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let errorOutput = '';
  child.stderr.on('data', chunk => {
    errorOutput = (errorOutput + String(chunk)).slice(-4096);
  });
  // Drain output so a healthy server cannot block on a full pipe.
  child.stdout.on('data', () => {});
  const exited = new Promise(resolveExit => {
    child.once('exit', () => resolveExit(true));
    child.once('error', () => resolveExit(true));
  });
  const origin = `http://127.0.0.1:${port}`;
  let failure;
  let assetCount = 0;
  let stopConfirmed = true;
  try {
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch(origin + '/', {
          redirect: 'error',
          signal: AbortSignal.timeout(500),
        });
        ready = response.ok;
        await response.arrayBuffer();
        if (ready) break;
      } catch {
        /* Cold startup may not have bound its listener yet. */
      }
      await delay(50);
    }
    if (!ready) throw new Error(`PORTAL_ARTIFACT_STARTUP_FAILED:${errorOutput}`);
    const assets = archive.files.filter(file => file.path.startsWith('web/'));
    for (const file of assets) {
      if (file.path === 'web/figma-auth-consent.html') {
        await verifyPortalConsent(origin, portal.destination, file);
        continue;
      }
      const path = file.path === 'web/index.html' ? '/' : '/' + file.path.slice(4);
      const response = await fetch(origin + path, {
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok || sha256(bytes) !== file.sha256 || bytes.length !== file.bytes)
        throw new Error(`PORTAL_ARTIFACT_WEB_MISMATCH:${file.path}`);
    }
    const response = await fetch(origin + '/api/bootstrap', {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    const bootstrap = await response.json();
    if (
      !response.ok ||
      !bootstrap ||
      typeof bootstrap !== 'object' ||
      !('service' in bootstrap) ||
      !bootstrap.service ||
      typeof bootstrap.service !== 'object' ||
      !('available' in bootstrap.service) ||
      bootstrap.service.available !== false
    )
      throw new Error('PORTAL_ARTIFACT_SERVICE_STATE_INVALID');
    const catalogResponse = await fetch(origin + '/api/service/catalog', {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    const catalog = await catalogResponse.json();
    if (
      !catalogResponse.ok ||
      !catalog ||
      typeof catalog !== 'object' ||
      !('tools' in catalog) ||
      !('features' in catalog) ||
      !validCatalogEntries(catalog.tools) ||
      !validCatalogEntries(catalog.features)
    )
      throw new Error('PORTAL_ARTIFACT_CATALOG_INVALID');
    assetCount = assets.length;
  } catch (cause) {
    failure = cause;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (!(await Promise.race([exited, delay(3000).then(() => false)]))) {
      child.kill('SIGKILL');
      stopConfirmed = Boolean(await Promise.race([exited, delay(3000).then(() => false)]));
    }
    unavailable.closeAllConnections();
    await new Promise((resolveClose, reject) =>
      unavailable.close(error => (error ? reject(error) : resolveClose(undefined))),
    );
  }
  if (!stopConfirmed) throw new Error('PORTAL_ARTIFACT_STOP_UNCONFIRMED');
  if (failure) throw failure;
  process.stdout.write(
    `Verified portable portal startup and ${assetCount} packaged web assets using extracted CLI/MCP and installed third-party runtime dependencies\n`,
  );
};
const manifest = JSON.parse(
  await readFile(join(artifactRoot, 'artifact-manifest.v1.json'), 'utf8'),
);
const sums = (await readFile(join(artifactRoot, 'SHA256SUMS'), 'utf8')).trim().split('\n');
const expectedNames = [
  'artifact-manifest.v1.json',
  'cli.tgz',
  'mcp.tgz',
  'plugin.zip',
  'portal.tgz',
];
if (JSON.stringify(sums.map(row => row.slice(66))) !== JSON.stringify(expectedNames))
  throw new Error('CHECKSUM_FILE_SET_INVALID');
for (const row of sums)
  if (sha256(await readFile(join(artifactRoot, row.slice(66)))) !== row.slice(0, 64))
    throw new Error('ARTIFACT_CHECKSUM_MISMATCH');
if (
  JSON.stringify(manifest.archives.map(item => item.name).toSorted()) !==
  JSON.stringify(expectedNames.slice(1))
)
  throw new Error('ARCHIVE_SET_INVALID');
const temp = await mkdtemp(join(tmpdir(), 'sfp-verify-artifacts-'));
const unpackedPackages = new Map();
try {
  for (const archive of manifest.archives) {
    const path = join(artifactRoot, archive.name);
    const data = await readFile(path);
    if (sha256(data) !== archive.sha256 || data.length !== archive.bytes)
      throw new Error('ARCHIVE_MANIFEST_MISMATCH');
    const useUnzip = archive.name.endsWith('.zip') && process.platform !== 'win32';
    const listing = execFileSync(
      useUnzip ? 'unzip' : resolveArchiveTar(),
      useUnzip ? ['-Z1', path] : ['-tf', path],
      { encoding: 'utf8', windowsHide: true },
    )
      .trim()
      .split(/\r?\n/u);
    for (const item of listing)
      if (
        item.startsWith('/') ||
        item.includes('\\') ||
        item.includes(':') ||
        item.split('/').includes('..')
      )
        throw new Error('ARCHIVE_PATH_INVALID');
    const destination = join(temp, archive.name);
    await mkdir(destination);
    execFileSync(
      useUnzip ? 'unzip' : resolveArchiveTar(),
      useUnzip ? ['-q', path, '-d', destination] : ['-xf', path, '-C', destination],
      { windowsHide: true },
    );
    const unpacked = archive.name.endsWith('.tgz') ? join(destination, 'package') : destination;
    unpackedPackages.set(archive.name, unpacked);
    const files = await filesUnder(unpacked);
    if (
      JSON.stringify(files.toSorted()) !==
      JSON.stringify(archive.files.map(item => item.path).toSorted())
    )
      throw new Error('ARCHIVE_CONTENT_SET_MISMATCH');
    for (const item of archive.files) {
      if (/(?:^|\/)(?:src|test|node_modules|code-kb|\.env)(?:\/|$)|\.map$/u.test(item.path))
        throw new Error('ARCHIVE_FORBIDDEN_CONTENT');
      const bytes = await readFile(join(unpacked, item.path));
      if (sha256(bytes) !== item.sha256 || bytes.length !== item.bytes)
        throw new Error('ARCHIVE_FILE_MISMATCH');
    }
    for (const required of [
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'PROVENANCE.md',
      'SBOM.spdx.json',
      'capabilities/union-manifest.json',
      'capabilities/rust-tool-compat.json',
      'capabilities/figmosha-feature-map.json',
    ])
      if (!files.includes(required)) throw new Error(`ARCHIVE_REQUIRED_FILE:${required}`);
    if (archive.name === 'plugin.zip') {
      const plugin = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8'));
      if (!files.includes(plugin.main) || !files.includes(plugin.ui))
        throw new Error('PLUGIN_ENTRY_MISSING');
    }
    if (archive.name === 'portal.tgz')
      for (const required of [
        'package.json',
        'dist/index.mjs',
        'web/index.html',
        'web/app.js',
        'web/api.js',
        'web/model.js',
        'web/schema-form.js',
        'web/service-functions.js',
        'web/figma-settings.js',
        'web/figma-auth-public.js',
        'web/figma-auth-consent.html',
        'web/figma-auth-consent.js',
        'web/figma-auth-consent.css',
        'web/styles.css',
      ])
        if (!files.includes(required)) throw new Error(`PORTAL_ARTIFACT_REQUIRED_FILE:${required}`);
  }
  await verifyPortalStartup(
    unpackedPackages,
    manifest.archives.find(archive => archive.name === 'portal.tgz'),
    temp,
  );
  process.stdout.write(
    `Verified ${manifest.archives.length} archives, all file hashes and checksums\n`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
