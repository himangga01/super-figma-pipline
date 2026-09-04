import type { ExportVideoResult, VideoExport } from '@sfp/shared';
import { z } from 'zod';

import { AtomicFileStore, type AtomicWritePort } from '../fs/atomic-file.js';
import { EXPERIMENTAL_VIDEO_MAX_BYTES } from '../security/request-limits.js';
import { binaryPayload } from './binary-payload.js';
import { videoExportConstraintSchema } from './motion-schemas.js';
import type { RawToolSpec } from './spec.js';

export const EXPORT_VIDEO_TOOL_NAME = 'export_video';

const inputSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'A node in the animated frame to export; its enclosing top-level frame (a frame placed ' +
        'directly on a page) is what gets encoded — pass the frame itself or any descendant',
    ),
  format: z.enum(['MP4', 'GIF', 'WEBM']).describe('MP4 / WebM (video) or GIF (looping)'),
  fps: z
    .number()
    .describe('Frames per second (MP4/WebM: 12/24/30/60; GIF: 8/12/15/24/30). Defaults per format.')
    .optional(),
  quality: z
    .enum(['LOW', 'MEDIUM', 'HIGH'])
    .describe('MP4/WebM quality; ignored for GIF')
    .optional(),
  loopCount: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .describe('GIF only: number of loops; 0 = loop forever')
    .optional(),
  constraint: videoExportConstraintSchema.optional(),
  outPath: z.string().describe('File path to write the video to (parent dirs created if missing)'),
});

export const exportVideoTool: RawToolSpec = {
  name: EXPORT_VIDEO_TOOL_NAME,
  description:
    'Export an animated Figma top-level frame to an MP4 / WebM / GIF file on disk. Pass any node in ' +
    'the frame (or the frame itself) — its enclosing top-level frame is encoded across the ' +
    "animation's duration. Requires the Figma Design editor and a frame with animated content " +
    '(Smart Animate / Motion keyframes); a static frame, a nested frame, or FigJam / Dev Mode ' +
    'yields path:null with a reason (and, when reason is `failed`, Figma’s own message in ' +
    'error). Encoding is a heavy render — call it on its own, not concurrently with other tool ' +
    'calls, or the render can fail. Returns { nodeId, format, path, reason?, error? }.',
  inputSchema,
  kind: 'local',
  // Dispatches to a same-named sandbox handler; outPath stays on the server.
  serverOnlyArgs: ['outPath'],
  injectedArgs: ['binary'],
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Land the exported video bytes on the server filesystem. Pure-fs and dispatch-free so it can be
 * unit-tested against a temp directory. path is null (with the plugin's reason) when nothing
 * encoded.
 */
export const writeExportedVideo = async (
  outPath: string,
  video: VideoExport,
  maxBytes = EXPERIMENTAL_VIDEO_MAX_BYTES,
  files: AtomicWritePort = new AtomicFileStore(),
): Promise<ExportVideoResult> => {
  const miss = {
    ...(video.reason !== undefined ? { reason: video.reason } : {}),
    ...(video.error !== undefined ? { error: video.error } : {}),
  };
  const payload = binaryPayload(video, {
    encodedMaxBytes: Math.ceil(maxBytes / 3) * 4,
    decodedMaxBytes: maxBytes,
    code: 'EXPORT_TOO_LARGE',
  });
  if (payload === null) {
    return { nodeId: video.nodeId, format: video.format, path: null, ...miss };
  }
  const published = await files.createNew(outPath, payload);
  return { nodeId: video.nodeId, format: video.format, path: published.path };
};

/** Reuses the plugin-side export_video handler to fetch the encoded bytes, then writes them to disk. */
export const handleExportVideo = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
  files?: AtomicWritePort,
): Promise<ExportVideoResult> => {
  const { outPath, ...pluginArgs } = inputSchema.parse(rawArgs);
  const video = (await dispatch(EXPORT_VIDEO_TOOL_NAME, {
    // These bytes go to disk, never to a model, so they ride the wire as a msgpack `bin`.
    binary: true,
    ...pluginArgs,
  })) as VideoExport;
  return writeExportedVideo(outPath, video, EXPERIMENTAL_VIDEO_MAX_BYTES, files);
};
