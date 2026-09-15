/* eslint-disable no-await-in-loop -- readiness polling is bounded by both the command deadline and each request timeout. */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import { assertOwnedPreviewListener } from './preview-listener.js';
import { assertNativePortalPreview, NativePreviewSchema } from './preview.js';

/** Byte-bounded LF framing; decode complete frames strictly, preserving split UTF-8 sequences. */
export class PreviewFrameDecoder {
  private readonly buffer: Buffer;
  private offset = 0;
  private frame = 0;
  private failed = false;
  constructor(private readonly limits: readonly number[]) {
    if (
      !limits.length ||
      limits.length > 2 ||
      limits.some(value => !Number.isSafeInteger(value) || value < 1 || value > 4194304)
    )
      throw Error('PORTAL_PREVIEW_CHANNEL_LIMIT');
    this.buffer = Buffer.allocUnsafe(Math.max(...limits));
  }
  push(chunk: Uint8Array): string[] {
    if (this.failed) throw Error('PORTAL_PREVIEW_CHANNEL_INVALID');
    const frames: string[] = [];
    try {
      let at = 0;
      while (at < chunk.length) {
        const limit = this.limits[this.frame];
        if (limit === undefined) throw Error('PORTAL_PREVIEW_CHANNEL_TRAILING_DATA');
        let end = at;
        while (end < chunk.length && chunk[end] !== 10) end++;
        const length = end - at;
        if (this.offset + length > limit) throw Error('PORTAL_PREVIEW_CHANNEL_LIMIT');
        this.buffer.set(chunk.subarray(at, end), this.offset);
        this.offset += length;
        if (end < chunk.length) {
          frames.push(
            new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
              this.buffer.subarray(0, this.offset),
            ),
          );
          this.offset = 0;
          this.frame++;
          end++;
        }
        at = end;
      }
      return frames;
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }
  complete(): void {
    if (this.failed || this.offset || this.frame !== this.limits.length)
      throw Error('PORTAL_PREVIEW_CHANNEL_TRUNCATED');
  }
}

/** The exact bootstrap is part of the approved command; it imports only the bound validator. */
export const NATIVE_PREVIEW_BOOTSTRAP =
  'const pipe=process.env.SFP_NATIVE_PREVIEW_PIPE,token=process.env.SFP_NATIVE_PREVIEW_TOKEN;delete process.env.SFP_NATIVE_PREVIEW_PIPE;delete process.env.SFP_NATIVE_PREVIEW_TOKEN;import(process.env.SFP_PORTAL_VALIDATOR_URL).then(m=>m.runNativePreviewWorker({pipe,token})).catch(e=>{process.stderr.write(String(e.code||e.message));process.exitCode=1})';
export const PreviewWorkerConfigSchema = z
  .object({
    protocol: z.literal('sfp-owned-preview-v1'),
    commandHash: z.string(),
    manifestHash: z.string(),
    serverArgs: z.array(z.string()).max(128),
    cwd: z.string(),
    timeoutMs: z.number().int().min(100).max(300000),
    spec: NativePreviewSchema,
  })
  .strict();
/** Runs as the broker's root. The application and Firefox inherit its Windows Job. */
export async function runNativePreviewWorker(credentials: { pipe: string; token: string }) {
  if (
    !/^sfp-preview-[a-f0-9-]{36}$/u.test(credentials.pipe ?? '') ||
    !/^[a-f0-9-]{36}$/u.test(credentials.token ?? '')
  )
    throw Error('PORTAL_PREVIEW_CHANNEL_REQUIRED');
  const socket = connect('\\\\.\\pipe\\' + credentials.pipe);
  let app: ReturnType<typeof spawn> | undefined;
  const controller = new AbortController();
  const onClose = () => controller.abort(Error('PORTAL_PREVIEW_PARENT_CLOSED'));
  socket.once('close', onClose);
  try {
    const config = await new Promise<z.infer<typeof PreviewWorkerConfigSchema>>(
      (resolve, reject) => {
        const decoder = new PreviewFrameDecoder([4194304]);
        let accepted = false;
        const timer = setTimeout(() => {
          const error = Error('PORTAL_PREVIEW_CHANNEL_TIMEOUT');
          controller.abort(error);
          socket.destroy();
          reject(error);
        }, 10000);
        socket.once('error', error => {
          clearTimeout(timer);
          controller.abort(error);
          reject(error);
        });
        socket.once('connect', () =>
          socket.write(
            JSON.stringify({ protocol: 'sfp-owned-preview-v1', token: credentials.token }) + '\n',
          ),
        );
        socket.on('data', chunk => {
          try {
            const frames = decoder.push(chunk);
            if (frames.length) {
              decoder.complete();
              if (accepted) throw Error('PORTAL_PREVIEW_CHANNEL_TRAILING_DATA');
              accepted = true;
              const parsed = PreviewWorkerConfigSchema.parse(JSON.parse(frames[0]!));
              clearTimeout(timer);
              resolve(parsed);
            }
          } catch (error) {
            clearTimeout(timer);
            controller.abort(error);
            socket.destroy();
            reject(error);
          }
        });
        socket.on('end', () => {
          try {
            decoder.complete();
          } catch (error) {
            clearTimeout(timer);
            controller.abort(error);
            reject(error);
          }
        });
      },
    );
    const timeout = setTimeout(
      () => controller.abort(Error('PORTAL_PREVIEW_TIMEOUT')),
      config.timeoutMs,
    );
    try {
      const environment = { ...process.env };
      delete environment.SFP_NATIVE_PREVIEW_PIPE;
      delete environment.SFP_NATIVE_PREVIEW_TOKEN;
      app = spawn(process.execPath, config.serverArgs, {
        cwd: config.cwd,
        env: environment,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      app.stdout?.on('data', chunk => process.stdout.write(chunk));
      app.stderr?.on('data', chunk => process.stderr.write(chunk));
      app.once('error', error => controller.abort(error));
      app.once('exit', () => controller.abort(Error('PORTAL_PREVIEW_SERVER_EXITED')));
      const deadline = Date.now() + Math.min(config.timeoutMs, 30000);
      while (true) {
        controller.signal.throwIfAborted();
        try {
          const response = await fetch(new URL(config.spec.screens[0]!.path, config.spec.baseUrl), {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(500)]),
          });
          await response.body?.cancel();
          break;
        } catch {
          controller.signal.throwIfAborted();
        }
        if (Date.now() >= deadline) throw Error('PORTAL_PREVIEW_SERVER_NOT_READY');
        await delay(100, undefined, { signal: controller.signal });
      }
      if (!app.pid) throw Error('PORTAL_PREVIEW_SERVER_PID_REQUIRED');
      const assertRunning = () => {
        controller.signal.throwIfAborted();
        if (app!.exitCode !== null || app!.signalCode !== null)
          throw Error('PORTAL_PREVIEW_SERVER_EXITED');
      };
      assertRunning();
      await assertOwnedPreviewListener(app.pid, config.spec.baseUrl);
      assertRunning();
      const report = await assertNativePortalPreview(config.spec, controller.signal, {
        emitReport: false,
      });
      controller.signal.throwIfAborted();
      await assertOwnedPreviewListener(app.pid, config.spec.baseUrl);
      const receipt = JSON.stringify({
        protocol: 'sfp-owned-preview-v1',
        commandHash: config.commandHash,
        manifestHash: config.manifestHash,
        listener: {
          protocol: 'windows-preview-listener-v1',
          pid: app.pid,
          endpoint: new URL(config.spec.baseUrl).origin,
          checks: 2,
        },
        report,
      });
      if (Buffer.byteLength(receipt) > 4194304) throw Error('PORTAL_PREVIEW_RECEIPT_LIMIT');
      await new Promise<void>((resolve, reject) =>
        socket.write(receipt + '\n', error => (error ? reject(error) : resolve())),
      );
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    // The Job broker drains descendants after this root exits, even if the server ignores kill.
    app?.kill();
    socket.removeListener('close', onClose);
    socket.end();
  }
}
