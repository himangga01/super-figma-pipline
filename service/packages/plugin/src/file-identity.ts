import { FileIdentitySchema, type FileIdentity } from '@sfp/shared';

export const FILE_IDENTITY_NAMESPACE = 'sfp';
export const FILE_IDENTITY_KEY = 'file-identity:v1';

export interface PluginIdentityLifetime {
  readonly provisionalSessionId: string;
  readonly pluginGeneration: string;
}

export interface ReadOnlyPluginIdentitySource {
  readonly fileKey?: string | undefined;
  readonly root: Readonly<{
    getSharedPluginData(namespace: string, key: string): string;
  }>;
}

export interface PluginHelloIdentityFacts {
  readonly pluginGeneration: string;
  readonly fileIdentity: Readonly<FileIdentity>;
  readonly capabilities: readonly [];
}

export type FillRandomBytes = (bytes: Uint8Array<ArrayBuffer>) => void;

const fillCryptographicBytes: FillRandomBytes = bytes => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi === undefined || typeof cryptoApi.getRandomValues !== 'function') {
    throw Object.assign(new Error('cryptographic plugin identity source is unavailable'), {
      code: 'PLUGIN_CRYPTO_UNAVAILABLE',
    });
  }
  cryptoApi.getRandomValues(bytes);
};

const randomHex128 = (fill: FillRandomBytes): string => {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  fill(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

export const createPluginIdentityLifetime = (
  fill: FillRandomBytes = fillCryptographicBytes,
): Readonly<PluginIdentityLifetime> =>
  Object.freeze({
    provisionalSessionId: randomHex128(fill),
    pluginGeneration: randomHex128(fill),
  });

export const resolveReadOnlyFileIdentity = (
  source: ReadOnlyPluginIdentitySource,
  lifetime: Readonly<PluginIdentityLifetime>,
): Readonly<FileIdentity> => {
  if (typeof source.fileKey === 'string' && source.fileKey.length > 0) {
    return Object.freeze(
      FileIdentitySchema.parse({ kind: 'figma-file-key', value: source.fileKey }),
    );
  }
  let shared = '';
  try {
    shared = source.root.getSharedPluginData(FILE_IDENTITY_NAMESPACE, FILE_IDENTITY_KEY);
  } catch {
    // Read-only and Dev contexts may not expose document shared data. Unstable identity is the
    // fail-closed session scope; identity discovery never mutates in order to recover.
  }
  const stored = FileIdentitySchema.safeParse({ kind: 'document-plugin-uuid', value: shared });
  if (stored.success) return Object.freeze(stored.data);
  return Object.freeze(
    FileIdentitySchema.parse({
      kind: 'unstable-readonly',
      sessionId: lifetime.provisionalSessionId,
      pluginGeneration: lifetime.pluginGeneration,
    }),
  );
};

export const createPluginHelloIdentityFacts = (
  source: ReadOnlyPluginIdentitySource,
  lifetime: Readonly<PluginIdentityLifetime>,
): Readonly<PluginHelloIdentityFacts> => {
  const capabilities = Object.freeze([]) as readonly [];
  return Object.freeze({
    pluginGeneration: lifetime.pluginGeneration,
    fileIdentity: resolveReadOnlyFileIdentity(source, lifetime),
    capabilities,
  });
};
