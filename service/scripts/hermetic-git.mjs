// Git subprocesses for packaging and test fixtures that ignore the invoking user's git setup.
// Global and system configuration, templates, hooks, signing, and repository redirection from an
// outer git process (for example GIT_DIR inside a hook) must not change the bytes git produces or
// open a prompt.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// git's own list of variables that it clears before operating on another repository
// (local_repo_env in environment.c), plus the environment-injected configuration channels.
const repositoryRedirectVariables = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
]);
// Configuration, attribute and template channels that this module sets or neutralizes itself.
const configurationVariables = new Set([
  'GIT_ATTR_NOSYSTEM',
  'GIT_ATTR_SOURCE',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_SYSTEM',
  'GIT_TEMPLATE_DIR',
  'GIT_TERMINAL_PROMPT',
  'XDG_CONFIG_HOME',
]);
const injectedConfigurationVariable = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u;

/** Command-line configuration that wins over repository configuration: no signing, no hooks. */
export const HERMETIC_GIT_ARGUMENTS = Object.freeze([
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=',
]);

/** @type {{ directory: string; configPath: string } | undefined} */
let isolation;

/**
 * Returns a private directory with an empty git configuration file, created once per process and
 * removed when the process exits. It doubles as XDG_CONFIG_HOME so that git's default global ignore
 * and attributes files (which GIT_CONFIG_GLOBAL does not cover) are absent as well.
 */
export const hermeticGitIsolation = () => {
  if (isolation) return isolation;
  const directory = mkdtempSync(join(tmpdir(), 'sfp-hermetic-git-'));
  const configPath = join(directory, 'gitconfig');
  writeFileSync(configPath, '');
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
  isolation = { directory, configPath };
  return isolation;
};

/**
 * Copies `base` without variables that redirect or configure git, then points git at the empty
 * configuration. Names are compared case-insensitively because Windows environments are.
 *
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {NodeJS.ProcessEnv}
 */
export const hermeticGitEnvironment = (base = process.env) => {
  const { directory, configPath } = hermeticGitIsolation();
  /** @type {NodeJS.ProcessEnv} */
  const environment = {};
  for (const [name, value] of Object.entries(base)) {
    const upper = name.toUpperCase();
    if (
      repositoryRedirectVariables.has(upper) ||
      configurationVariables.has(upper) ||
      injectedConfigurationVariable.test(upper)
    )
      continue;
    environment[name] = value;
  }
  environment.GIT_ATTR_NOSYSTEM = '1';
  environment.GIT_CONFIG_GLOBAL = configPath;
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.XDG_CONFIG_HOME = directory;
  return environment;
};

/**
 * Adds the per-command switches that keep templates and hooks out: `init --template=` and `commit
 * --no-verify`.
 *
 * @param {readonly string[]} args
 * @returns {string[]}
 */
export const hermeticGitCommand = args => {
  const [command, ...rest] = args;
  if (command === 'init') return [command, '--template=', ...rest];
  if (command === 'commit') return [command, '--no-verify', ...rest];
  return [...args];
};

/**
 * Runs `git -C <cwd> <args>` hermetically with execFileSync semantics: it throws when git fails,
 * never reads stdin, and returns stdout.
 *
 * @param {string} cwd
 * @param {readonly string[]} args
 * @param {{
 *   env?: NodeJS.ProcessEnv;
 *   encoding?: BufferEncoding;
 *   maxBuffer?: number;
 *   timeout?: number;
 * }} [options]
 */
export const hermeticGit = (cwd, args, { env = process.env, ...options } = {}) =>
  execFileSync('git', [...HERMETIC_GIT_ARGUMENTS, '-C', cwd, ...hermeticGitCommand(args)], {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: hermeticGitEnvironment(env),
  });

/**
 * SpawnSync variant for test fixtures that inspect the exit status themselves.
 *
 * @param {string} cwd
 * @param {readonly string[]} args
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export const spawnHermeticGit = (cwd, args, { env = process.env } = {}) =>
  spawnSync('git', [...HERMETIC_GIT_ARGUMENTS, '-C', cwd, ...hermeticGitCommand(args)], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: hermeticGitEnvironment(env),
  });
