import { GetFontsResultSchema, SerializedTextStyleSchema, isBoundedDesignJson } from '@sfp/shared';
import { z } from 'zod';

import { coreHash, freezeCore } from '../../mcp/src/portal/recipes/core-source.js';
import { createTextStyleTool } from '../../mcp/src/tools/create-text-style.js';
import { recipeHexColor } from './recipe-helpers.js';

const limit = (value: unknown) => {
  if (!isBoundedDesignJson(value, 4194304, 100000))
    throw new Error('RECIPE_DERIVATION_INPUT_LIMIT');
};
const ratios = {
  'minor-third': 1.2,
  'major-third': 1.25,
  'perfect-fourth': 1.333,
  golden: 1.618,
} as const;
const typographyRequest = z
  .object({
    family: z.string().min(1).max(256),
    base: z.number().min(1).max(200),
    ratio: z
      .enum(['minor-third', 'major-third', 'perfect-fourth', 'golden'])
      .default('major-third'),
    display: z.boolean().default(false),
    codeFamily: z.string().min(1).max(256).optional(),
    fontStyles: z
      .object({
        regular: z.string().min(1).max(128),
        medium: z.string().min(1).max(128),
        semibold: z.string().min(1).max(128),
        bold: z.string().min(1).max(128),
      })
      .optional(),
  })
  .strict();
const scaleRows = [
  ['Display/2XL', 7, 700, 1.1, -2],
  ['Display/XL', 6, 700, 1.1, -2],
  ['Heading/H1', 5, 700, 1.2, -1],
  ['Heading/H2', 4, 700, 1.25, -1],
  ['Heading/H3', 3, 600, 1.3, 0],
  ['Heading/H4', 2, 600, 1.35, 0],
  ['Body/XL', 1, 400, 1.6, 0],
  ['Body/Base', 0, 400, 1.6, 0],
  ['Body/SM', -1, 400, 1.5, 0],
  ['Label/LG', 0.5, 500, 1.4, 1],
  ['Label/Base', 0, 500, 1.4, 1],
  ['Label/SM', -1, 500, 1.4, 2],
  ['Caption/Base', -1.5, 400, 1.4, 2],
  ['Code/Base', 0, 400, 1.6, 0],
] as const;
const styleKey = (style: string) => style.toLowerCase().replace(/[ -]/gu, '');
/** Derives a preview, not execution authority. Every creation still loads the actual face first. */
export function deriveRecipeTypeScale(input: {
  request: z.input<typeof typographyRequest>;
  fonts: unknown;
  existingStyles?: unknown[];
}) {
  limit(input);
  const request = typographyRequest.parse(input.request),
    fonts = GetFontsResultSchema.parse(input.fonts),
    existing = z
      .array(SerializedTextStyleSchema)
      .max(10000)
      .parse(input.existingStyles ?? []);
  const faces = request.fontStyles ?? {
      regular: 'Regular',
      medium: 'Medium',
      semibold: 'SemiBold',
      bold: 'Bold',
    },
    issues: string[] = [];
  if (fonts.scope !== 'available') issues.push('FONT_AVAILABILITY_NOT_OBSERVED');
  const rows = scaleRows
    .filter(
      ([name]) =>
        (request.display || !name.startsWith('Display/')) &&
        (request.codeFamily !== undefined || name !== 'Code/Base'),
    )
    .map(([name, power, weight, lineRatio, spacing]) => {
      const family = name === 'Code/Base' ? request.codeFamily! : request.family,
        requestedStyle =
          weight === 700
            ? faces.bold
            : weight === 600
              ? faces.semibold
              : weight === 500
                ? faces.medium
                : faces.regular,
        candidates =
          fonts.scope === 'available'
            ? fonts.fonts.filter(
                font =>
                  font.fontName.family === family &&
                  styleKey(font.fontName.style) === styleKey(requestedStyle),
              )
            : [];
      const font =
        candidates.length === 1 ? candidates[0]!.fontName : { family, style: requestedStyle };
      const fontSize = Math.max(10, Math.round(request.base * ratios[request.ratio] ** power));
      const args = createTextStyleTool.inputSchema.parse({
        name,
        fontName: font,
        fontSize,
        lineHeight: { unit: 'PIXELS', value: Math.round(fontSize * lineRatio) },
        letterSpacing: { unit: 'PERCENT', value: spacing },
        textWrapStyle: 'AUTO',
      }) as {
        name: string;
        fontName: { family: string; style: string };
        fontSize: number;
        lineHeight: { unit: 'PIXELS'; value: number };
        letterSpacing: { unit: 'PERCENT'; value: number };
        textWrapStyle: 'AUTO';
      };
      const found = existing.filter(style => style.name === name);
      const same =
        found.length === 1 &&
        coreHash({
          fontName: found[0]!.fontName,
          fontSize: found[0]!.fontSize,
          lineHeight: found[0]!.lineHeight,
          letterSpacing: found[0]!.letterSpacing,
          textWrapStyle: found[0]!.textWrapStyle,
          boundVariables: found[0]!.boundVariables ?? {},
        }) ===
          coreHash({
            fontName: args.fontName,
            fontSize: args.fontSize,
            lineHeight: args.lineHeight,
            letterSpacing: args.letterSpacing,
            textWrapStyle: args.textWrapStyle,
            boundVariables: {},
          });
      const status =
        candidates.length !== 1
          ? 'font-unavailable'
          : found.length === 0
            ? 'create'
            : same
              ? 'reuse'
              : 'conflict';
      if (status === 'font-unavailable')
        issues.push(`FONT_FACE_UNAVAILABLE_OR_AMBIGUOUS:${family}/${requestedStyle}`);
      if (status === 'conflict') issues.push(`TEXT_STYLE_CONFLICT:${name}`);
      return {
        name,
        weight,
        power,
        status,
        args,
        existingStyleIds: found.map(style => style.id),
        sourceStyleHashes: found.map(coreHash),
      };
    });
  return freezeCore({
    version: 1,
    algorithm: 'rust-type-scale-service-v1',
    inputHash: coreHash({ request, fonts, existing }),
    fontEvidenceHash: coreHash(fonts),
    status: issues.length ? 'blocked' : 'ready-to-plan',
    issues: [...new Set(issues)],
    rows,
  });
}
const paletteRequest = z
  .object({
    primary: z.string().min(3).max(7),
    secondary: z.string().min(3).max(7).optional(),
    neutral: z.boolean().default(true),
    dark: z.boolean().default(true),
    neutralSaturation: z.number().min(0.05).max(0.1).default(0.075),
    modeStrategy: z.enum(['single-collection', 'paired-collections']).default('single-collection'),
  })
  .strict();
const levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const lights = [0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.35, 0.25, 0.15] as const;
function hsl(color: { r: number; g: number; b: number }) {
  const max = Math.max(color.r, color.g, color.b),
    min = Math.min(color.r, color.g, color.b),
    d = max - min,
    l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const h =
    (max === color.r
      ? (color.g - color.b) / d + (color.g < color.b ? 6 : 0)
      : max === color.g
        ? (color.b - color.r) / d + 2
        : (color.r - color.g) / d + 4) / 6;
  return { h, s: d / (1 - Math.abs(2 * l - 1)), l };
}
const hue = (p: number, q: number, t: number) => {
  t = ((t % 1) + 1) % 1;
  return t < 1 / 6
    ? p + (q - p) * 6 * t
    : t < 1 / 2
      ? q
      : t < 2 / 3
        ? p + (q - p) * (2 / 3 - t) * 6
        : p;
};
function rgb(h: number, s: number, l: number) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q;
  const raw =
    s === 0
      ? { r: l, g: l, b: l }
      : { r: hue(p, q, h + 1 / 3), g: hue(p, q, h), b: hue(p, q, h - 1 / 3) };
  return {
    r: Math.round(raw.r * 255) / 255,
    g: Math.round(raw.g * 255) / 255,
    b: Math.round(raw.b * 255) / 255,
    a: 1,
  };
}
const colorHex = (color: { r: number; g: number; b: number }) =>
  '#' +
  [color.r, color.g, color.b]
    .map(value =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();
/**
 * Ten explicit levels, with exact source brand at 500 and native aliases rather than flattened
 * colors.
 */
export function deriveRecipePalette(input: z.input<typeof paletteRequest>) {
  limit(input);
  const request = paletteRequest.parse(input),
    primary = recipeHexColor(request.primary),
    base = hsl(primary);
  const brands = [
    { name: 'Primary', color: primary, neutral: false },
    ...(request.secondary
      ? [{ name: 'Secondary', color: recipeHexColor(request.secondary), neutral: false }]
      : []),
    ...(request.neutral ? [{ name: 'Neutral', color: primary, neutral: true }] : []),
  ];
  const primitives = brands.flatMap(brand => {
    const source = hsl(brand.color);
    return levels.map((level, index) => {
      const value =
        level === 500 && !brand.neutral
          ? { ...brand.color, a: 1 }
          : rgb(source.h, brand.neutral ? request.neutralSaturation : source.s, lights[index]!);
      return {
        name: `${brand.name}/${level}`,
        level,
        value,
        hex: colorHex(value),
        source: brand.neutral ? 'derived-neutral' : 'brand-hsl',
        exactBrand: level === 500 && !brand.neutral,
      };
    });
  });
  const aliases = [
    ['Color/Primary/Default', 'Primary/500', 'Primary/400'],
    ['Color/Primary/Hover', 'Primary/600', 'Primary/300'],
    ['Color/Primary/Active', 'Primary/700', 'Primary/200'],
    ['Color/Primary/Subtle', 'Primary/100', 'Primary/800'],
    ['Color/Border/Focus', 'Primary/500', 'Primary/400'],
    ...(request.neutral
      ? [
          ['Color/Background/Default', 'Neutral/50', 'Neutral/900'],
          ['Color/Background/Subtle', 'Neutral/100', 'Neutral/800'],
          ['Color/Text/Default', 'Neutral/900', 'Neutral/50'],
          ['Color/Text/Subtle', 'Neutral/600', 'Neutral/300'],
          ['Color/Text/Disabled', 'Neutral/400', 'Neutral/600'],
          ['Color/Border/Default', 'Neutral/200', 'Neutral/700'],
        ]
      : []),
  ].map(([name, light, dark]) => ({
    name: name!,
    values: {
      Light: { kind: 'primitive-reference' as const, name: light! },
      ...(request.dark ? { Dark: { kind: 'primitive-reference' as const, name: dark! } } : {}),
    },
  }));
  return freezeCore({
    version: 1,
    algorithm: 'rust-palette-service-v1',
    inputHash: coreHash(request),
    request,
    primaryHueDegrees: base.h * 360,
    adaptation:
      'Ten levels; service dark completion for unspecified source aliases; neutral 500 lightness is 0.5; existing default mode labels are not renamed.',
    modeRoles: request.dark ? ['Light', 'Dark'] : ['Light'],
    modeStrategy: request.modeStrategy,
    primitives,
    aliases,
    prerequisites:
      request.dark && request.modeStrategy === 'single-collection'
        ? ['CANONICAL_ADD_MODE_MAY_FAIL_HOST_LIMIT']
        : [],
  });
}
