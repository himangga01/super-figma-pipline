import { newId } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

import { handlePing } from '../../src/tools/ping.js';
import {
  closeSocket,
  connectFakePlugin,
  type LeaderHarness,
  startLeader,
  stopLeader,
} from './_helpers.js';

const harnesses: LeaderHarness[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets) closeSocket(ws);
  sockets.length = 0;
  await Promise.all(harnesses.map(stopLeader));
  harnesses.length = 0;
});

const track = (h: LeaderHarness): LeaderHarness => {
  harnesses.push(h);
  return h;
};
const trackSocket = (ws: WebSocket): WebSocket => {
  sockets.push(ws);
  return ws;
};

describe('e2e ping smoke test', () => {
  it('leader with no plugin connected returns server-only hop', async () => {
    const h = track(await startLeader());
    const result = await handlePing({
      node: h.node,
      follower: h.follower,
      serverVersion: 'e2e-1.0.0',
    });
    expect(result.hop).toBe('server-only');
    expect(result.plugin).toBeNull();
    expect(result.server.role).toBe('leader');
    expect(result.server.port).toBe(h.port);
  });

  it('probes the authenticated plugin connection without an unbound sandbox tool call', async () => {
    const h = track(await startLeader());
    const sandbox = vi.fn<() => unknown>(() => {
      throw new Error('unbound sandbox call');
    });
    trackSocket(
      await connectFakePlugin({
        port: h.port,
        handlers: { ping: sandbox },
      }),
    );

    const result = await handlePing({
      node: h.node,
      follower: h.follower,
      serverVersion: 'e2e-1.0.0',
    });
    expect(result.hop).toBe('e2e');
    expect(result.plugin).toEqual({ ok: true });
    expect(sandbox).not.toHaveBeenCalled();
  });

  it('end-to-end ping survives plugin disconnect+reconnect through session grace', async () => {
    const h = track(await startLeader());
    const sessionId = newId();

    const first = await connectFakePlugin({
      port: h.port,
      sessionId,
      handlers: {},
    });
    first.close();
    await new Promise(resolve => setTimeout(resolve, 20));

    trackSocket(
      await connectFakePlugin({
        port: h.port,
        sessionId,
        handlers: {},
      }),
    );

    const result = await handlePing({
      node: h.node,
      follower: h.follower,
      serverVersion: 'e2e-1.0.0',
    });
    expect(result.hop).toBe('e2e');
    expect(result.plugin).toEqual({ ok: true });
  });
});
