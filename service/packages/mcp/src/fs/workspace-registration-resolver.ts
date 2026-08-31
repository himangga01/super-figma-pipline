import type { BigIntStats } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ResolvedWorkspaceRegistration, WorkspaceRegistrationResolver } from '@sfp/shared';

export type WorkspaceRegistrationErrorCode =
  | 'WORKSPACE_DIRECTORY_REQUIRED'
  | 'WORKSPACE_REGISTRATION_CHANGED';

export class WorkspaceRegistrationError extends Error {
  constructor(
    readonly code: WorkspaceRegistrationErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WorkspaceRegistrationError';
  }
}

const identityKey = (metadata: BigIntStats): string =>
  `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`;

const resolveRegistration = async (input: string): Promise<ResolvedWorkspaceRegistration> => {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new WorkspaceRegistrationError(
      'WORKSPACE_DIRECTORY_REQUIRED',
      'workspace path must name an existing directory',
    );
  }
  const requestedPath = resolve(input);
  try {
    const followed = await stat(requestedPath);
    if (!followed.isDirectory()) {
      throw new WorkspaceRegistrationError(
        'WORKSPACE_DIRECTORY_REQUIRED',
        'workspace path must name an existing directory',
      );
    }
    const canonicalPath = await realpath(requestedPath);
    const canonicalMetadata = await lstat(canonicalPath, { bigint: true });
    if (!canonicalMetadata.isDirectory() || canonicalMetadata.isSymbolicLink()) {
      throw new WorkspaceRegistrationError(
        'WORKSPACE_DIRECTORY_REQUIRED',
        'workspace real path must identify a real directory',
      );
    }
    return Object.freeze({
      requestedPath,
      realPath: canonicalPath,
      identityKey: identityKey(canonicalMetadata),
    });
  } catch (error) {
    if (error instanceof WorkspaceRegistrationError) throw error;
    throw new WorkspaceRegistrationError(
      'WORKSPACE_DIRECTORY_REQUIRED',
      'workspace path must name an existing directory',
      { cause: error },
    );
  }
};

export const sameWorkspaceRegistration = (
  left: Readonly<ResolvedWorkspaceRegistration>,
  right: Readonly<ResolvedWorkspaceRegistration>,
): boolean =>
  left.requestedPath === right.requestedPath &&
  left.realPath === right.realPath &&
  left.identityKey === right.identityKey;

export const createWorkspaceRegistrationResolver = (): WorkspaceRegistrationResolver => {
  const resolver: WorkspaceRegistrationResolver = {
    resolveForNonce: resolveRegistration,
    revalidateInsideMutation: async expected => {
      let current: ResolvedWorkspaceRegistration;
      try {
        current = await resolveRegistration(expected.requestedPath);
      } catch (error) {
        throw new WorkspaceRegistrationError(
          'WORKSPACE_REGISTRATION_CHANGED',
          'workspace registration changed before mutation',
          { cause: error },
        );
      }
      if (!sameWorkspaceRegistration(expected, current)) {
        throw new WorkspaceRegistrationError(
          'WORKSPACE_REGISTRATION_CHANGED',
          'workspace registration changed before mutation',
        );
      }
      return current;
    },
  };
  return Object.freeze(resolver);
};
