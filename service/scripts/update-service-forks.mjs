import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format as formatWithOxfmt } from 'oxfmt';

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repositoryRoot = resolve(process.env.SFP_REPOSITORY_ROOT ?? defaultRepositoryRoot);
const serviceRoot = join(repositoryRoot, 'service');
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const sha256 = contents => createHash('sha256').update(contents).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const servicePath = path => join(serviceRoot, ...path.split('/'));

const formattedJsonBytes = async (path, value) => {
  const formatted = await formatWithOxfmt(path, `${JSON.stringify(value, null, 2)}\n`, {
    endOfLine: 'lf',
    insertFinalNewline: true,
    tabWidth: 2,
    useTabs: false,
  });
  if (formatted.errors.length > 0) fail('SERVICE_FORK_FORMAT_FAILED', path);
  return Buffer.from(formatted.code);
};

const fail = (code, message) => {
  throw new Error(`[${code}] ${message}`);
};

const safePath = path => {
  if (
    typeof path !== 'string' ||
    path === '' ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes(':') ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    fail('SERVICE_FORK_PATH_INVALID', String(path));
  }
  return path;
};

const stagedChanges = () => {
  const output = execFileSync(
    'git',
    [
      '-C',
      repositoryRoot,
      'diff',
      '--cached',
      '--name-status',
      '--no-renames',
      '-z',
      '--',
      'service',
    ],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const rows = [];
  for (let index = 0; index < output.length; index += 2) {
    const statusToken = output[index];
    const repositoryPath = output[index + 1];
    if (!/^[AMD]$/.test(statusToken ?? '') || repositoryPath === undefined) {
      fail('SERVICE_FORK_INDEX_INVALID', 'cached name-status is malformed');
    }
    if (!repositoryPath.startsWith('service/')) continue;
    rows.push({
      status: statusToken,
      path: safePath(repositoryPath.slice('service/'.length)),
    });
  }
  return rows.toSorted(
    (left, right) =>
      compareUtf8(left.path, right.path) || compareUtf8(left.oldPath ?? '', right.oldPath ?? ''),
  );
};

const manifestServicePath = path => {
  if (
    typeof path !== 'string' ||
    !path.startsWith('service/') ||
    path.startsWith('service/service/')
  ) {
    fail('SERVICE_FORK_MOVE_PATH_INVALID', String(path));
  }
  return safePath(path.slice('service/'.length));
};

const readDeclaredMovePairs = async (indexPath, slice) => {
  const manifest = await readJson(resolve(repositoryRoot, ...indexPath.split('/')));
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('SERVICE_FORK_INDEX_INVALID', 'change manifest v1 is invalid');
  }
  const keys = Object.keys(manifest).toSorted(compareUtf8);
  // Pre-movePairs fixtures and first-run slice manifests used an empty object. The staged
  // manifest verifier owns the full v1 shape; the updater treats only this exact legacy form
  // as the optional movePairs default.
  if (keys.length === 0) return [];
  const expectedWithoutMoves = ['authorityPaths', 'changes', 'schemaVersion', 'slice'];
  const expectedWithMoves = [...expectedWithoutMoves, 'movePairs'].toSorted(compareUtf8);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.slice !== slice ||
    !Array.isArray(manifest.authorityPaths) ||
    !Array.isArray(manifest.changes) ||
    (JSON.stringify(keys) !== JSON.stringify(expectedWithoutMoves.toSorted(compareUtf8)) &&
      JSON.stringify(keys) !== JSON.stringify(expectedWithMoves))
  ) {
    fail('SERVICE_FORK_INDEX_INVALID', 'change manifest v1 is invalid');
  }
  if (manifest.movePairs === undefined) return [];
  if (!Array.isArray(manifest.movePairs)) {
    fail('SERVICE_FORK_MOVE_PAIRS_INVALID', 'movePairs must be an array');
  }
  const seenOld = new Set();
  const seenNew = new Set();
  const pairs = manifest.movePairs.map((pair, index) => {
    if (
      pair === null ||
      typeof pair !== 'object' ||
      Array.isArray(pair) ||
      JSON.stringify(Object.keys(pair).toSorted(compareUtf8)) !==
        JSON.stringify(['newPath', 'oldPath'])
    ) {
      fail('SERVICE_FORK_MOVE_PAIRS_INVALID', `movePairs[${index}] is invalid`);
    }
    const oldPath = manifestServicePath(pair.oldPath);
    const newPath = manifestServicePath(pair.newPath);
    if (oldPath === newPath || seenOld.has(oldPath) || seenNew.has(newPath)) {
      fail('SERVICE_FORK_MOVE_PAIRS_INVALID', `movePairs[${index}] is duplicate or a no-op`);
    }
    seenOld.add(oldPath);
    seenNew.add(newPath);
    return { oldPath, path: newPath };
  });
  const sorted = pairs.toSorted(
    (left, right) => compareUtf8(left.oldPath, right.oldPath) || compareUtf8(left.path, right.path),
  );
  if (JSON.stringify(pairs) !== JSON.stringify(sorted)) {
    fail('SERVICE_FORK_MOVE_PAIRS_INVALID', 'movePairs must be UTF-8 sorted');
  }
  return pairs;
};

const readDeclaredOrdinaryAdds = async (indexPath, slice) => {
  const manifest = await readJson(resolve(repositoryRoot, ...indexPath.split('/')));
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    !Array.isArray(manifest.changes)
  ) {
    return new Map();
  }
  const additions = manifest.changes.filter(row => row?.status === 'A');
  if (additions.length === 0) return new Map();
  const authority = await readJson(
    servicePath(`capabilities/task-${slice.toLowerCase()}-authority-classes.json`),
  );
  if (
    authority === null ||
    typeof authority !== 'object' ||
    Array.isArray(authority) ||
    authority.schemaVersion !== 1 ||
    authority.slice !== slice ||
    !Array.isArray(authority.allowedPaths)
  ) {
    fail('SERVICE_FORK_SLICE_AUTHORITY_INVALID', slice);
  }
  const allowed = new Set(authority.allowedPaths);
  const declared = new Map();
  for (const [index, row] of additions.entries()) {
    if (
      row === null ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      JSON.stringify(Object.keys(row).toSorted(compareUtf8)) !==
        JSON.stringify(['path', 'sha256', 'status']) ||
      !/^[0-9a-f]{64}$/.test(row.sha256 ?? '') ||
      !allowed.has(row.path)
    ) {
      continue;
    }
    const path = manifestServicePath(row.path);
    if (declared.has(path)) {
      fail('SERVICE_FORK_INDEX_INVALID', `duplicate manifest A row at ${index}: ${row.path}`);
    }
    declared.set(path, row.sha256);
  }
  return declared;
};

const applyDeclaredMovePairs = (
  changes,
  movePairs,
  files,
  serviceForks,
  serviceOwned,
  serviceFiles,
  serviceOwnedFiles,
  exclude,
  managedRoots,
) => {
  const byPath = new Map(changes.map(change => [change.path, change]));
  const consumed = new Set();
  const moves = [];
  for (const pair of movePairs) {
    const oldChange = byPath.get(pair.oldPath);
    const newChange = byPath.get(pair.path);
    if (oldChange?.status !== 'D' || newChange?.status !== 'A') {
      fail(
        'SERVICE_FORK_MOVE_INCOMPLETE',
        `${pair.oldPath} -> ${pair.path} requires cached D plus A`,
      );
    }
    const priorVendor = files.find(row => row.destination === pair.oldPath);
    const existingMoves = serviceForks.filter(
      row =>
        row.transition === 'move' &&
        row.oldDestination === pair.oldPath &&
        row.newDestination === pair.path,
    );
    if (priorVendor === undefined && existingMoves.length !== 1) {
      fail('SERVICE_FORK_MOVE_ORIGIN_UNCLAIMED', pair.oldPath);
    }
    if (priorVendor !== undefined) {
      if (
        files.some(row => row.destination === pair.path) ||
        serviceForks.some(
          row =>
            row.destination === pair.path ||
            row.oldDestination === pair.path ||
            row.newDestination === pair.path,
        ) ||
        serviceOwned.has(pair.path) ||
        serviceFiles.some(row => row.path === pair.path) ||
        serviceOwnedFiles.some(row => row.path === pair.path)
      ) {
        fail('SERVICE_FORK_MOVE_DESTINATION_CLAIMED', pair.path);
      }
    } else {
      const existing = existingMoves[0];
      const conflictingFork = serviceForks.some(
        row =>
          row !== existing &&
          (row.destination === pair.oldPath ||
            row.destination === pair.path ||
            row.oldDestination === pair.oldPath ||
            row.oldDestination === pair.path ||
            row.newDestination === pair.oldPath ||
            row.newDestination === pair.path),
      );
      const movedServiceRows = serviceFiles.filter(row => row.path === pair.path);
      const movedOwnedRows = serviceOwnedFiles.filter(row => row.path === pair.path);
      const managed = managedRoots.some(
        root => pair.path === root || pair.path.startsWith(`${root}/`),
      );
      if (
        conflictingFork ||
        files.some(row => row.destination === pair.path) ||
        !exclude.has(pair.oldPath) ||
        !exclude.has(pair.path) ||
        serviceOwned.has(pair.oldPath) ||
        !serviceOwned.has(pair.path) ||
        movedServiceRows.length !== 1 ||
        (managed ? movedOwnedRows.length !== 1 : movedOwnedRows.length !== 0)
      ) {
        fail('SERVICE_FORK_MOVE_DESTINATION_CLAIMED', pair.path);
      }
    }
    consumed.add(pair.oldPath);
    consumed.add(pair.path);
    moves.push({ status: 'R', oldPath: pair.oldPath, path: pair.path });
  }
  return [...changes.filter(change => !consumed.has(change.path)), ...moves].toSorted(
    (left, right) =>
      compareUtf8(left.path, right.path) || compareUtf8(left.oldPath ?? '', right.oldPath ?? ''),
  );
};

const stagedBytes = path =>
  execFileSync('git', ['-C', repositoryRoot, 'show', `:service/${path}`], {
    maxBuffer: 64 * 1024 * 1024,
  });

const parentTreeHasBlob = path => {
  try {
    execFileSync('git', ['-C', repositoryRoot, 'cat-file', '-e', `HEAD:service/${path}`], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (error?.status === 128) return false;
    fail('SERVICE_FORK_PARENT_LOOKUP_FAILED', path);
  }
};

const upsertHashRow = (rows, path, hash) => {
  const retained = rows.filter(row => row.path !== path);
  retained.push({ path, sha256: hash });
  return retained.toSorted((left, right) => compareUtf8(left.path, right.path));
};

const transactionPath = join(serviceRoot, '.service-fork-update.v1.json');
const transactionPointerTemporary = `${transactionPath}.tmp`;

const syncDirectory = async path => {
  const handle = await open(path, 'r');
  try {
    await handle.sync().catch(error => {
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
    });
  } finally {
    await handle.close();
  }
};

const readOptionalBytes = async path =>
  readFile(path).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });

const assertTransaction = transaction => {
  if (
    transaction === null ||
    typeof transaction !== 'object' ||
    Array.isArray(transaction) ||
    JSON.stringify(Object.keys(transaction).toSorted(compareUtf8)) !==
      JSON.stringify(['schemaVersion', 'targets', 'transactionId']) ||
    transaction.schemaVersion !== 1 ||
    !/^[0-9a-f]{64}$/.test(transaction.transactionId ?? '') ||
    !Array.isArray(transaction.targets) ||
    transaction.targets.length !== 3
  ) {
    fail('SERVICE_FORK_TRANSACTION_CORRUPT', 'transaction pointer is invalid');
  }
  const expectedPaths = ['upstream-lock.json', 'vendor-map.json', 'vendor-rules.json'];
  const observedPaths = [];
  for (const target of transaction.targets) {
    if (
      target === null ||
      typeof target !== 'object' ||
      Array.isArray(target) ||
      JSON.stringify(Object.keys(target).toSorted(compareUtf8)) !==
        JSON.stringify(['newSha256', 'oldSha256', 'path', 'temporaryPath']) ||
      !/^[0-9a-f]{64}$/.test(target.newSha256 ?? '') ||
      !/^[0-9a-f]{64}$/.test(target.oldSha256 ?? '')
    ) {
      fail('SERVICE_FORK_TRANSACTION_CORRUPT', 'transaction target is invalid');
    }
    safePath(target.path);
    safePath(target.temporaryPath);
    if (!target.temporaryPath.startsWith('.service-fork-update.')) {
      fail('SERVICE_FORK_TRANSACTION_CORRUPT', 'transaction temporary path is invalid');
    }
    observedPaths.push(target.path);
  }
  if (JSON.stringify(observedPaths.toSorted(compareUtf8)) !== JSON.stringify(expectedPaths)) {
    fail('SERVICE_FORK_TRANSACTION_CORRUPT', 'transaction target set is invalid');
  }
  return transaction;
};

const applyAuthorityTransaction = async (transaction, crashAfterRenames = null) => {
  let renamed = 0;
  /* eslint-disable no-await-in-loop -- durable authority publication and crash injection are ordered */
  for (const target of transaction.targets) {
    const absoluteTarget = servicePath(target.path);
    const absoluteTemporary = servicePath(target.temporaryPath);
    const current = await readOptionalBytes(absoluteTarget);
    const currentHash = current === null ? null : sha256(current);
    if (currentHash === target.newSha256) {
      await unlink(absoluteTemporary).catch(error => {
        if (error?.code !== 'ENOENT') throw error;
      });
      continue;
    }
    if (currentHash !== target.oldSha256) {
      fail(
        'SERVICE_FORK_TRANSACTION_CONFLICT',
        `${target.path} is neither the old nor intended authority version`,
      );
    }
    const prepared = await readOptionalBytes(absoluteTemporary);
    if (prepared === null || sha256(prepared) !== target.newSha256) {
      fail('SERVICE_FORK_TRANSACTION_CORRUPT', `${target.temporaryPath} is unavailable`);
    }
    await rename(absoluteTemporary, absoluteTarget);
    await syncDirectory(serviceRoot);
    renamed += 1;
    if (crashAfterRenames !== null && renamed === crashAfterRenames) {
      fail('SERVICE_FORK_TEST_CRASH', `injected after ${renamed} authority rename(s)`);
    }
  }
  /* eslint-enable no-await-in-loop */
  await unlink(transactionPath);
  await syncDirectory(serviceRoot);
};

const recoverAuthorityTransaction = async () => {
  const pointer = await readOptionalBytes(transactionPath);
  if (pointer === null) return;
  let transaction;
  try {
    transaction = assertTransaction(JSON.parse(pointer.toString('utf8')));
  } catch (error) {
    if (String(error).includes('SERVICE_FORK_TRANSACTION')) throw error;
    fail('SERVICE_FORK_TRANSACTION_CORRUPT', 'transaction pointer is invalid JSON');
  }
  await applyAuthorityTransaction(transaction);
};

const commitAuthorityTransaction = async targets => {
  const sorted = targets.toSorted((left, right) => compareUtf8(left.path, right.path));
  const transactionId = sha256(
    Buffer.concat(
      sorted.flatMap(target => [
        Buffer.from(target.path, 'utf8'),
        Buffer.from([0]),
        Buffer.from(sha256(target.contents), 'ascii'),
      ]),
    ),
  );
  const transaction = {
    schemaVersion: 1,
    transactionId,
    targets: [],
  };
  /* eslint-disable no-await-in-loop -- each prepared authority file is fsynced before pointer publication */
  for (const target of sorted) {
    const absoluteTarget = servicePath(target.path);
    const oldContents = await readFile(absoluteTarget);
    const temporaryPath = `.service-fork-update.${transactionId}.${basename(target.path)}.tmp`;
    const absoluteTemporary = servicePath(temporaryPath);
    const existingTemporary = await readOptionalBytes(absoluteTemporary);
    if (existingTemporary === null) {
      const handle = await open(absoluteTemporary, 'wx', 0o600);
      try {
        await handle.writeFile(target.contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else if (sha256(existingTemporary) !== sha256(target.contents)) {
      fail('SERVICE_FORK_TRANSACTION_CONFLICT', `${temporaryPath} already exists with other bytes`);
    }
    transaction.targets.push({
      path: target.path,
      temporaryPath,
      oldSha256: sha256(oldContents),
      newSha256: sha256(target.contents),
    });
  }
  /* eslint-enable no-await-in-loop */
  await syncDirectory(serviceRoot);
  const pointerBytes = Buffer.from(`${JSON.stringify(transaction, null, 2)}\n`, 'utf8');
  const existingPointerTemporary = await readOptionalBytes(transactionPointerTemporary);
  if (existingPointerTemporary === null) {
    const pointerHandle = await open(transactionPointerTemporary, 'wx', 0o600);
    try {
      await pointerHandle.writeFile(pointerBytes);
      await pointerHandle.sync();
    } finally {
      await pointerHandle.close();
    }
  } else if (!existingPointerTemporary.equals(pointerBytes)) {
    fail(
      'SERVICE_FORK_TRANSACTION_CONFLICT',
      'transaction pointer temporary belongs to another authority update',
    );
  }
  const crashBeforePointer = process.env.SFP_SERVICE_FORK_TEST_CRASH_BEFORE_POINTER_RENAME;
  if (crashBeforePointer !== undefined && crashBeforePointer !== '1') {
    fail('SERVICE_FORK_TEST_CRASH_INVALID', crashBeforePointer);
  }
  if (crashBeforePointer === '1') {
    fail('SERVICE_FORK_TEST_CRASH', 'injected before transaction pointer publication');
  }
  await rename(transactionPointerTemporary, transactionPath);
  await syncDirectory(serviceRoot);
  const crashAfter = process.env.SFP_SERVICE_FORK_TEST_CRASH_AFTER_RENAMES;
  const crashAfterRenames =
    crashAfter === undefined
      ? null
      : /^\d+$/.test(crashAfter) && Number(crashAfter) >= 1 && Number(crashAfter) <= 3
        ? Number(crashAfter)
        : fail('SERVICE_FORK_TEST_CRASH_INVALID', String(crashAfter));
  await applyAuthorityTransaction(transaction, crashAfterRenames);
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--slice' || args[2] !== '--index') {
    fail(
      'SERVICE_FORK_USAGE',
      'usage: update-service-forks.mjs --slice <id> --index <repo-relative-path>',
    );
  }
  const slice = args[1];
  const indexPath = safePath(args[3]);
  const allowedSlices = new Set([
    '7A',
    '7B',
    '7C',
    '8A',
    '8B',
    '9A',
    '9B',
    '9C',
    '10',
    '11',
    '12A',
    '12B',
    '13',
    '14',
    '15',
    '16',
  ]);
  if (!allowedSlices.has(slice) && !/^review-\d{4}-\d{2}-\d{2}$/.test(slice)) {
    fail('SERVICE_FORK_SLICE_INVALID', slice);
  }
  if (!indexPath.startsWith('service/capabilities/change-manifests/')) {
    fail('SERVICE_FORK_INDEX_INVALID', indexPath);
  }

  await recoverAuthorityTransaction();

  const rulesPath = servicePath('vendor-rules.json');
  const mapPath = servicePath('vendor-map.json');
  const lockPath = servicePath('upstream-lock.json');
  const [rules, vendorMap, lock] = await Promise.all([
    readJson(rulesPath),
    readJson(mapPath),
    readJson(lockPath),
  ]);
  if (rules.schemaVersion !== 1 || vendorMap.schemaVersion !== 1) {
    fail('SERVICE_FORK_AUTHORITY_INVALID', 'vendor rules/map schema mismatch');
  }
  const originRepo = vendorMap.upstream;
  const pinnedOrigin = lock.upstreams?.find(upstream => upstream.id === originRepo);
  if (
    !['figwright', 'figma-mcp-rust', 'figmosha2'].includes(originRepo) ||
    pinnedOrigin === undefined ||
    vendorMap.originCommit !== pinnedOrigin.commit
  ) {
    fail('SERVICE_FORK_ORIGIN_UNPINNED', String(originRepo));
  }
  const rawChanges = stagedChanges();
  const serviceForks = [...(lock.serviceForks ?? [])];
  let serviceFiles = [...(lock.serviceFiles ?? [])];
  let serviceOwnedFiles = [...(lock.destinationClosure?.serviceOwnedFiles ?? [])];
  const managedRoots = [...(lock.destinationClosure?.managedRoots ?? [])];
  const files = [...vendorMap.files];
  const exclude = new Set(rules.exclude ?? []);
  const serviceOwned = new Set(rules.serviceOwned ?? []);
  const movePairs = await readDeclaredMovePairs(indexPath, slice);
  const declaredOrdinaryAdds = await readDeclaredOrdinaryAdds(indexPath, slice);
  const changes = applyDeclaredMovePairs(
    rawChanges,
    movePairs,
    files,
    serviceForks,
    serviceOwned,
    serviceFiles,
    serviceOwnedFiles,
    exclude,
    managedRoots,
  );
  const reservedAuthorityPaths = new Set([
    'vendor-map.json',
    'vendor-rules.json',
    'upstream-lock.json',
    indexPath.startsWith('service/') ? indexPath.slice('service/'.length) : indexPath,
  ]);

  for (const change of changes) {
    if (
      reservedAuthorityPaths.has(change.path) ||
      (change.oldPath !== undefined && reservedAuthorityPaths.has(change.oldPath))
    ) {
      continue;
    }
    if (change.status === 'R') {
      const bytes = stagedBytes(change.path);
      const stagedSha256 = sha256(bytes);
      const oldPath = change.oldPath;
      const priorIndex = files.findIndex(row => row.destination === oldPath);
      const destinationVendorIndex = files.findIndex(row => row.destination === change.path);
      if (destinationVendorIndex >= 0 && destinationVendorIndex !== priorIndex) {
        fail('SERVICE_FORK_MOVE_CONFLICT', change.path);
      }
      const existingForkIndex = serviceForks.findIndex(
        row =>
          row.destination === oldPath ||
          row.oldDestination === oldPath ||
          row.newDestination === oldPath,
      );
      if (priorIndex >= 0) {
        const prior = files[priorIndex];
        serviceForks.push({
          originRepo,
          originPath: prior.sourcePath,
          previousMode: prior.mode,
          originCommit: prior.originCommit,
          baseSha256: prior.baseSha256,
          transitionTask: slice,
          reason: `service-owned behavior introduced by Task ${slice}`,
          transition: 'move',
          oldDestination: oldPath,
          newDestination: change.path,
          newSha256: stagedSha256,
        });
        files.splice(priorIndex, 1);
        exclude.add(oldPath);
        exclude.add(change.path);
        serviceOwned.delete(oldPath);
        serviceOwned.add(change.path);
      } else if (existingForkIndex >= 0) {
        const existing = serviceForks[existingForkIndex];
        if (existing.transition === 'delete') fail('SERVICE_FORK_DELETED_REEDIT', oldPath);
        const priorDestination =
          existing.transition === 'move' ? existing.oldDestination : existing.destination;
        serviceForks[existingForkIndex] = {
          originRepo: existing.originRepo,
          originPath: existing.originPath,
          previousMode: existing.previousMode,
          originCommit: existing.originCommit,
          baseSha256: existing.baseSha256,
          transitionTask: slice,
          reason: `service-owned behavior introduced by Task ${slice}`,
          transition: 'move',
          oldDestination: priorDestination,
          newDestination: change.path,
          newSha256: stagedSha256,
        };
        exclude.add(priorDestination);
        exclude.add(oldPath);
        exclude.add(change.path);
        serviceOwned.delete(oldPath);
        serviceOwned.add(change.path);
      } else if (serviceOwned.has(oldPath)) {
        exclude.add(oldPath);
        exclude.add(change.path);
        serviceOwned.delete(oldPath);
        serviceOwned.add(change.path);
      }
      serviceFiles = serviceFiles.filter(entry => entry.path !== oldPath);
      serviceFiles = upsertHashRow(serviceFiles, change.path, stagedSha256);
      serviceOwnedFiles = serviceOwnedFiles.filter(entry => entry.path !== oldPath);
      if (managedRoots.some(root => change.path === root || change.path.startsWith(`${root}/`))) {
        serviceOwnedFiles = upsertHashRow(serviceOwnedFiles, change.path, stagedSha256);
        serviceOwned.add(change.path);
        exclude.add(change.path);
      }
      continue;
    }
    const bytes = change.status === 'D' ? null : stagedBytes(change.path);
    const stagedSha256 = bytes === null ? null : sha256(bytes);
    const rowIndex = files.findIndex(row => row.destination === change.path);
    const existingForkIndex = serviceForks.findIndex(
      row =>
        row.destination === change.path ||
        row.oldDestination === change.path ||
        row.newDestination === change.path,
    );
    if (change.status === 'A') {
      const matchingServiceFiles = serviceFiles.filter(entry => entry.path === change.path);
      const matchingOwnedFiles = serviceOwnedFiles.filter(entry => entry.path === change.path);
      const managed = managedRoots.some(
        root => change.path === root || change.path.startsWith(`${root}/`),
      );
      const priorServiceHash = matchingServiceFiles[0]?.sha256;
      const classClaimsConsistent =
        matchingServiceFiles.length === 1 &&
        /^[0-9a-f]{64}$/.test(priorServiceHash ?? '') &&
        (managed
          ? serviceOwned.has(change.path) &&
            matchingOwnedFiles.length === 1 &&
            matchingOwnedFiles[0].sha256 === priorServiceHash
          : !serviceOwned.has(change.path) && matchingOwnedFiles.length === 0);
      const partialRunRecovery =
        rowIndex < 0 &&
        existingForkIndex < 0 &&
        !parentTreeHasBlob(change.path) &&
        declaredOrdinaryAdds.get(change.path) === stagedSha256 &&
        classClaimsConsistent;
      const claimed =
        rowIndex >= 0 ||
        existingForkIndex >= 0 ||
        serviceOwned.has(change.path) ||
        matchingServiceFiles.length > 0 ||
        matchingOwnedFiles.length > 0;
      if (claimed && !partialRunRecovery) {
        fail('SERVICE_FORK_UNPAIRED_CLAIMED_ADD', change.path);
      }
    }
    if (rowIndex >= 0) {
      const prior = files[rowIndex];
      if (change.status === 'D') {
        serviceForks.push({
          originRepo,
          originPath: prior.sourcePath,
          previousMode: prior.mode,
          originCommit: prior.originCommit,
          baseSha256: prior.baseSha256,
          transitionTask: slice,
          reason: `service-owned behavior introduced by Task ${slice}`,
          transition: 'delete',
          destination: change.path,
          stagedSha256: null,
        });
        exclude.add(change.path);
        serviceOwned.delete(change.path);
        serviceOwnedFiles = serviceOwnedFiles.filter(entry => entry.path !== change.path);
        serviceFiles = serviceFiles.filter(entry => entry.path !== change.path);
      } else {
        serviceForks.push({
          originRepo,
          originPath: prior.sourcePath,
          previousMode: prior.mode,
          originCommit: prior.originCommit,
          baseSha256: prior.baseSha256,
          transitionTask: slice,
          reason: `service-owned behavior introduced by Task ${slice}`,
          transition: 'edit',
          destination: change.path,
          stagedSha256,
        });
        exclude.add(change.path);
        serviceOwned.add(change.path);
      }
      files.splice(rowIndex, 1);
    } else if (existingForkIndex >= 0 && change.status !== 'D') {
      const existing = serviceForks[existingForkIndex];
      if (existing.transition === 'edit') existing.stagedSha256 = stagedSha256;
      else if (existing.transition === 'move') existing.newSha256 = stagedSha256;
      else fail('SERVICE_FORK_DELETED_REEDIT', change.path);
    } else if (existingForkIndex >= 0) {
      const existing = serviceForks[existingForkIndex];
      const destination =
        existing.transition === 'move' ? existing.newDestination : existing.destination;
      serviceForks[existingForkIndex] = {
        originRepo: existing.originRepo,
        originPath: existing.originPath,
        previousMode: existing.previousMode,
        originCommit: existing.originCommit,
        baseSha256: existing.baseSha256,
        transitionTask: slice,
        reason: `service-owned behavior introduced by Task ${slice}`,
        transition: 'delete',
        destination,
        stagedSha256: null,
      };
      exclude.add(destination);
      serviceOwned.delete(destination);
    }

    if (change.status !== 'D') {
      serviceFiles = upsertHashRow(serviceFiles, change.path, stagedSha256);
      if (
        managedRoots.some(root => change.path === root || change.path.startsWith(`${root}/`)) &&
        !files.some(row => row.destination === change.path)
      ) {
        serviceOwnedFiles = upsertHashRow(serviceOwnedFiles, change.path, stagedSha256);
        serviceOwned.add(change.path);
        exclude.add(change.path);
      }
    } else {
      serviceFiles = serviceFiles.filter(entry => entry.path !== change.path);
      serviceOwnedFiles = serviceOwnedFiles.filter(entry => entry.path !== change.path);
      serviceOwned.delete(change.path);
    }
  }

  const destinationIdentities = new Set();
  for (const row of serviceForks) {
    const paths =
      row.transition === 'move' ? [row.oldDestination, row.newDestination] : [row.destination];
    for (const path of paths) {
      if (destinationIdentities.has(path)) fail('SERVICE_FORK_DUPLICATE', path);
      destinationIdentities.add(path);
    }
  }

  rules.exclude = [...exclude].toSorted(compareUtf8);
  rules.serviceOwned = [...serviceOwned].toSorted(compareUtf8);
  vendorMap.files = files.toSorted(
    (left, right) =>
      compareUtf8(left.sourcePath, right.sourcePath) || compareUtf8(left.mode, right.mode),
  );
  const rulesBytes = await formattedJsonBytes(rulesPath, rules);
  const mapBytes = await formattedJsonBytes(mapPath, vendorMap);

  serviceFiles = upsertHashRow(serviceFiles, 'vendor-rules.json', sha256(rulesBytes));
  lock.schemaVersion = 2;
  lock.serviceForks = serviceForks.toSorted((left, right) => {
    const leftPath = left.destination ?? left.oldDestination;
    const rightPath = right.destination ?? right.oldDestination;
    return compareUtf8(leftPath, rightPath);
  });
  lock.serviceFiles = serviceFiles;
  lock.destinationClosure = {
    ...lock.destinationClosure,
    managedRoots: managedRoots.toSorted(compareUtf8),
    serviceOwnedFiles: serviceOwnedFiles.toSorted((left, right) =>
      compareUtf8(left.path, right.path),
    ),
  };
  lock.vendorMap = {
    ...lock.vendorMap,
    path: 'vendor-map.json',
    sha256: sha256(mapBytes),
    counts: {
      copy: vendorMap.files.filter(row => row.mode === 'copy').length,
      mergeDependencyManifest: vendorMap.files.filter(row => row.mode === 'mergeDependencyManifest')
        .length,
      referenceOnly: vendorMap.files.filter(row => row.mode === 'referenceOnly').length,
      total: vendorMap.files.length,
    },
  };
  const lockBytes = await formattedJsonBytes(lockPath, lock);
  await commitAuthorityTransaction([
    { path: 'vendor-rules.json', contents: rulesBytes },
    { path: 'vendor-map.json', contents: mapBytes },
    { path: 'upstream-lock.json', contents: lockBytes },
  ]);
  process.stdout.write(
    `service-forks=ok slice=${slice} changes=${changes.length} forks=${lock.serviceForks.length}\n`,
  );
};

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
