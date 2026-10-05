import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { createRetainedChromeTransport } from '../../src/portal/chrome-transport.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).toReversed()) await close();
});
const fakeChrome = async (
  initiallyAllowed = true,
  unansweredMethod?: string,
  targetInfos: object[] = [],
  browserContextIds: string[] = [],
) => {
  const server = createServer();
  const sockets = new WebSocketServer({ noServer: true });
  const tcp = new Set<Socket>();
  const commands: Array<Record<string, any>> = [];
  const requestHeaders: Array<Record<string, string | string[] | undefined>> = [];
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
    requestHeaders.push(request.headers);
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
      if (message.method === unansweredMethod) return;
      socket.send(
        JSON.stringify({
          id: message.id,
          ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          result:
            message.method === 'Browser.getVersion'
              ? { product: 'FixtureChrome' }
              : message.method === 'Target.getTargets'
                ? { targetInfos }
                : message.method === 'Target.getBrowserContexts'
                  ? { browserContextIds }
                  : message.method === 'Target.createTarget'
                    ? { targetId: 'created-source' }
                    : message.method === 'Target.attachToTarget'
                      ? { sessionId: 'owned-source-session' }
                      : {},
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
    requestHeaders,
    disconnect: () => {
      for (const socket of sockets.clients) socket.terminate();
    },
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

it('initializes only the selected page and preserves nested target attachment', async () => {
  const selectedUrl = 'https://www.figma.com/design/selectedFixtureKey';
  const chrome = await fakeChrome(true, undefined, [
    { targetId: 'source', type: 'page', url: selectedUrl },
    { targetId: 'unrelated', type: 'page', url: 'https://example.test/private' },
    { targetId: 'other-figma', type: 'page', url: 'https://www.figma.com/design/otherFixtureKey' },
    { targetId: 'worker', type: 'service_worker', url: selectedUrl },
  ]);
  const bridge = await createRetainedChromeTransport(chrome.endpoint, {
    matchesTarget: url => url === selectedUrl,
  });
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  expect(
    await reply(client, {
      id: 7,
      method: 'Target.setAutoAttach',
      params: {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      },
    }),
  ).toEqual({ id: 7, result: { sessionId: 'owned-source-session' } });
  expect(chrome.commands.map(command => command.method)).toEqual([
    'Target.getTargets',
    'Target.attachToTarget',
  ]);
  expect(chrome.commands[1]?.params).toEqual({ targetId: 'source', flatten: true });
  await reply(client, {
    id: 8,
    sessionId: 'selected-page-session',
    method: 'Target.setAutoAttach',
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  expect(chrome.commands[2]).toMatchObject({
    method: 'Target.setAutoAttach',
    sessionId: 'selected-page-session',
  });
});

it('opens only the authorized missing source and grants exactly one matching navigation', async () => {
  const sourceUrl = 'https://www.figma.com/design/openFixtureKey?node-id=0-1';
  const chrome = await fakeChrome();
  const bridge = await createRetainedChromeTransport(chrome.endpoint, {
    matchesTarget: url => url === sourceUrl,
    missingTargetUrl: () => sourceUrl,
  });
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  expect(
    await reply(client, { id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } }),
  ).toEqual({ id: 1, result: { sessionId: 'owned-source-session' } });
  expect(chrome.commands.map(command => command.method)).toEqual([
    'Target.getTargets',
    'Target.getBrowserContexts',
    'Target.createTarget',
    'Target.attachToTarget',
  ]);
  expect(chrome.commands[2]?.params).toEqual({ url: 'about:blank', newWindow: false });
  expect(chrome.commands[3]?.params).toEqual({ targetId: 'created-source', flatten: true });
  const navigate = (id: number, url?: string, sessionId = 'owned-source-session') =>
    reply(client, { id, method: 'Page.navigate', sessionId, params: { url } });
  expect(await navigate(2, sourceUrl, 'unrelated-session')).toHaveProperty('error');
  expect(await navigate(3, 'https://example.test/')).toHaveProperty('error');
  expect(await navigate(4, undefined)).toHaveProperty('error');
  expect(await navigate(5, sourceUrl)).toEqual({
    id: 5,
    sessionId: 'owned-source-session',
    result: {},
  });
  expect(await navigate(6, sourceUrl)).toHaveProperty('error');
  expect(
    await reply(client, { id: 7, method: 'Target.createTarget', params: { url: sourceUrl } }),
  ).toHaveProperty('error');
  expect(chrome.commands.filter(command => command.method === 'Page.navigate')).toHaveLength(1);
});

it('closes only its own unaccepted source tab when the transport closes', async () => {
  const sourceUrl = 'https://www.figma.com/design/openFixtureKey?node-id=0-1';
  const chrome = await fakeChrome();
  const bridge = await createRetainedChromeTransport(chrome.endpoint, {
    matchesTarget: url => url === sourceUrl,
    missingTargetUrl: () => sourceUrl,
  });
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  await reply(client, { id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } });
  expect(
    await reply(client, {
      id: 2,
      method: 'Target.closeTarget',
      params: { targetId: 'created-source' },
    }),
  ).toHaveProperty('error');
  await bridge.close();
  expect(chrome.commands.filter(command => command.method === 'Target.closeTarget')).toEqual([
    expect.objectContaining({ params: { targetId: 'created-source' } }),
  ]);
});

it('keeps an accepted or pre-existing source tab open when the transport closes', async () => {
  const sourceUrl = 'https://www.figma.com/design/openFixtureKey?node-id=0-1';
  const created = await fakeChrome();
  const accepted = await createRetainedChromeTransport(created.endpoint, {
    matchesTarget: url => url === sourceUrl,
    missingTargetUrl: () => sourceUrl,
  });
  cleanups.push(() => accepted.close());
  await reply(await clientFor(accepted.endpoint, accepted.headers), {
    id: 1,
    method: 'Target.setAutoAttach',
    params: { autoAttach: true },
  });
  accepted.releaseCreatedTargets();
  await accepted.close();
  const existing = await fakeChrome(true, undefined, [
    { targetId: 'source', type: 'page', url: sourceUrl },
  ]);
  const attached = await createRetainedChromeTransport(existing.endpoint, {
    matchesTarget: url => url === sourceUrl,
    missingTargetUrl: () => sourceUrl,
  });
  cleanups.push(() => attached.close());
  await reply(await clientFor(attached.endpoint, attached.headers), {
    id: 1,
    method: 'Target.setAutoAttach',
    params: { autoAttach: true },
  });
  await attached.close();
  expect(
    [...created.commands, ...existing.commands].filter(
      command => command.method === 'Target.closeTarget',
    ),
  ).toEqual([]);
  expect(created.commands.map(command => command.method)).toContain('Target.createTarget');
});

it('does not guess among browser contexts when a missing source is requested', async () => {
  const chrome = await fakeChrome(true, undefined, [], ['other-context']);
  const bridge = await createRetainedChromeTransport(chrome.endpoint, {
    matchesTarget: () => true,
    missingTargetUrl: () => 'https://www.figma.com/design/openFixtureKey',
  });
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  expect(
    await reply(client, { id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } }),
  ).toMatchObject({ error: { message: 'CHROME_CONTEXT_AMBIGUOUS' } });
  expect(chrome.commands.map(command => command.method)).toEqual([
    'Target.getTargets',
    'Target.getBrowserContexts',
  ]);
});

it('does not create a missing source outside the bound Figma destination', async () => {
  const chrome = await fakeChrome();
  const bridge = await createRetainedChromeTransport(chrome.endpoint, {
    matchesTarget: () => true,
    missingTargetUrl: () => 'https://example.test/other',
  });
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  expect(
    await reply(client, { id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } }),
  ).toMatchObject({ error: { message: 'FIGMA_URL_INVALID' } });
  expect(chrome.commands.map(command => command.method)).toEqual(['Target.getTargets']);
});

it('retires an unknown source creation outcome without replaying it', async () => {
  const chrome = await fakeChrome(true, 'Target.createTarget');
  const bridge = await createRetainedChromeTransport(chrome.endpoint, {
    matchesTarget: () => true,
    missingTargetUrl: () => 'https://www.figma.com/design/openFixtureKey',
  });
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  client.send(
    JSON.stringify({ id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } }),
  );
  await vi.waitFor(() =>
    expect(chrome.commands.some(command => command.method === 'Target.createTarget')).toBe(true),
  );
  client.close();
  await vi.waitFor(() => expect(bridge.state()).toBe('unavailable'));
  expect(chrome.commands.filter(command => command.method === 'Target.createTarget')).toHaveLength(
    1,
  );
});

it.each([0, 2])('does not attach any page when the selected target count is %i', async count => {
  const chrome = await fakeChrome(
    true,
    undefined,
    Array.from({ length: count }, (_, index) => ({
      targetId: `source-${index}`,
      type: 'page',
      url: 'https://www.figma.com/design/selectedFixtureKey',
    })),
  );
  const bridge = await createRetainedChromeTransport(chrome.endpoint, {
    matchesTarget: () => true,
  });
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  const result = await reply(client, {
    id: 2,
    method: 'Target.setAutoAttach',
    params: { autoAttach: true },
  });
  expect(result).toMatchObject({
    id: 2,
    error: { message: count === 0 ? 'FIGMA_TAB_NOT_FOUND' : 'CHROME_TARGET_AMBIGUOUS' },
  });
  expect(chrome.commands.map(command => command.method)).toEqual(['Target.getTargets']);
});

it('retires an unsettled root attachment rather than replaying it into another client', async () => {
  const chrome = await fakeChrome(true, 'Target.attachToTarget', [
    { targetId: 'source', type: 'page', url: 'https://www.figma.com/design/selectedFixtureKey' },
  ]);
  const bridge = await createRetainedChromeTransport(chrome.endpoint, {
    matchesTarget: () => true,
  });
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  client.send(
    JSON.stringify({ id: 3, method: 'Target.setAutoAttach', params: { autoAttach: true } }),
  );
  await vi.waitFor(() => expect(chrome.commands.at(-1)?.method).toBe('Target.attachToTarget'));
  const closed = once(client, 'close');
  client.close();
  await closed;
  await vi.waitFor(() => expect(bridge.state()).toBe('unavailable'));
  await expect(clientFor(bridge.endpoint, bridge.headers)).rejects.toThrow('401');
  expect(
    chrome.commands.filter(command => command.method === 'Target.attachToTarget'),
  ).toHaveLength(1);
});

it('preserves the actual client user-agent without forwarding relay credentials or cookies', async () => {
  const chrome = await fakeChrome();
  const bridge = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, {
    ...bridge.headers,
    'User-Agent': 'Playwright/fixture',
    Cookie: 'private-fixture-cookie',
  });
  await reply(client, { id: 1, method: 'Browser.getVersion' });
  expect(chrome.requestHeaders[0]?.['user-agent']).toBe('Playwright/fixture');
  expect(chrome.requestHeaders[0]?.authorization).toBeUndefined();
  expect(chrome.requestHeaders[0]?.cookie).toBeUndefined();
  expect(chrome.requestHeaders[0]?.origin).toBeUndefined();
});

it('retains bounded parameter-free initialization diagnostics after a caller times out', async () => {
  const chrome = await fakeChrome(true, 'Runtime.evaluate');
  const bridge = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => bridge.close());
  const client = await clientFor(bridge.endpoint, bridge.headers);
  await reply(client, { id: 1, method: 'Browser.getVersion' });
  client.send(
    JSON.stringify({
      id: 2,
      method: 'Runtime.evaluate',
      params: { expression: 'private-payload-must-not-be-logged' },
    }),
  );
  await vi.waitFor(() => expect(bridge.diagnostics().pendingMethods).toEqual(['Runtime.evaluate']));
  const closed = once(client, 'close');
  client.close();
  await closed;
  await vi.waitFor(() =>
    expect(bridge.diagnostics()).toEqual({
      sent: 2,
      received: 3,
      pendingMethods: ['Runtime.evaluate'],
      pendingResets: 0,
    }),
  );
  expect(JSON.stringify(bridge.diagnostics())).not.toContain('private-payload');
});

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

it('retires failed-generation credentials and preserves unanswered effects as unknown without replay', async () => {
  const chrome = await fakeChrome(true, 'Runtime.evaluate');
  const old = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => old.close());
  const first = await clientFor(old.endpoint, old.headers);
  const replies: string[] = [];
  first.on('message', bytes => replies.push(bytes.toString()));
  first.send(
    JSON.stringify({ id: 41, method: 'Runtime.evaluate', params: { expression: 'effect()' } }),
  );
  await vi.waitFor(() => expect(chrome.commands).toHaveLength(1));
  const lost = once(first, 'close');
  chrome.disconnect();
  const [code, reason] = await lost;
  expect(code).toBe(1011);
  expect(String(reason)).toContain('outcomes unknown');
  expect(replies).toEqual([]);
  expect(old.state()).toBe('unavailable');
  await expect(clientFor(old.endpoint, old.headers)).rejects.toThrow('401');

  const fresh = await createRetainedChromeTransport(chrome.endpoint);
  cleanups.push(() => fresh.close());
  expect(fresh.headers.Authorization).not.toBe(old.headers.Authorization);
  expect(fresh.endpoint).not.toBe(old.endpoint);
  await expect(clientFor(fresh.endpoint, old.headers)).rejects.toThrow('401');
  expect(chrome.attempts).toBe(1);
  const next = await clientFor(fresh.endpoint, fresh.headers);
  expect(await reply(next, { id: 41, method: 'Browser.getVersion' })).toMatchObject({
    id: 41,
    result: { product: 'FixtureChrome' },
  });
  expect(chrome.attempts).toBe(2);
  expect(chrome.commands.filter(command => command.method === 'Runtime.evaluate')).toHaveLength(1);
});
