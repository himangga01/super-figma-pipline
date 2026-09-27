import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UNION_MANIFEST } from '../packages/shared/src/capability-manifest.js';
import { ARTIFACT_PATHS, TOOL_COUNT_BEGIN, TOOL_COUNT_END } from '../scripts/contracts-lib.mjs';

// Docs-sync guard: the tool count is prose in two user-facing READMEs, and it drifted repeatedly
// (the npm page once advertised 96 while the server shipped 101). The count is now written only
// by `pnpm contracts:update`, into one generated block per README; whether that block matches the
// live registry is the single drift check in contract-drift.test.ts. This guard keeps hand-written
// "**N tools**" / "**N MCP tools**" claims from reappearing outside the block, and keeps the
// generated claim consistent with the committed capability manifest. Requiring exactly one claim in
// the block keeps the guard itself honest: a reworded block fails instead of silently un-guarding.

const TOOL_COUNT_CLAIM = /\*\*(\d+)(?: MCP)? tools\*\*/g;
const claims = (text: string): number[] =>
  [...text.matchAll(TOOL_COUNT_CLAIM)].map(match => Number(match[1]));

describe('README tool counts', () => {
  it.each(ARTIFACT_PATHS.readmes)('%s states its tool count only in the generated block', path => {
    const body = readFileSync(join(import.meta.dirname, '..', path), 'utf8');
    const begin = body.indexOf(TOOL_COUNT_BEGIN);
    const end = body.indexOf(TOOL_COUNT_END, begin);

    expect({ path, hasBlock: begin !== -1 && end !== -1 }).toEqual({ path, hasBlock: true });
    expect(claims(body.slice(0, begin) + body.slice(end))).toEqual([]);
    expect(claims(body.slice(begin, end))).toEqual([UNION_MANIFEST.canonicalTools.length]);
  });
});
