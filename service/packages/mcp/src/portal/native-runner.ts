/* eslint-disable no-await-in-loop -- each command requires ordered input checks and output receipt verification */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, open, realpath, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import { PortalHashSchema, PortalPathSchema } from '@sfp/shared';
import {
  PortalSourceAuthorityVersionSchema,
  assertCurrentPortalSourceAuthority,
} from '@sfp/shared';
import { z } from 'zod';

import { RepoReader } from '../fs/repo-walk.js';
import {
  NativeArtifactAuthoritySchema,
  NativeArtifactDeclarationSchema,
  NativeOutputDeclarationSchema,
  inventoryNativeArtifact,
  verifyNativeArtifactAuthority,
  verifyNativeCommandInputs,
  verifyNativeOutputReceipts,
  verifyNativeWorkingMembership,
  type NativeOutputReceipt,
} from './native-artifacts.js';
import type { NativeEnvironmentLifecycle } from './native-lifecycle.js';
import {
  createNativeModuleFence,
  verifyNativeModuleEvidence,
  type NativeModuleEvidence,
} from './native-module-fence.js';
import { nativeProcessControl } from './native-process-control.js';
import {
  NativeResourceDeclarationSchema,
  NativeEnvironmentAuthoritySchema,
  type NativeEnvironmentExecution,
} from './native-resources.js';
import { createNativePreviewChannel, type NativePreviewReceipt } from './preview-channel.js';
import { NATIVE_PREVIEW_BOOTSTRAP } from './preview-worker.js';
import { NativePreviewSchema } from './preview.js';
import { collectPortalSourceInventory } from './source-inventory.js';
import { portalError } from './store.js';
import { windowsJobCommand, windowsJobProgramHash } from './windows-job.js';

const safeArgument = z
  .string()
  .max(8192)
  .refine(value => !value.includes('\0'));
const cwdSchema = z.union([z.literal('.'), PortalPathSchema]);
export const NativeCommandSchema = z
  .object({
    preview: z
      .object({
        protocol: z.literal('sfp-owned-preview-v1'),
        bootstrapHash: PortalHashSchema.optional(),
        serverArgs: z.array(safeArgument).max(128).optional(),
        spec: NativePreviewSchema,
      })
      .strict()
      .optional(),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
    executable: z.string().min(1).max(2048),
    executableHash: PortalHashSchema,
    args: z.array(safeArgument).max(128),
    cwd: cwdSchema.default('.'),
    timeoutMs: z.number().int().min(100).max(300_000),
    produces: z.array(NativeOutputDeclarationSchema).max(16).optional(),
    allowLifecycleScripts: z.boolean().default(false),
    maxOutputBytes: z.number().int().min(1024).max(1_048_576).default(262_144),
  })
  .strict();
export const NativeProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceAuthorityVersion: PortalSourceAuthorityVersionSchema,
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
    executionMode: z.literal('native-working-copy'),
    environmentKind: z.enum(['disposable-test', 'development-test']),
    sourceHash: PortalHashSchema,
    closure: z
      .array(z.object({ path: PortalPathSchema, hash: PortalHashSchema }).strict())
      .min(1)
      .max(5000),
    resources: z.array(NativeResourceDeclarationSchema).min(1).max(16).optional(),
    environmentAuthority: NativeEnvironmentAuthoritySchema.optional(),
    externalArtifacts: z.array(NativeArtifactDeclarationSchema).max(128).optional(),
    artifactAuthority: NativeArtifactAuthoritySchema.optional(),
    environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u), z.string().max(8192)),
    commands: z.array(NativeCommandSchema).min(1).max(32),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      new Set(profile.closure.map(file => file.path.toLowerCase())).size !== profile.closure.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate or case-aliased closure path' });
    if (new Set(profile.commands.map(command => command.id)).size !== profile.commands.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate native command ID' });
    for (const command of profile.commands) {
      if (!isAbsolute(command.executable) || !commandAllowed(command.executable, command.args))
        ctx.addIssue({
          code: 'custom',
          message:
            'Use an absolute native executable; Docker, container/VM launchers and shell wrappers are prohibited',
        });
      const packageManager = [command.executable, ...command.args].some(value =>
        /^(?:npm|pnpm|yarn|corepack)(?:-cli)?\.(?:m?js|cjs|exe)$/iu.test(basename(value)),
      );
      if (
        packageManager &&
        command.args.some(value => ['install', 'ci', 'add'].includes(value)) &&
        !command.allowLifecycleScripts &&
        !command.args.includes('--ignore-scripts')
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Dependency installation must disable lifecycle scripts unless this profile explicitly enables them',
        });
    }
    // Loader injection would change the executable after its reviewed hash was checked.
    if (
      Object.keys(profile.environment).some(key =>
        /^(?:SFP_NATIVE_MODULE_.+|SFP_NATIVE_PREVIEW_.+|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|OPENSSL_CONF|SSL_CERT_FILE|SSL_CERT_DIR|NPM_CONFIG_.+|PATH|PATHEXT|LD_.+|DYLD_.+|PYTHONSTARTUP|BASH_ENV|ENV|COMSPEC)$/iu.test(
          key,
        ),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Runtime loader injection is not allowed' });
  });
export type NativeProfile = z.infer<typeof NativeProfileSchema>;
export type NativeCommand = z.infer<typeof NativeCommandSchema>;
export interface NativeCommandResult {
  commandId: string;
  moduleEvidence?: NativeModuleEvidence;
  previewReceipt?: NativePreviewReceipt;
  commandHash: `sha256:${string}`;
  status: 'passed' | 'failed' | 'timed-out' | 'cancelled' | 'output-limit';
  exitCode: number | null;
  signal: string | null;
  output: string;
  durationMs: number;
  cleanup: 'finished' | 'tree-termination-requested';
}
export interface NativeRunResult {
  profileId: string;
  profileHash: `sha256:${string}`;
  sourceHash: string;
  executionMode: 'native-working-copy';
  isolation: 'local-owner-account-no-os-sandbox';
  hostPlatform: NodeJS.Platform;
  commands: NativeCommandResult[];
  artifactAuthorityHash: string;
  outputReceipts: NativeOutputReceipt[];
}
const inside = (root: string, path: string): boolean => {
  const part = relative(root, path);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
};
const commandAllowed = (executable: string, args: string[]): boolean =>
  !/^(?:docker(?:-compose)?|podman|containerd|nerdctl|wsl|vagrant|vboxmanage|qemu[^.]*|cmd|powershell|pwsh|sh|bash|zsh|fish)(?:\.exe|\.cmd|\.bat)?$/iu.test(
    basename(executable),
  ) &&
  !/\.(?:cmd|bat|ps1|sh)$/iu.test(executable) &&
  !args.some(argument =>
    /(?:^|[\s/\\])(?:docker(?:-compose)?|podman|nerdctl|vagrant)(?:\.exe|\.cmd)?(?:\s|$)/iu.test(
      argument,
    ),
  );

/** Bounded executable fingerprint. Paths are owner-approved, never resolved through project PATH. */
export const nativeExecutableHash = async (path: string): Promise<`sha256:${string}`> => {
  if (!isAbsolute(path)) throw portalError('PORTAL_EXECUTABLE_ABSOLUTE_REQUIRED');
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > 268_435_456n)
    throw portalError('PORTAL_EXECUTABLE_INVALID');
  const handle = await open(path, 'r');
  try {
    const held = await handle.stat({ bigint: true });
    if (held.ino !== before.ino || held.dev !== before.dev)
      throw portalError('PORTAL_EXECUTABLE_CHANGED');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(65_536);
    let position = 0;
    while (position < Number(held.size)) {
      // eslint-disable-next-line no-await-in-loop -- bounded streaming executable fingerprint
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(held.size) - position),
        position,
      );
      if (!bytesRead) throw portalError('PORTAL_EXECUTABLE_CHANGED');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await lstat(path, { bigint: true });
    if (
      after.ino !== held.ino ||
      after.dev !== held.dev ||
      after.size !== held.size ||
      after.mtimeNs !== held.mtimeNs ||
      after.ctimeNs !== held.ctimeNs
    )
      throw portalError('PORTAL_EXECUTABLE_CHANGED');
    return `sha256:${hash.digest('hex')}`;
  } finally {
    await handle.close();
  }
};

interface ActiveCommand {
  child: ChildProcess;
  stop: (reason: NativeCommandResult['status']) => Promise<void>;
}
/** Runs approved profiles without Docker, shell wrappers, inherited secrets or a sandbox claim. */
export class NativePortalRunner {
  private readonly active = new Map<string, ActiveCommand>();
  private readonly running = new Set<string>();
  private readonly cancelled = new Set<string>();

  async cancel(runId: string): Promise<void> {
    if (!this.running.has(runId)) return;
    this.cancelled.add(runId);
    await this.active.get(runId)?.stop('cancelled');
  }

  async close(): Promise<void> {
    await Promise.all([...this.running].map(id => this.cancel(id)));
  }

  async execute(
    runId: string,
    input: NativeProfile,
    directory: string,
    sourceHash: string,
    signal: AbortSignal,
    deadlineAt: number,
    runtime?: {
      execution: NativeEnvironmentExecution;
      lifecycle: NativeEnvironmentLifecycle;
      privateHome: string;
    },
  ): Promise<NativeRunResult> {
    const profile = NativeProfileSchema.parse(input);
    assertCurrentPortalSourceAuthority(profile);
    if (profile.sourceHash !== sourceHash) throw portalError('PORTAL_PROFILE_SOURCE_CHANGED');
    if (this.running.has(runId)) throw portalError('PORTAL_NATIVE_RUN_BUSY');
    if (
      !Number.isSafeInteger(deadlineAt) ||
      deadlineAt <= Date.now() ||
      deadlineAt - Date.now() > 3_600_000
    )
      throw portalError('PORTAL_BUDGET_EXHAUSTED');
    const root = resolve(directory),
      canonical = await realpath(root);
    if (relative(root, canonical) !== '') throw portalError('PORTAL_NATIVE_ROOT_ALIAS');
    const rootStat = await lstat(root, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw portalError('PORTAL_NATIVE_ROOT_INVALID');
    await verifyNativeArtifactAuthority(profile, signal);
    const declaredOutputs = profile.commands.flatMap(command => command.produces ?? []);
    const outputOwner = new Map(
      profile.commands.flatMap((command, index) =>
        (command.produces ?? []).map(output => [output.path, index] as const),
      ),
    );
    for (const output of declaredOutputs) {
      const path = output.path.toLowerCase();
      if (
        profile.closure.some(
          file =>
            file.path.toLowerCase() === path || file.path.toLowerCase().startsWith(`${path}/`),
        ) ||
        declaredOutputs.some(other => {
          if (other === output) return false;
          const otherPath = other.path.toLowerCase();
          if (otherPath === path) return true;
          if (path.startsWith(`${otherPath}/`))
            return (
              other.kind !== 'provisioned-dependencies' ||
              output.kind !== 'generated-output' ||
              path.slice(otherPath.length + 1).includes('/') ||
              outputOwner.get(other.path)! >= outputOwner.get(output.path)!
            );
          return false;
        })
      )
        throw portalError('PORTAL_OUTPUT_OVERLAPS_INPUT');
      if (
        await lstat(resolve(root, output.path)).then(
          () => true,
          error => {
            if (error.code === 'ENOENT') return false;
            throw error;
          },
        )
      )
        throw portalError('PORTAL_OUTPUT_ALREADY_EXISTS');
    }
    this.running.add(runId);
    try {
      const inventory = await collectPortalSourceInventory(
        new RepoReader({ rootDir: root, signal }),
      );
      if (
        !inventory.complete ||
        inventory.files.length !== profile.closure.length ||
        inventory.files.some(file => !profile.closure.some(entry => entry.path === file.path))
      )
        throw portalError('PORTAL_PROFILE_CLOSURE_MEMBERSHIP_CHANGED');
      const privateHome = runtime?.privateHome ?? (await mkdtemp(join(root, '.sfp-native-home-')));
      await writeFile(join(privateHome, 'npmrc'), '\n', { flag: 'wx', mode: 0o600 });
      await writeFile(join(privateHome, 'global-npmrc'), '\n', { flag: 'wx', mode: 0o600 });
      await writeFile(join(privateHome, 'gitconfig'), '\n', { flag: 'wx', mode: 0o600 });
      const results: NativeCommandResult[] = [];
      const outputReceipts: NativeOutputReceipt[] = [];
      for (const command of profile.commands) {
        signal.throwIfAborted();
        if (
          runtime &&
          (!profile.environmentAuthority || profile.environmentAuthority.expiresAt <= Date.now())
        )
          throw portalError('PORTAL_ENVIRONMENT_GRANT_EXPIRED');
        if (this.cancelled.has(runId)) throw portalError('PORTAL_NATIVE_CANCELLED');
        for (const output of command.produces ?? [])
          if (
            await lstat(resolve(root, output.path)).then(
              () => true,
              error => {
                if (error.code === 'ENOENT') return false;
                throw error;
              },
            )
          )
            throw portalError('PORTAL_OUTPUT_ALREADY_EXISTS');
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) throw portalError('PORTAL_BUDGET_EXHAUSTED');
        // eslint-disable-next-line no-await-in-loop -- check the complete reviewed script/configuration closure before each command
        await this.verifyClosure(root, profile, signal);
        await verifyNativeArtifactAuthority(profile, signal);
        await verifyNativeOutputReceipts(root, outputReceipts, signal);
        await verifyNativeWorkingMembership(
          root,
          profile,
          outputReceipts.map(receipt => receipt.path),
          privateHome,
          signal,
        );
        await verifyNativeCommandInputs(profile, command, root, outputReceipts);
        if (command.preview) {
          if (
            command.args.length !== 2 ||
            command.args[0] !== '-e' ||
            command.args[1] !== NATIVE_PREVIEW_BOOTSTRAP ||
            command.preview.bootstrapHash !== storedChecksum(NATIVE_PREVIEW_BOOTSTRAP) ||
            !command.preview.serverArgs ||
            !command.preview.spec.manifest ||
            !command.preview.spec.interactionContract
          )
            throw portalError('PORTAL_PREVIEW_PREPARATION_REQUIRED');
          await verifyNativeCommandInputs(
            profile,
            { ...command, args: command.preview.serverArgs },
            root,
            outputReceipts,
          );
        }
        // eslint-disable-next-line no-await-in-loop -- no process launch before executable verification
        if ((await nativeExecutableHash(command.executable)) !== command.executableHash)
          throw portalError('PORTAL_EXECUTABLE_CHANGED');
        const cwd = resolve(root, command.cwd);
        if (!inside(root, cwd)) throw portalError('PORTAL_NATIVE_CWD_OUTSIDE_ROOT');
        // RepoReader verifies every ancestor and rejects junctions; walk also validates an empty cwd.
        // eslint-disable-next-line no-await-in-loop -- rooted command-directory validation
        await new RepoReader({ rootDir: root, signal }).walk({
          cap: 1,
          ...(command.cwd === '.' ? {} : { startDirectories: [command.cwd] }),
        });
        // eslint-disable-next-line no-await-in-loop -- root identity is retained logically throughout the run
        const current = await lstat(root, { bigint: true });
        if (current.ino !== rootStat.ino || current.dev !== rootStat.dev)
          throw portalError('PORTAL_NATIVE_ROOT_CHANGED');
        const moduleFence = await createNativeModuleFence(
          profile,
          command,
          root,
          outputReceipts,
          privateHome,
          signal,
        );
        if (deadlineAt <= Date.now()) throw portalError('PORTAL_BUDGET_EXHAUSTED');
        // eslint-disable-next-line no-await-in-loop -- ordered profile steps may depend on prior build or migration results
        const previewChannel = command.preview
          ? await createNativePreviewChannel({
              protocol: 'sfp-owned-preview-v1',
              commandHash: contentHash('sfp-native-command-v1', command),
              manifestHash: contentHash(
                'sfp-observation-manifest-v1',
                command.preview.spec.manifest,
              ),
              serverArgs: command.preview.serverArgs!,
              cwd,
              timeoutMs: Math.min(command.timeoutMs, deadlineAt - Date.now()),
              spec: { ...command.preview.spec, root },
            })
          : null;
        let result: NativeCommandResult;
        try {
          result = await this.command(
            runId,
            { ...command, args: moduleFence.args },
            cwd,
            {
              ...profile.environment,
              ...runtime?.execution.environment,
              ...moduleFence.environment,
              ...previewChannel?.environment,
            },
            signal,
            Math.min(
              deadlineAt - Date.now(),
              command.timeoutMs,
              runtime
                ? profile.environmentAuthority!.expiresAt - Date.now()
                : Number.POSITIVE_INFINITY,
            ),
            privateHome,
            runtime,
          );
          if (previewChannel && result.status === 'passed')
            result.previewReceipt = await previewChannel.finish();
        } finally {
          previewChannel?.close();
        }
        const moduleEvidence = await moduleFence.collectEvidence(result.status === 'passed');
        if (moduleEvidence) result.moduleEvidence = moduleEvidence;
        results.push(result);
        if (result.status !== 'passed') break;
        await this.verifyClosure(root, profile, signal);
        await verifyNativeOutputReceipts(root, outputReceipts, signal);
        await verifyNativeWorkingMembership(
          root,
          profile,
          [
            ...outputReceipts.map(receipt => receipt.path),
            ...(command.produces ?? []).map(output => output.path),
          ],
          privateHome,
          signal,
        );
        for (const output of command.produces ?? []) {
          const generatedChildren = declaredOutputs
            .filter(child => child.path.startsWith(`${output.path}/`))
            .map(child => child.path.slice(output.path.length + 1));
          for (const child of generatedChildren)
            if (
              await lstat(resolve(root, output.path, child)).then(
                () => true,
                error => {
                  if (error.code === 'ENOENT') return false;
                  throw error;
                },
              )
            )
              throw portalError('PORTAL_OUTPUT_ALREADY_EXISTS');
          outputReceipts.push({
            generatedChildren,
            producerCommandId: command.id,
            commandHash: result.commandHash,
            kind: output.kind,
            path: output.path,
            inventory: await inventoryNativeArtifact(
              resolve(root, output.path),
              signal,
              undefined,
              generatedChildren,
            ),
            inputAuthorityHash: contentHash(
              'sfp-native-artifact-authority-v1',
              profile.artifactAuthority,
            ),
            exitCode: 0,
          });
        }
      }
      for (const result of results)
        if (result.moduleEvidence) await verifyNativeModuleEvidence(result.moduleEvidence);
      // Script/config changes invalidate all command results, including a successful exit code.
      await this.verifyClosure(root, profile, signal);
      await verifyNativeArtifactAuthority(profile, signal);
      await verifyNativeOutputReceipts(root, outputReceipts, signal);
      await verifyNativeWorkingMembership(
        root,
        profile,
        [
          ...outputReceipts.map(receipt => receipt.path),
          ...profile.commands
            .filter(command =>
              results.some(result => result.commandId === command.id && result.status !== 'passed'),
            )
            .flatMap(command => (command.produces ?? []).map(output => output.path)),
        ],
        privateHome,
        signal,
      );
      return {
        artifactAuthorityHash: contentHash(
          'sfp-native-artifact-authority-v1',
          profile.artifactAuthority,
        ),
        outputReceipts,
        profileId: profile.id,
        profileHash: contentHash('sfp-native-profile-v1', profile),
        sourceHash: profile.sourceHash,
        executionMode: 'native-working-copy',
        isolation: 'local-owner-account-no-os-sandbox',
        hostPlatform: process.platform,
        commands: results,
      };
    } finally {
      this.running.delete(runId);
      this.cancelled.delete(runId);
      this.active.delete(runId);
    }
  }

  private async verifyClosure(
    root: string,
    profile: NativeProfile,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = new RepoReader({
      rootDir: root,
      signal,
      maxFileBytes: 16_777_216,
      maxTotalBytes: 134_217_728,
    });
    for (const file of profile.closure) {
      // eslint-disable-next-line no-await-in-loop -- bound source reads before execution
      if (storedChecksum(await reader.readBytes(file.path)) !== file.hash)
        throw portalError('PORTAL_PROFILE_CLOSURE_CHANGED');
    }
  }

  private async command(
    runId: string,
    command: NativeCommand,
    cwd: string,
    environment: Record<string, string>,
    signal: AbortSignal,
    timeoutMs: number,
    privateHome: string,
    runtime?: { execution: NativeEnvironmentExecution; lifecycle: NativeEnvironmentLifecycle },
  ): Promise<NativeCommandResult> {
    signal.throwIfAborted();
    if (this.cancelled.has(runId)) throw portalError('PORTAL_NATIVE_CANCELLED');
    // Deliberately omit PATH, HOME, proxy variables and runtime loader hooks from the parent.
    const env: NodeJS.ProcessEnv = {
      ...environment,
      HOME: privateHome,
      USERPROFILE: privateHome,
      APPDATA: privateHome,
      LOCALAPPDATA: privateHome,
      XDG_CONFIG_HOME: privateHome,
      NPM_CONFIG_USERCONFIG: join(privateHome, 'npmrc'),
      NPM_CONFIG_GLOBALCONFIG: join(privateHome, 'global-npmrc'),
      NPM_CONFIG_CACHE: join(privateHome, 'npm-cache'),
      COREPACK_HOME: join(privateHome, 'corepack'),
      PNPM_HOME: join(privateHome, 'pnpm'),
      GIT_CONFIG_GLOBAL: join(privateHome, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      TEMP: privateHome,
      TMP: privateHome,
      TMPDIR: privateHome,
    };
    if (process.platform === 'win32') {
      if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
      if (process.env.WINDIR) env.WINDIR = process.env.WINDIR;
    }
    if (
      runtime &&
      (process.platform !== 'win32' ||
        runtime.execution.broker.programHash !== windowsJobProgramHash ||
        runtime.execution.broker.path !==
          windowsJobCommand(
            process.env.SystemRoot!,
            command.executable,
            command.args,
            cwd,
            timeoutMs,
          ).executable ||
        (await nativeExecutableHash(runtime.execution.broker.path)) !==
          runtime.execution.broker.hash)
    )
      throw portalError('PORTAL_ENVIRONMENT_BROKER_CHANGED');
    const control = runtime
      ? await nativeProcessControl(
          runtime.lifecycle,
          runtime.execution.attemptId,
          command.id,
          command.executableHash,
          signal,
        )
      : null;
    try {
      return await new Promise((resolveResult, reject) => {
        const started = Date.now();
        const broker =
          process.platform === 'win32'
            ? windowsJobCommand(
                process.env.SystemRoot!,
                command.executable,
                command.args,
                cwd,
                timeoutMs,
                control?.pipeName,
                control?.token,
              )
            : null;
        const child = spawn(
          broker?.executable ?? command.executable,
          broker?.args ?? command.args,
          {
            cwd,
            env: broker ? { ...env, SFP_NATIVE_JOB_DATA: broker.data } : env,
            shell: false,
            windowsHide: true,
            detached: process.platform !== 'win32',
            stdio: [broker ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          },
        );
        control?.spawned(child.pid);
        let status: NativeCommandResult['status'] | undefined,
          outputBytes = 0,
          termination: Promise<void> | undefined,
          cleanupError: unknown,
          watchdog: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const chunks: Buffer[] = [];
        const stop = (reason: NativeCommandResult['status']): Promise<void> => {
          status ??= reason;
          termination ??= (
            control ? Promise.resolve(control.stop()) : this.terminateOwned(child)
          ).catch(error => {
            cleanupError = error;
          });
          watchdog ??= setTimeout(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            child.stdin?.destroy();
            child.stdout?.destroy();
            child.stderr?.destroy();
            reject(portalError('PORTAL_NATIVE_CLEANUP_UNKNOWN'));
          }, 5000);
          return termination;
        };
        this.active.set(runId, { child, stop });
        const onAbort = () => {
          void stop('cancelled');
        };
        signal.addEventListener('abort', onAbort, { once: true });
        // Abort can arrive between the preflight check and listener registration.
        if (signal.aborted) onAbort();
        const timer = setTimeout(() => {
          void stop('timed-out');
        }, timeoutMs);
        const capture = (chunk: Buffer) => {
          const available = Math.max(0, command.maxOutputBytes - outputBytes);
          if (available) chunks.push(chunk.subarray(0, available));
          outputBytes += chunk.length;
          if (outputBytes > command.maxOutputBytes) void stop('output-limit');
        };
        child.stdout?.on('data', capture);
        child.stderr?.on('data', capture);
        let spawnError: Error | undefined;
        child.on('error', error => {
          spawnError = error;
        });
        child.once('exit', () => {
          // A root process can exit while descendants retain its output pipes.
          if (process.platform !== 'win32')
            termination ??= this.terminateOwned(child).catch(error => {
              cleanupError = error;
            });
        });
        child.once('close', (exitCode, exitSignal) => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          child.stdin?.destroy();
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          void (async () => {
            await termination;
            await control?.finish();
            if (cleanupError) {
              reject(portalError('PORTAL_NATIVE_CLEANUP_UNKNOWN'));
              return;
            }
            if (spawnError) {
              reject(portalError('PORTAL_NATIVE_SPAWN_FAILED', spawnError.message));
              return;
            }
            let output = Buffer.concat(chunks).toString('utf8');
            for (const value of Object.values(environment)
              .filter(entry => entry.length >= 4)
              .toSorted((a, b) => b.length - a.length))
              output = output.replaceAll(value, '[redacted environment]');
            output = output
              .replace(
                /(\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*)[^\s,;]+/giu,
                '$1[redacted]',
              )
              .replace(/(https?:\/\/)[^/@\s]+@/gu, '$1[redacted]@');
            output = Buffer.from(output).subarray(0, command.maxOutputBytes).toString('utf8');
            resolveResult({
              commandId: command.id,
              commandHash: contentHash('sfp-native-command-v1', command),
              status: status ?? (exitCode === 0 ? 'passed' : 'failed'),
              exitCode,
              signal: exitSignal,
              output,
              durationMs: Date.now() - started,
              cleanup: termination ? 'tree-termination-requested' : 'finished',
            });
          })().catch(reject);
        });
      });
    } finally {
      control?.close();
    }
  }

  private async terminateOwned(child: ChildProcess): Promise<void> {
    const pid = child.pid;
    if (pid === undefined) return;
    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      return;
    }
    // This child is the trusted job broker. Killing it closes the job handle.
    if (child.exitCode === null && child.signalCode === null && !child.kill('SIGKILL'))
      throw portalError('PORTAL_NATIVE_CLEANUP_UNKNOWN');
  }
}
