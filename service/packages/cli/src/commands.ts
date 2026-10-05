import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { readFileWithinLimit } from '../../mcp/src/fs/atomic-file.js';
import { runAdminCommand } from './admin-commands.js';
import { createCaptureFolder, writeCapture, writeInspection } from './artifacts.js';
import { openChromeSession, observeFigmaPage } from './browser-session.js';
import { captureBrowserAssets, type CapturedAsset } from './capture-assets.js';
import { retainChromeFailure } from './chrome-diagnostics.js';
import { ControlClient } from './control-client.js';
import { assertDesktopTarget, readDesktopDesign } from './desktop-reader.js';
import { compareNativeImageAssets } from './figma-native-assets.js';
import { decodeFigmaNativeDocument, selectFigmaNativeNodes } from './figma-native-document.js';
import { normalizeFigmaNativeNodes, compareFigmaCaptureNodes } from './figma-native-nodes.js';
import { normalizeFigmaNativeStyles, compareFigmaStyleCatalogs } from './figma-native-styles.js';
import { parseFigmaTarget } from './figma-url.js';
import { exportFigmaWebDocument } from './figma-web-export.js';
import { runOfficialFigmaMcpCommand } from './official-figma-mcp-command.js';
import { prepareDesktopPlugin } from './plugin-bootstrap.js';
import { runPortalPlanCommand } from './portal-commands.js';
import { inspectProject } from './project-inspector.js';
import { BrowserReadQuerySchema } from './read-program.js';
import { readScripterSnapshot } from './scripter-reader.js';
import { ensureLocalServer } from './server-session.js';

export const parseCommand = (args: string[]) =>
  parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      url: { type: 'string' },
      workspace: { type: 'string' },
      out: { type: 'string' },
      input: { type: 'string' },
      reference: { type: 'string' },
      'reference-assets': { type: 'string' },
      cdp: { type: 'string' },
      open: { type: 'boolean', default: false },
      'allow-model-data': { type: 'boolean', default: false },
      scripter: { type: 'boolean', default: true },
      'ui-only': { type: 'boolean', default: false },
      wait: { type: 'string', default: '300' },
      depth: { type: 'string', default: '40' },
      'max-nodes': { type: 'string', default: '2000' },
      'node-id': { type: 'string' },
      'keep-open': { type: 'boolean', default: false },
      persistent: { type: 'boolean', default: false },
    },
  });

const seconds = (value: string | undefined): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 900)
    throw new Error('WAIT_INVALID: use 1 to 900 seconds');
  return n;
};

export const runCommand = async (args: string[], emit: (value: unknown) => void): Promise<void> => {
  if (await runOfficialFigmaMcpCommand(args, emit)) return;
  if (await runPortalPlanCommand(args, emit)) return;
  if (await runAdminCommand(args, emit)) return;
  const parsed = parseCommand(args);
  const command = parsed.positionals[0] ?? 'help';
  const opts = parsed.values;
  const precise = opts.scripter === true && !opts['ui-only'];
  if (precise && ['chrome-inspect', 'connect'].includes(command))
    BrowserReadQuerySchema.parse({
      nodeId: opts['node-id'] ?? null,
      depth: Number(opts.depth),
      maxNodes: Number(opts['max-nodes']),
    });
  if (command === 'help') {
    emit({
      commands: [
        'connect --url <figma-url> --allow-model-data [--workspace <path>] [--keep-open]',
        'desktop-prepare: prepare the bundled local Figma Desktop development plugin for manual import',
        'chrome-inspect --url <figma-url> [--open] [--workspace <path>] [--cdp http://127.0.0.1:9222] [--scripter] [--out <folder>]: --max-nodes is a 1..2000 per-query batch limit; snapshots continue across batches',
        'chrome-open --url <figma-url>: open a missing Figma tab through Playwright in the existing authorized Chrome',
        'chrome-tabs --url <figma-url>',
        'chrome-export --url <figma-url> [--open] [--out <folder>]: collect a native Figma Web document without Scripter',
        'chrome-decode --input <document.fig> --url <figma-url> [--out <folder>]: inspect native document structure; does not establish live capture',
        'chrome-compare --input <document.fig> --reference <design.json> --url <figma-url> [--reference-assets <assets.json>] [--out <folder>]',
        'figma-mcp config|probe|read [--endpoint <official-url>] [--url <figma-node-url>] [--tool <read-tool>] [--oauth-token-env <name>]',
        'status',
        'tools list | tools call <name> --args <JSON> [--workspace <path>] [--yes]',
        'workspace list|add|remove|default; egress status|allow|reset|audit; network list|add|remove',
        'approval list|decide; operations list|show|cancel|resolve|evidence; pair',
        'snapshot capture --args <JSON> --workspace <path> [--yes]',
        'grounding refresh --args <JSON> --workspace-id <id> [--yes]',
        'portal plan --args-file <request.json> --workspace <path> [--figma-session <id> | --figma-file-hash <hash> for retained Desktop]; portal run|next|status|cancel|resume <id>',
        'portal submit <id> --args-file <candidate.json>; portal profile --args-file <native-profile.json> [--yes]',
        'portal validate|apply <id> --args <JSON> [--yes]',
      ],
    });
    return;
  }
  const client = new ControlClient();
  if (command === 'desktop-prepare') {
    const server = await ensureLocalServer(client);
    try {
      const manifest = await prepareDesktopPlugin(client);
      emit({
        status: 'desktop-plugin-prepared',
        manifest,
        activationRequired: true,
        collector: 'bundled-service-plugin',
        externalScripterUiRequired: false,
        next: 'Import this manifest through Figma Desktop Plugins > Development, then run Super Figma Pipeline.',
      });
    } finally {
      await server.close();
    }
    return;
  }
  if (command === 'chrome-decode' || command === 'chrome-compare') {
    if (!opts.input || !opts.url) throw new Error('FIGMA_NATIVE_INPUT_REQUIRED');
    const target = parseFigmaTarget(opts.url);
    const bytes = await readFileWithinLimit(resolve(opts.input), 128 * 1024 * 1024);
    const decoded = decodeFigmaNativeDocument(bytes);
    if (command === 'chrome-compare') {
      if (!opts.reference) throw new Error('FIGMA_COMPARISON_REFERENCE_REQUIRED');
      const reference = JSON.parse(
        (await readFileWithinLimit(resolve(opts.reference), 16_777_216)).toString('utf8'),
      ) as { nodes?: unknown; styles?: unknown };
      if (!Array.isArray(reference.nodes)) throw new Error('FIGMA_COMPARISON_REFERENCE_INVALID');
      const native = normalizeFigmaNativeNodes(decoded.message, target.nodeId);
      const comparison = compareFigmaCaptureNodes(native.nodes, reference.nodes);
      const nativeStyles = normalizeFigmaNativeStyles(decoded.message);
      if (
        reference.styles !== undefined &&
        (reference.styles === null ||
          typeof reference.styles !== 'object' ||
          Array.isArray(reference.styles))
      )
        throw new Error('FIGMA_STYLE_REFERENCE_INVALID');
      const styles =
        reference.styles === undefined
          ? undefined
          : compareFigmaStyleCatalogs(nativeStyles, reference.styles as Record<string, unknown>);
      const assets = opts['reference-assets']
        ? compareNativeImageAssets(
            decoded.files,
            JSON.parse(
              (await readFileWithinLimit(resolve(opts['reference-assets']), 16_777_216)).toString(
                'utf8',
              ),
            ),
          )
        : undefined;
      const folder = await createCaptureFolder(
        opts.out ?? resolve('.sfp/inspections'),
        target.fileKey,
      );
      await writeCapture(folder, 'native-design.json', native);
      await writeCapture(folder, 'native-styles.json', nativeStyles);
      await writeCapture(folder, 'capture-comparison.json', {
        ...comparison,
        ...(assets ? { assets } : {}),
        ...(styles ? { styles } : {}),
      });
      emit({
        status: 'capture-values-compared',
        folder,
        expectedNodes: comparison.expectedNodes,
        actualNodes: comparison.actualNodes,
        missingNodes: comparison.missingNodes.length,
        extraNodes: comparison.extraNodes.length,
        comparedPositions: comparison.comparedPositions,
        unobservedPositions: comparison.unobservedPositions,
        differences: comparison.differenceCount,
        matchingFontRanges: comparison.fontRangeEvidence.filter(row => row.matches).length,
        differingFontRanges: comparison.fontRangeEvidence.filter(row => !row.matches).length,
        matchingImages: assets?.images.filter(row => row.status === 'match').length,
        styleCatalogs: Object.fromEntries(
          Object.entries(nativeStyles.catalogs).map(([kind, rows]) => [kind, rows.length]),
        ),
        comparedStylePositions: styles?.comparedPositions,
        styleDifferences: styles?.differences.length,
        ambiguousStyleNames: styles?.ambiguous.length,
        invalidNativeStyles: nativeStyles.invalid.length,
        fullCaptureAccepted: false,
      });
      return;
    }
    const nodes = Array.isArray(decoded.message.nodeChanges) ? decoded.message.nodeChanges : [];
    const scopeNodes = selectFigmaNativeNodes(decoded.message, opts['node-id'] ?? target.nodeId);
    const summary = {
      source: 'figma-native-document-decoder',
      fullCapture: false,
      requestedUrl: target.url,
      sourceBinding: 'caller-url-not-live-verification',
      formatVersion: decoded.version,
      definitions: decoded.schema.definitions.length,
      schemaStyleFields: decoded.schema.definitions
        .find(definition => definition.name === 'NodeChange')
        ?.fields.map(field => field.name)
        .filter(name => /style|font|group|transform|grow|corner/iu.test(name)),
      messageKeys: Object.keys(decoded.message),
      originFileKey: decoded.message.originFileKey,
      nodeCount: nodes.length,
      scopeCount: scopeNodes.length,
      archiveEntries: decoded.files.size,
      archiveNames: [...decoded.files.keys()].slice(0, 24),
      sample: JSON.parse(
        JSON.stringify(scopeNodes.slice(0, 8), (_key, value) =>
          value instanceof Uint8Array ? { byteLength: value.length } : value,
        ),
      ),
    };
    const folder = await createCaptureFolder(
      opts.out ?? resolve('.sfp/inspections'),
      target.fileKey,
    );
    await writeCapture(folder, 'native-summary.json', summary);
    emit({
      status: 'native-document-decoded',
      folder,
      fullCapture: false,
      formatVersion: decoded.version,
      nodeCount: nodes.length,
      scopeCount: scopeNodes.length,
      archiveEntries: decoded.files.size,
    });
    return;
  }
  if (command === 'status') {
    emit(await client.status());
    return;
  }
  if (
    !['connect', 'chrome-inspect', 'chrome-tabs', 'chrome-open', 'chrome-export'].includes(command)
  )
    throw new Error('COMMAND_UNKNOWN');
  const deadline = Date.now() + seconds(opts.wait) * 1_000;
  if (command === 'connect') {
    if (opts.url === undefined) throw new Error('FIGMA_URL_REQUIRED');
    const target = parseFigmaTarget(opts.url);
    const server = await ensureLocalServer(client);
    const controller = new AbortController();
    const stopped = () => controller.signal.aborted;
    const stop = () => {
      controller.abort();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      if (opts['allow-model-data']) await client.allowModelData();
      const workspaceId =
        opts.workspace === undefined ? null : await client.workspace(opts.workspace);
      const before = await client.status();
      const offered = new Set<string>();
      if (before.pairedPluginCount > 1) throw new Error('DESKTOP_TARGET_AMBIGUOUS');
      if (before.activePlugin === null)
        emit({
          status: 'plugin-start-required',
          manifest: await prepareDesktopPlugin(client),
          target: target.url,
          automaticPairing: true,
        });
      while (!stopped() && Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop -- wait for the user's desktop plugin to start
        const status = await client.status();
        if (status.activePlugin !== null) {
          if (status.pairedPluginCount !== 1) throw new Error('DESKTOP_TARGET_AMBIGUOUS');
          let sessionId: string;
          try {
            sessionId = assertDesktopTarget(status, target);
            if (opts.persistent && status.activePlugin.fileIdentityKind === 'unstable-readonly')
              throw new Error('DESKTOP_FILE_IDENTITY_UNVERIFIED: persistent identity requested');
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !error.message.startsWith('DESKTOP_FILE_IDENTITY_UNVERIFIED')
            )
              throw error;
            if (!offered.has(status.activePlugin.sessionId)) {
              offered.add(status.activePlugin.sessionId);
              // eslint-disable-next-line no-await-in-loop -- offer a concrete URL in the paired plugin's approval UI
              await client.request('/control/identity/offer', 'POST', {
                sessionId: status.activePlugin.sessionId,
                fileKey: target.fileKey,
                readOnly: !opts.persistent,
              });
              emit({
                status: 'file-confirmation-required',
                fileName: status.activePlugin.fileName,
                url: target.url,
              });
            }
            // eslint-disable-next-line no-await-in-loop -- wait for the confirmed identity to reconnect
            await delay(1_000);
            continue;
          }
          // eslint-disable-next-line no-await-in-loop -- pin all reads to the admitted plugin session
          const captured = await readDesktopDesign(
            client,
            sessionId,
            workspaceId,
            opts.workspace,
            opts['node-id'] ?? target.nodeId,
          );
          // eslint-disable-next-line no-await-in-loop -- verify the admitted file again before publication
          if (assertDesktopTarget(await client.status(), target) !== sessionId)
            throw new Error('DESKTOP_TARGET_CHANGED');
          // eslint-disable-next-line no-await-in-loop -- local artifact publication follows completed reads
          const folder = await createCaptureFolder(
            opts.out ?? resolve('.sfp/inspections'),
            target.fileKey,
          );
          // eslint-disable-next-line no-await-in-loop -- create one new observation artifact
          const path = await writeCapture(folder, 'desktop.json', {
            schemaVersion: 1,
            source: 'desktop-plugin',
            requestedUrl: target.url,
            fileUrlIdentityVerified: true,
            fileUrlVerification:
              status.activePlugin.fileIdentityKind === 'figma-file-key'
                ? 'native-file-key'
                : status.activePlugin.bindingVerifiedBy,
            ...captured,
            workspaceId,
          });
          // eslint-disable-next-line no-await-in-loop -- bind the completed desktop observation
          await writeInspection(
            folder,
            {
              source: 'desktop-plugin',
              target: {
                fileKey: target.fileKey,
                requestedUrl: target.url,
                nodeId: captured.scope.nodeId,
                pageId: captured.scope.pageId,
              },
              fidelity: {
                values: 'partial',
                assets: 'unavailable',
                code: captured.project === null ? 'unavailable' : 'captured',
                issues: [
                  'DESKTOP_SECTION_FIDELITY_REQUIRES_SNAPSHOT_CAPTURE',
                  'DESKTOP_ASSETS_REQUIRE_EXPORT_TOOL',
                ],
              },
            },
            ['desktop.json'],
          );
          emit({ status: 'connected', sessionId, fileName: status.activePlugin.fileName, path });
          if (opts['keep-open']) {
            while (!stopped()) {
              // eslint-disable-next-line no-await-in-loop -- intentional service lifetime
              await delay(500);
            }
          }
          return;
        }
        // eslint-disable-next-line no-await-in-loop -- bounded connection observation
        await delay(1_000);
      }
      if (!stopped())
        throw new Error(
          'PLUGIN_START_REQUIRED: import the generated manifest once and run Super Figma Pipeline in the target file',
        );
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      await server.close();
    }
    return;
  }
  const session = await openChromeSession({
    ...(opts.url === undefined ? {} : { url: opts.url }),
    ...(opts.cdp === undefined ? {} : { cdp: opts.cdp }),
    connectionTimeoutMs: Math.min(seconds(opts.wait) * 1_000, 300_000),
    ...(command === 'chrome-open' ||
    (['chrome-inspect', 'chrome-export'].includes(command) && opts.open)
      ? { openIfMissing: true }
      : {}),
  });
  const target = session.target;
  const chromeController = new AbortController();
  const cancelChrome = () => chromeController.abort(new Error('CHROME_CAPTURE_CANCELLED'));
  process.once('SIGINT', cancelChrome);
  process.once('SIGTERM', cancelChrome);
  let lastStatus = '';
  try {
    emit({
      status: 'attached-existing-chrome',
      cdpEndpoint: session.cdpEndpoint,
      url: session.page.url(),
      title: await session.page.title(),
    });
    if (command === 'chrome-tabs' || command === 'chrome-open') return;
    while (Date.now() < deadline) {
      chromeController.signal.throwIfAborted();
      // eslint-disable-next-line no-await-in-loop -- observe readiness without filling authentication forms
      const observation = await observeFigmaPage(session.page, target);
      if (observation.status !== lastStatus) {
        emit({
          status: observation.status,
          url: target.url,
          browser: 'external-playwright-chrome',
        });
        lastStatus = observation.status;
      }
      if (observation.status === 'access-required') throw new Error('FIGMA_ACCESS_REQUIRED');
      if (observation.status === 'ready' || (observation.status === 'guest-preview' && !precise)) {
        // eslint-disable-next-line no-await-in-loop -- a capture has one terminal publication
        const folder = await createCaptureFolder(
          opts.out ?? resolve('.sfp/inspections'),
          target.fileKey,
        );
        // eslint-disable-next-line no-await-in-loop -- capture the editor before opening any plugin overlay
        const screenshot = await session.page.screenshot({ type: 'png' });
        // eslint-disable-next-line no-await-in-loop -- capture order records which surface produced the image
        await writeCapture(folder, 'viewport.png', screenshot);
        // eslint-disable-next-line no-await-in-loop -- capture order is deterministic
        await writeCapture(folder, 'observation.json', observation);
        if (command === 'chrome-export') {
          // eslint-disable-next-line no-await-in-loop -- one selected source export after readiness
          const exported = await exportFigmaWebDocument(session.page, target, folder, {
            deadlineAt: deadline,
            signal: chromeController.signal,
          });
          emit({ status: 'document-exported', folder, ...exported });
          return;
        }
        let truncated: boolean | null = null;
        let assets: CapturedAsset[] = [];
        let capturedPageId: string | null = null;
        if (precise) {
          try {
            // eslint-disable-next-line no-await-in-loop -- precision capture is a bounded sequence of read-only scopes
            const design = await readScripterSnapshot(
              session.page,
              target,
              {
                nodeId: opts['node-id'] ?? target.nodeId,
                depth: Number(opts.depth),
                maxNodes: Number(opts['max-nodes']),
              },
              { deadlineAt: deadline, signal: chromeController.signal },
            );
            truncated = design.truncated;
            capturedPageId = design.pageId;
            emit({ status: 'collecting-assets', nodeCount: design.nodeCount });
            // eslint-disable-next-line no-await-in-loop -- export assets from the exact already observed file
            assets = await captureBrowserAssets(session.page, target, design.nodes, folder, {
              deadlineAt: deadline,
              signal: chromeController.signal,
              renderingComplete: !design.truncated,
            });
            // eslint-disable-next-line no-await-in-loop -- retain pending/unavailable assets too
            await writeCapture(folder, 'assets.json', assets);
            if (opts.workspace !== undefined) {
              // eslint-disable-next-line no-await-in-loop -- analyze only the explicitly supplied service workspace
              const project = await inspectProject(opts.workspace, design);
              // eslint-disable-next-line no-await-in-loop -- one capture owns its matching code evidence
              await writeCapture(folder, 'project.json', project);
            }
            // eslint-disable-next-line no-await-in-loop -- publish only the completed bounded read
            await writeCapture(folder, 'design.json', design);
          } catch (error) {
            // eslint-disable-next-line no-await-in-loop -- retain this failed attempt before reporting it
            await retainChromeFailure(session.page, folder, error);
            emit({
              status: 'partial',
              folder,
              exactDesignValues: false,
              error: error instanceof Error ? error.message : 'PRECISION_READ_FAILED',
            });
            throw error;
          }
        }
        if (!precise && opts.workspace !== undefined) {
          // eslint-disable-next-line no-await-in-loop -- UI-only captures can still inspect their target workspace
          const project = await inspectProject(opts.workspace);
          // eslint-disable-next-line no-await-in-loop -- publish the code evidence alongside the viewport
          await writeCapture(folder, 'project.json', project);
        }
        // eslint-disable-next-line no-await-in-loop -- publish the common connector handoff last
        await writeInspection(
          folder,
          {
            source: precise ? 'chrome-scripter' : 'chrome-ui',
            target: {
              fileKey: target.fileKey,
              requestedUrl: target.url,
              nodeId: opts['node-id'] ?? target.nodeId,
              pageId: capturedPageId,
            },
            fidelity: {
              values: !precise ? 'unavailable' : truncated ? 'partial' : 'captured',
              assets: !precise
                ? 'unavailable'
                : assets.some(asset => asset.status !== 'captured')
                  ? 'partial'
                  : 'captured',
              code: opts.workspace === undefined ? 'unavailable' : 'captured',
              issues: [
                ...(truncated ? ['DESIGN_CAPTURE_PARTIAL'] : []),
                ...(assets.some(asset => asset.status !== 'captured')
                  ? ['ASSET_CAPTURE_PARTIAL']
                  : []),
              ],
            },
          },
          [
            'viewport.png',
            'observation.json',
            ...(precise ? ['design.json', 'assets.json'] : []),
            ...(opts.workspace === undefined ? [] : ['project.json']),
          ],
        );
        emit({
          status: 'captured',
          folder,
          exactDesignValues: precise,
          truncated,
          source: precise ? 'figma-plugin-api-via-scripter' : 'playwright-chrome-ui',
        });
        if (opts['keep-open']) {
          // eslint-disable-next-line no-await-in-loop -- explicitly requested connection lifetime
          await new Promise<void>(done => {
            if (chromeController.signal.aborted) {
              done();
              return;
            }
            chromeController.signal.addEventListener('abort', () => done(), { once: true });
            session.context.once('close', () => done());
          });
        }
        return;
      }
      // eslint-disable-next-line no-await-in-loop -- observe the existing tab without changing authentication
      await delay(1_000);
    }
    throw new Error(
      lastStatus === 'login-required' || lastStatus === 'guest-preview'
        ? 'FIGMA_LOGIN_REQUIRED: sign in inside the existing Figma tab'
        : 'FIGMA_EDITOR_NOT_READY',
    );
  } finally {
    process.removeListener('SIGINT', cancelChrome);
    process.removeListener('SIGTERM', cancelChrome);
    await session.close();
  }
};
