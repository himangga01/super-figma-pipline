/* eslint-disable no-await-in-loop -- creation proof must be durable before directory publication */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

import { withRetainedDirectoryChain } from '../fs/atomic-file.js';
import {
  publishWindowsDirectory,
  windowsDirectoryPublicationProgramHash,
} from '../fs/windows-directory-publication.js';
import { directoryIdentity } from './native-resources.js';

export const NativeDirectoryCreationSchema = z
  .object({
    protocol: z.literal('sfp-native-directory-creation-v1'),
    publicationProgramHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    parentPath: z.string().min(1).max(4096),
    parentIdentity: z.string().min(1).max(128),
    path: z.string().min(1).max(4096),
    stagingPath: z.string().min(1).max(4096),
    identity: z.string().min(1).max(128).nullable(),
    phase: z.enum(['intent', 'identity-bound', 'published']),
    parentSync: z.enum(['succeeded', 'eperm-limited']).nullable(),
  })
  .strict();
export type NativeDirectoryCreation = z.infer<typeof NativeDirectoryCreationSchema>;
export type NativeDirectoryCreationBoundary =
  | 'afterIntentPersist'
  | 'afterMkdir'
  | 'afterIdentityPersist'
  | 'afterPublish'
  | 'afterPublishedPersist';
export interface NativeDirectoryCreationOptions {
  persist: (next: NativeDirectoryCreation) => Promise<void>;
  secure?: (path: string) => Promise<void>;
  hooks?: Partial<
    Record<NativeDirectoryCreationBoundary, (intent: NativeDirectoryCreation) => Promise<void>>
  >;
}
export type NativeDirectoryEffectDisposition =
  | 'pre-effect-rejection'
  | 'partial-application'
  | 'outcome-unknown';
const failure = (
  code: string,
  intent?: NativeDirectoryCreation,
  effectDisposition: NativeDirectoryEffectDisposition = 'outcome-unknown',
) =>
  Object.assign(new Error(code), {
    code,
    effectDisposition,
    committed: effectDisposition !== 'pre-effect-rejection',
    ...(intent ? { recoveryPath: intent.stagingPath, visiblePath: intent.path } : {}),
  });
const present = async (path: string) =>
  lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
const syncParent = async (path: string): Promise<'succeeded' | 'eperm-limited'> => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
    return 'succeeded';
  } catch (error) {
    // Windows Node directory fsync is EPERM-limited; persist that actual guarantee explicitly.
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM')
      return 'eperm-limited';
    throw error;
  } finally {
    await handle.close();
  }
};
const validate = (raw: NativeDirectoryCreation, checkProgram = true): NativeDirectoryCreation => {
  const value = NativeDirectoryCreationSchema.parse(raw);
  if (process.platform !== 'win32')
    throw failure('PORTAL_DIRECTORY_CREATION_HOST_REQUIRED', value, 'pre-effect-rejection');
  if (checkProgram && value.publicationProgramHash !== windowsDirectoryPublicationProgramHash)
    throw failure('PORTAL_DIRECTORY_CREATION_PROGRAM_CHANGED', value);
  if (
    ![value.parentPath, value.path, value.stagingPath].every(isAbsolute) ||
    resolve(value.parentPath) !== value.parentPath ||
    dirname(value.path) !== value.parentPath ||
    dirname(value.stagingPath) !== value.parentPath ||
    value.path === value.stagingPath ||
    !/^\.sfp-native-directory-[0-9a-f-]{36}$/u.test(basename(value.stagingPath)) ||
    (value.phase === 'intent') !== (value.identity === null)
  )
    throw failure(
      'PORTAL_DIRECTORY_CREATION_INTENT_INVALID',
      value,
      value.phase === 'intent' ? 'pre-effect-rejection' : 'outcome-unknown',
    );
  return value;
};
/** Returns an intent only. The caller must durably persist it before invoking publication. */
export const prepareNativeDirectoryCreation = async (
  parentPath: string,
  path: string,
): Promise<NativeDirectoryCreation> => {
  try {
    const intent = validate({
      protocol: 'sfp-native-directory-creation-v1',
      parentPath: resolve(parentPath),
      publicationProgramHash: windowsDirectoryPublicationProgramHash,
      parentIdentity: await directoryIdentity(parentPath),
      path: resolve(path),
      stagingPath: join(resolve(parentPath), `.sfp-native-directory-${randomUUID()}`),
      identity: null,
      phase: 'intent',
      parentSync: null,
    });
    if (await present(intent.path))
      throw failure('PORTAL_DIRECTORY_CREATION_CONFLICT', intent, 'pre-effect-rejection');
    return intent;
  } catch (error) {
    throw Object.assign(error as Error, {
      effectDisposition: 'pre-effect-rejection',
      committed: false,
    });
  }
};
/** Publishes or resumes the same signed intent; unbound existing names are quarantined. */
export const publishNativeDirectoryCreation = async (
  raw: NativeDirectoryCreation,
  options: NativeDirectoryCreationOptions,
): Promise<NativeDirectoryCreation> => {
  let intent = validate(raw),
    disposition: NativeDirectoryEffectDisposition =
      intent.phase === 'intent' ? 'pre-effect-rejection' : 'outcome-unknown';
  try {
    return await withRetainedDirectoryChain(
      intent.parentPath,
      intent.parentPath,
      async parent => {
        if ((await directoryIdentity(intent.parentPath)) !== intent.parentIdentity)
          throw failure('PORTAL_DIRECTORY_CREATION_PARENT_CHANGED', intent, disposition);
        if (intent.phase === 'intent') {
          await options.hooks?.afterIntentPersist?.(intent);
          if (await present(intent.path))
            throw failure('PORTAL_DIRECTORY_CREATION_CONFLICT', intent, disposition);
          if (await present(intent.stagingPath))
            throw failure('PORTAL_DIRECTORY_CREATION_QUARANTINED', intent);
          // Set uncertain before dispatch: an interrupted mkdir outcome cannot establish ownership.
          disposition = 'outcome-unknown';
          await mkdir(parent.child(basename(intent.stagingPath)), { mode: 0o700 });
          await options.hooks?.afterMkdir?.(intent);
          const parentSync = await syncParent(intent.parentPath);
          await options.secure?.(intent.stagingPath);
          const identity = await directoryIdentity(intent.stagingPath);
          intent = { ...intent, identity, phase: 'identity-bound', parentSync };
          await options.persist(intent);
          await options.hooks?.afterIdentityPersist?.(intent);
        }
        if (!intent.identity) throw failure('PORTAL_DIRECTORY_CREATION_QUARANTINED', intent);
        const stage = await present(intent.stagingPath),
          final = await present(intent.path);
        if (final) {
          if (
            stage ||
            !final.isDirectory() ||
            final.isSymbolicLink() ||
            (await directoryIdentity(intent.path)) !== intent.identity
          )
            throw failure('PORTAL_DIRECTORY_CREATION_CONFLICT', intent);
        } else {
          if (
            !stage ||
            intent.phase === 'published' ||
            !stage.isDirectory() ||
            stage.isSymbolicLink() ||
            (await directoryIdentity(intent.stagingPath)) !== intent.identity
          )
            throw failure('PORTAL_DIRECTORY_CREATION_CONFLICT', intent);
          await parent.verify();
          // The Windows helper retains the observed inode and uses MoveFileExW with zero flags.
          // Generic Node rename would overwrite a foreign file. Final identity must still match.
          await publishWindowsDirectory(intent.stagingPath, intent.path, intent.identity);
          if ((await directoryIdentity(intent.path)) !== intent.identity)
            throw failure('PORTAL_DIRECTORY_CREATION_CONFLICT', intent);
        }
        disposition = 'partial-application';
        await options.hooks?.afterPublish?.(intent);
        const parentSync = await syncParent(intent.parentPath);
        await parent.verify();
        if ((await directoryIdentity(intent.path)) !== intent.identity)
          throw failure('PORTAL_DIRECTORY_CREATION_CONFLICT', intent);
        intent = { ...intent, phase: 'published', parentSync };
        await options.persist(intent);
        await options.hooks?.afterPublishedPersist?.(intent);
        return intent;
      },
      { errorCode: 'PORTAL_DIRECTORY_CREATION_PARENT_CHANGED' },
    );
  } catch (error) {
    // Hash/path checks narrow same-owner races; they do not create an OS filesystem sandbox.
    throw Object.assign(error as Error, {
      effectDisposition: (error as { effectDisposition?: string }).effectDisposition ?? disposition,
      committed:
        (error as { committed?: boolean }).committed ?? disposition !== 'pre-effect-rejection',
      recoveryPath: intent.stagingPath,
      visiblePath: intent.path,
    });
  }
};
export type NativeDirectoryCreationInspection = {
  state: 'pending-safe' | 'bound-stage' | 'bound-final' | 'quarantined' | 'conflict';
  identity: string | null;
};
/** Read-only historical identity proof. This does not authorize publication with an old program. */
export const inspectNativeDirectoryCreation = async (
  raw: NativeDirectoryCreation,
): Promise<NativeDirectoryCreationInspection> => {
  const intent = validate(raw, false);
  const conflict = { state: 'conflict' as const, identity: null };
  try {
    return await withRetainedDirectoryChain(
      intent.parentPath,
      intent.parentPath,
      async parent => {
        if ((await directoryIdentity(intent.parentPath)) !== intent.parentIdentity) return conflict;
        const [stage, final] = await Promise.all([
          lstat(intent.stagingPath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          }),
          lstat(intent.path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          }),
        ]);
        await parent.verify();
        if (intent.phase === 'intent')
          return { state: stage || final ? 'quarantined' : 'pending-safe', identity: null };
        const matches = (value: typeof stage) =>
          value !== null &&
          value.isDirectory() &&
          !value.isSymbolicLink() &&
          `${value.dev}:${value.ino}` === intent.identity;
        if (!stage && matches(final)) return { state: 'bound-final', identity: intent.identity };
        if (!final && matches(stage) && intent.phase === 'identity-bound')
          return { state: 'bound-stage', identity: intent.identity };
        return conflict;
      },
      { errorCode: 'PORTAL_DIRECTORY_CREATION_PARENT_CHANGED' },
    );
  } catch (error) {
    if (
      (error as { code?: string }).code === 'PORTAL_DIRECTORY_CREATION_PARENT_CHANGED' ||
      (error as { code?: string }).code === 'ENOENT'
    )
      return conflict;
    throw error;
  }
};
