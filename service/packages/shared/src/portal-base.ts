import { z } from 'zod';

// Leaf contracts shared by portal workflows and recipes. Keep runtime dependencies out of this
// module so either public entry can initialize first without a schema evaluation cycle.
export const PortalLayerSchema = z.enum([
  'frontend',
  'backend',
  'api',
  'database',
  'authentication',
  'authorization',
  'jobs',
  'storage',
  'integration',
  'configuration',
]);
export type PortalLayer = z.infer<typeof PortalLayerSchema>;
export const PortalPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    path =>
      !path.startsWith('/') &&
      !/[\\:]/u.test(path) &&
      !Array.from(path).some(
        character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) &&
      path.split('/').every(part => part !== '' && part !== '.' && part !== '..') &&
      !path
        .split('/')
        .some(
          part =>
            /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
        ),
    'Use a portable relative path without aliases or reserved names',
  );
