import { createServer } from 'node:net';

import { expect, it } from 'vitest';

import {
  assertOwnedPreviewListener,
  matchingPreviewListenerPids,
} from '../../src/portal/preview-listener.js';
it('binds real IPv4, IPv6 and localhost listeners to the actual owning PID', async () => {
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('ADDRESS');
      const url = `http://${host === '::1' ? '[::1]' : host}:${address.port}`;
      await assertOwnedPreviewListener(process.pid, url);
      await assertOwnedPreviewListener(process.pid, `http://localhost:${address.port}`);
      await expect(assertOwnedPreviewListener(process.pid + 100000, url)).rejects.toThrow(
        'PORTAL_PREVIEW_LISTENER_NOT_OWNED',
      );
    } finally {
      await new Promise<void>(done => server.close(() => done()));
    }
  }
}, 30000);
it('parses only the approved local endpoint and rejects unrelated remote/other-port/established rows', () => {
  const table =
    ' TCP 127.0.0.1:4000 0.0.0.0:0 LISTENING 12\n TCP [::1]:4000 [::]:0 LISTENING 13\n TCP 127.0.0.1:4001 0.0.0.0:0 LISTENING 14\n TCP 10.0.0.1:4000 0.0.0.0:0 LISTENING 15\n TCP 127.0.0.1:4000 1.1.1.1:4000 ESTABLISHED 16';
  expect(matchingPreviewListenerPids(table, 'http://127.0.0.1:4000')).toEqual([12]);
  expect(matchingPreviewListenerPids(table, 'http://[::1]:4000')).toEqual([13]);
  expect(matchingPreviewListenerPids(table, 'http://localhost:4000')).toEqual([12, 13]);
});
