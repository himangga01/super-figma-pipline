import { runInNewContext } from 'node:vm';

import pngModule from '@pdf-lib/upng';

export const officialTarget = { fileKey: '4IBhv1d8hEclifZQrOYxHS', nodeId: '0:1' };
export const officialUrl = `https://www.figma.com/design/${officialTarget.fileKey}?node-id=0-1`;
/** A controlled SDK server runs the exact fixed program against a minimal read/export Plugin API. */
export function officialServerFixture(
  options: {
    tool?: boolean;
    fileArgument?: boolean;
    required?: string[];
    prose?: boolean;
    partial?: boolean;
    missingAsset?: boolean;
    unsupportedVariables?: boolean;
  } = {},
) {
  const png =
    'encode' in pngModule
      ? pngModule
      : (pngModule as unknown as { default: typeof pngModule }).default;
  const bytes = Buffer.from(png.encode([new Uint8Array([255, 255, 255, 255]).buffer], 1, 1, 0));
  const nodes: Record<string, any>[] = [
    {
      id: '1:1',
      name: 'Welcome',
      type: 'FRAME',
      width: 100,
      height: 100,
      boundVariables: {},
      reactions: [],
      exportAsync: async () => {
        if (options.missingAsset) throw Error('ASSET_NOT_FOUND');
        return bytes;
      },
      ...(options.partial
        ? { children: [{ id: '2:2', name: 'Child', type: 'TEXT', characters: 'x' }] }
        : {}),
    },
  ];
  const page = { id: '0:1', name: 'Page', type: 'PAGE', selection: [], children: nodes };
  for (const node of nodes) node.parent = page;
  const figma = {
    fileKey: officialTarget.fileKey,
    editorType: 'figma',
    root: { name: 'Fixture' },
    currentPage: page,
    setCurrentPageAsync: async (value: typeof page) => {
      figma.currentPage = value;
    },
    getNodeByIdAsync: async (id: string) =>
      id === page.id ? page : (nodes.find(node => node.id === id) ?? null),
    variables: options.unsupportedVariables
      ? {}
      : {
          getLocalVariablesAsync: async () => [],
          getLocalVariableCollectionsAsync: async () => [],
        },
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
    getImageByHash: () => null,
    base64Encode: (value: Uint8Array) => Buffer.from(value).toString('base64'),
  };
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let beforeCall: (() => void) | undefined;
  let rewrite: ((value: Record<string, any>) => Record<string, any>) | undefined;
  const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    if (init?.method === 'DELETE') return new Response(null, { status: 200 });
    const message = JSON.parse(String(init?.body));
    if (message.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    if (message.method === 'initialize')
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'Official Figma fixture', version: '1' },
      };
    else if (message.method === 'tools/list')
      result = {
        tools:
          options.tool === false
            ? []
            : [
                {
                  name: 'use_figma',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      ...(options.fileArgument === false ? {} : { fileKey: { type: 'string' } }),
                      code: { type: 'string' },
                      skillNames: { type: 'string' },
                      title: { type: 'string' },
                    },
                    required: options.required ?? ['fileKey', 'code'],
                  },
                },
              ],
      };
    else {
      calls.push(message.params);
      beforeCall?.();
      if (options.prose) result = { content: [{ type: 'text', text: '<frame id="0:1" />' }] };
      else {
        try {
          let value = await runInNewContext(
            `(async () => {${message.params.arguments.code}\n})()`,
            { figma },
            { timeout: 1000 },
          );
          if (rewrite) value = rewrite(value);
          result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
        } catch {
          result = {
            isError: true,
            content: [{ type: 'text', text: 'Controlled server program failure' }],
          };
        }
      }
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    fetch,
    calls,
    figma,
    nodes,
    bytes,
    beforeCall: (fn: () => void) => {
      beforeCall = fn;
    },
    rewrite: (fn: (value: Record<string, any>) => Record<string, any>) => {
      rewrite = fn;
    },
  };
}
