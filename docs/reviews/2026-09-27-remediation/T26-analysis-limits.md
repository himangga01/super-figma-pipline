# T26: analysis limits and inventory policy (SA-1, SA-2, SA-3, SVC-8, K24)

- Date: 2026-09-27
- Branch: `rem/t26-analysis-limits`, based on `1da01f9`
- Plan: [prioritized fix plan](../../plans/2026-09-27-prioritized-fix-plan.md), task T26
- Findings: SA-1, SA-2 (both critical), SA-3, SVC-8 and K24, recorded in the
  [code remediation plan](../../plans/2026-09-27-code-remediation-plan.md)
- Commits:
  - `80ff0a8` `fix(profile): sample convention evidence with exact counts (SA-1)`
  - `bc606f4` `fix(portal): hash-only large inputs and aggregated service evidence (SA-2, SA-3)`
  - `d6d7aec` `fix(portal): record generated output and narrow credential policy (SVC-8, K24)`

## Result

- A 200-file React application is sampled, not truncated. Its core recipe source is mapped, and
  `map-design` is `ready` with no blocking issue.
- A 900 KB lockfile plus 800 imports raises no limit issue. Lockfiles and data files that do not fit
  the text bounds are hash-only members; the source inventory still binds their bytes.
- A BOM-prefixed source matches its raw-byte hash.
- A 6,000-file `dist/` is one recorded exclusion, so the inventory is complete. An NFD file name is
  reported as a named, escaped `REPO_SOURCE_PATH_UNSAFE` issue, and the scan continues past it.
- `src/credentials.ts` and `.env.example` are source. `.env` and `id_rsa` stay excluded and are never
  opened.

The plan-level part of SVC-8 ("return plan issues instead of throwing") is in `coordinator.ts`,
which this task does not own. The needed change is described under
[Changes needed in files this task does not own](#changes-needed-in-files-this-task-does-not-own).

## Design

### SA-1: convention evidence is a sample with exact counts

`packages/mcp/src/profile/conventions.ts`, `packages/shared/src/project-conventions.ts`

- Each category keeps a deterministic sample of at most 32 rows: the first distinct rows in walk
  order and syntax-tree order. A new optional `count` records the exact number of distinct rows.
  Rows are distinct by category, line and signal within a file, as before.
- A full sample is not incompleteness. `truncated` is set only when an effective input is unread,
  and every unread input is named in `unreadFiles`:
  - `SOURCE_SIZE_LIMIT` (unchanged: 256 KiB per file, 8,000,000 bytes in total);
  - `PARSE_FAILED`, `SFC_UNTERMINATED`, `SCRIPT_UNSUPPORTED` and `AST_LIMIT` (unchanged);
  - `DISCOVERY_LIMIT` with the path `.` when the 512-file discovery cap is reached (new: it used
    to set `truncated` without naming anything);
  - the error code when a file cannot be read within the reader's authority or byte budget (new:
    such an error used to abort the whole analysis). Cancellation still propagates.
- A category is `observed` when its count is positive, `incomplete` when it is empty and some input
  is unread, and `not-observed` otherwise.
- Evidence lines come from a per-file newline index. Counting every occurrence would otherwise
  slice the file text once per occurrence.
- Consumers: `core-source.ts` and `core-derivation.ts` both block on
  `truncated || unreadFiles.length`. With the new meaning of `truncated`, that check blocks only on
  unread inputs, so neither needs a logic change; `core-source.ts` gained a comment.

### SA-2: hash-only members and aggregated evidence

`packages/mcp/src/portal/service-graph.ts`, `packages/mcp/src/portal/service-connections.ts`,
`packages/shared/src/portal.ts`

- **Lockfiles** are always hash-only: `package-lock.json`, `npm-shrinkwrap.json`,
  `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `deno.lock`, `composer.lock`,
  `Gemfile.lock`, `Pipfile.lock`, `poetry.lock`, `pdm.lock`, `uv.lock`, `Cargo.lock`, `go.sum`,
  `packages.lock.json`, `gradle.lockfile`, `flake.lock`, `mix.lock`, `Podfile.lock`,
  `pubspec.lock` and `Package.resolved`.
- **Required text** is read first: code in a supported language, SFCs, `.mdx`, manifests,
  `tsconfig*.json` and `jsconfig*.json`, and `portal.routes.json`. A required source stays an
  explicit hard issue that names the path when it does not fit the bounds (`SOURCE_LIMIT`), cannot
  be read (`SOURCE_UNREADABLE`), cannot be decoded (`SOURCE_ENCODING`) or changed after the
  inventory was taken (`SOURCE_CHANGED_DURING_ANALYSIS`).
- **Other data** (JSON, YAML, TOML, XML, HTML, CSS, SCSS, Markdown, GraphQL, Dockerfiles) is read
  with the remaining budget. Data that does not fit is hash-only, with no issue. Data that fits but
  is binary still raises `SOURCE_ENCODING`, as before.
- The text bounds are unchanged (256 KiB per file, 8 MiB in total); only what must fit them
  changed. The decision uses the inventory's recorded size, so it is deterministic for one
  inventory.
- **Hash-only members** are passed to `analyzePortalServiceConnections` as a new `members` input.
  They are never parsed, but they are verified module targets, so importing a large JSON file or an
  image no longer raises `MODULE_TARGET_MISSING`. A member cannot share a path with a text source
  (`DUPLICATE_SOURCE`).
- **Evidence aggregation.** Each service row now stands for all occurrences with the same kind,
  source role and key, and carries the first location and an exact `count` (a new optional field
  of `PortalEvidenceSchema`). The key is:
  - the package key for packages and built-ins: `@scope/name`, `name` or `node:name`;
  - `local:<service root>` for imports resolved to local files, whatever their specifier (relative,
    `@/…` alias or workspace package);
  - `(relative)` for unresolved relative imports, and the reason for a nonliteral module;
  - the unchanged detail for every other kind, for example `GET /health`.

  The source role is part of the key, so a test-only use never hides a runtime use. Layers are
  still derived from every occurrence. Distinct rows beyond 512 per service still raise the hard
  `EVIDENCE_LIMIT`.
- Import and API edges keep one exact edge per occurrence. `configures` and `depends-on` edges are
  kept once per endpoint pair and evidence kind.
- `analyzePortalServiceConnections` emits one module-resolution configuration candidate per
  configuration file and consuming service, and one `module-dependency` connection per service
  pair, instead of one per import.

### SA-3: BOM-tolerant hash comparison

The graph keeps decoding with the default decoder, which removes one leading BOM, so offsets and
lines agree with every other reader of the file. The hash stays the raw-byte hash.
`analyzePortalServiceConnections` accepts the text when the hash matches either its UTF-8 bytes or
`EF BB BF` followed by them. Any other byte sequence, including a double BOM, still raises
`SOURCE_HASH_MISMATCH`.

### SVC-8: generated output and unsafe paths

`packages/mcp/src/portal/source-path-policy.ts`, `packages/mcp/src/fs/repo-walk.ts`,
`packages/mcp/src/portal/source-inventory.ts`, `packages/mcp/src/portal/service-graph.ts`

- **Generated-output directories** are `dist`, `build`, `.next`, `.nuxt`, `.svelte-kit`, `out`,
  `coverage`, `.venv`, `venv`, `target`, `__pycache__`, `.turbo` and `.cache`, matched
  case-insensitively at any depth. The walk records each one as an exclusion with the reason
  `generated-output` (a new value of the inventory schema's reason enum) and never enters it. The
  exclusion list is part of the inventory hash, so adding or removing such a directory changes the
  inventory identity, while rebuilding its content does not.
- The rule applies to directories only. `portalSourceExclusion(path, kind)` takes the entry kind; a
  file named `build` or `out` stays source. `isPortalSourcePath(path)` treats the last segment as a
  file, so a submitted file inside a generated-output directory is refused, like every other
  excluded path.
- **Required inputs are byte-bound or blocking.** After module resolution, the graph checks every
  unresolved relative import. If its target is a recorded exclusion, or lies under one, the graph
  raises a hard, non-reviewable issue that names both sides:
  `SOURCE_REQUIRED_INPUT_EXCLUDED:<importing file>:<offset>:<reason>:<excluded path>`. This covers a
  checked-in `build/` imported by application code, and an import of a credential file.
- **Unsafe paths.** `REPO_SOURCE_PATH_UNSAFE` now carries a `path`: each segment that is not portable,
  or that contains `%`, is percent-escaped byte by byte, and other segments stay verbatim. For
  example, the NFD name `src/café.ts` becomes `src/cafe%CC%81.ts`. The rendering is injective, since
  escaped segments always contain `%` and verbatim ones never do. It is itself a portable path, which
  is also true for control characters, reserved characters, trailing dots or spaces, reserved device
  names and lone surrogates. The unsafe entry is skipped, and the scan continues. The inventory stays
  incomplete, as the remaining-work plan requires.
- Lone surrogates are now unsafe: a path that is not well-formed Unicode cannot be written as UTF-8
  without aliasing.
- A filesystem error during inventory reads is named by the relative path being read. The error's
  own `path` is a native absolute path, which the old code dropped.

### K24: credential names

A path is a credential, and is never opened or hashed, when:

- any segment is `.ssh`, `.aws`, `.azure`, `.gnupg` or `secrets`;
- any segment is `.env`, or `.env.<suffix>` whose last suffix is not `example`, `sample` or
  `template` (so `.env.local.example` is a template);
- any segment is `.npmrc`, `.netrc`, an SSH key (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, with
  an optional `_sk` and any suffix), or ends in `.pem`, `.key`, `.pfx` or `.p12`;
- any segment is a `credentials.*`, `secret.*` or `secrets.*` data file (JSON, JSONC, JSON5, YAML,
  XML, TOML, INI, properties, `.env`, `.conf`, `.cfg` or `.txt`), unless the suffix before the
  format is `example`, `sample` or `template`;
- the final segment of a file or link is exactly `credentials`, `secret` or `secrets`.

Code modules (`credentials.ts`, `secret.ts`), a `credentials/` feature directory, templates and
documentation such as `secrets.md` are source.

Some choices go slightly beyond the reviewed list:

- A `secrets/` directory stays excluded. It is the Docker secrets convention, and it was excluded
  before.
- Extensionless `credentials` and `secret(s)` files stay excluded, because the shared AWS
  credentials file has no extension.
- Data formats other than JSON, YAML and XML (TOML, INI, properties, `.env`, `.conf`, `.cfg` and
  `.txt`), and the singular `secret.*`, are read as the same "style" of data file. The old rule
  excluded them too.
- The FIDO security-key variants `id_ecdsa_sk` and `id_ed25519_sk` are new exclusions.

## Files

| File | Change |
| --- | --- |
| `service/packages/shared/src/project-conventions.ts` | Optional per-category `count`, sample-size constant, documented `truncated` |
| `service/packages/shared/src/portal.ts` | Optional `count` on `PortalEvidenceSchema`; exclusion reason `generated-output` |
| `service/packages/mcp/src/profile/conventions.ts` | SA-1 sampling, exact counts, named unread inputs, line index |
| `service/packages/mcp/src/portal/recipes/core-source.ts` | Comment only |
| `service/packages/mcp/src/portal/service-graph.ts` | SA-2 text phases, hash-only members, aggregation, edge dedup, SVC-8 required-input issue |
| `service/packages/mcp/src/portal/service-connections.ts` | SA-3 hash check, `members`, configuration and dependency dedup |
| `service/packages/mcp/src/portal/source-path-policy.ts` | K24 names, generated output, kind-aware policy, path escaping |
| `service/packages/mcp/src/fs/repo-walk.ts` | Kind-aware exclusions; unsafe paths named, and the scan continues |
| `service/packages/mcp/src/portal/source-inventory.ts` | Issue paths named by the relative path being read |
| `service/capabilities/union-manifest.json` | Target contract hashes of `analyze_project`, `scan_components` and `icon_map` |
| Tests | See below |

The conventions schema is embedded in the results of `analyze_project`, `scan_components`,
`icon_map`, `component_map`, `token_map`, `portal_plan` and `portal_next`. Only the first three rows
were current before this change, so only those three hashes were refreshed. The other four were
already stale at `1da01f9`, together with 15 more rows; see item 3 under
[Changes needed in files this task does not own](#changes-needed-in-files-this-task-does-not-own).
The `PortalEvidenceSchema` and exclusion-reason changes do not reach any tool result schema.

## Tests

Written before the fixes. Every new or changed test failed against the unchanged code (16 tests in 5
files; the two direct walk tests were checked separately against the old `repo-walk.ts` and
`source-path-policy.ts`). All of them pass now.

| File | Tests |
| --- | --- |
| `core-source.characterization.test.ts` | SA-1 flipped: 33 imports give a 32-row sample with `count: 33` and no truncation, and 32 imports are the control at the sample size. Core preparation maps the 33-import source, while a file that cannot be parsed is named in `unreadFiles` and still blocks. A 200-file React application has exact per-category counts and a deterministic sample. The same application maps, and `map-design` is `ready` |
| `service-graph.characterization.test.ts` | SA-2 flipped: four lockfiles (including a 900 KB `package-lock.json`) are byte-bound and hash-only, and a lockfile change still changes the identity. Control: a 262,145-byte source file still raises `SOURCE_LIMIT:src/big.ts`, and 262,144 bytes are complete. A 900 KB lockfile plus 800 imports gives three evidence rows (one with `count: 800`) and 800 exact import edges. Control: 511 distinct packages fit in 512 rows, and 512 packages still raise `EVIDENCE_LIMIT`. Forty 250,000-byte data files plus a 600 KB imported data file: the sources get the budget, the rest is hash-only, and the import resolves |
| `service-graph.test.ts` | SA-3: a BOM-prefixed `package.json` and server source give a complete graph with the raw-byte hash and correct lines. SVC-8: imports of a checked-in `build/` and of `credentials.json` raise named `SOURCE_REQUIRED_INPUT_EXCLUDED` issues, and the control without imports is complete. SA-2: 30 `pg` imports give one `persists` row and one package row, each with `count: 30` |
| `service-connections.test.ts` | SA-3 BOM acceptance, with a double BOM, a bare BOM and unrelated bytes still refused; one configuration candidate for three alias imports; hash-only members as verified targets and the duplicate-path guard |
| `source-inventory.test.ts` | SVC-8: 6,000-file `dist/` plus `coverage/`, `.next/`, a nested `target/`, `__pycache__/` and `src/build/` are recorded, never opened, and fewer than 20 entries are scanned. The exclusion decision is hashed and generated bytes are not. An NFD file is then named as `src/cafe%CC%81.ts`, and every later file is still inventoried. K24: 21 credential paths are excluded and never opened; 10 ordinary paths are included. Escape unit test: 13 cases, all distinct and portable |
| `fs/repo-walk.test.ts` | Kind-aware exclusion (files named `build` and `out` are kept, and `Target/` is excluded case-insensitively); two unsafe entries are named and the scan continues |

Changed expectations in existing tests:

- `service-graph.test.ts`, "binds every nonexcluded source byte independently of semantic parse
  coverage": `build/index.js` and `dist/index.js` are no longer inventory members. They are recorded
  `generated-output` exclusions, so the test asserts that rebuilding `build/index.js` leaves the
  source identity unchanged and that removing `build/` changes it. Ignored, dot, vendor and test
  inputs stay byte-bound, as before.
- The two T06a characterization files assert the fixed behavior now. Their file names are unchanged,
  and the [T06a note](T06a-critical-reproductions.md) remains the record of the defect.

No other existing expectation changed.

## Verification

All commands ran from `service/` in the worktree `.worktrees/lane-d`, with:

```sh
export PATH="/c/Windows/System32:/c/2026_project/super-figma-pipline/.worktrees/_cache/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH='C:\2026_project\super-figma-pipline\.worktrees\_cache\ms-playwright'
export TEMP='C:\2026_project\super-figma-pipline\.worktrees\_cache\tmp'; export TMP="$TEMP"
export LOCALAPPDATA='C:\2026_project\super-figma-pipline\.worktrees\_cache\localappdata-ascii'
```

Host: Windows 11 Pro 10.0.26200, Node 24.21.0, pnpm 11.24.0, Vitest 4.1.11.

Focused suite, the scope named in the task:

```sh
node node_modules/vitest/vitest.mjs run \
  packages/mcp/test/portal/service-graph.test.ts \
  packages/mcp/test/portal/service-graph.characterization.test.ts \
  packages/mcp/test/portal/service-connections.test.ts \
  packages/mcp/test/portal/source-inventory.test.ts \
  packages/mcp/test/portal/module-resolution.test.ts \
  packages/mcp/test/portal/core-recipes.test.ts \
  packages/mcp/test/portal/core-source.characterization.test.ts \
  packages/mcp/test/profile \
  packages/mcp/test/fs/repo-walk.test.ts
```

| State | Result |
| --- | --- |
| `1da01f9`, before any change | 11 files: 213 passed, 1 skipped |
| Tests written, before the fixes | The five changed files: 16 failed, 47 passed, 1 skipped |
| `80ff0a8` (SA-1) | The SA-1 scope (`core-source.characterization`, `profile/*`, `core-recipes` and the CLI `project-inspector` test): 6 files, 130 passed |
| `bc606f4` (SA-2, SA-3) | 11 files: 221 passed, 1 skipped |
| `d6d7aec` (SVC-8, K24) | 11 files: 227 passed, 1 skipped |

The skipped test is the case-collision test, which is skipped on Windows.

Wider regression set: `coordinator`, `core-coordinator`, `consumption-input`, `source-authority`,
`capture-flow`, `mapping-consumers`, `scan`, `repo-icons`, `tokens/*`, `design-diff`,
`local-tool-boundary`, `operation-policy`, and the CLI `portal-commands` and `project-inspector`
tests (22 files, 382 tests).

- Before the change: 3 failures. `consumption-input` "refuses a changed declaration even if its
  signed container and declaration hash are valid" fails deterministically
  (`PORTAL_CONSUMPTION_CANDIDATE_CHANGED` instead of `DECLARATIONS_CHANGED`). Two other tests hit the
  5-second timeout under load.
- After `d6d7aec`: the same 3 tests fail in a combined run. Run alone, only the deterministic one
  fails, so this change introduces no new failure. That test belongs to the consumption lane.

`test/tool-contract.test.ts` fails with the same 5 tests before and after the change: 125 against
128 tools, and 19 target contract rows that were already stale at `1da01f9`. A scratch script
compared the stored hashes with the schemas before and after each commit. It found no new stale row.

Static checks after the last commit:

| Check | Result |
| --- | --- |
| `pnpm typecheck` (includes `typecheck:tools`) | Exit 0 |
| `pnpm exec oxlint --deny-warnings <changed files>` | Exit 0 |
| `pnpm exec oxfmt --check <changed files>` | All files formatted |

Protection limits: the worktree is a separate working copy, not a sandbox. It shares the Windows
user's filesystem privileges, processes and network with the rest of the machine. Test fixtures
were created under the ASCII `TEMP` above and removed by the tests. This task adds no process spawn.
Production paths exercised by the wider regression set may start the Windows directory-lease
broker, and those spawn sites pass `windowsHide: true`. No Docker, no network fetch and no
`pnpm test` run were used.

## Changes needed in files this task does not own

1. **`coordinator.ts`: return plan issues instead of throwing (SVC-8).**
   - `portal_next`: `next()` builds `sourceInventory` with `requirePortalInventory(profile)`, which
     throws `PORTAL_SOURCE_INVENTORY_INCOMPLETE` for an incomplete inventory. This happens, for
     example, when the inventory has one NFD file name. `evidence()` has the same calls.
     - Needed: list an incomplete profile with its `complete: false` state and its named inventory
       issues, or omit its file page, and keep the run in `needs-input`.
     - A file listing needs two new fields in `PortalNextResultSchema`, which changes the
       `portal_next` contract hash.
     - `requirePortalInventory` must stay strict for byte evidence, baselines and staging.
   - `portal_plan` with a live capture: `createPlan()` calls `recipes.preparePlan()`, and
     `prepareCoreRecipeSources` then throws `CORE_SOURCE_INVENTORY_INCOMPLETE`. Needed: skip core
     preparation when any profile inventory is incomplete, use
     `unavailableCoreBinding(requirementsHash, 'PORTAL_SOURCE_INVENTORY_INCOMPLETE')`, and keep the
     named `SOURCE_INVENTORY:<code>:<path>` graph issues in `plan.issues`.
   - `core-source.ts` keeps its throw on purpose. The existing test "full-root byte failures and
     canonical mapping discovery limits stay hard failures" requires it. The throw is also the
     correct guard: core recipes must never be prepared from an incomplete inventory. Without the
     coordinator guard, `core-lifecycle.ts` `assertSourcesCurrent` would throw
     `PORTAL_CORE_SOURCE_REQUIRED` in any case.
2. **`native-work.ts` (lane B) and `coordinator.ts` submissions.** Both call `isPortalSourcePath` on
   candidate files. That check now refuses paths inside generated-output directories, and it accepts
   `credentials.ts`, `secret.ts` and `.env.example`. No code change is needed, but tests that submit
   such paths must expect this.
3. **Tool contracts (lane B).** Regenerate `capabilities/union-manifest.json` after merging, because
   the conventions schema changes the `portal_plan` and `portal_next` result contracts. Those rows
   were already stale.
   - `scripts/update-target-contracts.mjs` fails under plain Node 24.21 with
     `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (parameter properties in `shared/src/progress.ts`). My
     scratch comparison ran with `node --experimental-transform-types`.
   - If lane B regenerates the manifest first, the three rows changed here conflict; rerun the
     generator to resolve them.
4. **`module-resolution.ts` (T28).** Package entry points (`main`, `exports`) and `tsconfig` paths
   that point into a generated-output directory are reported only as `MODULE_UNRESOLVED`. T28's
   reviewable `BUILD_OUTPUT_MISSING` should name them. Only relative imports get
   `SOURCE_REQUIRED_INPUT_EXCLUDED`.

## Limitations and open items

- The conventions analysis still reads at most 512 files and 8,000,000 bytes. A larger frontend is
  now blocked explicitly (`DISCOVERY_LIMIT` or `SOURCE_SIZE_LIMIT` in `unreadFiles`) rather than
  silently. Raising the cap would need the reader byte budgets reviewed with it.
- Service evidence is still capped at 512 distinct rows per service. Aggregation removes repetition,
  not distinct facts, so more than about 510 distinct packages, routes, tables or migration files in
  one service still raise the hard `EVIDENCE_LIMIT`.
- Generated-output detection is name-based. A source directory named `build`, `out`, `target` or
  `coverage` at any depth is excluded. Imports of it by relative path are reported. References that
  are not imports, such as `node build/build.js` in a package script or a tool configuration that
  reads a generated directory, are not detected.
- `REPO_SOURCE_PATH_COLLISION` and `REPO_SOURCE_ENTRY_UNSUPPORTED` still stop the scan, as before;
  only unsafe paths continue.
- An NFD file name still makes the inventory incomplete. This is by design, because portable paths
  are NFC; it may affect NFD-named files created on macOS.
- The inventory `policyVersion` stays `portal-source-v1`, because the exclusion decisions are
  hashed.
  - Existing plans whose trees contain a generated-output directory, a lockfile or an affected
    credential name get a different inventory or source hash after this change, and they must be
    planned again. Aggregated evidence also changes graph hashes.
  - Unaffected trees keep their inventory hash.
  - If every policy change must invalidate every plan, bump the policy version.
- Names outside the reviewed lists stay as they were:
  - `.envrc`, `.git-credentials`, `.pypirc`, `.docker/config.json`, `.kube/config` and
    service-account JSON keys are still included, as before;
  - `.output` (Nuxt 3), `.parcel-cache`, `.angular`, `storybook-static` and `.gradle` are not yet
    generated-output directories.

  These are candidates for a reviewed follow-up.
- The tests ran on Windows (NTFS). Colons, reserved names and control characters cannot be file
  names there, so those escape cases are covered by the unit test of `escapePortalSourcePath`, not by
  real files.
