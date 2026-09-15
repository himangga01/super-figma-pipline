import { PortalDesignEvidenceSchema } from '@sfp/shared';
import { expect, it } from 'vitest';
import { z } from 'zod';

import { PortalCaptureError } from '../../src/portal/capture-failure.js';

it('bounds schema evidence and removes arbitrary field names and messages', () => {
  const cause = new z.ZodError(
    Array.from({ length: 12 }, () => ({
      code: 'custom' as const,
      path: ['assets', 9999, 'private-field', 'path'],
      message: 'private value',
    })),
  );
  const error = new PortalCaptureError('schema', cause, Date.now());
  expect(error.cause).toBe(cause);
  expect(error.diagnostic).toMatchObject({
    stage: 'schema',
    type: 'schema-error',
    schemaIssueCount: 12,
  });
  expect(error.diagnostic.schemaPaths).toEqual(Array(8).fill('assets.[].?.path'));
  expect(JSON.stringify(error.diagnostic)).not.toMatch(/private|9999/u);
});

it('does not leak arbitrary exception codes into public issues', () => {
  const cause = Object.assign(new Error('Bearer private endpoint'), { code: 'private-secret' });
  expect(new PortalCaptureError('connection', cause, Date.now()).code).toBe(
    'DESIGN_CAPTURE_FAILED',
  );
  expect(
    new PortalCaptureError(
      'connection',
      new Error('CHROME_CONNECTION_REQUIRED: private endpoint'),
      Date.now(),
    ).code,
  ).toBe('CHROME_CONNECTION_REQUIRED');
});

it('does not invent capture diagnostics for older design records', () => {
  const design = PortalDesignEvidenceSchema.parse({
    url: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS',
    fileKey: '4IBhv1d8hEclifZQrOYxHS',
    nodeId: null,
    artifactPath: null,
    artifactHash: null,
    liveVerified: false,
    complete: false,
  });
  expect(design).not.toHaveProperty('captureFailure');
});
