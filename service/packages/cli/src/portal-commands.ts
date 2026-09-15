/* eslint-disable no-await-in-loop -- each explicit service reference receives its own registered root grant */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { PortalPlanArgsSchema } from '@sfp/shared';

import {
  AtomicFileStore,
  readFileWithinLimit,
  withRetainedDirectoryChain,
} from '../../mcp/src/fs/atomic-file.js';
import { ControlClient } from './control-client.js';

const usage = (message: string) =>
  Object.assign(new Error(message), { code: 'CLI_USAGE', exitCode: 2 });
/** Resolve concrete new/legacy/reference inputs before invoking the same authenticated portal tool. */
export const runPortalPlanCommand = async (
  args: string[],
  emit: (value: unknown) => void,
  options: { client?: ControlClient; home?: string } = {},
): Promise<boolean> => {
  if (args[0] !== 'portal' || args[1] !== 'plan') return false;
  const parsed = parseArgs({
    args: args.slice(2),
    allowPositionals: false,
    strict: true,
    options: {
      case: { type: 'string' },
      target: { type: 'string' },
      out: { type: 'string' },
      reference: { type: 'string', multiple: true },
      stack: { type: 'string' },
      url: { type: 'string' },
      workspace: { type: 'string' },
      'workspace-id': { type: 'string' },
      args: { type: 'string' },
      'args-file': { type: 'string' },
      'design-artifact': { type: 'string' },
      yes: { type: 'boolean', default: false },
      'capture-result': { type: 'boolean', default: false },
      timeout: { type: 'string', default: '900' },
      'operation-id': { type: 'string' },
    },
  });
  const flags = parsed.values;
  if (flags.args && flags['args-file']) throw usage('Use --args or --args-file');
  if (flags.workspace && flags['workspace-id']) throw usage('Use --workspace or --workspace-id');
  const raw = flags['args-file']
    ? new TextDecoder('utf-8', { fatal: true }).decode(
        await readFileWithinLimit(resolve(flags['args-file']), 1_048_576),
      )
    : (flags.args ?? '{}');
  if (Buffer.byteLength(raw) > 1_048_576) throw usage('Portal plan arguments exceed 1 MiB');
  const input: unknown = JSON.parse(raw);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw usage('Portal plan arguments must be an object');
  const request = {
    ...input,
    ...(flags.case ? { case: flags.case } : {}),
    ...(flags.stack ? { stack: flags.stack } : {}),
  } as Record<string, unknown>;
  if (flags.url)
    request.design = {
      ...(typeof request.design === 'object' && request.design ? request.design : {}),
      url: flags.url,
    };
  const legacy = request.case === 'legacy';
  if (flags.target && !legacy)
    throw usage('--target selects an existing legacy project; use --out for a new project');
  if (legacy && flags.out) throw usage('Use --target for the legacy project');
  if (
    flags['workspace-id'] &&
    (flags.target || flags.out || flags.reference?.length || flags['design-artifact'])
  )
    throw usage('Use workspace-relative JSON arguments with --workspace-id');
  const client = options.client ?? new ControlClient();
  let workspaceId = flags['workspace-id'];
  let root = flags.workspace ? resolve(flags.workspace) : undefined;
  if (flags.target) {
    if (root) throw usage('Use --target or --workspace');
    root = resolve(flags.target);
    request.targetPath = '.';
  }
  if (flags.out) {
    if (root) throw usage('Use --out or --workspace');
    const target = resolve(flags.out);
    root = dirname(target);
    request.targetPath = basename(target);
  }
  if (!workspaceId && !root)
    root = legacy
      ? process.cwd()
      : join(options.home ?? homedir(), 'Projects', 'SuperFigmaPortals');
  const referencePaths = flags.reference ?? [];
  if (referencePaths.length && Array.isArray(request.references) && request.references.length)
    throw usage('Use --reference flags or JSON references');
  if (request.case === 'new-blank' && referencePaths.length)
    throw usage('Case 4 cannot include service references');
  if (
    request.case === 'new-reference' &&
    !referencePaths.length &&
    (!Array.isArray(request.references) || !request.references.length)
  )
    throw usage('Case 3 requires at least one service reference');
  if (legacy && request.targetPath === undefined)
    throw usage('A legacy project requires --target or targetPath');
  PortalPlanArgsSchema.parse({
    ...request,
    ...(referencePaths.length
      ? {
          references: referencePaths.map((_, index) => ({
            workspaceId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          })),
        }
      : {}),
  });
  if (root) {
    for (const reference of referencePaths) {
      const from = relative(resolve(reference), root);
      if (from === '' || (!isAbsolute(from) && from !== '..' && !from.startsWith(`..${sep}`)))
        throw usage('Choose an output root outside the reference service');
    }
    if (legacy) {
      const metadata = await lstat(root);
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw usage('Legacy target must be an existing directory');
    } else await mkdir(root, { recursive: true });
    if (relative(root, await realpath(root)) !== '')
      throw usage('Choose a canonical workspace directory without aliases');
    workspaceId = await client.workspace(root);
  }
  if (referencePaths.length) {
    const references = [];
    for (const reference of referencePaths) {
      // eslint-disable-next-line no-await-in-loop -- each explicitly selected reference gets an independent read grant
      references.push({
        workspaceId: await client.workspace(resolve(reference)),
        rootPath: '.',
        role: 'primary',
      });
    }
    request.references = references;
  }
  if (flags['design-artifact']) {
    if (!root) throw usage('--design-artifact requires a concrete workspace path');
    const bytes = await readFileWithinLimit(resolve(flags['design-artifact']), 16_777_216);
    if (bytes.length > 16_777_216) throw usage('Design artifact exceeds 16 MiB');
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const folder = join(root, '.sfp', 'portal-inputs');
    const name = `${digest}.json`;
    await withRetainedDirectoryChain(
      root,
      folder,
      async held => {
        const target = held.child(name);
        const present = await lstat(target).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!present) await new AtomicFileStore().createNew(target, bytes);
        else if (
          present.isSymbolicLink() ||
          !present.isFile() ||
          createHash('sha256')
            .update(await readFile(target))
            .digest('hex') !== digest
        )
          throw usage('Pinned design input changed');
      },
      { createMissing: true },
    );
    request.design = {
      ...(typeof request.design === 'object' && request.design ? request.design : {}),
      artifactPath: `.sfp/portal-inputs/${name}`,
      artifactHash: `sha256:${digest}`,
    };
  }
  const parsedRequest = PortalPlanArgsSchema.parse(request);
  const seconds = Number(flags.timeout);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600)
    throw usage('--timeout must be between 1 and 3600 seconds');
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    emit(
      await client.invoke({
        name: 'portal_plan',
        kind: 'tool',
        args: parsedRequest,
        workspaceId: workspaceId ?? null,
        targetSelector: { kind: 'none' },
        approve: flags.yes,
        captureResult: flags['capture-result'],
        timeoutMs: seconds * 1000,
        signal: controller.signal,
        emit,
        ...(flags['operation-id'] ? { operationId: flags['operation-id'] } : {}),
      }),
    );
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
  return true;
};
