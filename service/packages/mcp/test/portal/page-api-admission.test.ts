import { PortalPlanArgsSchema } from '@sfp/shared';
import { expect, it } from 'vitest';

import { PortalCaptureGrantSchema } from '../../../shared/src/portal-capture-source.js';
import { resolvePortalCaptureSource } from '../../src/portal/capture-source-admission.js';

const url = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1';
const ports = {
  sessions: { active: () => undefined, list: () => [] },
  bindingFor: async () => null,
};

it.each(['page-api', 'scripter'] as const)(
  'admits an explicit Chrome %s collector in the public request and retained grant',
  async collector => {
    const args = PortalPlanArgsSchema.parse({
      case: 'new',
      design: { source: 'chrome', collector, url },
    });
    const value = await resolvePortalCaptureSource(args.design, { kind: 'portal-source' }, ports);
    expect(value.grant).toMatchObject({ kind: 'chrome', collector });
    expect(value.target.sessionId).toBeNull();
  },
);

it('preserves the exact historical omitted-collector grant shape', async () => {
  const old = await resolvePortalCaptureSource(
    { source: 'chrome', url },
    { kind: 'portal-source' },
    ports,
  );
  expect(Object.hasOwn(old.grant, 'collector')).toBe(false);
  expect(JSON.stringify(PortalCaptureGrantSchema.parse(old.grant))).toBe(JSON.stringify(old.grant));
  expect(Object.hasOwn(PortalPlanArgsSchema.parse({ case: 'new' }).design, 'collector')).toBe(
    false,
  );
});

it.each(['desktop', 'official-mcp'] as const)(
  'rejects a Chrome collector selector on %s',
  source => {
    expect(
      PortalPlanArgsSchema.safeParse({
        case: 'new',
        design: { source, collector: 'page-api', url },
      }).success,
    ).toBe(false);
  },
);

it('rejects unsupported collector names rather than selecting a fallback', () => {
  expect(
    PortalPlanArgsSchema.safeParse({
      case: 'new',
      design: { source: 'chrome', collector: 'automatic', url },
    }).success,
  ).toBe(false);
});
