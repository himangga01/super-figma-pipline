import * as shared from '@sfp/shared';
import { describe, expect, it } from 'vitest';

const schema = (
  shared as typeof shared & {
    ServiceOperationNameSchema?: {
      parse(value: unknown): unknown;
      safeParse(value: unknown): { success: boolean };
    };
  }
).ServiceOperationNameSchema;

describe('service operation names are distinct from tool names', () => {
  it.each(['snapshot.capture', 'grounding.refresh'])('accepts exact service name %s', name => {
    expect(schema?.parse(name)).toBe(name);
    expect(shared.ToolNameSchema.safeParse(name).success).toBe(false);
  });

  it.each([
    '',
    'snapshot_capture',
    'snapshot/capture',
    'Snapshot.capture',
    'snapshot..capture',
    '.snapshot',
    'snapshot.',
    `${'a'.repeat(126)}.b`,
    `${'a'.repeat(127)}.b`,
  ])('rejects invalid or non-enum service name %s', name => {
    expect(schema?.safeParse(name).success).toBe(false);
  });
});
