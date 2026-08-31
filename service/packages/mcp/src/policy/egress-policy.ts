import { createHash } from 'node:crypto';

import {
  ALL_DATA_CLASSES,
  type DataClass,
  type EgressFinalManifest,
  type NoOutputEgressManifest,
  type OutcomeUnknownEgressManifest,
  type OutputEgressManifest,
  type PreExecutionConsentManifest,
  type PrefixedSha256,
} from '@sfp/shared';

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw manifestError('egress manifest is not canonical JSON');
  return encoded;
};

const manifestError = (message: string) =>
  Object.assign(new Error(message), { code: 'EGRESS_MANIFEST_INVALID' });

const hashManifest = (value: Record<string, unknown>): PrefixedSha256 =>
  `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;

const assertExactKeys = (value: object, expected: readonly string[]): void => {
  const actual = Object.keys(value).toSorted();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].toSorted())) {
    throw manifestError('egress manifest input contains unknown or missing fields');
  }
};

const canonicalClasses = (classes: readonly DataClass[]): readonly DataClass[] => {
  const ordered = ALL_DATA_CLASSES.filter(value => classes.includes(value));
  if (ordered.length !== classes.length || new Set(classes).size !== classes.length) {
    throw manifestError('egress data classes are not a unique authority subset');
  }
  return Object.freeze(ordered);
};

const count = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw manifestError(`${name} is invalid`);
  return value;
};

const withHash = <T extends Record<string, unknown>>(
  value: T,
): Readonly<T & { manifestHash: PrefixedSha256 }> =>
  Object.freeze({ ...value, manifestHash: hashManifest(value) });

export const createPreExecutionConsentManifest = (
  input: Omit<PreExecutionConsentManifest, 'manifestHash'>,
): Readonly<PreExecutionConsentManifest> => {
  assertExactKeys(input, [
    'consentId',
    'mode',
    'inputClasses',
    'possibleResultClasses',
    'allowedClasses',
    'inputBytes',
    'inputTokens',
  ]);
  if (!['local-trusted', 'external-model', 'unknown-fail-closed'].includes(input.mode)) {
    throw manifestError('egress mode is invalid');
  }
  return withHash({
    consentId: input.consentId,
    mode: input.mode,
    inputClasses: canonicalClasses(input.inputClasses),
    possibleResultClasses: canonicalClasses(input.possibleResultClasses),
    allowedClasses: canonicalClasses(input.allowedClasses),
    inputBytes: count(input.inputBytes, 'inputBytes'),
    inputTokens: count(input.inputTokens, 'inputTokens'),
  });
};

export const createOutputEgressManifest = (
  input: Omit<OutputEgressManifest, 'finalStatus' | 'manifestHash'>,
): Readonly<OutputEgressManifest> => {
  assertExactKeys(input, [
    'preExecutionManifestHash',
    'resultClasses',
    'outputBytes',
    'outputTokens',
    'redactedFieldCount',
    'resultHash',
    'resultBytes',
    'payloadHash',
  ]);
  if (input.payloadHash !== input.resultHash || input.outputBytes !== input.resultBytes) {
    throw manifestError('output manifest does not match canonical result bytes');
  }
  return withHash({
    preExecutionManifestHash: input.preExecutionManifestHash,
    finalStatus: 'output' as const,
    resultClasses: canonicalClasses(input.resultClasses),
    outputBytes: count(input.outputBytes, 'outputBytes'),
    outputTokens: count(input.outputTokens, 'outputTokens'),
    redactedFieldCount: count(input.redactedFieldCount, 'redactedFieldCount'),
    resultHash: input.resultHash,
    resultBytes: count(input.resultBytes, 'resultBytes'),
    payloadHash: input.payloadHash,
  });
};

export const createNoOutputEgressManifest = (
  input: Pick<NoOutputEgressManifest, 'preExecutionManifestHash' | 'reasonCode'>,
): Readonly<NoOutputEgressManifest> => {
  assertExactKeys(input, ['preExecutionManifestHash', 'reasonCode']);
  if (
    !['admission-rejected', 'runtime-failed', 'cancelled', 'deadline', 'no-result'].includes(
      input.reasonCode,
    )
  ) {
    throw manifestError('no-output reason is invalid');
  }
  return withHash({
    preExecutionManifestHash: input.preExecutionManifestHash,
    finalStatus: 'no-output' as const,
    reasonCode: input.reasonCode,
    outputBytes: 0 as const,
    outputTokens: 0 as const,
  });
};

export const createOutcomeUnknownEgressManifest = (
  input: Omit<OutcomeUnknownEgressManifest, 'finalStatus' | 'manifestHash'>,
): Readonly<OutcomeUnknownEgressManifest> => {
  assertExactKeys(input, ['preExecutionManifestHash', 'reasonCode', 'observedOutputBytes']);
  if (
    !['post-runtime-durability-failed', 'transport-lost', 'demotion', 'unknown'].includes(
      input.reasonCode,
    )
  ) {
    throw manifestError('outcome-unknown reason is invalid');
  }
  return withHash({
    preExecutionManifestHash: input.preExecutionManifestHash,
    finalStatus: 'outcome-unknown' as const,
    reasonCode: input.reasonCode,
    observedOutputBytes:
      input.observedOutputBytes === null
        ? null
        : count(input.observedOutputBytes, 'observedOutputBytes'),
  });
};

export const verifyEgressManifestHash = (
  manifest: PreExecutionConsentManifest | EgressFinalManifest,
): boolean => {
  if (!/^sha256:[0-9a-f]{64}$/u.test(manifest.manifestHash)) return false;
  const { manifestHash, ...withoutHash } = manifest;
  return hashManifest(withoutHash) === manifestHash;
};

export { canonicalJson as canonicalEgressJson };
