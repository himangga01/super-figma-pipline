import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  BASE64_IMAGE_MAX_BYTES,
  DECODED_IMAGE_MAX_BYTES,
} from '../../src/security/request-limits.js';
import {
  handleImportImage,
  importImageTool,
  type ToolDispatcher,
} from '../../src/tools/import-image.js';

describe('handleImportImage payload limits', () => {
  it('advertises a nonempty URL while preserving raw URL text for strict admission', () => {
    const schema = z.toJSONSchema(importImageTool.inputSchema, { unrepresentable: 'any' }) as {
      properties?: { url?: { minLength?: number } };
    };

    expect(schema.properties?.url?.minLength).toBe(1);
    expect(
      importImageTool.inputSchema.parse({ url: '  https://assets.example.com/a.png  ' }),
    ).toMatchObject({ url: '  https://assets.example.com/a.png  ' });
  });

  it('accepts the exact encoded and decoded caps before dispatch', async () => {
    let calls = 0;
    const dispatch: ToolDispatcher = async (_tool, args) => {
      calls += 1;
      return args;
    };
    const data = 'A'.repeat(BASE64_IMAGE_MAX_BYTES);
    await expect(handleImportImage(dispatch, { data })).resolves.toMatchObject({ data });
    expect(calls).toBe(1);
    expect(Buffer.byteLength(data, 'base64')).toBe(DECODED_IMAGE_MAX_BYTES);
  });

  it('returns PAYLOAD_TOO_LARGE before dispatch at encoded cap plus one quantum', async () => {
    let calls = 0;
    const dispatch: ToolDispatcher = async () => {
      calls += 1;
      return {};
    };
    await expect(
      handleImportImage(dispatch, { data: `${'A'.repeat(BASE64_IMAGE_MAX_BYTES)}AAAA` }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(calls).toBe(0);
  });

  it('fails closed instead of forwarding a URL when the daemon fetch boundary is absent', async () => {
    let calls = 0;
    const dispatch: ToolDispatcher = async () => {
      calls += 1;
      return {};
    };
    await expect(
      handleImportImage(dispatch, { url: 'https://assets.example/image.png' }),
    ).rejects.toMatchObject({ code: 'REMOTE_IMAGE_FETCHER_UNAVAILABLE' });
    expect(calls).toBe(0);
  });

  it('rejects fetched decoded bytes above 6 MiB before base64 encoding or dispatch', async () => {
    const oversized = new Uint8Array(DECODED_IMAGE_MAX_BYTES + 1);
    let dispatchCalls = 0;
    const bufferFrom = vi.spyOn(Buffer, 'from');
    try {
      await expect(
        handleImportImage(
          async () => {
            dispatchCalls += 1;
            return {};
          },
          { url: 'https://assets.example.com/image.png' },
          {
            domains: { list: async () => [{ fqdnAscii: 'assets.example.com' }] },
            fetcher: {
              fetchApproved: async () => ({
                bytes: oversized,
                mime: 'image/png',
                finalUrlHash: `sha256:${'a'.repeat(64)}`,
              }),
            },
            signal: new AbortController().signal,
          },
        ),
      ).rejects.toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        limit: DECODED_IMAGE_MAX_BYTES,
        observed: DECODED_IMAGE_MAX_BYTES + 1,
      });
      expect(bufferFrom.mock.calls.some(([value]) => value === oversized)).toBe(false);
      expect(dispatchCalls).toBe(0);
    } finally {
      bufferFrom.mockRestore();
    }
  });
});
