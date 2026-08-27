import { describe, expect, it } from 'vitest';

import {
  BASE64_IMAGE_MAX_BYTES,
  DECODED_IMAGE_MAX_BYTES,
} from '../../src/security/request-limits.js';
import {
  handleImportImage,
  IMPORT_IMAGE_TOOL_NAME,
  type ToolDispatcher,
} from '../../src/tools/import-image.js';

describe('handleImportImage payload limits', () => {
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

  it('does not add a URL-fetch path while enforcing inline image limits', async () => {
    const dispatch: ToolDispatcher = async (tool, args) => ({ tool, args });
    await expect(
      handleImportImage(dispatch, { url: 'https://assets.example/image.png' }),
    ).resolves.toEqual({
      tool: IMPORT_IMAGE_TOOL_NAME,
      args: { url: 'https://assets.example/image.png' },
    });
  });
});
