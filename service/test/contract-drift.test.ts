import { describe, expect, it } from 'vitest';

import { driftReport, generateContracts } from '../scripts/contracts-lib.mjs';

// The single drift check for everything generated from the tool registry. Other contract tests
// check the registry or the committed artifacts on their own terms; only this one compares the two,
// so a new or changed tool fails here, once, with the command that regenerates every artifact.

describe('generated tool contracts', () => {
  it('match the tool registry; regenerate them with pnpm contracts:update', async () => {
    const artifacts = await generateContracts();
    const report = driftReport(artifacts);

    expect(artifacts.map(artifact => artifact.path)).toEqual([
      'capabilities/union-manifest.json',
      'packages/mcp/test/plugin-contract.json',
      'README.md',
      'packages/mcp/README.md',
    ]);
    expect(report, 'stale generated artifacts; run pnpm contracts:update').toBe('');
  });
});
