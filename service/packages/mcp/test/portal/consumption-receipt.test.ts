import { join } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import { expect, it } from 'vitest';
import { ZodError } from 'zod';

import { PortalObservationManifestSchema } from '../../../shared/src/portal-observations.js';
import { NativeProfileSchema, type NativeRunResult } from '../../src/portal/native-runner.js';
import { consumptionCheckHash } from '../../src/portal/preview-consumption.js';
import { verifyCoreConsumptionExecution } from '../../src/portal/recipes/consumption-receipt.js';
import {
  consumptionBatch,
  consumptionBatchHash,
  type CoreConsumptionCompilation,
} from '../../src/portal/recipes/core-consumption.js';

// These are protocol fixtures; the real owned-Chrome test verifies the independent pixel authority.
function fixture() {
  const hash = storedChecksum('retained controlled protocol fixture');
  const manifest = PortalObservationManifestSchema.parse({
    version: 1,
    captureFingerprint: hash,
    scopeHash: hash,
    interactionContractHash: hash,
    assets: [],
    screens: [
      {
        id: 'root',
        rootNodeId: '1:1',
        captureFingerprint: hash,
        scopeHash: hash,
        route: '/',
        state: 'source:1:1',
        viewport: { width: 100, height: 100 },
        deviceScaleFactor: 1,
        assertionIds: [],
        oracleHash: hash,
      },
    ],
  });
  const checks = ['first', 'second'].map(checkId => {
    const value = {
      checkId,
      resultId: 'result',
      resultHash: hash,
      rowId: checkId,
      rowHash: hash,
      rootNodeId: '1:1',
      route: '/',
      state: 'source:1:1',
      selector: 'main',
      phase: 'source' as const,
      expectation: {
        kind: 'property' as const,
        property: 'width' as const,
        value: { kind: 'number' as const, value: 100, unit: 'px' as const },
      },
    };
    return Object.assign(value, { expectedHash: consumptionCheckHash(value) });
  });
  const compiled = {
    hash,
    checks,
    proofs: [],
    pages: [],
    input: {
      plan: {
        ownerId: 'owner',
        workspaceId: 'workspace',
        blueprintHash: hash,
        coreRecipes: { contextHash: hash, requiredResults: [{ resultHash: hash }] },
        design: { capture: { designFingerprint: hash } },
      },
      run: { candidateHash: hash, coreDeclarationsHash: hash },
    },
    use: {
      prepared: {
        status: 'ready',
        compilationHash: hash,
        contextHash: hash,
        blueprintHash: hash,
        candidateHash: hash,
        declarationsHash: hash,
      },
    },
  } as unknown as CoreConsumptionCompilation;
  const batch = consumptionBatch(compiled, checks);
  const profile = NativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    id: 'preview',
    executionMode: 'native-working-copy',
    environmentKind: 'disposable-test',
    sourceHash: hash,
    closure: [{ path: 'index.html', hash }],
    environment: {},
    commands: [
      {
        id: 'preview',
        executable: process.execPath,
        executableHash: hash,
        args: [],
        timeoutMs: 1000,
        preview: {
          protocol: 'sfp-owned-preview-v1',
          spec: {
            root: '.',
            baseUrl: 'http://127.0.0.1:8080',
            manifest,
            screens: [
              {
                id: 'root',
                rootNodeId: '1:1',
                path: '/',
                viewport: { width: 100, height: 100 },
                oraclePath: 'oracle.png',
                oracleHash: hash,
              },
            ],
            consumption: batch,
          },
        },
      },
    ],
  });
  const observations = checks.map(check => {
    const { expectation: _expectation, selector: _selector, ...identity } = check;
    const actual = {
      kind: 'property',
      value: '100px',
      resourceHash: null,
      resourceBytes: null,
      resourceUrl: null,
      fontAvailable: null,
      sourceNodeId: null,
      dependency: null,
    };
    return Object.assign(identity, {
      actual,
      actualHash: contentHash('sfp-portal-consumption-actual-v1', actual),
      passed: true,
      reason: null,
    });
  });
  const commandHash = contentHash('sfp-native-command-v1', profile.commands[0]);
  const report = {
    browser: 'chrome',
    deviceScaleFactor: 1,
    manifestHash: contentHash('sfp-observation-manifest-v1', manifest),
    screens: [
      {
        id: 'root',
        observation: manifest.screens[0],
        passed: true,
        failures: [],
        oracleHash: hash,
        actualHash: hash,
      },
    ],
    consumption: { version: 1, batchHash: consumptionBatchHash(batch), observations },
  };
  const result = {
    profileId: profile.id,
    profileHash: contentHash('sfp-native-profile-v1', profile),
    sourceHash: hash,
    executionMode: 'native-working-copy',
    isolation: 'local-owner-account-no-os-sandbox',
    hostPlatform: process.platform,
    artifactAuthorityHash: hash,
    outputReceipts: [],
    commands: [
      {
        commandId: 'preview',
        commandHash,
        status: 'passed',
        exitCode: 0,
        signal: null,
        output: '',
        durationMs: 1,
        cleanup: 'finished',
        launchCommandHash: contentHash('sfp-native-command-v1', {
          ...profile.commands[0],
          args: [
            '--require',
            join('controlled-guard', 'preload.cjs'),
            ...profile.commands[0]!.args,
          ],
        }),
        moduleEvidence: { protocol: 'sfp-native-module-fence-v1', directory: 'controlled-guard' },
        previewReceipt: {
          protocol: 'sfp-owned-preview-v1',
          commandHash,
          manifestHash: report.manifestHash,
          listener: {
            protocol: 'windows-preview-listener-v1',
            pid: 1,
            endpoint: profile.commands[0]!.preview!.spec.baseUrl,
            checks: 2,
          },
          report,
        },
      },
    ],
  } as unknown as NativeRunResult;
  return {
    hash,
    compiled,
    profile,
    result,
    manifest,
    report,
    verify: (target: 'candidate' | 'applied' = 'candidate', visualVerified = true) =>
      verifyCoreConsumptionExecution(
        compiled,
        profile,
        result,
        manifest,
        target,
        hash,
        visualVerified,
      ),
  };
}

it('binds independently verified protocol observations to candidate and applied receipt targets', () => {
  const f = fixture();
  expect(f.verify()).toMatchObject({
    target: 'candidate',
    candidateHash: f.hash,
    verifierVersion: 'core-consumption-v1',
  });
  expect(f.verify('applied')).toMatchObject({ target: 'applied' });
  expect(() => f.verify('candidate', false)).toThrow('PORTAL_CONSUMPTION_VISUAL_PROOF_REQUIRED');
});

it.each([
  'missing',
  'reordered',
  'duplicate',
  'failed',
  'wrong-value',
  'wrong-kind',
  'stale-batch',
  'stale-command',
  'stale-source',
  'missing-channel',
  'wrong-browser',
])('rejects %s protocol evidence instead of issuing consumption acceptance', kind => {
  const f = fixture();
  const observations = f.report.consumption.observations;
  if (kind === 'missing') observations.pop();
  if (kind === 'reordered') observations.reverse();
  if (kind === 'duplicate') observations[1] = observations[0]!;
  if (kind === 'failed') observations[0]!.passed = false;
  if (kind === 'wrong-value' || kind === 'wrong-kind') {
    if (kind === 'wrong-value') observations[0]!.actual.value = '999px';
    else observations[0]!.actual.kind = 'asset';
    observations[0]!.actualHash = contentHash(
      'sfp-portal-consumption-actual-v1',
      observations[0]!.actual,
    );
  }
  if (kind === 'stale-batch') f.report.consumption.batchHash = storedChecksum('other batch');
  if (kind === 'stale-command') f.result.commands[0]!.commandHash = storedChecksum('other command');
  if (kind === 'stale-source') f.result.sourceHash = storedChecksum('other candidate');
  if (kind === 'missing-channel') delete f.result.commands[0]!.previewReceipt;
  if (kind === 'wrong-browser') f.report.browser = 'unsupported-browser';
  const rejection =
    kind === 'missing-channel' || kind === 'wrong-browser'
      ? ZodError
      : /(?:PORTAL|CORE)_CONSUMPTION_/u;
  expect(() => f.verify()).toThrow(rejection);
});
