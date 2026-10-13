import type { CDPSession, Page } from 'playwright';

import { waitLogically } from '../../../cli/src/logical-wait.js';
import { portalError } from './store.js';

const namedRoles = new Set(['button', 'link']);
const labelledRoles = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'colorwell',
  'date',
  'datetime',
  'inputtime',
]);

/** Basic exposed-control names in the owned preview's root document, not a full WCAG audit. */
export async function auditPortalControlNames(
  page: Page,
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
): Promise<string[]> {
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + 10_000);
  const timeout = new AbortController();
  const assertActive = () => {
    options.signal?.throwIfAborted();
    if (Date.now() >= deadlineAt) throw portalError('PORTAL_PREVIEW_AX_TIMEOUT');
  };
  assertActive();
  const timer = setTimeout(
    () => timeout.abort(portalError('PORTAL_PREVIEW_AX_TIMEOUT')),
    Math.max(1, deadlineAt - Date.now()),
  );
  const signal = AbortSignal.any([timeout.signal, ...(options.signal ? [options.signal] : [])]);
  let session: CDPSession | undefined;
  let failed = false;
  let failure: unknown;
  const issues = new Set<string>();
  try {
    session = await waitLogically(page.context().newCDPSession(page), signal, late =>
      late.detach(),
    );
    // Ownership is retained before this guard, including cancellation at promise delivery.
    assertActive();
    const result = await waitLogically(session.send('Accessibility.getFullAXTree'), signal);
    assertActive();
    if (
      !Array.isArray(result.nodes) ||
      !result.nodes.length ||
      result.nodes.length > 50_000 ||
      !result.nodes.some(node => !node.ignored && node.role?.value === 'RootWebArea')
    )
      throw portalError('PORTAL_PREVIEW_AX_UNAVAILABLE');
    for (const node of result.nodes) {
      if (typeof node.ignored !== 'boolean' || typeof node.nodeId !== 'string')
        throw portalError('PORTAL_PREVIEW_AX_UNAVAILABLE');
      if (node.ignored) continue;
      const role = typeof node.role?.value === 'string' ? node.role.value.toLowerCase() : '';
      if (!role) throw portalError('PORTAL_PREVIEW_AX_UNAVAILABLE');
      if (typeof node.name?.value === 'string' && node.name.value.trim()) continue;
      if (namedRoles.has(role)) issues.add('CONTROL_NAME_MISSING');
      if (labelledRoles.has(role)) issues.add('CONTROL_LABEL_MISSING');
    }
  } catch (error) {
    failed = true;
    failure = signal.aborted
      ? signal.reason
      : error instanceof Error &&
          'code' in error &&
          String(error.code).startsWith('PORTAL_PREVIEW_AX_')
        ? error
        : portalError('PORTAL_PREVIEW_AX_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    if (session) {
      try {
        // Cleanup has a separate bounded allowance; it grants no further capture work.
        await waitLogically(session.detach(), AbortSignal.timeout(1_000));
      } catch {
        if (!failed) {
          failed = true;
          failure = portalError('PORTAL_PREVIEW_AX_CLEANUP_UNCONFIRMED');
        }
      }
    }
  }
  if (failed) throw failure;
  assertActive();
  return [...issues];
}
