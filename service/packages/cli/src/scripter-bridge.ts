import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { Frame, Page } from 'playwright';

import {
  AssetReadResultSchema,
  AssetQuerySchema,
  createAssetReadProgram,
  createImageChunkReadProgram,
  ImageChunkResultSchema,
  IMAGE_CHUNK_BYTES,
} from './asset-program.js';
import { parseFigmaTarget, type FigmaTarget } from './figma-url.js';
import { createFigmaReadProgram } from './read-program.js';

export type { BrowserNode } from '../../shared/src/figma-capture-query.js';
import { FigmaCaptureReadResultSchema } from '../../shared/src/figma-capture-query.js';

const scripterFrames = (page: Page): Frame[] =>
  page.frames().filter(frame => {
    try {
      const url = new URL(frame.url());
      return url.protocol === 'https:' && url.hostname === 'scripter.rsms.me';
    } catch {
      return false;
    }
  });

export const openScripter = async (page: Page, target: Readonly<FigmaTarget>): Promise<Frame> => {
  if (parseFigmaTarget(page.url()).fileKey !== target.fileKey)
    throw new Error('BROWSER_TARGET_CHANGED');
  const existing = scripterFrames(page);
  if (existing.length === 1) return existing[0]!;
  if (existing.length > 1) throw new Error('SCRIPTER_FRAME_AMBIGUOUS');
  await page.keyboard.press('Control+/');
  const search = page
    .getByRole('searchbox')
    .or(page.getByRole('combobox'))
    .or(page.getByPlaceholder(/search|검색/iu))
    .filter({ visible: true })
    .first();
  await search.fill('Scripter', { timeout: 8_000 });
  const community = page.getByRole('button', {
    name: /Search plugins.*Scripter|Scripter.*플러그인/iu,
  });
  const item = page
    .getByRole('button')
    .filter({ has: page.locator('img[src*="resource_id=757836922707087381"]') });
  let searchedCommunity = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- observe before one fixed plugin action
    if ((await item.count()) === 1) break;
    // eslint-disable-next-line no-await-in-loop -- a recent plugin needs no Community search
    if (!searchedCommunity && (await community.count()) === 1) {
      // eslint-disable-next-line no-await-in-loop -- perform the search once
      await community.click();
      searchedCommunity = true;
    }
    // eslint-disable-next-line no-await-in-loop -- search results load asynchronously
    await delay(250);
  }
  if ((await item.count()) !== 1)
    throw new Error('SCRIPTER_INSTALL_REQUIRED: enable the verified Scripter plugin');
  await item.click();
  const run = page.getByRole('button', { name: /^Run[⏎\s]*$|^실행[⏎\s]*$/u });
  let ran = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const frames = scripterFrames(page);
    if (frames.length === 1) return frames[0]!;
    if (frames.length > 1) throw new Error('SCRIPTER_FRAME_AMBIGUOUS');
    // eslint-disable-next-line no-await-in-loop -- a recent item can start without this detail panel
    if (!ran && (await run.count()) === 1) {
      // eslint-disable-next-line no-await-in-loop -- start only the verified selected plugin
      await run.click();
      ran = true;
    }
    // eslint-disable-next-line no-await-in-loop -- bounded plugin startup observation
    await delay(500);
  }
  throw new Error('SCRIPTER_INSTALL_REQUIRED: open Scripter in this Figma file');
};

const evaluateReadProgram = async (
  page: Page,
  target: Readonly<FigmaTarget>,
  program: string,
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
): Promise<string> => {
  options.signal?.throwIfAborted();
  if (Date.now() >= (options.deadlineAt ?? Infinity)) throw new Error('SNAPSHOT_READ_BUDGET');
  const frame = await openScripter(page, target);
  options.signal?.throwIfAborted();
  const timeoutMs = Math.min(60_000, (options.deadlineAt ?? Infinity) - Date.now());
  if (timeoutMs <= 0) throw new Error('SNAPSHOT_READ_BUDGET');
  const timeoutCode =
    options.deadlineAt !== undefined && timeoutMs < 60_000
      ? 'SNAPSHOT_READ_BUDGET'
      : 'SCRIPTER_READ_TIMEOUT';
  const readSignal = AbortSignal.any([
    AbortSignal.timeout(Math.ceil(timeoutMs)),
    ...(options.signal ? [options.signal] : []),
  ]);
  const id = `sfp-read-${randomBytes(16).toString('hex')}`;
  const evaluation = frame.evaluate(
    async ({ id: requestId, program: script, timeoutMs: timeout, timeoutCode: errorCode }) =>
      new Promise<string>((resolve, reject) => {
        // Explicit browser surface types keep this shared collector usable by the Node-only daemon.
        const { window, parent } = globalThis as unknown as {
          window: {
            addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
            removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
          };
          parent: { postMessage(message: unknown, targetOrigin: string): void };
        };
        const finish = (error: Error | null, value?: string) => {
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          if (error !== null) reject(error);
          else resolve(value ?? '');
        };
        const listener = (event: MessageEvent) => {
          if ((event as { source: unknown }).source !== parent) return;
          const message = event.data;
          if (message?.type !== 'eval-response' || message.id !== requestId) return;
          if (typeof message.error === 'string') return finish(new Error(message.error));
          if (typeof message.result !== 'string' || message.result.length > 8_000_000)
            return finish(new Error('SCRIPTER_RESPONSE_INVALID'));
          finish(null, message.result);
        };
        const timer = setTimeout(() => {
          parent.postMessage({ type: 'eval-cancel', id: requestId }, '*');
          finish(new Error(errorCode));
        }, timeout);
        window.addEventListener('message', listener);
        parent.postMessage({ type: 'eval', id: requestId, js: script }, '*');
      }),
    { id, program, timeoutMs, timeoutCode },
  );
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      // Cancel only this read ID. A Plugin API export already underway may finish separately.
      void frame
        .evaluate(requestId => {
          const { parent } = globalThis as unknown as {
            parent: { postMessage(value: unknown, origin: string): void };
          };
          parent.postMessage({ type: 'eval-cancel', id: requestId }, '*');
        }, id)
        .catch(() => {});
      reject(options.signal?.aborted ? options.signal.reason : new Error(timeoutCode));
    };
    readSignal.addEventListener('abort', cancel, { once: true });
    if (readSignal.aborted) cancel();
  });
  let result: string;
  try {
    result = await Promise.race([evaluation, cancelled]);
    options.signal?.throwIfAborted();
  } finally {
    if (cancel) readSignal.removeEventListener('abort', cancel);
  }
  if (parseFigmaTarget(page.url()).fileKey !== target.fileKey)
    throw new Error('BROWSER_TARGET_CHANGED');
  return result;
};

export const readScripterAsset = async (
  page: Page,
  target: Readonly<FigmaTarget>,
  input: unknown,
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
) => {
  const query = AssetQuerySchema.parse(input);
  if (query.kind === 'image') {
    const chunks: Buffer[] = [];
    let offset = 0;
    let total: number | null = null;
    do {
      const result = ImageChunkResultSchema.parse(
        JSON.parse(
          // eslint-disable-next-line no-await-in-loop -- verify each immutable image chunk before advancing
          await evaluateReadProgram(
            page,
            target,
            createImageChunkReadProgram({ imageHash: query.imageHash, offset }),
            options,
          ),
        ),
      );
      if (result.imageHash !== query.imageHash || result.offset !== offset)
        throw new Error('ASSET_IDENTITY_MISMATCH');
      total ??= result.totalBytes;
      if (result.totalBytes !== total) throw new Error('ASSET_CAPTURE_CHANGED');
      const bytes = Buffer.from(result.base64, 'base64');
      if (
        bytes.length !== Math.min(IMAGE_CHUNK_BYTES, total - offset) ||
        bytes.toString('base64') !== result.base64
      )
        throw new Error('ASSET_ENCODING_INVALID');
      chunks.push(bytes);
      offset += bytes.length;
    } while (offset < total);
    return Buffer.concat(chunks, total);
  }
  const result = AssetReadResultSchema.parse(
    JSON.parse(await evaluateReadProgram(page, target, createAssetReadProgram(query), options)),
  );
  if (JSON.stringify(result.query) !== JSON.stringify(query))
    throw new Error('ASSET_IDENTITY_MISMATCH');
  const bytes = Buffer.from(result.base64, 'base64');
  if (bytes.byteLength !== result.byteLength || bytes.toString('base64') !== result.base64)
    throw new Error('ASSET_ENCODING_INVALID');
  return bytes;
};

export const readScripterDesign = async (
  page: Page,
  target: Readonly<FigmaTarget>,
  input: unknown,
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
) => {
  const result = await evaluateReadProgram(page, target, createFigmaReadProgram(input), options);
  return FigmaCaptureReadResultSchema.parse(JSON.parse(result));
};
