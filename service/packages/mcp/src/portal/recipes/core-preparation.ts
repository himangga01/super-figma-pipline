import { lstat, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { canonicalJson, contentHash } from '@sfp/ir';
import {
  PORTAL_CORE_RECIPE_LIMITS,
  PortalCoreRecipeManifestSchema,
  PortalCoreRecipePageSchema,
  PortalRecipeInputContextSchema,
  PortalRecipeResultSchema,
  type PortalRecipeInputContext,
} from '@sfp/shared';
import { z } from 'zod';

import { withCanonicalPathMutex, withRetainedDirectoryChain } from '../../fs/atomic-file.js';
import type { BoundStatePermissions } from '../../security/state-permissions.js';
import { PortalStore, portalError } from '../store.js';
import {
  CORE_RECIPE_CONTRACT_HASH,
  deriveCoreRecipeBundle,
  verifyCoreRecipePages,
  type CoreRecipeBundle,
} from './core-derivation.js';
import { coreHash } from './core-source.js';
import { portalRecipeInputContextHash, portalRecipeResultHash } from './definitions.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const id = z.string().min(1).max(256);
const coreIds = [
  'ground-design',
  'map-design',
  'derive-tokens',
  'audit-styles',
  'resolve-assets',
  'derive-interactions',
  'plan-design-implementation',
] as const;
const ref = z.object({ recipeId: z.enum(coreIds), resultId: hash, resultHash: hash }).strict();
const InputSchema = z
  .object({
    version: z.literal(1),
    context: PortalRecipeInputContextSchema,
    contextHash: hash,
    inputHash: hash,
    contractHash: hash,
    interactionContractHash: hash.nullable().optional(),
    interactionSelectionHash: hash.nullable().optional(),
  })
  .strict();
export const CorePreparationSchema = z
  .object({
    version: z.literal(1),
    preparationId: hash,
    ownerId: id,
    workspaceId: id,
    contextHash: hash,
    inputHash: hash,
    revision: z.number().int().positive(),
    status: z.enum(['pending', 'running', 'blocked', 'failed', 'cancelled', 'ready']),
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,127}$/u)
      .nullable(),
    results: z.array(ref).max(7),
    dependencies: z.array(id).max(128),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (
      new Set(record.results.map(row => row.recipeId)).size !== record.results.length ||
      new Set(record.dependencies).size !== record.dependencies.length ||
      (record.status === 'ready' && record.results.length !== 7)
    )
      ctx.addIssue({ code: 'custom', message: 'CORE_PREPARATION_INVALID' });
  });
const PageSchema = z.object({ contextHash: hash, hash, page: PortalCoreRecipePageSchema }).strict();
const ResultSchema = z
  .object({
    result: PortalRecipeResultSchema,
    manifest: PortalCoreRecipeManifestSchema,
  })
  .strict();
const CapacitySchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().positive(),
    rows: z
      .array(
        z
          .object({
            preparationId: hash,
            ownerId: id,
            workspaceId: id.optional(),
            intentHash: hash.optional(),
            contextHash: hash.optional(),
            inputHash: hash.optional(),
            bytes: z.number().int().positive(),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.rows.map(row => row.preparationId)).size !== value.rows.length)
      ctx.addIssue({ code: 'custom', message: 'CORE_CAPACITY_DUPLICATE' });
    for (const row of value.rows) {
      const fields = [row.workspaceId, row.intentHash, row.contextHash, row.inputHash];
      if (fields.some(field => field !== undefined) && fields.some(field => field === undefined))
        ctx.addIssue({ code: 'custom', message: 'CORE_CAPACITY_BINDING_INVALID' });
      if (
        row.contextHash &&
        row.inputHash &&
        identity(row.contextHash, row.inputHash) !== row.preparationId
      )
        ctx.addIssue({ code: 'custom', message: 'CORE_CAPACITY_BINDING_INVALID' });
    }
  });
type Preparation = z.infer<typeof CorePreparationSchema>;
type Scope = { ownerId: string; workspaceId: string };
type Input = Parameters<typeof deriveCoreRecipeBundle>[0];
type Cancellation = Pick<AbortSignal, 'throwIfAborted'>;
const key = (value: string) => value.slice(7);
const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value));
const intentIdentity = (
  context: Pick<PortalRecipeInputContext, 'ownerId' | 'workspaceId' | 'intentId'>,
) =>
  contentHash('sfp-core-preparation-intent-v1', {
    ownerId: context.ownerId,
    workspaceId: context.workspaceId,
    intentId: context.intentId,
  });
const identity = (contextHash: string, inputHash: string) =>
  contentHash('sfp-core-preparation-v1', { contextHash, inputHash });
const pageId = (contextHash: string, pageHash: string) =>
  contentHash('sfp-core-page-record-v1', { contextHash, pageHash });
const PublicationSchema = z
  .object({
    protocol: z.literal('sfp-core-publication-v1'),
    preparationId: hash,
    ownerId: id,
    workspaceId: id,
    contextHash: hash,
    inputHash: hash,
    unaccountedLegacyPrefix: z.boolean(),
    entries: z
      .array(
        z
          .object({
            kind: z.enum(['core-pages', 'core-results']),
            id: hash,
            recordHash: hash,
            bytes: z.number().int().positive(),
          })
          .strict(),
      )
      .max(PORTAL_CORE_RECIPE_LIMITS.pages + coreIds.length),
  })
  .strict()
  .refine(
    value =>
      new Set(value.entries.map(row => `${row.kind}/${row.id}`)).size === value.entries.length,
    { message: 'CORE_PUBLICATION_DUPLICATE' },
  );
export const CorePublicationSchema = PublicationSchema;
const RecordArchiveSchema = z
  .object({
    protocol: z.literal('sfp-core-record-archive-v1'),
    preparationId: hash,
    archiveHash: hash,
    recordHash: hash,
    kind: z.enum(['core-inputs', 'core-results', 'core-pages', 'core-publications']),
    id: hash,
    bytes: z.number().int().positive(),
  })
  .strict();
export const CorePreparationArchiveSchema = z
  .object({
    protocol: z.literal('sfp-core-preparation-archive-v1'),
    record: CorePreparationSchema,
    archiveHash: hash,
    receiptHash: hash,
    intentHash: hash,
    entries: z
      .array(
        z
          .object({
            kind: RecordArchiveSchema.shape.kind,
            id: hash,
            recordHash: hash,
            bytes: z.number().int().positive(),
            state: z.enum(['pending', 'archived']),
          })
          .strict(),
      )
      .max(PORTAL_CORE_RECIPE_LIMITS.pages + coreIds.length + 2),
    completed: z.boolean(),
    createdAt: z.number().int(),
    completedAt: z.number().int().nullable(),
  })
  .strict();
type Archive = z.infer<typeof CorePreparationArchiveSchema>;
const ArchiveCapacitySchema = z
  .object({
    version: z.literal(1),
    rows: z
      .array(z.object({ preparationId: hash, bytes: z.number().int().positive() }).strict())
      .max(4096),
  })
  .strict()
  .refine(
    value =>
      new Set(value.rows.map(row => row.preparationId)).size === value.rows.length &&
      value.rows.reduce((total, row) => total + row.bytes, 0) <= 67_108_864,
    { message: 'CORE_ARCHIVE_CAPACITY_INVALID' },
  );
const ArchivedIntentSchema = z
  .object({
    protocol: z.literal('sfp-core-archived-intent-v1'),
    ownerId: id,
    workspaceId: id,
    preparationId: hash,
    archiveHash: hash,
  })
  .strict();
const archivedRecordHash = (value: unknown) => contentHash('sfp-core-archived-record-v1', value);
const archiveIdentity = (archive: Pick<Archive, 'record' | 'intentHash' | 'entries'>) =>
  contentHash('sfp-core-preparation-archive-v1', {
    record: archive.record,
    intentHash: archive.intentHash,
    entries: archive.entries.map(({ state: _state, ...entry }) => entry),
  });
export interface CorePreparationArchivePolicy {
  withArchiveEligibility<T>(record: Preparation, work: () => Promise<T>): Promise<T>;
  afterRecordReduction?: (kind: string, recordId: string) => Promise<void>;
}
export const portalCoreAuthorityResource = (scope: Scope) => ({
  key: `portal:core-authority:${contentHash('sfp-core-authority-v1', { ownerId: scope.ownerId, workspaceId: scope.workspaceId }).slice(7)}`,
  mode: 'write' as const,
});

export const CORE_PREPARATION_LIMITS = Object.freeze({
  recordsPerOwner: 32,
  recordsGlobal: 128,
  bytesPerOwner: 5_368_709_120,
  bytesGlobal: 21_474_836_480,
});

/** Signed persistence, not capture/source admission. The coordinator must supply admitted inputs. */
export class CorePreparations {
  private readonly limits: Record<keyof typeof CORE_PREPARATION_LIMITS, number>;
  constructor(
    private readonly dependencies: {
      stateRoot: string;
      store: PortalStore;
      permissions: BoundStatePermissions;
      limits?: Partial<Record<keyof typeof CORE_PREPARATION_LIMITS, number>>;
      archivePolicy?: CorePreparationArchivePolicy;
    },
  ) {
    this.limits = { ...CORE_PREPARATION_LIMITS, ...dependencies.limits };
    for (const name of Object.keys(CORE_PREPARATION_LIMITS) as Array<
      keyof typeof CORE_PREPARATION_LIMITS
    >)
      if (
        !Number.isSafeInteger(this.limits[name]) ||
        this.limits[name] < 1 ||
        this.limits[name] > CORE_PREPARATION_LIMITS[name]
      )
        throw portalError('CORE_CAPACITY_LIMIT_INVALID');
  }
  private async locked<T>(work: () => Promise<T>, signal?: Cancellation): Promise<T> {
    signal?.throwIfAborted();
    const root = resolve(this.dependencies.stateRoot);
    await this.dependencies.permissions.verifySecure(root);
    return withRetainedDirectoryChain(root, root, async authority =>
      withCanonicalPathMutex(
        join(root, '.core-preparation'),
        async () => {
          signal?.throwIfAborted();
          const result = await work();
          await authority.verify();
          return result;
        },
        { filesystemTarget: authority.child('.core-preparation'), retainedParentAuthority: true },
      ),
    );
  }
  private authorize(record: Scope, scope: Scope) {
    if (record.ownerId !== scope.ownerId || record.workspaceId !== scope.workspaceId)
      throw portalError('CORE_PREPARATION_OWNER_MISMATCH');
  }
  private async immutable<T>(kind: string, recordId: string, value: T, schema: z.ZodType<T>) {
    const prior = await this.dependencies.store.get(kind, key(recordId), schema);
    if (prior !== null) {
      if (canonicalJson(prior) !== canonicalJson(value))
        throw portalError('CORE_ORPHAN_BINDING_MISMATCH');
      return;
    }
    await this.dependencies.store.create(kind, key(recordId), value, schema);
  }
  private async publishImmutable<T>(
    record: Preparation,
    kind: 'core-pages' | 'core-results',
    recordId: string,
    value: T,
    schema: z.ZodType<T>,
    unaccountedLegacyPrefix: boolean,
  ) {
    const store = this.dependencies.store,
      publicationId = key(record.preparationId);
    let publication = await store.get('core-publications', publicationId, PublicationSchema);
    const entry = {
      kind,
      id: recordId,
      recordHash: archivedRecordHash(value),
      bytes: bytes(value),
    };
    const binding = {
      protocol: 'sfp-core-publication-v1' as const,
      preparationId: record.preparationId,
      ownerId: record.ownerId,
      workspaceId: record.workspaceId,
      contextHash: record.contextHash,
      inputHash: record.inputHash,
      unaccountedLegacyPrefix,
    };
    if (!publication)
      publication = await store.create(
        'core-publications',
        publicationId,
        { ...binding, entries: [entry] },
        PublicationSchema,
      );
    else {
      const { entries, ...prior } = publication;
      if (canonicalJson(prior) !== canonicalJson(binding))
        throw portalError('CORE_PUBLICATION_BINDING_MISMATCH');
      const existing = entries.find(row => row.kind === kind && row.id === recordId);
      if (existing && canonicalJson(existing) !== canonicalJson(entry))
        throw portalError('CORE_PUBLICATION_BINDING_MISMATCH');
      if (!existing)
        await store.update('core-publications', publicationId, PublicationSchema, current => ({
          ...current,
          entries: [...current.entries, entry],
        }));
    }
    // Persist exact byte authority before publication, including a page without a result pointer.
    await this.immutable(kind, recordId, value, schema);
  }
  private async reserve(
    preparationId: `sha256:${string}`,
    context: PortalRecipeInputContext,
    contextHash: `sha256:${string}`,
    inputHash: `sha256:${string}`,
    reservedBytes: number,
  ) {
    const store = this.dependencies.store;
    const current = await store.get('core-capacity', 'index', CapacitySchema);
    const rows = current?.rows ?? [];
    let migrated = false;
    /* eslint-disable no-await-in-loop -- reconstruct each bounded signed legacy identity sequentially */
    for (const row of rows) {
      if (row.intentHash) continue;
      // A legacy charged prefix never disappears. Only signed matching records may recover its identity.
      // eslint-disable-next-line no-await-in-loop
      const prior = await store.get(
        'core-preparations',
        key(row.preparationId),
        CorePreparationSchema,
      );
      // eslint-disable-next-line no-await-in-loop
      const source = prior
        ? await store.get('core-inputs', key(prior.contextHash), InputSchema)
        : null;
      if (
        !prior ||
        !source ||
        prior.ownerId !== row.ownerId ||
        source.context.ownerId !== row.ownerId ||
        source.context.workspaceId !== prior.workspaceId ||
        source.contextHash !== prior.contextHash ||
        source.inputHash !== prior.inputHash ||
        portalRecipeInputContextHash(source.context) !== source.contextHash ||
        identity(source.contextHash, source.inputHash) !== row.preparationId
      )
        throw portalError('CORE_CAPACITY_LEGACY_RECOVERY_REQUIRED');
      Object.assign(row, {
        workspaceId: source.context.workspaceId,
        intentHash: intentIdentity(source.context),
        contextHash: source.contextHash,
        inputHash: source.inputHash,
      });
      migrated = true;
    }
    /* eslint-enable no-await-in-loop */
    if (new Set(rows.map(row => row.intentHash)).size !== rows.length)
      throw portalError('CORE_CAPACITY_INTENT_CONFLICT');
    const intentHash = intentIdentity(context);
    const sameIntent = rows.find(row => row.intentHash === intentHash);
    if (
      sameIntent &&
      (sameIntent.preparationId !== preparationId ||
        sameIntent.contextHash !== contextHash ||
        sameIntent.inputHash !== inputHash ||
        sameIntent.workspaceId !== context.workspaceId ||
        sameIntent.ownerId !== context.ownerId)
    )
      throw portalError('CORE_PREPARATION_INTENT_CHANGED');
    const prior = rows.find(row => row.preparationId === preparationId);
    if (
      prior &&
      (prior.ownerId !== context.ownerId ||
        prior.bytes !== reservedBytes ||
        prior.intentHash !== intentHash)
    )
      throw portalError('CORE_CAPACITY_BINDING_MISMATCH');
    if (!prior) {
      const own = rows.filter(row => row.ownerId === context.ownerId);
      if (
        rows.length >= this.limits.recordsGlobal ||
        own.length >= this.limits.recordsPerOwner ||
        rows.reduce((sum, row) => sum + row.bytes, reservedBytes) > this.limits.bytesGlobal ||
        own.reduce((sum, row) => sum + row.bytes, reservedBytes) > this.limits.bytesPerOwner
      )
        throw portalError('CORE_PREPARATION_CAPACITY_EXCEEDED');
      rows.push({
        preparationId,
        ownerId: context.ownerId,
        workspaceId: context.workspaceId,
        intentHash,
        contextHash,
        inputHash,
        bytes: reservedBytes,
      });
    }
    if (prior && !migrated) return;
    const next = { version: 1 as const, revision: (current?.revision ?? 0) + 1, rows };
    if (current)
      await store.update('core-capacity', 'index', CapacitySchema, stored => {
        if (stored.revision !== current.revision)
          throw portalError('CORE_PREPARATION_REVISION_CHANGED');
        return next;
      });
    else await store.create('core-capacity', 'index', next, CapacitySchema);
  }
  private async change(record: Preparation, patch: Partial<Preparation>) {
    return this.dependencies.store.update(
      'core-preparations',
      key(record.preparationId),
      CorePreparationSchema,
      current => {
        if (current.revision !== record.revision)
          throw portalError('CORE_PREPARATION_REVISION_CHANGED');
        return { ...current, ...patch, revision: current.revision + 1 };
      },
    );
  }
  /** Executes the fixed derivation; callers cannot submit result pages or completion flags. */
  async prepare(
    scope: Scope,
    contextInput: PortalRecipeInputContext,
    input: Input,
    signal?: Cancellation,
  ) {
    const context = PortalRecipeInputContextSchema.parse(contextInput);
    this.authorize(context, scope);
    if (
      context.strategy !== input.strategy ||
      !context.capabilityVersions.some(
        row =>
          row.id === 'core-derivation' &&
          row.version === 1 &&
          row.hash === CORE_RECIPE_CONTRACT_HASH,
      )
    )
      throw portalError('CORE_PREPARATION_CONTEXT_MISMATCH');
    for (const recipeId of coreIds)
      if (
        !context.selections.some(
          row => row.recipeId === recipeId && row.required && row.applicability === 'applicable',
        )
      )
        throw portalError('CORE_REQUIRED_RECIPE_MISSING');
    signal?.throwIfAborted();
    const bundle = deriveCoreRecipeBundle(input);
    if (
      (context.interactionContractHash ?? null) !== bundle.interactionContractHash ||
      (context.interactionSelectionHash ?? null) !== bundle.interactionSelectionHash
    )
      throw portalError('CORE_PREPARATION_INTERACTION_BINDING_MISMATCH');
    if (
      bundle.sources.length !== context.sourceHashes.length ||
      bundle.sources.some(
        source =>
          !context.sourceHashes.some(
            row =>
              row.sourceId === source.sourceId &&
              row.inventoryHash === source.inventoryHash &&
              row.graphHash === source.graphHash,
          ),
      )
    )
      throw portalError('CORE_PREPARATION_SOURCE_MISMATCH');
    const contextHash = portalRecipeInputContextHash(context);
    const preparationId = identity(contextHash, bundle.inputHash);
    const admitted = {
      version: 1 as const,
      context,
      contextHash,
      inputHash: bundle.inputHash,
      contractHash: CORE_RECIPE_CONTRACT_HASH,
      interactionContractHash: bundle.interactionContractHash,
      interactionSelectionHash: bundle.interactionSelectionHash,
    };
    // Reserve the supported maximum, including signed envelopes and bounded result/context metadata.
    // Retained history remains charged; changing status never silently frees physical capacity.
    const reservedBytes = PORTAL_CORE_RECIPE_LIMITS.bundleBytes + 16_777_216 + bytes(admitted);
    return this.locked(async () => {
      if (
        await this.dependencies.store.get(
          'core-archived-intents',
          key(intentIdentity(context)),
          ArchivedIntentSchema,
        )
      )
        throw portalError('CORE_PREPARATION_ARCHIVED');
      const priorInput = await this.dependencies.store.get(
        'core-inputs',
        key(contextHash),
        InputSchema,
      );
      if (priorInput && canonicalJson(priorInput) !== canonicalJson(admitted))
        throw portalError('CORE_PREPARATION_CONTEXT_CHANGED');
      await this.reserve(preparationId, context, contextHash, bundle.inputHash, reservedBytes);
      await this.immutable('core-inputs', contextHash, admitted, InputSchema);
      const store = this.dependencies.store;
      let record = await store.get('core-preparations', key(preparationId), CorePreparationSchema);
      if (!record) {
        // New preparations have no output prefix. Persist that authority before their first
        // record/cancellation boundary; a historical record never gains this empty proof.
        await this.immutable(
          'core-publications',
          preparationId,
          {
            protocol: 'sfp-core-publication-v1',
            preparationId,
            ...scope,
            contextHash,
            inputHash: bundle.inputHash,
            unaccountedLegacyPrefix: false,
            entries: [],
          },
          PublicationSchema,
        );
        record = await store.create(
          'core-preparations',
          key(preparationId),
          {
            version: 1,
            preparationId,
            ...scope,
            contextHash,
            inputHash: bundle.inputHash,
            revision: 1,
            status: 'pending',
            code: null,
            results: [],
            dependencies: [],
          },
          CorePreparationSchema,
        );
      }
      this.authorize(record, scope);
      if (record.contextHash !== contextHash || record.inputHash !== bundle.inputHash)
        throw portalError('CORE_PREPARATION_CONTEXT_MISMATCH');
      if (record.status === 'cancelled') return record;
      const priorPublication = await store.get(
        'core-publications',
        key(preparationId),
        PublicationSchema,
      );
      const unaccountedLegacyPrefix =
        priorPublication?.unaccountedLegacyPrefix ??
        (record.status !== 'pending' && record.results.length !== 7);
      try {
        if (record.status !== 'ready' && record.status !== 'blocked')
          record = await this.change(record, { status: 'running', code: null });
        const refs: Preparation['results'] = [];
        for (const derived of bundle.results) {
          signal?.throwIfAborted();
          const pages = bundle.pages.filter(page => page.page.recipeId === derived.recipeId);
          verifyCoreRecipePages(derived.output, pages);
          const selected = context.selections.find(row => row.recipeId === derived.recipeId)!;
          const resultId = contentHash('sfp-core-result-id-v1', {
            contextHash,
            inputHash: bundle.inputHash,
            recipeId: derived.recipeId,
            definitionHash: selected.definitionHash,
          });
          const base = {
            recipeAuthorityVersion: 1 as const,
            resultId,
            ...scope,
            contextHash,
            recipeId: derived.recipeId,
            definitionHash: selected.definitionHash,
            inputHash: bundle.inputHash,
            evidence: selected.evidence,
          };
          const result = PortalRecipeResultSchema.parse(
            derived.output.status === 'ready'
              ? {
                  ...base,
                  status: 'succeeded',
                  output: derived.output,
                  outputHash: contentHash('sfp-portal-recipe-output-v1', derived.output),
                }
              : { ...base, status: 'blocked', code: 'CORE_REQUIRED_INPUT_INCOMPLETE' },
          );
          for (const page of pages) {
            signal?.throwIfAborted();
            // Sequential publication bounds memory and makes each interrupted prefix recoverable.
            // eslint-disable-next-line no-await-in-loop
            await this.publishImmutable(
              record,
              'core-pages',
              pageId(contextHash, page.hash),
              { contextHash, ...page },
              PageSchema,
              unaccountedLegacyPrefix,
            );
          }
          signal?.throwIfAborted();
          // The result may only publish after its complete page prefix.
          // eslint-disable-next-line no-await-in-loop
          await this.publishImmutable(
            record,
            'core-results',
            resultId,
            { result, manifest: derived.output },
            ResultSchema,
            unaccountedLegacyPrefix,
          );
          refs.push({
            recipeId: z.enum(coreIds).parse(derived.recipeId),
            resultId,
            resultHash: portalRecipeResultHash(result),
          });
        }
        signal?.throwIfAborted();
        const status = bundle.results.every(result => result.output.status === 'ready')
          ? 'ready'
          : 'blocked';
        if (record.status === status && canonicalJson(record.results) === canonicalJson(refs))
          return record;
        return this.change(record, {
          status,
          results: refs,
          code: status === 'ready' ? null : 'CORE_REQUIRED_INPUT_INCOMPLETE',
        });
      } catch (cause) {
        let cancelled = false;
        try {
          signal?.throwIfAborted();
        } catch {
          cancelled = true;
        }
        // A failed checkpoint may have committed. Reload before marking it, preserving exact history.
        const latest = await store.get(
          'core-preparations',
          key(preparationId),
          CorePreparationSchema,
        );
        if (latest && latest.status !== 'ready' && latest.status !== 'blocked')
          await this.change(latest, {
            status: cancelled ? 'cancelled' : 'failed',
            code: cancelled ? 'CORE_PREPARATION_CANCELLED' : 'CORE_PREPARATION_FAILED',
          });
        throw cause;
      }
    }, signal);
  }
  async inspect(scope: Scope, preparationId: string) {
    hash.parse(preparationId);
    const record = await this.dependencies.store.get(
      'core-preparations',
      key(preparationId),
      CorePreparationSchema,
    );
    if (!record) throw portalError('CORE_PREPARATION_NOT_FOUND');
    this.authorize(record, scope);
    if (
      await this.dependencies.store.get(
        'core-archives',
        key(preparationId),
        CorePreparationArchiveSchema,
      )
    )
      throw portalError('CORE_PREPARATION_ARCHIVED');
    const input = await this.dependencies.store.get(
      'core-inputs',
      key(record.contextHash),
      InputSchema,
    );
    if (
      !input ||
      input.contextHash !== record.contextHash ||
      input.inputHash !== record.inputHash ||
      portalRecipeInputContextHash(input.context) !== input.contextHash ||
      identity(input.contextHash, input.inputHash) !== preparationId
    )
      throw portalError('CORE_PREPARATION_CONTEXT_MISMATCH');
    this.authorize(input.context, scope);
    return record;
  }
  /** Resolve only an already signed reservation; a caller's record ID is never admission. */
  async inspectIntent(scope: Scope, intentId: string) {
    id.parse(intentId);
    return this.locked(async () => {
      const capacity = await this.dependencies.store.get('core-capacity', 'index', CapacitySchema);
      const intentHash = intentIdentity({ ...scope, intentId });
      const row = capacity?.rows.find(
        entry =>
          entry.ownerId === scope.ownerId &&
          entry.workspaceId === scope.workspaceId &&
          entry.intentHash === intentHash,
      );
      if (!row) {
        if (capacity?.rows.some(entry => entry.ownerId === scope.ownerId && !entry.intentHash))
          throw portalError('CORE_CAPACITY_LEGACY_RECOVERY_REQUIRED');
        throw portalError('CORE_PREPARATION_INTENT_NOT_FOUND');
      }
      const preparation = await this.dependencies.store.get(
        'core-preparations',
        key(row.preparationId),
        CorePreparationSchema,
      );
      if (preparation) {
        this.authorize(preparation, scope);
        if (preparation.contextHash !== row.contextHash || preparation.inputHash !== row.inputHash)
          throw portalError('CORE_CAPACITY_BINDING_MISMATCH');
        if (preparation.status === 'cancelled') throw portalError('CORE_PREPARATION_CANCELLED');
      }
      return {
        preparationId: row.preparationId,
        contextHash: row.contextHash!,
        inputHash: row.inputHash!,
      };
    });
  }
  /** Re-read signed results/pages before blueprint/lease adoption, including completed resumes. */
  async readResults(scope: Scope, preparationId: string) {
    const record = await this.inspect(scope, preparationId);
    const input = (await this.dependencies.store.get(
      'core-inputs',
      key(record.contextHash),
      InputSchema,
    ))!;
    if (input.contractHash !== CORE_RECIPE_CONTRACT_HASH)
      throw portalError('CORE_CONTRACT_MISMATCH');
    const results = [];
    let pageCount = 0,
      pageBytes = 0;
    for (const reference of record.results) {
      // Read one result at a time rather than allocate all maximum-size records concurrently.
      // eslint-disable-next-line no-await-in-loop
      const stored = await this.dependencies.store.get(
        'core-results',
        key(reference.resultId),
        ResultSchema,
      );
      if (!stored) throw portalError('CORE_RESULT_MISSING');
      const result = stored.result;
      this.authorize(result, scope);
      if (
        portalRecipeResultHash(result) !== reference.resultHash ||
        result.resultId !== reference.resultId ||
        result.recipeId !== reference.recipeId ||
        result.contextHash !== record.contextHash ||
        result.inputHash !== record.inputHash ||
        result.definitionHash !==
          input.context.selections.find(selected => selected.recipeId === result.recipeId)
            ?.definitionHash ||
        stored.manifest.recipeId !== result.recipeId ||
        stored.manifest.inputHash !== record.inputHash ||
        stored.manifest.interactionContractHash !== input.interactionContractHash ||
        stored.manifest.interactionSelectionHash !== input.interactionSelectionHash ||
        (input.context.interactionContractHash ?? null) !== input.interactionContractHash ||
        (input.context.interactionSelectionHash ?? null) !== input.interactionSelectionHash ||
        (result.status === 'succeeded' &&
          canonicalJson(result.output) !== canonicalJson(stored.manifest))
      )
        throw portalError('CORE_RESULT_BINDING_MISMATCH');
      const pages: CoreRecipeBundle['pages'] = [];
      pageCount += stored.manifest.pages.length;
      pageBytes += stored.manifest.pages.reduce((total, page) => total + page.bytes, 0);
      if (
        pageCount > PORTAL_CORE_RECIPE_LIMITS.pages ||
        pageBytes > PORTAL_CORE_RECIPE_LIMITS.bundleBytes
      )
        throw portalError('CORE_BUNDLE_LIMIT');
      for (const expected of stored.manifest.pages) {
        // Ordered, bounded reads preserve manifest index identity.
        // eslint-disable-next-line no-await-in-loop
        const page = await this.dependencies.store.get(
          'core-pages',
          key(pageId(record.contextHash, expected.hash)),
          PageSchema,
        );
        if (
          !page ||
          page.contextHash !== record.contextHash ||
          page.hash !== expected.hash ||
          coreHash(page.page) !== page.hash
        )
          throw portalError('CORE_PAGE_BINDING_MISMATCH');
        pages.push({ hash: page.hash as `sha256:${string}`, page: page.page });
      }
      verifyCoreRecipePages(stored.manifest, pages);
      results.push({ ...stored, pages });
    }
    if (
      record.status === 'ready' &&
      (results.length !== 7 || results.some(row => row.result.status !== 'succeeded'))
    )
      throw portalError('CORE_REQUIRED_RESULT_MISSING');
    return { preparation: record, results };
  }
  async cancel(scope: Scope, preparationId: string) {
    return this.locked(async () => {
      const record = await this.inspect(scope, preparationId);
      if (record.dependencies.length) throw portalError('CORE_PREPARATION_IN_USE');
      if (record.status === 'cancelled') return record;
      return this.change(record, { status: 'cancelled', code: 'CORE_PREPARATION_CANCELLED' });
    });
  }
  /** Server lifecycle only; a transport declaration is never proof that a dependency ended. */
  async setDependency(
    scope: Scope,
    preparationId: string,
    dependencyId: string,
    retained: boolean,
  ) {
    id.parse(dependencyId);
    return this.locked(async () => {
      const record = retained
        ? (await this.readResults(scope, preparationId)).preparation
        : await this.inspect(scope, preparationId);
      if (retained && record.status !== 'ready') throw portalError('CORE_PREPARATION_NOT_READY');
      const dependencies = new Set(record.dependencies);
      if (retained) dependencies.add(dependencyId);
      else dependencies.delete(dependencyId);
      const next = [...dependencies].toSorted();
      if (canonicalJson(next) === canonicalJson(record.dependencies)) return record;
      return this.change(record, { dependencies: next });
    });
  }
  private archiveEligible<T>(record: Preparation, work: () => Promise<T>): Promise<T> {
    if (!this.dependencies.archivePolicy) throw portalError('CORE_ARCHIVE_POLICY_REQUIRED');
    if (['pending', 'running'].includes(record.status))
      throw portalError('CORE_PREPARATION_ACTIVE');
    return this.dependencies.archivePolicy.withArchiveEligibility(record, work);
  }
  private async archiveRecord(scope: Scope, preparationId: string): Promise<Preparation> {
    const record = await this.dependencies.store.get(
      'core-preparations',
      key(preparationId),
      CorePreparationSchema,
    );
    if (!record) throw portalError('CORE_PREPARATION_NOT_FOUND');
    this.authorize(record, scope);
    return record;
  }
  private async assertNoPublicationTemps(
    record: Preparation,
    references: ReadonlyArray<{ kind: string; id: string }>,
    intentHash: string,
  ) {
    const grouped = new Map<string, Set<string>>();
    for (const reference of [
      ...references,
      { kind: 'core-inputs', id: record.contextHash },
      { kind: 'core-preparations', id: record.preparationId },
      { kind: 'core-publications', id: record.preparationId },
      { kind: 'core-archives', id: record.preparationId },
      { kind: 'core-archived-intents', id: intentHash },
    ]) {
      const ids = grouped.get(reference.kind) ?? new Set<string>();
      ids.add(key(reference.id));
      grouped.set(reference.kind, ids);
    }
    /* eslint-disable no-await-in-loop -- bounded name-only inspection under each retained record directory */
    for (const [kind, ids] of grouped) {
      const directory = join(this.dependencies.stateRoot, 'portal', kind);
      const exists = await lstat(directory).catch(cause => {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw cause;
      });
      if (!exists) continue;
      await withRetainedDirectoryChain(this.dependencies.stateRoot, directory, async authority => {
        await this.dependencies.permissions.verifySecure(directory);
        const stream = await opendir(directory);
        let scanned = 0;
        for await (const entry of stream) {
          if (++scanned > 1_000_000) throw portalError('CORE_ARCHIVE_PUBLICATION_SCAN_LIMIT');
          const match = /^\.([a-f0-9]{64})\.json\.[a-f0-9]{32}\.sfp-tmp$/u.exec(entry.name);
          // The signed canonical ID associates this name with a publication intent; it does
          // not prove ownership of the temporary inode or authorize adopting/deleting it.
          if (match && ids.has(match[1]!))
            throw portalError('CORE_ARCHIVE_PUBLICATION_TEMP_RECOVERY_REQUIRED');
        }
        await authority.verify();
      });
    }
    /* eslint-enable no-await-in-loop */
  }
  private async draftArchive(scope: Scope, preparationId: string): Promise<Archive> {
    const record = await this.archiveRecord(scope, preparationId);
    const existing = await this.dependencies.store.get(
      'core-archives',
      key(preparationId),
      CorePreparationArchiveSchema,
    );
    if (existing) {
      if (
        canonicalJson(existing.record) !== canonicalJson(record) ||
        archiveIdentity(existing) !== existing.archiveHash
      )
        throw portalError('CORE_ARCHIVE_CHANGED');
      await this.assertNoPublicationTemps(record, existing.entries, existing.intentHash);
      return existing;
    }
    const read = await this.readResults(scope, preparationId);
    const input = await this.dependencies.store.get(
      'core-inputs',
      key(record.contextHash),
      InputSchema,
    );
    if (!input) throw portalError('CORE_PREPARATION_CONTEXT_MISMATCH');
    const entries: Archive['entries'] = [];
    const add = (kind: Archive['entries'][number]['kind'], recordId: string, value: unknown) => {
      if (!entries.some(entry => entry.kind === kind && entry.id === recordId))
        entries.push({
          kind,
          id: recordId,
          recordHash: archivedRecordHash(value),
          bytes: bytes(value),
          state: 'pending',
        });
    };
    add('core-inputs', record.contextHash, input);
    for (const row of read.results) {
      add('core-results', row.result.resultId, { result: row.result, manifest: row.manifest });
      for (const page of row.pages)
        add('core-pages', pageId(record.contextHash, page.hash), {
          contextHash: record.contextHash,
          hash: page.hash,
          page: page.page,
        });
    }
    const publication = await this.dependencies.store.get(
      'core-publications',
      key(preparationId),
      PublicationSchema,
    );
    if (!publication) {
      // Historical partial prefixes have no complete deletion authority. Keep their capacity
      // charged rather than assume that the result pointer accounts for every physical record.
      if (record.results.length !== 7)
        throw portalError('CORE_ARCHIVE_PUBLICATION_RECOVERY_REQUIRED');
    } else {
      if (publication.unaccountedLegacyPrefix)
        throw portalError('CORE_ARCHIVE_PUBLICATION_RECOVERY_REQUIRED');
      if (
        publication.preparationId !== preparationId ||
        publication.ownerId !== scope.ownerId ||
        publication.workspaceId !== scope.workspaceId ||
        publication.contextHash !== record.contextHash ||
        publication.inputHash !== record.inputHash
      )
        throw portalError('CORE_PUBLICATION_BINDING_MISMATCH');
      /* eslint-disable no-await-in-loop -- bounded sequential reads of exact signed publication intents */
      for (const expected of publication.entries) {
        const value =
          expected.kind === 'core-pages'
            ? await this.dependencies.store.get(expected.kind, key(expected.id), PageSchema)
            : await this.dependencies.store.get(expected.kind, key(expected.id), ResultSchema);
        // An intent may precede a failed create. Absence supplies no deletion/adoption authority.
        if (!value) continue;
        if (archivedRecordHash(value) !== expected.recordHash || bytes(value) !== expected.bytes)
          throw portalError('CORE_PUBLICATION_BINDING_MISMATCH');
        if (expected.kind === 'core-pages') {
          const page = PageSchema.parse(value);
          if (
            page.contextHash !== record.contextHash ||
            pageId(page.contextHash, page.hash) !== expected.id ||
            coreHash(page.page) !== page.hash
          )
            throw portalError('CORE_PUBLICATION_BINDING_MISMATCH');
        } else {
          const result = ResultSchema.parse(value);
          this.authorize(result.result, scope);
          if (
            result.result.contextHash !== record.contextHash ||
            result.result.inputHash !== record.inputHash ||
            result.result.resultId !== expected.id ||
            result.manifest.inputHash !== record.inputHash
          )
            throw portalError('CORE_PUBLICATION_BINDING_MISMATCH');
        }
        add(expected.kind, expected.id, value);
      }
      /* eslint-enable no-await-in-loop */
      add('core-publications', preparationId, publication);
    }
    await this.assertNoPublicationTemps(
      record,
      [...entries, ...(publication?.entries ?? [])],
      intentIdentity(input.context),
    );
    entries.sort((left, right) =>
      `${left.kind}/${left.id}`.localeCompare(`${right.kind}/${right.id}`),
    );
    const base = { record, intentHash: intentIdentity(input.context), entries };
    return CorePreparationArchiveSchema.parse({
      protocol: 'sfp-core-preparation-archive-v1',
      ...base,
      archiveHash: archiveIdentity(base),
      receiptHash: contentHash('sfp-core-preparation-receipt-v1', record),
      completed: false,
      createdAt: Date.now(),
      completedAt: null,
    });
  }
  async reviewArchive(scope: Scope, preparationId: string) {
    const record = await this.archiveRecord(scope, preparationId);
    return this.archiveEligible(record, () =>
      this.locked(async () => {
        const current = await this.archiveRecord(scope, preparationId);
        if (current.dependencies.length || ['pending', 'running'].includes(current.status))
          throw portalError('CORE_PREPARATION_IN_USE');
        const archive = await this.draftArchive(scope, preparationId);
        return {
          archiveHash: archive.archiveHash,
          receiptHash: archive.receiptHash,
          bytes: archive.entries.reduce((total, entry) => total + entry.bytes, 0),
          entries: archive.entries.length,
          completed: archive.completed,
        };
      }),
    );
  }
  async archive(scope: Scope, preparationId: string, archiveHash: string) {
    const record = await this.archiveRecord(scope, preparationId);
    return this.archiveEligible(record, () =>
      this.locked(async () => {
        const current = await this.archiveRecord(scope, preparationId);
        if (current.dependencies.length || ['pending', 'running'].includes(current.status))
          throw portalError('CORE_PREPARATION_IN_USE');
        let archive = await this.draftArchive(scope, preparationId);
        if (archive.archiveHash !== archiveHash) throw portalError('CORE_ARCHIVE_CHANGED');
        const store = this.dependencies.store;
        if (!(await store.get('core-archives', key(preparationId), CorePreparationArchiveSchema))) {
          const capacity = await store.get('core-archive-capacity', 'index', ArchiveCapacitySchema);
          const charge = bytes(archive) + bytes(record) + archive.entries.length * 1024 + 2048;
          const rows = capacity?.rows ?? [],
            reserved = rows.find(row => row.preparationId === preparationId);
          if (reserved && reserved.bytes !== charge) throw portalError('CORE_ARCHIVE_CHANGED');
          if (!reserved) {
            if (
              rows.length >= 4096 ||
              rows.reduce((total, row) => total + row.bytes, 0) + charge > 67_108_864
            )
              throw portalError('CORE_ARCHIVE_CAPACITY');
            rows.push({ preparationId, bytes: charge });
            if (capacity)
              await store.update('core-archive-capacity', 'index', ArchiveCapacitySchema, () => ({
                version: 1,
                rows,
              }));
            else
              await store.create(
                'core-archive-capacity',
                'index',
                { version: 1, rows },
                ArchiveCapacitySchema,
              );
          }
          await this.immutable(
            'core-archived-intents',
            archive.intentHash,
            { protocol: 'sfp-core-archived-intent-v1', ...scope, preparationId, archiveHash },
            ArchivedIntentSchema,
          );
          await store.create(
            'core-archives',
            key(preparationId),
            archive,
            CorePreparationArchiveSchema,
          );
        }
        /* eslint-disable no-await-in-loop -- each record reduction is independently resumable */
        for (const entry of archive.entries) {
          const schema =
            entry.kind === 'core-inputs'
              ? InputSchema
              : entry.kind === 'core-results'
                ? ResultSchema
                : entry.kind === 'core-publications'
                  ? PublicationSchema
                  : PageSchema;
          const marker = RecordArchiveSchema.parse({
            protocol: 'sfp-core-record-archive-v1',
            preparationId,
            archiveHash,
            recordHash: entry.recordHash,
            kind: entry.kind,
            id: entry.id,
            bytes: entry.bytes,
          });
          await store.update(
            entry.kind,
            key(entry.id),
            z.union([schema, RecordArchiveSchema]),
            value => {
              if ('protocol' in value && value.protocol === 'sfp-core-record-archive-v1') {
                if (canonicalJson(value) !== canonicalJson(marker))
                  throw portalError('CORE_ARCHIVE_CHANGED');
              } else if (
                archivedRecordHash(value) !== entry.recordHash ||
                bytes(value) !== entry.bytes
              )
                throw portalError('CORE_ARCHIVE_CHANGED');
              return marker;
            },
          );
          await this.dependencies.archivePolicy?.afterRecordReduction?.(entry.kind, entry.id);
          archive = await store.update(
            'core-archives',
            key(preparationId),
            CorePreparationArchiveSchema,
            value => ({
              ...value,
              entries: value.entries.map(row =>
                row.kind === entry.kind && row.id === entry.id
                  ? { ...row, state: 'archived' as const }
                  : row,
              ),
            }),
          );
        }
        /* eslint-enable no-await-in-loop */
        await this.assertNoPublicationTemps(current, archive.entries, archive.intentHash);
        archive = await store.update(
          'core-archives',
          key(preparationId),
          CorePreparationArchiveSchema,
          value => ({ ...value, completed: true, completedAt: value.completedAt ?? Date.now() }),
        );
        await store.update('core-capacity', 'index', CapacitySchema, value => ({
          ...value,
          revision: value.revision + 1,
          rows: value.rows.filter(row => row.preparationId !== preparationId),
        }));
        return {
          archiveHash,
          receiptHash: archive.receiptHash,
          bytes: archive.entries.reduce((total, entry) => total + entry.bytes, 0),
          entries: archive.entries.length,
          completed: true,
        };
      }),
    );
  }
  async verifyArchive(scope: Scope, preparationId: string, archiveHash: string) {
    const record = await this.archiveRecord(scope, preparationId);
    const archive = await this.dependencies.store.get(
      'core-archives',
      key(preparationId),
      CorePreparationArchiveSchema,
    );
    if (
      !archive ||
      !archive.completed ||
      archive.completedAt === null ||
      archive.archiveHash !== archiveHash ||
      archiveIdentity(archive) !== archiveHash ||
      canonicalJson(archive.record) !== canonicalJson(record) ||
      archive.receiptHash !== contentHash('sfp-core-preparation-receipt-v1', record) ||
      archive.entries.some(row => row.state !== 'archived')
    )
      throw portalError('CORE_ARCHIVE_INCOMPLETE');
    const intent = await this.dependencies.store.get(
      'core-archived-intents',
      key(archive.intentHash),
      ArchivedIntentSchema,
    );
    if (
      !intent ||
      intent.ownerId !== scope.ownerId ||
      intent.workspaceId !== scope.workspaceId ||
      intent.preparationId !== preparationId ||
      intent.archiveHash !== archiveHash
    )
      throw portalError('CORE_ARCHIVE_CHANGED');
    for (const entry of archive.entries) {
      // eslint-disable-next-line no-await-in-loop -- bounded signed proof checks
      const marker = await this.dependencies.store.get(
        entry.kind,
        key(entry.id),
        RecordArchiveSchema,
      );
      if (
        !marker ||
        marker.archiveHash !== archiveHash ||
        marker.preparationId !== preparationId ||
        marker.recordHash !== entry.recordHash ||
        marker.bytes !== entry.bytes
      )
        throw portalError('CORE_ARCHIVE_CHANGED');
    }
    return archive;
  }
}
