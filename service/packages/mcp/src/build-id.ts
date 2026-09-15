/**
 * Build timestamp (epoch ms) baked into the bundle by tsdown (see tsdown.config.ts `define`).
 * Newest-build-wins election orders server processes by it: a follower running a strictly newer
 * build asks a stale leader to abdicate (see election/election.ts), which is what keeps a
 * long-lived old process — another session's server, or one launched by hand — from serving stale
 * code forever. Published releases get their publish-time build stamp, so the ordering holds across
 * versions too, without parsing semver.
 *
 * When running unbundled (vitest, tsx) the define is absent and this is 0: an unbundled process
 * never claims to be newer than a real build, and two 0s never trigger an abdication.
 */
// eslint-disable-next-line no-underscore-dangle -- dunder marks a compile-time define, per convention
declare const __FIGWRIGHT_BUILD_ID__: string | undefined;

export const BUILD_ID: number =
  typeof __FIGWRIGHT_BUILD_ID__ === 'string' ? Number(__FIGWRIGHT_BUILD_ID__) : 0;

// eslint-disable-next-line no-underscore-dangle -- compile-time build identity
declare const __SFP_BUILD_HASH__: string | undefined;
export const BUILD_IDENTITY_HASH =
  typeof __SFP_BUILD_HASH__ === 'string' && /^sha256:[0-9a-f]{64}$/u.test(__SFP_BUILD_HASH__)
    ? (__SFP_BUILD_HASH__ as `sha256:${string}`)
    : null;
