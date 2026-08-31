import { createHash, timingSafeEqual } from 'node:crypto';

import type {
  NativeEvidenceContextHash,
  NativeEvidenceProjectionContextV1,
  NativeEvidenceProjectionV1,
  OperationEvidenceProjector,
  OperationKind,
  OperationName,
  VerifiedNativeEvidenceContextV1,
} from '@sfp/shared';

const zero = Buffer.from([0]);
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
  if (encoded === undefined) throw new Error('native evidence projection is not canonical JSON');
  return encoded;
};

export const nativeEvidenceContextHash = (
  context: Readonly<NativeEvidenceProjectionContextV1>,
): NativeEvidenceContextHash =>
  `sha256:${createHash('sha256')
    .update('sfp-native-evidence-context-v1', 'utf8')
    .update(zero)
    .update(canonicalJson({ operationId: context.operationId, workspaceId: context.workspaceId }))
    .digest('hex')}` as NativeEvidenceContextHash;

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const candidate = (
  candidateRelativePath: unknown,
  resultPointer: string,
  sourceNodeId: unknown,
) => ({
  candidateRelativePath:
    candidateRelativePath === null || typeof candidateRelativePath === 'string'
      ? candidateRelativePath
      : null,
  sourceRef: {
    resultPointer,
    sourceNodeId: typeof sourceNodeId === 'string' ? sourceNodeId : null,
  },
});

const exportCandidates = (operationName: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) return [];
  const record = result as Record<string, unknown>;
  if (operationName === 'save_screenshots' && Array.isArray(record.saved)) {
    return record.saved.map((row, index) => {
      const member =
        typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
      return candidate(member.path, `/saved/${index}/path`, member.nodeId);
    });
  }
  if (operationName === 'save_image_fills' && Array.isArray(record.nodes)) {
    return record.nodes.flatMap((row, nodeIndex) => {
      const node = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
      return Array.isArray(node.images)
        ? node.images.map((image, imageIndex) => {
            const member =
              typeof image === 'object' && image !== null ? (image as Record<string, unknown>) : {};
            return candidate(
              member.path,
              `/nodes/${nodeIndex}/images/${imageIndex}/path`,
              node.nodeId,
            );
          })
        : [];
    });
  }
  if (operationName === 'export_pdf' || operationName === 'export_video') {
    return [candidate(record.path, '/path', record.nodeId)];
  }
  return [];
};

export const createOperationEvidenceProjector = (): OperationEvidenceProjector =>
  Object.freeze({
    project: (
      context: Readonly<NativeEvidenceProjectionContextV1>,
      operationKind: OperationKind,
      operationName: OperationName,
      _parsedArgs: unknown,
      strictRedactedResult: unknown,
    ): Readonly<NativeEvidenceProjectionV1> => {
      const contextHash = nativeEvidenceContextHash(context);
      const isExporter =
        operationKind === 'tool' &&
        ['save_screenshots', 'save_image_fills', 'export_pdf', 'export_video'].includes(
          operationName,
        );
      return deepFreeze(
        isExporter
          ? {
              contextHash,
              kind: 'export-candidates' as const,
              candidates: exportCandidates(operationName, strictRedactedResult),
            }
          : {
              contextHash,
              kind: 'no-artifact' as const,
              reasonCode: 'not-native-evidence' as const,
            },
      ) as Readonly<NativeEvidenceProjectionV1>;
    },
  });

export const verifyNativeEvidenceContext = (
  context: Readonly<NativeEvidenceProjectionContextV1>,
  projection: Readonly<NativeEvidenceProjectionV1>,
): VerifiedNativeEvidenceContextV1 => {
  const expected = nativeEvidenceContextHash(context);
  const left = Buffer.from(expected, 'ascii');
  const right = Buffer.from(projection.contextHash, 'ascii');
  if (left.byteLength !== right.byteLength || !timingSafeEqual(left, right)) {
    throw Object.assign(new Error('native evidence context does not match its projection'), {
      code: 'NATIVE_EVIDENCE_CONTEXT_INVALID',
    });
  }
  return Object.freeze({
    operationId: context.operationId,
    workspaceId: context.workspaceId,
    contextHash: expected,
  }) as VerifiedNativeEvidenceContextV1;
};
