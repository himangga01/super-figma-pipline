import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';

import { chromium, type Page } from 'playwright';
import { expect, it } from 'vitest';

import { requireChrome } from '../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../mcp/src/portal/chrome-runtime.js';
import { parseFigmaTarget } from '../src/figma-url.js';
import { copyFigmaWebAsset } from '../src/figma-web-copy.js';
import { exportFigmaWebDocument } from '../src/figma-web-export.js';

it('reports a disabled native download before activating Save and restores its hooks', async testContext => {
  const executablePath = googleChromeExecutable();
  requireChrome(testContext, executablePath);
  if (!executablePath) throw new Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const folder = await mkdtemp(join(tmpdir(), 'sfp-disabled-native-export-'));
  const fromTemp = relative(tmpdir(), folder);
  if (!fromTemp || isAbsolute(fromTemp) || fromTemp.startsWith('..'))
    throw new Error('INVALID_FIXTURE_ROOT');
  const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const target = parseFigmaTarget(
      'https://www.figma.com/design/ownedDisabledExportFixture?node-id=0-1',
    );
    await page.route('**/*', route =>
      route.request().url() === target.url
        ? route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html>
              <button>Main menu</button><button role="menuitem">File</button>
              <button role="menuitem" id="save" disabled>Save local copy</button>
              <script>
                window.originalClick=HTMLAnchorElement.prototype.click;
                window.originalCreate=URL.createObjectURL;
                window.saveActivations=0;
                document.querySelector('#save').onclick=()=>window.saveActivations++;
              </script>`,
          })
        : route.abort(),
    );
    await page.goto(target.url);
    await expect(
      exportFigmaWebDocument(page, target, folder, { deadlineAt: Date.now() + 5000 }),
    ).rejects.toThrow('FIGMA_WEB_EXPORT_UNAVAILABLE');
    const after = await page.evaluate(() => {
      const state = window as unknown as {
        originalClick: unknown;
        originalCreate: unknown;
        saveActivations: number;
      };
      return {
        saveActivations: state.saveActivations,
        clickRestored: HTMLAnchorElement.prototype.click === state.originalClick,
        createRestored: URL.createObjectURL === state.originalCreate,
        retainedHook: Object.keys(window).some(key => key.startsWith('sfpExport')),
      };
    });
    expect(after).toEqual({
      saveActivations: 0,
      clickRestored: true,
      createRestored: true,
      retainedHook: false,
    });
    expect(await readdir(folder)).not.toContain('document.fig');
  } finally {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
  }
});

it.for([
  { id: 'known-dialog', expected: null },
  { id: 'unknown-dialog', expected: 'FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED' },
  { id: 'ambiguous-dialog', expected: 'FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED' },
  { id: 'security-alert', expected: 'FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED' },
  { id: 'security-alert-only', expected: 'FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED' },
  { id: 'disabled-back-cancel-then-enable', expected: 'FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED' },
  { id: 'covered-back-cancel-then-uncover', expected: 'owner cancelled during trial' },
  { id: 'covered-back-original-deadline', expected: 'FIGMA_WEB_EXPORT_TIMEOUT' },
  { id: 'identity-changed-during-trial', expected: 'BROWSER_TARGET_CHANGED' },
  { id: 'identity-changed-by-back', expected: 'BROWSER_TARGET_CHANGED' },
  { id: 'cancel-after-issued-back', expected: 'owner cancelled after issued back' },
  { id: 'deadline-after-issued-back', expected: 'FIGMA_WEB_EXPORT_TIMEOUT' },
])(
  'guards native export Dev Mode preflight: $id',
  { timeout: 15_000 },
  async ({ id, expected }, testContext) => {
    const executablePath = googleChromeExecutable();
    requireChrome(testContext, executablePath);
    if (!executablePath) throw new Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
    const folder = await mkdtemp(join(tmpdir(), 'sfp-design-mode-export-'));
    const fromTemp = relative(tmpdir(), folder);
    if (!fromTemp || isAbsolute(fromTemp) || fromTemp.startsWith('..'))
      throw new Error('INVALID_FIXTURE_ROOT');
    const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
    try {
      const page = await browser.newPage();
      const cancelled = new AbortController();
      await page.exposeFunction('cancelAfterBack', () => {
        cancelled.abort(new Error('owner cancelled after issued back'));
      });
      const target = parseFigmaTarget(
        'https://www.figma.com/design/ownedExportFixture?node-id=0-1',
      );
      const title =
        id === 'unknown-dialog'
          ? 'Confirm unknown security setting'
          : 'Upgrade to work in Dev Mode';
      const disabled = id === 'disabled-back-cancel-then-enable';
      const covered = [
        'covered-back-cancel-then-uncover',
        'covered-back-original-deadline',
        'identity-changed-during-trial',
      ].includes(id);
      await page.route('https://www.figma.com/**', route =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html>
      <button>Main menu</button><button role="menuitem">File</button>
      <button role="menuitem" id="save">Save local copy</button>
      <button id="outside">Back to Design Mode</button>
      <div role="${id === 'security-alert-only' ? 'presentation' : 'dialog'}" aria-label="${title}" id="modal" style="position:fixed;inset:0;background:white;z-index:10">
        <h2>${title}</h2><button id="paid">Upgrade to Professional</button>
        <button id="back" ${disabled ? 'disabled' : ''}>Back to Design Mode</button>
      </div>
      ${id === 'ambiguous-dialog' ? '<div role="dialog" aria-label="Another dialog">Unknown</div>' : ''}
      ${id === 'security-alert' || id === 'security-alert-only' ? '<div role="alertdialog" aria-modal="true" aria-label="Security approval">Allow remote access</div>' : ''}
      ${covered ? '<div id="cover" style="position:fixed;inset:0;background:white;z-index:20">Wait</div>' : ''}
      <script>
      window.originalClick=HTMLAnchorElement.prototype.click; window.originalCreate=URL.createObjectURL;
      window.effects={back:0,paid:0,outside:0,save:0,hookAtBack:false};
      document.querySelector('#paid').onclick=()=>window.effects.paid++;
      document.querySelector('#outside').onclick=()=>window.effects.outside++;
      document.querySelector('#back').onclick=()=>{
        window.effects.back++;window.effects.hookAtBack=Object.keys(window).some(k=>k.startsWith('sfpExport'));
        ${id === 'identity-changed-by-back' ? "history.replaceState({},'', '/design/otherFileKey');" : ''}
        ${id === 'cancel-after-issued-back' ? 'window.cancelAfterBack();' : ''}
        ${
          id === 'cancel-after-issued-back' || id === 'deadline-after-issued-back'
            ? "setTimeout(()=>document.querySelector('#modal').remove(),450);"
            : "document.querySelector('#modal').remove();"
        }
      };
      document.querySelector('#save').onclick=()=>{
        window.effects.save++;const a=document.createElement('a');
        a.href=URL.createObjectURL(new Blob(['fig-kiwi-owned-source']));a.download='Owned source.fig';
        a.click();URL.revokeObjectURL(a.href);
      };
      </script>`,
        }),
      );
      await page.goto(target.url);
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (disabled || id === 'covered-back-cancel-then-uncover') {
        timer = setTimeout(() => cancelled.abort(new Error('owner cancelled during trial')), 100);
      }
      if (disabled || covered) {
        await page.evaluate(mode => {
          setTimeout(
            () => {
              if (mode === 'identity-changed-during-trial')
                history.replaceState({}, '', '/design/otherFileKey');
              document.querySelector('#back')?.removeAttribute('disabled');
              document.querySelector('#cover')?.remove();
            },
            mode === 'covered-back-original-deadline' ? 450 : 300,
          );
        }, id);
      }
      try {
        const action = exportFigmaWebDocument(page, target, folder, {
          deadlineAt:
            Date.now() +
            (id === 'covered-back-original-deadline' || id === 'deadline-after-issued-back'
              ? 200
              : 5_000),
          signal: cancelled.signal,
        });
        const outcome = await action.then(
          result => ({ result, error: null }),
          (error: unknown) => ({
            result: null,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        expect(outcome.error).toBe(expected);
        expect(outcome.result?.source ?? null).toBe(expected ? null : 'figma-web-native-export');
        expect(outcome.result?.fullCapture ?? null).toBe(expected ? null : false);
        const bytes = await readFile(join(folder, 'document.fig')).catch(() => null);
        expect(bytes?.toString() ?? null).toBe(expected ? null : 'fig-kiwi-owned-source');
        // Give formerly disabled/covered controls time to become actionable after cancellation.
        if (
          disabled ||
          covered ||
          id === 'cancel-after-issued-back' ||
          id === 'deadline-after-issued-back'
        )
          await page.waitForTimeout(550);
        const state = await page.evaluate(() => {
          const stored = window as unknown as {
            originalClick: unknown;
            originalCreate: unknown;
            effects: {
              back: number;
              paid: number;
              outside: number;
              save: number;
              hookAtBack: boolean;
            };
          };
          return {
            ...stored.effects,
            clean:
              stored.originalClick === HTMLAnchorElement.prototype.click &&
              stored.originalCreate === URL.createObjectURL &&
              !Object.keys(window).some(key => key.startsWith('sfpExport')),
          };
        });
        expect(state).toEqual({
          back: [
            'known-dialog',
            'identity-changed-by-back',
            'cancel-after-issued-back',
            'deadline-after-issued-back',
          ].includes(id)
            ? 1
            : 0,
          paid: 0,
          outside: 0,
          save: expected ? 0 : 1,
          hookAtBack: false,
          clean: true,
        });
        expect((await readdir(folder)).includes('document.fig')).toBe(expected === null);
        expect(cancelled.signal.aborted).toBe(
          disabled ||
            id === 'covered-back-cancel-then-uncover' ||
            id === 'cancel-after-issued-back',
        );
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await browser.close();
      await rm(folder, { recursive: true, force: true });
    }
  },
);

it('captures native web exports after immediate URL revocation and restores browser hooks', async testContext => {
  const executablePath = googleChromeExecutable();
  requireChrome(testContext, executablePath);
  if (!executablePath) throw new Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const folder = await mkdtemp(join(tmpdir(), 'sfp-web-export-'));
  const fromTemp = relative(tmpdir(), folder);
  if (!fromTemp || isAbsolute(fromTemp) || fromTemp.startsWith('..'))
    throw new Error('INVALID_FIXTURE_ROOT');
  const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const target = parseFigmaTarget(
      'https://www.figma.com/design/ownedExportFixture/Example?node-id=0-1',
    );
    await page.route('https://www.figma.com/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><button>Main menu</button>
      <button role="menuitem">File</button><button role="menuitem" id="save">Save local copy</button>
      <script>
      window.originalClick = HTMLAnchorElement.prototype.click;
      window.originalCreate = URL.createObjectURL;
      document.querySelector('#save').onclick = () => {
        const url = URL.createObjectURL(new Blob(['fig-kiwi' + 'source '.repeat(40000)]));
        const a = document.createElement('a'); a.href = url; a.download = 'Owned source.fig';
        a.click(); URL.revokeObjectURL(url);
      };
      </script>`,
      }),
    );
    await page.goto(target.url);
    const result = await exportFigmaWebDocument(page, target, folder, {
      deadlineAt: Date.now() + 10_000,
    });
    expect((await readFile(join(folder, 'document.fig'))).toString()).toBe(
      'fig-kiwi' + 'source '.repeat(40000),
    );
    expect(result).toMatchObject({
      source: 'figma-web-native-export',
      fullCapture: false,
      requestedNodeId: '0:1',
      filename: 'Owned source.fig',
    });
    expect(
      await page.evaluate(() => {
        const stored = window as unknown as { originalClick: unknown; originalCreate: unknown };
        return (
          stored.originalClick === HTMLAnchorElement.prototype.click &&
          stored.originalCreate === URL.createObjectURL &&
          !Object.keys(window).some(key => key.startsWith('sfpExport'))
        );
      }),
    ).toBe(true);
    await page
      .getByRole('menuitem', { name: 'Save local copy' })
      .evaluate(element => element.setAttribute('disabled', ''));
    await expect(
      exportFigmaWebDocument(page, target, folder, { deadlineAt: Date.now() + 10_000 }),
    ).rejects.toThrow('FIGMA_WEB_EXPORT_UNAVAILABLE');
    expect(
      await page.evaluate(() => !Object.keys(window).some(key => key.startsWith('sfpExport'))),
    ).toBe(true);
    const cancelled = new AbortController();
    cancelled.abort(new Error('owner cancelled'));
    await expect(
      exportFigmaWebDocument(page, target, folder, {
        deadlineAt: Date.now() + 10_000,
        signal: cancelled.signal,
      }),
    ).rejects.toThrow('owner cancelled');
    await expect(
      exportFigmaWebDocument(
        page,
        parseFigmaTarget('https://www.figma.com/design/differentFileKey'),
        folder,
        { deadlineAt: Date.now() + 10_000 },
      ),
    ).rejects.toThrow('BROWSER_TARGET_CHANGED');
  } finally {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
  }
}, 30_000);

it('captures requested web copies, suppresses async clipboard writes and restores hooks on failure', async testContext => {
  const executablePath = googleChromeExecutable();
  requireChrome(testContext, executablePath);
  if (!executablePath) throw new Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const folder = await mkdtemp(join(tmpdir(), 'sfp-web-copy-'));
  const fromTemp = relative(tmpdir(), folder);
  if (!fromTemp || isAbsolute(fromTemp) || fromTemp.startsWith('..'))
    throw new Error('INVALID_FIXTURE_ROOT');
  const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const target = parseFigmaTarget('https://www.figma.com/design/ownedExportFixture?node-id=1-2');
    await page.route('https://www.figma.com/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><div role="treegrid"><div role="row" aria-selected="true">Selected fixture</div></div><button>Main menu</button><button role="menuitem">Edit</button>
      <button role="menuitem">Copy/Paste as</button><button role="menuitem" id="svg">Copy as SVG</button>
      <button role="menuitem" id="png">Copy as PNG</button><script>
      window.copies = 0;
      Object.defineProperty(navigator.clipboard, 'write', {configurable:true, value:async()=>{ window.copies++; }});
      Object.defineProperty(navigator.clipboard, 'writeText', {configurable:true, value:async()=>{ window.copies++; }});
      window.originalWrite = navigator.clipboard.write;
      window.originalText = navigator.clipboard.writeText;
      window.originalSetData = DataTransfer.prototype.setData;
      window.originalExec = Document.prototype.execCommand;
      window.mode = 'text';
      window.addEventListener('keydown', event => { if(event.key === 'Escape') window.mode = 'wrong'; });
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><path d="M0 0L2 3"/></svg>';
      document.querySelector('#svg').onclick = () => {
        if (window.mode === 'legacy') new DataTransfer().setData('text/plain', svg);
        else if (window.mode === 'legacy-alias') new DataTransfer().setData('text', svg);
        else if (window.mode === 'selected-text') { const text=document.createElement('textarea');text.value=svg;document.body.append(text);text.select();document.execCommand('copy');text.remove(); }
        else if (window.mode === 'wrong') navigator.clipboard.writeText('unrelated text');
        else if (window.mode === 'changed') {history.replaceState({}, '', '?node-id=9-9'); navigator.clipboard.writeText(svg);}
        else if (window.mode === 'delayed') navigator.clipboard.write([
          new ClipboardItem({'image/svg+xml':new Blob([svg],{type:'image/svg+xml'})}),
          {types:['image/svg+xml'],getType:async()=>{await new Promise(r=>setTimeout(r,600));return new Blob([svg],{type:'image/svg+xml'});}}
        ]);
        else navigator.clipboard.writeText(svg);
      };
      document.querySelector('#png').onclick = () => {
        const canvas = document.createElement('canvas'); canvas.width=4; canvas.height=6;
        canvas.toBlob(blob => navigator.clipboard.write([new ClipboardItem({'image/png':blob})]));
      };
      </script>`,
      }),
    );
    await page.goto(target.url);
    const svg = await copyFigmaWebAsset(page, target, 'svg', folder, {
      deadlineAt: Date.now() + 10_000,
    });
    expect((await readFile(join(folder, svg.path))).toString()).toContain('<path d="M0 0L2 3"/>');
    expect(svg).toMatchObject({
      source: 'figma-web-copy',
      nodeId: '1:2',
      format: 'svg',
      fullAssetAcceptance: false,
    });
    const png = await copyFigmaWebAsset(page, target, 'png', folder, {
      deadlineAt: Date.now() + 10_000,
    });
    expect(png).toMatchObject({ format: 'png', width: 4, height: 6 });
    await page.evaluate(() => {
      (window as unknown as { mode: string }).mode = 'legacy';
    });
    await copyFigmaWebAsset(page, target, 'svg', folder, { deadlineAt: Date.now() + 10_000 });
    await page.evaluate(() => {
      (window as unknown as { mode: string }).mode = 'selected-text';
    });
    await copyFigmaWebAsset(page, target, 'svg', folder, { deadlineAt: Date.now() + 1_500 });
    await page.evaluate(() => {
      (window as unknown as { mode: string }).mode = 'legacy-alias';
    });
    await copyFigmaWebAsset(page, target, 'svg', folder, { deadlineAt: Date.now() + 1_500 });
    expect(
      await page.evaluate(() => {
        const w = window as unknown as {
          copies: number;
          originalWrite: unknown;
          originalText: unknown;
          originalSetData: unknown;
          originalExec: unknown;
        };
        return {
          copies: w.copies,
          restored:
            navigator.clipboard.write === w.originalWrite &&
            navigator.clipboard.writeText === w.originalText &&
            DataTransfer.prototype.setData === w.originalSetData &&
            Document.prototype.execCommand === w.originalExec,
        };
      }),
    ).toEqual({ copies: 0, restored: true });
    await page.evaluate(() => {
      (window as unknown as { mode: string }).mode = 'wrong';
    });
    await expect(
      copyFigmaWebAsset(page, target, 'svg', folder, { deadlineAt: Date.now() + 700 }),
    ).rejects.toThrow('FIGMA_WEB_COPY_TIMEOUT');
    expect(
      await page.evaluate(() => Object.keys(window).filter(key => key.startsWith('sfpCopy'))),
    ).toEqual([]);
    await page.evaluate(() => {
      (window as unknown as { mode: string }).mode = 'delayed';
    });
    await expect(
      copyFigmaWebAsset(page, target, 'svg', folder, { deadlineAt: Date.now() + 10_000 }),
    ).rejects.toThrow('FIGMA_WEB_COPY_AMBIGUOUS');
    await page.evaluate(() => {
      (window as unknown as { mode: string }).mode = 'changed';
    });
    await expect(
      copyFigmaWebAsset(page, target, 'svg', folder, { deadlineAt: Date.now() + 10_000 }),
    ).rejects.toThrow('FIGMA_WEB_COPY_SELECTION_CHANGED');
    await expect(
      copyFigmaWebAsset(page, target, 'png', folder, { deadlineAt: Date.now() + 10_000 }),
    ).rejects.toThrow('FIGMA_WEB_COPY_SELECTION_CHANGED');
  } finally {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
  }
}, 30_000);

it('bounds a stalled copy renderer without reading or writing the clipboard', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sfp-copy-deadline-'));
  const fromTemp = relative(tmpdir(), folder);
  if (!fromTemp || isAbsolute(fromTemp) || fromTemp.startsWith('..'))
    throw new Error('INVALID_FIXTURE_ROOT');
  const target = parseFigmaTarget('https://www.figma.com/design/ownedExportFixture?node-id=1-2');
  const locator = {
    getByRole: () => locator,
    evaluateAll: () => new Promise(() => {}),
    ariaSnapshot: async () => '',
  };
  const page = {
    url: () => target.url,
    getByRole: () => locator,
    locator: () => locator,
    evaluate: () => new Promise(() => {}),
  } as unknown as Page;
  try {
    await expect(
      copyFigmaWebAsset(page, target, 'svg', folder, { deadlineAt: Date.now() + 25 }),
    ).rejects.toThrow('FIGMA_WEB_COPY_TIMEOUT');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}, 2_000);
