import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { contentHash } from '@sfp/ir';
import { hashActionRequest } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { AuthenticatedControlRouter, createControlHttpHandler } from '../../src/control/router.js';
import {
  createPortalProfileEndpoint,
  createPortalProfilePreparationEndpoint,
  registerPortalControlRoutes,
} from '../../src/portal/control.js';
import { profileJobActor as actor, profileJobFixture } from './profile-preparation-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture(dropAccepted = false) {
  const f = await profileJobFixture();
  const nonces = createActionNonceStore({ leaderGeneration: 'source-profile-http-fixture' }),
    router = new AuthenticatedControlRouter();
  registerPortalControlRoutes(
    router,
    createPortalProfileEndpoint({ store: f.store, work: f.work, nonces }),
    createPortalProfilePreparationEndpoint({ store: f.store, work: f.work }),
  );
  router.freeze();
  const handle = createControlHttpHandler({
    router,
    principalForRequest: async request => {
      if (request.headers.authorization !== 'Bearer owned-source-profile-fixture')
        throw Object.assign(new Error('CONTROL_UNAUTHORIZED'), { code: 'CONTROL_UNAUTHORIZED' });
      return actor;
    },
  });
  let dropped = false;
  const server = createServer((request, response) => {
    if (
      dropAccepted &&
      !dropped &&
      request.method === 'POST' &&
      request.url === '/control/portal/profiles/prepare'
    ) {
      const end = response.end.bind(response);
      response.end = ((...args: unknown[]) => {
        if (response.statusCode === 202) {
          dropped = true;
          request.socket.destroy();
          return response;
        }
        return Reflect.apply(end, response, args);
      }) as typeof response.end;
    }
    void handle(request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  cleanups.push(async () => {
    f.release();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await f.cleanup();
  });
  const call = async (path: string, body?: unknown, authorized = true) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(authorized ? { authorization: 'Bearer owned-source-profile-fixture' } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  return { ...f, call, nonces };
}

it('authenticated HTTP returns retained acceptance, GET serializes result and exact JSON registration consumes one nonce', async () => {
  const f = await fixture(),
    deadlineAt = Date.now() + 60000;
  const started = await f.call('/control/portal/profiles/prepare', {
    profile: f.publicProfile,
    requestId: randomUUID(),
    deadlineAt,
  });
  expect(started.status).toBe(202);
  expect(started.body.status).toBe('preparing');
  const id = String(started.body.preparationId);
  expect((await f.call('/control/portal/profile-preparations/' + id)).body.producerPending).toBe(
    true,
  );
  expect(
    (await f.call('/control/portal/profile-preparations/' + id + '/result')).status,
  ).toBeGreaterThanOrEqual(400);
  f.release();
  await vi.waitFor(async () =>
    expect((await f.call('/control/portal/profile-preparations/' + id)).body.issuerAvailable).toBe(
      true,
    ),
  );
  const prepared = (await f.call('/control/portal/profile-preparations/' + id + '/result')).body;
  expect(prepared.native.sourceHash).toBe(f.profile.native.sourceHash);
  const actionHash = hashActionRequest('portal.profile.register', {
    planId: prepared.planId,
    profileHash: contentHash('sfp-portal-profile-request-v1', prepared),
  });
  const nonce = await f.nonces.issue(actor, 'portal.profile.register', actionHash);
  const registered = await f.call('/control/portal/profiles', {
    profile: JSON.parse(JSON.stringify(prepared)),
    actionNonce: nonce.value,
    deadlineAt,
  });
  expect(registered.status).toBe(202);
  await vi.waitFor(async () =>
    expect((await f.call('/control/portal/profile-preparations/' + id)).body.status).toBe(
      'registered',
    ),
  );
  expect(f.registers()).toBe(1);
  expect(
    (
      await f.call('/control/portal/profiles', {
        profile: prepared,
        actionNonce: nonce.value,
        deadlineAt,
      })
    ).status,
  ).toBeGreaterThanOrEqual(400);
});

it('does not publish a cancelled physical preparation and retains the owner lookup without redispatch', async () => {
  const f = await fixture(),
    request = { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: Date.now() + 60000 };
  const started = await f.call('/control/portal/profiles/prepare', request),
    id = String(started.body.preparationId);
  const lookup = await f.call(
    '/control/portal/profile-preparations?' +
      new URLSearchParams({
        planId: f.plan.planId,
        requestHash: contentHash('sfp-profile-preparation-request-v1', request),
      }),
  );
  expect(lookup.status).toBe(200);
  expect(lookup.body).toHaveLength(1);
  expect(
    (await f.call('/control/portal/profile-preparations/' + id, undefined, false)).status,
  ).toBeGreaterThanOrEqual(400);
  expect(
    (await f.call('/control/portal/profile-preparations/' + id + '/cancel', {})).body.status,
  ).toBe('unknown');
  f.release();
  await vi.waitFor(async () =>
    expect((await f.call('/control/portal/profile-preparations/' + id)).body.producerPending).toBe(
      false,
    ),
  );
  expect(
    (await f.call('/control/portal/profile-preparations/' + id + '/result')).status,
  ).toBeGreaterThanOrEqual(400);
  expect(f.calls()).toBe(1);
});

it('recovers an actually lost HTTP202 acknowledgement by exact owner request ID without a repeated dispatch', async () => {
  const f = await fixture(true),
    input = { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: Date.now() + 60000 };
  await expect(f.call('/control/portal/profiles/prepare', input)).rejects.toBeInstanceOf(Error);
  const query = new URLSearchParams({
    planId: f.plan.planId,
    requestId: input.requestId,
    requestHash: contentHash('sfp-profile-preparation-request-v1', input),
  });
  const recovered = await f.call('/control/portal/profile-preparations?' + query);
  expect(recovered.status).toBe(200);
  expect(recovered.body).toHaveLength(1);
  expect(f.calls()).toBe(1);
  expect((await f.call('/control/portal/profiles/prepare', input)).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(f.calls()).toBe(1);
  f.release();
});
