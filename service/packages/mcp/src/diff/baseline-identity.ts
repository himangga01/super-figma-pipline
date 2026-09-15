import { createHash } from 'node:crypto';

/** Filesystem names contain digests only; raw file/node IDs never become path segments. */
export const designDiffRelativePath = (fileIdentityHash: string, nodeId?: string): string => {
  if (!/^sha256:[0-9a-f]{64}$/u.test(fileIdentityHash)) {
    throw Object.assign(new Error('design diff requires a verified stable file identity'), {
      code: 'DESIGN_DIFF_FILE_IDENTITY_REQUIRED',
    });
  }
  const nodeDigest = createHash('sha256')
    .update(nodeId === undefined ? 'sfp-design-diff-selection-v1\0' : 'sfp-design-diff-node-v1\0')
    .update(nodeId ?? '')
    .digest('hex');
  return `.sfp/design-diff-baselines/v1/${fileIdentityHash.slice(7)}/${nodeDigest}.json`;
};
