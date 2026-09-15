import { PortalPathSchema, type PortalSourceInventory } from '@sfp/shared';

type ExclusionReason = PortalSourceInventory['exclusions'][number]['reason'];

/** Fixed service policy. Repository ignore files and caller predicates cannot change authority. */
export const portalSourceExclusion = (path: string): ExclusionReason | undefined => {
  const segments = path.split('/');
  if (segments.some(part => /^\.git$/iu.test(part))) return 'git-metadata';
  if (segments.some(part => /^node_modules$/iu.test(part))) return 'provisioned-dependencies';
  if (segments.some(part => /^\.sfp$/iu.test(part))) return 'service-runtime';
  if (
    segments.some(part =>
      /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.ssh|\.aws|\.azure|\.gnupg|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|[^/]+\.(?:pem|key|pfx|p12))$/iu.test(
        part,
      ),
    )
  )
    return 'credentials';
  return undefined;
};

export const isPortalSourcePath = (path: string): boolean =>
  portalSourceExclusion(path) === undefined;

export const isPortableSourcePath = (path: string): boolean =>
  path === path.normalize('NFC') &&
  !/[<>"|?*]/u.test(path) &&
  PortalPathSchema.safeParse(path).success;
