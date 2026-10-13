import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const hash = /^sha256:[a-f0-9]{64}$/u;

/** Reviewed R64 constructor ingredients only. Public preparation replaces them with genuine source commands. */
export async function createSourcePreparationInput({ ownerId, planId, contextHash, sourceId, graphSourceHash, packageContextRoot, sourceRoot = packageContextRoot, nodeExecutable, includeOwner = false }) {
  if (!ownerId || !/^sfp_portal1_[a-f0-9]{32}$/u.test(planId ?? '') || ![contextHash, sourceId, graphSourceHash].every(value => hash.test(value ?? '')) || !isAbsolute(packageContextRoot) || !isAbsolute(sourceRoot) || !isAbsolute(nodeExecutable)) throw Error('Actual current protected plan/source/executable bindings required');
  const input = {
    schemaVersion: 1, sourceAuthorityVersion: 2,
    ...(includeOwner ? { ownerId } : {}),
    planId, contextHash, purpose: 'source-preparation',
    sourcePreparation: { sourceId, packageContextRoot },
    native: {
      schemaVersion: 1, sourceAuthorityVersion: 2, id: 'case-source-' + randomUUID(),
      executionMode: 'native-working-copy', environmentKind: 'disposable-test', sourceHash: graphSourceHash,
      closure: [{ path: 'package.json', hash: sha(await readFile(join(sourceRoot, 'package.json'))) }],
      environment: {},
      commands: [{ id: 'source-constructor-placeholder', executable: nodeExecutable, executableHash: sha(await readFile(nodeExecutable)), args: ['-e', ''], cwd: '.', timeoutMs: 1000, maxOutputBytes: 262144, allowLifecycleScripts: false }],
    },
    assertions: [{ commandId: 'source-constructor-placeholder', check: { id: 'source-constructor-placeholder', kind: 'source-scope', requirementIds: [], required: true } }],
  };
  return input;
}
