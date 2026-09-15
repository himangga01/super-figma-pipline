import { z } from 'zod';

import { ProjectConventionsSchema } from './project-conventions.js';

export const ProjectProfileSchema = z
  .object({
    rootDir: z.string(),
    framework: z.enum(['next', 'nuxt', 'react', 'vue', 'svelte', 'solid', 'angular', 'unknown']),
    language: z.enum(['ts', 'js']),
    styling: z
      .object({
        system: z.enum([
          'tailwind',
          'unocss',
          'css-variables',
          'scss',
          'css-modules',
          'plain-css',
          'unknown',
        ]),
        configPath: z.string().optional(),
        tailwindVersion: z.number().optional(),
        classNaming: z.enum(['ampersand', 'flat']).optional(),
      })
      .strict(),
    svg: z
      .object({
        mode: z.enum(['component', 'url']),
        loader: z.string().optional(),
        importHint: z.string().optional(),
      })
      .strict(),
    componentExtensions: z.array(z.string()),
    evidence: z.array(z.string()),
    conventions: ProjectConventionsSchema.optional(),
  })
  .strict();
