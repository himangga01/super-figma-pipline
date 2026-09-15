import { expect, it, vi } from 'vitest';

import { deriveRecipePalette, deriveRecipeTypeScale } from '../src/recipe-design-system.js';

const fonts = {
  scope: 'available',
  fonts: ['Regular', 'Medium', 'Semi Bold', 'Bold'].map(style => ({
    fontName: { family: 'Inter', style },
    count: 0,
  })),
};
it('derives the actual scale formulas, integer pixel line heights and percent spacing', () => {
  const scale = deriveRecipeTypeScale({
    request: { family: 'Inter', base: 16, display: true },
    fonts,
  });
  expect(scale.status).toBe('ready-to-plan');
  expect(scale.rows).toHaveLength(13);
  expect(scale.rows.find(row => row.name === 'Heading/H1')).toMatchObject({
    weight: 700,
    args: {
      fontSize: 49,
      lineHeight: { unit: 'PIXELS', value: 59 },
      letterSpacing: { unit: 'PERCENT', value: -1 },
    },
  });
  expect(scale.rows.find(row => row.name === 'Heading/H3')!.args.fontName.style).toBe('Semi Bold');
  expect(
    deriveRecipeTypeScale({ request: { family: 'Inter', base: 1 }, fonts }).rows.every(
      row => row.args.fontSize >= 10,
    ),
  ).toBe(true);
});
it('does not claim used or legacy font lists prove availability', () => {
  expect(
    deriveRecipeTypeScale({
      request: { family: 'Inter', base: 16 },
      fonts: { fonts: fonts.fonts },
    }),
  ).toMatchObject({
    status: 'blocked',
    issues: expect.arrayContaining(['FONT_AVAILABILITY_NOT_OBSERVED']),
  });
  expect(deriveRecipeTypeScale({ request: { family: 'Missing', base: 16 }, fonts }).status).toBe(
    'blocked',
  );
});
it('reuses exact observed styles but never skips conflicting styles by name', () => {
  const row = deriveRecipeTypeScale({ request: { family: 'Inter', base: 16 }, fonts }).rows[0]!;
  const existing = { id: 'style:1', key: '', description: 'existing', ...row.args };
  const exact = deriveRecipeTypeScale({
    request: { family: 'Inter', base: 16 },
    fonts,
    existingStyles: [existing],
  });
  expect(exact.rows[0]).toMatchObject({ status: 'reuse', existingStyleIds: ['style:1'] });
  expect(
    deriveRecipeTypeScale({
      request: { family: 'Inter', base: 16 },
      fonts,
      existingStyles: [{ ...existing, fontSize: 99 }],
    }).rows[0]!.status,
  ).toBe('conflict');
  expect(
    deriveRecipeTypeScale({
      request: { family: 'Inter', base: 16 },
      fonts,
      existingStyles: [existing, { ...existing, id: 'style:2' }],
    }).status,
  ).toBe('blocked');
});
it('feeds derived typography into the actual canonical handler with font loading before creation', async () => {
  const { createCreateTextStyleHandler } = await vi.importActual<{
    createCreateTextStyleHandler: (ctx: unknown) => (args: unknown) => Promise<unknown>;
  }>('../../plugin/src/handlers/create-text-style.js');
  const calls: string[] = [];
  const style = {
    id: 'style:1',
    name: '',
    fontName: { family: 'Inter', style: 'Regular' },
    remove: () => {
      calls.push('remove');
    },
  };
  const handler = createCreateTextStyleHandler({
    loadFontAsync: async (font: { family: string; style: string }) => {
      calls.push('font:' + font.family + '/' + font.style);
    },
    createTextStyle: () => {
      calls.push('create');
      return style;
    },
  });
  const args = deriveRecipeTypeScale({ request: { family: 'Inter', base: 16 }, fonts }).rows[0]!
    .args;
  expect(await handler(args)).toMatchObject({ ok: true, styleId: 'style:1', name: 'Heading/H1' });
  expect(calls[0]).toBe('font:Inter/Bold');
  expect(calls[1]).toBe('create');
  expect(style).toMatchObject({
    fontSize: 49,
    lineHeight: { unit: 'PIXELS', value: 59 },
    letterSpacing: { unit: 'PERCENT', value: -1 },
  });
});
it('builds all ten palette levels, preserves brand 500 exactly and retains native alias intent', () => {
  const palette = deriveRecipePalette({ primary: '#123456' });
  expect(
    palette.primitives.filter(row => row.name.startsWith('Primary/')).map(row => row.level),
  ).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  expect(palette.primitives.find(row => row.name === 'Primary/500')).toMatchObject({
    hex: '#123456',
    exactBrand: true,
  });
  expect(palette.aliases.find(row => row.name === 'Color/Primary/Default')).toMatchObject({
    values: {
      Light: { kind: 'primitive-reference', name: 'Primary/500' },
      Dark: { kind: 'primitive-reference', name: 'Primary/400' },
    },
  });
  expect(palette.prerequisites).toContain('CANONICAL_ADD_MODE_MAY_FAIL_HOST_LIMIT');
  expect(
    deriveRecipePalette({ primary: '#123456', modeStrategy: 'paired-collections' }).prerequisites,
  ).toEqual([]);
});
it('keeps optional neutral/secondary choices and derived palette identity explicit', () => {
  const a = deriveRecipePalette({ primary: '#ff0000', neutral: false, dark: false });
  expect(a.primitives).toHaveLength(10);
  expect(a.aliases.every(alias => !JSON.stringify(alias.values).includes('Neutral/'))).toBe(true);
  expect(a.aliases.every(alias => !('Dark' in alias.values))).toBe(true);
  expect(deriveRecipePalette({ primary: '#ff0000', secondary: '#00ff00' }).primitives).toHaveLength(
    30,
  );
  expect(deriveRecipePalette({ primary: '#00ff00' }).inputHash).not.toBe(a.inputHash);
});
