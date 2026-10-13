import { storedChecksum } from '@sfp/ir';
/** Pinned Epic64ca647 configuration. No general callback or plugin execution permission. */
const reviewed = {
  'vite.config.ts': 'cc518bfa3cc20819e02a9ec3edd3604a436872822fd09a0a6aacc9fca7706b3a',
  'react-router.config.ts': 'd8c76a80f4bb9ef694fcc948a55d7a4b8484f05c038d6aa6a98e90619e1a8f97',
  'app/routes.ts': '7728c28010ce3e48c8897f4b1a3980f6e1cd1d7ded5a3b4119e9d26cc6040c12',
  'package.json': 'c67f296c9d3198d1613fb6fd70acfd0eaa858e5b999231da832c6a890881a152',
} as const;
export function isReviewedEpicCompilerConfiguration(path: string, text: string): boolean {
  return (
    (path === 'vite.config.ts' || path === 'react-router.config.ts') &&
    storedChecksum(text) === 'sha256:' + reviewed[path]
  );
}
export function isReviewedEpicCompilerSource(texts: ReadonlyMap<string, string>): boolean {
  return Object.entries(reviewed).every(([path, hash]) => {
    const text = texts.get(path);
    return text !== undefined && storedChecksum(text) === 'sha256:' + hash;
  });
}
