import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { derivePortalInteractionContract } from '../../src/portal/interaction-evidence.js';
import type { NativeRunResult } from '../../src/portal/native-runner.js';
import { preparePortalObservationManifest } from '../../src/portal/observation-manifest.js';
import { nativePreviewFeedback } from '../../src/portal/preview-feedback.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const captured = await currentCaptureFixture(value);
  const oracle = captured.captured.assets[0]!;
  const contract = derivePortalInteractionContract(captured.captured, []);
  const manifest = preparePortalObservationManifest(
    captured.captured,
    contract,
    [
      {
        id: 'root',
        rootNodeId: '1:1',
        path: '/',
        state: 'source:1:1',
        viewport: { width: 100, height: 100 },
        oracleHash: oracle.sha256!,
        assertionIds: [],
      },
    ],
    [],
    [],
  );
  const actual = Buffer.from('controlled actual PNG bytes');
  const diff = Buffer.from('controlled difference PNG bytes');
  const folder = join(value.workspaceRoot, '.sfp-native-preview/preview');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'root.actual.png'), actual);
  await writeFile(join(folder, 'root.diff.png'), diff);
  const commandHash = storedChecksum('controlled command');
  const manifestHash = contentHash('sfp-observation-manifest-v1', manifest);
  // This represents the already-authenticated channel seam, not a runtime acceptance receipt.
  const screen = {
    id: 'root',
    observation: manifest.screens[0],
    passed: false,
    failures: ['VISUAL_MISMATCH'],
    ratio: 1,
    oracleHash: oracle.sha256!,
    actualHash: storedChecksum(actual),
    diffHash: storedChecksum(diff),
    actualPath: '.sfp-native-preview/preview/root.actual.png',
    diffPath: '.sfp-native-preview/preview/root.diff.png',
  };
  const result = {
    commands: [
      {
        commandId: 'preview',
        commandHash,
        status: 'failed',
        previewReceipt: {
          protocol: 'sfp-owned-preview-v1',
          commandHash,
          manifestHash,
          listener: {
            protocol: 'windows-preview-listener-v1',
            pid: process.pid,
            endpoint: 'http://127.0.0.1:4123',
            checks: 2,
          },
          report: { browser: 'chrome', manifestHash, screens: [screen] },
        },
      },
    ],
  } as unknown as NativeRunResult;
  return { ...value, result, manifest, screen, folder };
}
it('retains authenticated failed comparison references and both image hashes', async () => {
  const value = await fixture();
  const feedback = await nativePreviewFeedback(
    value.result,
    value.manifest,
    value.workspaceRoot,
    new AbortController().signal,
  );
  expect(feedback).toMatchObject({
    artifactRoot: value.workspaceRoot,
    reports: [
      {
        commandStatus: 'failed',
        screens: [
          { passed: false, actualHash: value.screen.actualHash, diffHash: value.screen.diffHash },
        ],
      },
    ],
  });
});
it.each(['actual', 'diff', 'missing'] as const)(
  'rejects %s artifact changes after the worker receipt',
  async kind => {
    const value = await fixture();
    if (kind === 'missing') await unlink(join(value.folder, 'root.actual.png'));
    else await writeFile(join(value.folder, `root.${kind}.png`), 'changed after receipt');
    await expect(
      nativePreviewFeedback(
        value.result,
        value.manifest,
        value.workspaceRoot,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_PREVIEW_FEEDBACK_ARTIFACT_CHANGED' });
  },
);
it('rejects a path outside the owned command folder and a changed manifest binding', async () => {
  const value = await fixture();
  value.screen.actualPath = '../outside.png';
  await expect(
    nativePreviewFeedback(
      value.result,
      value.manifest,
      value.workspaceRoot,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_PREVIEW_FEEDBACK_ARTIFACT_BINDING' });
  value.screen.actualPath = '.sfp-native-preview/preview/root.actual.png';
  value.result.commands[0]!.previewReceipt!.manifestHash = storedChecksum('changed');
  await expect(
    nativePreviewFeedback(
      value.result,
      value.manifest,
      value.workspaceRoot,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_PREVIEW_FEEDBACK_BINDING' });
});
