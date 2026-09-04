import { join } from 'node:path';

import {
  type GetScreenshotResult,
  type SavedScreenshot,
  type SaveScreenshotsResult,
  SCREENSHOT_FORMATS,
  type ScreenshotImage,
} from '@sfp/shared';
import { z } from 'zod';

import { AtomicFileStore, type AtomicWritePort } from '../fs/atomic-file.js';
import { binaryPayload } from './binary-payload.js';
import { GET_SCREENSHOT_TOOL_NAME } from './get-screenshot.js';
import type { RawToolSpec } from './spec.js';

export const SAVE_SCREENSHOTS_TOOL_NAME = 'save_screenshots';

const inputSchema = z.object({
  nodeIds: z.array(z.string()).describe('Figma node ids to export'),
  outDir: z.string().describe('Directory to write files into (created if missing)'),
  format: z
    .enum(SCREENSHOT_FORMATS)
    .describe('Export format: PNG (default) / JPG / SVG')
    .optional(),
  scale: z.number().positive().describe('Raster scale factor (PNG/JPG), default 1').optional(),
});

export const saveScreenshotsTool: RawToolSpec = {
  name: SAVE_SCREENSHOTS_TOOL_NAME,
  description:
    'Export nodes and write them to disk under outDir: { saved: [{ nodeId, format, path, recovered?, empty? }] }. ' +
    'format is PNG (default) / JPG / SVG; scale applies to raster formats (default 1). ' +
    'path is null for missing or non-exportable nodes. Nodes that are fully clipped or off-canvas ' +
    "(e.g. a carousel's edge items) are auto-recovered at their intrinsic bounds and flagged recovered:true. " +
    'empty:true means the node genuinely renders nothing even unclipped (hidden / no content) so the file is blank. ' +
    'Files are named after a sanitized node id.',
  inputSchema,
  kind: 'local',
  // No sandbox handler of its own; its plugin arguments are recorded under the tool it reuses.
  serverOnlyArgs: null,
};
const EXTENSIONS: Record<string, string> = { PNG: 'png', JPG: 'jpg', SVG: 'svg' };

/** Map a Figma node id (e.g. "1:2") to a filesystem-safe basename, blocking path traversal. */
const sanitize = (id: string): string => id.replace(/[^\w.-]/g, '-');

/**
 * Land the exported images as files under outDir (created if missing). Pure-fs and dispatch-free so
 * it can be unit-tested against a temp directory.
 */
export const writeScreenshots = async (
  outDir: string,
  images: readonly ScreenshotImage[],
  files: AtomicWritePort = new AtomicFileStore(),
): Promise<SaveScreenshotsResult> => {
  const dir = outDir;
  const planned = images.map(img => {
    const flags = {
      ...(img.empty === true ? { empty: true as const } : {}),
      ...(img.recovered === true ? { recovered: true as const } : {}),
    };
    const payload = binaryPayload(img);
    if (payload === null) {
      return { img, flags, payload: null, path: null } as const;
    }
    const ext = EXTENSIONS[img.format] ?? img.format.toLowerCase();
    return { img, flags, payload, path: join(dir, `${sanitize(img.nodeId)}.${ext}`) } as const;
  });
  const seen = new Set<string>();
  for (const plan of planned) {
    if (plan.path === null) continue;
    if (seen.has(plan.path)) {
      throw Object.assign(new Error('sanitized screenshot outputs collide'), {
        code: 'OUTPUT_PATH_CONFLICT',
        committed: false,
      });
    }
    seen.add(plan.path);
  }
  const writes = planned.filter(
    (plan): plan is typeof plan & { path: string; payload: Buffer } =>
      plan.path !== null && plan.payload !== null,
  );
  const settlements = await Promise.allSettled(
    writes.map(plan => files.createNew(plan.path, plan.payload)),
  );
  const failures = settlements.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length > 0) {
    const committed =
      settlements.some(result => result.status === 'fulfilled') ||
      failures.some(
        failure =>
          typeof failure.reason === 'object' &&
          failure.reason !== null &&
          (failure.reason as { committed?: unknown }).committed === true,
      );
    if (!committed) throw failures[0]!.reason;
    throw Object.assign(
      new Error('one or more screenshot outputs may have been published', {
        cause: new AggregateError(
          failures.map(failure => failure.reason),
          'screenshot output settlements failed',
        ),
      }),
      { code: 'MULTI_OUTPUT_PUBLICATION_FAILED', committed: true },
    );
  }
  const published = new Map(
    writes.map((plan, index) => [
      plan.path,
      (settlements[index] as PromiseFulfilledResult<Readonly<{ path: string }>>).value.path,
    ]),
  );
  const saved: SavedScreenshot[] = planned.map(plan =>
    Object.assign(
      {
        nodeId: plan.img.nodeId,
        format: plan.img.format,
        path: plan.path === null ? null : (published.get(plan.path) as string),
      },
      plan.flags,
    ),
  );
  return { saved };
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Reuses the plugin-side get_screenshot export (no dedicated plugin handler) to fetch the raster
 * bytes, then lands them on the server filesystem — the first server-side write tool.
 */
export const handleSaveScreenshots = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
  files?: AtomicWritePort,
): Promise<SaveScreenshotsResult> => {
  const args = inputSchema.parse(rawArgs);

  const screenshotArgs: Record<string, unknown> = { nodeIds: args.nodeIds };
  // These bytes go to disk, never to a model, so they ride the wire as a msgpack `bin`.
  screenshotArgs.binary = true;
  if (args.format !== undefined) screenshotArgs.format = args.format;
  // Always pass an explicit scale: an omitted scale makes get_screenshot auto-fit the raster for
  // model consumption, but files written to disk are user artifacts and must stay full-res.
  screenshotArgs.scale = args.scale ?? 1;

  const { images } = (await dispatch(
    GET_SCREENSHOT_TOOL_NAME,
    screenshotArgs,
  )) as GetScreenshotResult;
  return writeScreenshots(args.outDir, images, files);
};
