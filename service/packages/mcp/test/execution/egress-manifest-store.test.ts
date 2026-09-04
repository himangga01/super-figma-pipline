import { appendFile, link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { EGRESS_MANIFEST_LIMITS } from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { EgressManifestStore } from '../../src/execution/egress-manifest-store.js';
import {
  createOutputEgressManifest,
  createPreExecutionConsentManifest,
} from '../../src/policy/egress-policy.js';

const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;
const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

const root = async () => {
  const value = await mkdtemp(join(tmpdir(), 'sfp-egress-'));
  roots.push(value);
  return value;
};

const preManifest = () =>
  createPreExecutionConsentManifest({
    consentId: null,
    mode: 'local-trusted',
    inputClasses: ['public'],
    possibleResultClasses: ['public'],
    allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
    inputBytes: 2,
    inputTokens: 1,
  });

describe('durable egress manifest store', () => {
  it('fsyncs a pre row and exactly one matching finalizer that survives restart', async () => {
    const stateRoot = await root();
    const store = new EgressManifestStore({ stateRoot, actorId, now: () => 1_724_803_200_000 });
    await store.recover(1_724_803_200_000);
    const pre = preManifest();
    const reservation = await store.reservePre(actorId, requestId, 'operation-1', pre);
    const finalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const finalized = await store.finalize(reservation, finalizer);

    await expect(store.finalize(reservation, finalizer)).resolves.toEqual(finalized);
    await expect(
      store.finalize(reservation, { ...finalizer, outputBytes: 3 } as never),
    ).rejects.toMatchObject({ code: 'EGRESS_FINALIZER_CONFLICT' });
    const restarted = new EgressManifestStore({ stateRoot, actorId });
    await restarted.recover(1_724_803_200_001);
    await expect(
      restarted.readVerifiedFinalizer(actorId, 'operation-1', finalized.finalManifestHash),
    ).resolves.toMatchObject({
      finalStatus: 'output',
      manifestHash: finalized.finalManifestHash,
      resultHash: finalizer.resultHash,
    });
    const bytes = await readFile(store.logPath, 'utf8');
    expect(bytes).not.toMatch(/rawArgs|"result"/u);
  });

  it('discards only one truncated final row and rejects middle-chain corruption', async () => {
    const stateRoot = await root();
    const store = new EgressManifestStore({ stateRoot, actorId });
    await store.recover(Date.now());
    await store.reservePre(actorId, requestId, 'operation-a', preManifest());
    await store.reservePre(actorId, requestId, 'operation-b', preManifest());
    await appendFile(store.logPath, '{"truncated"');
    await expect(
      new EgressManifestStore({ stateRoot, actorId }).recover(Date.now()),
    ).resolves.toBeUndefined();
    const recovered = await readFile(store.logPath);
    const corruptionIndex = Math.floor(recovered.byteLength / 3);
    recovered[corruptionIndex] = (recovered[corruptionIndex] ?? 0) ^ 1;
    await writeFile(store.logPath, recovered);
    await expect(
      new EgressManifestStore({ stateRoot, actorId }).recover(Date.now()),
    ).rejects.toMatchObject({
      code: 'EGRESS_MANIFEST_CORRUPT',
    });
  });

  it('publishes a strict immutable generation at the exact compaction threshold and retains lookup', async () => {
    const stateRoot = await root();
    const limits = {
      ...EGRESS_MANIFEST_LIMITS,
      compactAtRows: 2,
      compactAtBytes: EGRESS_MANIFEST_LIMITS.maxBytesPerActor,
    };
    const store = new EgressManifestStore({ stateRoot, actorId, limits });
    await store.recover(Date.now());
    const pre = preManifest();
    const reservation = await store.reservePre(actorId, requestId, 'operation-compact', pre);
    const finalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await store.finalize(reservation, finalizer);

    const names = await readdir(join(stateRoot, 'journal'));
    expect(names.filter(name => name.endsWith('.current'))).toHaveLength(1);
    expect(
      names.filter(name => name.includes('.compact-') && name.endsWith('.jsonl')),
    ).toHaveLength(1);
    expect(
      names.filter(name => name.includes('.compact-') && name.endsWith('.checkpoint.json')),
    ).toHaveLength(1);
    expect(
      names.filter(name => name.includes('.compact-') && name.endsWith('.anchor.json')),
    ).toHaveLength(1);
    const pointerName = names.find(name => name.endsWith('.current')) as string;
    const pointer = JSON.parse(
      await readFile(join(stateRoot, 'journal', pointerName), 'utf8'),
    ) as object;
    expect(Object.keys(pointer).toSorted()).toEqual([
      'anchorHash',
      'checkpointHash',
      'compactionId',
      'logDigest64',
      'schemaVersion',
    ]);

    const restarted = new EgressManifestStore({ stateRoot, actorId, limits });
    await restarted.recover(Date.now());
    await expect(
      restarted.readVerifiedFinalizer(actorId, 'operation-compact', finalizer.manifestHash),
    ).resolves.toMatchObject({ manifestHash: finalizer.manifestHash });
  });

  it('fails closed on pointer-selected generation corruption instead of falling back', async () => {
    const stateRoot = await root();
    const limits = { ...EGRESS_MANIFEST_LIMITS, compactAtRows: 2 };
    const store = new EgressManifestStore({ stateRoot, actorId, limits });
    await store.recover(Date.now());
    const pre = preManifest();
    const reservation = await store.reservePre(actorId, requestId, 'operation-corrupt', pre);
    const finalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await store.finalize(reservation, finalizer);
    const journal = join(stateRoot, 'journal');
    const names = await readdir(journal);
    const selected = names.find(
      name => name.includes('.compact-') && name.endsWith('.jsonl'),
    ) as string;
    const bytes = await readFile(join(journal, selected));
    bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] ?? 0) ^ 1;
    await writeFile(join(journal, selected), bytes);
    await expect(
      new EgressManifestStore({ stateRoot, actorId, limits }).recover(Date.now()),
    ).rejects.toMatchObject({
      code: 'EGRESS_MANIFEST_CORRUPT',
    });
  });

  it('recovers the complete base chain and removes unselected generations after a pre-pointer crash', async () => {
    const stateRoot = await root();
    const limits = { ...EGRESS_MANIFEST_LIMITS, compactAtRows: 2 };
    const crash = Object.assign(new Error('injected compaction crash'), { code: 'INJECTED_CRASH' });
    const store = new EgressManifestStore({
      stateRoot,
      actorId,
      limits,
      compactionHook: async step => {
        if (step === 'before-pointer-replace') throw crash;
      },
    });
    await store.recover(Date.now());
    const pre = preManifest();
    const reservation = await store.reservePre(actorId, requestId, 'operation-crash', pre);
    const finalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await expect(store.finalize(reservation, finalizer)).rejects.toBe(crash);

    const restarted = new EgressManifestStore({ stateRoot, actorId, limits });
    await restarted.recover(Date.now());
    await expect(
      restarted.readVerifiedFinalizer(actorId, 'operation-crash', finalizer.manifestHash),
    ).resolves.toMatchObject({ manifestHash: finalizer.manifestHash });
    const names = await readdir(join(stateRoot, 'journal'));
    expect(names.filter(name => name.includes('.compact-'))).toEqual([]);
  });

  it('keeps exact held hard capacity valid and rejects the next reservation', async () => {
    const stateRoot = await root();
    const limits = {
      ...EGRESS_MANIFEST_LIMITS,
      maxRowsPerActor: 2,
      maxBytesPerActor: 2 * EGRESS_MANIFEST_LIMITS.maxRowBytes,
      compactAtRows: 2,
    };
    const store = new EgressManifestStore({ stateRoot, actorId, limits });
    await store.recover(Date.now());
    const pre = preManifest();
    const reservation = await store.reservePre(actorId, requestId, 'operation-held', pre);
    const finalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await store.finalize(reservation, finalizer);
    await expect(store.reservePre(actorId, requestId, 'operation-next', pre)).rejects.toMatchObject(
      {
        code: 'EGRESS_MANIFEST_CAPACITY_EXCEEDED',
      },
    );
  });

  it('removes a terminal finalizer at exact 30-day equality but protects unlinked preflight', async () => {
    const stateRoot = await root();
    const settledAt = 1_724_803_200_000;
    const store = new EgressManifestStore({ stateRoot, actorId, now: () => settledAt });
    await store.recover(settledAt);
    const linkedPre = preManifest();
    const linkedReservation = await store.reservePre(
      actorId,
      requestId,
      'operation-linked',
      linkedPre,
    );
    const linkedFinal = createOutputEgressManifest({
      preExecutionManifestHash: linkedPre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await store.finalize(linkedReservation, linkedFinal);
    await store.reservePre(actorId, requestId, 'operation-active', preManifest());
    await store.compact({
      now: settledAt + 2_592_000_000,
      linkedAt: operationId => (operationId === 'operation-linked' ? settledAt : null),
    });

    await expect(
      store.readVerifiedFinalizer(actorId, 'operation-linked', linkedFinal.manifestHash),
    ).rejects.toMatchObject({ code: 'EGRESS_FINALIZER_MISSING' });
    await expect(
      store.reservePre(actorId, requestId, 'operation-active', preManifest()),
    ).resolves.toMatchObject({
      operationId: 'operation-active',
    });
  });

  it('serializes sibling actor appends so concurrent operations restart with one ordered chain', async () => {
    const stateRoot = await root();
    const store = new EgressManifestStore({ stateRoot, actorId });
    await store.recover(Date.now());
    const pre = preManifest();
    await Promise.all([
      store.reservePre(actorId, requestId, 'operation-concurrent-a', pre),
      store.reservePre(actorId, requestId, 'operation-concurrent-b', pre),
    ]);

    const restarted = new EgressManifestStore({ stateRoot, actorId });
    await expect(restarted.recover(Date.now())).resolves.toBeUndefined();
    await expect(
      restarted.reservePre(actorId, requestId, 'operation-concurrent-a', pre),
    ).resolves.toMatchObject({ operationId: 'operation-concurrent-a' });
    await expect(
      restarted.reservePre(actorId, requestId, 'operation-concurrent-b', pre),
    ).resolves.toMatchObject({ operationId: 'operation-concurrent-b' });
  });

  it('serializes the same actor path across two recovered store instances', async () => {
    const stateRoot = await root();
    const first = new EgressManifestStore({ stateRoot, actorId });
    const second = new EgressManifestStore({ stateRoot, actorId });
    await Promise.all([first.recover(Date.now()), second.recover(Date.now())]);
    const pre = preManifest();
    await Promise.all([
      first.reservePre(actorId, requestId, 'operation-instance-a', pre),
      second.reservePre(actorId, requestId, 'operation-instance-b', pre),
    ]);

    const restarted = new EgressManifestStore({ stateRoot, actorId });
    await expect(restarted.recover(Date.now())).resolves.toBeUndefined();
    await expect(
      restarted.reservePre(actorId, requestId, 'operation-instance-a', pre),
    ).resolves.toMatchObject({ operationId: 'operation-instance-a' });
    await expect(
      restarted.reservePre(actorId, requestId, 'operation-instance-b', pre),
    ).resolves.toMatchObject({ operationId: 'operation-instance-b' });
  });

  it('preserves the exact active-tail suffix across a second pointer-committed compaction crash', async () => {
    const stateRoot = await root();
    const limits = { ...EGRESS_MANIFEST_LIMITS, compactAtRows: 2 };
    const first = new EgressManifestStore({ stateRoot, actorId, limits });
    await first.recover(Date.now());
    const pre = preManifest();
    const firstReservation = await first.reservePre(actorId, requestId, 'operation-first', pre);
    const firstFinalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await first.finalize(firstReservation, firstFinalizer);
    const crash = Object.assign(new Error('after pointer commit'), { code: 'INJECTED_CRASH' });
    const second = new EgressManifestStore({
      stateRoot,
      actorId,
      limits,
      compactionHook: async step => {
        if (step === 'pointer-replace') throw crash;
      },
    });
    await second.recover(Date.now());
    const secondReservation = await second.reservePre(actorId, requestId, 'operation-second', pre);
    const secondFinalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await expect(second.finalize(secondReservation, secondFinalizer)).rejects.toMatchObject({
      code: 'IMMUTABLE_GENERATION_COMMIT_OUTCOME_UNKNOWN',
      committed: true,
      cause: crash,
    });
    await expect(
      second.readVerifiedFinalizer(actorId, 'operation-second', secondFinalizer.manifestHash),
    ).resolves.toBeDefined();

    const restarted = new EgressManifestStore({ stateRoot, actorId, limits });
    await restarted.recover(Date.now());
    await expect(
      restarted.readVerifiedFinalizer(actorId, 'operation-first', firstFinalizer.manifestHash),
    ).resolves.toBeDefined();
    await expect(
      restarted.readVerifiedFinalizer(actorId, 'operation-second', secondFinalizer.manifestHash),
    ).resolves.toBeDefined();
    expect((await readFile(restarted.logPath, 'utf8')).trim()).toBe('');
  });

  it('rejects a hardlinked current pointer instead of trusting an aliased pathname', async () => {
    const stateRoot = await root();
    const limits = { ...EGRESS_MANIFEST_LIMITS, compactAtRows: 2 };
    const store = new EgressManifestStore({ stateRoot, actorId, limits });
    await store.recover(Date.now());
    const pre = preManifest();
    const reservation = await store.reservePre(actorId, requestId, 'operation-pointer-alias', pre);
    const finalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await store.finalize(reservation, finalizer);
    const journal = join(stateRoot, 'journal');
    const current = (await readdir(journal)).find(name => name.endsWith('.current')) as string;
    await link(join(journal, current), join(journal, 'foreign-pointer-alias'));

    await expect(
      new EgressManifestStore({ stateRoot, actorId, limits }).recover(Date.now()),
    ).rejects.toMatchObject({
      code: 'EGRESS_MANIFEST_CORRUPT',
    });
  });

  it('recovers recognized process-death temporary hardlinks after pointer commit', async () => {
    const stateRoot = await root();
    const limits = { ...EGRESS_MANIFEST_LIMITS, compactAtRows: 2 };
    const store = new EgressManifestStore({ stateRoot, actorId, limits });
    await store.recover(Date.now());
    const pre = preManifest();
    const reservation = await store.reservePre(actorId, requestId, 'operation-death-temp', pre);
    const finalizer = createOutputEgressManifest({
      preExecutionManifestHash: pre.manifestHash,
      resultClasses: ['public'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultBytes: 2,
      payloadHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await store.finalize(reservation, finalizer);
    const journal = join(stateRoot, 'journal');
    const generationNames = (await readdir(journal)).filter(name => name.includes('.compact-'));
    const token = 'b'.repeat(32);
    for (const name of generationNames) {
      await link(join(journal, name), join(journal, `.${name}.${token}.tmp`));
    }

    const restarted = new EgressManifestStore({ stateRoot, actorId, limits });
    await expect(restarted.recover(Date.now())).resolves.toBeUndefined();
    await expect(
      restarted.readVerifiedFinalizer(actorId, 'operation-death-temp', finalizer.manifestHash),
    ).resolves.toBeDefined();
    expect((await readdir(journal)).filter(name => name.endsWith(`.${token}.tmp`))).toEqual([]);
  });

  it('removes a complete recognized pre-pointer generation link group and preserves the base', async () => {
    const stateRoot = await root();
    const store = new EgressManifestStore({ stateRoot, actorId });
    await store.recover(Date.now());
    const pre = preManifest();
    await store.reservePre(actorId, requestId, 'operation-pre-pointer-residue', pre);
    const stem = store.logPath.slice(0, -'.jsonl'.length);
    const compactionId = 'c'.repeat(32);
    const token = 'd'.repeat(32);
    const residues = [
      `${stem}.compact-${compactionId}.jsonl`,
      `${stem}.compact-${compactionId}.checkpoint.json`,
      `${stem}.compact-${compactionId}.anchor.json`,
    ];
    for (const path of residues) {
      await writeFile(path, 'uncommitted');
      await link(path, join(dirname(path), `.${basename(path)}.${token}.tmp`));
    }

    const restarted = new EgressManifestStore({ stateRoot, actorId });
    await expect(restarted.recover(Date.now())).resolves.toBeUndefined();
    await expect(
      restarted.reservePre(actorId, requestId, 'operation-pre-pointer-residue', pre),
    ).resolves.toMatchObject({ operationId: 'operation-pre-pointer-residue' });
    expect(
      (await readdir(join(stateRoot, 'journal'))).filter(name => name.includes(compactionId)),
    ).toEqual([]);
  });
});
