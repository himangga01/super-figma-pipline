import { createHash } from 'node:crypto';

import {
  ExportTokensArgsSchema,
  ExportFramesToPdfArgsSchema,
  DoctorArgsSchema,
  DoctorResultSchema,
  ImportLibraryVariableArgsSchema,
  GetVariableDefsResultSchema,
  GetStylesResultSchema,
  toHex,
  type DoctorResult,
  type PdfExport,
} from '@sfp/shared';

import { mergeSinglePagePdfs } from '../execution/pdf-merge.js';
import type { AtomicWritePort } from '../fs/atomic-file.js';
import { resolveFigmaTokens, resolvePaintStyleTokens } from '../tokens/figma-tokens.js';
import { binaryPayload } from './binary-payload.js';
import type { RawToolSpec } from './spec.js';

export const exportTokensTool: RawToolSpec = {
  name: 'export_tokens',
  kind: 'local',
  serverOnlyArgs: null,
  inputSchema: ExportTokensArgsSchema,
  description:
    'Export local Figma variables and paint styles as JSON preserving all variable modes, aliases and paint definitions, or CSS for a requested/default mode. Single visible solid paint styles become color tokens; other paint styles stay in JSON and are reported when CSS cannot represent them. Returns content or atomically creates outPath. CSS floats remain unitless; warnings identify unresolved bindings and name collisions.',
};
export const exportFramesToPdfTool: RawToolSpec = {
  name: 'export_frames_to_pdf',
  kind: 'local',
  serverOnlyArgs: null,
  inputSchema: ExportFramesToPdfArgsSchema,
  description:
    'Export 1–256 frames in the supplied nodeIds order to one PDF. Reuses the existing single-page Figma export, validates every input page, and atomically creates outPath.',
};
export const doctorTool: RawToolSpec = {
  name: 'doctor',
  kind: 'local',
  serverOnlyArgs: null,
  inputSchema: DoctorArgsSchema,
  description:
    'Return public health checks for the local service. roundTrip omitted/false requires no Figma target; true performs a typed, pinned plugin metadata round trip.',
};
export const importLibraryVariableTool: RawToolSpec = {
  name: 'import_library_variable',
  kind: 'write',
  inputSchema: ImportLibraryVariableArgsSchema,
  description:
    'Load a published variable by key from a team library available to the current Figma account. Returns its identity and type. Binding it to a node is a separate operation.',
};

type Dispatch = (name: string, args: unknown) => Promise<unknown>;
const cssString = (value: string) =>
  // eslint-disable-next-line no-control-regex -- reject or escape unsafe control characters
  `"${value.replace(/["\\\u0000-\u001f\u007f]/gu, character => `\\${character.codePointAt(0)!.toString(16)} `)}"`;
export const handleExportTokens = async (
  dispatch: Dispatch,
  input: unknown,
  files?: AtomicWritePort,
) => {
  const args = ExportTokensArgsSchema.parse(input);
  const defs = GetVariableDefsResultSchema.parse(await dispatch('get_variable_defs', {}));
  const styles = GetStylesResultSchema.parse(await dispatch('get_styles', {}));
  const warnings: string[] = [];
  let content: string,
    tokenCount = defs.variables.length + resolvePaintStyleTokens(styles.paints).length;
  if (args.format === 'json') {
    if (args.mode !== undefined)
      warnings.push('JSON preserves all modes; mode selection applies to CSS only.');
    content = `${JSON.stringify(
      {
        ...defs,
        ...(styles.paints.length === 0 ? {} : { paintStyles: styles.paints }),
        ...(styles.variables === undefined ? {} : { styleVariables: styles.variables }),
      },
      null,
      2,
    )}\n`;
  } else {
    const collections = defs.collections.map(collection => {
      const mode =
        args.mode === undefined
          ? undefined
          : collection.modes.find(item => item.modeId === args.mode || item.name === args.mode);
      if (args.mode !== undefined && mode === undefined)
        warnings.push(`Mode not found in ${collection.name}; using its default mode.`);
      return { ...collection, defaultModeId: mode?.modeId ?? collection.defaultModeId };
    });
    const variableTokens = resolveFigmaTokens({ ...defs, collections });
    const byId = new Map(
      defs.variables.map((variable, index) => [variable.id, variableTokens[index]]),
    );
    const paintTokens = styles.paints.flatMap(style => {
      const result = resolvePaintStyleTokens([style]);
      if (result.length === 0) {
        warnings.push(
          `Paint style is not a single visible solid color: ${style.name}; use JSON to preserve its paint definitions.`,
        );
        return result;
      }
      const paint = style.paints.find(value => value.visible !== false);
      const binding = paint?.type === 'SOLID' ? paint.boundVariables?.color : undefined;
      if (binding !== undefined) {
        const variable = byId.get(binding);
        if (
          variable?.type === 'COLOR' &&
          typeof variable.value === 'string' &&
          /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(variable.value)
        ) {
          const hex = variable.value.slice(1);
          const alpha =
            (hex.length === 8 ? Number.parseInt(hex.slice(6), 16) / 255 : 1) *
            (paint?.opacity ?? 1);
          result[0]!.value = toHex(
            {
              r: Number.parseInt(hex.slice(0, 2), 16) / 255,
              g: Number.parseInt(hex.slice(2, 4), 16) / 255,
              b: Number.parseInt(hex.slice(4, 6), 16) / 255,
            },
            alpha,
          );
        } else
          warnings.push(
            `Unresolved paint-style variable binding: ${style.name}; exported its observed color.`,
          );
      }
      return result;
    });
    const tokens = [...variableTokens, ...paintTokens];
    const names = new Set<string>(),
      lines: string[] = [];
    for (const token of tokens) {
      if (token.value === null) {
        warnings.push(`Unresolved variable: ${token.name}`);
        continue;
      }
      let name = token.name
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
      if (name === '')
        name = `token-${createHash('sha256').update(token.name).digest('hex').slice(0, 12)}`;
      if (names.has(name)) {
        name += `-${createHash('sha256').update(`${token.name}\0${lines.length}`).digest('hex').slice(0, 8)}`;
        warnings.push(`Disambiguated CSS variable: ${token.name}`);
      }
      names.add(name);
      const value =
        typeof token.value !== 'string'
          ? String(token.value)
          : token.type === 'COLOR' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(token.value)
            ? token.value
            : token.type === 'EASING' && /^cubic-bezier\([-0-9., ]+\)$/u.test(token.value)
              ? token.value
              : cssString(token.value);
      lines.push(`  --${name}: ${value};`);
    }
    if (tokens.some(token => token.type === 'FLOAT'))
      warnings.push('FLOAT values are unitless; apply units at their usage sites.');
    tokenCount = lines.length;
    content = `:root {\n${lines.join('\n')}\n}\n`;
  }
  if (Buffer.byteLength(content) > 16_777_216) throw new Error('TOKEN_EXPORT_TOO_LARGE');
  if (args.outPath === undefined) return { format: args.format, content, tokenCount, warnings };
  if (files === undefined) throw new Error('WORKSPACE_WRITE_REQUIRED');
  const result = await files.createNew(args.outPath, Buffer.from(content));
  return { format: args.format, path: result.path, tokenCount, warnings };
};

export const handleExportFramesToPdf = async (
  dispatch: Dispatch,
  input: unknown,
  files: AtomicWritePort,
) => {
  const args = ExportFramesToPdfArgsSchema.parse(input);
  const pages: Uint8Array[] = [];
  let bytes = 0;
  for (let index = 0; index < args.nodeIds.length; index += 2) {
    // eslint-disable-next-line no-await-in-loop -- bounded pairs retain the caller's order
    const pair = await Promise.all(
      args.nodeIds.slice(index, index + 2).map(async nodeId => {
        const result = (await dispatch('export_pdf', { nodeId, binary: true })) as PdfExport;
        if (result.nodeId !== nodeId) throw new Error('PDF_FRAME_IDENTITY_MISMATCH');
        const payload = binaryPayload(result);
        if (payload === null || result.empty) throw new Error(`PDF_FRAME_UNAVAILABLE:${nodeId}`);
        return payload;
      }),
    );
    for (const page of pair) {
      bytes += page.byteLength;
      if (bytes > 67_108_864) throw new Error('PDF_INPUT_TOO_LARGE');
      pages.push(page);
    }
  }
  const merged = await mergeSinglePagePdfs(pages);
  if (merged.byteLength > 67_108_864) throw new Error('PDF_OUTPUT_TOO_LARGE');
  const published = await files.createNew(args.outPath, merged);
  return {
    path: published.path,
    nodeIds: args.nodeIds,
    pageCount: pages.length,
    bytesWritten: published.bytes,
    warnings: [],
  };
};

export const handleDoctor = async (
  input: unknown,
  environment: {
    role: string;
    pluginConnected: boolean;
    roundTrip(): Promise<unknown>;
  },
): Promise<DoctorResult> => {
  const args = DoctorArgsSchema.parse(input);
  const checks: DoctorResult['checks'] = [
    {
      id: 'daemon',
      status: environment.role === 'leader' ? 'pass' : 'warn',
      code: 'DAEMON_RESPONDING',
      message: 'Local service is responding.',
    },
    {
      id: 'plugin',
      status: environment.pluginConnected ? 'pass' : 'warn',
      code: environment.pluginConnected ? 'PLUGIN_CONNECTED' : 'PLUGIN_NOT_CONNECTED',
      message: environment.pluginConnected
        ? 'An authenticated Figma plugin is connected.'
        : 'Connect a Figma plugin for desktop design operations.',
    },
  ];
  if (args.roundTrip) {
    try {
      await environment.roundTrip();
      checks.push({
        id: 'round-trip',
        status: 'pass',
        code: 'ROUND_TRIP_OK',
        message: 'Pinned plugin round trip succeeded.',
      });
    } catch {
      checks.push({
        id: 'round-trip',
        status: 'fail',
        code: 'ROUND_TRIP_FAILED',
        message: 'Pinned plugin round trip failed.',
      });
    }
  }
  return DoctorResultSchema.parse({
    overall: checks.some(item => item.status === 'fail')
      ? 'unavailable'
      : checks.some(item => item.status === 'warn')
        ? 'degraded'
        : 'healthy',
    checks,
  });
};
