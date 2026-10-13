import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { Page } from 'playwright';

import { AtomicFileStore } from '../../mcp/src/fs/atomic-file.js';
import { parseFigmaTarget, type FigmaTarget } from './figma-url.js';
import { waitLogically } from './logical-wait.js';

/** Capture the selected node's explicit Copy as action without reading the system clipboard. */
export async function copyFigmaWebAsset(
  page: Page,
  target: Readonly<FigmaTarget>,
  format: 'svg' | 'png',
  folder: string,
  options: {
    deadlineAt: number;
    signal?: AbortSignal;
    sourceWork?<T>(pending: Promise<T>, cleanup?: boolean): Promise<T>;
  },
) {
  if (!target.nodeId) throw new Error('FIGMA_WEB_COPY_NODE_REQUIRED');
  const key = `sfpCopy${randomBytes(16).toString('hex')}`;
  const check = () => {
    options.signal?.throwIfAborted();
    if (Date.now() >= options.deadlineAt) throw new Error('FIGMA_WEB_COPY_TIMEOUT');
    const current = parseFigmaTarget(page.url());
    if (current.fileKey !== target.fileKey || current.nodeId !== target.nodeId)
      throw new Error('FIGMA_WEB_COPY_SELECTION_CHANGED');
  };
  const timeout = () => Math.max(1, Math.min(10_000, options.deadlineAt - Date.now()));
  check();
  const expired = new AbortController();
  const timer = setTimeout(
    () => expired.abort(new Error('FIGMA_WEB_COPY_TIMEOUT')),
    Math.max(1, options.deadlineAt - Date.now()),
  );
  timer.unref();
  const signal = options.signal
    ? AbortSignal.any([options.signal, expired.signal])
    : expired.signal;
  const bounded = <T>(pending: Promise<T>, cleanup = false) =>
    waitLogically(options.sourceWork?.(pending, cleanup) ?? pending, signal);
  let selectionUi: unknown = null;
  let copyTrace: unknown = [];
  let copyMenuItems: string[] = [];
  try {
    const observeSelection = () =>
      bounded(
        page
          .getByRole('treegrid')
          .getByRole('row')
          .evaluateAll(rows =>
            rows.slice(0, 64).map(row => ({
              attributes: Object.fromEntries([...row.attributes].map(a => [a.name, a.value])),
              text: row.textContent?.slice(0, 160),
              children: [...row.querySelectorAll('*')].slice(0, 10).map(child => ({
                tag: child.tagName,
                attributes: Object.fromEntries(
                  [...child.attributes]
                    .filter(
                      a =>
                        a.name.startsWith('data-') || a.name.startsWith('aria-') || a.name === 'id',
                    )
                    .map(a => [a.name, a.value]),
                ),
              })),
            })),
          ),
      );
    selectionUi = await observeSelection();
    const selected = selectedRows(selectionUi);
    if (selected.length !== 1) throw new Error('FIGMA_WEB_COPY_SELECTION_UNVERIFIED');
    const verifySelection = async () => {
      check();
      if (JSON.stringify(selectedRows(await observeSelection())) !== JSON.stringify(selected))
        throw new Error('FIGMA_WEB_COPY_SELECTION_CHANGED');
    };
    await bounded(
      page.evaluate(
        ({ key: stateKey, format: requested, remaining }) => {
          const clipboard = navigator.clipboard;
          const state = {
            write: clipboard.write,
            writeText: clipboard.writeText,
            writeDescriptor: Object.getOwnPropertyDescriptor(clipboard, 'write'),
            textDescriptor: Object.getOwnPropertyDescriptor(clipboard, 'writeText'),
            setData: DataTransfer.prototype.setData,
            execCommand: Document.prototype.execCommand,
            writeHook: null as typeof clipboard.write | null,
            textHook: null as typeof clipboard.writeText | null,
            dataHook: null as typeof DataTransfer.prototype.setData | null,
            execHook: null as typeof Document.prototype.execCommand | null,
            bytes: null as Uint8Array | null,
            error: null as string | null,
            pending: 0,
            active: true,
            timer: null as ReturnType<typeof setTimeout> | null,
            trace: [] as Array<{ api: string; types?: readonly string[]; prefix?: string }>,
            restore: () => {},
          };
          // eslint-disable-next-line unicorn/consistent-function-scoping -- this callback runs in Chrome
          const svg = (text: string) => /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/iu.test(text);
          const retain = (bytes: Uint8Array) => {
            if (!state.active) return;
            if (bytes.length < 8 || bytes.length > 16_777_216)
              state.error = 'FIGMA_WEB_COPY_SIZE_INVALID';
            else if (state.bytes) state.error = 'FIGMA_WEB_COPY_AMBIGUOUS';
            else state.bytes = bytes;
          };
          state.writeHook = async items => {
            if (state.trace.length < 16)
              state.trace.push({ api: 'write', types: items.flatMap(item => item.types) });
            state.pending++;
            try {
              let captured = false;
              for (const item of items) {
                const mime =
                  requested === 'png'
                    ? 'image/png'
                    : item.types.includes('image/svg+xml')
                      ? 'image/svg+xml'
                      : 'text/plain';
                if (!item.types.includes(mime)) continue;
                // eslint-disable-next-line no-await-in-loop -- each item belongs to this one explicit copy
                const blob = await item.getType(mime);
                if (blob.size > 16_777_216) {
                  state.error = 'FIGMA_WEB_COPY_SIZE_INVALID';
                  return;
                }
                // eslint-disable-next-line no-await-in-loop -- inspect only the requested format
                if (requested === 'svg' && !svg(await blob.text())) continue;
                // eslint-disable-next-line no-await-in-loop -- bounded payload from the requested copy
                retain(new Uint8Array(await blob.arrayBuffer()));
                captured = true;
              }
              if (!captured) await state.write.call(clipboard, items);
            } catch {
              state.error = 'FIGMA_WEB_COPY_READ_FAILED';
            } finally {
              state.pending--;
            }
          };
          state.textHook = async text => {
            if (state.trace.length < 16)
              state.trace.push({ api: 'writeText', prefix: text.slice(0, 96) });
            if (requested === 'svg' && svg(text)) retain(new TextEncoder().encode(text));
            else await state.writeText.call(clipboard, text);
          };
          state.dataHook = function (type, text) {
            if (state.trace.length < 16)
              state.trace.push({ api: 'setData', types: [type], prefix: text.slice(0, 96) });
            if (
              requested === 'svg' &&
              ['text', 'text/plain', 'image/svg+xml'].includes(type.toLowerCase()) &&
              svg(text)
            )
              retain(new TextEncoder().encode(text));
            else state.setData.call(this, type, text);
          };
          state.execHook = function (this: Document, command, showUi, value) {
            if (command.toLowerCase() === 'copy') {
              const active = this.activeElement;
              const text =
                active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
                  ? active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0)
                  : (this.getSelection()?.toString() ?? '');
              if (state.trace.length < 16)
                state.trace.push({ api: 'execCommand.copy', prefix: text.slice(0, 96) });
              if (requested === 'svg' && svg(text)) {
                retain(new TextEncoder().encode(text));
                return true;
              }
            }
            return state.execCommand.call(this, command, showUi, value);
          };
          state.restore = () => {
            state.active = false;
            state.bytes = null;
            if (state.timer !== null) clearTimeout(state.timer);
            if (clipboard.write === state.writeHook) {
              if (state.writeDescriptor)
                Object.defineProperty(clipboard, 'write', state.writeDescriptor);
              else Reflect.deleteProperty(clipboard, 'write');
            }
            if (clipboard.writeText === state.textHook) {
              if (state.textDescriptor)
                Object.defineProperty(clipboard, 'writeText', state.textDescriptor);
              else Reflect.deleteProperty(clipboard, 'writeText');
            }
            if (DataTransfer.prototype.setData === state.dataHook)
              DataTransfer.prototype.setData = state.setData;
            if (Document.prototype.execCommand === state.execHook)
              Document.prototype.execCommand = state.execCommand;
            delete (window as unknown as Record<string, unknown>)[stateKey];
          };
          (window as unknown as Record<string, unknown>)[stateKey] = state;
          Object.defineProperty(clipboard, 'write', { configurable: true, value: state.writeHook });
          Object.defineProperty(clipboard, 'writeText', {
            configurable: true,
            value: state.textHook,
          });
          DataTransfer.prototype.setData = state.dataHook;
          Document.prototype.execCommand = state.execHook;
          state.timer = setTimeout(state.restore, remaining);
        },
        { key, format, remaining: Math.max(1, options.deadlineAt - Date.now()) },
      ),
    );
    const menu = page.getByRole('button', { name: /^(Main menu|메인 메뉴|주 메뉴)$/u });
    if ((await bounded(menu.getAttribute('aria-expanded', { timeout: timeout() }))) !== 'true')
      await bounded(menu.click({ timeout: timeout() }));
    await page
      .getByRole('menuitem', { name: /^(Edit|편집)(?:\s|$)/u })
      .press('ArrowRight', { timeout: timeout() });
    await page
      .getByRole('menuitem', {
        name: /^(Copy as|Copy\/Paste as|다른 형식으로 복사|복사\/붙여넣기)$/u,
      })
      .press('ArrowRight', { timeout: timeout() });
    const command = page.getByRole('menuitem', {
      name:
        format === 'svg'
          ? /^(Copy as SVG|SVG로 복사)(?:\s|$)/u
          : /^(Copy as PNG|PNG로 복사)(?:\s|$)/u,
    });
    copyMenuItems = (await bounded(page.getByRole('menuitem').allTextContents()))
      .slice(0, 60)
      .map(text => text.slice(0, 160));
    if (!(await command.isEnabled({ timeout: timeout() })))
      throw new Error('FIGMA_WEB_COPY_UNAVAILABLE');
    check();
    await verifySelection();
    await command.press('Enter', { timeout: timeout() });
    let size = 0;
    while (!size) {
      check();
      // eslint-disable-next-line no-await-in-loop -- bounded readiness of the explicitly requested copy
      const observed = await bounded(
        page.evaluate(stateKey => {
          const state = (
            window as unknown as Record<
              string,
              { bytes: Uint8Array | null; error: string | null; pending: number; trace: unknown }
            >
          )[stateKey];
          return {
            size: state && state.pending === 0 ? (state.bytes?.length ?? 0) : 0,
            error: state?.error ?? null,
            trace: state?.trace ?? [],
          };
        }, key),
      );
      if (observed.error) throw new Error(observed.error);
      copyTrace = observed.trace;
      size = observed.size;
      // eslint-disable-next-line no-await-in-loop -- bounded polling, no clipboard permission requests
      if (!size) await delay(100, undefined, options.signal ? { signal: options.signal } : {});
    }
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < size; offset += 262_144) {
      check();
      // eslint-disable-next-line no-await-in-loop -- bounded transport of this capture only
      const encoded = await bounded(
        page.evaluate(
          ({ key: stateKey, offset: start }) => {
            const bytes = (window as unknown as Record<string, { bytes: Uint8Array }>)[
              stateKey
            ]!.bytes.subarray(start, start + 262_144);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 16_384)
              binary += String.fromCharCode(...bytes.subarray(i, i + 16_384));
            return btoa(binary);
          },
          { key, offset },
        ),
      );
      const chunk = Buffer.from(encoded, 'base64');
      if (chunk.length !== Math.min(262_144, size - offset) || chunk.toString('base64') !== encoded)
        throw new Error('FIGMA_WEB_COPY_CHANGED');
      chunks.push(chunk);
    }
    check();
    await verifySelection();
    const terminal = await bounded(
      page.evaluate(stateKey => {
        const state = (
          window as unknown as Record<
            string,
            { pending: number; error: string | null; restore: () => void }
          >
        )[stateKey];
        if (!state || state.pending || state.error) return state?.error ?? 'FIGMA_WEB_COPY_CHANGED';
        state.restore();
        return null;
      }, key),
    );
    if (terminal) throw new Error(terminal);
    const bytes = Buffer.concat(chunks, size);
    const dimensions: { width?: number; height?: number } =
      format === 'png' ? pngDimensions(bytes) : {};
    if (format === 'svg' && !/<\/svg>\s*$/iu.test(bytes.toString('utf8')))
      throw new Error('FIGMA_WEB_COPY_FORMAT_INVALID');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const path = `${key}.${format}`;
    await new AtomicFileStore().createNew(join(folder, path), bytes);
    const result = {
      schemaVersion: 1,
      source: 'figma-web-copy',
      fileKey: target.fileKey,
      nodeId: target.nodeId,
      requestedUrl: target.url,
      format,
      path,
      bytes: size,
      sha256: `sha256:${digest}`,
      ...dimensions,
      capturedAt: new Date().toISOString(),
      fullAssetAcceptance: false,
      selectionUi,
      copyTrace,
      copyMenuItems,
      selectionBinding:
        'requested-node-url-and-stable-selected-row; exact-node-identity-unverified',
      clipboardEffects:
        'Requested async clipboard writes are intercepted; legacy copy-event clipboard preservation is not established.',
      limitation:
        'Copy as PNG uses the web UI export scale; verify dimensions and rendering against independently collected assets before admission.',
    };
    await new AtomicFileStore().createNew(
      join(folder, `${key}.json`),
      Buffer.from(JSON.stringify(result, null, 2)),
    );
    return result;
  } catch (error) {
    await new AtomicFileStore()
      .createNew(
        join(folder, `${key}-failure.json`),
        Buffer.from(
          JSON.stringify(
            {
              source: 'service-playwright-chrome',
              nodeId: target.nodeId,
              format,
              selectionUi,
              copyTrace,
              copyMenuItems,
              error: error instanceof Error ? error.message : 'FIGMA_WEB_COPY_FAILED',
              ui: (
                await bounded(
                  page.locator('body').ariaSnapshot({ timeout: Math.min(2_000, timeout()) }),
                ).catch(() => '')
              ).slice(0, 100_000),
            },
            null,
            2,
          ),
        ),
      )
      .catch(() => {});
    throw error;
  } finally {
    await bounded(
      page.evaluate(stateKey => {
        (window as unknown as Record<string, { restore: () => void }>)[stateKey]?.restore();
      }, key),
      true,
    ).catch(() => {});
    clearTimeout(timer);
  }
}

const selectedRows = (rows: unknown) =>
  (rows as Array<{ attributes: Record<string, string>; text: string }>)
    .filter(row => row.attributes['aria-selected'] === 'true')
    .map(row => ({
      text: row.text,
      level: row.attributes['aria-level'],
      position: row.attributes['aria-posinset'],
    }));

function pngDimensions(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('FIGMA_WEB_COPY_FORMAT_INVALID');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 100_000_000)
    throw new Error('FIGMA_WEB_COPY_DIMENSIONS_INVALID');
  return { width, height };
}
