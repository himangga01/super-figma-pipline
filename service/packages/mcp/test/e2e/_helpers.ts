import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createError,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  ErrorCode,
  type HelloCredential,
  MIN_PLUGIN_VERSION,
  newId,
  PROTOCOL_VERSION,
  SystemMethod,
} from '@sfp/shared';
import { WebSocket } from 'ws';

import { Follower } from '../../src/election/follower.js';
import { attachLeaderEndpoints } from '../../src/election/leader-endpoints.js';
import { Node } from '../../src/election/node.js';
import { createFollowerAuthenticatedTransport } from '../../src/security/follower-transport.js';

export interface LeaderHarness {
  node: Node;
  follower: Follower;
  port: number;
  detach: () => void;
}

export const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(resolve => s.close(() => resolve()));
  return port;
};

export const startLeader = async (serverVersion = 'e2e-1.0.0'): Promise<LeaderHarness> => {
  const port = await freePort();
  const node = new Node({
    serverVersion,
    port,
    relayAuthenticator: {
      authenticateHello: async (_input, context) => ({
        sessionId: context.requestedSessionId,
        rotatedResumeToken: Buffer.alloc(32, 1).toString('base64url'),
        resumeExpiresAt: Date.now() + 60_000,
      }),
    },
  });
  const res = await node.becomeLeader();
  const credentials = {
    generation: Buffer.alloc(16, 11).toString('base64url'),
    followerToken: Buffer.alloc(32, 12).toString('base64url'),
    controlToken: Buffer.alloc(32, 13).toString('base64url'),
    createdAt: 1,
  };
  const transport = await createFollowerAuthenticatedTransport({
    leaderUrl: `http://127.0.0.1:${port}`,
    mcpSession: `mcp1_${Buffer.alloc(16, 14).toString('base64url')}`,
    memory: credentials,
  });
  const follower = new Follower({
    leaderUrl: `http://127.0.0.1:${port}`,
    transport: transport.client,
  });
  const detach = attachLeaderEndpoints(res.http, {
    relay: res.relay,
    serverVersion,
    leaderGeneration: credentials.generation,
    transport,
    pairing: {
      createChallenge: async () => ({
        challengeId: 'ABCDEFGHIJ',
        code: '12345678',
        expiresAt: Date.now() + 60_000,
        attemptsRemaining: 5,
      }),
      exchange: async () => ({
        wsTicket: 'AAAAAAAAAAAAAAAAAAAAAA',
        expiresAt: Date.now() + 30_000,
      }),
    },
  });
  return { node, follower, port, detach };
};

export const stopLeader = async (h: LeaderHarness): Promise<void> => {
  h.detach();
  await h.node.stop();
};

export interface FakePluginOptions {
  port: number;
  sessionId?: string;
  handlers: Record<string, (params: unknown) => unknown>;
  /** Defaults to a version the server is happy with; override to exercise the skew warning. */
  clientVersion?: string;
  credential?: HelloCredential;
}

export const connectFakePlugin = async (opts: FakePluginOptions): Promise<WebSocket> => {
  const sessionId = opts.sessionId ?? newId();
  const ws = new WebSocket(`ws://127.0.0.1:${opts.port}/ws`, { origin: 'null' });

  await new Promise<void>((resolve, reject) => {
    const helloId = 'fake-hello-1';
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off('error', onError);
      ws.off('close', onClose);
      ws.off('message', onMessage);
    };
    const onError = (err: Error): void => {
      cleanup();
      ws.close();
      reject(err);
    };
    const onClose = (code: number): void =>
      onError(new Error(`fake plugin closed during hello (${code})`));
    const onMessage = (raw: WebSocket.RawData): void => {
      try {
        const env = decodeEnvelope(raw as Uint8Array) as Envelope;
        if (env.id !== helloId) return;
        if (env.kind === 'err')
          return onError(new Error(`fake plugin hello rejected: ${env.error.code}`));
        if (env.kind === 'res') {
          cleanup();
          resolve();
        }
      } catch (error) {
        onError(error as Error);
      }
    };
    const timer = setTimeout(() => onError(new Error('fake plugin hello timed out')), 15_000);
    ws.once('error', onError);
    ws.once('close', onClose);
    ws.on('message', onMessage);
    ws.once('open', () => {
      ws.send(
        encodeEnvelope(
          createRequest({
            id: helloId,
            sessionId,
            method: SystemMethod.Hello,
            params: {
              credential: opts.credential ?? { kind: 'ticket', value: 'test-ticket' },
              nonce: Buffer.alloc(16, 2).toString('base64url'),
              protocolVersion: PROTOCOL_VERSION,
              productVersion: '0.1.0',
              // MIN_PLUGIN_VERSION is always accepted without a warning: the threshold actually
              // applied is capped at the server's own version, so this is never below it.
              pluginVersion: opts.clientVersion ?? MIN_PLUGIN_VERSION,
              pluginGeneration: 'plugin-generation-e2e',
              editorType: 'figma',
              mode: 'default',
              fileIdentity: { kind: 'figma-file-key', value: 'file-key-e2e' },
              fileName: 'E2E Test',
              capabilities: [],
            },
          }),
        ),
      );
    });
  });

  ws.on('message', raw => {
    const env = decodeEnvelope(raw as Uint8Array) as Envelope;
    if (env.kind !== 'req') return;
    if (env.method === SystemMethod.Ping) {
      ws.send(
        encodeEnvelope(
          createResponse({ id: env.id, sessionId: env.sessionId, result: { ok: true } }),
        ),
      );
      return;
    }
    const handler = opts.handlers[env.method];
    if (handler === undefined) {
      // What the real sandbox does for a method it has no handler for (see plugin dispatcher) —
      // the defining behaviour of a plugin older than the server's tool set. Staying silent here
      // would turn that case into a 15s timeout and hide whatever it was meant to prove.
      ws.send(
        encodeEnvelope(
          createError({
            id: env.id,
            sessionId: env.sessionId,
            code: ErrorCode.MethodNotFound,
            message: `no sandbox handler (method=${env.method})`,
          }),
        ),
      );
      return;
    }
    const result = handler(env.params);
    ws.send(encodeEnvelope(createResponse({ id: env.id, sessionId: env.sessionId, result })));
  });

  return ws;
};

export const closeSocket = (ws: WebSocket): void => {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
};
