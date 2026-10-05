import { PortalPathSchema, type PortalSourceInventory } from '@sfp/shared';

type ExclusionReason = PortalSourceInventory['exclusions'][number]['reason'];
type EntryKind = PortalSourceInventory['exclusions'][number]['kind'];

/**
 * Tool-owned build, cache and environment output. Such a directory is a recorded, hashed exclusion
 * at any depth; an import into it is reported by the service graph instead of being byte-bound.
 */
const GENERATED_OUTPUT_DIRECTORIES = new Set([
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'out',
  'coverage',
  '.venv',
  'venv',
  'target',
  '__pycache__',
  '.turbo',
  '.cache',
]);
/** Credential locations, as any path segment: key stores, cloud CLI state and secret mounts. */
const CREDENTIAL_LOCATION = /^(?:\.ssh|\.aws|\.azure|\.gnupg|secrets)$/u;
/** Template suffixes of credential formats. Templates are ordinary source. */
const TEMPLATE = /^(?:example|sample|template)$/u;
/** Data formats of `credentials.*` and `secrets.*` files. Code modules are never matched. */
const CREDENTIAL_DATA =
  /^(?:credentials|secrets?)((?:\.[^.]+)*)\.(?:json|jsonc|json5|ya?ml|xml|toml|ini|conf|cfg|properties|env|txt)$/u;
const lastSuffix = (value: string) => value.slice(value.lastIndexOf('.') + 1);

/**
 * Real credential formats and names only: environment files other than templates, key and
 * certificate containers, SSH keys, package and network credentials, and credential data files.
 * Ordinary modules such as `credentials.ts` or `secret.ts` are source.
 */
const credentialName = (part: string): boolean => {
  const name = part.toLowerCase();
  if (CREDENTIAL_LOCATION.test(name)) return true;
  if (name === '.env' || name.startsWith('.env.')) return !TEMPLATE.test(lastSuffix(name));
  if (name === '.npmrc' || name === '.netrc') return true;
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?(?:\..*)?$/u.test(name)) return true;
  if (/^.+\.(?:pem|key|pfx|p12)$/u.test(name)) return true;
  const data = CREDENTIAL_DATA.exec(name);
  return data !== null && !TEMPLATE.test(lastSuffix(data[1]!));
};
/** Extensionless credential files, such as a shared AWS `credentials` file. Not directories. */
const credentialFileName = (part: string) => /^(?:credentials|secrets?)$/iu.test(part);

/**
 * Fixed service policy. Repository ignore files and caller predicates cannot change authority.
 * `kind` describes the final segment; every earlier segment is a directory.
 */
export const portalSourceExclusion = (
  path: string,
  kind: EntryKind = 'file',
): ExclusionReason | undefined => {
  const segments = path.split('/');
  const directories = kind === 'file' ? segments.slice(0, -1) : segments;
  if (segments.some(part => /^\.git$/iu.test(part))) return 'git-metadata';
  if (segments.some(part => /^node_modules$/iu.test(part))) return 'provisioned-dependencies';
  if (segments.some(part => /^\.sfp$/iu.test(part))) return 'service-runtime';
  if (
    segments.some(credentialName) ||
    (kind !== 'directory' && credentialFileName(segments.at(-1)!))
  )
    return 'credentials';
  if (directories.some(part => GENERATED_OUTPUT_DIRECTORIES.has(part.toLowerCase())))
    return 'generated-output';
  return undefined;
};

export const isPortalSourcePath = (path: string): boolean =>
  portalSourceExclusion(path) === undefined;

/** NFC, well-formed Unicode (no lone surrogate) and free of reserved characters and names. */
export const isPortableSourcePath = (path: string): boolean =>
  path === path.normalize('NFC') &&
  !/\p{Cs}/u.test(path) &&
  !/[<>"|?*]/u.test(path) &&
  PortalPathSchema.safeParse(path).success;

const hex = (byte: number) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
/** UTF-8 bytes of one code point; a lone surrogate is encoded as WTF-8, so escaping stays exact. */
const codePointBytes = (character: string): number[] => {
  const code = character.codePointAt(0)!;
  if (code >= 0xd800 && code <= 0xdfff)
    return [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
  return [...Buffer.from(character, 'utf8')];
};
const escapeSegment = (segment: string): string => {
  let escaped = '';
  for (const character of segment)
    escaped +=
      /^[\x21-\x7e ]$/u.test(character) && !/[%\\:<>"|?*/]/u.test(character)
        ? character
        : codePointBytes(character).map(hex).join('');
  if (/[. ]$/u.test(escaped))
    escaped = escaped.slice(0, -1) + hex(escaped.charCodeAt(escaped.length - 1));
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(escaped))
    escaped = hex(escaped.charCodeAt(0)) + escaped.slice(1);
  return escaped;
};

/**
 * Names a path that cannot be recorded verbatim. A segment that is not portable, or that contains
 * `%`, is percent-escaped byte by byte; portable segments stay readable. Escaped segments always
 * contain `%` and verbatim ones never do, so the rendering is injective and itself portable.
 */
export const escapePortalSourcePath = (path: string): string =>
  path
    .split('/')
    .map(segment =>
      segment.includes('%') || !isPortableSourcePath(segment) ? escapeSegment(segment) : segment,
    )
    .join('/');

/** A path for an issue row: verbatim when portable, else escaped, else omitted. */
export const portalSourceIssuePath = (path: string): string | undefined => {
  if (isPortableSourcePath(path)) return path;
  const escaped = escapePortalSourcePath(path);
  return isPortableSourcePath(escaped) ? escaped : undefined;
};
