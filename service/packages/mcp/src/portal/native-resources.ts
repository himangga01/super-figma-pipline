/* eslint-disable no-await-in-loop -- retained path observations and grant revalidation are ordered */
import { lstat, realpath, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import { z } from 'zod';

import { withRetainedDirectoryChain } from '../fs/atomic-file.js';
import { portalError } from './store.js';
import { windowsJobProgramHash } from './windows-job.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
export const NativeResourceDeclarationSchema = z
  .object({
    id,
    provider: z.enum(['owned-sqlite', 'shared-sqlite'], {
      error: 'PORTAL_ENVIRONMENT_PROVIDER_PREREQUISITE',
    }),
    path: z.string().min(1).max(2048).optional(),
    binding: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
    actions: z
      .array(z.enum(['read', 'write', 'create']))
      .min(1)
      .max(3),
  })
  .strict();
const ObservationSchema = z
  .object({
    path: z.string().min(1).max(2300),
    parent: z.string().min(1).max(2048),
    parentIdentity: z.string().min(1).max(128),
    key: z.string(),
    fileIdentity: z.string().nullable(),
  })
  .strict();
export const NativeEnvironmentAuthoritySchema = z
  .object({
    broker: z
      .object({ path: z.string().min(1).max(2300), hash, identity: z.string(), programHash: hash })
      .strict(),
    version: z.literal(1),
    protocol: z.literal('sfp-native-environment-v1'),
    ownerId: z.string().min(1).max(128),
    planId: z.string().min(1).max(128),
    sourceHash: hash,
    profileId: id,
    createdAt: z.number().int(),
    expiresAt: z.number().int(),
    namespace: z.string().min(1).max(2048),
    namespaceIdentity: z.string().min(1).max(128),
    configurationHash: hash,
    disposition: z.literal('retained-artifact'),
    grants: z
      .array(
        z
          .object({
            declaration: NativeResourceDeclarationSchema,
            shared: ObservationSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();
export type NativeEnvironmentAuthority = z.infer<typeof NativeEnvironmentAuthoritySchema>;
export const NativeEnvironmentExecutionSchema = z
  .object({
    broker: z
      .object({ path: z.string().min(1).max(2300), hash, identity: z.string(), programHash: hash })
      .strict(),
    version: z.literal(1),
    attemptId: z.string().regex(/^[a-f0-9]{64}$/u),
    operationId: z.string().min(1).max(384),
    ownerId: z.string().min(1).max(128),
    runId: z.string().min(1).max(128),
    target: z.enum(['candidate', 'applied']),
    sourceHash: hash,
    observations: z.array(ObservationSchema).max(16),
    grantHash: hash,
    profileHash: hash,
    repositoryHash: hash,
    directory: z.string().min(1).max(2300),
    resources: z
      .array(z.object({ key: z.string(), mode: z.enum(['read', 'write']) }).strict())
      .min(1)
      .max(64),
    environment: z.record(z.string(), z.string()),
    hash,
  })
  .strict();
export type NativeEnvironmentExecution = z.infer<typeof NativeEnvironmentExecutionSchema>;
export const directoryIdentity = async (path: string): Promise<string> => {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw portalError('PORTAL_ENVIRONMENT_DIRECTORY_INVALID');
  return `${stat.dev}:${stat.ino}`;
};
const fold = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
export const pathsOverlap = (a: string, b: string): boolean => {
  const r = relative(fold(a), fold(b));
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`));
};
/** The parent identity plus leaf is stable when SQLite creates a previously absent database. */
export async function observeSqlite(input: string) {
  if (
    !isAbsolute(input) ||
    input.startsWith('\\') ||
    /[?#]/u.test(input) ||
    /^(?:file:|\\\\[?.])/iu.test(input)
  )
    throw portalError('PORTAL_SQLITE_LOCAL_PATH_REQUIRED');
  const path = resolve(input),
    parent = dirname(path),
    leaf = basename(path);
  if (
    !/^[A-Za-z0-9_. -]+$/u.test(leaf) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(leaf) ||
    leaf !== leaf.normalize('NFC') ||
    /[. ]$/u.test(leaf) ||
    /:(?![\\/])/u.test(leaf) ||
    /-(?:wal|shm|journal)$/iu.test(leaf)
  )
    throw portalError('PORTAL_SQLITE_ALIAS_UNSUPPORTED');
  return withRetainedDirectoryChain(parse(parent).root, parent, async () => {
    const canonical = await realpath(parent);
    if (fold(canonical) !== fold(parent)) throw portalError('PORTAL_SQLITE_ALIAS_UNSUPPORTED');
    const parentIdentity = await directoryIdentity(parent);
    const stat = await lstat(path, { bigint: true }).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n))
      throw portalError('PORTAL_SQLITE_FILE_INVALID');
    if (stat && fold(basename(await realpath(path))) !== fold(leaf))
      throw portalError('PORTAL_SQLITE_ALIAS_UNSUPPORTED');
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const companion = await lstat(path + suffix, { bigint: true }).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (
        companion &&
        (!companion.isFile() || companion.isSymbolicLink() || companion.nlink !== 1n)
      )
        throw portalError('PORTAL_SQLITE_FILE_INVALID');
    }
    return {
      path: join(canonical, leaf),
      parent: canonical,
      parentIdentity,
      key: `portal:sqlite:${contentHash('sfp-sqlite-resource-v1', { parentIdentity, leaf: fold(leaf) }).slice(7)}`,
      fileIdentity: stat ? `${stat.dev}:${stat.ino}` : null,
    };
  });
}
interface ProfileInput {
  ownerId: string;
  planId: string;
  native: {
    id: string;
    sourceHash: string;
    environment: Record<string, string>;
    resources?: z.infer<typeof NativeResourceDeclarationSchema>[] | undefined;
    environmentAuthority?: NativeEnvironmentAuthority | undefined;
  };
}
const configuration = (profile: ProfileInput) =>
  contentHash('sfp-native-environment-configuration-v1', {
    ownerId: profile.ownerId,
    planId: profile.planId,
    sourceHash: profile.native.sourceHash,
    profileId: profile.native.id,
    environment: profile.native.environment,
    resources: profile.native.resources,
  });
async function brokerIdentity() {
  const path = join(
    process.env.SystemRoot ?? '',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  if (!isAbsolute(path)) throw portalError('PORTAL_ENVIRONMENT_PROCESS_PROOF_HOST_REQUIRED');
  return withRetainedDirectoryChain(parse(path).root, dirname(path), async () => {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > 16777216n)
      throw portalError('PORTAL_ENVIRONMENT_BROKER_CHANGED');
    const bytes = await readFile(path),
      after = await lstat(path, { bigint: true });
    if (
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.length) !== before.size
    )
      throw portalError('PORTAL_ENVIRONMENT_BROKER_CHANGED');
    return {
      path,
      programHash: windowsJobProgramHash,
      hash: storedChecksum(bytes),
      identity: `${before.dev}:${before.ino}`,
    };
  });
}
export async function prepareNativeEnvironment(
  profile: ProfileInput,
  stateRoot: string,
  now = Date.now(),
): Promise<NativeEnvironmentAuthority> {
  if (process.platform !== 'win32')
    throw portalError('PORTAL_ENVIRONMENT_PROCESS_PROOF_HOST_REQUIRED');
  const declarations = profile.native.resources ?? [
    {
      id: 'database',
      provider: 'owned-sqlite' as const,
      binding: 'SFP_PORTAL_SQLITE_PATH',
      actions: ['read', 'write', 'create'] as const,
    },
  ];
  const grants: NativeEnvironmentAuthority['grants'] = [];
  const bindings = new Set<string>(),
    ids = new Set<string>(),
    keys = new Set<string>();
  for (const raw of declarations) {
    const declaration = NativeResourceDeclarationSchema.parse(raw);
    if (bindings.has(declaration.binding.toUpperCase()) || ids.has(declaration.id))
      throw portalError('PORTAL_ENVIRONMENT_DUPLICATE_BINDING');
    if (
      /^(?:SFP_NATIVE_.+|NODE_.+|PATH|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|NPM_CONFIG_.+|LD_.+|DYLD_.+|SYSTEMROOT|WINDIR|XDG_CONFIG_HOME|COREPACK_HOME|PNPM_HOME|GIT_.+)$/iu.test(
        declaration.binding,
      )
    )
      throw portalError('PORTAL_ENVIRONMENT_RESERVED_BINDING');
    bindings.add(declaration.binding.toUpperCase());
    ids.add(declaration.id);
    if (
      Object.keys(profile.native.environment).some(
        key => key.toUpperCase() === declaration.binding.toUpperCase(),
      )
    )
      throw portalError('PORTAL_ENVIRONMENT_BINDING_CONFLICT');
    if (new Set(declaration.actions).size !== declaration.actions.length)
      throw portalError('PORTAL_ENVIRONMENT_ACTION_INVALID');
    if (
      declaration.provider === 'owned-sqlite' &&
      (declaration.path || !declaration.actions.includes('create'))
    )
      throw portalError('PORTAL_ENVIRONMENT_OWNED_DECLARATION_INVALID');
    if (declaration.provider === 'shared-sqlite' && !declaration.path)
      throw portalError('PORTAL_SQLITE_LOCAL_PATH_REQUIRED');
    const shared =
      declaration.provider === 'shared-sqlite' ? await observeSqlite(declaration.path!) : null;
    if (shared && !shared.fileIdentity && !declaration.actions.includes('create'))
      throw portalError('PORTAL_ENVIRONMENT_CREATE_GRANT_REQUIRED');
    if (shared && keys.has(shared.key)) throw portalError('PORTAL_ENVIRONMENT_RESOURCE_ALIAS');
    if (shared) keys.add(shared.key);
    grants.push({ declaration, shared });
  }
  // State root already exists. Preparing the child template has no mkdir side effect.
  return NativeEnvironmentAuthoritySchema.parse({
    broker: await brokerIdentity(),
    version: 1,
    protocol: 'sfp-native-environment-v1',
    ownerId: profile.ownerId,
    planId: profile.planId,
    sourceHash: profile.native.sourceHash,
    profileId: profile.native.id,
    createdAt: now,
    expiresAt: now + 86_400_000,
    namespace: resolve(stateRoot),
    namespaceIdentity: await directoryIdentity(stateRoot),
    configurationHash: configuration(profile),
    disposition: 'retained-artifact',
    grants,
  });
}
export async function verifyNativeEnvironment(
  profile: ProfileInput,
  stateRoot: string,
  excludedRoots: string[] = [],
): Promise<NativeEnvironmentAuthority> {
  if (!profile.native.environmentAuthority)
    throw portalError('PORTAL_ENVIRONMENT_AUTHORITY_REQUIRED');
  const authority = NativeEnvironmentAuthoritySchema.parse(profile.native.environmentAuthority);
  if (
    authority.expiresAt <= Date.now() ||
    authority.createdAt > Date.now() ||
    authority.expiresAt - authority.createdAt > 86_400_000
  )
    throw portalError('PORTAL_ENVIRONMENT_GRANT_EXPIRED');
  if (
    authority.namespace !== resolve(stateRoot) ||
    authority.namespaceIdentity !== (await directoryIdentity(stateRoot)) ||
    authority.configurationHash !== configuration(profile)
  )
    throw portalError('PORTAL_ENVIRONMENT_GRANT_CHANGED');
  const expected = await prepareNativeEnvironment(profile, stateRoot, authority.createdAt);
  // Missing -> created is legitimate only after approved creation; parent/lock identity never changes.
  for (let i = 0; i < expected.grants.length; i++) {
    const old = authority.grants[i]?.shared,
      current = expected.grants[i]?.shared;
    if (
      old &&
      current &&
      old.fileIdentity === null &&
      authority.grants[i]!.declaration.actions.includes('create')
    )
      current.fileIdentity = null;
  }
  if (contentHash('sfp-environment-v1', expected) !== contentHash('sfp-environment-v1', authority))
    throw portalError('PORTAL_ENVIRONMENT_GRANT_CHANGED');
  for (const root of excludedRoots)
    if (
      pathsOverlap(root, authority.namespace) ||
      (pathsOverlap(authority.namespace, root) &&
        relative(authority.namespace, root).split(sep)[0]?.startsWith('portal-attempt-'))
    )
      throw portalError('PORTAL_ENVIRONMENT_SOURCE_OVERLAP');
  for (const root of excludedRoots)
    for (const grant of authority.grants)
      if (
        grant.shared &&
        (pathsOverlap(root, grant.shared.path) || pathsOverlap(grant.shared.path, root))
      )
        throw portalError('PORTAL_ENVIRONMENT_SOURCE_OVERLAP');
  return authority;
}
export function expandNativeEnvironment(
  grant: NativeEnvironmentAuthority,
  input: {
    operationId: string;
    runId: string;
    target: 'candidate' | 'applied';
    profileHash: string;
    repositoryHash: string;
    repositoryKey: string;
  },
): NativeEnvironmentExecution {
  const attemptId = contentHash('sfp-native-attempt-v1', {
    ownerId: grant.ownerId,
    ...input,
  }).slice(7);
  const directory = join(grant.namespace, `portal-attempt-${attemptId}`);
  const resources = [
    { key: `portal:process:${input.runId}`, mode: 'write' as const },
    { key: input.repositoryKey, mode: 'read' as const },
  ];
  const environment: Record<string, string> = {};
  for (const { declaration, shared } of grant.grants) {
    environment[declaration.binding] = shared?.path ?? join(directory, `${declaration.id}.sqlite`);
    resources.push({
      key: shared?.key ?? `portal:owned-sqlite:${attemptId}:${declaration.id}`,
      mode: 'write',
    });
  }
  resources.sort((a, b) => a.key.localeCompare(b.key));
  const context = {
    broker: grant.broker,
    version: 1 as const,
    attemptId,
    operationId: input.operationId,
    ownerId: grant.ownerId,
    runId: input.runId,
    target: input.target,
    sourceHash: grant.sourceHash,
    observations: grant.grants.flatMap(value => (value.shared ? [value.shared] : [])),
    grantHash: contentHash('sfp-native-environment-grant-v1', grant),
    profileHash: input.profileHash,
    repositoryHash: input.repositoryHash,
    directory,
    resources,
    environment,
  };
  return NativeEnvironmentExecutionSchema.parse({
    ...context,
    hash: contentHash('sfp-native-execution-authority-v1', context),
  });
}
