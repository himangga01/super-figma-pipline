import { z } from 'zod';

/** Non-secret generation IDs, created by Web Crypto in the UI's browser context. */
export const PluginIdentitySeedSchema = z
  .object({
    tag: z.literal('@sfp/identity-seed'),
    provisionalSessionId: z.string().regex(/^[0-9a-f]{32}$/u),
    pluginGeneration: z.string().regex(/^[0-9a-f]{32}$/u),
  })
  .strict();
export type PluginIdentitySeed = z.infer<typeof PluginIdentitySeedSchema>;
