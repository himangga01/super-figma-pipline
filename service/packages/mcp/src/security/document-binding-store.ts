import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalJson } from '@sfp/ir';
import { canonicalFileIdentityHash, FileIdentitySchema, type FileIdentity } from '@sfp/shared';
import { z } from 'zod';

import {
  AtomicFileStore,
  readFileWithinLimit,
  withRetainedDirectoryChain,
} from '../fs/atomic-file.js';
import { createStatePermissions, type BoundStatePermissions } from './state-permissions.js';

const BindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    fileIdentity: FileIdentitySchema,
    fileKeyHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    fileName: z.string().max(1024),
    operationId: z.string().min(1).max(384),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
type Binding = z.infer<typeof BindingSchema>;
const EnvelopeSchema = z
  .object({ payload: BindingSchema, mac: z.string().regex(/^[0-9a-f]{64}$/u) })
  .strict();

/**
 * Owner-confirmed URL bindings are authenticated local authority, never trusted from Figma document
 * data.
 */
export class DocumentBindingStore {
  private readonly key: Uint8Array;
  constructor(
    private readonly stateRoot: string,
    ownerKey: Uint8Array,
    private readonly boundPermissions?: BoundStatePermissions,
  ) {
    this.key = Uint8Array.from(ownerKey);
  }
  private mac(payload: Binding): string {
    return createHmac('sha256', this.key)
      .update('sfp-document-url-binding-v1\0')
      .update(canonicalJson(payload))
      .digest('hex');
  }
  private path(identity: FileIdentity): string {
    if (identity.kind !== 'document-plugin-uuid')
      throw new Error('DOCUMENT_BINDING_IDENTITY_INVALID');
    return `${canonicalFileIdentityHash(identity).slice(7)}.json`;
  }
  private async read(path: string): Promise<{ binding: Binding; bytes: Uint8Array } | null> {
    let bytes: Uint8Array;
    try {
      bytes = await readFileWithinLimit(path, 16_384);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const record = EnvelopeSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (
      !timingSafeEqual(Buffer.from(record.mac, 'hex'), Buffer.from(this.mac(record.payload), 'hex'))
    )
      throw new Error('DOCUMENT_BINDING_SIGNATURE_INVALID');
    return { binding: record.payload, bytes };
  }
  async get(identity: FileIdentity): Promise<Binding | null> {
    if (identity.kind !== 'document-plugin-uuid') return null;
    const permissions = this.boundPermissions ?? createStatePermissions(this.stateRoot);
    await permissions.verifySecure(this.stateRoot);
    const directory = join(this.stateRoot, 'document-bindings');
    const metadata = await lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (metadata === null) return null;
    try {
      return await withRetainedDirectoryChain(this.stateRoot, directory, async authority => {
        await permissions.verifySecure(directory);
        const path = authority.child(this.path(identity));
        const loaded = await this.read(path);
        if (loaded === null) return null;
        await permissions.verifySecure(path);
        if (
          canonicalFileIdentityHash(loaded.binding.fileIdentity) !==
          canonicalFileIdentityHash(identity)
        )
          throw new Error('DOCUMENT_BINDING_IDENTITY_INVALID');
        return loaded.binding;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async save(input: Omit<Binding, 'schemaVersion' | 'createdAt'>): Promise<void> {
    const payload = BindingSchema.parse({
      ...input,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
    });
    const permissions = this.boundPermissions ?? createStatePermissions(this.stateRoot);
    await permissions.verifySecure(this.stateRoot);
    const directory = join(this.stateRoot, 'document-bindings');
    await withRetainedDirectoryChain(
      this.stateRoot,
      directory,
      async authority => {
        await permissions.ensureSecure(directory);
        const path = authority.child(this.path(payload.fileIdentity)),
          existing = await this.read(path);
        const bytes = Buffer.from(`${canonicalJson({ payload, mac: this.mac(payload) })}\n`);
        const atomic = new AtomicFileStore();
        if (existing === null) await atomic.createNew(path, bytes);
        else {
          await permissions.ensureSecure(path);
          await atomic.replace(path, bytes, {
            destructiveApproved: true,
            expectedDigest64: createHash('sha256').update(existing.bytes).digest('hex'),
          });
        }
        await permissions.ensureSecure(path);
        await permissions.verifySecure(path);
      },
      { createMissing: true },
    );
  }
}
