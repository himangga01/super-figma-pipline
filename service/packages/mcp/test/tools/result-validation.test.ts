import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createResultSchemaRegistry, RESULT_SCHEMAS } from '../../../shared/src/result-schemas.js';
import { finalizeToolSpecs } from '../../src/tools/registry.js';
import {
  createRuntimeRegistry,
  executeToolRuntime,
  type RuntimeBinding,
  type RuntimeExecutionContext,
} from '../../src/tools/runtime-registry.js';
import type { RawToolSpec } from '../../src/tools/spec.js';

const signal = new AbortController().signal;
const contextReturning = (value: unknown): RuntimeExecutionContext => ({
  execute: async () => value,
});

describe('canonical result validation', () => {
  it('rejects a skewed get_selection plugin result with PLUGIN_RESULT_INVALID', async () => {
    await expect(
      executeToolRuntime('get_selection', contextReturning({ unexpected: true }), {}, signal),
    ).rejects.toMatchObject({
      code: 'PLUGIN_RESULT_INVALID',
      toolName: 'get_selection',
    });
  });

  it('preserves a valid screenshot binary result after canonical parsing', async () => {
    const fixture = {
      images: [
        {
          nodeId: '1:2',
          format: 'PNG',
          base64: null,
          bytes: new Uint8Array([137, 80, 78, 71]),
          width: 1,
          height: 1,
          scale: 1,
        },
      ],
    };

    await expect(
      executeToolRuntime('get_screenshot', contextReturning(fixture), {}, signal),
    ).resolves.toEqual(fixture);
  });

  it('validates the save_screenshots server adapter result instead of bypassing it', async () => {
    const fixture = {
      saved: [{ nodeId: '1:2', format: 'PNG', path: 'artifacts/frame.png', recovered: true }],
    };

    await expect(
      executeToolRuntime('save_screenshots', contextReturning(fixture), {}, signal),
    ).resolves.toEqual(fixture);
    await expect(
      executeToolRuntime(
        'save_screenshots',
        contextReturning({ ...fixture, unexpected: true }),
        {},
        signal,
      ),
    ).rejects.toMatchObject({ code: 'SERVER_RESULT_INVALID', toolName: 'save_screenshots' });
  });

  it('accepts an explicit server-local analyze_project result fixture', async () => {
    const fixture = {
      rootDir: 'C:/workspace',
      framework: 'react',
      language: 'ts',
      styling: { system: 'plain-css' },
      svg: { mode: 'url' },
      componentExtensions: ['.tsx'],
      evidence: ['react dependency'],
    };

    await expect(
      executeToolRuntime('analyze_project', contextReturning(fixture), {}, signal),
    ).resolves.toEqual(fixture);
  });
});

describe('authority initialization failures', () => {
  const raw: RawToolSpec = {
    name: 'example',
    description: 'example',
    inputSchema: z.object({}),
    kind: 'read',
  };
  const resultSchema = z.object({ ok: z.literal(true) }).strict();
  const binding: RuntimeBinding = {
    authority: 'plugin',
    runtime: { execute: async () => ({ ok: true }) },
  };

  it('throws on duplicate result-schema and runtime rows', () => {
    expect(() =>
      createResultSchemaRegistry([
        ['example', resultSchema],
        ['example', resultSchema],
      ]),
    ).toThrow(/duplicate result schema.*example/i);
    expect(() =>
      createRuntimeRegistry([
        ['example', binding],
        ['example', binding],
      ]),
    ).toThrow(/duplicate runtime.*example/i);
  });

  it('throws while finalizing duplicate, missing, or extra authority rows', () => {
    expect(() =>
      finalizeToolSpecs([raw, raw], { example: resultSchema }, { example: binding }),
    ).toThrow(/duplicate raw tool spec.*example/i);
    expect(() => finalizeToolSpecs([raw], {}, { example: binding })).toThrow(
      /missing result schema.*example/i,
    );
    expect(() => finalizeToolSpecs([raw], { example: resultSchema }, {})).toThrow(
      /missing runtime.*example/i,
    );
    expect(() =>
      finalizeToolSpecs(
        [raw],
        { example: resultSchema, extra: RESULT_SCHEMAS.get_selection! },
        { example: binding },
      ),
    ).toThrow(/result schema without raw tool spec.*extra/i);
  });
});
