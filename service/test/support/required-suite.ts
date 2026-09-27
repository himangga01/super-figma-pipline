// Prerequisite gate for REQUIRED test suites (VER-1). A missing prerequisite fails the test with an
// actionable message instead of skipping it silently. Setting SFP_ALLOW_SKIP=<suite> (a comma or
// space separated list) turns the failure into a visible skip, which scripts/test-skip-census.mjs
// then records. The suite ids and their files are registered in that script's REQUIRED_SUITES.
import { existsSync } from 'node:fs';

import type { TestContext } from 'vitest';

export type RequiredSuite = 'firefox';

const allowedSkipSuites = (): ReadonlySet<string> =>
  new Set((process.env.SFP_ALLOW_SKIP ?? '').split(/[\s,]+/u).filter(Boolean));

export const requireSuitePrerequisite = (
  context: TestContext,
  suite: RequiredSuite,
  available: boolean,
  missing: string,
): void => {
  if (available) return;
  if (allowedSkipSuites().has(suite))
    context.skip(`${missing} (allowed by SFP_ALLOW_SKIP=${suite})`);
  throw new Error(
    `REQUIRED_SUITE_PREREQUISITE_MISSING: ${missing} Set SFP_ALLOW_SKIP=${suite} to skip the ${suite} suite visibly instead.`,
  );
};

/** Pass `firefox.executablePath()` from the calling package's own Playwright installation. */
export const requireFirefox = (context: TestContext, executablePath: string): void =>
  requireSuitePrerequisite(
    context,
    'firefox',
    existsSync(executablePath),
    `Playwright Firefox is not installed at ${executablePath}. Install it into PLAYWRIGHT_BROWSERS_PATH with "corepack pnpm --filter @sfp/cli exec playwright install firefox".`,
  );
