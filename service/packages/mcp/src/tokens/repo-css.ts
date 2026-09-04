import { RepoReader } from '../fs/repo-walk.js';
import { parseCssCustomProperties, type ProjectToken } from './tokens.js';

// The token join's right-hand side when there's no single detected CSS config — i.e. a non-Tailwind
// project that defines its design tokens as plain CSS custom properties (:root { --primary: … }), or
// a Tailwind project whose @theme entry wasn't located. Rather than guess *which* CSS file is "the"
// token source (no reliable marker exists, unlike Tailwind's @import/@theme), aggregate the custom
// properties from every hand-authored CSS file and let token_map's join filter them: a Figma variable
// only surfaces a candidate when name- or value-match agrees, so incidental vars (--header-height,
// reset rules) sit in the pool unmatched and never reach the output. Worst case the pool matches
// nothing and the result is identical to today's empty join — so the fallback can't regress.

const MAX_CSS_FILES = 200; // safety cap against pathological repos

export interface AggregatedCss {
  tokens: ProjectToken[];
  /** Repo-relative CSS files that contributed at least one custom property. */
  files: string[];
}

/**
 * Walk every CSS file in the repo, parse its custom properties, and pool them. Directory pruning +
 * .gitignore handling live in walkRepoFiles. Tokens are kept as-is (no cross-file de-dup): the join
 * prefers an exact value-match, so a name collision across files resolves to the right-valued token
 * when the Figma side carries a hex.
 */
export const aggregateRepoCssTokens = async (
  rootDir: string,
  reader: RepoReader = new RepoReader({ rootDir }),
): Promise<AggregatedCss> => {
  const tokens: ProjectToken[] = [];
  const files: string[] = [];

  const walked = await reader.walk({ extensions: ['.css'], cap: MAX_CSS_FILES });
  for (const rel of walked.files) {
    let body: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential repo walk; clarity over batching
      body = await reader.readText(rel);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'REPO_FILE_NOT_FOUND') continue;
      throw error;
    }
    const parsed = parseCssCustomProperties(body);
    if (parsed.length > 0) {
      reader.chargeParseResults(parsed.length);
      tokens.push(...parsed);
      files.push(rel);
    }
  }
  return { tokens, files };
};
