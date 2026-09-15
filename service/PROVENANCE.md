# Source provenance

## Current implementation status (2026-09-07)

The current service registers 116 canonical tools and 106 plugin handlers, including four
safe-union additions. IR, CLI, snapshots, grounding graphs, authenticated execution and local
packaging are implemented. The Task 1/2 baseline descriptions below are historical provenance,
not the current feature-availability catalog.

All 112 original Figwright and 73 original Rust tool names are represented, but name coverage
does not establish behavioral parity, workflow integration or live verification. The Figmosha
feature map records related primitives and pending helper recipes; it does not install the
original helper globals or CLI parser aliases. The independent 2026-09-07 audits under the
repository's `docs/reviews/` record those distinctions and prioritized adoption work.

Paint-style token export was adopted on 2026-09-07 by combining Rust export behavior with the
existing Figwright-derived paint-token converter. Its targeted regression tests preserve
variable modes, paint definitions, opacity and collision handling. This change is not evidence
that every original upstream feature or the new portal orchestration has been completed.

Super Figma Pipeline is a standalone service. Runtime packages, skills, and package scripts do not
read the local upstream checkouts. Reproduction uses the development-only vendoring and lock
verification scripts. Offline verification is available now; Task 15 wires it into the release
verification and artifact pipeline.

## Pinned upstreams

| Upstream       | Commit                                     | License copy                      | Role in this baseline                                                               |
| -------------- | ------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| Figwright      | `a835e81b575eab2c9265a67f9353c89b848f81ca` | `licenses/figwright-LICENSE`      | Canonical shared, MCP, plugin, skill, and cross-package test trees                  |
| figma-mcp-rust | `6094566436577b29d04393c774d51492c12671e1` | `licenses/figma-mcp-rust-LICENSE` | Behavior reference only; no Rust source is copied in Task 2                         |
| figmosha2      | `547cefb4c90abaa1da68db5455b921cbf3f8a5b9` | `licenses/figmosha2-LICENSE`      | Behavior reference only; no Python, JavaScript, or asset source is copied in Task 2 |

The service itself is distributed under `LICENSE`. All three upstream license files above are exact
copies of the corresponding pinned Git blobs.

## Figwright source vendoring

`vendor-rules.json` is the copy boundary. `vendor-map.json` expands every matching tracked file and
records its mode, pinned source path, origin commit, source SHA-256, materialized SHA-256 when
applicable, and MIT license identifier. The frozen Task 2A vendor-map SHA-256 is
`844d2d2dda27e8473538f262447cf1d0bd01a4657b3f2a6cf951dd0dd3df28a2`.

Copy-mode files retain the pinned Git-blob bytes except for syntax-aware runtime module-specifier
changes from the three Figwright package namespaces to the corresponding `@sfp` package namespaces.
Only code files with such a rewrite are normalized by the pinned oxfmt configuration. Their map rows
record `package-specifier-rewrite` and `oxfmt-normalize`; unchanged copy-mode files remain exact Git
blob bytes and record no transformations. Protocol tags, comments, fixtures, and user guidance are
not rewritten; the remaining raw strings are enumerated in
`vendor-allowed-figwright-strings.json`. Root package and lock files, workspace package manifests,
build/test configuration, and the plugin manifest remain service authorities. Only dependency,
development-dependency, and non-release package-script inputs are merged into service manifests.
Upstream-only `clean`, `postinstall`, and `release` script inputs are excluded, so the Windows service
does not advertise the POSIX clean command and no skills-sync mirror is required. A pre-existing
service-owned lifecycle script is preserved and protected instead of being treated as an upstream
contribution.

Vendoring is closed-world. Before replacing the map, copy mode reconciles previous copy rows: an
obsolete destination is deleted only when its bytes still match the previous `currentSha256`; a
local modification fails with `VENDOR_STALE_MODIFIED` before any map or destination change. Offline
and upstream-backed verification enumerate every managed destination root and accept only current
vendor-map destinations or explicitly registered service-owned files. The lock also hashes the
workspace lock/config/hygiene files and records normalized root/package authority projections. Every
package projection includes exact `dependencies`, `devDependencies`, `optionalDependencies`, and
`peerDependencies`, with `null` recording an absent field; an intentional package change must update
the authority record in the same change.

The shared package `exports` map is an explicit service-owned integration authority. It is the
minimal entrypoint required for real workspace resolution of `@sfp/shared`; vendoring and offline
verification protect it from upstream replacement or local drift.

The root `README.md` and `packages/mcp/README.md` are copied as fixtures for the upstream docs-sync
tests. They temporarily retain upstream product language; Task 14 replaces them with service-specific
documentation before release. They add no runtime behavior.

## Service-only package scaffolding (Task 1/2 history)

The original `packages/ir/src/index.ts` and `packages/cli/src/index.ts` were service-authored empty
entrypoints used to type-check the Task 1 workspace. They have since been replaced by the IR and
CLI implementations. Their initial placeholders were not upstream feature implementations.

## Behavior-only attribution

The following pinned paths inform later service work. They are not copied into this Task 2 source
baseline.

### figma-mcp-rust

- `plugin/src/read-styles.ts:181-267` — deterministic token JSON and CSS semantics.
- `plugin/src/read-export.ts:62-85` — per-node export collection behavior.
- `src/tools/special.rs:293-375` — ordered PDF export behavior.
- `src/pdf.rs` — PDF merge behavior.
- `src/bridge.rs:27-29,280-301` — progress extends an idle deadline but not an absolute deadline.

The project identifies itself as a Rust port of `vkhanhqui/figma-mcp-go` and credits that Go project
for the original design, Figma plugin bridge, and tool catalogue. Its MIT license separately credits
vkhanhqui for the original Go implementation and alvinindra for the Rust port. Those notices are
preserved in `licenses/figma-mcp-rust-LICENSE`.

### figmosha2

- `figmosha.py:137-179` — doctor stages and diagnostic guidance.
- `bridge.py:72-109` — bridge error guidance.
- `plugin/code.js:52-79,96-200,233-315` — helper, target, font, frame, and library-variable behavior.
- `tests/helpers.test.js` — helper and target behavior tests.

The Solar icon asset at `plugin/icon.png` is identified by the upstream changelog as CC BY 4.0. It is
deliberately excluded; no Solar asset is copied or distributed by this service. The figmosha raw
evaluator and ambient globals are also excluded.

## Deliberate exclusions

Rust server/election code, the Rust partial serializer, unauthenticated endpoint behavior, lexical
path checking, the figmosha raw evaluator/globals, Solar assets, generated output, dependencies,
coverage, and TypeScript build-info files are not vendored. Safe-union tools are not registered in
this baseline; the advertised surface remains exactly 112 tools, 105 plugin handlers, and seven
server-only tools.
