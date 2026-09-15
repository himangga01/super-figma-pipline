import { connect, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, it } from 'vitest';

import { createNativePreviewChannel } from '../../src/portal/preview-channel.js';
import { PreviewFrameDecoder } from '../../src/portal/preview-worker.js';
const config = {
  protocol: 'sfp-owned-preview-v1' as const,
  commandHash: 'command',
  manifestHash: 'manifest',
  serverArgs: ['check.mjs'],
  cwd: '.',
  timeoutMs: 1000,
  spec: {
    root: '.',
    baseUrl: 'http://127.0.0.1:1234',
    screens: [
      {
        id: 'one',
        path: '/',
        oraclePath: 'root.png',
        oracleHash: `sha256:${'a'.repeat(64)}`,
        viewport: { width: 100, height: 100 },
      },
    ],
  },
};
const attach = (pipe: string) =>
  new Promise<Socket>((resolve, reject) => {
    const socket = connect('\\\\.\\pipe\\' + pipe);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
it('rejects missing, wrong-token, duplicate and wrong-command receipts', async () => {
  for (const mode of ['missing', 'token', 'duplicate', 'command']) {
    const channel = await createNativePreviewChannel(config);
    let socket: Socket | undefined;
    try {
      if (mode !== 'missing') {
        socket = await attach(channel.environment.SFP_NATIVE_PREVIEW_PIPE);
        socket.on('error', () => {});
        socket.write(
          JSON.stringify({
            protocol: 'sfp-owned-preview-v1',
            token: mode === 'token' ? 'wrong' : channel.environment.SFP_NATIVE_PREVIEW_TOKEN,
          }) + '\n',
        );
        if (mode !== 'token') {
          await new Promise(done => socket!.once('data', done));
          const receipt =
            JSON.stringify({
              protocol: 'sfp-owned-preview-v1',
              commandHash: mode === 'command' ? 'wrong' : 'command',
              manifestHash: 'manifest',
              listener: {
                protocol: 'windows-preview-listener-v1',
                pid: 1,
                endpoint: 'http://127.0.0.1:1234',
                checks: 2,
              },
              report: {},
            }) + '\n';
          socket.end(mode === 'duplicate' ? receipt + receipt : receipt);
        }
        await delay(30);
      }
      expect(() => channel.result()).toThrow('PORTAL_PREVIEW_RECEIPT_REQUIRED');
    } finally {
      socket?.destroy();
      channel.close();
    }
  }
});
it('accepts one authenticated bound structured receipt independently of process stdout', async () => {
  const channel = await createNativePreviewChannel(config);
  const socket = await attach(channel.environment.SFP_NATIVE_PREVIEW_PIPE);
  try {
    socket.write(
      JSON.stringify({
        protocol: 'sfp-owned-preview-v1',
        token: channel.environment.SFP_NATIVE_PREVIEW_TOKEN,
      }) + '\n',
    );
    await new Promise(done => socket.once('data', done));
    socket.end(
      JSON.stringify({
        protocol: 'sfp-owned-preview-v1',
        commandHash: 'command',
        manifestHash: 'manifest',
        listener: {
          protocol: 'windows-preview-listener-v1',
          pid: 1,
          endpoint: 'http://127.0.0.1:1234',
          checks: 2,
        },
        report: { executed: true },
      }) + '\n',
    );
    await channel.finish();
    expect(channel.result().report).toEqual({ executed: true });
  } finally {
    socket.destroy();
    channel.close();
  }
});

it('preserves split Korean and emoji in authenticated receipts and rejects malformed UTF-8/trailing data', async () => {
  for (const mode of ['unicode', 'invalid', 'trailing']) {
    const channel = await createNativePreviewChannel(config),
      socket = await attach(channel.environment.SFP_NATIVE_PREVIEW_PIPE);
    socket.on('error', () => {});
    try {
      socket.write(
        JSON.stringify({
          protocol: 'sfp-owned-preview-v1',
          token: channel.environment.SFP_NATIVE_PREVIEW_TOKEN,
        }) + '\n',
      );
      await new Promise(done => socket.once('data', done));
      const bytes = Buffer.from(
        JSON.stringify({
          protocol: 'sfp-owned-preview-v1',
          commandHash: 'command',
          manifestHash: 'manifest',
          listener: {
            protocol: 'windows-preview-listener-v1',
            pid: 1,
            endpoint: 'http://127.0.0.1:1234',
            checks: 2,
          },
          report: { label: '상품🛒' },
        }) + '\n',
      );
      const split = bytes.indexOf(Buffer.from('상품')) + 1;
      if (mode === 'invalid') bytes[split] = 255;
      socket.write(bytes.subarray(0, split));
      await delay(20);
      socket.end(
        mode === 'trailing'
          ? Buffer.concat([bytes.subarray(split), Buffer.from('x')])
          : bytes.subarray(split),
      );
      const observed = await channel.finish().then(
        receipt => ({ label: receipt.report.label, error: null }),
        error => ({ label: null, error: error.message }),
      );
      expect(observed).toEqual(
        mode === 'unicode'
          ? { label: '상품🛒', error: null }
          : { label: null, error: 'PORTAL_PREVIEW_RECEIPT_REQUIRED' },
      );
    } finally {
      socket.destroy();
      channel.close();
    }
  }
});
it('uses the same strict byte framing for fragmented worker configuration and each bounded receipt frame', () => {
  const text = JSON.stringify({ ...config, serverArgs: ['check.mjs', '상품🛒'] });
  const encoded = Buffer.from(text + '\n'),
    decoder = new PreviewFrameDecoder([4194304]);
  let frames: string[] = [];
  for (const byte of encoded) frames.push(...decoder.push(Uint8Array.of(byte)));
  decoder.complete();
  expect(JSON.parse(frames[0]!).serverArgs).toEqual(['check.mjs', '상품🛒']);
  for (const bytes of [
    Buffer.from([0x22, 0xff, 0x22, 0x0a]),
    Buffer.from([0x22, 0xc0, 0xaf, 0x22, 0x0a]),
  ])
    expect(() => new PreviewFrameDecoder([128]).push(bytes)).toThrow(TypeError);
  const partial = new PreviewFrameDecoder([128]);
  partial.push(Buffer.from([0xe3, 0x81]));
  expect(() => partial.complete()).toThrow('PORTAL_PREVIEW_CHANNEL_TRUNCATED');
  expect(() => new PreviewFrameDecoder([5]).push(Buffer.from('한🛒\n'))).toThrow(
    'PORTAL_PREVIEW_CHANNEL_LIMIT',
  );
  expect(() => new PreviewFrameDecoder([128]).push(Buffer.from('{}\n{}\n'))).toThrow(
    'PORTAL_PREVIEW_CHANNEL_TRAILING_DATA',
  );
});
