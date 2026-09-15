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
    };
    // Reserve the supported maximum, including signed envelopes and bounded result/context metadata.
    // Retained history remains charged; changing status never silently frees physical capacity.
    const reservedBytes = PORTAL_CORE_RECIPE_LIMITS.bundleBytes + 16_777_216 + bytes(admitted);
    return this.locked(async () => {
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
      if (!record)
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
      this.authorize(record, scope);
      if (record.contextHash !== contextHash || record.inputHash !== bundle.inputHash)
        throw portalError('CORE_PREPARATION_CONTEXT_MISMATCH');
      if (record.status === 'cancelled') return record;
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
            await this.immutable(
              'core-pages',
              pageId(contextHash, page.hash),
              { contextHash, ...page },
              PageSchema,
            );
          }
          signal?.throwIfAborted();
          // The result may only publish after its complete page prefix.
          // eslint-disable-next-line no-await-in-loop
          await this.immutable(
            'core-results',
            resultId,
            { result, manifest: derived.output },
            ResultSchema,
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
}
