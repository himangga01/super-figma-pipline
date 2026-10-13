import { setTimeout as delay } from 'node:timers/promises';

import { contentHash, PortalPlanSchema, PortalRunSchema, storedChecksum } from '@sfp/ir';
import {
  PORTAL_RESULT_SCHEMAS,
  type ActorContext,
  type PortalToolName,
  type RuntimeExecutionScope,
} from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import * as browserSession from '../../../cli/src/browser-session.js';
import { preparePortalCaptureAuthority } from '../../src/portal/capture-admission-runtime.js';
import { createPortalCaptureRuntime } from '../../src/portal/capture-runtime.js';
import { resolvePortalCaptureSource } from '../../src/portal/capture-source-admission.js';
import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import {
  assertPortalCapturedGrant,
  describePortalCapture,
  PortalCapturedDesignSchema,
  portalDesignFingerprint,
  verifyPortalCaptureFiles,
} from '../../src/portal/design-capture.js';
import { PortalNativeWork } from '../../src/portal/native-work.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
import { pageApiCaptureFixture } from './page-api-fixture.js';

const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
const admission = {
  sessions: { active: () => undefined, list: () => [] },
  bindingFor: async () => null,
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});

async function fixture() {
  const f = await portalFixture();
  const api = pageApiCaptureFixture(f);
  cleanup.push(async () => {
    await api.capture.close();
    await f.cleanup();
  });
  const grant = (
    await resolvePortalCaptureSource(
      { source: 'chrome', collector: 'page-api', url: api.url },
      { kind: 'portal-source' },
      admission,
    )
  ).grant;
  return { ...f, api, grant };
}

it.each(['deadline', 'cancel'] as const)(
  'bounds held page API readiness and drains shutdown after %s',
  async mode => {
    const f = await fixture();
    let release = () => {},
      started = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.mocked(browserSession.observeFigmaPage).mockImplementation(async () => {
      started();
      await held;
      return { status: 'ready' } as Awaited<ReturnType<typeof browserSession.observeFigmaPage>>;
    });
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    if (mode === 'deadline')
      vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => originalTimeout(30));
    const controller = new AbortController();
    let outcome = 'pending',
      shutdown = false;
    const running = f.api.capture.pageApiCapture
      .capture('held-ready', f.api.url, controller.signal)
      .then(
        () => {
          outcome = 'success';
          return undefined;
        },
        () => {
          outcome = 'failed';
        },
      );
    let closing: Promise<void> | undefined;
    try {
      await entered;
      if (mode === 'cancel') controller.abort(Error('readiness-cancelled'));
      await delay(90);
      expect(outcome).toBe('failed');
      closing = f.api.capture.close().then(() => {
        shutdown = true;
        return undefined;
      });
      await delay(30);
      expect(shutdown).toBe(true);
    } finally {
      release();
      await running;
      await closing;
    }
  },
);

it('bounds unconfirmed session detach and fences new capture methods until it settles', async () => {
  const f = await fixture();
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const originalOpen = vi
    .mocked(browserSession.ExistingChromeConnection.prototype.open)
    .getMockImplementation()!;
  vi.mocked(browserSession.ExistingChromeConnection.prototype.open).mockImplementation(
    async (options, signal) => {
      const session = await originalOpen(options, signal);
      return {
        ...session,
        close: async () => {
          await held;
          await session.close();
        },
      };
    },
  );
  vi.mocked(browserSession.observeFigmaPage).mockResolvedValue({ status: 'loading' } as Awaited<
    ReturnType<typeof browserSession.observeFigmaPage>
  >);
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => originalTimeout(30));
  let outcome = 'pending';
  const running = f.api.capture.pageApiCapture
    .capture('held-detach', f.api.url, new AbortController().signal)
    .then(
      () => {
        outcome = 'success';
        return undefined;
      },
      () => {
        outcome = 'failed';
      },
    );
  try {
    await delay(90);
    expect(outcome).toBe('failed');
    await expect(
      f.api.capture.pageApiCapture.capture('fenced-page', f.api.url, new AbortController().signal),
    ).rejects.toThrow('PORTAL_CAPTURE_CLEANUP_UNCONFIRMED');
    await expect(
      f.api.capture.capture('fenced-scripter', f.api.url, new AbortController().signal),
    ).rejects.toThrow('PORTAL_CAPTURE_CLEANUP_UNCONFIRMED');
    expect(f.api.scripterCalls()).toBe(0);
  } finally {
    release();
    await running;
  }
});

it('rejects an otherwise complete page capture when session cleanup is unconfirmed', async () => {
  const f = await fixture();
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const originalOpen = vi
    .mocked(browserSession.ExistingChromeConnection.prototype.open)
    .getMockImplementation()!;
  vi.mocked(browserSession.ExistingChromeConnection.prototype.open).mockImplementation(
    async (options, signal) => {
      const session = await originalOpen(options, signal);
      return {
        ...session,
        close: async () => {
          await held;
          await session.close();
        },
      };
    },
  );
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => originalTimeout(ms <= 5000 ? 30 : ms));
  try {
    await expect(
      f.api.capture.pageApiCapture.capture(
        'complete-held-detach',
        f.api.url,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'PORTAL_CAPTURE_CLEANUP_UNCONFIRMED',
      diagnostic: { stage: 'cleanup' },
    });
    expect(f.api.reads()).toBeGreaterThan(0);
  } finally {
    release();
  }
});

it('keeps page API checkpoints and capture descriptors separate from historical Scripter evidence', async () => {
  const f = await fixture();
  const old = await currentCaptureFixture(f);
  const oldId = contentHash('sfp-portal-capture-progress-v1', old.grant.url).slice(7);
  await f.store.create('capture-progress', oldId, old.captured, PortalCapturedDesignSchema);
  const captured = await f.api.capture.pageApiCapture.capture(
    'new-page-api',
    f.api.url,
    new AbortController().signal,
  );
  expect(captured.complete).toBe(true);
  expect(captured.collectorProvenance?.collector).toBe('existing-chrome-page-api-v1');
  assertPortalCapturedGrant(captured, f.grant);
  await verifyPortalCaptureFiles(captured);
  expect((await f.store.get('capture-progress', oldId, PortalCapturedDesignSchema))?.hash).toBe(
    old.captured.hash,
  );
  const pageId = contentHash('sfp-portal-chrome-page-api-capture-progress-v1', old.grant.url).slice(
    7,
  );
  expect((await f.store.get('capture-progress', pageId, PortalCapturedDesignSchema))?.hash).toBe(
    captured.hash,
  );
  expect(() =>
    describePortalCapture(captured, { kind: 'chrome', url: f.api.url }, old.grant),
  ).toThrow('PORTAL_CAPTURE_COLLECTOR_MISMATCH');
  expect(() => assertPortalCapturedGrant(old.captured, f.grant)).toThrow(
    'PORTAL_CAPTURE_COLLECTOR_MISMATCH',
  );
  expect(f.api.scripterCalls()).toBe(0);
});

it('never substitutes the default Chrome capture when the requested page API port is absent', async () => {
  const f = await fixture();
  const chrome = {
    capture: vi.fn<() => Promise<never>>(async () => {
      throw Error('SCRIPTER_MUST_NOT_RUN');
    }),
  };
  const bound = await createPortalCaptureRuntime({ ...f, chrome, admission })(
    {
      target: { sessionId: null },
      portalAuthority: { captureSource: f.grant },
    } as RuntimeExecutionScope,
    {} as never,
    {} as never,
  );
  await expect(
    bound.capture!.capture('no-page-port', f.api.url, new AbortController().signal),
  ).rejects.toThrow('PORTAL_CAPTURE_COLLECTOR_UNAVAILABLE');
  expect(chrome.capture).not.toHaveBeenCalled();
});
it('keeps missing page API catalog coverage incomplete without a Scripter fallback', async () => {
  const f = await fixture();
  Object.assign(f.api.figma, { getLocalPaintStylesAsync: undefined });
  const captured = await f.api.capture.pageApiCapture.capture(
    'partial-page-api',
    f.api.url,
    new AbortController().signal,
  );
  expect(captured.complete).toBe(false);
  expect(captured.collectorEvidence?.capabilities).toContainEqual(
    expect.objectContaining({ name: 'paintStyles', status: 'unsupported' }),
  );
  expect(f.api.scripterCalls()).toBe(0);
});

it('routes public plan, generation evidence, submission and validation freshness through the admitted page runtime', async () => {
  const f = await fixture();
  const chrome = {
    capture: vi.fn<() => Promise<never>>(async () => {
      throw Error('SCRIPTER_MUST_NOT_RUN');
    }),
  };
  const refreshed: string[] = [];
  const work: PortalWorkPort = {
    apply: vi.fn<PortalWorkPort['apply']>(),
    cancel: async () => {},
    prepareValidation: async () => ({
      hash: contentHash('fixture-profile-v1', 'page-api'),
      resources: [],
    }),
    validate: vi.fn<PortalWorkPort['validate']>(
      async (plan, _run, _files, signal, _target, _profile, prepared, capture) => {
        expect(prepared?.captureSource).toMatchObject({ kind: 'chrome', collector: 'page-api' });
        const current = await capture!.capture(plan.planId, plan.design.url, signal);
        assertPortalCapturedGrant(current, prepared!.captureSource!);
        await verifyPortalCaptureFiles(current, signal);
        refreshed.push(portalDesignFingerprint(current));
        expect(refreshed[0]).not.toBe(plan.design.capture!.designFingerprint);
        throw Error('CONTROLLED_FRESHNESS_REJECTION');
      },
    ),
  };
  const coordinator = new PortalCoordinator(
    f.store,
    f.policy,
    work,
    Date.now,
    chrome,
    undefined,
    new PortalCoreLifecycle(new CorePreparations(f)),
  );
  const runtime = createPortalCaptureRuntime({
    ...f,
    chrome,
    pageApi: f.api.capture.pageApiCapture,
    admission,
  });
  let sequence = 0;
  const invoke = async (name: PortalToolName, args: unknown) => {
    const operationId = `page-flow-${++sequence}`;
    const prepared = await preparePortalCaptureAuthority(
      {
        name,
        args,
        principal: actor,
        workspaceId: f.workspaceId,
        operationId,
        targetSelector: {
          kind: name === 'portal_plan' || name === 'portal_validate' ? 'portal-source' : 'none',
        },
      },
      coordinator,
      admission,
    );
    const bound = await runtime(
      { target: prepared.target, portalAuthority: prepared.authority } as RuntimeExecutionScope,
      {} as never,
      {} as never,
    );
    try {
      return PORTAL_RESULT_SCHEMAS[name].parse(
        await coordinator.execute(name, args, {
          actor,
          workspaceId: f.workspaceId,
          operationId,
          authority: prepared.authority,
          signal: new AbortController().signal,
          ...(bound.capture ? { capture: bound.capture } : {}),
        }),
      ) as Record<string, any>;
    } finally {
      await bound.close();
    }
  };
  const plan = await invoke('portal_plan', {
    case: 'new',
    design: { source: 'chrome', collector: 'page-api', url: f.api.url },
  });
  expect(plan.design).toMatchObject({
    complete: true,
    liveVerified: true,
    capture: {
      source: { kind: 'chrome', collector: 'page-api' },
      admission: { collector: 'page-api' },
    },
  });
  await invoke('portal_start', { planId: plan.planId });
  const next = await invoke('portal_next', { runId: plan.planId, assetIds: [0] });
  expect(next.designEvidence.nodes[0].properties).toMatchObject({ width: 1, height: 1 });
  expect(next.assets.contents[0].data).toBe(f.api.bytes.toString('base64'));
  const path = 'public/page-api.png',
    hash = storedChecksum(f.api.bytes);
  await invoke('portal_submit', {
    runId: plan.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    contextHash: plan.contextHash,
    blueprintHash: plan.blueprintHash,
    assets: [{ path, assetId: 0, action: 'create', baseHash: null, contentHash: hash }],
    coreDeclarations: next.recipes.workItems.map(
      (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
        resultId: item.resultId,
        resultHash: item.resultHash,
        outputItemId: item.id,
        kind: item.kind,
        files: [{ path, hash }],
        assertionIds: [],
      }),
    ),
    finished: true,
  });
  const savedPlan = (await f.store.get('plans', plan.planId, PortalPlanSchema))!;
  const run = (await f.store.get('runs', plan.planId, PortalRunSchema))!;
  const validationAuthority = (
    await preparePortalCaptureAuthority(
      {
        name: 'portal_validate',
        args: { runId: plan.planId, profileId: 'fixture' },
        principal: actor,
        workspaceId: f.workspaceId,
        operationId: 'missing-scoped-validation',
        targetSelector: { kind: 'portal-source' },
      },
      coordinator,
      admission,
    )
  ).authority;
  const native = new PortalNativeWork({ ...f, designCapture: chrome });
  try {
    await expect(
      native.validate(
        savedPlan,
        run,
        [],
        new AbortController().signal,
        'candidate',
        'unused-profile',
        validationAuthority,
      ),
    ).rejects.toThrow('PORTAL_CAPTURE_ADMISSION_REQUIRED');
    const wrong = {
      ...validationAuthority,
      captureSource: { ...f.grant, collector: 'scripter' as const },
    };
    await expect(
      native.validate(
        savedPlan,
        run,
        [],
        new AbortController().signal,
        'candidate',
        'unused-profile',
        wrong,
        f.api.capture.pageApiCapture,
      ),
    ).rejects.toThrow('PORTAL_CAPTURE_ADMISSION_REQUIRED');
  } finally {
    await native.close();
  }
  f.api.node.width = 2;
  await expect(
    invoke('portal_validate', { runId: plan.planId, profileId: 'fixture' }),
  ).rejects.toThrow('CONTROLLED_FRESHNESS_REJECTION');
  expect(work.validate).toHaveBeenCalledTimes(1);
  expect(refreshed).toHaveLength(1);
  expect(chrome.capture).not.toHaveBeenCalled();
  expect(f.api.scripterCalls()).toBe(0);
}, 30_000);
