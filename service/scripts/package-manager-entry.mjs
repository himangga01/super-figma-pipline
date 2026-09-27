// Locates the pnpm and npm command-line entries without assuming the Windows Node.js layout.
// Windows keeps the packages bundled with Node.js in <node dir>/node_modules; POSIX installs keep
// them in <prefix>/lib/node_modules next to <prefix>/bin/node.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * @param {'corepack' | 'npm'} name
 * @param {string} command
 * @param {string} execPath
 * @returns {string | undefined}
 */
const bundledCommand = (name, command, execPath) => {
  const nodeDirectory = dirname(execPath);
  let manifestPath;
  try {
    manifestPath = require.resolve(`${name}/package.json`, {
      paths: [nodeDirectory, join(nodeDirectory, '..', 'lib')],
    });
  } catch {
    return undefined;
  }
  /** @type {{ bin?: string | Record<string, string> }} */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[command];
  if (typeof entry !== 'string') return undefined;
  const path = join(dirname(manifestPath), entry);
  return existsSync(path) ? path : undefined;
};

/**
 * `npm_execpath` names the package manager that launched a `run` script; it only counts when it is
 * the requested one, because `pnpm run` also sets it.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {RegExp} pattern
 */
const launchingEntry = (env, pattern) => {
  const value = env.npm_execpath;
  return value && pattern.test(basename(value)) && existsSync(value) ? value : undefined;
};

/**
 * @param {{ env?: NodeJS.ProcessEnv; execPath?: string }} [options]
 * @returns {string} A JavaScript entry to run with `process.execPath`
 */
export const resolvePnpmEntry = ({ env = process.env, execPath = process.execPath } = {}) => {
  const entry =
    launchingEntry(env, /^pnpm(?:\.[cm]?js)?$/iu) ?? bundledCommand('corepack', 'pnpm', execPath);
  if (entry) return entry;
  throw new Error(
    `PNPM_ENTRY_NOT_FOUND: run this script through "corepack pnpm" (so that npm_execpath names pnpm), or use a Node.js 24 installation that bundles corepack beside ${execPath}.`,
  );
};

/**
 * @param {{ env?: NodeJS.ProcessEnv; execPath?: string }} [options]
 * @returns {string} A JavaScript entry to run with `process.execPath`
 */
export const resolveNpmEntry = ({ env = process.env, execPath = process.execPath } = {}) => {
  const entry =
    launchingEntry(env, /^npm-cli\.[cm]?js$/iu) ?? bundledCommand('npm', 'npm', execPath);
  if (entry) return entry;
  throw new Error(
    `NPM_ENTRY_NOT_FOUND: no npm-cli.js is bundled with the Node.js at ${execPath}; run the script through "npm run" (so that npm_execpath names npm) or install Node.js with npm.`,
  );
};
