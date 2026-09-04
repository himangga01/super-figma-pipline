import { z } from 'zod';

import { BASE64_IMAGE_MAX_BYTES, DECODED_IMAGE_MAX_BYTES } from '../security/request-limits.js';
import { assertBase64Payload, BinaryPayloadError } from './binary-payload.js';
import type { RawToolSpec } from './spec.js';

export const IMPORT_IMAGE_TOOL_NAME = 'import_image';

const imageDataSchema = z.string().trim().min(1);
const imageUrlSchema = z
  .string()
  .min(1)
  .refine(value => value.trim().length > 0, 'image URL must not be blank');

const inputSchema = z
  .object({
    data: imageDataSchema.optional().describe('Base64-encoded image bytes (PNG / JPG / GIF)'),
    url: imageUrlSchema.optional().describe('Image URL to fetch instead of data'),
    name: z.string().optional().describe('Optional name for the new rectangle'),
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional().describe('Override width (default: image width)'),
    height: z.number().optional().describe('Override height (default: image height)'),
    scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
  })
  .superRefine((value, context) => {
    if ((value.data === undefined) === (value.url === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'import_image requires exactly one nonempty data or url source',
      });
    }
  });

export const importImageTool: RawToolSpec = {
  name: IMPORT_IMAGE_TOOL_NAME,
  description:
    'Import a raster image (PNG / JPG / GIF) and place it as a rectangle with an IMAGE fill. Provide ' +
    'exactly one source: data (base64-encoded image bytes) or url. The rectangle defaults to the image size unless ' +
    'width/height are given. scaleMode is FILL / FIT / CROP / TILE (default FILL). For vector SVG ' +
    '(logos / icons) use import_svg instead. Returns { ok, nodeId, name, type }.',
  inputSchema,
  kind: 'write',
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

export interface ImportImageRemotePolicy {
  allowedDomains: readonly string[];
  maxRedirects: number;
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}

export interface ImportImageRemoteFetcherPort {
  fetchApproved(
    url: string,
    policy: Readonly<ImportImageRemotePolicy>,
    signal: AbortSignal,
  ): Promise<Readonly<{ bytes: Uint8Array; mime: string; finalUrlHash: string }>>;
}

export interface ImportImageDomainSnapshotPort {
  list(): Promise<readonly Readonly<{ fqdnAscii: string }>[]>;
}

export interface ImportImageRuntimeDependencies {
  fetcher: ImportImageRemoteFetcherPort;
  domains: ImportImageDomainSnapshotPort;
  signal: AbortSignal;
}

const REMOTE_IMAGE_MIME_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const);

const remoteImagePolicy = (allowedDomains: readonly string[]): Readonly<ImportImageRemotePolicy> =>
  Object.freeze({
    allowedDomains: Object.freeze([...allowedDomains]),
    maxRedirects: 3,
    maxBytes: DECODED_IMAGE_MAX_BYTES,
    allowedMimeTypes: REMOTE_IMAGE_MIME_TYPES,
  });

const unavailableFetcher = () =>
  Object.assign(new Error('daemon remote image fetch boundary is unavailable'), {
    code: 'REMOTE_IMAGE_FETCHER_UNAVAILABLE',
  });

/** Validate inline bytes or convert one approved URL to canonical data before plugin dispatch. */
export const handleImportImage = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
  dependencies?: Readonly<ImportImageRuntimeDependencies>,
): Promise<unknown> => {
  const args = inputSchema.parse(rawArgs);
  if (args.data !== undefined) {
    assertBase64Payload(args.data, {
      encodedMaxBytes: BASE64_IMAGE_MAX_BYTES,
      decodedMaxBytes: DECODED_IMAGE_MAX_BYTES,
      code: 'PAYLOAD_TOO_LARGE',
    });
    dependencies?.signal.throwIfAborted();
    return dispatch(IMPORT_IMAGE_TOOL_NAME, args);
  }
  if (dependencies === undefined) throw unavailableFetcher();
  dependencies.signal.throwIfAborted();
  const rules = await dependencies.domains.list();
  dependencies.signal.throwIfAborted();
  const fetched = await dependencies.fetcher.fetchApproved(
    args.url as string,
    remoteImagePolicy(rules.map(rule => rule.fqdnAscii)),
    dependencies.signal,
  );
  dependencies.signal.throwIfAborted();
  if (fetched.bytes.byteLength > DECODED_IMAGE_MAX_BYTES) {
    throw new BinaryPayloadError(
      'PAYLOAD_TOO_LARGE',
      DECODED_IMAGE_MAX_BYTES,
      fetched.bytes.byteLength,
    );
  }
  const data = Buffer.from(fetched.bytes).toString('base64');
  assertBase64Payload(data, {
    encodedMaxBytes: BASE64_IMAGE_MAX_BYTES,
    decodedMaxBytes: DECODED_IMAGE_MAX_BYTES,
    code: 'PAYLOAD_TOO_LARGE',
  });
  dependencies.signal.throwIfAborted();
  const { url: _url, ...nonSourceArgs } = args;
  return dispatch(IMPORT_IMAGE_TOOL_NAME, { ...nonSourceArgs, data });
};
