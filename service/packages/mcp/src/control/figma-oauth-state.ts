import { createHash } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { AtomicFileStore, readFileWithinLimit } from '../fs/atomic-file.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';
import {
  FigmaOAuthConfigurationSchema,
  figmaOAuthError,
  type FigmaOAuthConfiguration,
} from './figma-oauth-contract.js';

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const FigmaOAuthOperatorContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceName: z.literal('super-figma-pipeline'),
    eligibility: z.literal('accepted-own-service-client'),
    operatorDeclaration: z.literal(true),
    evidenceReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u),
    clientIdDigest: Digest,
    authenticationMethod: z.enum(['client_secret_basic', 'client_secret_post']),
    redirectUri: z.string().max(2048),
    callbackMode: z.literal('fixed'),
  })
  .strict();
export type FigmaOAuthOperatorContract = z.infer<typeof FigmaOAuthOperatorContractSchema>;
const StoredConfiguration = z
  .object({
    schemaVersion: z.literal(1),
    configurationGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    configuration: FigmaOAuthConfigurationSchema,
  })
  .strict();
const checksum = (bytes: Uint8Array | string) =>
  'sha256:' + createHash('sha256').update(bytes).digest('hex');
export const figmaOAuthClientIdDigest = (value: string): string => checksum(value);

export function assertApprovedLoopbackUri(value: string): URL {
  try {
    const url = new URL(value);
    if (
      url.protocol === 'http:' &&
      ['127.0.0.1', '[::1]'].includes(url.hostname) &&
      url.port &&
      Number(url.port) > 0 &&
      Number(url.port) <= 65535 &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname !== '/' &&
      url.href === value
    )
      return url;
  } catch {
    /* Closed error below. */
  }
  throw figmaOAuthError('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
}

/** Only names/contract references persist. Credentials and OAuth transactions never enter it. */
export class FigmaOAuthState {
  readonly #directory: string;
  readonly #stateRoot: string;
  readonly #permissions: Pick<BoundStatePermissions, 'verifySecure' | 'ensureSecure'>;
  #digest: string | null = null;
  constructor(
    stateRoot: string,
    permissions: Pick<BoundStatePermissions, 'verifySecure' | 'ensureSecure'>,
  ) {
    this.#directory = join(stateRoot, 'figma-auth');
    this.#stateRoot = stateRoot;
    this.#permissions = permissions;
  }
  async #read(path: string, limit: number): Promise<Buffer> {
    await this.#permissions.verifySecure(this.#directory);
    await this.#permissions.verifySecure(path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit)
      throw figmaOAuthError('FIGMA_MCP_OAUTH_CONTRACT_INVALID');
    const bytes = await readFileWithinLimit(path, limit);
    await this.#permissions.verifySecure(path);
    return bytes;
  }
  async load(): Promise<{
    configurationGeneration: number;
    configuration: FigmaOAuthConfiguration;
  } | null> {
    const path = join(this.#directory, 'configuration.json');
    try {
      // Test absence before permissions so a missing optional directory does not block startup.
      await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw figmaOAuthError('FIGMA_MCP_OAUTH_CONFIGURATION_INVALID');
    }
    try {
      const bytes = await this.#read(path, 16_384);
      const record = StoredConfiguration.safeParse(JSON.parse(bytes.toString('utf8')));
      if (!record.success) throw Error('invalid');
      this.#digest = checksum(bytes);
      return record.data;
    } catch {
      throw figmaOAuthError('FIGMA_MCP_OAUTH_CONFIGURATION_INVALID');
    }
  }
  async save(
    configuration: FigmaOAuthConfiguration,
    configurationGeneration: number,
  ): Promise<void> {
    try {
      const record = StoredConfiguration.safeParse({
        schemaVersion: 1,
        configurationGeneration,
        configuration,
      });
      if (!record.success) throw Error('invalid');
      const bytes = Buffer.from(JSON.stringify(record.data));
      await this.#permissions.verifySecure(this.#stateRoot);
      await mkdir(this.#directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      await this.#permissions.ensureSecure(this.#directory);
      const path = join(this.#directory, 'configuration.json');
      if (this.#digest === null) await new AtomicFileStore().createNew(path, bytes);
      else {
        await this.#permissions.verifySecure(path);
        await new AtomicFileStore().replace(path, bytes, {
          destructiveApproved: true,
          expectedDigest64: this.#digest.slice(7),
        });
      }
      await this.#permissions.ensureSecure(path);
      this.#digest = checksum(bytes);
    } catch {
      throw figmaOAuthError('FIGMA_MCP_OAUTH_PERSISTENCE_FAILED');
    }
  }
  async contract(
    configuration: FigmaOAuthConfiguration,
  ): Promise<Readonly<FigmaOAuthOperatorContract>> {
    if (!configuration.contractReference || !configuration.contractDigest)
      throw figmaOAuthError('FIGMA_MCP_OAUTH_CONTRACT_REQUIRED');
    const path = join(this.#directory, 'contracts', configuration.contractReference + '.json');
    try {
      await this.#permissions.verifySecure(join(this.#directory, 'contracts'));
      const bytes = await this.#read(path, 16_384);
      if (checksum(bytes) !== configuration.contractDigest)
        throw figmaOAuthError('FIGMA_MCP_OAUTH_CONTRACT_CHANGED');
      const record = FigmaOAuthOperatorContractSchema.safeParse(JSON.parse(bytes.toString('utf8')));
      if (!record.success) throw figmaOAuthError('FIGMA_MCP_OAUTH_CONTRACT_INVALID');
      assertApprovedLoopbackUri(record.data.redirectUri);
      return Object.freeze(record.data);
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'FIGMA_MCP_OAUTH_CONTRACT_CHANGED')
        throw figmaOAuthError('FIGMA_MCP_OAUTH_CONTRACT_CHANGED');
      throw figmaOAuthError('FIGMA_MCP_OAUTH_CONTRACT_INVALID');
    }
  }
}
