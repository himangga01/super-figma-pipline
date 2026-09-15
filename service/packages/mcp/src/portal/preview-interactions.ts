/* eslint-disable no-await-in-loop -- each reaction executes in its own restored source state. */
import type { Page } from 'playwright';

import type {
  PortalInteractionContract,
  PortalObservationManifest,
  PortalObservationIdentity,
} from '../../../shared/src/portal-observations.js';
import {
  assertIsolatedPortalSourceVisible,
  beginPortalMotionObservation,
  type PortalMotionObservation,
} from './preview-consumption.js';
export const assertPortalSourceVisible = assertIsolatedPortalSourceVisible;
export async function executePortalInteractions(
  page: Page,
  contract: PortalInteractionContract,
  manifest: PortalObservationManifest,
  screen: PortalObservationIdentity,
) {
  const results = [];
  for (const required of contract.interactions.filter(
    value => value.rootNodeId === screen.rootNodeId,
  )) {
    let passed = false,
      reason: string | null = null,
      temporal: {
        durationMs: number;
        observedMs: number;
        animatedProperties: string[];
        easing: string | null;
        direction: string | null;
      } | null = null;
    let motion: PortalMotionObservation | undefined;
    try {
      if (required.status !== 'supported')
        throw Error(required.reason ?? 'UNSUPPORTED_INTERACTION');
      if (required.action === 'back') {
        const previous = manifest.screens.find(value => value.route !== screen.route);
        if (!previous) throw Error('INTERACTION_BACK_SOURCE_REQUIRED');
        await page.goto(new URL(previous.route, page.url()).href, { waitUntil: 'networkidle' });
      }
      await page.goto(new URL(screen.route, page.url()).href, { waitUntil: 'networkidle' });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const source = page.locator('[data-sfp-node=' + JSON.stringify(required.sourceNodeId) + ']');
      await assertPortalSourceVisible(
        page,
        '[data-sfp-node=' + JSON.stringify(required.sourceNodeId) + ']',
        required.rootNodeId,
      );
      const beforeUrl = page.url();
      const target = required.destinationNodeId
        ? page.locator(
            '[data-sfp-node=' +
              JSON.stringify(required.destinationNodeId) +
              '],[data-sfp-root=' +
              JSON.stringify(required.destinationNodeId) +
              ']',
          )
        : null;
      if (
        target &&
        ['overlay', 'swap', 'change-state'].includes(required.action) &&
        (await target.first().isVisible())
      )
        throw Error('INTERACTION_DESTINATION_ALREADY_VISIBLE');
      if (required.action === 'close' && !(await page.getByRole('dialog').isVisible()))
        throw Error('INTERACTION_OVERLAY_NOT_OPEN');
      if (required.temporal)
        motion = await beginPortalMotionObservation(
          page,
          required.sourceNodeId,
          required.destinationNodeId,
        );
      if (required.trigger === 'click') await source.click();
      else if (required.trigger === 'hover') await source.hover();
      else if (required.trigger === 'key' && required.key) await source.press(required.key);
      else if (required.trigger === 'delay' && required.delayMs !== null)
        await page.waitForTimeout(required.delayMs);
      else throw Error('INTERACTION_TRIGGER_UNSUPPORTED');
      if (required.action === 'navigate') {
        const destination = manifest.screens.find(
          value => value.rootNodeId === required.destinationNodeId,
        );
        if (!destination) throw Error('INTERACTION_DESTINATION_ROUTE_REQUIRED');
        await page.waitForURL(url => url.pathname + url.search + url.hash === destination.route);
        if (!target || !(await target.first().isVisible()))
          throw Error('INTERACTION_DESTINATION_NOT_VISIBLE');
      } else if (required.action === 'back') {
        await page.waitForURL(url => url.href !== beforeUrl);
        if (
          !manifest.screens.some(
            value =>
              value.route ===
              new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash,
          )
        )
          throw Error('INTERACTION_BACK_DESTINATION_UNBOUND');
      } else if (required.action === 'close')
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
      else {
        if (!target) throw Error('INTERACTION_DESTINATION_REQUIRED');
        await target.first().waitFor({ state: 'visible' });
        if (['swap', 'change-state'].includes(required.action))
          await source.waitFor({ state: 'hidden' });
        if (required.action === 'overlay' && !(await page.getByRole('dialog').isVisible()))
          throw Error('INTERACTION_OVERLAY_SEMANTICS_REQUIRED');
        if (required.action === 'scroll') {
          const box = await target.first().boundingBox();
          const viewport = page.viewportSize();
          if (!box || !viewport || box.y < 0 || box.y >= viewport.height)
            throw Error('INTERACTION_SCROLL_NOT_OBSERVED');
        }
      }
      if (required.temporal) {
        await page.waitForTimeout(Math.min(10000, required.temporal.durationMs + 100));
        const animations = (await motion!.finish()) as Array<{
          duration: unknown;
          easing: string;
          frames: Record<string, unknown>[];
          start: number;
          elapsed: number | null;
          samples: Array<Record<string, string>>;
        }>;
        const match = animations.find(
          value =>
            typeof value.duration === 'number' &&
            Math.abs(value.duration - required.temporal!.durationMs) <=
              Math.max(50, required.temporal!.durationMs * 0.1) &&
            value.elapsed !== null &&
            Math.abs(value.elapsed - required.temporal!.durationMs) <=
              Math.max(75, required.temporal!.durationMs * 0.2) &&
            value.samples.length >= 2 &&
            value.samples.some(
              sample => JSON.stringify(sample) !== JSON.stringify(value.samples[0]),
            ) &&
            value.frames.length >= 2 &&
            JSON.stringify(value.frames[0]) !== JSON.stringify(value.frames.at(-1)),
        );
        if (!match) throw Error('INTERACTION_TEMPORAL_OBSERVATION_REQUIRED');
        const observedEasing =
          match.easing !== 'linear'
            ? match.easing
            : typeof match.frames[0]?.easing === 'string'
              ? match.frames[0].easing
              : null;
        const first = match.samples[0]!,
          last = match.samples.at(-1)!;
        const dx = Number(last.x) - Number(first.x),
          dy = Number(last.y) - Number(first.y);
        const observedDirection =
          Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 1
            ? dx < 0
              ? 'LEFT'
              : 'RIGHT'
            : Math.abs(dy) > 1
              ? dy < 0
                ? 'TOP'
                : 'BOTTOM'
              : null;
        if (required.temporal.easing && observedEasing !== required.temporal.easing)
          throw Error('INTERACTION_EASING_MISMATCH');
        if (required.temporal.direction && observedDirection !== required.temporal.direction)
          throw Error('INTERACTION_DIRECTION_MISMATCH');
        temporal = {
          easing: observedEasing,
          direction: observedDirection,
          durationMs: required.temporal.durationMs,
          observedMs: match.elapsed!,
          animatedProperties: [
            ...new Set(
              match.frames
                .flatMap(value => Object.keys(value))
                .filter(
                  value => !['offset', 'computedOffset', 'easing', 'composite'].includes(value),
                ),
            ),
          ],
        };
        if (
          required.temporal.type === 'DISSOLVE' &&
          !match.samples.some(sample => sample.opacity !== match.samples[0]!.opacity)
        )
          throw Error('INTERACTION_MOTION_PROPERTY_MISMATCH');
        if (
          (required.temporal.type === 'DISSOLVE' &&
            !temporal.animatedProperties.includes('opacity')) ||
          (/MOVE|SLIDE|PUSH/u.test(required.temporal.type) &&
            !temporal.animatedProperties.some(value =>
              ['transform', 'left', 'top'].includes(value),
            ))
        )
          throw Error('INTERACTION_MOTION_PROPERTY_MISMATCH');
        if (!temporal.animatedProperties.length) throw Error('INTERACTION_TEMPORAL_STATE_REQUIRED');
      }
      passed = true;
    } catch (error) {
      reason = error instanceof Error ? error.message.slice(0, 512) : 'INTERACTION_FAILED';
    } finally {
      if (motion) {
        await motion.dispose();
      }
    }
    results.push({
      assertionId: required.id,
      sourceNodeId: required.sourceNodeId,
      destinationNodeId: required.destinationNodeId,
      passed,
      temporal,
      reason,
    });
  }
  return results;
}
