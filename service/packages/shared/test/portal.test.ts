import { expect, it } from 'vitest';

import { PortalSourceAuthorityVersionSchema } from '../src/portal.js';
import {
  PortalCandidateFileSchema,
  PortalPlanArgsSchema,
  PortalPathSchema,
  PortalPrepareSourceArgsSchema,
  PortalSourcePreparationResultSchema,
  resolvePortalCase,
} from '../src/portal.js';
const reference = { workspaceId: '11111111-1111-4111-8111-111111111111' };
it('keeps public compiler preparation bound and separate from candidate or capture authority', () => {
  const input = {
    runId: 'sfp_portal1_' + 'a'.repeat(32),
    profileId: 'c3-source',
    sourceId: 'sha256:' + 'b'.repeat(64),
    deadlineAt: 1791800000000,
  };
  expect(PortalPrepareSourceArgsSchema.safeParse(input).success).toBe(true);
  for (const extra of [
    { compilerEvidence: {} },
    { candidateHash: 'sha256:' + 'c'.repeat(64) },
    { leaseId: '11111111-1111-4111-8111-111111111111' },
  ])
    expect(PortalPrepareSourceArgsSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  const result = {
    schemaVersion: 1,
    preparationId: 'sha256:' + 'c'.repeat(64),
    sourceId: input.sourceId,
    sourceInventoryHash: 'sha256:' + 'd'.repeat(64),
    compilerEvidenceHash: 'sha256:' + 'e'.repeat(64),
    status: 'ready',
    sourcePreparationOnly: true,
    requiresReplan: true,
    authorityExpiresOnRestart: true,
    generatedFiles: 4,
  };
  expect(PortalSourcePreparationResultSchema.safeParse(result).success).toBe(true);
  expect(
    PortalSourcePreparationResultSchema.safeParse({ ...result, sourcePreparationOnly: false })
      .success,
  ).toBe(false);
  expect(
    PortalSourcePreparationResultSchema.safeParse({ ...result, state: 'completed' }).success,
  ).toBe(false);
});
it('allows base64 expansion for the existing one-MiB binary budget while retaining the text limit', () => {
  const file = {
    path: 'public/banner.png',
    action: 'create',
    baseHash: null,
    contentHash: `sha256:${'a'.repeat(64)}`,
    encoding: 'base64',
    content: `${'AAAA'.repeat(349_525)}AA==`, // 1,048,576 zero bytes.
  };
  expect(PortalCandidateFileSchema.safeParse(file).success).toBe(true);
  expect(PortalCandidateFileSchema.safeParse({ ...file, encoding: 'utf8' }).success).toBe(false);
  expect(
    PortalCandidateFileSchema.safeParse({
      ...file,
      content: `${'AAAA'.repeat(349_525)}AAA=`, // One byte over the decoded budget.
    }).success,
  ).toBe(false);
});
it('preserves four user cases while resolving scope from references', () => {
  expect(resolvePortalCase({})).toEqual({
    requestedCase: 'new',
    strategy: 'blank-frontend',
    implementationScope: 'frontend-only',
  });
  expect(resolvePortalCase({ case: 'new', references: [reference] }).implementationScope).toBe(
    'operational-portal',
  );
  expect(resolvePortalCase({ case: 'legacy', targetPath: '.' }).strategy).toBe('legacy-portal');
  expect(
    resolvePortalCase({ case: 'new-reference', references: [reference] }).implementationScope,
  ).toBe('operational-portal');
  expect(resolvePortalCase({ case: 'new-blank' }).implementationScope).toBe('frontend-only');
  expect(PortalPlanArgsSchema.parse({}).design.url).toContain('4IBhv1d8hEclifZQrOYxHS');
});
it('rejects missing references, case downgrades and backend work in C4', () => {
  expect(PortalPlanArgsSchema.safeParse({ case: 'new-reference' }).success).toBe(false);
  expect(
    PortalPlanArgsSchema.safeParse({ case: 'new-blank', references: [reference] }).success,
  ).toBe(false);
  expect(PortalPlanArgsSchema.safeParse({ case: 'legacy' }).success).toBe(false);
  expect(
    PortalPlanArgsSchema.safeParse({
      requirements: [{ id: 'save', description: 'persist orders', layers: ['database'] }],
    }).success,
  ).toBe(false);
  expect(
    PortalPlanArgsSchema.safeParse({
      case: 'legacy',
      targetPath: '.',
      requirements: [{ id: 'save', description: 'persist orders', layers: ['database'] }],
    }).success,
  ).toBe(true);
});
it('rejects path aliases before allocating a target', () => {
  for (const value of [
    '../out',
    'C:/out',
    '/out',
    'src\\index.ts',
    'CON',
    'src/a.',
    'src//x',
    'src/../x',
  ])
    expect(PortalPathSchema.safeParse(value).success).toBe(false);
  expect(PortalPathSchema.safeParse('src/routes/index.tsx').success).toBe(true);
});

it('emits source authority numeric bounds without an unrepresentable transform', () => {
  expect(PortalSourceAuthorityVersionSchema.toJSONSchema()).toMatchObject({
    type: 'integer',
    maximum: 2,
  });
  expect(PortalSourceAuthorityVersionSchema.parse(1)).toBe(1);
  expect(PortalSourceAuthorityVersionSchema.parse(undefined)).toBeUndefined();
  expect(() => PortalSourceAuthorityVersionSchema.parse(3)).toThrow(
    'PORTAL_SOURCE_AUTHORITY_VERSION_UNSUPPORTED',
  );
});
