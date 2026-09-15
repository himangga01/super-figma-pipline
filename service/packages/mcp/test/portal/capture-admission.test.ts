import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalFileIdentityHash } from '@sfp/shared';
import { expect, it } from 'vitest';

import type { AuthenticatedTargetSession } from '../../src/execution/target-resolver.js';
import { TargetResolver } from '../../src/execution/target-resolver.js';
import { createPortalBindingResolver } from '../../src/portal/capture-source-admission.js';
import {
  resolvePortalCaptureSource,
  revalidatePortalCaptureGrant,
} from '../../src/portal/capture-source-admission.js';
import { DocumentBindingStore } from '../../src/security/document-binding-store.js';
import { portalFixture } from './fixtures.js';
const url = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1';
const session = (
  id = Buffer.alloc(16, 1).toString('base64url'),
  generation = 'generation-1',
): AuthenticatedTargetSession => ({
  sessionId: id,
  pluginGeneration: generation,
  fileIdentity: { kind: 'figma-file-key', value: '4IBhv1d8hEclifZQrOYxHS' },
  editorType: 'figma',
  capabilities: [],
  connectedSequence: 1,
  healthy: true,
});
const fixture = (rows = [session()]) => ({
  sessions: { list: () => rows, active: () => rows[0] },
  bindingFor: async () => null,
});
it('keeps Chrome URL intent explicitly unresolved until approved connection', async () => {
  const value = await resolvePortalCaptureSource(
    { source: 'chrome', url },
    { kind: 'portal-source' },
    fixture(),
  );
  expect(value.grant).toMatchObject({
    kind: 'chrome',
    phase: 'requested-source',
    binding: 'selected-page-after-approved-connection',
  });
  expect(value.target.sessionId).toBeNull();
});
it.each(['active', 'session', 'stable-file'] as const)(
  'rejects contradictory Chrome %s selector',
  async kind => {
    const selector =
      kind === 'session'
        ? { kind, sessionId: Buffer.alloc(16, 1).toString('base64url') }
        : kind === 'stable-file'
          ? { kind, fileIdentityHash: canonicalFileIdentityHash(session().fileIdentity) }
          : { kind };
    await expect(
      resolvePortalCaptureSource({ source: 'chrome', url }, selector, fixture()),
    ).rejects.toMatchObject({ code: 'TARGET_FORBIDDEN' });
  },
);
it('binds the actual Desktop session and rejects generation replacement', async () => {
  const rows = [session()];
  const ports = fixture(rows);
  const admitted = await resolvePortalCaptureSource(
    { source: 'desktop', url },
    { kind: 'portal-source' },
    ports,
  );
  expect(admitted.grant).toMatchObject({
    kind: 'desktop',
    phase: 'pinned-target',
    sessionId: rows[0]!.sessionId,
    pluginGeneration: 'generation-1',
  });
  rows[0] = session(Buffer.alloc(16, 1).toString('base64url'), 'generation-2');
  await expect(
    revalidatePortalCaptureGrant(admitted.grant, admitted.target, ports),
  ).rejects.toMatchObject({ code: 'PORTAL_CAPTURE_TARGET_CHANGED' });
});
it('requires explicit session selection for duplicate same-file plugins', async () => {
  const ports = fixture([session(), session(Buffer.alloc(16, 2).toString('base64url'))]);
  await expect(
    resolvePortalCaptureSource({ source: 'desktop', url }, { kind: 'portal-source' }, ports),
  ).rejects.toMatchObject({ code: 'TARGET_SELECTOR_AMBIGUOUS' });
  const selected = await resolvePortalCaptureSource(
    { source: 'desktop', url },
    { kind: 'session', sessionId: Buffer.alloc(16, 2).toString('base64url') },
    ports,
  );
  expect(selected.target.sessionId).toBe(Buffer.alloc(16, 2).toString('base64url'));
});
it('rejects an explicit unrelated active target', async () => {
  const wrong = session();
  wrong.fileIdentity = { kind: 'figma-file-key', value: 'WrongFile' };
  await expect(
    resolvePortalCaptureSource(
      { source: 'desktop', url },
      { kind: 'active' },
      fixture([wrong, session(Buffer.alloc(16, 2).toString('base64url'))]),
    ),
  ).rejects.toMatchObject({ code: 'DESKTOP_FILE_MISMATCH' });
});
it('never resolves a generic portal source intent outside portal admission', () => {
  expect(() =>
    new TargetResolver(fixture().sessions).resolve({ kind: 'portal-source' }, 'optional'),
  ).toThrow('portal source intent requires canonical portal admission');
});
it('rejects generation changes while a verified document binding is being read', async () => {
  const rows = [session()];
  rows[0]!.fileIdentity = {
    kind: 'document-plugin-uuid',
    value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };
  const ports = {
    ...fixture(rows),
    bindingFor: async () => {
      rows[0] = { ...rows[0]!, pluginGeneration: 'replaced' };
      return {
        fileKeyHash: canonicalFileIdentityHash(session().fileIdentity),
        bindingHash: 'sha256:' + 'a'.repeat(64),
      };
    },
  };
  await expect(
    resolvePortalCaptureSource({ source: 'desktop', url }, { kind: 'portal-source' }, ports),
  ).rejects.toMatchObject({ code: 'PORTAL_CAPTURE_TARGET_CHANGED' });
});

it('retains the pre-await authenticated identity even when a session object is mutated in place', async () => {
  const row = session();
  row.fileIdentity = {
    kind: 'document-plugin-uuid',
    value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };
  const ports = {
    ...fixture([row]),
    bindingFor: async () => {
      Object.assign(row.fileIdentity, { kind: 'figma-file-key', value: 'WrongFile' });
      return {
        fileKeyHash: canonicalFileIdentityHash(session().fileIdentity),
        bindingHash: 'sha256:' + 'a'.repeat(64),
      };
    },
  };
  await expect(
    resolvePortalCaptureSource({ source: 'desktop', url }, { kind: 'portal-source' }, ports),
  ).rejects.toMatchObject({ code: 'PORTAL_CAPTURE_TARGET_CHANGED' });
});

it('uses the actual signed owner document binding for a no-Dev-Mode Desktop and rejects tampering', async () => {
  const f = await portalFixture();
  try {
    const row = session();
    row.fileIdentity = {
      kind: 'document-plugin-uuid',
      value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const documents = new DocumentBindingStore(f.stateRoot, f.key, f.permissions);
    await documents.save({
      fileIdentity: row.fileIdentity,
      fileKeyHash: canonicalFileIdentityHash(session().fileIdentity),
      fileName: 'Fixture',
      operationId: 'owner-confirmation',
    });
    const ports = {
      ...fixture([row]),
      bindingFor: createPortalBindingResolver({
        fileName: () => 'Fixture',
        documents,
        sessions: new Map(),
      }),
    };
    const admitted = await resolvePortalCaptureSource(
      { source: 'desktop', url },
      { kind: 'portal-source' },
      ports,
    );
    expect(admitted.grant).toMatchObject({
      kind: 'desktop',
      bindingMethod: 'owner-confirmed-document',
      fileIdentityHash: canonicalFileIdentityHash(row.fileIdentity),
    });
    const path = join(
      f.stateRoot,
      'document-bindings',
      canonicalFileIdentityHash(row.fileIdentity).slice(7) + '.json',
    );
    const envelope = JSON.parse(await readFile(path, 'utf8'));
    envelope.payload.fileKeyHash = 'sha256:' + '0'.repeat(64);
    await writeFile(path, JSON.stringify(envelope));
    await expect(
      resolvePortalCaptureSource({ source: 'desktop', url }, { kind: 'portal-source' }, ports),
    ).rejects.toThrow('DOCUMENT_BINDING_SIGNATURE_INVALID');
  } finally {
    await f.cleanup();
  }
});
