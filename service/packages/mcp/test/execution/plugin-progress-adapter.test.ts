import type { ProgressReporter, RuntimeExecutionScope } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createFakePinnedPluginRuntimePort } from '../../src/tools/runtime-registry.js';

const scope = Object.freeze({
  requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
  leaderGeneration: 'generation-1',
  actor: Object.freeze({
    actorId: 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    authSessionId: 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    entryPath: 'mcp-direct' as const,
  }),
  workspace: Object.freeze({ workspaceId: null, workspaceRoot: null }),
  target: Object.freeze({
    sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
    pluginGeneration: 'plugin-g1',
    fileIdentity: Object.freeze({ kind: 'figma-file-key' as const, value: 'file-a' }),
    fileExecutionKey: 'figma:file-a' as const,
  }),
  consent: Object.freeze({
    mode: 'local-trusted' as const,
    consentId: null,
    allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'] as const,
  }),
}) as RuntimeExecutionScope;

describe('fake paired plugin progress adapter', () => {
  it('forwards bounded progress through the injected reporter and honors explicit abort', async () => {
    const report = vi.fn<ProgressReporter['report']>();
    const throwIfCancelled = vi.fn<ProgressReporter['throwIfCancelled']>();
    let started!: () => void;
    const running = new Promise<void>(resolve => {
      started = resolve;
    });
    const fake = createFakePinnedPluginRuntimePort(
      async (_scope, _tool, _args, signal, reporter) => {
        reporter.report({ phase: 'render', completed: 1, total: 2, message: 'rendering' });
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    );
    const controller = new AbortController();
    const execution = fake.execute(scope, 'get_selection', {}, controller.signal, {
      report,
      throwIfCancelled,
    });
    await running;
    controller.abort(Object.assign(new Error('cancelled'), { code: 'OPERATION_CANCELLED' }));

    await expect(execution).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(report).toHaveBeenCalledWith({
      phase: 'render',
      completed: 1,
      total: 2,
      message: 'rendering',
    });
  });

  it('fails closed when no fake handler is explicitly installed', async () => {
    const fake = createFakePinnedPluginRuntimePort();
    await expect(
      fake.execute(scope, 'get_selection', {}, new AbortController().signal, {
        report: () => undefined,
        throwIfCancelled: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'PINNED_PLUGIN_RUNTIME_UNAVAILABLE' });
  });
});
