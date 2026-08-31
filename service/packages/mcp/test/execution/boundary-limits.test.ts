import { appendFile, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INVOCATION_ADMISSION_LIMITS, measureCanonicalJsonUtf8Bytes } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvocationAdmissionController } from '../../src/execution/execution-plane.js';
import { readFileWithinLimit } from '../../src/fs/atomic-file.js';

const ownerId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const boundaryRoots: string[] = [];
afterEach(async () =>
  Promise.all(boundaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

describe('inclusive invocation admission limits', () => {
  it('admits exactly 256 owner operations and rejects the 257th without allocating a record', () => {
    const admission = new InvocationAdmissionController();
    const handles = Array.from(
      { length: INVOCATION_ADMISSION_LIMITS.maxActiveOperationsPerOwner },
      (_, index) =>
        admission.admit({
          ownerId,
          authSessionId: `auth-${index}`,
          requestId: `request-${index}`,
          rawArgsBytes: 0,
        }),
    );
    expect(handles).toHaveLength(256);
    expect(() =>
      admission.admit({
        ownerId,
        authSessionId: 'auth-over',
        requestId: 'request-over',
        rawArgsBytes: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SERVER_BUSY', admitted: false }));
    for (const handle of handles) handle.release();
  });

  it('accepts exact raw-args bytes and rejects the next byte before retention', () => {
    const admission = new InvocationAdmissionController();
    const exact = admission.admit({
      ownerId,
      authSessionId: 'auth-1',
      requestId: 'request-exact',
      rawArgsBytes: INVOCATION_ADMISSION_LIMITS.maxRawArgsBytesPerOperation,
    });
    expect(admission.retainedRawArgsBytes(ownerId)).toBe(8_388_608);
    exact.release();
    expect(() =>
      admission.admit({
        ownerId,
        authSessionId: 'auth-1',
        requestId: 'request-over',
        rawArgsBytes: INVOCATION_ADMISSION_LIMITS.maxRawArgsBytesPerOperation + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVOCATION_TOO_LARGE', admitted: false }));
  });

  it('treats an active duplicate request ID as a native conflict', () => {
    const admission = new InvocationAdmissionController();
    const first = admission.admit({
      ownerId,
      authSessionId: 'auth-1',
      requestId: 'request-1',
      rawArgsBytes: 1,
    });
    expect(() =>
      admission.admit({
        ownerId,
        authSessionId: 'auth-1',
        requestId: 'request-1',
        rawArgsBytes: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'REQUEST_ID_CONFLICT', admitted: false }));
    first.release();
  });

  it('rejects a sparse log above its declared cap before invoking the body reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-preallocation-cap-'));
    boundaryRoots.push(root);
    const path = join(root, 'oversized.jsonl');
    await writeFile(path, '');
    await truncate(path, 1_025);
    const read = vi.fn<() => Promise<Uint8Array>>(async () => new Uint8Array());

    await expect(readFileWithinLimit(path, 1_024, read)).rejects.toMatchObject({
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      beforeRead: true,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('measures direct raw args incrementally and rejects +1 before constructing serialized bytes', () => {
    expect(() => measureCanonicalJsonUtf8Bytes({ text: 'a'.repeat(1_025) }, 1_024)).toThrowError(
      expect.objectContaining({
        code: 'INVOCATION_TOO_LARGE',
        beforeAllocation: true,
      }),
    );
  });

  it('rechecks descriptor size immediately before a bounded read and rejects same-inode growth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-growth-cap-'));
    boundaryRoots.push(root);
    const path = join(root, 'growing.jsonl');
    await writeFile(path, Buffer.alloc(1_024));
    let bodyRead = false;

    await expect(
      (
        readFileWithinLimit as unknown as (
          path: string,
          maxBytes: number,
          reader: undefined,
          options: { beforeRead(): Promise<void> },
        ) => Promise<Uint8Array>
      )(path, 1_024, undefined, {
        beforeRead: async () => {
          await appendFile(path, Buffer.from([1]));
          bodyRead = true;
        },
      }),
    ).rejects.toMatchObject({
      code: 'FILE_SIZE_LIMIT_EXCEEDED',
      beforeRead: true,
    });
    expect(bodyRead).toBe(true);
  });
});
