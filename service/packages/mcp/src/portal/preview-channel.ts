import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';

import { z } from 'zod';

import { PreviewWorkerConfigSchema, PreviewFrameDecoder } from './preview-worker.js';
import { portalError } from './store.js';
export const NativePreviewReceiptSchema = z
  .object({
    protocol: z.literal('sfp-owned-preview-v1'),
    commandHash: z.string(),
    manifestHash: z.string(),
    listener: z
      .object({
        protocol: z.literal('windows-preview-listener-v1'),
        pid: z.number().int().positive(),
        endpoint: z.url().max(2048),
        checks: z.literal(2),
      })
      .strict(),
    report: z.record(z.string(), z.unknown()),
  })
  .strict();
export type NativePreviewReceipt = z.infer<typeof NativePreviewReceiptSchema>;
/** Separate from stdout and unavailable in the candidate workspace. Same-account coordination. */
export async function createNativePreviewChannel(
  configuration: z.input<typeof PreviewWorkerConfigSchema>,
) {
  const config = PreviewWorkerConfigSchema.parse(configuration),
    token = randomUUID(),
    pipe = 'sfp-preview-' + randomUUID();
  const encoded = JSON.stringify(config);
  if (Buffer.byteLength(encoded) > 4194304) throw portalError('PORTAL_PREVIEW_CHANNEL_LIMIT');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen('\\\\.\\pipe\\' + pipe, resolve);
  });
  let connection: Socket | undefined,
    receipt: NativePreviewReceipt | undefined,
    error: unknown,
    authenticated = false,
    ended = false;
  let finishResolve!: () => void;
  const finished = new Promise<void>(resolve => {
    finishResolve = resolve;
  });
  server.on('connection', socket => {
    if (connection) {
      error = portalError('PORTAL_PREVIEW_DUPLICATE_CONNECTION');
      socket.destroy();
      return;
    }
    connection = socket;
    const decoder = new PreviewFrameDecoder([1024, 4194304]);
    socket.on('error', value => {
      error = value;
    });
    socket.on('data', chunk => {
      let lines: string[];
      try {
        lines = decoder.push(chunk);
      } catch (value) {
        error = value;
        socket.destroy();
        return;
      }
      for (const line of lines) {
        try {
          const value = JSON.parse(line);
          if (!authenticated) {
            if (
              value.protocol !== 'sfp-owned-preview-v1' ||
              value.token !== token ||
              Object.keys(value).length !== 2
            )
              throw portalError('PORTAL_PREVIEW_CHANNEL_AUTH');
            authenticated = true;
            socket.write(encoded + '\n');
          } else {
            if (receipt) throw portalError('PORTAL_PREVIEW_DUPLICATE_RECEIPT');
            const parsed = NativePreviewReceiptSchema.parse(value);
            if (
              parsed.commandHash !== config.commandHash ||
              parsed.manifestHash !== config.manifestHash ||
              parsed.listener.endpoint !== new URL(config.spec.baseUrl).origin
            )
              throw portalError('PORTAL_PREVIEW_RECEIPT_BINDING');
            receipt = parsed;
          }
        } catch (value) {
          error = value;
          socket.destroy();
        }
      }
    });
    socket.on('end', () => {
      try {
        decoder.complete();
        ended = true;
      } catch (value) {
        error = value;
      }
      finishResolve();
    });
    socket.on('close', () => {
      if (!ended && !error) error = portalError('PORTAL_PREVIEW_CHANNEL_TRUNCATED');
      finishResolve();
    });
  });
  const result = () => {
    if (error || !receipt || !ended) throw portalError('PORTAL_PREVIEW_RECEIPT_REQUIRED');
    return receipt;
  };
  return {
    environment: { SFP_NATIVE_PREVIEW_PIPE: pipe, SFP_NATIVE_PREVIEW_TOKEN: token },
    result,
    async finish() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          finished,
          new Promise<void>(resolve => {
            timer = setTimeout(resolve, 1000);
          }),
        ]);
        return result();
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      connection?.destroy();
      server.close();
    },
  };
}
