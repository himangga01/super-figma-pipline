import { portalError } from './store.js';

export interface PortalFileContent {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
}
/** Binary transport is restricted to portable assets; source code always uses UTF-8. */
export const portalContentBytes = (file: PortalFileContent): Buffer => {
  if (file.encoding !== 'base64') return Buffer.from(file.content, 'utf8');
  if (!/\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf)$/iu.test(file.path))
    throw portalError('PORTAL_BINARY_SOURCE_FORBIDDEN');
  const bytes = Buffer.from(file.content, 'base64');
  if (bytes.toString('base64') !== file.content)
    throw portalError('PORTAL_BINARY_ENCODING_INVALID');
  return bytes;
};
