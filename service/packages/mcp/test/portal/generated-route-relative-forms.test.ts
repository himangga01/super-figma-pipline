import { posix } from 'node:path';

import { expect, it, vi } from 'vitest';

import { resolvePortalModules } from '../../src/portal/module-resolution.js';
import * as compilerEvidence from '../../src/portal/react-router-compiler-evidence.js';

// Computational admission fixture only; cannot issue compiler evidence or native authority.
const forms = [
  ['app/routes/_auth/verify.test.ts', '../settings/profile/+types/change-email.ts'],
  ['app/routes/_seo/robots[.]txt.ts', './+types/robots[.]txt.ts'],
  ['app/routes/_seo/sitemap[.]xml.ts', './+types/sitemap[.]xml.ts'],
  ['app/routes/admin/cache/lru.$cacheKey.ts', './+types/lru.$cacheKey.ts'],
  ['app/routes/admin/cache/sqlite.$cacheKey.ts', './+types/sqlite.$cacheKey.ts'],
  ['app/routes/settings/profile/password_.create.tsx', './+types/password_.create.ts'],
  ['app/routes/users/$username/notes/$noteId_.edit.tsx', './+types/$noteId_.edit.ts'],
  ['app/routes/users/$username/notes/+shared/note-editor.tsx', '../+types/$noteId_.edit.ts'],
] as const;
const member = (from: string, specifier: string) =>
  '.react-router/types/' + posix.normalize(posix.join(posix.dirname(from), specifier));
function resolve(
  from: string,
  statement: string,
  specifier: string,
  options: {
    admission?: boolean;
    roots?: string[];
    missing?: boolean;
    ambiguity?: boolean;
    alias?: boolean;
  } = {},
) {
  const files = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { rootDirs: options.roots ?? ['.', '.react-router/types'] },
    }),
    [from]: statement,
  };
  const exact = member(from, specifier),
    modules = new Map<string, string>();
  if (!options.missing) modules.set(exact, 'export type Route = unknown;');
  if (options.ambiguity)
    modules.set(exact.replace('change-email', 'Change-email'), 'export type Route = unknown;');
  if (options.alias)
    modules.set(
      posix.normalize(posix.join(posix.dirname(from), specifier)),
      'export type Route = unknown;',
    );
  const spy = vi.spyOn(compilerEvidence, 'admittedReactRouterCompilerEvidence').mockReturnValue(
    options.admission === false
      ? null
      : {
          hash: 'sha256:' + 'a'.repeat(64),
          configuration: ['react-router.config.ts'],
          modules,
        },
  );
  try {
    return resolvePortalModules(new Map(Object.entries(files)), Object.keys(files), {
      reactRouterCompilerEvidence: {} as compilerEvidence.ReactRouterCompilerEvidence,
      sourceId: 'sha256:' + 'b'.repeat(64),
      sourceInventoryHash: 'sha256:' + 'c'.repeat(64),
    });
  } finally {
    spy.mockRestore();
  }
}
it('admits the eight actual C2 type-only dotted and sibling route forms through exact capsule members', () => {
  for (const [from, specifier] of forms) {
    const result = resolve(from, `import { type Route } from '${specifier}';`, specifier, {
      alias: true,
    });
    expect(result.complete).toBe(true);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      status: 'external',
      targets: [],
      reason: 'observed-compiler-generated-route-type',
    });
    expect(result.references[0]!.configuration).toContain('react-router.config.ts');
    expect(result.references[0]!.configuration).not.toContain(member(from, specifier));
  }
});
it('keeps runtime, malformed, escaping, bare, unadmitted and ambiguous route-type requests blocked', () => {
  const from = forms[0][0],
    specifier = forms[0][1];
  for (const statement of [
    `import { Route } from '${specifier}';`,
    `import { type Route, runtime } from '${specifier}';`,
    `void import('${specifier}');`,
  ])
    expect(resolve(from, statement, specifier, { alias: true }).complete).toBe(false);
  for (const bad of [
    '+types/change-email.ts',
    '/app/+types/change-email.ts',
    './+types/../change-email.ts',
    './x/../+types/change-email.ts',
    '../../../../outside/+types/change-email.ts',
    '../settings/profile/+types/..',
    '../settings/profile/+types/change%2eemail.ts',
    '../settings/profile/+types/change\\email.ts',
  ])
    expect(resolve(from, `import { type Route } from ${JSON.stringify(bad)};`, bad).complete).toBe(
      false,
    );
  expect(
    resolve('root.ts', "import { type Route } from '../+types/home.ts';", '../+types/home.ts', {
      alias: true,
    }).complete,
  ).toBe(false);
  for (const options of [
    { admission: false },
    { missing: true },
    { roots: ['.'] },
    { roots: ['.', 'other-types'] },
    { ambiguity: true },
  ])
    expect(
      resolve(from, `import { type Route } from '${specifier}';`, specifier, options).complete,
    ).toBe(false);
});
