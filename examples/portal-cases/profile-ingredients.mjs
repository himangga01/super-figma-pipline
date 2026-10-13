import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const hashPattern = /^sha256:[a-f0-9]{64}$/u;

/** Builds native command/resource ingredients from actual candidate files, never old JSON. */
export async function nativeCaseIngredients({ caseId, candidateRoot, nodeExecutable, acceptedHarness, candidateSourceHash }) {
  if (!['c2', 'c3'].includes(caseId) || !hashPattern.test(candidateSourceHash)) throw Error('Actual case and candidate source hash required');
  if (!acceptedHarness || acceptedHarness.startsWith('/') || acceptedHarness.includes('..') || !/^[a-zA-Z0-9/_-]+\.mjs$/u.test(acceptedHarness)) throw Error('Existing owned acceptance wrapper required');
  const info = await lstat(join(candidateRoot, acceptedHarness)); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('Regular reviewed wrapper required');
  const executableHash = sha(await readFile(nodeExecutable));
  const command = (id, args, produces) => ({ id, executable: nodeExecutable, executableHash, args, cwd: '.', timeoutMs: 120000, maxOutputBytes: 1048576, allowLifecycleScripts: false, ...(produces ? { produces } : {}) });
  const c2 = caseId === 'c2';
  const cli = c2 ? 'node_modules/@react-router/dev/bin.js' : 'node_modules/@react-router/dev/bin.cjs';
  return {
    readyToRegister: false,
    candidateSourceHash,
    requiredFreshBindings: ['ownerId', 'planId', 'contextHash', 'complete candidate closure', 'exact screened package/Chrome artifacts', 'actual environment/broker authority', 'original run deadline', 'actual current capture/oracle/interaction contract'],
    resources: [{ id: caseId + '-notes-database', provider: 'owned-sqlite', binding: 'DATABASE_PATH', actions: ['read', 'write', 'create'] }],
    commands: [
      command('typegen', [cli, 'typegen', '--mode', 'development'], [{ path: '.react-router/types', kind: 'generated-output' }]),
      command('typecheck', ['node_modules/typescript/lib/tsc.js', ...(c2 ? ['--noEmit'] : ['-b'])]),
      command('build', [cli, 'build', '--mode', 'production'], [{ path: 'build', kind: 'generated-output' }]),
      ...(c2 ? [command('migrate', ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'])] : [command('migrate', ['server/notes/migrate.mjs'])]),
      command('actual-application-journey', [acceptedHarness]),
    ],
    harness: { path: acceptedHarness, hash: sha(await readFile(join(candidateRoot, acceptedHarness))) },
    actualApplicationEntry: c2 ? 'index.ts' : 'server.js',
    environmentNames: c2 ? ['NODE_ENV', 'PORT', 'APPLICATION_ORIGIN', 'DATABASE_PATH', 'DATABASE_URL', 'CACHE_DATABASE_PATH', 'LITEFS_DIR', 'SESSION_SECRET', 'INTERNAL_COMMAND_TOKEN', 'HONEYPOT_SECRET'] : ['NODE_ENV', 'PORT', 'DATABASE_PATH'],
    doesNotGrantChromeOrEnvironmentAuthority: true,
  };
}
