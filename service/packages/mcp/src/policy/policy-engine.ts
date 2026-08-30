import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { chmod, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';

import {
  ALL_DATA_CLASSES,
  DEFAULT_EGRESS_CONFIGURATION,
  EgressPolicyError,
  parseEgressConfiguration,
  type ApprovalRequirement,
  type ConcurrencyRequirement,
  type ConsentContext,
  type DataClass,
  type Effect,
  type EgressConfiguration,
  type EgressConfigStore,
  type EgressSource,
  type IdempotencyRequirement,
  type PolicyInvocationContext,
  type OperationPolicy,
} from '@sfp/shared';

import type { BoundStatePermissions } from '../security/state-permissions.js';
import { operationPolicyFor } from './operation-policy.js';

export type PolicyEvaluationErrorCode = 'POLICY_WORKSPACE_REQUIRED';

export class PolicyEvaluationError extends Error {
  readonly code: PolicyEvaluationErrorCode;

  constructor(code: PolicyEvaluationErrorCode, message: string) {
    super(message);
    this.name = 'PolicyEvaluationError';
    this.code = code;
  }
}

export interface EvaluatedOperationPolicy {
  policy: OperationPolicy;
  effects: readonly Effect[];
  approval: ApprovalRequirement;
  idempotency: IdempotencyRequirement;
  concurrency: ConcurrencyRequirement;
}

/** Resolve pure policy metadata before any approval, queue, filesystem, network, or Figma runtime. */
export const evaluateOperationPolicy = (
  toolName: string,
  parsedArgs: Readonly<Record<string, unknown>>,
  context: PolicyInvocationContext,
): EvaluatedOperationPolicy => {
  const operationPolicy = operationPolicyFor(toolName);
  const effects = operationPolicy.effectsFor(parsedArgs, context);
  if (
    effects.some(
      effect => effect.type === 'filesystem-read' || effect.type === 'filesystem-write',
    ) &&
    (context.workspace.workspaceId === null || context.workspace.workspaceRoot === null)
  ) {
    throw new PolicyEvaluationError(
      'POLICY_WORKSPACE_REQUIRED',
      'filesystem effects require an explicitly configured workspace',
    );
  }
  return Object.freeze({
    policy: operationPolicy,
    effects,
    approval: operationPolicy.approvalFor(effects, context),
    idempotency: operationPolicy.idempotencyFor(parsedArgs),
    concurrency: operationPolicy.concurrency,
  });
};

export interface EgressAuthorizationRequest {
  source: EgressSource;
  inputClasses: readonly DataClass[];
  possibleResultClasses: readonly DataClass[];
  now?: number;
}

const canonicalClasses = (classes: readonly DataClass[]): readonly DataClass[] =>
  Object.freeze(ALL_DATA_CLASSES.filter(dataClass => classes.includes(dataClass)));

/**
 * Resolve only an explicitly persisted mode. `source:'mcp'` is deliberately not a mode signal.
 * External consent covers input plus the complete possible-result upper bound before runtime.
 */
export const authorizeEgress = (
  configured: EgressConfiguration | undefined,
  request: EgressAuthorizationRequest,
): ConsentContext => {
  void request.source;
  const configuration =
    configured === undefined ? DEFAULT_EGRESS_CONFIGURATION : parseEgressConfiguration(configured);
  if (configuration.mode === 'unknown-fail-closed') {
    throw new EgressPolicyError(
      'EGRESS_MODE_UNKNOWN',
      'model egress mode is not explicitly configured',
    );
  }
  if (configuration.mode === 'local-trusted') {
    return Object.freeze({
      mode: 'local-trusted',
      consentId: null,
      allowedClasses: ALL_DATA_CLASSES,
    });
  }
  if (configuration.consent === null) {
    throw new EgressPolicyError(
      'EGRESS_CONSENT_REQUIRED',
      'external-model mode requires explicit consent',
    );
  }
  const now = request.now ?? Date.now();
  if (configuration.consent.expiresAt <= now) {
    throw new EgressPolicyError('EGRESS_CONSENT_EXPIRED', 'external-model consent has expired');
  }
  const required = canonicalClasses([...request.inputClasses, ...request.possibleResultClasses]);
  const deniedClass = required.find(
    dataClass => !configuration.consent!.allowedClasses.includes(dataClass),
  );
  if (deniedClass !== undefined) {
    throw new EgressPolicyError(
      'EGRESS_CLASS_NOT_ALLOWED',
      `external-model consent does not allow ${deniedClass}`,
      { deniedClass },
    );
  }
  return Object.freeze({
    mode: 'external-model',
    consentId: configuration.consent.consentId,
    allowedClasses: configuration.consent.allowedClasses,
  });
};

const EGRESS_CONFIG_FILENAME = 'egress.v1.json';
const ENVELOPE_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

interface EgressConfigPayload {
  schemaVersion: 1;
  configuration: EgressConfiguration;
}

interface EgressConfigEnvelope extends EgressConfigPayload {
  checksum: string;
}

interface ConfigMutationQueue {
  tail: Promise<void>;
}

const configMutationQueues = new Map<string, ConfigMutationQueue>();

export const egressConfigPath = (stateRoot: string): string =>
  join(resolve(stateRoot), EGRESS_CONFIG_FILENAME);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...expected].toSorted());

const checksumFor = (payload: EgressConfigPayload): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const envelopeFromUnknown = (value: unknown): EgressConfigEnvelope => {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, ['schemaVersion', 'configuration', 'checksum']) ||
    value.schemaVersion !== ENVELOPE_VERSION ||
    typeof value.checksum !== 'string' ||
    !SHA256_PATTERN.test(value.checksum)
  ) {
    throw new EgressPolicyError(
      'EGRESS_CONFIG_INVALID',
      'persisted egress config does not match its closed envelope',
    );
  }
  const configuration = parseEgressConfiguration(value.configuration);
  const payload: EgressConfigPayload = { schemaVersion: ENVELOPE_VERSION, configuration };
  if (checksumFor(payload) !== value.checksum) {
    throw new EgressPolicyError(
      'EGRESS_CONFIG_INVALID',
      'persisted egress config checksum does not match its payload',
    );
  }
  return { ...payload, checksum: value.checksum };
};

const safeStateRoot = (input: string): string => {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new EgressPolicyError('EGRESS_CONFIG_INVALID', 'state root must be a non-empty path');
  }
  const stateRoot = resolve(input);
  if (stateRoot === parse(stateRoot).root) {
    throw new EgressPolicyError(
      'EGRESS_CONFIG_INVALID',
      'egress config cannot use a filesystem root as owner state',
    );
  }
  return stateRoot;
};

const comparable = (path: string): string =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

const identityKey = (metadata: BigIntStats): string =>
  `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`;

/** Persist the explicit selection only under Task 4's bound owner-state authority. */
export const createEgressConfigStore = (
  stateRootInput: string,
  permissions: BoundStatePermissions,
): EgressConfigStore => {
  const requestedStateRoot = safeStateRoot(stateRootInput);
  const stateRoot = safeStateRoot(permissions.stateRoot);
  if (comparable(requestedStateRoot) !== comparable(stateRoot)) {
    throw new EgressPolicyError(
      'EGRESS_CONFIG_INVALID',
      'egress config state root does not match its bound permission authority',
    );
  }
  const configPath = egressConfigPath(stateRoot);

  const ensureStateRoot = async (): Promise<string> => {
    const inspected = await permissions.inspectSecure(stateRoot);
    const requestedCanonical = await realpath(requestedStateRoot).catch(error => {
      throw new EgressPolicyError(
        'EGRESS_CONFIG_INVALID',
        'egress config state root cannot be resolved',
        { cause: error },
      );
    });
    const metadata = await lstat(stateRoot, { bigint: true }).catch(error => {
      throw new EgressPolicyError('EGRESS_CONFIG_INVALID', 'owner state root is unavailable', {
        cause: error,
      });
    });
    if (
      comparable(requestedCanonical) !== comparable(inspected.canonicalPath) ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      identityKey(metadata) !== inspected.key
    ) {
      throw new EgressPolicyError(
        'EGRESS_CONFIG_INVALID',
        'owner state root does not match its secure bound identity',
      );
    }
    return inspected.key;
  };

  const readSecureText = async (): Promise<string | undefined> => {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(configPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new EgressPolicyError(
        'EGRESS_CONFIG_INVALID',
        'egress config cannot be opened without following links',
        { cause: error },
      );
    }
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) {
        throw new EgressPolicyError(
          'EGRESS_CONFIG_INVALID',
          'egress config must be a regular file',
        );
      }
      const inspected = await permissions.inspectSecure(configPath);
      if (!inspected.file || inspected.key !== identityKey(before)) {
        throw new EgressPolicyError(
          'EGRESS_CONFIG_INVALID',
          'egress config pathname does not identify the opened file',
        );
      }
      const raw = await handle.readFile('utf8');
      const after = await handle.stat({ bigint: true });
      if (identityKey(before) !== identityKey(after)) {
        throw new EgressPolicyError(
          'EGRESS_CONFIG_INVALID',
          'egress config identity changed while it was read',
        );
      }
      return raw;
    } finally {
      await handle.close();
    }
  };

  const load = async (): Promise<EgressConfiguration> => {
    await ensureStateRoot();
    const raw = await readSecureText();
    if (raw === undefined) return DEFAULT_EGRESS_CONFIGURATION;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new EgressPolicyError('EGRESS_CONFIG_INVALID', 'egress config is not valid JSON', {
        cause: error,
      });
    }
    return envelopeFromUnknown(value).configuration;
  };

  const write = async (configurationInput: EgressConfiguration): Promise<void> => {
    await ensureStateRoot();
    const configuration = parseEgressConfiguration(configurationInput);
    const payload: EgressConfigPayload = { schemaVersion: ENVELOPE_VERSION, configuration };
    const envelope: EgressConfigEnvelope = { ...payload, checksum: checksumFor(payload) };
    const temporaryPath = join(stateRoot, `.egress.v1.${process.pid}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let renamed = false;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (process.platform !== 'win32') await chmod(temporaryPath, 0o600);
      await permissions.ensureSecure(temporaryPath);
      await permissions.verifySecure(temporaryPath);
      await rename(temporaryPath, configPath);
      renamed = true;
      await permissions.verifySecure(configPath);
      if (process.platform !== 'win32') {
        const directory = await open(stateRoot, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      if (renamed) {
        let committed = false;
        try {
          const observedRaw = await readSecureText();
          const observed =
            observedRaw === undefined ? undefined : envelopeFromUnknown(JSON.parse(observedRaw));
          committed = observed?.checksum === envelope.checksum;
        } catch {
          committed = false;
        }
        throw new EgressPolicyError(
          'EGRESS_CONFIG_COMMIT_UNKNOWN',
          'egress config rename completed but durability could not be confirmed',
          { cause: error, committed },
        );
      }
      throw new EgressPolicyError(
        'EGRESS_CONFIG_WRITE_FAILED',
        'egress config could not be committed atomically',
        { cause: error },
      );
    } finally {
      await handle?.close().catch(() => undefined);
      if (!renamed) {
        await unlink(temporaryPath).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
      }
    }
  };

  const mutate = async (operation: () => Promise<void>): Promise<void> => {
    const identity = await ensureStateRoot();
    const key = `${identity}:${EGRESS_CONFIG_FILENAME}`;
    let queue = configMutationQueues.get(key);
    if (queue === undefined) {
      queue = { tail: Promise.resolve() };
      configMutationQueues.set(key, queue);
    }
    const result = queue.tail.then(operation);
    queue.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return Object.freeze({
    load: async () => {
      const identity = await ensureStateRoot();
      const queue = configMutationQueues.get(`${identity}:${EGRESS_CONFIG_FILENAME}`);
      await queue?.tail;
      return load();
    },
    save: (configuration: EgressConfiguration) => mutate(() => write(configuration)),
  });
};
