import { createHmac, timingSafeEqual } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalJson, storedChecksum } from '@sfp/ir';
import { z } from 'zod';

import {
  AtomicFileStore,
  readFileWithinLimit,
  withRetainedDirectoryChain,
} from '../fs/atomic-file.js';
import {
  createStatePermissions,
  type BoundStatePermissions,
} from '../security/state-permissions.js';

export const portalError = (code: string, message = code) =>
  Object.assign(new Error(message), { code });
const envelopeSchema = z
  .object({
    version: z.literal(1),
    kind: z.string(),
    id: z.string(),
    payload: z.unknown(),
    mac: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
/** Signed owner-state records, atomically created/CAS-replaced. Project files are never authority. */
export class PortalStore {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly permissions: BoundStatePermissions;
  private readonly key: Uint8Array;
  constructor(
    private readonly root: string,
    key: Uint8Array,
    permissions?: BoundStatePermissions,
    private readonly assertWritable: () => void = () => {},
  ) {
    if (key.length < 32) throw portalError('PORTAL_SIGNING_KEY_INVALID');
    this.key = Uint8Array.from(key);
    this.permissions = permissions ?? createStatePermissions(root);
  }
  private path(kind: string, id: string): string {
    if (!/^[a-z][a-z-]{0,31}$/u.test(kind) || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id))
      throw portalError('PORTAL_RECORD_ID_INVALID');
    return join(this.root, 'portal', kind, `${id}.json`);
  }
  private mac(value: unknown): string {
    return createHmac('sha256', this.key)
      .update('sfp-portal-state-v1\0')
      .update(canonicalJson(value))
      .digest('hex');
  }
  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const before = this.tails.get(key) ?? Promise.resolve();
    const task = before.catch(() => {}).then(work);
    this.tails.set(key, task);
    try {
      return await task;
    } finally {
      if (this.tails.get(key) === task) this.tails.delete(key);
    }
  }
  private async read<T>(
    kind: string,
    id: string,
    schema: z.ZodType<T>,
  ): Promise<{ value: T; hash: string } | null> {
    const path = this.path(kind, id),
      directory = join(this.root, 'portal', kind);
    const exists = await lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (exists === null) return null;
    await this.permissions.verifySecure(this.root);
    return withRetainedDirectoryChain(this.root, directory, async authority => {
      await this.permissions.verifySecure(directory);
      let bytes: Uint8Array;
      try {
        bytes = await readFileWithinLimit(authority.child(`${id}.json`), 33_554_432);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      await this.permissions.verifySecure(path);
      const record = envelopeSchema.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      const { mac, ...payload } = record;
      if (
        record.kind !== kind ||
        record.id !== id ||
        !timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(this.mac(payload), 'hex'))
      )
        throw portalError('PORTAL_RECORD_TAMPERED');
      return { value: schema.parse(record.payload), hash: storedChecksum(bytes) };
    });
  }
  private async write<T>(
    kind: string,
    id: string,
    value: T,
    expected: string | null,
  ): Promise<void> {
    this.path(kind, id);
    this.assertWritable();
    await this.permissions.verifySecure(this.root);
    const payload = { version: 1, kind, id, payload: value };
    const bytes = Buffer.from(`${canonicalJson({ ...payload, mac: this.mac(payload) })}\n`);
    if (bytes.length > 33_554_432) throw portalError('PORTAL_RECORD_LIMIT');
    const directory = join(this.root, 'portal', kind);
    await withRetainedDirectoryChain(
      this.root,
      directory,
      async authority => {
        await this.permissions.ensureSecure(join(this.root, 'portal'));
        await this.permissions.ensureSecure(directory);
        const path = authority.child(`${id}.json`),
          atomic = new AtomicFileStore({
            maxReplaceBytes: 33_554_432,
            ...(kind === 'recipe-holds'
              ? {
                  retainedReplaceLimits: {
                    maxRows: 4096,
                    maxBytes: 1_073_741_824,
                    maxScanEntries: 20000,
                  },
                }
              : kind.startsWith('environment-')
                ? {
                    retainedReplaceLimits: {
                      maxRows: 512,
                      maxBytes: 67_108_864,
                      maxScanEntries: 100_000,
                    },
                  }
                : {}),
            beforeLink: async () => this.assertWritable(),
            beforeReplaceCommit: async () => this.assertWritable(),
          });
        this.assertWritable();
        if (expected === null) await atomic.createNew(path, bytes);
        else
          await atomic.replace(path, bytes, {
            destructiveApproved: true,
            expectedDigest64: expected.slice(7),
          });
        await this.permissions.ensureSecure(path);
        await this.permissions.verifySecure(path);
      },
      { createMissing: true },
    );
  }
  get<T>(kind: string, id: string, schema: z.ZodType<T>): Promise<T | null> {
    return this.serial(
      `${kind}/${id}`,
      async () => (await this.read(kind, id, schema))?.value ?? null,
    );
  }
  create<T>(kind: string, id: string, value: T, schema: z.ZodType<T>): Promise<T> {
    return this.serial(`${kind}/${id}`, async () => {
      const parsed = schema.parse(value);
      await this.write(kind, id, parsed, null);
      return parsed;
    });
  }
  update<T>(
    kind: string,
    id: string,
    schema: z.ZodType<T>,
    change: (value: T) => T | Promise<T>,
  ): Promise<T> {
    return this.serial(`${kind}/${id}`, async () => {
      const current = await this.read(kind, id, schema);
      if (current === null) throw portalError('PORTAL_RECORD_NOT_FOUND');
      const next = schema.parse(await change(current.value));
      await this.write(kind, id, next, current.hash);
      return next;
    });
  }
}
