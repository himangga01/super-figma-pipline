/* eslint-disable no-await-in-loop -- durable claims and effect evidence have strict persistence order */
import { randomUUID } from 'node:crypto';
import { mkdir, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { contentHash } from '@sfp/ir';
import { z } from 'zod';

import { withRetainedDirectoryChain } from '../fs/atomic-file.js';
import {
  createStatePermissions,
  type BoundStatePermissions,
} from '../security/state-permissions.js';
import {
  directoryIdentity,
  observeSqlite,
  NativeEnvironmentExecutionSchema,
  type NativeEnvironmentExecution,
  type NativeEnvironmentAuthority,
} from './native-resources.js';
import { PortalStore, portalError } from './store.js';

const ProcessSchema = z
  .object({
    commandId: z.string().min(1).max(64),
    token: z.string().min(1).max(64),
    pid: z.number().int().positive().nullable(),
    birth: z.string().max(128).nullable(),
    executableHash: z.string(),
    brokerExecutableHash: z.string(),
    state: z.enum(['intent', 'permitted', 'stopped']),
    proof: z.string().nullable(),
  })
  .strict();
export const NativeAttemptSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    executionClosed: z.boolean(),
    cleanupClaim: z.string().nullable(),
    version: z.literal(1),
    leaderGeneration: z.string(),
    parentPid: z.number().int().positive(),
    execution: NativeEnvironmentExecutionSchema,
    state: z.enum([
      'acquiring',
      'creating',
      'ready',
      'running',
      'cleanup',
      'released',
      'quarantined',
    ]),
    directoryIdentity: z.string().nullable(),
    children: z.array(z.object({ path: z.string(), identity: z.string() }).strict()).max(4),
    processes: z.array(ProcessSchema).max(32),
    claimed: z.array(z.string()).max(64),
    reason: z.string().max(128).nullable(),
    disposition: z.literal('retained-artifact'),
    createdAt: z.number().int(),
    completedAt: z.number().int().nullable(),
  })
  .strict();
export type NativeAttempt = z.infer<typeof NativeAttemptSchema>;
const ClaimSchema = z
  .object({
    version: z.literal(1),
    key: z.string(),
    attemptId: z.string(),
    state: z.enum(['held', 'released', 'quarantined']),
  })
  .strict();
const IndexSchema = z
  .object({ version: z.literal(1), attempts: z.array(z.string()).max(128) })
  .strict();
const claimId = (key: string) => contentHash('sfp-native-resource-record-v1', key).slice(7);
export class NativeEnvironmentLifecycle {
  private reservationTail: Promise<unknown> = Promise.resolve();
  private readonly permissions: BoundStatePermissions;
  constructor(
    private readonly store: PortalStore,
    private readonly stateRoot: string,
    permissions?: BoundStatePermissions,
    private readonly leaderGeneration: string = randomUUID(),
  ) {
    this.permissions = permissions ?? createStatePermissions(stateRoot);
  }
  async inspect(attemptId: string, ownerId: string): Promise<NativeAttempt> {
    const record = await this.store.get('environment-attempts', attemptId, NativeAttemptSchema);
    if (!record || record.execution.ownerId !== ownerId)
      throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_NOT_FOUND');
    return record;
  }
  private update(
    id: string,
    change: (record: NativeAttempt) => NativeAttempt | Promise<NativeAttempt>,
  ) {
    return this.store.update('environment-attempts', id, NativeAttemptSchema, async value => {
      const revision = value.revision;
      const next = await change(value);
      return { ...next, revision: revision + 1 };
    });
  }
  async acquire(
    execution: NativeEnvironmentExecution,
    grant: NativeEnvironmentAuthority,
    signal: AbortSignal,
  ): Promise<NativeAttempt> {
    signal.throwIfAborted();
    const { hash, ...context } = NativeEnvironmentExecutionSchema.parse(execution);
    if (hash !== contentHash('sfp-native-execution-authority-v1', context))
      throw portalError('PORTAL_ENVIRONMENT_ADMISSION_CHANGED');
    if (execution.directory !== join(this.stateRoot, `portal-attempt-${execution.attemptId}`))
      throw portalError('PORTAL_ENVIRONMENT_ADMISSION_CHANGED');
    if (await this.store.get('environment-attempts', execution.attemptId, NativeAttemptSchema))
      throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_REPLAY');
    if (
      execution.grantHash !== contentHash('sfp-native-environment-grant-v1', grant) ||
      execution.ownerId !== grant.ownerId ||
      grant.namespaceIdentity !== (await directoryIdentity(this.stateRoot))
    )
      throw portalError('PORTAL_ENVIRONMENT_GRANT_CHANGED');
    // The bounded signed index is an admission ceiling, not a collector. No old attempt is dropped.
    const reservation = this.reservationTail
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        const index = await this.store.get('environment-index', 'retained', IndexSchema);
        await this.checkRetention(index?.attempts ?? []);
        if (!index)
          await this.store.create(
            'environment-index',
            'retained',
            { version: 1, attempts: [execution.attemptId] },
            IndexSchema,
          );
        else
          await this.store.update('environment-index', 'retained', IndexSchema, value => {
            if (value.attempts.length >= 128)
              throw portalError('PORTAL_ENVIRONMENT_RETENTION_CAPACITY');
            value.attempts.push(execution.attemptId);
            return value;
          });
        return undefined;
      });
    this.reservationTail = reservation;
    await reservation;
    const record: NativeAttempt = {
      revision: 0,
      executionClosed: false,
      cleanupClaim: null,
      version: 1,
      leaderGeneration: this.leaderGeneration,
      parentPid: process.pid,
      execution,
      state: 'acquiring',
      directoryIdentity: null,
      children: [],
      processes: [],
      claimed: [],
      reason: null,
      disposition: 'retained-artifact',
      createdAt: Date.now(),
      completedAt: null,
    };
    await this.store.create(
      'environment-attempts',
      execution.attemptId,
      record,
      NativeAttemptSchema,
    );
    try {
      // Only environmental resources have durable exclusive ownership. Repository/process lanes
      // remain execution-plane coordination; unknown environment claims survive every restart.
      for (const resource of execution.resources
        .filter(
          value =>
            value.key.startsWith('portal:sqlite:') || value.key.startsWith('portal:owned-sqlite:'),
        )
        .toSorted((a, b) => a.key.localeCompare(b.key))) {
        signal.throwIfAborted();
        const id = claimId(resource.key),
          claim = await this.store.get('environment-resources', id, ClaimSchema);
        if (!claim)
          await this.store.create(
            'environment-resources',
            id,
            { version: 1, key: resource.key, attemptId: execution.attemptId, state: 'held' },
            ClaimSchema,
          );
        else
          await this.store.update('environment-resources', id, ClaimSchema, value => {
            if (value.key !== resource.key || value.state !== 'released')
              throw portalError('PORTAL_ENVIRONMENT_RESOURCE_QUARANTINED');
            return { ...value, attemptId: execution.attemptId, state: 'held' as const };
          });
        await this.update(execution.attemptId, value => {
          value.claimed.push(resource.key);
          return value;
        });
      }
      signal.throwIfAborted();
      await this.update(execution.attemptId, value => ({ ...value, state: 'creating' }));
      await withRetainedDirectoryChain(this.stateRoot, this.stateRoot, async () => {
        if ((await directoryIdentity(this.stateRoot)) !== grant.namespaceIdentity)
          throw portalError('PORTAL_ENVIRONMENT_GRANT_CHANGED');
        await mkdir(execution.directory, { mode: 0o700 });
        await this.permissions.ensureSecure(execution.directory);
        const identity = await directoryIdentity(execution.directory);
        await this.update(execution.attemptId, value => ({
          ...value,
          directoryIdentity: identity,
        }));
        // Provision real SQLite databases, not a successful environment label.
        for (const { declaration, shared } of grant.grants)
          if (!shared) {
            signal.throwIfAborted();
            const path = execution.environment[declaration.binding]!;
            const present = await lstat(path).catch(error => {
              if (error.code === 'ENOENT') return null;
              throw error;
            });
            if (present) throw portalError('PORTAL_ENVIRONMENT_DATABASE_ALREADY_EXISTS');
            const database = new DatabaseSync(path);
            try {
              database.exec('PRAGMA user_version = 0');
            } finally {
              database.close();
            }
          }
      });
      return await this.update(execution.attemptId, value => ({ ...value, state: 'ready' }));
    } catch (error) {
      // Intent gaps and partial claim CAS outcomes remain conservative and inspectable.
      const current = await this.store
        .get('environment-attempts', execution.attemptId, NativeAttemptSchema)
        .catch(() => null);
      if (current?.state === 'acquiring')
        await this.releaseUnstarted(current).catch(async () =>
          this.quarantine(execution.attemptId, 'PORTAL_ENVIRONMENT_ACQUISITION_INTERRUPTED').catch(
            () => {},
          ),
        );
      else
        await this.quarantine(
          execution.attemptId,
          'PORTAL_ENVIRONMENT_ACQUISITION_INTERRUPTED',
        ).catch(() => {});
      throw error;
    }
  }
  private async releaseUnstarted(record: NativeAttempt): Promise<void> {
    if (record.state !== 'acquiring' || record.directoryIdentity || record.processes.length)
      throw portalError('PORTAL_NATIVE_CLEANUP_UNKNOWN');
    for (const resource of record.execution.resources.filter(
      value =>
        value.key.startsWith('portal:sqlite:') || value.key.startsWith('portal:owned-sqlite:'),
    )) {
      const id = claimId(resource.key),
        claim = await this.store.get('environment-resources', id, ClaimSchema);
      if (claim?.attemptId !== record.execution.attemptId) continue;
      await this.store.update('environment-resources', id, ClaimSchema, value => {
        if (value.attemptId !== record.execution.attemptId)
          throw portalError('PORTAL_ENVIRONMENT_CLAIM_CHANGED');
        return { ...value, state: 'released' as const };
      });
    }
    await this.update(record.execution.attemptId, value => ({
      ...value,
      state: 'released',
      executionClosed: true,
      completedAt: Date.now(),
      reason: 'no-effects-started',
    }));
  }

  private async checkRetention(attemptIds: string[]): Promise<void> {
    let entries = 0,
      bytes = 0n;
    const walk = async (path: string): Promise<void> => {
      if (++entries > 200000) throw portalError('PORTAL_ENVIRONMENT_RETENTION_CAPACITY');
      const stat = await lstat(path, { bigint: true });
      if (stat.isSymbolicLink()) {
        bytes += stat.size;
        return;
      }
      if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > 8589934592n) throw portalError('PORTAL_ENVIRONMENT_RETENTION_CAPACITY');
        return;
      }
      if (!stat.isDirectory())
        throw portalError('PORTAL_ENVIRONMENT_RETENTION_RECONCILIATION_REQUIRED');
      for (const name of await readdir(path)) await walk(join(path, name));
    };
    for (const id of attemptIds) {
      const record = await this.store.get('environment-attempts', id, NativeAttemptSchema);
      // A reservation can precede its attempt record. It still consumes count capacity.
      if (!record) continue;
      const present = await lstat(record.execution.directory).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!present) continue;
      if (
        !record.directoryIdentity ||
        (await directoryIdentity(record.execution.directory)) !== record.directoryIdentity
      )
        throw portalError('PORTAL_ENVIRONMENT_RETENTION_RECONCILIATION_REQUIRED');
      await walk(record.execution.directory);
    }
  }

  async ownedChild(attemptId: string, name: 'work' | 'home'): Promise<string> {
    const record = await this.store.get('environment-attempts', attemptId, NativeAttemptSchema);
    if (!record || record.state !== 'ready' || !record.directoryIdentity)
      throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_STATE');
    await this.verifyDirectories(record);
    const path = join(record.execution.directory, name);
    // Pending creation remains quarantinable before the child exists.
    const creating = await this.update(attemptId, value => {
      if (value.revision !== record.revision || value.state !== 'ready' || value.executionClosed)
        throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_CHANGED');
      return { ...value, state: 'creating' };
    });
    await mkdir(path, { mode: 0o700 });
    await this.permissions.ensureSecure(path);
    const identity = await directoryIdentity(path);
    await this.update(attemptId, value => {
      if (
        value.revision !== creating.revision ||
        value.state !== 'creating' ||
        value.executionClosed
      )
        throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_CHANGED');
      return { ...value, state: 'ready', children: [...value.children, { path, identity }] };
    });
    return path;
  }
  async beforeLaunch(
    attemptId: string,
    commandId: string,
    token: string,
    executableHash: string,
  ): Promise<void> {
    const record = await this.store.get('environment-attempts', attemptId, NativeAttemptSchema);
    if (
      !record ||
      !['ready', 'running'].includes(record.state) ||
      record.processes.some(p => p.state !== 'stopped')
    )
      throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_STATE');
    await this.verifyDirectories(record);
    await this.update(attemptId, value => {
      if (
        value.revision !== record.revision ||
        !['ready', 'running'].includes(value.state) ||
        value.executionClosed ||
        value.processes.some(p => p.state !== 'stopped')
      )
        throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_CHANGED');
      return {
        ...value,
        state: 'running',
        processes: [
          ...value.processes,
          {
            commandId,
            token,
            pid: null,
            birth: null,
            executableHash,
            brokerExecutableHash: value.execution.broker.hash,
            state: 'intent',
            proof: null,
          },
        ],
      };
    });
  }
  async permit(attemptId: string, token: string, pid: number, birth: string): Promise<void> {
    await this.update(attemptId, value => {
      const process = value.processes.find(p => p.token === token);
      if (
        value.state !== 'running' ||
        value.executionClosed ||
        !process ||
        process.state !== 'intent' ||
        !birth
      )
        throw portalError('PORTAL_ENVIRONMENT_PROCESS_PROOF_REQUIRED');
      process.pid = pid;
      process.birth = birth;
      process.state = 'permitted';
      return value;
    });
  }
  async stopped(attemptId: string, token: string, pid: number, birth: string): Promise<void> {
    await this.update(attemptId, value => {
      const process = value.processes.find(p => p.token === token);
      if (
        !process ||
        process.pid !== pid ||
        process.birth !== birth ||
        process.state !== 'permitted'
      )
        throw portalError('PORTAL_ENVIRONMENT_PROCESS_PROOF_REQUIRED');
      process.state = 'stopped';
      process.proof = 'windows-owned-job-active-members-one-v1';
      return value;
    });
  }
  private async verifyDirectories(record: NativeAttempt): Promise<void> {
    if (
      !record.directoryIdentity ||
      (await directoryIdentity(record.execution.directory)) !== record.directoryIdentity
    )
      throw portalError('PORTAL_ENVIRONMENT_DIRECTORY_CHANGED');
    for (const saved of record.execution.observations) {
      const current = await observeSqlite(saved.path);
      if (
        current.key !== saved.key ||
        current.parentIdentity !== saved.parentIdentity ||
        (saved.fileIdentity !== null && current.fileIdentity !== saved.fileIdentity)
      )
        throw portalError('PORTAL_ENVIRONMENT_RESOURCE_CHANGED');
    }
    for (const child of record.children)
      if ((await directoryIdentity(child.path)) !== child.identity)
        throw portalError('PORTAL_ENVIRONMENT_DIRECTORY_CHANGED');
  }
  async quarantine(
    attemptId: string,
    reason: string,
    expected?: { cleanupClaim?: string; revision?: number },
  ): Promise<void> {
    const record = await this.update(attemptId, value => {
      if (
        (expected?.cleanupClaim !== undefined && value.cleanupClaim !== expected.cleanupClaim) ||
        (expected?.revision !== undefined && value.revision !== expected.revision)
      )
        throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_CHANGED');
      return { ...value, state: 'quarantined', executionClosed: true, reason };
    });
    for (const key of record.claimed)
      await this.store.update('environment-resources', claimId(key), ClaimSchema, value => {
        if (value.attemptId !== attemptId) throw portalError('PORTAL_ENVIRONMENT_CLAIM_CHANGED');
        return { ...value, state: 'quarantined' as const };
      });
  }
  async finish(
    attemptId: string,
    inspected?: { revision: number; hash: string },
  ): Promise<NativeAttempt> {
    let claimed = false;
    let ownedClaim: string | undefined, observedRevision: number | undefined;
    try {
      const snapshot = await this.store.get('environment-attempts', attemptId, NativeAttemptSchema);
      if (!snapshot) throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_STATE');
      observedRevision = snapshot.revision;
      if (
        inspected &&
        (snapshot.revision !== inspected.revision ||
          contentHash('sfp-native-lifecycle-receipt-v1', snapshot) !== inspected.hash)
      )
        throw portalError('PORTAL_ENVIRONMENT_INSPECTION_CHANGED');
      if (snapshot.state === 'released' && snapshot.executionClosed) {
        if (snapshot.processes.some(p => p.state !== 'stopped'))
          throw portalError('PORTAL_NATIVE_CLEANUP_UNKNOWN');
        await this.verifyDirectories(snapshot);
        const current = await this.store.get(
          'environment-attempts',
          attemptId,
          NativeAttemptSchema,
        );
        if (current?.revision !== snapshot.revision)
          throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_CHANGED');
        for (const key of snapshot.claimed) {
          const id = claimId(key),
            claim = await this.store.get('environment-resources', id, ClaimSchema);
          if (claim?.attemptId === attemptId && claim.state !== 'released')
            await this.store.update('environment-resources', id, ClaimSchema, value => {
              if (value.attemptId !== attemptId)
                throw portalError('PORTAL_ENVIRONMENT_CLAIM_CHANGED');
              return { ...value, state: 'released' as const };
            });
        }
        return snapshot;
      }
      if (snapshot.processes.some(p => p.state !== 'stopped'))
        throw portalError('PORTAL_NATIVE_CLEANUP_UNKNOWN');
      if (!['ready', 'running', 'cleanup', 'quarantined', 'released'].includes(snapshot.state))
        throw portalError('PORTAL_NATIVE_CLEANUP_UNKNOWN');
      // Persist an irreversible launch fence before asynchronous filesystem observations. The
      // current revision and stop predicates are checked inside the real store CAS.
      const claim = randomUUID();
      let record = await this.update(attemptId, value => {
        if (
          value.revision !== snapshot.revision ||
          value.processes.some(p => p.state !== 'stopped') ||
          !['ready', 'running', 'cleanup', 'quarantined', 'released'].includes(value.state)
        )
          throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_CHANGED');
        return { ...value, state: 'cleanup', executionClosed: true, cleanupClaim: claim };
      });
      claimed = true;
      ownedClaim = claim;
      await this.verifyDirectories(record);
      const claimedRevision = record.revision;
      record = await this.update(attemptId, value => {
        if (
          value.revision !== claimedRevision ||
          value.state !== 'cleanup' ||
          !value.executionClosed ||
          value.cleanupClaim !== claim ||
          value.processes.some(p => p.state !== 'stopped')
        )
          throw portalError('PORTAL_ENVIRONMENT_ATTEMPT_CHANGED');
        return {
          ...value,
          state: 'released',
          completedAt: value.completedAt ?? Date.now(),
          reason: null,
        };
      });
      for (const key of record.claimed) {
        const id = claimId(key),
          current = await this.store.get('environment-resources', id, ClaimSchema);
        if (current?.attemptId !== attemptId) {
          if (snapshot.state === 'released') continue;
          throw portalError('PORTAL_ENVIRONMENT_CLAIM_CHANGED');
        }
        if (current.state === 'released') continue;
        await this.store.update('environment-resources', id, ClaimSchema, value => {
          if (value.attemptId !== attemptId) throw portalError('PORTAL_ENVIRONMENT_CLAIM_CHANGED');
          return { ...value, state: 'released' as const };
        });
      }
      return record;
    } catch (error) {
      // A stale finisher must not overwrite the legitimate winning launch/cleanup transition.
      const code = (error as { code?: string }).code;
      if (claimed || code === 'PORTAL_NATIVE_CLEANUP_UNKNOWN')
        await this.quarantine(
          attemptId,
          'PORTAL_NATIVE_CLEANUP_UNKNOWN',
          ownedClaim !== undefined
            ? { cleanupClaim: ownedClaim }
            : observedRevision !== undefined
              ? { revision: observedRevision }
              : undefined,
        ).catch(() => {});
      throw error;
    }
  }
  async reconcile(
    attemptId: string,
    ownerId: string,
    expectedHash: string,
  ): Promise<NativeAttempt> {
    const record = await this.inspect(attemptId, ownerId);
    if (contentHash('sfp-native-lifecycle-receipt-v1', record) !== expectedHash)
      throw portalError('PORTAL_ENVIRONMENT_INSPECTION_CHANGED');
    if (!record.executionClosed || !['cleanup', 'quarantined', 'released'].includes(record.state))
      throw portalError('PORTAL_ENVIRONMENT_EXECUTION_ACTIVE');
    if (record.processes.some(p => p.state !== 'stopped'))
      throw portalError('PORTAL_ENVIRONMENT_MANUAL_RECONCILIATION_REQUIRED');
    return this.finish(attemptId, { revision: record.revision, hash: expectedHash });
  }
  async verifyReceipt(attemptId: string, ownerId: string, hash: string): Promise<NativeAttempt> {
    const record = await this.inspect(attemptId, ownerId);
    if (
      record.state !== 'released' ||
      contentHash('sfp-native-lifecycle-receipt-v1', record) !== hash
    )
      throw portalError('PORTAL_ENVIRONMENT_RECEIPT_REQUIRED');
    await this.verifyDirectories(record);
    for (const key of record.claimed) {
      const claim = await this.store.get('environment-resources', claimId(key), ClaimSchema);
      if (!claim || (claim.attemptId === attemptId && claim.state !== 'released'))
        throw portalError('PORTAL_ENVIRONMENT_RECEIPT_REQUIRED');
    }
    return record;
  }
}
