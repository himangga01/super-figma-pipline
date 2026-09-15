import type { RuntimeExecutionScope, ProgressReporter } from '@sfp/shared';

import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';
import type { PinnedPluginRuntimePort, RuntimeActionContext } from '../tools/runtime-registry.js';
import type { PortalCaptureAdmissionPorts } from './capture-source-admission.js';
import { revalidatePortalCaptureGrant } from './capture-source-admission.js';
import type { PortalDesignCapturePort } from './design-capture.js';
import { createDesktopDesignCapture } from './desktop-capture.js';
import { portalError, type PortalStore } from './store.js';
export function createPortalCaptureRuntime(dependencies: {
  stateRoot: string;
  permissions: BoundStatePermissions;
  store: PortalStore;
  chrome: PortalDesignCapturePort;
  admission: PortalCaptureAdmissionPorts;
}) {
  return async (
    scope: RuntimeExecutionScope,
    plugin: PinnedPluginRuntimePort,
    action: Readonly<RuntimeActionContext>,
    reporter?: ProgressReporter,
  ) => {
    const grant = scope.portalAuthority?.captureSource;
    if (!grant) return { capture: undefined, close: async () => {} };
    const revalidate = () =>
      revalidatePortalCaptureGrant(grant, scope.target, dependencies.admission);
    await revalidate();
    if (grant.kind === 'desktop') {
      const capture = createDesktopDesignCapture(
        dependencies.stateRoot,
        dependencies.permissions,
        dependencies.store,
        { scope, plugin, action, grant, revalidate, ...(reporter ? { reporter } : {}) },
      );
      return { capture, close: () => capture.close() };
    }
    const capture: PortalDesignCapturePort = {
      capture: async (planId, url, signal) => {
        if (parseFigmaTarget(url).url !== grant.url)
          throw portalError('PORTAL_CAPTURE_SOURCE_MISMATCH');
        signal.throwIfAborted();
        await revalidate();
        return dependencies.chrome.capture(planId, url, signal);
      },
    };
    return { capture, close: async () => {} };
  };
}
