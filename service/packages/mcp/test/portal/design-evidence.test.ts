import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type PortalPlan, storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { portalContentBytes } from '../../src/portal/content.js';
import { readPortalDesignPage } from '../../src/portal/design-evidence.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
it('pages original Figma values without discarding hierarchy, layout, paints or typography', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const data = JSON.stringify({
    nodes: [
      {
        id: '1:1',
        type: 'FRAME',
        layoutMode: 'HORIZONTAL',
        itemSpacing: 23.5,
        children: [
          {
            id: '1:2',
            type: 'TEXT',
            characters: 'Hello',
            fontSize: 37,
            fills: [{ type: 'SOLID', color: { r: 0.5, g: 0.1, b: 0.2 } }],
          },
        ],
      },
    ],
  });
  await writeFile(join(value.workspaceRoot, 'design.json'), data);
  const plan = {
    workspaceId: value.workspaceId,
    design: { artifactPath: 'design.json', artifactHash: storedChecksum(data) },
  } as PortalPlan;
  const first = await readPortalDesignPage(plan, value.policy, 0, 1, new AbortController().signal);
  expect(first).toMatchObject({
    totalNodes: 2,
    nextOffset: 1,
    nodes: [
      {
        id: '1:1',
        parentId: null,
        childIds: ['1:2'],
        properties: { layoutMode: 'HORIZONTAL', itemSpacing: 23.5 },
      },
    ],
  });
  const second = await readPortalDesignPage(plan, value.policy, 1, 1, new AbortController().signal);
  expect(second).toMatchObject({
    nextOffset: null,
    nodes: [
      {
        id: '1:2',
        parentId: '1:1',
        properties: {
          characters: 'Hello',
          fontSize: 37,
          fills: [{ type: 'SOLID', color: { r: 0.5, g: 0.1, b: 0.2 } }],
        },
      },
    ],
  });
  await writeFile(join(value.workspaceRoot, 'design.json'), '{}');
  await expect(
    readPortalDesignPage(plan, value.policy, 0, 1, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_DESIGN_HASH_MISMATCH' });
}, 30_000);
it('decodes binary assets exactly while refusing source masquerading as a binary submission', () => {
  const bytes = Buffer.from([137, 80, 78, 71, 0, 255]);
  expect(
    portalContentBytes({
      path: 'public/hero.png',
      encoding: 'base64',
      content: bytes.toString('base64'),
    }),
  ).toEqual(bytes);
  expect(() =>
    portalContentBytes({ path: 'src/server.js', encoding: 'base64', content: 'eA==' }),
  ).toThrow('PORTAL_BINARY_SOURCE_FORBIDDEN');
  expect(() =>
    portalContentBytes({ path: 'public/hero.png', encoding: 'base64', content: 'eA=garbage' }),
  ).toThrow('PORTAL_BINARY_ENCODING_INVALID');
});

it('pages independent large collections and style families without losing raw values', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const collections = Array.from({ length: 300 }, (_, i) => ({
    id: 'c' + i,
    modes: [{ modeId: 'm' + i, name: 'Theme' }],
  }));
  const paints = Array.from({ length: 270 }, (_, i) => ({
    id: 'p' + i,
    paints: [{ type: 'SOLID', color: { r: i / 300, g: 0, b: 0 } }],
  }));
  const data = JSON.stringify({
    nodes: [],
    tokens: [{ id: 'v', valuesByMode: { m: 42 } }],
    collections,
    styles: { paints, texts: [{ id: 't', fontSize: 27 }], effects: [], grids: [] },
  });
  await writeFile(join(value.workspaceRoot, 'design.json'), data);
  const plan = {
    workspaceId: value.workspaceId,
    design: { artifactPath: 'design.json', artifactHash: storedChecksum(data) },
  } as PortalPlan;
  const first = await readPortalDesignPage(
    plan,
    value.policy,
    0,
    1,
    new AbortController().signal,
    undefined,
    0,
    { collectionOffset: 0, styleFamily: 'paints', styleOffset: 0 },
  );
  expect(first).toMatchObject({
    totalCollections: 300,
    nextCollectionOffset: 128,
    collections: collections.slice(0, 128),
    styles: { family: 'paints', rows: paints.slice(0, 128), total: 270, nextOffset: 128 },
  });
  const last = await readPortalDesignPage(
    plan,
    value.policy,
    0,
    1,
    new AbortController().signal,
    undefined,
    1,
    { collectionOffset: 256, styleFamily: 'paints', styleOffset: 256 },
  );
  expect(last).toMatchObject({
    tokens: [],
    collections: collections.slice(256),
    nextCollectionOffset: null,
    styles: { rows: paints.slice(256), nextOffset: null },
  });
  const text = await readPortalDesignPage(
    plan,
    value.policy,
    0,
    1,
    new AbortController().signal,
    undefined,
    0,
    { collectionOffset: 300, styleFamily: 'texts', styleOffset: 0 },
  );
  expect(text).toMatchObject({
    collections: [],
    styles: { family: 'texts', rows: [{ id: 't', fontSize: 27 }], total: 1, nextOffset: null },
  });
});

it('continues byte-bounded catalog pages and rejects oversized indivisible rows', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: 'v' + i, value: 'x'.repeat(200000) }));
  const data = JSON.stringify({ nodes: [], tokens: rows, collections: [], styles: { paints: [] } });
  await writeFile(join(value.workspaceRoot, 'design.json'), data);
  const plan = {
    workspaceId: value.workspaceId,
    design: { artifactPath: 'design.json', artifactHash: storedChecksum(data) },
  } as PortalPlan;
  const first = await readPortalDesignPage(plan, value.policy, 0, 1, new AbortController().signal);
  expect(first).toMatchObject({ tokens: rows.slice(0, 2), nextTokenOffset: 2 });
  const second = await readPortalDesignPage(
    plan,
    value.policy,
    0,
    1,
    new AbortController().signal,
    undefined,
    2,
  );
  expect(second).toMatchObject({ tokens: rows.slice(2), nextTokenOffset: null });
  const large = JSON.stringify({ nodes: [], tokens: [{ value: 'x'.repeat(524288) }] });
  await writeFile(join(value.workspaceRoot, 'design.json'), large);
  plan.design.artifactHash = storedChecksum(large);
  await expect(
    readPortalDesignPage(plan, value.policy, 0, 1, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_DESIGN_CATALOG_ROW_LIMIT' });
});

it('preserves Desktop catalog values and distinguishes missing from captured empty styles', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const read = async (
    styles: unknown,
    offsets: Parameters<typeof readPortalDesignPage>[7] = {},
  ) => {
    const data = JSON.stringify({
      source: 'desktop-plugin',
      document: { children: [] },
      variables: {
        variables: [{ id: 'v', valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'alias' } } }],
        collections: [{ id: 'c', modes: [{ modeId: 'm1', name: 'Theme' }] }],
      },
      styles,
    });
    await writeFile(join(value.workspaceRoot, 'design.json'), data);
    const plan = {
      workspaceId: value.workspaceId,
      design: { artifactPath: 'design.json', artifactHash: storedChecksum(data) },
    } as PortalPlan;
    return readPortalDesignPage(
      plan,
      value.policy,
      0,
      1,
      new AbortController().signal,
      undefined,
      0,
      offsets,
    );
  };
  expect(await read({ paints: [] }, { styleFamily: 'paints' })).toMatchObject({
    tokens: [{ valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'alias' } } }],
    collections: [{ id: 'c', modes: [{ modeId: 'm1', name: 'Theme' }] }],
    styles: { availability: 'available', rows: [], total: 0, nextOffset: null },
  });
  expect(await read({}, { styleFamily: 'paints' })).toMatchObject({
    styles: { availability: 'unavailable', rows: [] },
  });
  await expect(read({ paints: {} }, { styleFamily: 'paints' })).rejects.toMatchObject({
    code: 'PORTAL_DESIGN_CATALOG_INVALID',
  });
  await expect(read({}, { collectionOffset: -1 })).rejects.toMatchObject({
    code: 'PORTAL_DESIGN_CATALOG_OFFSET_INVALID',
  });
});

it('rejects retained catalogs beyond the public cursor range', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const data = JSON.stringify({ nodes: [], tokens: Array(100001).fill(null) });
  await writeFile(join(value.workspaceRoot, 'design.json'), data);
  const plan = {
    workspaceId: value.workspaceId,
    design: { artifactPath: 'design.json', artifactHash: storedChecksum(data) },
  } as PortalPlan;
  await expect(
    readPortalDesignPage(plan, value.policy, 0, 1, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_DESIGN_CATALOG_LIMIT' });
});
