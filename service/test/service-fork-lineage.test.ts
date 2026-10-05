import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { hermeticGitEnvironment, spawnHermeticGit } from '../scripts/hermetic-git.mjs';

const sourceScript = resolve(import.meta.dirname, '..', 'scripts', 'update-service-forks.mjs');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const git = (root: string, ...args: string[]) => spawnHermeticGit(root, args);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const writeChangeManifest = async (
  service: string,
  movePairs: readonly { oldPath: string; newPath: string }[] = [],
) => {
  await writeFile(
    join(service, 'capabilities/change-manifests/task-7a.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        slice: '7A',
        authorityPaths: [],
        changes: [],
        ...(movePairs.length > 0 ? { movePairs } : {}),
      },
      null,
      2,
    )}\n`,
  );
};

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-service-fork-'));
  roots.push(root);
  const service = join(root, 'service');
  const path = 'packages/mcp/src/election/election.ts';
  const base = 'export const election = "base";\n';
  await mkdir(join(service, 'packages/mcp/src/election'), { recursive: true });
  await mkdir(join(service, 'capabilities/change-manifests'), { recursive: true });
  await writeFile(join(service, path), base);
  await writeFile(
    join(service, 'vendor-map.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        upstream: 'figwright',
        originCommit: 'a'.repeat(40),
        files: [
          {
            mode: 'copy',
            originCommit: 'a'.repeat(40),
            sourcePath: path,
            destination: path,
            baseSha256: sha256(base),
            currentSha256: sha256(base),
            transformations: [],
            licenseId: 'MIT',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(service, 'vendor-rules.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        upstream: 'figwright',
        commit: 'a'.repeat(40),
        copy: ['packages/mcp/src/**'],
        mergeDependencyManifests: [],
        referenceOnly: [],
        exclude: [],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(service, 'upstream-lock.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        vendorMap: {
          path: 'vendor-map.json',
          sha256: sha256('placeholder'),
          counts: { copy: 1, mergeDependencyManifest: 0, referenceOnly: 0, total: 1 },
        },
        destinationClosure: { managedRoots: ['packages/mcp/src'], serviceOwnedFiles: [] },
        serviceFiles: [],
        packageAuthorities: [],
        upstreams: [{ id: 'figwright', commit: 'a'.repeat(40) }],
      },
      null,
      2,
    )}\n`,
  );
  await writeChangeManifest(service);
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  const changed = 'export const election = "service-fork";\n';
  await writeFile(join(service, path), changed);
  git(root, 'add', `service/${path}`);
  return { root, service, path, base, changed };
};

describe('service-fork lineage updater', () => {
  it('reconciles reviewed package projections and root scripts without dropping lifecycle authority', async () => {
    const setup = await fixture();
    git(setup.root, 'commit', '-m', 'source');
    const lockPath = join(setup.service, 'upstream-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    const projection = {
      name: 'fixture',
      serviceScripts: { typecheck: 'old' },
      excludedScriptAuthority: { postinstall: null },
    };
    const rootAuthority = {
      packageManager: 'pnpm@11.24.0',
      nodeEngine: '>=24 <25',
      scripts: { typecheck: 'old' },
      workspacePackageNames: [],
      knipWorkspaces: [],
    };
    lock.packageAuthorities = [{ path: 'package.json', projection }];
    lock.rootAuthority = rootAuthority;
    lock.excludedUpstreamScriptInputs = ['postinstall'];
    await writeFile(lockPath, JSON.stringify(lock));
    const manifest = {
      name: 'fixture',
      packageManager: 'pnpm@11.24.0',
      engines: { node: '>=24 <25' },
      scripts: { typecheck: 'checked tools', 'typecheck:tools': 'tsc -p tsconfig.tools.json' },
    };
    await writeFile(join(setup.service, 'package.json'), JSON.stringify(manifest));
    git(setup.root, 'add', '.');
    git(setup.root, 'commit', '-m', 'committed manifest with stale projections');
    const record = 'capabilities/reconciliations/task-7a.json';
    await mkdir(join(setup.service, 'capabilities/reconciliations'), { recursive: true });
    await writeFile(
      join(setup.service, record),
      JSON.stringify({
        schemaVersion: 1,
        slice: '7A',
        baseline: {
          headCommit: git(setup.root, 'rev-parse', 'HEAD').stdout.trim(),
          authoritySha256: Object.fromEntries(
            await Promise.all(
              ['upstream-lock.json', 'vendor-map.json', 'vendor-rules.json'].map(async path => [
                path,
                sha256(await readFile(join(setup.service, path), 'utf8')),
              ]),
            ),
          ),
        },
        entries: [
          {
            path: 'package.json',
            sha256: sha256(JSON.stringify(manifest)),
            reason: 'Reviewed tool checks',
            priorClaims: [
              { class: 'package', sha256: sha256(JSON.stringify(projection)) },
              { class: 'root', sha256: sha256(JSON.stringify(rootAuthority)) },
            ],
          },
        ],
      }),
    );
    await writeFile(
      join(setup.service, 'capabilities/task-7a-authority-classes.json'),
      JSON.stringify({
        schemaVersion: 1,
        slice: '7A',
        allowedPaths: [
          `service/${record}`,
          'service/capabilities/task-7a-authority-classes.json',
          'service/package.json',
        ],
      }),
    );
    git(setup.root, 'add', 'service/capabilities');
    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
        '--reconcile',
        `service/${record}`,
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        windowsHide: true,
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
      },
    );
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const refreshed = JSON.parse(await readFile(lockPath, 'utf8'));
    expect(refreshed.rootAuthority.scripts).toEqual(manifest.scripts);
    expect(refreshed.packageAuthorities[0].projection.serviceScripts).toEqual(manifest.scripts);
    expect(refreshed.packageAuthorities[0].projection.excludedScriptAuthority).toEqual({
      postinstall: null,
    });
    expect(refreshed.serviceForks).toEqual([]);
  });
  it.each([
    'accepted',
    'prior-claim',
    'baseline',
    'accepted-hash',
    'out-of-scope',
    'record-edit',
    'extra-field',
    'source-edit',
  ])('reconciles committed drift only under the exact reviewed authority: %s', async mutation => {
    const setup = await fixture();
    git(setup.root, 'commit', '-m', 'reviewed service change with stale authority');
    const reconciliationPath = 'capabilities/reconciliations/task-7a.json';
    await mkdir(join(setup.service, 'capabilities/reconciliations'), { recursive: true });
    const authoritySha256 = Object.fromEntries(
      await Promise.all(
        ['upstream-lock.json', 'vendor-map.json', 'vendor-rules.json'].map(async path => [
          path,
          createHash('sha256')
            .update(await readFile(join(setup.service, path)))
            .digest('hex'),
        ]),
      ),
    );
    await writeFile(
      join(setup.service, reconciliationPath),
      JSON.stringify({
        schemaVersion: 1,
        slice: '7A',
        baseline: {
          headCommit: git(setup.root, 'rev-parse', 'HEAD').stdout.trim(),
          authoritySha256,
        },
        entries: [
          {
            path: setup.path,
            sha256: sha256(setup.changed),
            priorClaims: [{ class: 'vendor', sha256: sha256(setup.base) }],
            reason: 'Previously reviewed and committed service correction',
          },
        ],
      }),
    );
    await writeFile(
      join(setup.service, 'capabilities/task-7a-authority-classes.json'),
      JSON.stringify({
        schemaVersion: 1,
        slice: '7A',
        allowedPaths: [
          `service/${reconciliationPath}`,
          `service/${setup.path}`,
          'service/capabilities/task-7a-authority-classes.json',
        ],
      }),
    );
    git(setup.root, 'add', 'service/capabilities');
    if (mutation !== 'accepted') {
      const path = join(setup.service, reconciliationPath);
      const review = JSON.parse(await readFile(path, 'utf8'));
      if (mutation === 'prior-claim') review.entries[0].priorClaims = [];
      if (mutation === 'baseline')
        review.baseline.authoritySha256['upstream-lock.json'] = 'f'.repeat(64);
      if (mutation === 'accepted-hash') review.entries[0].sha256 = 'f'.repeat(64);
      if (mutation === 'out-of-scope') review.entries[0].path = 'packages/mcp/src/unreviewed.ts';
      if (mutation === 'extra-field') review.extra = true;
      if (mutation === 'source-edit')
        await writeFile(join(setup.service, setup.path), 'independent newer source\n');
      if (mutation === 'record-edit') await writeFile(path, `${JSON.stringify(review)}\n`);
      else {
        await writeFile(path, JSON.stringify(review));
        git(setup.root, 'add', `service/${reconciliationPath}`);
      }
    }
    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
        '--reconcile',
        `service/${reconciliationPath}`,
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        windowsHide: true,
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
      },
    );
    const accepted = mutation === 'accepted';
    expect(result.status).toBe(accepted ? 0 : 1);
    expect(result.stderr === '').toBe(accepted);
    expect(result.stderr.includes('SERVICE_FORK_RECONCILIATION')).toBe(!accepted);
    for (const [path, digest] of Object.entries(authoritySha256)) {
      const observed = createHash('sha256')
        .update(await readFile(join(setup.service, path)))
        .digest('hex');
      expect(observed === digest).toBe(!accepted);
    }
    const lock = JSON.parse(await readFile(join(setup.service, 'upstream-lock.json'), 'utf8'));
    const expectedFork = expect.objectContaining({
      originRepo: 'figwright',
      originCommit: 'a'.repeat(40),
      baseSha256: sha256(setup.base),
      destination: setup.path,
      transition: 'edit',
      stagedSha256: sha256(setup.changed),
    });
    expect(lock.serviceForks ?? []).toEqual(accepted ? [expectedFork] : []);
    expect(await readFile(join(setup.service, setup.path), 'utf8')).toBe(
      mutation === 'source-edit' ? 'independent newer source\n' : setup.changed,
    );
  });
  it.each(['upstream-lock.json', 'vendor-map.json', 'vendor-rules.json'])(
    'preserves an independent %s edit after derivation before staging',
    async authority => {
      const setup = await fixture();
      const target = join(setup.service, authority);
      const original = await readFile(target, 'utf8');
      const edited = `${original}\n`;
      const preload = join(setup.root, 'edit-after-read.mjs');
      await writeFile(
        preload,
        `
        import fs from 'node:fs/promises';
        import { syncBuiltinESMExports } from 'node:module';
        const originalRead = fs.readFile;
        let reads = 0;
        fs.readFile = async (path, ...args) => {
          if (String(path) === ${JSON.stringify(target)} && ++reads === 2) {
            await fs.writeFile(path, ${JSON.stringify(edited)});
          }
          return originalRead(path, ...args);
        };
        syncBuiltinESMExports();
      `,
      );
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(preload).href,
          sourceScript,
          '--slice',
          '7A',
          '--index',
          'service/capabilities/change-manifests/task-7a.json',
        ],
        {
          cwd: setup.root,
          encoding: 'utf8',
          windowsHide: true,
          env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('SERVICE_FORK_TRANSACTION_CONFLICT');
      expect(await readFile(target, 'utf8')).toBe(edited);
    },
  );
  it('moves one edited copy row to protected service-fork lineage without overwriting it', async () => {
    const setup = await fixture();
    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );

    expect(result.status).toBe(0);
    const map = JSON.parse(await readFile(join(setup.service, 'vendor-map.json'), 'utf8'));
    const rules = JSON.parse(await readFile(join(setup.service, 'vendor-rules.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(setup.service, 'upstream-lock.json'), 'utf8'));
    expect(map.files).toEqual([]);
    expect(rules.exclude).toContain(setup.path);
    expect(rules.serviceOwned).toContain(setup.path);
    expect(lock.schemaVersion).toBe(2);
    expect(lock.serviceForks).toEqual([
      expect.objectContaining({
        originRepo: 'figwright',
        originPath: setup.path,
        previousMode: 'copy',
        originCommit: 'a'.repeat(40),
        baseSha256: sha256(setup.base),
        transitionTask: '7A',
        transition: 'edit',
        destination: setup.path,
        stagedSha256: sha256(setup.changed),
      }),
    ]);
    expect(await readFile(join(setup.service, setup.path), 'utf8')).toBe(setup.changed);
  });

  it('records a staged rename as one move lineage and transfers every authority class', async () => {
    const setup = await fixture();
    const movedPath = 'packages/mcp/src/election/election-renamed.ts';
    git(setup.root, 'mv', `service/${setup.path}`, `service/${movedPath}`);
    await writeFile(join(setup.service, movedPath), setup.changed);
    git(setup.root, 'add', `service/${movedPath}`);
    await writeChangeManifest(setup.service, [
      { oldPath: `service/${setup.path}`, newPath: `service/${movedPath}` },
    ]);

    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });

    const rerun = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );
    expect({ status: rerun.status, stderr: rerun.stderr }).toEqual({ status: 0, stderr: '' });

    const map = JSON.parse(await readFile(join(setup.service, 'vendor-map.json'), 'utf8'));
    const rules = JSON.parse(await readFile(join(setup.service, 'vendor-rules.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(setup.service, 'upstream-lock.json'), 'utf8'));
    expect(map.files).toEqual([]);
    expect(rules.exclude).toEqual(expect.arrayContaining([setup.path, movedPath]));
    expect(rules.serviceOwned).toContain(movedPath);
    expect(rules.serviceOwned).not.toContain(setup.path);
    expect(lock.serviceForks).toEqual([
      expect.objectContaining({
        transition: 'move',
        originPath: setup.path,
        oldDestination: setup.path,
        newDestination: movedPath,
        newSha256: sha256(setup.changed),
      }),
    ]);
    expect(lock.serviceFiles).toContainEqual({ path: movedPath, sha256: sha256(setup.changed) });
    expect(lock.serviceFiles).not.toContainEqual(expect.objectContaining({ path: setup.path }));
  });

  it('keeps a deleted upstream-copy destination excluded with an exact delete tombstone', async () => {
    const setup = await fixture();
    expect(git(setup.root, 'rm', '-f', `service/${setup.path}`).status).toBe(0);
    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const rules = JSON.parse(await readFile(join(setup.service, 'vendor-rules.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(setup.service, 'upstream-lock.json'), 'utf8'));
    expect(rules.exclude).toContain(setup.path);
    expect(rules.serviceOwned ?? []).not.toContain(setup.path);
    expect(lock.serviceForks).toEqual([
      expect.objectContaining({
        transition: 'delete',
        originPath: setup.path,
        destination: setup.path,
        stagedSha256: null,
      }),
    ]);
  });

  it('rejects a declared move unless the cache contains its exact D old plus A new pair', async () => {
    const setup = await fixture();
    const missingPath = 'packages/mcp/src/election/missing.ts';
    expect(git(setup.root, 'rm', '-f', `service/${setup.path}`).status).toBe(0);
    await writeChangeManifest(setup.service, [
      { oldPath: `service/${setup.path}`, newPath: `service/${missingPath}` },
    ]);

    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SERVICE_FORK_MOVE_INCOMPLETE');
  });

  it('rejects a move pair with a duplicated service prefix before lineage lookup', async () => {
    const setup = await fixture();
    const movedPath = 'packages/mcp/src/election/election-renamed.ts';
    expect(git(setup.root, 'mv', `service/${setup.path}`, `service/${movedPath}`).status).toBe(0);
    await writeFile(join(setup.service, movedPath), setup.changed);
    git(setup.root, 'add', `service/${movedPath}`);
    await writeChangeManifest(setup.service, [
      {
        oldPath: `service/service/${setup.path}`,
        newPath: `service/${movedPath}`,
      },
    ]);

    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SERVICE_FORK_MOVE_PATH_INVALID');
  });

  it('rejects a declared move destination already claimed by a service hash authority', async () => {
    const setup = await fixture();
    const movedPath = 'packages/mcp/src/election/election-renamed.ts';
    expect(git(setup.root, 'mv', `service/${setup.path}`, `service/${movedPath}`).status).toBe(0);
    await writeFile(join(setup.service, movedPath), setup.changed);
    git(setup.root, 'add', `service/${movedPath}`);
    await writeChangeManifest(setup.service, [
      { oldPath: `service/${setup.path}`, newPath: `service/${movedPath}` },
    ]);
    const lockPath = join(setup.service, 'upstream-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    const movedHash = sha256(setup.changed);
    lock.serviceFiles.push({ path: movedPath, sha256: movedHash });
    lock.destinationClosure.serviceOwnedFiles.push({ path: movedPath, sha256: movedHash });
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SERVICE_FORK_MOVE_DESTINATION_CLAIMED');
  });

  it('rejects an unpaired added blob already claimed by upstream authority', async () => {
    const setup = await fixture();
    const claimedPath = 'packages/mcp/src/election/claimed.ts';
    const mapPath = join(setup.service, 'vendor-map.json');
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    map.files.push({
      ...map.files[0],
      sourcePath: claimedPath,
      destination: claimedPath,
      baseSha256: sha256('claimed base\n'),
      currentSha256: sha256('claimed base\n'),
    });
    await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    await writeFile(join(setup.service, claimedPath), 'new claimed bytes\n');
    git(setup.root, 'add', `service/${claimedPath}`);

    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SERVICE_FORK_UNPAIRED_CLAIMED_ADD');
  });

  it('refreshes a reviewed ordinary A after a prior partial updater recorded older bytes', async () => {
    const setup = await fixture();
    const recoveredPath = 'packages/mcp/src/election/partial-run.ts';
    const priorBytes = 'export const recovered = false;\n';
    const priorHash = sha256(priorBytes);
    const recoveredBytes = 'export const recovered = true;\n';
    const recoveredHash = sha256(recoveredBytes);
    await writeFile(join(setup.service, recoveredPath), recoveredBytes);
    git(setup.root, 'add', `service/${recoveredPath}`);

    const rulesPath = join(setup.service, 'vendor-rules.json');
    const rules = JSON.parse(await readFile(rulesPath, 'utf8'));
    rules.exclude = [...(rules.exclude ?? []), recoveredPath].toSorted();
    rules.serviceOwned = [...(rules.serviceOwned ?? []), recoveredPath].toSorted();
    await writeFile(rulesPath, `${JSON.stringify(rules, null, 2)}\n`);

    const lockPath = join(setup.service, 'upstream-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.serviceFiles.push({ path: recoveredPath, sha256: priorHash });
    lock.destinationClosure.serviceOwnedFiles.push({
      path: recoveredPath,
      sha256: priorHash,
    });
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const repositoryPath = `service/${recoveredPath}`;
    await writeFile(
      join(setup.service, 'capabilities/task-7a-authority-classes.json'),
      `${JSON.stringify(
        { schemaVersion: 1, slice: '7A', allowedPaths: [repositoryPath] },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(setup.service, 'capabilities/change-manifests/task-7a.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slice: '7A',
          authorityPaths: [],
          changes: [{ status: 'A', path: repositoryPath, sha256: recoveredHash }],
        },
        null,
        2,
      )}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const updatedLock = JSON.parse(await readFile(lockPath, 'utf8'));
    expect(updatedLock.serviceFiles).toContainEqual({
      path: recoveredPath,
      sha256: recoveredHash,
    });
    expect(updatedLock.destinationClosure.serviceOwnedFiles).toContainEqual({
      path: recoveredPath,
      sha256: recoveredHash,
    });
  });

  it('refreshes a reviewed non-managed serviceFiles-only A after a partial updater run', async () => {
    const setup = await fixture();
    const recoveredPath = 'schemas/partial-run.schema.json';
    const priorHash = sha256('{"version":1}\n');
    const recoveredBytes = '{"version":2}\n';
    const recoveredHash = sha256(recoveredBytes);
    await mkdir(join(setup.service, 'schemas'), { recursive: true });
    await writeFile(join(setup.service, recoveredPath), recoveredBytes);
    git(setup.root, 'add', `service/${recoveredPath}`);
    const lockPath = join(setup.service, 'upstream-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.serviceFiles.push({ path: recoveredPath, sha256: priorHash });
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const repositoryPath = `service/${recoveredPath}`;
    await writeFile(
      join(setup.service, 'capabilities/task-7a-authority-classes.json'),
      `${JSON.stringify(
        { schemaVersion: 1, slice: '7A', allowedPaths: [repositoryPath] },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(setup.service, 'capabilities/change-manifests/task-7a.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slice: '7A',
          authorityPaths: [],
          changes: [{ status: 'A', path: repositoryPath, sha256: recoveredHash }],
        },
        null,
        2,
      )}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [
        sourceScript,
        '--slice',
        '7A',
        '--index',
        'service/capabilities/change-manifests/task-7a.json',
      ],
      {
        cwd: setup.root,
        encoding: 'utf8',
        env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
        windowsHide: true,
      },
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const updatedLock = JSON.parse(await readFile(lockPath, 'utf8'));
    expect(updatedLock.serviceFiles).toContainEqual({
      path: recoveredPath,
      sha256: recoveredHash,
    });
    expect(updatedLock.destinationClosure.serviceOwnedFiles).not.toContainEqual(
      expect.objectContaining({ path: recoveredPath }),
    );
  });

  it.each(['rules-service-owned', 'service-owned-file'] as const)(
    'rejects a non-managed partial-run A with inconsistent extra %s claim',
    async extraClaim => {
      const setup = await fixture();
      const recoveredPath = 'schemas/inconsistent.schema.json';
      const priorHash = sha256('{"version":1}\n');
      const recoveredBytes = '{"version":2}\n';
      const recoveredHash = sha256(recoveredBytes);
      await mkdir(join(setup.service, 'schemas'), { recursive: true });
      await writeFile(join(setup.service, recoveredPath), recoveredBytes);
      git(setup.root, 'add', `service/${recoveredPath}`);
      const lockPath = join(setup.service, 'upstream-lock.json');
      const lock = JSON.parse(await readFile(lockPath, 'utf8'));
      lock.serviceFiles.push({ path: recoveredPath, sha256: priorHash });
      if (extraClaim === 'service-owned-file') {
        lock.destinationClosure.serviceOwnedFiles.push({
          path: recoveredPath,
          sha256: priorHash,
        });
      }
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
      if (extraClaim === 'rules-service-owned') {
        const rulesPath = join(setup.service, 'vendor-rules.json');
        const rules = JSON.parse(await readFile(rulesPath, 'utf8'));
        rules.exclude = [...(rules.exclude ?? []), recoveredPath].toSorted();
        rules.serviceOwned = [...(rules.serviceOwned ?? []), recoveredPath].toSorted();
        await writeFile(rulesPath, `${JSON.stringify(rules, null, 2)}\n`);
      }
      const repositoryPath = `service/${recoveredPath}`;
      await writeFile(
        join(setup.service, 'capabilities/task-7a-authority-classes.json'),
        `${JSON.stringify(
          { schemaVersion: 1, slice: '7A', allowedPaths: [repositoryPath] },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(setup.service, 'capabilities/change-manifests/task-7a.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            slice: '7A',
            authorityPaths: [],
            changes: [{ status: 'A', path: repositoryPath, sha256: recoveredHash }],
          },
          null,
          2,
        )}\n`,
      );

      const result = spawnSync(
        process.execPath,
        [
          sourceScript,
          '--slice',
          '7A',
          '--index',
          'service/capabilities/change-manifests/task-7a.json',
        ],
        {
          cwd: setup.root,
          encoding: 'utf8',
          env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
          windowsHide: true,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('SERVICE_FORK_UNPAIRED_CLAIMED_ADD');
    },
  );

  it('recovers a crash between authority renames and converges to one coherent transaction', async () => {
    const setup = await fixture();
    const scriptArguments = [
      sourceScript,
      '--slice',
      '7A',
      '--index',
      'service/capabilities/change-manifests/task-7a.json',
    ];
    const crashed = spawnSync(process.execPath, scriptArguments, {
      cwd: setup.root,
      encoding: 'utf8',
      env: hermeticGitEnvironment({
        ...process.env,
        SFP_REPOSITORY_ROOT: setup.root,
        SFP_SERVICE_FORK_TEST_CRASH_AFTER_RENAMES: '1',
      }),
      windowsHide: true,
    });
    expect(crashed.status).not.toBe(0);
    await expect(
      readFile(join(setup.service, '.service-fork-update.v1.json'), 'utf8'),
    ).resolves.toContain('targets');

    const recovered = spawnSync(process.execPath, scriptArguments, {
      cwd: setup.root,
      encoding: 'utf8',
      env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
      windowsHide: true,
    });
    expect({ status: recovered.status, stderr: recovered.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    await expect(
      readFile(join(setup.service, '.service-fork-update.v1.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const mapBytes = await readFile(join(setup.service, 'vendor-map.json'));
    const rules = JSON.parse(await readFile(join(setup.service, 'vendor-rules.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(setup.service, 'upstream-lock.json'), 'utf8'));
    expect(lock.vendorMap.sha256).toBe(createHash('sha256').update(mapBytes).digest('hex'));
    expect(rules.exclude).toContain(setup.path);
    expect(lock.serviceForks).toHaveLength(1);
  });

  it('reuses a fully fsynced transaction pointer temporary after a pre-publication crash', async () => {
    const setup = await fixture();
    const scriptArguments = [
      sourceScript,
      '--slice',
      '7A',
      '--index',
      'service/capabilities/change-manifests/task-7a.json',
    ];
    const crashed = spawnSync(process.execPath, scriptArguments, {
      cwd: setup.root,
      encoding: 'utf8',
      env: hermeticGitEnvironment({
        ...process.env,
        SFP_REPOSITORY_ROOT: setup.root,
        SFP_SERVICE_FORK_TEST_CRASH_BEFORE_POINTER_RENAME: '1',
      }),
      windowsHide: true,
    });
    expect(crashed.status).toBe(1);
    expect(crashed.stderr).toContain('SERVICE_FORK_TEST_CRASH');
    await expect(
      readFile(join(setup.service, '.service-fork-update.v1.json.tmp'), 'utf8'),
    ).resolves.toContain('targets');

    const recovered = spawnSync(process.execPath, scriptArguments, {
      cwd: setup.root,
      encoding: 'utf8',
      env: hermeticGitEnvironment({ ...process.env, SFP_REPOSITORY_ROOT: setup.root }),
      windowsHide: true,
    });
    expect({ status: recovered.status, stderr: recovered.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    await expect(
      readFile(join(setup.service, '.service-fork-update.v1.json.tmp'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const lock = JSON.parse(await readFile(join(setup.service, 'upstream-lock.json'), 'utf8'));
    expect(lock.serviceForks).toHaveLength(1);
  });
});
