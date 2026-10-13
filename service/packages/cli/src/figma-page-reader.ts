/* eslint-disable no-await-in-loop -- Scoped read continuation and image chunks are verified in order. */
import { randomUUID } from 'node:crypto';

import type { Page } from 'playwright';
import { z } from 'zod';

import { diagnose } from '../../mcp/src/diagnostics.js';
import {
  AssetQuerySchema,
  AssetReadResultSchema,
  FigmaCaptureAssetQuerySchema,
  IMAGE_CHUNK_BYTES,
  ImageChunkResultSchema,
  readFigmaCaptureAsset,
} from '../../shared/src/figma-capture-assets.js';
import {
  BrowserReadQuerySchema,
  FigmaCaptureReadResultSchema,
} from '../../shared/src/figma-capture-query.js';
import { readFigmaCapture } from '../../shared/src/figma-capture-read.js';
import { parseFigmaTarget, type FigmaTarget } from './figma-url.js';
import { waitLogically } from './logical-wait.js';
import { readDesignSnapshot } from './snapshot-reader.js';

export interface FigmaPageReadOptions {
  deadlineAt?: number;
  signal?: AbortSignal;
}
export interface FigmaPageApiObservation {
  version: 1;
  source: 'figma-web-page-api';
  api: 'window.figma';
  fileBinding: 'runtime-file-key-and-url';
  pageId: string;
  scopeNodeId: string;
  sessionId: string;
  atomic: false;
  fullCapture: false;
}
export type FigmaPageSnapshot = Awaited<ReturnType<typeof readDesignSnapshot>> & {
  pageApiObservation: FigmaPageApiObservation;
};
const fail = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};
function diagnosticEvent(event: string, error: unknown): void {
  diagnose(
    event,
    { phase: event, outcome: 'failed', errorCode: 'FIGMA_PAGE_IDENTITY_CHANGED' },
    error,
    'warn',
  );
}
function recordIdentityPhase(phase: string, error: unknown): void {
  switch (phase) {
    case 'url-before-open.invalid-url':
      diagnosticEvent('chrome.page-api.identity.url-before-open.invalid-url', error);
      break;
    case 'url-before-open.file-key':
      diagnosticEvent('chrome.page-api.identity.url-before-open.file-key', error);
      break;
    case 'url-after-handle.invalid-url':
      diagnosticEvent('chrome.page-api.identity.url-after-handle.invalid-url', error);
      break;
    case 'url-after-handle.file-key':
      diagnosticEvent('chrome.page-api.identity.url-after-handle.file-key', error);
      break;
    case 'url-before-query.invalid-url':
      diagnosticEvent('chrome.page-api.identity.url-before-query.invalid-url', error);
      break;
    case 'url-before-query.file-key':
      diagnosticEvent('chrome.page-api.identity.url-before-query.file-key', error);
      break;
    case 'url-after-query.invalid-url':
      diagnosticEvent('chrome.page-api.identity.url-after-query.invalid-url', error);
      break;
    case 'url-after-query.file-key':
      diagnosticEvent('chrome.page-api.identity.url-after-query.file-key', error);
      break;
    case 'open-file-key':
      diagnosticEvent('chrome.page-api.identity.open-file-key', error);
      break;
    case 'open-api-reference':
      diagnosticEvent('chrome.page-api.identity.open-api-reference', error);
      break;
    case 'open-page-reference':
      diagnosticEvent('chrome.page-api.identity.open-page-reference', error);
      break;
    case 'open-runtime-file-key':
      diagnosticEvent('chrome.page-api.identity.open-runtime-file-key', error);
      break;
    case 'before-reader.api-reference':
      diagnosticEvent('chrome.page-api.identity.before-reader.api-reference', error);
      break;
    case 'before-reader.file-key':
      diagnosticEvent('chrome.page-api.identity.before-reader.file-key', error);
      break;
    case 'before-reader.page-reference':
      diagnosticEvent('chrome.page-api.identity.before-reader.page-reference', error);
      break;
    case 'before-reader.page-id':
      diagnosticEvent('chrome.page-api.identity.before-reader.page-id', error);
      break;
    case 'after-reader.api-reference':
      diagnosticEvent('chrome.page-api.identity.after-reader.api-reference', error);
      break;
    case 'after-reader.file-key':
      diagnosticEvent('chrome.page-api.identity.after-reader.file-key', error);
      break;
    case 'after-reader.page-reference':
      diagnosticEvent('chrome.page-api.identity.after-reader.page-reference', error);
      break;
    case 'after-reader.page-id':
      diagnosticEvent('chrome.page-api.identity.after-reader.page-id', error);
      break;
    case 'envelope-file-key':
      diagnosticEvent('chrome.page-api.identity.envelope-file-key', error);
      break;
    case 'envelope-page-id':
      diagnosticEvent('chrome.page-api.identity.envelope-page-id', error);
      break;
    case 'envelope-scope-id':
      diagnosticEvent('chrome.page-api.identity.envelope-scope-id', error);
      break;
  }
}
function failIdentity(phase: string): never {
  const error = Object.assign(new Error('FIGMA_PAGE_IDENTITY_CHANGED'), {
    code: 'FIGMA_PAGE_IDENTITY_CHANGED',
  });
  recordIdentityPhase(phase, error);
  throw error;
}
const runtimeGuard = (phase: 'before-reader' | 'after-reader') => `
  if (globalThis.figma !== session.api) throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=${phase}.api-reference');
  if (session.api.fileKey !== expected.fileKey) throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=${phase}.file-key');
  if (session.api.currentPage !== session.page) throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=${phase}.page-reference');
  if (session.page.id !== expected.pageId) throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=${phase}.page-id');
  const scope = await session.api.getNodeByIdAsync(expected.nodeId);
  if (!scope || scope.id !== expected.nodeId || scope !== session.scope)
    throw Error('FIGMA_PAGE_SCOPE_CHANGED');
  let owner = scope;
  for (let depth = 0; owner && owner !== session.page && depth < 256; depth++) owner = owner.parent;
  if (owner !== session.page) throw Error('FIGMA_PAGE_SCOPE_CHANGED');
  if (globalThis.figma !== session.api) throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=${phase}.api-reference');
  if (session.api.fileKey !== expected.fileKey) throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=${phase}.file-key');
  if (session.api.currentPage !== session.page) throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=${phase}.page-reference');
  if (session.page.id !== expected.pageId) throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=${phase}.page-id');
`;
const EnvelopeSchema = z
  .object({
    source: z.literal('figma-web-page-api'),
    fileKey: z.string(),
    pageId: z
      .string()
      .max(512)
      .regex(/^\d+:\d+$/u),
    scopeNodeId: z.string(),
    raw: z.string().max(16_777_216),
  })
  .strict();
const InputSchema = z.record(z.string(), z.unknown());
const pageFailure = (error: unknown): never => {
  const message = error instanceof Error ? error.message : '';
  const code = [
    'FIGMA_PAGE_API_UNAVAILABLE',
    'FIGMA_PAGE_IDENTITY_CHANGED',
    'FIGMA_PAGE_SCOPE_CHANGED',
    'ASSET_NOT_FOUND',
    'ASSET_NOT_EXPORTABLE',
    'ASSET_TOO_LARGE',
  ].find(value => message.includes(value));
  if (code === 'FIGMA_PAGE_IDENTITY_CHANGED') {
    const phase = /source-identity-phase=([a-z.-]{1,80})(?:\s|$)/u.exec(message)?.[1];
    if (phase) recordIdentityPhase(phase, error);
  }
  return fail(code ?? 'FIGMA_PAGE_READ_FAILED');
};
function scopeOptions(options: FigmaPageReadOptions) {
  const deadlineAt = options.deadlineAt ?? Date.now() + 300_000;
  if (!Number.isSafeInteger(deadlineAt)) fail('FIGMA_PAGE_DEADLINE_INVALID');
  return { ...options, deadlineAt };
}
function assertActive(options: FigmaPageReadOptions): void {
  options.signal?.throwIfAborted();
  if (Date.now() >= (options.deadlineAt ?? Infinity)) fail('SNAPSHOT_READ_BUDGET');
}
function assertUrl(
  page: Page,
  target: Readonly<FigmaTarget>,
  phase: 'url-before-open' | 'url-after-handle' | 'url-before-query' | 'url-after-query',
): void {
  let current;
  try {
    current = parseFigmaTarget(page.url());
  } catch {
    failIdentity(phase + '.invalid-url');
  }
  if (current?.fileKey !== target.fileKey) failIdentity(phase + '.file-key');
}
async function bounded<T>(
  work: () => Promise<T>,
  options: FigmaPageReadOptions,
  releaseLate?: (value: T) => Promise<void>,
): Promise<T> {
  assertActive(options);
  const remaining = Math.min(60_000, (options.deadlineAt ?? Infinity) - Date.now());
  if (remaining <= 0) fail('SNAPSHOT_READ_BUDGET');
  const timeout = new AbortController();
  const timer = setTimeout(() => {
    const code =
      Date.now() >= (options.deadlineAt ?? Infinity)
        ? 'SNAPSHOT_READ_BUDGET'
        : 'FIGMA_PAGE_READ_TIMEOUT';
    timeout.abort(Object.assign(new Error(code), { code }));
  }, remaining);
  const signal = AbortSignal.any([timeout.signal, ...(options.signal ? [options.signal] : [])]);
  try {
    const result = await waitLogically(work(), signal, releaseLate);
    try {
      assertActive(options);
      return result;
    } catch (error) {
      // The waiter may have delivered a handle just before cancellation. Transfer cleanup here;
      // do not await stalled CDP disposal or replace the original cancellation result.
      try {
        void releaseLate?.(result).catch(() => {});
      } catch {
        /* preserve the original outcome */
      }
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function releaseHandle(
  handle: { dispose(): Promise<void> },
  options: FigmaPageReadOptions,
): Promise<void> {
  const pending = handle.dispose().catch(pageFailure);
  if (options.signal?.aborted || Date.now() >= (options.deadlineAt ?? Infinity)) {
    // Releasing a retained reference never closes the user's page; late cleanup is not evidence.
    void pending.catch(() => {});
    return;
  }
  await bounded(() => pending, options);
}

/** Holds actual page-global API/page/scope objects; never opens or invokes a plugin. */
async function openPageRead(
  page: Page,
  inputTarget: Readonly<FigmaTarget>,
  inputOptions: FigmaPageReadOptions,
) {
  const target = parseFigmaTarget(inputTarget.url);
  if (
    !target.nodeId ||
    target.fileKey !== inputTarget.fileKey ||
    target.nodeId !== inputTarget.nodeId
  )
    fail('FIGMA_PAGE_TARGET_REQUIRED');
  const options = scopeOptions(inputOptions);
  assertActive(options);
  assertUrl(page, target, 'url-before-open');
  const handle = await bounded(
    () =>
      page
        .evaluateHandle(
          async ({ fileKey, nodeId }) => {
            const api = (globalThis as unknown as { figma?: any }).figma;
            if (
              !api ||
              typeof api.getNodeByIdAsync !== 'function' ||
              api.currentPage?.type !== 'PAGE'
            )
              throw Error('FIGMA_PAGE_API_UNAVAILABLE');
            if (api.fileKey !== fileKey)
              throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=open-file-key');
            const selectedPage = api.currentPage;
            const scope = await api.getNodeByIdAsync(nodeId);
            if (!scope || scope.id !== nodeId) throw Error('FIGMA_PAGE_SCOPE_CHANGED');
            let ancestor = scope;
            for (let depth = 0; ancestor && ancestor !== selectedPage && depth < 256; depth++)
              ancestor = ancestor.parent;
            if (ancestor !== selectedPage) throw Error('FIGMA_PAGE_SCOPE_CHANGED');
            if ((globalThis as unknown as { figma?: unknown }).figma !== api)
              throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=open-api-reference');
            if (api.fileKey !== fileKey)
              throw Error(
                'FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=open-runtime-file-key',
              );
            if (api.currentPage !== selectedPage)
              throw Error('FIGMA_PAGE_IDENTITY_CHANGED source-identity-phase=open-page-reference');
            return { api, page: selectedPage, scope };
          },
          { fileKey: target.fileKey, nodeId: target.nodeId! },
        )
        .catch(pageFailure),
    options,
    value => value.dispose(),
  );
  try {
    assertUrl(page, target, 'url-after-handle');
    const pageId = await bounded(
      () => handle.evaluate(session => String(session.page.id)).catch(pageFailure),
      options,
    );
    const expected = { fileKey: target.fileKey, nodeId: target.nodeId, pageId };
    const execute = async (kind: 'read' | 'asset', input: unknown) => {
      const query =
        kind === 'read'
          ? BrowserReadQuerySchema.parse(input)
          : FigmaCaptureAssetQuerySchema.parse(input);
      const queryNodeId = 'nodeId' in query ? query.nodeId : null;
      if (kind === 'read' && queryNodeId === null) fail('FIGMA_PAGE_SCOPE_CHANGED');
      const program = kind === 'read' ? readFigmaCapture : readFigmaCaptureAsset;
      // The only executable text is a compiled closed service reader. Query values remain JSON.
      const expression = `async session => {
        const expected = ${JSON.stringify(expected)};
        ${runtimeGuard('before-reader')}
        const requested = ${JSON.stringify(queryNodeId)};
        const assertQueryScope = async () => { if (requested !== null) {
          let node = await session.api.getNodeByIdAsync(requested);
          for (let depth = 0; node && node !== session.scope && depth < 256; depth++) node = node.parent;
          if (node !== session.scope) throw Error('FIGMA_PAGE_SCOPE_CHANGED');
        } };
        await assertQueryScope();
        const raw = await (${program.toString()})(${JSON.stringify(query)}, session.api${kind === 'read' ? ", 'figma-web-page-api'" : ''});
        await assertQueryScope();
        { ${runtimeGuard('after-reader')} }
        return { source: 'figma-web-page-api', fileKey: session.api.fileKey, pageId: session.page.id,
          scopeNodeId: session.scope.id, raw };
      }`;
      assertUrl(page, target, 'url-before-query');
      // Playwright treats a string as an expression, not a callable receiving the handle. Compile
      // this service-owned wrapper locally so Playwright invokes it with the retained handle.
      const evaluator = new Function('session', `return (${expression})(session);`) as (
        session: unknown,
      ) => Promise<unknown>;
      const result = EnvelopeSchema.parse(
        await bounded(() => handle.evaluate(evaluator).catch(pageFailure), options),
      );
      assertActive(options);
      assertUrl(page, target, 'url-after-query');
      if (result.fileKey !== target.fileKey) failIdentity('envelope-file-key');
      if (result.pageId !== pageId) failIdentity('envelope-page-id');
      if (result.scopeNodeId !== target.nodeId) failIdentity('envelope-scope-id');
      return { value: JSON.parse(result.raw) as unknown, pageId };
    };
    return {
      execute,
      close: () => releaseHandle(handle, options),
      target,
      options,
      pageId,
      sessionId: 'page-api-read:' + randomUUID(),
    };
  } catch (error) {
    await releaseHandle(handle, options);
    throw error;
  }
}

/** Transport-neutral continuation with independent page-global acquisition and source tagging. */
export async function readFigmaPageSnapshot(
  page: Page,
  target: Readonly<FigmaTarget>,
  input: unknown = {},
  options: FigmaPageReadOptions = {},
): Promise<FigmaPageSnapshot> {
  const query = BrowserReadQuerySchema.parse({
    nodeId: target.nodeId,
    ...InputSchema.parse(input),
  });
  if (query.nodeId !== target.nodeId) fail('FIGMA_PAGE_SCOPE_CHANGED');
  const session = await openPageRead(page, target, options);
  try {
    const snapshot = await readDesignSnapshot(
      session.target,
      query,
      async args => {
        const { value, pageId } = await session.execute('read', args);
        const result = FigmaCaptureReadResultSchema.parse(value);
        if (result.source !== 'figma-web-page-api') fail('FIGMA_PAGE_SOURCE_CHANGED');
        if (result.pageId !== pageId || result.scopeNodeId !== args.nodeId)
          fail('FIGMA_PAGE_SCOPE_CHANGED');
        return result;
      },
      session.options,
    );
    assertActive(session.options);
    return {
      ...snapshot,
      pageApiObservation: {
        version: 1 as const,
        source: 'figma-web-page-api' as const,
        api: 'window.figma' as const,
        fileBinding: 'runtime-file-key-and-url' as const,
        pageId: session.pageId,
        scopeNodeId: session.target.nodeId!,
        sessionId: session.sessionId,
        atomic: false as const,
        fullCapture: false as const,
      },
    };
  } finally {
    await session.close();
    assertActive(session.options);
  }
}

/** Root PNG/SVG and original-image chunks are exported by this page runtime only. */
export async function readFigmaPageAsset(
  page: Page,
  target: Readonly<FigmaTarget>,
  input: unknown,
  options: FigmaPageReadOptions = {},
): Promise<Buffer> {
  const query = AssetQuerySchema.parse(input);
  const session = await openPageRead(page, target, options);
  try {
    if (query.kind === 'image') {
      const chunks: Buffer[] = [];
      let offset = 0,
        total: number | null = null;
      do {
        const { value } = await session.execute('asset', {
          kind: 'image-chunk',
          imageHash: query.imageHash,
          offset,
        });
        const result = ImageChunkResultSchema.parse(value);
        if (result.imageHash !== query.imageHash || result.offset !== offset)
          fail('ASSET_IDENTITY_MISMATCH');
        total ??= result.totalBytes;
        if (total !== result.totalBytes) fail('ASSET_CAPTURE_CHANGED');
        const bytes = Buffer.from(result.base64, 'base64');
        if (
          bytes.length !== Math.min(IMAGE_CHUNK_BYTES, total - offset) ||
          bytes.toString('base64') !== result.base64
        )
          fail('ASSET_ENCODING_INVALID');
        chunks.push(bytes);
        offset += bytes.length;
      } while (offset < total);
      assertActive(session.options);
      return Buffer.concat(chunks, total);
    }
    const { value } = await session.execute('asset', query);
    const result = AssetReadResultSchema.parse(value);
    if (JSON.stringify(result.query) !== JSON.stringify(query)) fail('ASSET_IDENTITY_MISMATCH');
    const bytes = Buffer.from(result.base64, 'base64');
    if (bytes.length !== result.byteLength || bytes.toString('base64') !== result.base64)
      fail('ASSET_ENCODING_INVALID');
    assertActive(session.options);
    return bytes;
  } finally {
    await session.close();
    assertActive(session.options);
  }
}
