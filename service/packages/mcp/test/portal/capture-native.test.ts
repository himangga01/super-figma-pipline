import { PortalPlanSchema, PortalRunSchema } from '@sfp/ir';
import type { ActorContext } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { PortalCoordinator } from '../../src/portal/coordinator.js';
import { NativePortalRunner } from '../../src/portal/native-runner.js';
import { PortalNativeWork } from '../../src/portal/native-work.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
const actor: ActorContext = {
  actorId: ('actor1_' + 'A'.repeat(43)) as ActorContext['actorId'],
  authSessionId: ('auth1_' + 'B'.repeat(43)) as ActorContext['authSessionId'],
  entryPath: 'control',
};
it.each(['missing', 'wrong-file', 'wrong-collector'] as const)(
  'rejects %s freshness admission before profile/native/browser effects',
  async kind => {
    const f = await portalFixture();
    const current = await currentCaptureFixture(f),
      capture = vi.fn<() => Promise<typeof current.captured>>(async () => current.captured);
    const runner = new NativePortalRunner();
    const execute = vi.spyOn(runner, 'execute');
    const work = new PortalNativeWork({
      stateRoot: f.stateRoot,
      store: f.store,
      policy: f.policy,
      permissions: f.permissions,
      runner,
      designCapture: { capture },
    });
    closes.push(async () => {
      await work.close();
      await f.cleanup();
    });
    const coordinator = new PortalCoordinator(
      f.store,
      f.policy,
      work,
      Date.now,
      {
        capture: async () => current.captured,
      },
      undefined,
      new PortalCoreLifecycle(new CorePreparations(f)),
    );
    const args = { case: 'new', design: { url: current.grant.url, source: 'chrome' } };
    const authority = await coordinator.prepare(
      'portal_plan',
      args,
      actor,
      f.workspaceId,
      'native-no-grant',
    );
    authority.captureSource = current.grant;
    const planned = (await coordinator.execute('portal_plan', args, {
      actor,
      workspaceId: f.workspaceId,
      operationId: 'native-no-grant',
      authority,
      signal: new AbortController().signal,
    })) as { planId: string };
    const startAuthority = await coordinator.prepare(
      'portal_start',
      { planId: planned.planId },
      actor,
      f.workspaceId,
      'start-no-grant',
    );
    await coordinator.execute(
      'portal_start',
      { planId: planned.planId },
      {
        actor,
        workspaceId: f.workspaceId,
        operationId: 'start-no-grant',
        authority: startAuthority,
        signal: new AbortController().signal,
      },
    );
    const plan = (await f.store.get('plans', planned.planId, PortalPlanSchema))!,
      run = (await f.store.get('runs', planned.planId, PortalRunSchema))!;
    const prepared = { ...authority };
    delete prepared.captureSource;
    if (kind === 'wrong-file')
      prepared.captureSource = {
        ...current.grant,
        url: 'https://www.figma.com/design/AAAAAAAAAAAAAAAAAAAA?node-id=0-1',
      };
    if (kind === 'wrong-collector')
      prepared.captureSource = { ...current.grant, kind: 'desktop' } as never;
    const get = vi.spyOn(f.store, 'get');
    await expect(
      work.validate(
        plan,
        run,
        [],
        new AbortController().signal,
        'candidate',
        'absent-profile',
        prepared,
      ),
    ).rejects.toThrow('PORTAL_CAPTURE_ADMISSION_REQUIRED');
    expect(capture).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(get.mock.calls.some(call => call[0] === 'profiles')).toBe(false);
  },
);
