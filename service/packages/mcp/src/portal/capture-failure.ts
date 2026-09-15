import { PortalCaptureFailureSchema, type PortalCaptureFailure } from '@sfp/shared';
import { z } from 'zod';

const schemaFields = new Set([
  'raw',
  'hash',
  'assetRoot',
  'assets',
  'capturedAt',
  'complete',
  'liveVerified',
  'query',
  'kind',
  'nodeId',
  'imageHash',
  'status',
  'path',
  'sha256',
  'bytes',
  'reason',
  'exportedFrom',
  'geometryHash',
]);

/** Only allowlisted categories cross the owner-state/public diagnostic boundary. */
export class PortalCaptureError extends Error {
  readonly diagnostic: PortalCaptureFailure;
  readonly code: PortalCaptureFailure['code'];
  constructor(stage: PortalCaptureFailure['stage'], cause: unknown, startedAt: number) {
    const observed =
      typeof cause === 'object' && cause !== null && 'code' in cause
        ? cause.code
        : cause instanceof Error
          ? cause.message.split(':')[0]
          : undefined;
    const code = PortalCaptureFailureSchema.shape.code.safeParse(observed);
    super(code.success ? code.data : 'DESIGN_CAPTURE_FAILED', { cause });
    this.name = 'PortalCaptureError';
    this.code = code.success ? code.data : 'DESIGN_CAPTURE_FAILED';
    this.diagnostic = PortalCaptureFailureSchema.parse({
      stage,
      code: this.code,
      type:
        cause instanceof z.ZodError
          ? 'schema-error'
          : cause instanceof TypeError
            ? 'type-error'
            : cause instanceof RangeError
              ? 'range-error'
              : cause instanceof SyntaxError
                ? 'syntax-error'
                : cause instanceof Error && cause.name === 'TimeoutError'
                  ? 'timeout-error'
                  : typeof observed === 'string' &&
                      ['EACCES', 'EPERM', 'ENOENT', 'EBUSY', 'ENOSPC', 'EEXIST'].includes(observed)
                    ? 'filesystem-error'
                    : cause instanceof Error
                      ? 'error'
                      : 'non-error',
      elapsedMs: Math.max(0, Math.min(3_600_000, Math.floor(Date.now() - startedAt))),
      ...(cause instanceof z.ZodError
        ? {
            schemaIssueCount: Math.min(100_000, cause.issues.length),
            schemaPaths: cause.issues.slice(0, 8).map(issue =>
              issue.path
                .slice(0, 16)
                .map(part =>
                  typeof part === 'number' ? '[]' : schemaFields.has(String(part)) ? part : '?',
                )
                .join('.')
                .slice(0, 256),
            ),
          }
        : {}),
    });
  }
}
