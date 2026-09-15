/* eslint-disable no-await-in-loop -- validate each retained ancestor and reference grant before proceeding */
import { lstat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { contentHash, type PortalPlan } from '@sfp/ir';
import { type PortalAuthority, type PortalPlanArgs, type WorkspacePolicy } from '@sfp/shared';
export type { PortalAuthority } from '@sfp/shared';

import { portalError } from './store.js';

const overlaps = (left: string, right: string) => {
  const r = relative(left, right);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`));
};
export const rootIdentity = async (path: string): Promise<string> => {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw portalError('PORTAL_ROOT_INVALID');
  return `${stat.dev}:${stat.ino}`;
};
export const resolvePortalAuthority = async (
  policy: WorkspacePolicy,
  workspaceId: string,
  request: PortalPlanArgs,
  planId: string,
  scope: PortalAuthority['scope'],
  existing?: PortalPlan,
  retainReferences = false,
): Promise<PortalAuthority> => {
  if (policy.resolveRoot === undefined) throw portalError('WORKSPACE_REQUIRED');
  const primary = await policy.resolveRoot(workspaceId);
  const targetPath =
    existing?.targetPath ?? request.targetPath ?? `generated-portals/${planId.slice(-12)}`;
  const target =
    targetPath === '.'
      ? primary
      : ((await policy.resolveWriteDirectory?.(workspaceId, targetPath.replaceAll('/', sep)))
          ?.path ??
        (
          await policy.resolveWrite(workspaceId, `${targetPath}/package.json`.replaceAll('/', sep))
        ).path.replace(/[\\/]package\.json$/u, ''));
  await policy.assertWithinRoot(workspaceId, target);
  const savedTarget = existing?.repositories.find(root => root.role === 'target');
  let anchor = savedTarget
    ? resolve(primary, savedTarget.anchorPath)
    : request.case === 'legacy'
      ? target
      : dirname(target);
  if (!savedTarget && request.case !== 'legacy') {
    while (anchor !== primary) {
      if (!overlaps(primary, anchor)) throw portalError('PORTAL_TARGET_ANCHOR_OUTSIDE_ROOT');
      // eslint-disable-next-line no-await-in-loop -- retain the nearest existing approved ancestor for a new output
      const present = await lstat(anchor).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (present) break;
      anchor = dirname(anchor);
    }
  }
  const anchorPath = relative(primary, anchor).split(sep).join('/') || '.';
  const roots: PortalAuthority['roots'] = [
    {
      workspaceId,
      rootPath: targetPath,
      anchorPath,
      path: target,
      identity: `${await rootIdentity(primary)}|${await rootIdentity(anchor)}`,
      role: 'target',
      writable: true,
    },
  ];
  for (const reference of request.references) {
    const retained = retainReferences
      ? existing?.repositories.find(
          root =>
            root.role === 'reference' &&
            root.workspaceId === reference.workspaceId &&
            root.rootPath === reference.rootPath,
        )
      : undefined;
    if (retained) {
      roots.push({
        workspaceId: retained.workspaceId,
        rootPath: retained.rootPath,
        anchorPath: retained.anchorPath,
        path: retained.canonicalPath,
        identity: retained.identity,
        role: 'reference',
        writable: false,
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- each reference carries its own approved registration
    const base = await policy.resolveRoot(reference.workspaceId);
    // eslint-disable-next-line no-await-in-loop -- root aliases must be checked before source access
    const path =
      reference.rootPath === '.'
        ? base
        : await policy.resolveRead(reference.workspaceId, reference.rootPath.replaceAll('/', sep));
    if (overlaps(path, target) || overlaps(target, path))
      throw portalError('PORTAL_REFERENCE_TARGET_OVERLAP');
    // eslint-disable-next-line no-await-in-loop -- retain a distinct root identity per grant
    const identity = await rootIdentity(path);
    if (
      roots.some(
        root =>
          root.role === 'reference' &&
          (root.identity === identity || overlaps(root.path, path) || overlaps(path, root.path)),
      )
    )
      throw portalError('PORTAL_REFERENCE_ALIAS');
    roots.push({
      workspaceId: reference.workspaceId,
      rootPath: reference.rootPath,
      anchorPath: reference.rootPath,
      path,
      identity,
      role: 'reference',
      writable: false,
    });
  }
  if (existing) {
    for (const saved of existing.repositories.filter(root => root.role !== 'scratch')) {
      const current = roots.find(
        root =>
          root.role === saved.role &&
          root.workspaceId === saved.workspaceId &&
          root.rootPath === saved.rootPath,
      );
      if (!current || current.identity !== saved.identity) throw portalError('PORTAL_ROOT_CHANGED');
    }
  }
  const hash = contentHash('sfp-portal-repository-authority-v1', {
    workspaceId,
    targetPath,
    scope,
    roots,
  });
  return {
    workspaceId,
    targetPath,
    scope,
    roots,
    hash,
    resource: {
      kind: 'repo',
      key: `portal:repo:${contentHash('sfp-portal-repo-v1', resolve(primary)).slice(7)}`,
    },
  };
};
