import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const sourceScript = resolve(import.meta.dirname, '..', 'scripts', 'update-service-forks.mjs');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const git = (root: string, ...args: string[]) =>
  spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
        env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
          env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
      env: {
        ...process.env,
        SFP_REPOSITORY_ROOT: setup.root,
        SFP_SERVICE_FORK_TEST_CRASH_AFTER_RENAMES: '1',
      },
    });
    expect(crashed.status).not.toBe(0);
    await expect(
      readFile(join(setup.service, '.service-fork-update.v1.json'), 'utf8'),
    ).resolves.toContain('targets');

    const recovered = spawnSync(process.execPath, scriptArguments, {
      cwd: setup.root,
      encoding: 'utf8',
      env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
      env: {
        ...process.env,
        SFP_REPOSITORY_ROOT: setup.root,
        SFP_SERVICE_FORK_TEST_CRASH_BEFORE_POINTER_RENAME: '1',
      },
    });
    expect(crashed.status).toBe(1);
    expect(crashed.stderr).toContain('SERVICE_FORK_TEST_CRASH');
    await expect(
      readFile(join(setup.service, '.service-fork-update.v1.json.tmp'), 'utf8'),
    ).resolves.toContain('targets');

    const recovered = spawnSync(process.execPath, scriptArguments, {
      cwd: setup.root,
      encoding: 'utf8',
      env: { ...process.env, SFP_REPOSITORY_ROOT: setup.root },
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
