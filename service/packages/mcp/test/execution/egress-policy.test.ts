import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createNoOutputEgressManifest,
  createOutcomeUnknownEgressManifest,
  createOutputEgressManifest,
  createPreExecutionConsentManifest,
  verifyEgressManifestHash,
} from '../../src/policy/egress-policy.js';

const hash = (value: string) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}` as const;

describe('durable egress manifest policy', () => {
  it('creates raw-free reciprocal pre and output manifests', () => {
    const pre = createPreExecutionConsentManifest({
      consentId: null,
      mode: 'local-trusted',
      inputClasses: ['design-text'],
      possibleResultClasses: ['public', 'design-text'],
      allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
      inputBytes: 12,
      inputTokens: 3,
    });
    const resultHash = hash('{"ok":true}');
    const output = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 11,
      outputTokens: 3,
      redactedFieldCount: 0,
      resultHash,
      resultBytes: 11,
      payloadHash: resultHash,
    });

    expect(verifyEgressManifestHash(pre)).toBe(true);
    expect(verifyEgressManifestHash(output)).toBe(true);
    expect(output.payloadHash).toBe(output.resultHash);
    expect(JSON.stringify([pre, output])).not.toMatch(/rawArgs|"result":\{|Secret layer/iu);
  });

  it('rejects output payload hashes that differ from the canonical result hash', () => {
    expect(() =>
      createOutputEgressManifest({
        preExecutionManifestHash: hash('pre'),
        resultClasses: ['public'],
        outputBytes: 2,
        outputTokens: 1,
        redactedFieldCount: 0,
        resultHash: hash('result'),
        resultBytes: 2,
        payloadHash: hash('different'),
      }),
    ).toThrowError(expect.objectContaining({ code: 'EGRESS_MANIFEST_INVALID' }));
  });

  it('keeps known-no-output and unknown outcomes distinct', () => {
    const preHash = hash('pre');
    const failed = createNoOutputEgressManifest({
      preExecutionManifestHash: preHash,
      reasonCode: 'runtime-failed',
    });
    const unknown = createOutcomeUnknownEgressManifest({
      preExecutionManifestHash: preHash,
      reasonCode: 'post-runtime-durability-failed',
      observedOutputBytes: null,
    });

    expect(failed).toMatchObject({ finalStatus: 'no-output', outputBytes: 0, outputTokens: 0 });
    expect(unknown).toMatchObject({ finalStatus: 'outcome-unknown', observedOutputBytes: null });
    expect(failed.manifestHash).not.toBe(unknown.manifestHash);
  });
});
