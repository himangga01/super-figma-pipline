import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { Page } from 'playwright';

import { AtomicFileStore } from '../../mcp/src/fs/atomic-file.js';
import { writeCapture } from './artifacts.js';
import { parseFigmaTarget, type FigmaTarget } from './figma-url.js';

// These names exist only inside Playwright-evaluated browser callbacks. Keep their type bridge
// local to this module so server consumers retain Node's fetch/Response declarations.
interface HTMLAnchorElement {
  download: string;
  href: string;
}
declare const HTMLAnchorElement: {
  prototype: { click: (this: HTMLAnchorElement) => void };
};
declare const window: unknown;

const MAX_DOCUMENT_BYTES = 128 * 1024 * 1024;

/** Read the file produced by Figma's own export UI, without a plugin or private API request. */
export async function exportFigmaWebDocument(
  page: Page,
  target: Readonly<FigmaTarget>,
  folder: string,
  options: {
    deadlineAt: number;
    signal?: AbortSignal;
    sourceWork?<T>(pending: Promise<T>, cleanup?: boolean): Promise<T>;
  },
) {
  const key = `sfpExport${randomBytes(16).toString('hex')}`;
  const check = () => {
    options.signal?.throwIfAborted();
    if (Date.now() >= options.deadlineAt) throw new Error('FIGMA_WEB_EXPORT_TIMEOUT');
    if (parseFigmaTarget(page.url()).fileKey !== target.fileKey)
      throw new Error('BROWSER_TARGET_CHANGED');
  };
  check();
  const timeout = () => Math.max(1, Math.min(10_000, options.deadlineAt - Date.now()));
  const visibleDialogs = () => page.getByRole('dialog').filter({ visible: true });
  const visibleAlerts = () => page.getByRole('alertdialog').filter({ visible: true });
  const step = async <T>(action: () => Promise<T>): Promise<T> => {
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      // Only read-only observations/trials use this race. A late observation cannot activate UI.
      const interrupted = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('FIGMA_WEB_EXPORT_TIMEOUT')),
          options.deadlineAt - Date.now(),
        );
        abort = () => reject(options.signal?.reason ?? new Error('FIGMA_WEB_EXPORT_CANCELLED'));
        options.signal?.addEventListener('abort', abort, { once: true });
      });
      const pending = action();
      const value = await Promise.race([options.sourceWork?.(pending) ?? pending, interrupted]);
      check();
      return value;
    } catch (error) {
      check();
      if (error instanceof Error && error.name === 'TimeoutError')
        throw new Error('FIGMA_WEB_EXPORT_TIMEOUT', { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
      if (abort) options.signal?.removeEventListener('abort', abort);
    }
  };
  const designModePreflight = async () => {
    const count = await step(() => visibleDialogs().count());
    const alerts = await step(() => visibleAlerts().count());
    if (count === 0 && alerts === 0) return;
    const known = page
      .getByRole('dialog', { name: 'Upgrade to work in Dev Mode', exact: true })
      .filter({ visible: true });
    const back = known.getByRole('button', { name: 'Back to Design Mode', exact: true });
    const upgrade = known.getByRole('button', { name: 'Upgrade to Professional', exact: true });
    const confirm = async () => {
      if (
        (await step(() => visibleDialogs().count())) !== 1 ||
        (await step(() => visibleAlerts().count())) !== 0 ||
        (await step(() => known.count())) !== 1 ||
        (await step(() => back.count())) !== 1 ||
        (await step(() => upgrade.count())) !== 1 ||
        !(await step(() => upgrade.isVisible())) ||
        !(await step(() => back.isVisible())) ||
        !(await step(() => back.isEnabled()))
      )
        throw new Error('FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED');
    };
    if (count !== 1 || alerts !== 0) throw new Error('FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED');
    await confirm();
    await step(() =>
      back.click({ trial: true, force: false, timeout: Math.min(1_000, timeout()) }),
    );
    await confirm();
    check();
    // Playwright cannot cancel an issued click without closing the borrowed page. Keep its
    // actionability queue short, never race a mutating click, and recheck before any export hook.
    await back.click({ force: false, timeout: Math.min(250, timeout()) });
    check();
    await step(() => known.waitFor({ state: 'hidden', timeout: timeout() }));
    if (
      (await step(() => visibleDialogs().count())) !== 0 ||
      (await step(() => visibleAlerts().count())) !== 0
    )
      throw new Error('FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED');
  };
  try {
    await designModePreflight();
    check();
    await page.evaluate(
      ({ key: stateKey, maxBytes }) => {
        const state = {
          original: HTMLAnchorElement.prototype.click,
          hook: null as (() => void) | null,
          createObjectURL: URL.createObjectURL,
          createHook: null as typeof URL.createObjectURL | null,
          blobs: new Map<string, Blob>(),
          blob: null as Blob | null,
          url: null as string | null,
          filename: null as string | null,
        };
        state.createHook = object => {
          const url = state.createObjectURL.call(URL, object);
          if (object instanceof Blob && object.size >= 12 && object.size <= maxBytes) {
            if (state.blobs.size >= 8) state.blobs.delete(state.blobs.keys().next().value!);
            state.blobs.set(url, object);
          }
          return url;
        };
        URL.createObjectURL = state.createHook;
        state.hook = function (this: HTMLAnchorElement) {
          if (
            state.url === null &&
            /\.fig$/iu.test(this.download) &&
            this.href.startsWith('blob:')
          ) {
            state.url = this.href;
            state.filename = this.download;
            state.blob = state.blobs.get(this.href) ?? null;
            state.blobs.clear();
            // The service saves this explicitly requested download in its owned capture folder.
            return;
          }
          state.original.call(this);
        };
        (window as unknown as Record<string, unknown>)[stateKey] = state;
        HTMLAnchorElement.prototype.click = state.hook;
      },
      { key, maxBytes: MAX_DOCUMENT_BYTES },
    );
    check();
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: /^(Main menu|메인 메뉴|주 메뉴)$/u })
      .click({ timeout: timeout() });
    await page
      .getByRole('menuitem', { name: /^(File|파일)(?:\s|$)/u })
      .press('ArrowRight', { timeout: timeout() });
    const save = page.getByRole('menuitem', { name: /Save local copy|로컬 (?:복사본|사본)/iu });
    if (!(await save.isEnabled())) throw new Error('FIGMA_WEB_EXPORT_UNAVAILABLE');
    check();
    await save.press('Enter', { timeout: timeout() });
    let exported: { url: string; filename: string } | null = null;
    while (!exported) {
      check();
      // eslint-disable-next-line no-await-in-loop -- await this specific owner-requested export
      exported = await page.evaluate(stateKey => {
        const state = (
          window as unknown as Record<string, { url: string | null; filename: string | null }>
        )[stateKey];
        return state?.url && state.filename ? { url: state.url, filename: state.filename } : null;
      }, key);
      // eslint-disable-next-line no-await-in-loop -- bounded export readiness
      if (!exported) await delay(200, undefined, options.signal ? { signal: options.signal } : {});
    }
    check();
    const size = await page.evaluate(
      async ({ key: stateKey, maxBytes }) => {
        const state = (
          window as unknown as Record<
            string,
            { url: string; blob: Blob | null; bytes?: Uint8Array }
          >
        )[stateKey]!;
        // The export UI revokes its URL immediately; retain the actual Blob before revocation.
        const blob = state.blob ?? (await (await fetch(state.url)).blob());
        if (blob.size < 12 || blob.size > maxBytes)
          throw new Error('FIGMA_WEB_EXPORT_SIZE_INVALID');
        state.bytes = new Uint8Array(await blob.arrayBuffer());
        return state.bytes.length;
      },
      { key, maxBytes: MAX_DOCUMENT_BYTES },
    );
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < size; offset += 262_144) {
      check();
      // eslint-disable-next-line no-await-in-loop -- bounded chunks of the captured export only
      const chunk = await page.evaluate(
        ({ key: stateKey, offset: start }) => {
          const state = (window as unknown as Record<string, { bytes: Uint8Array }>)[stateKey]!;
          const bytes = state.bytes.subarray(start, start + 262_144);
          let binary = '';
          for (let blockOffset = 0; blockOffset < bytes.length; blockOffset += 16_384)
            binary += String.fromCharCode(...bytes.subarray(blockOffset, blockOffset + 16_384));
          return btoa(binary);
        },
        { key, offset },
      );
      const decoded = Buffer.from(chunk, 'base64');
      if (
        decoded.length !== Math.min(262_144, size - offset) ||
        decoded.toString('base64') !== chunk
      )
        throw new Error('FIGMA_WEB_EXPORT_CHANGED');
      chunks.push(decoded);
    }
    check();
    const bytes = Buffer.concat(chunks, size);
    if (bytes.subarray(0, 8).toString() !== 'fig-kiwi' && bytes.readUInt32LE(0) !== 0x04034b50)
      throw new Error('FIGMA_WEB_EXPORT_FORMAT_UNSUPPORTED');
    const path = join(folder, 'document.fig');
    await new AtomicFileStore().createNew(path, bytes);
    const result = {
      schemaVersion: 1,
      source: 'figma-web-native-export',
      requestedUrl: target.url,
      fileKey: target.fileKey,
      requestedNodeId: target.nodeId,
      filename: exported.filename,
      path: 'document.fig',
      bytes: size,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      capturedAt: new Date().toISOString(),
      fullCapture: false,
      limitation:
        'Raw native export requires decoding, scope validation and complete node/asset/oracle verification.',
    };
    await writeCapture(folder, 'web-export.json', result);
    return result;
  } catch (error) {
    await writeCapture(folder, 'web-ui.json', {
      source: 'service-playwright-chrome',
      fullCapture: false,
      error: error instanceof Error ? error.message : 'FIGMA_WEB_EXPORT_FAILED',
      ui: (
        await page
          .locator('body')
          .ariaSnapshot({ timeout: 5_000 })
          .catch(() => '')
      ).slice(0, 100_000),
    }).catch(() => {});
    throw error;
  } finally {
    const restoring = page.evaluate(stateKey => {
      const records = window as unknown as Record<
        string,
        {
          original: () => void;
          hook: () => void;
          createObjectURL: typeof URL.createObjectURL;
          createHook: typeof URL.createObjectURL;
        }
      >;
      const state = records[stateKey];
      if (!state) return;
      if (HTMLAnchorElement.prototype.click === state.hook)
        HTMLAnchorElement.prototype.click = state.original;
      if (URL.createObjectURL === state.createHook) URL.createObjectURL = state.createObjectURL;
      delete records[stateKey];
    }, key);
    await (options.sourceWork?.(restoring, true) ?? restoring).catch(() => {});
  }
}
