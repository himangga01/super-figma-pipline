import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { GetDesignContextResult } from '@sfp/shared';
import { z } from 'zod';

import { designDiffRelativePath } from '../diff/baseline-identity.js';
import { type DesignDiffChanges, diffDesignContext } from '../diff/design-diff.js';
import { AtomicFileStore, type AtomicWritePort } from '../fs/atomic-file.js';
import { RepoReader } from '../fs/repo-walk.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from './get-design-context.js';
import type { RawToolSpec } from './spec.js';

export const DESIGN_DIFF_TOOL_NAME = 'design_diff';

// design_diff turns the one-shot Figma→code flow into an incremental one: snapshot a node's
// get_design_context now, and on a later run report exactly what changed in the design (per node,
// per property) so an agent edits the affected code instead of regenerating the screen. The baseline
// is written under .sfp/design-diff-baselines/v1/ — the tool never mutates Figma and
// never touches an existing code path; it's a local consumer of get_design_context, like token_map.

/**
 * Bumped only when the on-disk snapshot shape changes; an older file is re-baselined, never
 * mis-diffed. v2: the read-dimension batch (itemReverseZIndex / strokesIncludedInLayout /
 * targetAspectRatio / numberOfFixedChildren / annotations / filtersApplied) — a v1 baseline lacking
 * those fields would report them as spurious "changes" against a fresh capture. v3: a baseline is
 * bound to the stable file hash and exact node identity. Old node-only files stay untouched and
 * must be recaptured, since they cannot prove which file produced them.
 */
const SNAPSHOT_FORMAT_VERSION = 3;

const inputSchema = z.object({
  nodeId: z
    .string()
    .describe('Node to snapshot / diff (a pasted Figma URL also works); omit to use the selection')
    .optional(),
  rootDir: z.string().describe('Project root; defaults to the server cwd').optional(),
  update: z
    .boolean()
    .describe('After diffing, overwrite the baseline with the current design (accept the changes)')
    .optional(),
});

export const designDiffTool: RawToolSpec = {
  name: DESIGN_DIFF_TOOL_NAME,
  description:
    'Diff a Figma node against a saved baseline of itself, so after a design changes you edit only ' +
    'the affected code instead of regenerating. First call on a node saves a baseline (its ' +
    'get_design_context, full detail) under .sfp/design-diff-baselines/v1/ using file and node digests, and returns status ' +
    "'baseline-created'; a later call returns status 'diff' with the per-node, per-property changes " +
    '(added / removed / changed nodes; fills, layout/padding, text, token bindings — resolved to ' +
    "readable values, not opaque ids) or 'no-changes'. Pass update:true to accept the current design " +
    'as the new baseline (re-snapshot). nodeId defaults to the selection; rootDir defaults to the ' +
    'server cwd. The baseline is a plain file the tool writes under the project — committing it (so ' +
    'teammates share the baseline) or gitignoring it is your call; the tool never changes git. It ' +
    'never mutates Figma. A stable file identity is required. Old node-only baselines need recapture. ' +
    'The selection slot refuses a changed root; use an explicit nodeId for separate selection baselines. ' +
    'Scope by a component / section nodeId, the same unit codegen works on.',
  inputSchema,
  kind: 'local',
  // No sandbox handler of its own; its plugin arguments are recorded under the tool it reuses.
  serverOnlyArgs: null,
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * The on-disk snapshot: a format tag + provenance + the raw get_design_context result
 * (re-diffable).
 */
interface SnapshotFile {
  figwrightSnapshot: number;
  fileIdentityHash: string;
  nodeId: string;
  capturedAt: string;
  context: GetDesignContextResult;
}

export interface DesignDiffResult {
  status: 'baseline-created' | 'diff' | 'no-changes';
  /** The node id the baseline is keyed by (the requested nodeId, or the resolved root). */
  nodeId: string;
  /** Repo-relative path of the baseline file. */
  snapshotPath: string;
  /** When the compared-against baseline was captured (absent on baseline-created). */
  baselineCapturedAt?: string;
  summary?: { added: number; removed: number; changed: number };
  changes?: DesignDiffChanges;
  /** True when update:true rewrote the baseline to the current design. */
  baselineUpdated?: boolean;
  note?: string;
}

export interface DesignDiffSnapshotAuthority {
  relativePath: string;
  absolutePath: string;
  overwrites: boolean;
  destructiveApproved: boolean;
}

/**
 * Root-identity sanity check: warn (don't refuse) when the baseline root looks like a different
 * node.
 */
const identityNote = (
  baseline: GetDesignContextResult,
  current: GetDesignContextResult,
): string | undefined => {
  const b = baseline.nodes[0];
  const c = current.nodes[0];
  if (b === undefined || c === undefined) return undefined;
  if (b.name === c.name && b.type === c.type) return undefined;
  return (
    `baseline root was "${b.name}" [${b.type}] but the current root is "${c.name}" [${c.type}] — ` +
    'a different node or a renamed root. If this is intentional, re-baseline with update:true.'
  );
};

const writeSnapshot = async (
  absPath: string,
  nodeId: string,
  context: GetDesignContextResult,
  files: AtomicWritePort,
  destructiveApproved: boolean,
  fileIdentityHash: string,
  expectedDigest64?: string,
): Promise<SnapshotFile> => {
  const snap: SnapshotFile = {
    figwrightSnapshot: SNAPSHOT_FORMAT_VERSION,
    fileIdentityHash,
    nodeId,
    capturedAt: new Date().toISOString(),
    context,
  };
  const bytes = Buffer.from(JSON.stringify(snap, null, 2), 'utf8');
  if (expectedDigest64 === undefined) await files.createNew(absPath, bytes);
  else {
    await files.replace(absPath, bytes, {
      destructiveApproved,
      expectedDigest64,
    });
  }
  return snap;
};

/** Read + validate a baseline; returns null when absent, unreadable, unparseable, or a stale format. */
const readSnapshot = async (
  reader: RepoReader,
  relativePath: string,
): Promise<{ snapshot: SnapshotFile | null; digest64: string | null }> => {
  let raw: string;
  try {
    raw = await reader.readText(relativePath);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'REPO_FILE_NOT_FOUND') {
      return { snapshot: null, digest64: null };
    }
    throw error;
  }
  const digest64 = createHash('sha256').update(raw, 'utf8').digest('hex');
  try {
    const parsed = JSON.parse(raw) as Partial<SnapshotFile>;
    if (
      parsed.figwrightSnapshot !== SNAPSHOT_FORMAT_VERSION ||
      typeof parsed.context !== 'object' ||
      parsed.context === null
    ) {
      return { snapshot: null, digest64 };
    }
    return { snapshot: parsed as SnapshotFile, digest64 };
  } catch {
    return { snapshot: null, digest64 };
  }
};

/**
 * Snapshot-or-diff a node's design. Fetches the current get_design_context once (the only plugin
 * round-trip — reading the baseline and computing the diff are local + synchronous), then either
 * writes the first baseline or diffs against the saved one. Pure diff logic lives in
 * diff/design-diff.
 */
export const handleDesignDiff = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
  reader?: RepoReader,
  files: AtomicWritePort = new AtomicFileStore(),
  snapshotAuthority?: Readonly<DesignDiffSnapshotAuthority>,
  fileIdentityHash = '',
): Promise<DesignDiffResult> => {
  const args = inputSchema.parse(rawArgs);
  const relPath = designDiffRelativePath(fileIdentityHash, args.nodeId);
  const rootDir = reader?.rootDir ?? args.rootDir ?? process.cwd();
  const repo = reader ?? new RepoReader({ rootDir });

  const current = (await dispatch(GET_DESIGN_CONTEXT_TOOL_NAME, {
    ...(args.nodeId === undefined ? {} : { nodeId: args.nodeId }),
    detail: 'full',
    dedupeComponents: true,
  })) as GetDesignContextResult;

  // Key the baseline by the requested nodeId, or the resolved root when the selection was used.
  const nodeId = args.nodeId ?? current.nodes[0]?.id;
  if (nodeId === undefined) {
    throw new Error('design_diff: no node to diff (empty selection and no nodeId)');
  }
  const absPath = join(rootDir, relPath);
  const multiRootNote =
    args.nodeId === undefined && current.nodes.length > 1
      ? `selection has ${current.nodes.length} root nodes; the baseline is keyed by the first ("${current.nodes[0]?.name}"). Pass an explicit nodeId for a stable per-node baseline.`
      : undefined;

  const observed = await readSnapshot(repo, relPath.split('\\').join('/'));
  const existing = observed.snapshot;
  if (
    existing !== null &&
    (existing.fileIdentityHash !== fileIdentityHash ||
      existing.nodeId !== nodeId ||
      existing.context.nodes?.[0]?.id !== current.nodes[0]?.id)
  ) {
    throw Object.assign(
      new Error(
        'baseline belongs to another file or selection; use an explicit nodeId and recapture',
      ),
      {
        code: 'DESIGN_DIFF_BASELINE_IDENTITY_MISMATCH',
      },
    );
  }
  const authority =
    snapshotAuthority ??
    Object.freeze({
      relativePath: relPath,
      absolutePath: absPath,
      overwrites: observed.digest64 !== null,
      destructiveApproved: false,
    });
  if (
    authority.relativePath !== relPath ||
    authority.absolutePath !== absPath ||
    authority.overwrites !== (observed.digest64 !== null)
  ) {
    throw Object.assign(new Error('snapshot authority does not match the observed derived path'), {
      code: 'SNAPSHOT_AUTHORITY_MISMATCH',
    });
  }

  if (existing === null) {
    if (observed.digest64 !== null && args.update !== true) {
      throw Object.assign(new Error('stale snapshot replacement requires update:true'), {
        code: 'SNAPSHOT_REPLACE_REQUIRES_UPDATE',
      });
    }
    await writeSnapshot(
      absPath,
      nodeId,
      current,
      files,
      authority.destructiveApproved,
      fileIdentityHash,
      observed.digest64 ?? undefined,
    );
    return {
      status: 'baseline-created',
      nodeId,
      snapshotPath: relPath,
      ...(multiRootNote === undefined ? {} : { note: multiRootNote }),
    };
  }

  const changes = diffDesignContext(existing.context, current);
  const summary = {
    added: changes.added.length,
    removed: changes.removed.length,
    changed: changes.changed.length,
  };
  const hasChanges = summary.added + summary.removed + summary.changed > 0;

  if (args.update === true) {
    await writeSnapshot(
      absPath,
      nodeId,
      current,
      files,
      authority.destructiveApproved,
      fileIdentityHash,
      observed.digest64 ?? undefined,
    );
  }

  const notes = [identityNote(existing.context, current), multiRootNote].filter(
    (n): n is string => n !== undefined,
  );

  return {
    status: hasChanges ? 'diff' : 'no-changes',
    nodeId,
    snapshotPath: relPath,
    baselineCapturedAt: existing.capturedAt,
    summary,
    changes,
    ...(args.update === true ? { baselineUpdated: true } : {}),
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
};
