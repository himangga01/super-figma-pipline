import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { resolveExistingChromeEndpoint } from '../src/chrome-endpoint.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const part = relative(tmpdir(), root);
    if (!part || isAbsolute(part) || part.startsWith('..'))
      throw Error('Invalid discovery fixture root');
    await rm(root, { recursive: true, force: true });
  }
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-chrome-endpoint-'));
  roots.push(root);
  return { root, options: { environment: { SFP_CHROME_USER_DATA_DIR: root } } };
};
it('uses the exact existing browser websocket path rather than dropping its identifier', async () => {
  const value = await fixture();
  await writeFile(
    join(value.root, 'DevToolsActivePort'),
    '9222\n/devtools/browser/existing-browser-id\n',
  );
  expect(await resolveExistingChromeEndpoint(value.options)).toBe(
    'ws://127.0.0.1:9222/devtools/browser/existing-browser-id',
  );
});
it('retains channel discovery when the browser has not published a port record', async () => {
  const value = await fixture();
  expect(await resolveExistingChromeEndpoint(value.options)).toBe('chrome');
});
it('refuses malformed discovery content without allowing another host or URL', async () => {
  const value = await fixture();
  await writeFile(
    join(value.root, 'DevToolsActivePort'),
    '9222\n//remote.example/devtools/browser/token\n',
  );
  await expect(resolveExistingChromeEndpoint(value.options)).rejects.toThrow(
    'CHROME_CDP_RECORD_INVALID',
  );
});
