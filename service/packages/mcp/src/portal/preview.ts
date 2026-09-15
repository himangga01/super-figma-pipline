import { join, resolve } from 'node:path';
/* eslint-disable no-await-in-loop -- screens and user actions require deterministic sequential execution */
import { inflateSync } from 'node:zlib';

import pngModule from '@pdf-lib/upng';
import { contentHash, storedChecksum } from '@sfp/ir';
import { PortalHashSchema, PortalPathSchema } from '@sfp/shared';
import { firefox, type Page } from 'playwright';
import { z } from 'zod';

import {
  PortalConsumptionBatchSchema,
  PortalConsumptionReportSchema,
  type PortalConsumptionObservation,
} from '../../../shared/src/portal-consumption.js';
import {
  PortalObservationManifestSchema,
  PortalInteractionContractSchema,
} from '../../../shared/src/portal-observations.js';
import {
  AtomicFileStore,
  readFileWithinLimit,
  withRetainedDirectoryChain,
} from '../fs/atomic-file.js';
import {
  PortalConsumptionResources,
  consumptionBatchHash,
  observePortalConsumption,
  preparePortalConsumptionObserver,
} from './preview-consumption.js';
import { assertPortalSourceVisible, executePortalInteractions } from './preview-interactions.js';
import { portalError } from './store.js';

const png =
  'decode' in pngModule
    ? pngModule
    : (pngModule as unknown as { default: typeof pngModule }).default;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const decoded = (bytes: Uint8Array) => {
  const input = Buffer.from(bytes);
  if (input.length < 33 || !input.subarray(0, 8).equals(signature))
    throw portalError('PORTAL_PREVIEW_PNG_INVALID');
  const width = input.readUInt32BE(16),
    height = input.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 16384 || width * height > 20_000_000)
    throw portalError('PORTAL_PREVIEW_PIXEL_LIMIT');
  const chunks: Buffer[] = [signature],
    compressed: Buffer[] = [];
  let headers = 0,
    ended = false;
  for (let at = 8; at < input.length;) {
    if (at + 12 > input.length) throw portalError('PORTAL_PREVIEW_PNG_INVALID');
    const size = input.readUInt32BE(at),
      end = at + 12 + size,
      type = input.toString('ascii', at + 4, at + 8);
    if (end > input.length || type === 'acTL') throw portalError('PORTAL_PREVIEW_PNG_INVALID');
    if (type === 'IHDR' && (++headers !== 1 || at !== 8 || size !== 13))
      throw portalError('PORTAL_PREVIEW_PNG_INVALID');
    if (type === 'IEND') {
      if (size !== 0 || end !== input.length) throw portalError('PORTAL_PREVIEW_PNG_INVALID');
      ended = true;
    }
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type))
      chunks.push(input.subarray(at, end));
    if (type === 'IDAT') compressed.push(input.subarray(at + 8, end - 4));
    at = end;
  }
  if (headers !== 1 || !ended) throw portalError('PORTAL_PREVIEW_PNG_INVALID');
  // Bound decompression before passing critical image chunks to the PNG codec.
  inflateSync(Buffer.concat(compressed), { maxOutputLength: (width * 8 + 8) * (height + 8) });
  const cleaned = Buffer.concat(chunks),
    image = png.decode(
      cleaned.buffer.slice(cleaned.byteOffset, cleaned.byteOffset + cleaned.byteLength),
    );
  return { width, height, rgba: new Uint8Array(png.toRGBA8(image)[0]!) };
};

export const comparePortalPng = (expected: Uint8Array, actual: Uint8Array, tolerance = 12) => {
  const left = decoded(expected),
    right = decoded(actual);
  if (left.width !== right.width || left.height !== right.height)
    return {
      sameDimensions: false,
      width: left.width,
      height: left.height,
      actualWidth: right.width,
      actualHeight: right.height,
      differingPixels: left.width * left.height,
      ratio: 1,
      diff: null,
    };
  const diff = new Uint8Array(left.rgba.length);
  let changed = 0;
  for (let at = 0; at < diff.length; at += 4) {
    // Composite transparent pixels onto the same white page before comparing RGB channels.
    let different = false;
    for (let channel = 0; channel < 3; channel++) {
      const a = (left.rgba[at + channel]! * left.rgba[at + 3]!) / 255 + 255 - left.rgba[at + 3]!;
      const b = (right.rgba[at + channel]! * right.rgba[at + 3]!) / 255 + 255 - right.rgba[at + 3]!;
      if (Math.abs(a - b) > tolerance) different = true;
    }
    if (different) {
      changed++;
      diff[at] = 255;
      diff[at + 2] = 128;
    } else {
      const gray = Math.round((right.rgba[at]! + right.rgba[at + 1]! + right.rgba[at + 2]!) / 3);
      diff[at] = gray;
      diff[at + 1] = gray;
      diff[at + 2] = gray;
    }
    diff[at + 3] = 255;
  }
  return {
    sameDimensions: true,
    width: left.width,
    height: left.height,
    actualWidth: right.width,
    actualHeight: right.height,
    differingPixels: changed,
    ratio: changed / (left.width * left.height),
    diff: new Uint8Array(png.encode([diff.buffer], left.width, left.height, 0)),
  };
};

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), selector: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('hover'), selector: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('fill'), selector: z.string().min(1), value: z.string() }).strict(),
  z.object({ kind: z.literal('select'), selector: z.string().min(1), value: z.string() }).strict(),
  z
    .object({ kind: z.literal('press'), selector: z.string().min(1), key: z.string().min(1) })
    .strict(),
  z.object({ kind: z.literal('text'), selector: z.string().min(1), value: z.string() }).strict(),
  z.object({ kind: z.literal('visible'), selector: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('hidden'), selector: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('focused'), selector: z.string().min(1) }).strict(),
]);
const runActions = async (
  page: Page,
  actions: z.infer<typeof ActionSchema>[],
  failures: string[],
  rootNodeId?: string,
) => {
  for (const action of actions) {
    const locator = page.locator(action.selector);
    if (
      action.selector.startsWith('[data-sfp-node=') &&
      ['click', 'hover', 'fill', 'select', 'press'].includes(action.kind)
    )
      await assertPortalSourceVisible(page, action.selector, rootNodeId);
    // eslint-disable-next-line no-await-in-loop -- exercise actual sequential user interactions
    if (action.kind === 'click') await locator.click();
    else if (action.kind === 'hover') await locator.hover();
    // eslint-disable-next-line no-await-in-loop -- form input must affect the running application
    else if (action.kind === 'fill') await locator.fill(action.value);
    else if (action.kind === 'select') await locator.selectOption(action.value);
    // eslint-disable-next-line no-await-in-loop -- includes keyboard-only workflow checks
    else if (action.kind === 'press') await locator.press(action.key);
    // eslint-disable-next-line no-await-in-loop -- asserted state is observed from the real page
    else {
      try {
        if (action.kind === 'visible') await locator.waitFor({ state: 'visible' });
        else if (action.kind === 'hidden') await locator.waitFor({ state: 'hidden' });
        else
          await page.waitForFunction(
            '({ selector, kind, value }) => { const element = document.querySelector(selector); return kind === "focused" ? element !== null && element === document.activeElement : element?.textContent?.trim() === value; }',
            {
              selector: action.selector,
              kind: action.kind,
              value: action.kind === 'text' ? action.value : null,
            },
            { timeout: 5000 },
          );
      } catch {
        failures.push(`ACTION_STATE_MISMATCH:${action.selector}`);
      }
    }
  }
};

export const NativePreviewSchema = z
  .object({
    consumption: PortalConsumptionBatchSchema.optional(),
    manifest: PortalObservationManifestSchema.optional(),
    interactionContract: PortalInteractionContractSchema.optional(),
    outputDirectory: PortalPathSchema.refine(value =>
      value.startsWith('.sfp-native-preview/'),
    ).optional(),
    root: z.string().min(1),
    baseUrl: z.url(),
    allowedOrigins: z.array(z.url()).max(32).default([]),
    assets: z
      .array(
        z
          .object({
            nodeId: z.string().min(1).max(512),
            path: PortalPathSchema,
            oraclePath: PortalPathSchema,
            oracleHash: PortalHashSchema,
            oracleRoot: z.string().optional(),
          })
          .strict(),
      )
      .max(128)
      .default([]),
    screens: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
            rootNodeId: z.string().min(1).max(512).optional(),
            state: z.string().min(1).max(512).optional(),
            assertionIds: z.array(z.string()).max(4096).default([]),
            workflowAssertions: z
              .array(
                z
                  .object({
                    requirementId: z.string().min(1).max(128),
                    actions: z.array(ActionSchema).min(2).max(128),
                  })
                  .strict(),
              )
              .max(128)
              .default([]),
            path: z.string().startsWith('/'),
            oraclePath: PortalPathSchema,
            oracleHash: PortalHashSchema,
            oracleRoot: z.string().optional(),
            viewport: z
              .object({
                width: z.number().int().min(100).max(4096),
                height: z.number().int().min(100).max(4096),
              })
              .strict(),
            fullPage: z.boolean().default(true),
            captureSelector: z.string().min(1).max(2048).optional(),
            maxDifferenceRatio: z.number().min(0).max(0.03).default(0.01),
            beforeActions: z.array(ActionSchema).max(128).default([]),
            actions: z.array(ActionSchema).max(128).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()
  .superRefine((value, ctx) => {
    const url = new URL(value.baseUrl);
    if (
      value.consumption &&
      (!value.manifest ||
        value.consumption.captureFingerprint !== value.manifest.captureFingerprint ||
        value.consumption.checks.some(
          check => !value.screens.some(screen => screen.rootNodeId === check.rootNodeId),
        ))
    )
      ctx.addIssue({ code: 'custom', message: 'PORTAL_CONSUMPTION_MANIFEST_BINDING_REQUIRED' });
    if (value.screens.some(screen => new URL(screen.path, value.baseUrl).origin !== url.origin))
      ctx.addIssue({
        code: 'custom',
        message: 'A screen must begin at the approved local application origin',
      });
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Preview the local native application, never the Figma Chrome session',
      });
    if (new Set(value.screens.map(screen => screen.id)).size !== value.screens.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate preview screen ID' });
  });

/** Call from a reviewed native validation harness after starting its real application. */
export const assertNativePortalPreview = async (
  input: unknown,
  signal?: AbortSignal,
  options: { emitReport?: boolean } = {},
) => {
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(300000)])
    : AbortSignal.timeout(300000);
  const spec = NativePreviewSchema.parse(input),
    root = resolve(spec.root),
    folder = join(root, spec.outputDirectory ?? '.sfp-native-preview');
  const executablePath = process.env.SFP_PORTAL_FIREFOX_EXECUTABLE;
  signal?.throwIfAborted();
  await preparePortalConsumptionObserver();
  const consumptionResources = spec.consumption
    ? new PortalConsumptionResources(new URL(spec.baseUrl).origin, signal)
    : null;
  const consumptionObservations: PortalConsumptionObservation[] = [];
  let consumptionBytes = 0;
  const retainConsumption = (observed: PortalConsumptionObservation[]) => {
    consumptionBytes += Buffer.byteLength(JSON.stringify(observed));
    if (consumptionBytes > 4194304) throw portalError('PORTAL_CONSUMPTION_REPORT_CAPACITY');
    consumptionObservations.push(...observed);
  };
  const browser = await firefox.launch({
    headless: true,
    timeout: 30000,
    ...(executablePath ? { executablePath } : {}),
  });
  const abort = () => {
    void browser.close().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const reports: Array<Record<string, unknown>> = [];
  if (
    spec.manifest &&
    (!spec.interactionContract ||
      contentHash('sfp-interaction-contract-v1', spec.interactionContract) !==
        spec.manifest.interactionContractHash)
  ) {
    await browser.close();
    throw portalError('PORTAL_PREVIEW_MANIFEST_CHANGED');
  }
  const allowed = new Set([
    new URL(spec.baseUrl).origin,
    ...spec.allowedOrigins.map(origin => new URL(origin).origin),
  ]);
  try {
    for (const screen of spec.screens) {
      signal?.throwIfAborted();
      const expected = spec.manifest?.screens.find(value => value.id === screen.id);
      if (
        spec.manifest &&
        (!expected ||
          expected.rootNodeId !== screen.rootNodeId ||
          expected.route !== screen.path ||
          expected.state !== screen.state ||
          JSON.stringify(expected.viewport) !== JSON.stringify(screen.viewport) ||
          expected.oracleHash !== screen.oracleHash ||
          JSON.stringify(expected.assertionIds) !== JSON.stringify(screen.assertionIds))
      )
        throw portalError('PORTAL_PREVIEW_MANIFEST_CHANGED');
      // eslint-disable-next-line no-await-in-loop -- each screen has its own deterministic viewport and session
      const context = await browser.newContext({
        viewport: screen.viewport,
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        ...(spec.consumption ? { serviceWorkers: 'block' as const } : {}),
      });
      try {
        const failures: string[] = [];
        context.setDefaultTimeout(5000);
        // eslint-disable-next-line no-await-in-loop -- native preview requests are explicit and separate from Figma access
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (
            route.request().isNavigationRequest() &&
            !route.request().frame().parentFrame() &&
            url.origin !== new URL(spec.baseUrl).origin
          )
            return route.abort('blockedbyclient');
          return allowed.has(url.origin) || ['data:', 'blob:'].includes(url.protocol)
            ? consumptionResources &&
              spec.consumption?.checks.some(check => check.expectation.kind === 'asset')
              ? consumptionResources.handle(route)
              : route.continue()
            : route.abort('blockedbyclient');
        });
        // eslint-disable-next-line no-await-in-loop -- a fresh preview page is Firefox, never a new Chrome tab
        const page = await context.newPage();
        page.on('pageerror', () => failures.push('UNHANDLED_PAGE_ERROR'));
        page.on('requestfailed', request => {
          if (['image', 'font', 'script', 'stylesheet'].includes(request.resourceType()))
            failures.push('BROKEN_ASSET_REQUEST');
        });
        page.on('response', response => {
          if (
            response.status() >= 400 &&
            ['image', 'font', 'script', 'stylesheet'].includes(response.request().resourceType())
          )
            failures.push('BROKEN_ASSET_RESPONSE');
        });
        // eslint-disable-next-line no-await-in-loop -- freeze date while allowing readiness and input events to settle
        await page.clock.setFixedTime(new Date('2026-01-01T12:00:00Z'));
        // eslint-disable-next-line no-await-in-loop -- owned local application readiness
        await page.goto(new URL(screen.path, spec.baseUrl).href, {
          waitUntil: 'networkidle',
          timeout: 30_000,
        });
        // eslint-disable-next-line no-await-in-loop -- normalization applies only to the validation page
        await page.addStyleTag({ content: 'html { scrollbar-width: none !important; }' });
        // eslint-disable-next-line no-await-in-loop -- wait for the real fonts used by the page
        await page.evaluate('document.fonts.ready');
        if (new URL(page.url()).origin !== new URL(spec.baseUrl).origin)
          throw portalError('PORTAL_PREVIEW_ORIGIN_MISMATCH');
        await runActions(page, screen.beforeActions, failures);
        if (new URL(page.url()).origin !== new URL(spec.baseUrl).origin)
          throw portalError('PORTAL_PREVIEW_ORIGIN_MISMATCH');
        if (expected) {
          if (
            new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash !==
            expected.route
          )
            failures.push('OBSERVATION_ROUTE_MISMATCH');
          const sourceRoot = page.locator(
            '[data-sfp-root=' + JSON.stringify(expected.rootNodeId) + ']',
          );
          if ((await sourceRoot.count()) !== 1 || !(await sourceRoot.isVisible()))
            failures.push('OBSERVATION_SOURCE_ROOT_NOT_VISIBLE');
        }
        if (spec.consumption && consumptionResources && expected) {
          const observed = await observePortalConsumption(
            page,
            spec.consumption,
            expected,
            'source',
            consumptionResources,
          );
          retainConsumption(observed);
          if (observed.some(value => !value.passed)) failures.push('PORTAL_CONSUMPTION_FAILED');
        }
        // eslint-disable-next-line no-await-in-loop -- compare the same initial visual state before exercising transitions
        const screenshotOptions = {
          type: 'png',
          animations: 'disabled',
          caret: 'hide',
        } as const;
        const actual = screen.captureSelector
          ? await page.locator(screen.captureSelector).screenshot(screenshotOptions)
          : await page.screenshot({ ...screenshotOptions, fullPage: screen.fullPage });
        const oracleRoot = resolve(screen.oracleRoot ?? process.env.SFP_FIGMA_ASSET_ROOT ?? root);
        // eslint-disable-next-line no-await-in-loop -- the reference is bound by the captured export digest
        const oracle = await readFileWithinLimit(join(oracleRoot, screen.oraclePath), 16_777_216);
        if (storedChecksum(oracle) !== screen.oracleHash)
          throw portalError('PORTAL_PREVIEW_ORACLE_CHANGED');
        const comparison = comparePortalPng(oracle, actual);
        // eslint-disable-next-line no-await-in-loop -- immutable evidence for this private working copy
        await withRetainedDirectoryChain(
          root,
          folder,
          async held => {
            const writer = new AtomicFileStore();
            await writer.createNew(held.child(`${screen.id}.actual.png`), actual);
            if (comparison.diff)
              await writer.createNew(held.child(`${screen.id}.diff.png`), comparison.diff);
          },
          { createMissing: true },
        );
        await runActions(page, screen.actions, failures);
        const interactionReports =
          expected && spec.interactionContract && spec.manifest
            ? await executePortalInteractions(
                page,
                spec.interactionContract,
                spec.manifest,
                expected,
              )
            : [];
        const workflowReports = [];
        for (const workflow of screen.workflowAssertions) {
          const source = spec.interactionContract?.workflows.find(
            value => value.id === workflow.requirementId,
          );
          if (
            !source ||
            !expected ||
            !source.rootIds.includes(expected.rootNodeId) ||
            !workflow.actions.some(value =>
              ['click', 'fill', 'select', 'press'].includes(value.kind),
            ) ||
            !workflow.actions.some(value =>
              ['text', 'visible', 'hidden', 'focused'].includes(value.kind),
            )
          )
            throw portalError('PORTAL_PREVIEW_WORKFLOW_BINDING_REQUIRED');
          for (const action of workflow.actions) {
            const match = /^\[data-sfp-node="([^"]+)"\]$/u.exec(action.selector);
            if (!match || !source.nodeIds.includes(match[1]!))
              throw portalError('PORTAL_PREVIEW_WORKFLOW_SOURCE_REQUIRED');
          }
          await page.goto(new URL(screen.path, spec.baseUrl).href, { waitUntil: 'networkidle' });
          const stateActions = workflow.actions.filter(action =>
            ['text', 'visible', 'hidden', 'focused'].includes(action.kind),
          );
          const observeStates = async () => {
            const states: unknown[] = [];
            for (const action of stateActions) {
              const locator = page.locator(action.selector);
              states.push(
                action.kind === 'text'
                  ? await locator.textContent().catch(() => null)
                  : action.kind === 'focused'
                    ? await page.evaluate(
                        'document.querySelector(' +
                          JSON.stringify(action.selector) +
                          ') === document.activeElement',
                      )
                    : await locator.isVisible(),
              );
            }
            return states;
          };
          const beforeStates = await observeStates();
          const issues: string[] = [];
          await runActions(page, workflow.actions, issues, expected.rootNodeId);
          if (JSON.stringify(beforeStates) === JSON.stringify(await observeStates()))
            issues.push('WORKFLOW_STATE_CHANGE_NOT_OBSERVED');
          workflowReports.push({
            requirementId: workflow.requirementId,
            passed: issues.length === 0,
            executedActions: workflow.actions.length,
          });
          failures.push(...issues);
        }
        if (interactionReports.some(value => !value.passed))
          failures.push('REQUIRED_INTERACTION_FAILED');
        if (spec.consumption && consumptionResources && expected) {
          const observed = await observePortalConsumption(
            page,
            spec.consumption,
            expected,
            'after-actions',
            consumptionResources,
          );
          retainConsumption(observed);
          if (observed.some(value => !value.passed)) failures.push('PORTAL_CONSUMPTION_FAILED');
        }
        // This is an explicit basic audit; a project's full accessibility suite belongs in its profile too.
        // eslint-disable-next-line no-await-in-loop -- report concrete DOM defects after interactions
        const accessibility = (await page.evaluate(
          `(() => { const issues=[]; if(!document.documentElement.lang) issues.push('MISSING_LANGUAGE'); if(!document.title.trim()) issues.push('MISSING_TITLE'); for(const image of document.images) { if(!image.hasAttribute('alt')) issues.push('IMAGE_ALT_MISSING'); if(!image.complete||image.naturalWidth===0) issues.push('BROKEN_IMAGE'); } for(const element of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')) if(!element.labels?.length&&!element.getAttribute('aria-label')&&!element.getAttribute('aria-labelledby')) issues.push('CONTROL_LABEL_MISSING'); for(const element of document.querySelectorAll('button,[role=button],a[href]')) if(!element.textContent.trim()&&!element.getAttribute('aria-label')&&!element.getAttribute('title')&&!element.querySelector('img[alt]')) issues.push('CONTROL_NAME_MISSING'); if(document.documentElement.scrollWidth>innerWidth+1) issues.push('HORIZONTAL_OVERFLOW'); return issues; })()`,
        )) as string[];
        failures.push(...accessibility);
        if (!comparison.sameDimensions || comparison.ratio > screen.maxDifferenceRatio)
          failures.push('VISUAL_MISMATCH');
        reports.push({
          id: screen.id,
          passed: failures.length === 0,
          failures,
          viewport: screen.viewport,
          ...(expected ? { observation: expected, interactionReports, workflowReports } : {}),
          captureSelector: screen.captureSelector ?? null,
          ratio: comparison.ratio,
          oracleHash: screen.oracleHash,
          actualHash: storedChecksum(actual),
          actualPath: `${spec.outputDirectory ?? '.sfp-native-preview'}/${screen.id}.actual.png`,
          diffPath: comparison.diff
            ? `${spec.outputDirectory ?? '.sfp-native-preview'}/${screen.id}.diff.png`
            : null,
          accessibilityCoverage: 'basic-dom-and-configured-keyboard-workflows',
        });
      } finally {
        // eslint-disable-next-line no-await-in-loop -- close only this owned validation context
        await context.close();
      }
    }
    const assetReports = [];
    for (const asset of spec.assets) {
      const oracleRoot = resolve(asset.oracleRoot ?? process.env.SFP_FIGMA_ASSET_ROOT ?? root);
      const [expected, actual] = await Promise.all([
        readFileWithinLimit(join(oracleRoot, asset.oraclePath), 16_777_216),
        readFileWithinLimit(join(root, asset.path), 16_777_216),
      ]);
      if (
        storedChecksum(expected) !== asset.oracleHash ||
        storedChecksum(actual) !== asset.oracleHash
      )
        throw portalError('PORTAL_PREVIEW_ASSET_CHANGED');
      assetReports.push({
        nodeId: asset.nodeId,
        oracleHash: asset.oracleHash,
        actualHash: storedChecksum(actual),
        actualPath: asset.path,
      });
    }
    if (
      spec.consumption &&
      (consumptionObservations.length !== spec.consumption.checks.length ||
        new Set(consumptionObservations.map(value => value.checkId)).size !==
          consumptionObservations.length)
    )
      throw portalError('PORTAL_CONSUMPTION_COVERAGE_REQUIRED');
    const consumption = spec.consumption
      ? PortalConsumptionReportSchema.parse({
          version: 1,
          batchHash: consumptionBatchHash(spec.consumption),
          observations: consumptionObservations,
        })
      : undefined;
    const report = {
      ...(consumption ? { consumption } : {}),
      ...(spec.manifest
        ? { manifestHash: contentHash('sfp-observation-manifest-v1', spec.manifest) }
        : {}),
      browser: 'firefox',
      browserVersion: browser.version(),
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezone: 'UTC',
      screens: reports,
      assets: assetReports,
    };
    if (options.emitReport !== false)
      process.stdout.write(`SFP_PREVIEW_REPORT:${JSON.stringify(report)}\n`);
    if (reports.some(screenReport => screenReport.passed !== true))
      throw portalError('PORTAL_PREVIEW_FAILED');
    return report;
  } finally {
    signal?.removeEventListener('abort', abort);
    await browser.close();
  }
};
