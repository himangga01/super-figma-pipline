import { HeartbeatMonitor } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

import { SessionManager } from '../../src/relay/session.js';

const fakeSocket = (): WebSocket => ({ close: () => {} }) as unknown as WebSocket;

describe('SessionManager.clear', () => {
  // Regression: Relay.stop() clears sessions before terminating sockets, so the socket-close path
  // (markDisconnected) early-returns and never stops the heartbeat. If clear() doesn't stop it
  // either, the leaked setInterval pins the event loop open and a shutting-down process lingers
  // as a zombie.
  it('stops session heartbeats so no interval outlives the manager', () => {
    vi.useFakeTimers();
    try {
      const manager = new SessionManager();
      const { session } = manager.register({
        id: 's1',
        socket: fakeSocket(),
        clientVersion: '0.0.0',
        pluginGeneration: 'generation-test',
        editorType: 'figma',
        mode: 'default',
        fileIdentity: { kind: 'figma-file-key', value: 'file-key-test' },
        fileName: 'Session Test',
        capabilities: [],
      });
      const sendPing = vi.fn<() => void>();
      session.heartbeat = new HeartbeatMonitor({
        intervalMs: 10,
        maxMisses: 2,
        sendPing,
        onTimeout: () => {},
      });
      session.heartbeat.start();

      manager.clear();

      vi.advanceTimersByTime(100);
      expect(sendPing).not.toHaveBeenCalled();
      expect(session.heartbeat).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });
});
