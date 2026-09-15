import { PairExchangeRequestSchema } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  exchangePairCode,
  PAIR_RESPONSE_MAX_BYTES,
  parsePairSubmission,
  usePairing,
} from '../../ui/composables/usePairing.js';
import type { RelayClient } from '../../ui/relay/client.js';

const challengeId = 'ABCDEFGHJK';
const code = '12345678';

const paddedJson = (value: unknown, bytes: number): string => {
  const json = JSON.stringify(value);
  if (json.length > bytes) throw new Error('fixture exceeds requested bytes');
  return `${json}${' '.repeat(bytes - json.length)}`;
};

describe('pair exchange admission', () => {
  it('accepts exact separate fields or the exact paste form without normalization', () => {
    expect(parsePairSubmission({ challengeId, code, paste: '' })).toEqual({ challengeId, code });
    expect(
      parsePairSubmission({ challengeId: '', code: '', paste: `SFP-${challengeId}-${code}` }),
    ).toEqual({ challengeId, code });

    for (const input of [
      { challengeId: challengeId.toLowerCase(), code, paste: '' },
      { challengeId, code: '１'.repeat(8), paste: '' },
      { challengeId: '', code: '', paste: `sfp-${challengeId}-${code}` },
      { challengeId: '', code: '', paste: `SFP-${challengeId}-${code}?x=1` },
      { challengeId, code, paste: `SFP-${challengeId}-${code}` },
      { challengeId, code, paste: '', actorId: 'forged' },
    ]) {
      expect(() => parsePairSubmission(input)).toThrowError(
        expect.objectContaining({ code: 'PAIR_BODY_INVALID' }),
      );
    }
  });

  it('posts only strict JSON to the fixed loopback endpoint and parses a bounded success', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ wsTicket: 'A'.repeat(22), expiresAt: 123_456 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await expect(
      exchangePairCode({ challengeId, code }, new AbortController().signal, fetch),
    ).resolves.toEqual({ wsTicket: 'A'.repeat(22), expiresAt: 123_456 });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3055/pair/exchange');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PairExchangeRequestSchema.parse({ challengeId, code })),
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
    expect(String(url)).not.toContain(code);
  });

  it('strictly projects typed errors including attempts remaining without leaking secrets', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ code: 'PAIR_CODE_WRONG', attemptsRemaining: 3 }), {
          status: 401,
        }),
    );

    const error = await exchangePairCode(
      { challengeId, code },
      new AbortController().signal,
      fetch,
    ).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'PAIR_CODE_WRONG', attemptsRemaining: 3 });
    expect(String(error)).not.toContain(code);

    const openError = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ code: 'PAIR_CODE_WRONG', attemptsRemaining: 3, token: code }),
          {
            status: 401,
          },
        ),
    );
    await expect(
      exchangePairCode({ challengeId, code }, new AbortController().signal, openError),
    ).rejects.toMatchObject({ code: 'PAIR_BODY_INVALID' });
  });

  it('cancels an invalid declared length before rejecting it', async () => {
    const cancel = vi.fn<() => void>();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(body, { status: 200, headers: { 'content-length': '00' } }),
    );

    await expect(
      exchangePairCode({ challengeId, code }, new AbortController().signal, fetch),
    ).rejects.toMatchObject({ code: 'PAIR_BODY_INVALID' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('accepts exactly 16 KiB and rejects declared or streamed max plus one', async () => {
    const result = { wsTicket: 'B'.repeat(22), expiresAt: 999 };
    const exactFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(paddedJson(result, PAIR_RESPONSE_MAX_BYTES), {
          status: 200,
          headers: { 'content-length': String(PAIR_RESPONSE_MAX_BYTES) },
        }),
    );
    await expect(
      exchangePairCode({ challengeId, code }, new AbortController().signal, exactFetch),
    ).resolves.toEqual(result);

    for (const response of [
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(PAIR_RESPONSE_MAX_BYTES + 1) },
      }),
      new Response(' '.repeat(PAIR_RESPONSE_MAX_BYTES + 1), { status: 200 }),
    ]) {
      const overFetch = vi.fn<typeof globalThis.fetch>(async () => response);
      await expect(
        exchangePairCode({ challengeId, code }, new AbortController().signal, overFetch),
      ).rejects.toMatchObject({ code: 'PAIR_BODY_TOO_LARGE' });
    }
  });

  it('honors a pre-aborted signal before fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      exchangePairCode({ challengeId, code }, controller.signal, fetch),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scrubs secret refs before handing the ticket directly to the relay client', async () => {
    const connectWithTicket = vi.fn<() => Promise<void>>(async () => undefined);
    const disconnect = vi.fn<() => Promise<void>>(async () => undefined);
    const client = {
      helloSeed: { provisionalSessionId: 'provisional', pluginGeneration: 'generation-1' },
      subscribe: (listener: (state: { status: string }) => void) => {
        listener({ status: 'idle' });
        return () => undefined;
      },
      getState: () => ({ status: 'connected' }),
      connectWithTicket,
      disconnect,
    } as unknown as RelayClient;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ wsTicket: 'H'.repeat(22), expiresAt: 123_456 }), {
          status: 200,
        }),
    );
    const pairing = usePairing({
      client,
      fetch,
      resolveHello: seed => ({
        protocolVersion: '0.1.0',
        productVersion: '0.1.0',
        pluginVersion: '0.1.0',
        pluginGeneration: seed.pluginGeneration,
        editorType: 'figma',
        mode: 'default',
        fileIdentity: { kind: 'figma-file-key', value: 'file-key' },
        fileName: 'Design',
        capabilities: [],
      }),
    });
    pairing.challengeId.value = challengeId;
    pairing.code.value = code;

    const submitted = pairing.submit();
    expect(pairing.code.value).toBe('');
    expect(pairing.paste.value).toBe('');
    await submitted;

    expect(connectWithTicket).toHaveBeenCalledWith(
      { wsTicket: 'H'.repeat(22), expiresAt: 123_456 },
      expect.objectContaining({ pluginGeneration: 'generation-1' }),
    );
    expect(JSON.stringify(pairing.state.value)).not.toContain('H'.repeat(22));
    pairing.dispose();
    expect(disconnect).toHaveBeenCalledWith({ forgetCredential: true });
  });

  it('shows malformed input errors and prevents submission after disposal', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = {
      subscribe: () => () => undefined,
      disconnect: async () => undefined,
    } as unknown as RelayClient;
    const pairing = usePairing({
      client,
      fetch,
      resolveHello: () => {
        throw new Error('unused');
      },
    });
    pairing.code.value = 'bad';
    await expect(pairing.submit()).rejects.toMatchObject({ code: 'PAIR_BODY_INVALID' });
    expect(pairing.state.value.errorCode).toBe('PAIR_BODY_INVALID');
    expect(pairing.code.value).toBe('');
    expect(fetch).not.toHaveBeenCalled();
    pairing.dispose();
    await expect(pairing.submit()).rejects.toMatchObject({ code: 'PAIR_CREDENTIAL_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels an exchange and ignores its late successful completion', async () => {
    let finishFetch!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise(resolve => {
          finishFetch = resolve;
        }),
    );
    const connectWithTicket = vi.fn<() => Promise<void>>(async () => undefined);
    const disconnect = vi.fn<() => Promise<void>>(async () => undefined);
    const client = {
      helloSeed: { provisionalSessionId: 'provisional', pluginGeneration: 'generation-1' },
      subscribe: () => () => undefined,
      getState: () => ({ status: 'disconnected' }),
      connectWithTicket,
      disconnect,
    } as unknown as RelayClient;
    const pairing = usePairing({
      client,
      fetch,
      resolveHello: seed => ({
        protocolVersion: '0.1.0',
        productVersion: '0.1.0',
        pluginVersion: '0.1.0',
        pluginGeneration: seed.pluginGeneration,
        editorType: 'figma',
        mode: 'default',
        fileIdentity: { kind: 'figma-file-key', value: 'file-key' },
        fileName: 'Design',
        capabilities: [],
      }),
    });
    pairing.challengeId.value = challengeId;
    pairing.code.value = code;
    const submitted = pairing.submit();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    pairing.cancel();
    finishFetch(
      new Response(JSON.stringify({ wsTicket: 'I'.repeat(22), expiresAt: 123_456 }), {
        status: 200,
      }),
    );
    await expect(submitted).rejects.toMatchObject({ name: 'AbortError' });
    expect(pairing.state.value.status).toBe('unpaired');
    expect(connectWithTicket).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith({ forgetCredential: true });
  });

  it.each(['missing seed', 'invalid hello context'] as const)(
    'rejects %s before consuming the one-use code',
    async failure => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const connectWithTicket = vi.fn<() => Promise<void>>(async () => undefined);
      const client = {
        helloSeed:
          failure === 'missing seed'
            ? null
            : { provisionalSessionId: 'provisional', pluginGeneration: 'generation-1' },
        subscribe: () => () => undefined,
        getState: () => ({ status: 'idle' }),
        connectWithTicket,
        disconnect: vi.fn<() => Promise<void>>(async () => undefined),
      } as unknown as RelayClient;
      const pairing = usePairing({
        client,
        fetch,
        resolveHello: () =>
          failure === 'invalid hello context'
            ? ({ pluginGeneration: 'generation-1' } as never)
            : Promise.reject(
                Object.assign(new Error('context unavailable'), {
                  code: 'PAIR_CONTEXT_REQUIRED',
                }),
              ),
      });
      pairing.challengeId.value = challengeId;
      pairing.code.value = code;

      await expect(pairing.submit()).rejects.toBeInstanceOf(Error);
      expect(fetch).not.toHaveBeenCalled();
      expect(connectWithTicket).not.toHaveBeenCalled();
    },
  );

  it('exposes an idempotent entering transition without network or secret writes', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = {
      helloSeed: null,
      subscribe: () => () => undefined,
      disconnect: vi.fn<() => Promise<void>>(async () => undefined),
    } as unknown as RelayClient;
    const pairing = usePairing({ client, fetch, resolveHello: () => Promise.reject(new Error()) });

    pairing.begin();
    pairing.begin();

    expect(pairing.state.value.status).toBe('entering');
    expect(fetch).not.toHaveBeenCalled();
    expect(pairing.code.value).toBe('');
    expect(pairing.paste.value).toBe('');
  });
});
