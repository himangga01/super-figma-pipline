# Web portal distribution wiring

Date: October 11, 2026 (Asia/Seoul), frozen implementation at 19:00 KST.

## Scope and baseline

The service's new login-free local portal hosts a workflow canvas and a same-origin backend, using the existing CLI's public `ControlClient` to reach the private service. This increment makes that frontend/backend distributable alongside the existing MCP, CLI and Figma plugin archives. It does not implement or accept Figma acquisition, generation, guarded application or a complete portal workflow.

Implementation is in the managed checkout `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`, whose Git HEAD is `22517932dc9b2cb974c177ec4eacb84d4b16e254` with the coordinator's uncommitted portal work. This is a six-file scoped snapshot, not a whole-service fingerprint. The existing release scripts emitted three archives. New portal source and a managed build were present, but actual distribution acceptance was intentionally left to a fresh coordinator-owned native build and packaging run. Reuse the [portal plan](../../plans/2026-10-11-service-web-portal.md), [backend evidence](backend.md), [frontend evidence](frontend.md), [independent review](review.md) and [canonical service analysis](../../service-analysis.md). Shared analysis policy and project instructions were read before implementation; no Superpowers skill was used for this task.

Approved ownership is limited to `scripts/package-artifacts.mjs`, `scripts/verify-artifacts.mjs`, `scripts/generate-checksums.mjs`, `test/artifact-contents.test.ts`, `test/package-artifacts-hermetic.test.ts` and new `test/portal-artifact-startup.test.ts`. Root package/lock/knip files, portal source, generated metadata, AGENTS, main/native service source, dependency junctions and Git indexes were not edited by this worker.

## Implemented distribution

`portal.tgz` is a **fourth archive**, using the same deterministic staging/Git archive pattern as MCP and CLI. Existing `mcp.tgz`, `cli.tgz` and `plugin.zip` remain. The artifact manifest records all four archives and every file hash; the exact sorted checksum set now includes `portal.tgz`.

The portal archive includes its built `dist`, package metadata, shared release/license/provenance/SBOM/capability documents and public flat `web` assets. Packaging selects the filename and HTML/CSS/JS/SVG shape supported by the actual static server, excludes web test/spec files and nested test directories, and excludes source maps as before. Verification requires the current five public assets and the actual server entry. It checks all archived file bytes before startup.

The portal retains a runtime dependency on `@sfp/cli`; the staged selector is the **actual CLI package version**, rather than `workspace:*` or the portal's potentially different version. Bundled shared/IR selectors are removed using the existing release pattern. The CLI must provide its real public `./dist/library.mjs` export and `ControlClient`, while retaining its matching MCP dependency. Portal startup resolves that public CLI entry, not a repository-relative private implementation.

The coordinator owns the portal manifest changes. Required source metadata was reported: MIT license, distributable `dist`/`web`/release document files, Node 24 compatibility declaration for the current build, and the existing source workspace dependency on CLI. Root README/start-command documentation and final version policy also remain coordinator-owned. Package manifests and generated SBOM/notices were not changed here. The existing SBOM generator already traverses recursive production dependencies of every installed workspace; it includes portal once the coordinator's frozen lock/importer/dependency installation is current. Fresh SBOM/notices/checksums are still required before final release acceptance.

## Actual runtime verification path

`verify-artifacts.mjs` verifies all archive/checksum/file receipts, then prepares a new temporary runtime:

1. Copy **extracted** MCP, CLI and portal packages into a separate `node_modules/@sfp` tree. Validate identities, portal/CLI/MCP version bindings and the public entry contracts. Repository source and workspace links do not supply these three packages.
2. Resolve each package's declared third-party dependencies from its builder-owned installation and link them only under the corresponding extracted package. No install, rebuild, lifecycle hook or network acquisition runs. These links are read only by the smoke operation; they are writable filesystem aliases under the owner account, not enforced read-only mounts or a sandbox. This verifies portable application packages with installed runtime dependencies, not dependency-free or offline-vendored distribution.
3. Start the real portal entry in a fresh Node process, with a clean bounded environment, private disposable portal/service state roots, loopback listener and an owned synthetic control endpoint that returns HTTP 503. Preflight requires the extracted public CLI library to export a real `ControlClient`. No owner daemon credentials, live daemon, source Chrome or external service is accessed.
4. Fetch the portal and every packaged web asset over HTTP and compare its exact bytes/hash to the archive receipt. Fetch `/api/bootstrap` and require an honest `service.available:false` response. Startup has a bounded deadline. Generation and service availability are not invented.
5. Terminate only the owned process and confirm its exit before reporting success. Close the synthetic endpoint and remove the allocated temporary runtime/extraction tree. An unconfirmed stop remains a failure.

The actual archive-content test expects four archives **and** successful portable startup. It runs after the coordinator's fresh build/package/checksum gates. The new ordinary startup regression uses an independent synthetic packaging fixture and never depends on previously generated project archives. This matches the whole-check order: build, ordinary tests, package/checksum/verification, then later smoke gates.

## Executed fixture verification

The first added fourth-archive assertion failed against the original packager on October 11 at 18:52:36 KST: one case passed and one failed because `portal.tgz` was absent. The private RED receipt is `portal-packaging-red.json`.

The final unchanged implementation was checked at **19:00:07 KST**:

| Check | Result and actual meaning |
| --- | --- |
| Existing hermetic packaging fixture | **2/2 passed**. All four archives stay byte-identical under hostile Git configuration; no external hooks/signers run and the decoy repository remains unchanged. |
| New independent startup fixtures | **3/3 passed**. Packaged fixture server starts with extracted CLI/MCP and all five assets; matching receipts cannot hide a missing CSS asset; a CLI without public `ControlClient` cannot start the portal. The fixture deliberately uses portal `0.7.0` versus CLI/MCP `0.3.0` to exercise the actual CLI-version binding. |
| Full tools TypeScript check | `tsc --noEmit -p tsconfig.tools.json` passed. |
| Scoped lint/format | `oxlint --deny-warnings` and `oxfmt --check` passed on all six owned files. |

Private test config and reports live outside service source at `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/.task-evidence/`, including `artifact-vitest.mjs`, `portal-packaging-focused.json` and `portal-packaging-frozen.json`. The config selects only the two fixture files, disables cache and uses one worker. Tests execute direct installed native binaries, not package-manager installation/build commands:

```powershell
# Managed service working directory
node node_modules/vitest/vitest.mjs run --config ../.task-evidence/artifact-vitest.mjs --configLoader native --no-cache --maxWorkers 1 test/package-artifacts-hermetic.test.ts test/portal-artifact-startup.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.tools.json
```

Intermediate checking found JS type annotations/callback inference and cleanup-lint issues in the new runtime verifier; these were repaired before the final frozen run. Initial fixture/server entries are synthetic test data, not the actual portal build. **These five passes do not count as the owner's third actual portal/backend verification round.** That round remains pending until the coordinator integrates these files, rebuilds the actual package/library/metadata and executes artifact packaging/checksums/verification against fresh actual deliverables. No actual archive-content pass is claimed by this worker at this snapshot.

## Frozen file hashes and remaining gates

| Managed-service file | SHA-256 |
| --- | --- |
| `scripts/package-artifacts.mjs` | `370ddd10917125df1ba8a83a3136ec97fbd594d04437b462c3290c3014825f27` |
| `scripts/verify-artifacts.mjs` | `8b1b3b3b1717dac547cc15fede9b9e5f12a02e35561235146476101f74edd0df` |
| `scripts/generate-checksums.mjs` | `19d5d0d0cc962f1a6d06cca3a3a79b1d851137414a9d094379f3d17d87494e83` |
| `test/artifact-contents.test.ts` | `d81e57e7b59fb479c03b7647dcf7d5065fbce962f416131a553f20e49d49fbff` |
| `test/package-artifacts-hermetic.test.ts` | `929b79e8ad891f678f1d9ef42ca619e4ce789ee44feb0f5a7b353aaa48985adc` |
| `test/portal-artifact-startup.test.ts` | `0a57ddffc549efcb657e8589c9902d069491e8efa5cc5d06110bb3a34c85b7bc` |

Independent review is pending at this snapshot. The coordinator must retain the latest portal concurrency repair and CLI public-library build, integrate packaging, regenerate release metadata under the established source epoch, execute the actual artifact/runtime round and renew whole-source/artifact acceptance. Missing builder dependencies, stale/broken CLI exports, absent assets, invalid version bindings, corrupt receipts and failed/unknown startup or cleanup must remain failures. This bounded packaging smoke does not establish a complete workflow, live Figma capture, source/design freshness, coding-agent output, guarded application or frontend acceptance. No additional product decision is required for this packaging increment; broader hosting/dependency vendoring is not assumed.
