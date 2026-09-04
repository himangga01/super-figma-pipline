import { createHash, randomBytes as systemRandomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { type FileHandle, lstat, open, opendir, rename, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join, parse, resolve } from 'node:path';
import { domainToASCII } from 'node:url';

import {
  readFileWithinLimit,
  type RetainedDirectoryAuthority,
  withCanonicalPathMutex,
  withRetainedDirectoryAuthority,
  withRetainedDirectoryDescendantChain,
} from '../fs/atomic-file.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';

const DIRECTORY_NAME = 'network';
const CONFIG_FILENAME = 'remote-domains.v1.json';
const TEMPORARY_PREFIX = '.remote-domain-state.v1.';
const TEMPORARY_PATTERN = /^\.remote-domain-state\.v1\.([0-9a-f]{64})\.([0-9a-f]{32})\.sfp-tmp$/u;
const ACTOR_PATTERN = /^actor1_[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export const REMOTE_DOMAIN_LIMITS = Object.freeze({
  maxRules: 256,
  maxConfigBytes: 262_144,
  maxTemporaryCandidates: 32,
  maxScanEntries: 4_096,
  maxAuditRows: 4_096,
  maxAuditBytes: 2_097_152,
});

const MAX_PERSISTED_BYTES =
  REMOTE_DOMAIN_LIMITS.maxConfigBytes + REMOTE_DOMAIN_LIMITS.maxAuditBytes + 4_096;

export type RemoteDomainConfigErrorCode =
  | 'REMOTE_DOMAIN_ALREADY_EXISTS'
  | 'REMOTE_DOMAIN_CAPACITY_EXCEEDED'
  | 'REMOTE_DOMAIN_CAS_MISMATCH'
  | 'REMOTE_DOMAIN_COMMIT_OUTCOME_UNKNOWN'
  | 'REMOTE_DOMAIN_CONFIG_INVALID'
  | 'REMOTE_DOMAIN_NOT_FOUND'
  | 'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS'
  | 'REMOTE_DOMAIN_STORE_NOT_RECOVERED'
  | 'REMOTE_DOMAIN_TEMP_LIMIT_EXCEEDED'
  | 'REMOTE_FQDN_INVALID';

export class RemoteDomainConfigError extends Error {
  readonly code: RemoteDomainConfigErrorCode;

  constructor(code: RemoteDomainConfigErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RemoteDomainConfigError';
    this.code = code;
  }
}

export class RemoteDomainCommitOutcomeUnknownError extends RemoteDomainConfigError {
  readonly committed: boolean;

  constructor(committed: boolean, cause: unknown) {
    super(
      'REMOTE_DOMAIN_COMMIT_OUTCOME_UNKNOWN',
      committed
        ? 'remote domain transaction committed but its durable outcome is uncertain'
        : 'remote domain transaction is prepared but its commit outcome is uncertain',
      cause,
    );
    this.name = 'RemoteDomainCommitOutcomeUnknownError';
    this.committed = committed;
  }
}

export interface RemoteDomainRule {
  fqdnAscii: string;
  addedBy: string;
  addedAt: string;
}

interface RemoteDomainAuditRow {
  action: 'add' | 'remove';
  actorId: string;
  at: string;
  fqdnAscii: string;
  result: 'committed';
}

interface RemoteDomainStatePayload {
  schemaVersion: 1;
  generation: number;
  rules: RemoteDomainRule[];
  audit: RemoteDomainAuditRow[];
}

interface RemoteDomainStateEnvelope extends RemoteDomainStatePayload {
  checksum: `sha256:${string}`;
}

export interface RemoteDomainConfigStoreHooks {
  afterTemporaryFsync?: (temporaryPath: string) => Promise<void>;
  afterRecoveryTemporaryRead?: (temporaryPath: string) => Promise<void>;
  beforeOwnedTemporaryCleanup?: (temporaryPath: string) => Promise<void>;
  afterRenameBeforeDirectoryFsync?: (configPath: string) => Promise<void>;
  afterDirectoryFsync?: (configPath: string) => Promise<void>;
}

export interface RemoteDomainConfigStoreOptions {
  stateRoot: string;
  permissions: BoundStatePermissions;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  hooks?: RemoteDomainConfigStoreHooks;
}

const fail = (
  code: RemoteDomainConfigErrorCode,
  message: string,
  cause?: unknown,
): RemoteDomainConfigError => new RemoteDomainConfigError(code, message, cause);

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'state is not JSON');
  return encoded;
};

const checksumFor = (payload: RemoteDomainStatePayload): `sha256:${string}` =>
  `sha256:${createHash('sha256')
    .update('sfp-remote-domain-state-v1', 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalJson(payload), 'utf8')
    .digest('hex')}`;

const digest64 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const exactKeys = (value: object, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...keys].toSorted());

const byteCompare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

const canonicalTimestamp = (input: string): boolean => {
  const milliseconds = Date.parse(input);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === input;
};

const isWellFormedUnicode = (input: string): boolean => {
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
};

const assertActor = (actorId: string): void => {
  if (!ACTOR_PATTERN.test(actorId)) {
    throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain actor is invalid');
  }
};

export const normalizeRemoteDomain = (input: string): string => {
  const invalid = (): never => {
    throw fail('REMOTE_FQDN_INVALID', 'remote domain must be one exact three-label FQDN');
  };
  const hasForbiddenCharacter =
    typeof input === 'string' &&
    [...input].some(character => {
      const codePoint = character.codePointAt(0) as number;
      return codePoint <= 0x20 || codePoint === 0x7f || '*\\/@:[]'.includes(character);
    });
  if (
    typeof input !== 'string' ||
    input.length < 1 ||
    input.length > 253 ||
    input !== input.trim() ||
    !isWellFormedUnicode(input) ||
    hasForbiddenCharacter ||
    input.startsWith('.') ||
    input.endsWith('.')
  ) {
    return invalid();
  }
  const ascii = domainToASCII(input).toLowerCase();
  if (
    ascii.length < 1 ||
    ascii.length > 253 ||
    ascii.startsWith('.') ||
    ascii.endsWith('.') ||
    isIP(ascii) !== 0
  ) {
    return invalid();
  }
  const labels = ascii.split('.');
  if (
    labels.length < 3 ||
    labels.some(
      label =>
        label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    return invalid();
  }
  return ascii;
};

const immutableRule = (rule: RemoteDomainRule): Readonly<RemoteDomainRule> =>
  Object.freeze({ ...rule });

const immutableRules = (
  rules: readonly RemoteDomainRule[],
): readonly Readonly<RemoteDomainRule>[] => Object.freeze(rules.map(immutableRule));

const emptyState = (): RemoteDomainStateEnvelope => {
  const payload: RemoteDomainStatePayload = {
    schemaVersion: 1,
    generation: 0,
    rules: [],
    audit: [],
  };
  return { ...payload, checksum: checksumFor(payload) };
};

const parseRule = (value: unknown): RemoteDomainRule | null => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value, ['fqdnAscii', 'addedBy', 'addedAt'])
  ) {
    return null;
  }
  const row = value as RemoteDomainRule;
  try {
    assertActor(row.addedBy);
    if (
      typeof row.fqdnAscii !== 'string' ||
      normalizeRemoteDomain(row.fqdnAscii) !== row.fqdnAscii ||
      typeof row.addedAt !== 'string' ||
      !canonicalTimestamp(row.addedAt)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return { fqdnAscii: row.fqdnAscii, addedBy: row.addedBy, addedAt: row.addedAt };
};

const parseAuditRow = (value: unknown): RemoteDomainAuditRow | null => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value, ['action', 'actorId', 'at', 'fqdnAscii', 'result'])
  ) {
    return null;
  }
  const row = value as RemoteDomainAuditRow;
  try {
    assertActor(row.actorId);
    if (
      !['add', 'remove'].includes(row.action) ||
      row.result !== 'committed' ||
      typeof row.at !== 'string' ||
      !canonicalTimestamp(row.at) ||
      typeof row.fqdnAscii !== 'string' ||
      normalizeRemoteDomain(row.fqdnAscii) !== row.fqdnAscii
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    action: row.action,
    actorId: row.actorId,
    at: row.at,
    fqdnAscii: row.fqdnAscii,
    result: 'committed',
  };
};

const statePayload = (state: RemoteDomainStateEnvelope): RemoteDomainStatePayload => ({
  schemaVersion: state.schemaVersion,
  generation: state.generation,
  rules: state.rules,
  audit: state.audit,
});

const auditMatchesRules = (
  audit: readonly RemoteDomainAuditRow[],
  rules: readonly RemoteDomainRule[],
): boolean => {
  const replayed = new Map<string, RemoteDomainRule>();
  for (const row of audit) {
    if (row.action === 'add') {
      if (replayed.has(row.fqdnAscii)) return false;
      replayed.set(row.fqdnAscii, {
        fqdnAscii: row.fqdnAscii,
        addedBy: row.actorId,
        addedAt: row.at,
      });
    } else if (!replayed.delete(row.fqdnAscii)) {
      return false;
    }
  }
  const expected = [...replayed.values()].toSorted((left, right) =>
    byteCompare(left.fqdnAscii, right.fqdnAscii),
  );
  return canonicalJson(expected) === canonicalJson(rules);
};

const validateStateBounds = (state: RemoteDomainStatePayload): void => {
  const configBytes = Buffer.byteLength(
    canonicalJson({
      schemaVersion: state.schemaVersion,
      generation: state.generation,
      rules: state.rules,
    }),
    'utf8',
  );
  const auditBytes = Buffer.byteLength(canonicalJson(state.audit), 'utf8');
  if (
    state.rules.length > REMOTE_DOMAIN_LIMITS.maxRules ||
    configBytes > REMOTE_DOMAIN_LIMITS.maxConfigBytes ||
    state.audit.length > REMOTE_DOMAIN_LIMITS.maxAuditRows ||
    auditBytes > REMOTE_DOMAIN_LIMITS.maxAuditBytes
  ) {
    throw fail('REMOTE_DOMAIN_CAPACITY_EXCEEDED', 'remote domain state exceeds a fixed bound');
  }
};

const parseState = (bytes: Uint8Array): RemoteDomainStateEnvelope => {
  let unknownState: unknown;
  try {
    const text = Buffer.from(bytes).toString('utf8');
    if (
      !text.endsWith('\n') ||
      text.includes('\r') ||
      Buffer.from(text, 'utf8').byteLength !== bytes.byteLength
    ) {
      throw new Error('state is not canonical UTF-8 JSON with one LF');
    }
    unknownState = JSON.parse(text.slice(0, -1)) as unknown;
  } catch (cause) {
    throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain state is malformed', cause);
  }
  if (
    typeof unknownState !== 'object' ||
    unknownState === null ||
    Array.isArray(unknownState) ||
    !exactKeys(unknownState, ['schemaVersion', 'generation', 'rules', 'audit', 'checksum'])
  ) {
    throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain state has an open or invalid schema');
  }
  const candidate = unknownState as RemoteDomainStateEnvelope;
  if (
    candidate.schemaVersion !== 1 ||
    !Number.isSafeInteger(candidate.generation) ||
    candidate.generation < 1 ||
    !Array.isArray(candidate.rules) ||
    !Array.isArray(candidate.audit) ||
    typeof candidate.checksum !== 'string' ||
    !SHA256_PATTERN.test(candidate.checksum)
  ) {
    throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain state header is invalid');
  }
  const rules = candidate.rules.map(parseRule);
  const audit = candidate.audit.map(parseAuditRow);
  if (rules.some(rule => rule === null) || audit.some(row => row === null)) {
    throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain state row is invalid');
  }
  const parsed: RemoteDomainStateEnvelope = {
    schemaVersion: 1,
    generation: candidate.generation,
    rules: rules as RemoteDomainRule[],
    audit: audit as RemoteDomainAuditRow[],
    checksum: candidate.checksum,
  };
  if (
    parsed.generation !== parsed.audit.length ||
    !auditMatchesRules(parsed.audit, parsed.rules) ||
    parsed.rules.some(
      (rule, index) =>
        (index > 0 && byteCompare(parsed.rules[index - 1]!.fqdnAscii, rule.fqdnAscii) >= 0) ||
        parsed.rules.findIndex(candidateRule => candidateRule.fqdnAscii === rule.fqdnAscii) !==
          index,
    ) ||
    checksumFor(statePayload(parsed)) !== parsed.checksum ||
    `${canonicalJson(parsed)}\n` !== Buffer.from(bytes).toString('utf8')
  ) {
    throw fail(
      'REMOTE_DOMAIN_CONFIG_INVALID',
      'remote domain state checksum or ordering is invalid',
    );
  }
  try {
    validateStateBounds(parsed);
  } catch (cause) {
    throw fail(
      'REMOTE_DOMAIN_CONFIG_INVALID',
      'persisted remote domain state exceeds a fixed bound',
      cause,
    );
  }
  return parsed;
};

const serializeState = (payload: RemoteDomainStatePayload): Buffer => {
  validateStateBounds(payload);
  const envelope: RemoteDomainStateEnvelope = { ...payload, checksum: checksumFor(payload) };
  const bytes = Buffer.from(`${canonicalJson(envelope)}\n`, 'utf8');
  if (bytes.byteLength > MAX_PERSISTED_BYTES) {
    throw fail('REMOTE_DOMAIN_CAPACITY_EXCEEDED', 'remote domain state envelope is oversized');
  }
  return bytes;
};

const isUniqueSuccessor = (
  current: RemoteDomainStateEnvelope,
  prepared: RemoteDomainStateEnvelope,
): boolean => {
  if (
    prepared.generation !== current.generation + 1 ||
    prepared.audit.length !== current.audit.length + 1 ||
    canonicalJson(prepared.audit.slice(0, -1)) !== canonicalJson(current.audit)
  ) {
    return false;
  }
  const audit = prepared.audit.at(-1);
  if (audit === undefined) return false;
  if (audit.action === 'add') {
    const added = prepared.rules.find(rule => rule.fqdnAscii === audit.fqdnAscii);
    if (
      added === undefined ||
      current.rules.some(rule => rule.fqdnAscii === audit.fqdnAscii) ||
      added.addedBy !== audit.actorId ||
      added.addedAt !== audit.at ||
      prepared.rules.length !== current.rules.length + 1
    ) {
      return false;
    }
    return (
      canonicalJson(prepared.rules.filter(rule => rule.fqdnAscii !== audit.fqdnAscii)) ===
      canonicalJson(current.rules)
    );
  }
  if (
    !current.rules.some(rule => rule.fqdnAscii === audit.fqdnAscii) ||
    prepared.rules.some(rule => rule.fqdnAscii === audit.fqdnAscii) ||
    prepared.rules.length !== current.rules.length - 1
  ) {
    return false;
  }
  return (
    canonicalJson(current.rules.filter(rule => rule.fqdnAscii !== audit.fqdnAscii)) ===
    canonicalJson(prepared.rules)
  );
};

const sameIdentity = (
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean => left.dev === right.dev && left.ino === right.ino;

const bigintIdentityKey = (metadata: BigIntStats): string =>
  `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`;

const sameBigintIdentity = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;

const fsyncDirectory = async (path: string): Promise<void> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (cause) {
    if (process.platform !== 'win32' || (cause as NodeJS.ErrnoException).code !== 'EPERM') {
      throw cause;
    }
  } finally {
    await handle?.close();
  }
};

const validateStateRoot = (input: string): string => {
  if (typeof input !== 'string' || input.trim() === '') {
    throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'state root is invalid');
  }
  const root = resolve(input);
  if (root === parse(root).root) {
    throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'state root cannot be a filesystem root');
  }
  return root;
};

export const remoteDomainConfigPath = (stateRoot: string): string =>
  join(validateStateRoot(stateRoot), DIRECTORY_NAME, CONFIG_FILENAME);

interface SecurePaths {
  logicalDirectory: string;
  logicalConfig: string;
  authority: RetainedDirectoryAuthority;
}

interface RetainedStateFile {
  logicalPath: string;
  authorityPath: string;
  handle: FileHandle;
  identity: BigIntStats;
}

export class RemoteDomainConfigStore {
  private readonly stateRoot: string;
  private readonly permissions: BoundStatePermissions;
  private readonly now: () => number;
  private readonly entropy: (size: number) => Uint8Array;
  private readonly hooks: RemoteDomainConfigStoreHooks;
  private recovered = false;

  constructor(options: RemoteDomainConfigStoreOptions) {
    this.stateRoot = validateStateRoot(options.stateRoot);
    this.permissions = options.permissions;
    if (resolve(options.permissions.stateRoot) !== this.stateRoot) {
      throw fail(
        'REMOTE_DOMAIN_CONFIG_INVALID',
        'state root differs from its permission authority',
      );
    }
    this.now = options.now ?? Date.now;
    this.entropy = options.randomBytes ?? systemRandomBytes;
    this.hooks = options.hooks ?? {};
  }

  async recover(): Promise<void> {
    await this.exclusive(async paths => {
      await this.recoverUnlocked(paths);
    });
    this.recovered = true;
  }

  async list(): Promise<readonly Readonly<RemoteDomainRule>[]> {
    this.assertRecovered();
    return this.exclusive(async paths => {
      const state = await this.recoverUnlocked(paths);
      return immutableRules(state.rules);
    });
  }

  async addAuthorized(
    actorId: string,
    fqdnInput: string,
    beforeCommit: () => Promise<void>,
  ): Promise<Readonly<RemoteDomainRule>> {
    assertActor(actorId);
    const fqdnAscii = normalizeRemoteDomain(fqdnInput);
    if (typeof beforeCommit !== 'function') {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'authorization callback is invalid');
    }
    this.assertRecovered();
    return this.exclusive(async paths => {
      const current = await this.recoverUnlocked(paths);
      if (current.rules.some(rule => rule.fqdnAscii === fqdnAscii)) {
        throw fail('REMOTE_DOMAIN_ALREADY_EXISTS', 'remote domain already exists');
      }
      if (current.rules.length >= REMOTE_DOMAIN_LIMITS.maxRules) {
        throw fail('REMOTE_DOMAIN_CAPACITY_EXCEEDED', 'remote domain rule capacity is full');
      }
      const at = this.timestamp();
      const rule: RemoteDomainRule = { fqdnAscii, addedBy: actorId, addedAt: at };
      const next = this.nextState(current, rule, {
        action: 'add',
        actorId,
        at,
        fqdnAscii,
        result: 'committed',
      });
      const bytes = serializeState(next);
      const token = this.nextToken();
      await this.assertCurrent(paths, current);
      await beforeCommit();
      await this.commit(paths, current, next, bytes, token);
      return immutableRule(rule);
    });
  }

  async removeAuthorized(
    actorId: string,
    fqdnInput: string,
    beforeCommit: () => Promise<void>,
  ): Promise<void> {
    assertActor(actorId);
    const fqdnAscii = normalizeRemoteDomain(fqdnInput);
    if (typeof beforeCommit !== 'function') {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'authorization callback is invalid');
    }
    this.assertRecovered();
    return this.exclusive(async paths => {
      const current = await this.recoverUnlocked(paths);
      if (!current.rules.some(rule => rule.fqdnAscii === fqdnAscii)) {
        throw fail('REMOTE_DOMAIN_NOT_FOUND', 'remote domain does not exist');
      }
      const at = this.timestamp();
      const next = this.nextState(current, fqdnAscii, {
        action: 'remove',
        actorId,
        at,
        fqdnAscii,
        result: 'committed',
      });
      const bytes = serializeState(next);
      const token = this.nextToken();
      await this.assertCurrent(paths, current);
      await beforeCommit();
      await this.commit(paths, current, next, bytes, token);
    });
  }

  private assertRecovered(): void {
    if (!this.recovered) {
      throw fail('REMOTE_DOMAIN_STORE_NOT_RECOVERED', 'remote domain store is not recovered');
    }
  }

  private timestamp(): string {
    const value = this.now();
    if (!Number.isSafeInteger(value)) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain audit clock is invalid');
    }
    try {
      return new Date(value).toISOString();
    } catch (cause) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain audit clock is invalid', cause);
    }
  }

  private nextToken(): string {
    const entropy = Buffer.from(this.entropy(16));
    if (entropy.byteLength !== 16) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain entropy source failed');
    }
    return entropy.toString('hex');
  }

  private nextState(
    current: RemoteDomainStateEnvelope,
    mutation: RemoteDomainRule | string,
    audit: RemoteDomainAuditRow,
  ): RemoteDomainStatePayload {
    if (current.generation >= Number.MAX_SAFE_INTEGER) {
      throw fail('REMOTE_DOMAIN_CAPACITY_EXCEEDED', 'remote domain generation is exhausted');
    }
    if (current.audit.length >= REMOTE_DOMAIN_LIMITS.maxAuditRows) {
      throw fail('REMOTE_DOMAIN_CAPACITY_EXCEEDED', 'remote domain audit row capacity is full');
    }
    const rules =
      typeof mutation === 'string'
        ? current.rules.filter(rule => rule.fqdnAscii !== mutation)
        : [...current.rules, mutation].toSorted((left, right) =>
            byteCompare(left.fqdnAscii, right.fqdnAscii),
          );
    return {
      schemaVersion: 1,
      generation: current.generation + 1,
      rules,
      audit: [...current.audit, audit],
    };
  }

  private async exclusive<T>(operation: (paths: SecurePaths) => Promise<T>): Promise<T> {
    const rootIdentity = await this.permissions.inspectSecure(this.stateRoot);
    const [rootMetadata, rootMetadataBig] = await Promise.all([
      lstat(this.stateRoot),
      lstat(this.stateRoot, { bigint: true }),
    ]);
    if (
      !rootIdentity.directory ||
      !rootMetadata.isDirectory() ||
      rootMetadata.isSymbolicLink() ||
      rootIdentity.key !== bigintIdentityKey(rootMetadataBig)
    ) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'state root is not a secure directory');
    }
    const logicalDirectory = join(this.stateRoot, DIRECTORY_NAME);
    return withRetainedDirectoryAuthority(
      this.stateRoot,
      rootMetadata,
      rootAuthority =>
        withRetainedDirectoryDescendantChain(
          this.stateRoot,
          rootAuthority,
          logicalDirectory,
          async authority => {
            await this.permissions.ensureSecure(logicalDirectory);
            const directoryIdentity = await this.permissions.inspectSecure(logicalDirectory);
            await authority.verify();
            if (!directoryIdentity.directory) {
              throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'network state path is not a directory');
            }
            const logicalConfig = join(logicalDirectory, CONFIG_FILENAME);
            return withCanonicalPathMutex(
              join(rootIdentity.canonicalPath, DIRECTORY_NAME, CONFIG_FILENAME),
              () => operation({ logicalDirectory, logicalConfig, authority }),
              {
                filesystemTarget: authority.child(CONFIG_FILENAME),
                retainedParentAuthority: true,
                timeoutMs: 30_000,
              },
            );
          },
          { createMissing: true, errorCode: 'REMOTE_DOMAIN_CONFIG_INVALID' },
        ),
      { errorCode: 'REMOTE_DOMAIN_CONFIG_INVALID' },
    );
  }

  private async secureRead(
    logicalPath: string,
    authorityPath: string,
    missingAllowed: boolean,
  ): Promise<Buffer | null> {
    const [logicalResult, capabilityResult] = await Promise.allSettled([
      lstat(logicalPath),
      lstat(authorityPath),
    ]);
    if (logicalResult.status === 'rejected' || capabilityResult.status === 'rejected') {
      const logicalMissing =
        logicalResult.status === 'rejected' &&
        (logicalResult.reason as NodeJS.ErrnoException).code === 'ENOENT';
      const capabilityMissing =
        capabilityResult.status === 'rejected' &&
        (capabilityResult.reason as NodeJS.ErrnoException).code === 'ENOENT';
      if (missingAllowed && logicalMissing && capabilityMissing) return null;
      const cause =
        logicalResult.status === 'rejected'
          ? logicalResult.reason
          : capabilityResult.status === 'rejected'
            ? capabilityResult.reason
            : undefined;
      throw fail(
        'REMOTE_DOMAIN_CONFIG_INVALID',
        'remote domain state path is unavailable or has split authority',
        cause,
      );
    }
    const logical = logicalResult.value;
    const capability = capabilityResult.value;
    if (
      !logical.isFile() ||
      logical.isSymbolicLink() ||
      logical.nlink !== 1 ||
      !capability.isFile() ||
      capability.isSymbolicLink() ||
      capability.nlink !== 1 ||
      !sameIdentity(logical, capability)
    ) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain state is not one direct file');
    }
    const [logicalBig, capabilityBig, inspected] = await Promise.all([
      lstat(logicalPath, { bigint: true }),
      lstat(authorityPath, { bigint: true }),
      this.permissions.inspectSecure(logicalPath),
    ]);
    if (
      !sameBigintIdentity(logicalBig, capabilityBig) ||
      !inspected.file ||
      inspected.key !== bigintIdentityKey(logicalBig)
    ) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain state identity is unstable');
    }
    try {
      const bytes = await readFileWithinLimit(authorityPath, MAX_PERSISTED_BYTES, undefined, {
        expectedIdentity: capability,
      });
      const after = await lstat(logicalPath, { bigint: true });
      if (!sameBigintIdentity(logicalBig, after)) {
        throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'remote domain state changed while read');
      }
      return bytes;
    } catch (cause) {
      if (cause instanceof RemoteDomainConfigError) throw cause;
      throw fail(
        'REMOTE_DOMAIN_CONFIG_INVALID',
        'remote domain state cannot be read safely',
        cause,
      );
    }
  }

  private assertRetainedIdentity(
    file: RetainedStateFile,
    descriptor: BigIntStats,
    logical: BigIntStats,
    capability: BigIntStats,
    inspectedKey: string,
  ): void {
    if (
      !descriptor.isFile() ||
      descriptor.nlink !== 1n ||
      !logical.isFile() ||
      logical.isSymbolicLink() ||
      logical.nlink !== 1n ||
      !capability.isFile() ||
      capability.isSymbolicLink() ||
      capability.nlink !== 1n ||
      !sameBigintIdentity(file.identity, descriptor) ||
      !sameBigintIdentity(file.identity, logical) ||
      !sameBigintIdentity(file.identity, capability) ||
      inspectedKey !== bigintIdentityKey(file.identity)
    ) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'retained remote domain file identity changed');
    }
  }

  private async verifyRetainedIdentity(file: RetainedStateFile): Promise<void> {
    try {
      const [descriptor, logical, capability, inspected] = await Promise.all([
        file.handle.stat({ bigint: true }),
        lstat(file.logicalPath, { bigint: true }),
        lstat(file.authorityPath, { bigint: true }),
        this.permissions.inspectSecure(file.logicalPath),
      ]);
      if (!inspected.file) {
        throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'retained remote domain path is not a file');
      }
      this.assertRetainedIdentity(file, descriptor, logical, capability, inspected.key);
      const [descriptorAfter, logicalAfter, capabilityAfter] = await Promise.all([
        file.handle.stat({ bigint: true }),
        lstat(file.logicalPath, { bigint: true }),
        lstat(file.authorityPath, { bigint: true }),
      ]);
      this.assertRetainedIdentity(
        file,
        descriptorAfter,
        logicalAfter,
        capabilityAfter,
        inspected.key,
      );
    } catch (cause) {
      if (cause instanceof RemoteDomainConfigError) throw cause;
      throw fail(
        'REMOTE_DOMAIN_CONFIG_INVALID',
        'retained remote domain path cannot be verified',
        cause,
      );
    }
  }

  private async readRetainedBytes(file: RetainedStateFile): Promise<Buffer> {
    const metadata = await file.handle.stat({ bigint: true });
    if (
      !metadata.isFile() ||
      metadata.size < 0n ||
      metadata.size > BigInt(MAX_PERSISTED_BYTES) ||
      metadata.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'retained remote domain file is oversized');
    }
    const expected = Number(metadata.size);
    const bytes = Buffer.alloc(expected);
    let offset = 0;
    while (offset < expected) {
      // eslint-disable-next-line no-await-in-loop -- descriptor identity stays retained and bounded
      const observed = await file.handle.read(bytes, offset, expected - offset, offset);
      if (observed.bytesRead === 0) {
        throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'retained remote domain file was truncated');
      }
      offset += observed.bytesRead;
    }
    const overflow = Buffer.alloc(1);
    const tail = await file.handle.read(overflow, 0, 1, expected);
    if (tail.bytesRead !== 0) {
      throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'retained remote domain file grew while read');
    }
    await this.verifyRetainedIdentity(file);
    return bytes;
  }

  private async retainExisting(
    logicalPath: string,
    authorityPath: string,
  ): Promise<RetainedStateFile> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(authorityPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const identity = await handle.stat({ bigint: true });
      const retained = { logicalPath, authorityPath, handle, identity };
      await this.verifyRetainedIdentity(retained);
      return retained;
    } catch (cause) {
      let closeFailure: unknown;
      try {
        await handle?.close();
      } catch (error) {
        closeFailure = error;
      }
      if (closeFailure !== undefined) {
        throw Object.assign(
          new AggregateError(
            [cause, closeFailure],
            'retaining remote domain file and closing its failed descriptor both failed',
          ),
          { code: 'REMOTE_DOMAIN_CONFIG_INVALID' },
        );
      }
      if (cause instanceof RemoteDomainConfigError) throw cause;
      throw fail(
        'REMOTE_DOMAIN_CONFIG_INVALID',
        'remote domain file cannot be retained without following links',
        cause,
      );
    }
  }

  private async retainedPathStillOwned(file: RetainedStateFile): Promise<boolean> {
    try {
      const [descriptor, logical, capability] = await Promise.all([
        file.handle.stat({ bigint: true }),
        lstat(file.logicalPath, { bigint: true }),
        lstat(file.authorityPath, { bigint: true }),
      ]);
      return (
        descriptor.isFile() &&
        descriptor.nlink === 1n &&
        logical.isFile() &&
        !logical.isSymbolicLink() &&
        logical.nlink === 1n &&
        capability.isFile() &&
        !capability.isSymbolicLink() &&
        capability.nlink === 1n &&
        sameBigintIdentity(file.identity, descriptor) &&
        sameBigintIdentity(file.identity, logical) &&
        sameBigintIdentity(file.identity, capability)
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw cause;
    }
  }

  private async unlinkRetainedIfStillOwned(
    paths: SecurePaths,
    file: RetainedStateFile,
  ): Promise<void> {
    await paths.authority.verify();
    if (!(await this.retainedPathStillOwned(file))) {
      throw fail(
        'REMOTE_DOMAIN_CONFIG_INVALID',
        'foreign replacement occupies remote domain temporary path; both files were retained',
      );
    }
    await paths.authority.verify();
    if (!(await this.retainedPathStillOwned(file))) {
      throw fail(
        'REMOTE_DOMAIN_CONFIG_INVALID',
        'remote domain temporary identity changed before cleanup; it was retained',
      );
    }
    await unlink(file.authorityPath);
    await fsyncDirectory(paths.authority.path);
  }

  private async readCurrent(paths: SecurePaths): Promise<RemoteDomainStateEnvelope> {
    const bytes = await this.secureRead(
      paths.logicalConfig,
      paths.authority.child(CONFIG_FILENAME),
      true,
    );
    return bytes === null ? emptyState() : parseState(bytes);
  }

  private async preparedCandidates(paths: SecurePaths): Promise<string[]> {
    const candidates: string[] = [];
    let inspected = 0;
    const directory = await opendir(paths.authority.path);
    try {
      for await (const entry of directory) {
        inspected += 1;
        if (inspected > REMOTE_DOMAIN_LIMITS.maxScanEntries) {
          throw fail(
            'REMOTE_DOMAIN_CONFIG_INVALID',
            'remote domain recovery scan bound is exhausted',
          );
        }
        if (!entry.name.startsWith(TEMPORARY_PREFIX) || !entry.name.endsWith('.sfp-tmp')) {
          continue;
        }
        if (TEMPORARY_PATTERN.exec(entry.name) === null) {
          throw fail(
            'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS',
            'remote domain temporary namespace is ambiguous',
          );
        }
        candidates.push(entry.name);
        if (candidates.length > REMOTE_DOMAIN_LIMITS.maxTemporaryCandidates) {
          throw fail(
            'REMOTE_DOMAIN_TEMP_LIMIT_EXCEEDED',
            'remote domain temporary capacity is exceeded',
          );
        }
      }
    } finally {
      await directory.close().catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== 'ERR_DIR_CLOSED') throw cause;
      });
    }
    return candidates.toSorted(byteCompare);
  }

  private async recoverUnlocked(paths: SecurePaths): Promise<RemoteDomainStateEnvelope> {
    const current = await this.readCurrent(paths);
    const candidates = await this.preparedCandidates(paths);
    if (candidates.length === 0) return current;
    if (candidates.length !== 1) {
      throw fail(
        'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS',
        'multiple remote domain generations are prepared',
      );
    }
    const name = candidates[0] as string;
    const match = TEMPORARY_PATTERN.exec(name) as RegExpExecArray;
    const logicalTemporary = join(paths.logicalDirectory, name);
    const authorityTemporary = paths.authority.child(name);
    let retained: RetainedStateFile | undefined;
    let recovered: RemoteDomainStateEnvelope | undefined;
    let failure: unknown;
    let renamed = false;
    try {
      retained = await this.retainExisting(logicalTemporary, authorityTemporary);
      const bytes = await this.readRetainedBytes(retained);
      if (digest64(bytes) !== match[1]) {
        throw fail(
          'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS',
          'prepared remote domain generation digest is invalid',
        );
      }
      let prepared: RemoteDomainStateEnvelope;
      try {
        prepared = parseState(bytes);
      } catch (cause) {
        throw fail(
          'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS',
          'prepared remote domain generation is invalid',
          cause,
        );
      }
      if (!isUniqueSuccessor(current, prepared)) {
        throw fail(
          'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS',
          'prepared remote domain generation has no unique predecessor',
        );
      }
      await this.hooks.afterRecoveryTemporaryRead?.(logicalTemporary);
      await this.verifyRetainedIdentity(retained);
      await this.assertCurrent(paths, current);
      await this.verifyRetainedIdentity(retained);
      await paths.authority.verify();
      await this.verifyRetainedIdentity(retained);
      if (digest64(await this.readRetainedBytes(retained)) !== match[1]) {
        throw fail(
          'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS',
          'prepared remote domain generation changed before publication',
        );
      }
      await rename(authorityTemporary, paths.authority.child(CONFIG_FILENAME));
      renamed = true;
      const published = {
        ...retained,
        logicalPath: paths.logicalConfig,
        authorityPath: paths.authority.child(CONFIG_FILENAME),
      };
      await this.verifyRetainedIdentity(published);
      await fsyncDirectory(paths.authority.path);
      await this.verifyRetainedIdentity(published);
      const observed = await this.readCurrent(paths);
      await this.verifyRetainedIdentity(published);
      if (observed.checksum !== prepared.checksum) {
        throw fail(
          'REMOTE_DOMAIN_CONFIG_INVALID',
          'recovered remote domain generation changed after publish',
        );
      }
      recovered = observed;
    } catch (cause) {
      failure = cause;
    }
    let closeFailure: unknown;
    try {
      await retained?.handle.close();
    } catch (cause) {
      closeFailure = cause;
    }
    if (closeFailure !== undefined) {
      const combined = new AggregateError(
        [...(failure === undefined ? [] : [failure]), closeFailure],
        'remote domain recovery or retained descriptor release failed',
      );
      if (renamed) throw new RemoteDomainCommitOutcomeUnknownError(true, combined);
      throw Object.assign(combined, { code: 'REMOTE_DOMAIN_CONFIG_INVALID' });
    }
    if (failure !== undefined) {
      if (renamed) throw new RemoteDomainCommitOutcomeUnknownError(true, failure);
      throw failure;
    }
    return recovered as RemoteDomainStateEnvelope;
  }

  private async assertCurrent(
    paths: SecurePaths,
    expected: RemoteDomainStateEnvelope,
  ): Promise<void> {
    const observed = await this.readCurrent(paths);
    if (observed.generation !== expected.generation || observed.checksum !== expected.checksum) {
      throw fail('REMOTE_DOMAIN_CAS_MISMATCH', 'remote domain state changed during mutation');
    }
  }

  private async commit(
    paths: SecurePaths,
    expected: RemoteDomainStateEnvelope,
    next: RemoteDomainStatePayload,
    bytes: Buffer,
    token: string,
  ): Promise<void> {
    const checksum = checksumFor(next);
    const temporaryName = `${TEMPORARY_PREFIX}${digest64(bytes)}.${token}.sfp-tmp`;
    const logicalTemporary = join(paths.logicalDirectory, temporaryName);
    const authorityTemporary = paths.authority.child(temporaryName);
    let openedHandle: FileHandle | undefined;
    let retained: RetainedStateFile | undefined;
    let created = false;
    let prepared = false;
    let renamed = false;
    let failure: unknown;
    try {
      const handle = await open(
        authorityTemporary,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      openedHandle = handle;
      created = true;
      retained = {
        logicalPath: logicalTemporary,
        authorityPath: authorityTemporary,
        handle,
        identity: await handle.stat({ bigint: true }),
      };
      await handle.writeFile(bytes);
      await handle.sync();
      await this.verifyRetainedIdentity(retained);
      if (digest64(await this.readRetainedBytes(retained)) !== digest64(bytes)) {
        throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'prepared remote domain generation changed');
      }
      prepared = true;
      await this.hooks.afterTemporaryFsync?.(logicalTemporary);
      await this.verifyRetainedIdentity(retained);
      await this.assertCurrent(paths, expected);
      await this.verifyRetainedIdentity(retained);
      await paths.authority.verify();
      await this.verifyRetainedIdentity(retained);
      if (digest64(await this.readRetainedBytes(retained)) !== digest64(bytes)) {
        throw fail(
          'REMOTE_DOMAIN_CONFIG_INVALID',
          'prepared remote domain generation changed immediately before publication',
        );
      }
      await rename(authorityTemporary, paths.authority.child(CONFIG_FILENAME));
      renamed = true;
      const published = {
        ...retained,
        logicalPath: paths.logicalConfig,
        authorityPath: paths.authority.child(CONFIG_FILENAME),
      };
      await this.verifyRetainedIdentity(published);
      await this.hooks.afterRenameBeforeDirectoryFsync?.(paths.logicalConfig);
      await this.verifyRetainedIdentity(published);
      await fsyncDirectory(paths.authority.path);
      await this.verifyRetainedIdentity(published);
      await this.hooks.afterDirectoryFsync?.(paths.logicalConfig);
      await this.verifyRetainedIdentity(published);
      const observed = await this.readCurrent(paths);
      await this.verifyRetainedIdentity(published);
      if (observed.checksum !== checksum) {
        throw fail('REMOTE_DOMAIN_CONFIG_INVALID', 'committed remote domain generation changed');
      }
    } catch (cause) {
      if (prepared || renamed) {
        let committed = false;
        try {
          committed = (await this.readCurrent(paths)).checksum === checksum;
        } catch {
          committed = false;
        }
        failure = new RemoteDomainCommitOutcomeUnknownError(committed, cause);
      } else {
        failure = cause;
      }
    }
    const cleanupFailures: unknown[] = [];
    if (created && !prepared && !renamed && retained !== undefined) {
      try {
        await this.hooks.beforeOwnedTemporaryCleanup?.(logicalTemporary);
      } catch (cause) {
        cleanupFailures.push(cause);
      }
      try {
        await this.unlinkRetainedIfStillOwned(paths, retained);
      } catch (cause) {
        cleanupFailures.push(cause);
      }
    }
    try {
      await (retained?.handle ?? openedHandle)?.close();
    } catch (cause) {
      cleanupFailures.push(cause);
    }
    if (cleanupFailures.length > 0) {
      const combined = new AggregateError(
        [...(failure === undefined ? [] : [failure]), ...cleanupFailures],
        'remote domain transaction or retained temporary cleanup failed',
      );
      if (failure instanceof RemoteDomainCommitOutcomeUnknownError) {
        throw new RemoteDomainCommitOutcomeUnknownError(failure.committed, combined);
      }
      const code =
        typeof failure === 'object' &&
        failure !== null &&
        'code' in failure &&
        typeof failure.code === 'string'
          ? failure.code
          : 'REMOTE_DOMAIN_CONFIG_INVALID';
      throw Object.assign(combined, { code });
    }
    if (failure !== undefined) throw failure;
  }
}
