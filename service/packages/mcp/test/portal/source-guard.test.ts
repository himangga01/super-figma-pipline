import { expect, it } from 'vitest';

import { assertFrontendSource } from '../../src/portal/source-guard.js';

it('returns the stable candidate AST limit for a wide valid source array', () => {
  const source = 'export const data = [' + '0,'.repeat(130000) + '];';
  expect(Buffer.byteLength(source)).toBeLessThan(262144);
  expect(() => assertFrontendSource('src/data.ts', source)).toThrow('PORTAL_CANDIDATE_AST_LIMIT');
});

it('accepts Vue generic script blocks and ignores commented-out server code', () => {
  expect(() =>
    assertFrontendSource(
      'src/Card.vue',
      '<!-- <script>import x from "express"</script> --><script setup lang="ts" generic="T extends Record<string, unknown>">const x = 1;</script><template><div /></template>',
    ),
  ).not.toThrow();
});
it.each([
  ['src/api.ts', 'import x from "@nestjs/core";'],
  ['src/api.ts', 'const x = import("node:http");'],
  ['src/action.ts', '"use server"; export const action = async () => {};'],
  ['packages/web/package.json', '{"dependencies":{"pg":"8"}}'],
  ['src/Card.vue', '<script src="./server.ts"></script>'],
  ['src/main.rs', 'fn main() {}'],
  ['src/main.ts', 'Bun.serve({fetch: () => new Response("server")});'],
  ['src/main.ts', 'Deno.serve(() => new Response("server"));'],
  ['package.json', '{"dependencies":{"friendly":"npm:express@5"}}'],
  ['src/main.ts', 'import {serve} from "bun"; serve({fetch:()=>new Response("x")});'],
  ['src/main.ts', 'globalThis.Bun.serve({fetch:()=>new Response("x")});'],
  ['src/main.ts', 'export {createServer} from "node:http";'],
])('rejects backend behavior or unread script context in C4: %s', (path, source) => {
  expect(() => assertFrontendSource(path, source)).toThrow(/PORTAL_/u);
});
