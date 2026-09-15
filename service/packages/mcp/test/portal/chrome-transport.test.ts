import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { createRetainedChromeTransport } from '../../src/portal/chrome-transport.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).toReversed()) await close();
});
const fakeChrome = async (initiallyAllowed = true) => {
  const server = createServer();
  const sockets = new WebSocketServer({ noServer: true });
  const tcp = new Set<Socket>();
  const commands: Array<Record<string, any>> = [];
  let attempts = 0;
  const grants: Array<() => void> = [];
  let signalAttempt!: () => void;
  const attempted = new Promise<void>(resolve => {
    signalAttempt = resolve;
  });
  server.on('connection', socket => {
    tcp.add(socket);
    socket.on('close', () => tcp.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    attempts++;
    signalAttempt();
    const grant = () =>
      sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
    if (initiallyAllowed) grant();
    else grants.push(grant);
  });
  sockets.on('connection', socket =>
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      commands.push(message);
      socket.send(
        JSON.stringify({
          id: message.id,
          ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          result: message.method === 'Browser.getVersion' ? { product: 'FixtureChrome' } : {},
        }),
      );
    }),
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  cleanups.push(async () => {
    for (const socket of sockets.clients) socket.terminate();
    for (const socket of tcp) socket.destroy();
    sockets.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return {
    endpoint: `ws://127.0.0.1:${address.port}/devtools/browser/fixture`,
    attempted,
    allow: () => grants.splice(0).forEach(grant => grant()),
    get attempts() {
      return attempts;
    },
    commands,
  };
};
const clientFor = async (endpoint: string, headers: Record<string, string>) => {
  const socket = new WebSocket(endpoint, { headers });
  socket.on('error', () => {});
  await once(socket, 'open');
  cleanups.push(async () => {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  });
  return socket;
};
const reply = async (socket: WebSocket, command: object) => {
  const response = once(socket, 'message');
  socket.send(JSON.stringify(command));
  return JSON.parse(String((await response)[0]));
};

it('retains the one pending Chrome permission request after a local caller disconnects', async () => {
  const chrome = await fakeChrome(false);
  const bridge = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => bridge.close());
  const first = await clientFor(bridge.endpoint, bridge.headers);
  first.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
  await chrome.attempted;
  const closed = once(first, 'close');
  first.close();
  await closed;
  await delay(10);
  chrome.allow();
  const second = await clientFor(bridge.endpoint, bridge.headers);
  expect(await reply(second, { id: 1, method: 'Browser.getVersion' })).toEqual({
    id: 1,
    result: { product: 'FixtureChrome' },
  });
  expect(chrome.attempts).toBe(1);
  expect(chrome.commands.filter(command => command.method === 'Browser.getVersion')).toHaveLength(
    1,
  );
});
it('requires its private credential and rejects browser-origin connections before contacting Chrome', async () => {
  const chrome = await fakeChrome();
  const bridge = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => bridge.close());
  await expect(clientFor(bridge.endpoint, {})).rejects.toThrow('401');
  await expect(
    clientFor(bridge.endpoint, { ...bridge.headers, Origin: 'https://www.figma.com' }),
  ).rejects.toThrow('401');
  expect(chrome.attempts).toBe(0);
});
it('forbids tab creation, browser closure and navigation while preserving session errors', async () => {
  const chrome = await fakeChrome();
  const bridge = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  for (const method of [
    'Target.createTarget',
    'Target.closeTarget',
    'Browser.close',
    'Page.navigate',
  ]) {
    const response = await reply(client, { id: 12, sessionId: 'page-session', method });
    expect(response).toMatchObject({ id: 12, sessionId: 'page-session', error: { code: -32601 } });
  }
  expect(chrome.attempts).toBe(0);
});
it('reinitializes its own target attachments without making a second Chrome connection', async () => {
  const chrome = await fakeChrome();
  const bridge = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => bridge.close());
  const first = await clientFor(bridge.endpoint, bridge.headers);
  await reply(first, { id: 3, method: 'Browser.getVersion' });
  const closed = once(first, 'close');
  first.close();
  await closed;
  await delay(10);
  const second = await clientFor(bridge.endpoint, bridge.headers);
  expect(await reply(second, { id: 3, method: 'Browser.getVersion' })).toMatchObject({
    id: 3,
    result: { product: 'FixtureChrome' },
  });
  expect(chrome.attempts).toBe(1);
  expect(
    chrome.commands.some(
      command => command.method === 'Target.setAutoAttach' && command.params.autoAttach === false,
    ),
  ).toBe(true);
});
it('closes promptly even while Chrome has not answered the permission request', async () => {
  const chrome = await fakeChrome(false);
  const bridge = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  client.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
  await chrome.attempted;
  await bridge.close();
  expect(chrome.attempts).toBe(1);
});
