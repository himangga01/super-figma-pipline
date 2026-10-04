import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateLockSchema } from '../scripts/upstream-lock-schema.mjs';

const schema = JSON.parse(
  await readFile(join(import.meta.dirname, '../schemas/upstream-lock-v2.schema.json'), 'utf8'),
);

// Exercise the published task constraint independently from the executable's task matcher.
const acceptsTask = (task: unknown) => {
  const rule = schema.$defs.common.properties.transitionTask;
  return (
    typeof task === 'string' &&
    (rule.enum === undefined || rule.enum.includes(task)) &&
    (rule.pattern === undefined || new RegExp(rule.pattern).test(task))
  );
};

describe('published service fork task contract', () => {
  const base = {
    originRepo: 'figwright',
    originPath: 'packages/mcp/src/old.ts',
    previousMode: 'copy',
    originCommit: 'a'.repeat(40),
    baseSha256: 'b'.repeat(64),
    transitionTask: 'review-2026-10-01',
    reason: 'Reviewed source correction',
  };
  const forkSchema = { ...schema.$defs.serviceFork, $defs: schema.$defs };
  const edit = {
    ...base,
    transition: 'edit',
    destination: 'packages/mcp/src/new.ts',
    stagedSha256: 'c'.repeat(64),
  };
  it.each([
    edit,
    {
      ...base,
      transition: 'move',
      oldDestination: 'packages/mcp/src/old.ts',
      newDestination: 'packages/mcp/src/new.ts',
      newSha256: 'c'.repeat(64),
    },
    { ...base, transition: 'delete', destination: 'packages/mcp/src/old.ts', stagedSha256: null },
  ])('accepts a complete legitimate $transition variant in the executable schema gate', row => {
    expect(validateLockSchema(forkSchema, row)).toEqual([]);
  });
  it.each([
    { ...edit, transitionTask: 'unknown' },
    { ...edit, extra: true },
    { ...edit, destination: '../escape.ts' },
    { ...edit, destination: 'dir/' },
    { ...edit, destination: 'line\nbreak.ts' },
    { ...edit, stagedSha256: 'BAD' },
    { ...edit, transition: 'delete' },
    { ...edit, transition: 'move' },
  ])('rejects malformed provenance row %#', row => {
    expect(validateLockSchema(forkSchema, row).length).toBeGreaterThan(0);
  });
  it.each(['7A', '12B', '16', 'review-2026-09-05', 'review-2026-10-01'])(
    'accepts legitimate task %s',
    task => expect(acceptsTask(task)).toBe(true),
  );
  it.each(['7D', '17', 'review-2026-9-05', 'review-2026-09-05-extra', 'unknown', 7])(
    'rejects invalid task %s',
    task => expect(acceptsTask(task)).toBe(false),
  );
});
