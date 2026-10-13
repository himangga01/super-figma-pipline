# Screened sample generated-input preparation

Date: October 11, 2026, updated at 15:01 KST (Asia/Seoul). Status: the bounded generated-input preparation is complete; both service analyses remain incomplete, with no application or portal acceptance.

This record supplements [module support](sample-module-support.md), [the continuation record](README.md) and the canonical [service analysis](../../service-analysis.md). The [malware screening report](../../analysis/oss-samples-malware-review.md), the shared analysis policy and [repository instructions](../../../AGENTS.md) were read before execution. The coordinator authorized bounded preparation in private sample copies and explicitly prohibited further service source edits, aggregate setup/deploy scripts, production data, external service calls, Docker, user Chrome control and daemon changes.

## Sources and owned destinations

- C2: pinned Epic Stack commit `64ca647630e15f71e6782b622ab0112c4b428f1f`; owned working source `.worktrees/_cache/portal-case-samples-20261010/epic-legacy`. It already contains synthetic local settings and the previously recorded loopback listener adaptation. The application remains unstarted.
- C3: pinned React Router templates commit `067adb378a00a4c2ceb71934d5e8901d0e87c256`; original reference `.worktrees/_cache/oss-samples-20261010/react-router-templates`. A separate owned workspace is prepared at `.worktrees/_cache/portal-case-samples-20261010/react-router-owned`; the selected application root is its `node-custom-server` directory. All 80 original tracked reference source hashes were rechecked unchanged after preparation.
- Native toolchain: Node `v24.21.0`. C2 declares Node `^22.18.0`; the successful individual generation commands do not establish whole-application compatibility with Node 24. Installed C2 React Router CLI is `7.16.0`, Prisma CLI/client is `6.19.2` and icon plugin is `3.0.1`. Installed C3 React Router CLI is `8.4.0`; its own package requires Node `>=22.22.0`.
- No service source file, manifest, provenance authority, owner index or daemon is modified by this preparation worker. The service module resolver supplied for re-evaluation is separately bound by its hash in the analysis results.

## Dependency reuse and command review

C2's owned source initially had no `node_modules`; its already screened dependency bytes existed only under the pinned Epic reference. The private `copy-screened-dependencies.mjs` copied those bytes into the owned C2 tree, then compared complete before/after file hashes and relative symbolic-link targets. It also copied the React Router reference workspace, including its screened pnpm store and relative dependency links, into the separate C3 workspace without `.git`. No install hook or new package download was used by copying. Windows per-file inspection took several minutes; both complete comparisons passed before any sample generation command ran.

| Copy | Verified result |
| --- | --- |
| C2 dependencies, completed at 14:47:23 KST | 46,751 members; 623,161,140 bytes; no symbolic links; inventory SHA-256 `78fa54a5517aa817803e173472ff635bd4cabaaf86e2ce81308805cdee43e59b`. Original and owned bytes matched. |
| C3 workspace/dependencies, completed at 14:48:59 KST | 8,967 members; 272,759,636 bytes; 670 relative symbolic links contained within the workspace; inventory SHA-256 `fcf5e416a69f08c7cf5a0d32a655c890e3a225ff84653f53b1da9504a0258918`. Original and owned bytes/link targets matched. |

The following installed source entry points and settings were reviewed:

| Entry point/input | SHA-256 | Reviewed behavior |
| --- | --- | --- |
| C2 `@react-router/dev/dist/cli/index.js` | `9744db9ad93e14e0c01d24f5090f5ea0372fcbc4f2168185dc1a818add5616d4` | Nonwatch type generation resolves local Vite/React Router configuration and routes, writes generated types and closes its configuration loader. The Vite configuration and its plugin imports therefore execute; this is broader than reading route filenames. |
| C2 `vite-plugin-icons-spritesheet/dist/index.mjs` | `e92f5d991da1bce685451510670975330b45f22f58abb651aedcd8fe3b56c5e2` | Its exported plugin `buildStart` reads SVG inputs and writes a sprite and type list. With no formatter configured, the package's optional formatter subprocess path is unused. |
| C2 `prisma/build/index.js` | `69a2bd6412521259b90c653aff9822b6d2fc63a17f9c46d46d07d319ea0dbb3e` | Selected local `migrate deploy` and `generate --sql` commands use the schema and installed client generator. Engine auto-download must be prevented until the exact engine bytes have been separately checked. |
| C2 `prisma/schema.prisma` | `63fff7c5393a4e3ec61cb4ce911efab79b3beafb2969d788d241ffb7eca1b606` | SQLite datasource and `prisma-client-js` generator with `typedSql`; datasource URL will point to a new owned disposable database. |
| C2 initial migration SQL | `53a87ed0dd1ca97af0f0089da47c04587f7470a153676642e03b4be8306153ac` | Creates the sample tables/indexes and static roles/permissions. No upstream `prisma/seed.ts` or application test-global-setup reset is requested. |

C2's aggregate `setup` includes application build, database migration/generation and Playwright browser installation; it is not executed. Its initializer, deployment, dev/start, test reset and blanket package rebuild commands are not executed. The local route configuration uses the reviewed `react-router-auto-routes` filesystem enumeration. C3's route configuration lists `routes/home.tsx` directly. Sentry upload/build hooks require production mode and a token; selected preparation commands use development mode and a clean environment without real service tokens.

The private runner used a minimal child environment, disabled package-manager lifecycle hooks, synthetic C2 settings, an explicitly owned SQLite URL, a 90-second command budget and a Node preload that rejects nonloopback JavaScript network connections and pins default JavaScript listeners to loopback. It did not inherit ambient cloud credentials. No application server was requested. No denied external-request or JavaScript listener events were recorded for these commands. This guard is not an operating-system sandbox or a packet capture, and does not establish behavior of every native library code path.

## Newly acquired Prisma engines

Install hooks had been disabled during the earlier screened dependency install, so native Prisma engines were absent. The exact installed `@prisma/engines-version` descriptor pins engine commit `c2990dca591cba766e3b7ef5d9e8a84796e47ab7`, package version `7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7`. The installed `@prisma/engines` dependency declares that descriptor; no engine version was guessed from the CLI version string.

The private downloader fetched both artifacts and their compressed/uncompressed `.sha256` files through HTTPS from `https://binaries.prisma.sh/all_commits/<engine-commit>/windows/`. Both checksum forms match. Artifact paths and complete acquisition records are under `.worktrees/_cache/portal-case-samples-20261010/generated-preparation/prisma-engines-c2990dca591cba766e3b7ef5d9e8a84796e47ab7`.

| Artifact | Result |
| --- | --- |
| `schema-engine.exe` | 18,974,720 bytes; uncompressed SHA-256 `f2b48e3ce8de8712c9dce6c71f952bec383fa472830b91bca8e64b4b51bf0dd7`; compressed SHA-256 `486aa375bd3eee91d5a4142697205c2f7c9e92e5e430b5090e96b47e2887c63d`. |
| Query-engine Node library | Downloaded using the installed platform mapping's URL name `query_engine.dll.node.gz`, stored as `query_engine-windows.dll.node`; 21,182,976 bytes; uncompressed SHA-256 `263946105f428384d2318dc3241b85b1c3dd98fbb1bfac62d3e81f513ab35897`; compressed SHA-256 `522970031d396a8041c651dafc9503bc4644c20b51127d2f353bedc62eddc819`. |
| Defender custom scan | Exit 0, reported no threats before engine use. Antivirus and real-time protection were enabled; signature version `1.459.660.0`. Remediation was disabled. Scan logs and the pre-execution hash-bound `admission.json` are retained privately. The runner rehashed admitted bytes immediately before each Prisma command. |

The first `node .../download-prisma-engines.mjs` attempt successfully verified/stored the schema engine, then exited 1 with this exact error:

```text
Error: Artifact download failed: 404: https://binaries.prisma.sh/all_commits/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/windows/query_engine-windows.dll.node.gz
```

Inspection of installed `@prisma/get-platform/dist/chunk-2U36ISZO.js` confirmed that URL names use `query_engine.dll.node` while filesystem names include the platform suffix. The corrected second `node .../download-prisma-engines.mjs` attempt exited 0, reused the known schema bytes only after matching their hashes, downloaded the proper query-engine artifact and completed verification. No failed download was counted as successful and no unscanned engine ran. Successful local migration and SQL/client generation demonstrate the exercised native preparation paths on Node 24; application query-engine/runtime compatibility remains untested.

The checksum files bind transport/content to the named publisher endpoint, and Defender found no threat in this scan. These checks are bounded evidence; they do not prove all native code paths harmless.

## Executed preparation

The following commands ran through `run-reviewed-generation.mjs`, with the clean environment and reviewed settings above. All four exited normally within their 90-second budgets, with no timeout or output overflow. Private JSON receipts and stdout/stderr logs are under `.worktrees/_cache/portal-case-samples-20261010/generated-preparation`.

| Task | Exact local command | Result |
| --- | --- | --- |
| C2 route/icon inputs | `node node_modules/@react-router/dev/bin.js typegen --mode development` | Exit 0 at 14:49:59 KST, 9,206 ms. Produced 52 route/type registration files and invoked the reviewed icon plugin hook, generating the real sprite and icon type list. The separately prepared `generate-epic-icons.mjs` was not run because typegen already produced those outputs. React Router future-flag warnings remain in the logs. |
| C3 route inputs | `node node_modules/@react-router/dev/bin.cjs typegen --mode development` | Exit 0 at 14:50:21 KST, 677 ms, in the new owned C3 application. Produced four route/type registration files. |
| C2 disposable schema | `node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma` | Exit 0 at 14:50:30 KST, 9,167 ms. Created the previously absent owned `.cache/generated-preparation.db` and applied `20250221233640_init`. `DATABASE_URL` and both engine paths were explicit child settings. No reset/seed or production database was used. |
| C2 client/typed SQL | `node node_modules/prisma/build/index.js generate --sql --schema prisma/schema.prisma` | Exit 0 at 14:50:45 KST, 654 ms. Generated Prisma client 6.19.2 and `searchUsers` JavaScript/type declarations. Prisma's `package.json#prisma` deprecation warning remains in the logs. |

The existing C2 `.env` was preserved and still names its earlier `.cache/sample.db`. Preparation deliberately used a different owned disposable database. Later application startup must explicitly bind the prepared database or separately prepare the intended runtime database; this execution did not migrate the earlier file or establish the application's database configuration.

At 15:01 KST, all four tracked Node command PIDs were absent, and no executable under the owned preparation root remained running. The daemon was not changed, no browser opened and neither application server started.

## Generated evidence and service source re-evaluation

Private full artifact inventories and graphs are under `.worktrees/_cache/portal-case-samples-20261010/graph-preparation-generated`. The [durable service results](sample-graphs-generated.json) bind the actual module resolver hash `sha256:76d9e47741e7c5cb8c24415543b841b2fcbf45df22db6122601ed605a3e0b023`. The coordinator subsequently reported the integrated service frozen at `18525cdc...` for a running whole check; this worker did not execute or claim that check.

The existing service `RepoReader`/`analyzeServiceGraph` processed the real generated inputs at 14:52:14 KST, with no service source edits:

```powershell
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs ../../_cache/portal-case-samples-20261010/analyze-generated-inputs.mjs
```

This command ran from `.worktrees/baseline/service`. It checked every reread graph text member against its recorded SHA-256, bound the generated artifact inventories, and verified that the resolver file did not change during analysis.

| Sample | Before actual generation | After actual generation | Bound artifacts | Source-analysis status |
| --- | --- | --- | --- | --- |
| C2 | 58 issues | 6 issues; 334 analyzed text files | 83 members including 52 route/type files, icon outputs, Prisma client/SQL outputs and disposable DB; inventory SHA-256 `9d107cebe1462039e0746b1d8d88d7a0fa98715f3f3cf3f1d42c68167a4ad996` | Inventory complete; `incomplete:true`, `lexicalReviewable:false`. |
| C3 | 5 issues | 3 issues; 20 analyzed text files | Four route/type files; inventory SHA-256 `10ea9976932f55c698131c2cceee34f81104ba49e10aad4410a4943b864c1eec` | Inventory complete; `incomplete:true`, `lexicalReviewable:false`. |

C2's sprite hash is `2ca3cb899302f64c81a744bacefe2725ac77db7846077e79900785a5a596b9b9`, and icon type-list hash is `5f9f5c8a3bda03d3e5e5324bc5ee1669ae280415837b513e4099065691f83a62`. The generated query-engine library copy matches the pre-execution admitted/scanned hash exactly. `searchUsers.js` has SHA-256 `2aed39f48a70aa9696a2f9af33c9fbc64af8004d442266e7251313734ce52ac9`; its declaration has `76e71566c4cc14d10a89e39bcb2b8e48833b025e4304cac472519c8791b6091f`.

Supplemental read-only `node:sqlite` inspection of the owned database found 0 users, 0 notes, 2 roles, 16 permissions and 1 migration record. Its SHA-256 remained `7020c0bc1092fd46135f68a1336bc3b1dbafa68064f7f9adf1274c7b8db04403` after read-only inspection. This confirms disposable schema preparation, not seeded legacy-data or authentication acceptance. The generated client/SQL code is a provisioned dependency excluded from source inventory; the service's declared-external classification still does not prove its application runtime behavior.

## Exact remaining issues and continuation

C2 retains these six service issues:

1. `CONFIG_EXTENDS_UNSUPPORTED:tsconfig.json`: the array-valued external Epic TypeScript configuration remains unsupported by the service, even though it is installed.
2. `app/root.tsx:1026:loader-query-unsupported`: the configured source still imports `./styles/tailwind.css?url`; CSS loader-query handling is a service capability gap.
3. `app/routes/settings/profile/_layout.tsx:495:module-target-missing`: the source imports `./+types/_layout.tsx`, while the real generated file is `_layout.ts`. This is **not an absent generated input or confirmed sample source bug**. Installed TypeScript 5.9.3, using the actual parsed project options with no config diagnostics, resolves the `.tsx` specifier to the generated `.ts` file. The explicit `.ts` and extensionless variants resolve to the same target. These supplemental checks identify a service extension-substitution discrepancy; they do not override the failed service result. No sample import was changed and no fake `.tsx` file was created.
4. Two `virtual:react-router/server-build` references in `server/app.ts`, at offsets 439 and 541: bundler virtual-module semantics remain unsupported.
5. The nonliteral build import in `server/index.ts:5887`: generated production-build source/runtime evidence is still absent.

C3 retains three service issues: `react-router.config.ts:0:config-project-source-unassigned`, `server.js:1290:nonliteral-module` and `server/app.ts:294:unsupported-module-specifier`. Source configuration ownership and generated/virtual runtime entry points remain unresolved. Original reference configuration was not silently changed to force analysis success.

Both connection graphs retain the previously observed unproven middleware/receiver/provider/runtime semantics. Neither sample has completed portal generation, guarded application, API/data/auth checks or Chrome frontend acceptance. C3's reference template still lacks the complete required data/auth layers; preparing its route types does not add those behaviors.

Continue after the coordinator's source freeze/check settles: repair the observed service resolution gaps with new failing regressions and verified input evidence, review actual local build/provisioning semantics, bind the intended owned runtime database and meaningful test data, then run the complete applicable portal/runtime acceptance. Keep the source-generation commands and supplemental TypeScript/SQLite observations separate from service-owned acceptance. No fabricated file, ignored failure, parser waiver or historical pass may substitute for those gates.

## Bounded extension and CSS loader repair on October 11

Updated: 15:54 KST. The six/three-issue analysis above remains dated preparation evidence at resolver `76d9e477...`. The coordinator subsequently confirmed whole check `b61a1d7a-b4bd-4b5a-bc19-a189b72cfe9a` passed at integrated service `sha256:18525cdc247a1a314f02496edb563f0a0b629ca6f098aa554ae5e7f729bb2ee3`, with 4,894 passes, zero failures, 20 existing skips, all 39 required Chrome cases and the separate artifact case. That whole check does not cover the later source changes recorded here. The coordinator unfroze implementation and authorized only the bounded fixes below; application startup, browser interaction and external-config/virtual-build acceptance remained outside this worker's scope.

### Implementation plan and delivered scope

**Goal:** Close the reproduced supplied-source `.tsx` to `.ts` discrepancy and configured plain Vite CSS `?url` discrepancy without resolving absent inputs or unknown configuration/loaders.

**Architecture:** Retain the pure source-map/inventory resolver. Add an explicitly enabled compiler fallback to its file lookup, and a source-bound Vite CSS URL branch with syntax/ownership checks. Existing source context and CSS dependency analysis continue to reject unknown inputs. No source configuration or repository code is executed by the resolver.

**Tech stack:** TypeScript, `oxc-parser`, the existing `PortalModuleReference`/`Resolution` structures and Vitest.

**Spec and constraints:** The coordinator's bounded directive is implemented against the reproduced primary-tool behavior and sample inputs recorded in this file. The minimal proposed scope was sent before source edits. Modify only `packages/mcp/src/portal/module-resolution.ts` and `packages/mcp/test/portal/module-resolution.test.ts` in `.worktrees/baseline/service`; no package/contract/provenance/browser edits, application startup, commits, push or owner-index update. Further execution/integration follows the project's Superpowers execution/review workflow and the coordinator's freeze, rather than creating another independent implementation agent.

- [x] Establish primary compiler/bundler behavior through installed screened tools and private synthetic fixtures.
- [x] Write failing module-resolution fixtures, run them RED, implement the narrow behavior and verify GREEN.
- [x] Pin unreadable/exact/case/configuration ambiguity and unknown loader/configuration cases with retained regressions.
- [x] Rerun the related five-file suite, scoped lint/format and actual service source analysis.
- [ ] Obtain the coordinator's independent review, integrate the frozen files, reconcile provenance and rerun whole-source gates after all parallel source changes settle.

### Primary evidence

Installed TypeScript 5.9.3's `tryAddingExtensions` places `.tsx` ahead of `.ts` for a `.tsx` request, followed by declaration/JavaScript alternatives. A private in-memory host confirmed exact `.tsx` precedence, `.tsx` to `.ts` fallback, missing-input failure and additional `.d.ts`/`.jsx` substitutions. This patch intentionally does not implement the broader declaration/JavaScript substitution matrix.

Installed Vite 7.3.1 and 8.0.3 were each probed with `configFile:false`, `envFile:false`, no application plugins, `write:false` and private synthetic CSS/JavaScript inputs. Both produced a URL reference plus the real `body{color:red}` CSS asset for ordinary `style.css?url`. Both rejected `style.module.css?url` with `?url is not supported with CSS modules`. No server was created or application source configuration loaded for these probes. The first Vite 7 probe's unused exported URL was tree-shaken; the retained second probe used a compile-only global assignment to keep the URL/asset observable. Neither output was executed.

Private evidence is under `generated-preparation/compiler-css-url-probe*.json`. TypeScript library SHA-256 is `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`; Vite 7's inspected configuration/core bundle has `c5d2cb692f24bb9d9de7dbd0b86506f1dada18c362aaa7c5a05d460870ced734`. These primary-tool probes establish the inspected behaviors and are supplemental diagnostics, not service/browser acceptance.

### Implemented semantics and evidence bindings

The compiler fallback is enabled for relative/root-directory and TypeScript path/base resolution from TypeScript sources with a selected supplied configuration. It accepts verified `.ts` bytes when an exact `.tsx` input is absent, preserves exact `.tsx` precedence, and binds the selected configuration/root-directory files. An unreadable or case-aliased exact target cannot be replaced with another source or skipped for a later TSX alias alternative. Unassigned/ambiguous project contexts remain unresolved. Configless substitution and Node package-export/private-import target substitution were deliberately not added.

CSS support accepts only exact plain `.css?url` requests. It requires an inventory-bound owning manifest declaring an ordinary supported numeric Vite 7/8 selector, and an inventory/source-bound Vite configuration within that package. The configuration must export an object, an unmodified runtime-imported `defineConfig` object, or a supported synchronous callback returning one object. Callback blocks support variable declarations followed by one top-level object return. Syntax errors, type-only/reassigned helper bindings, asynchronous/multiple/conditional returns, getters, spreads, computed/prototype configuration fields and unsupported `root`/`resolve` declarations remain unaccepted. A compiler alias or local package replacing Vite cannot establish this core-loader binding. Syntactic configuration binding is cached within the supplied bounded source map; it is not a plugin runtime trace.

The branch retains manifest, Vite configuration, selected TypeScript configuration and underlying resolution evidence. It requires every resolved target to be supplied/readable ordinary CSS. Declared external stylesheet packages do not substitute for captured stylesheet bytes. CSS Modules, opaque/missing stylesheets, unknown/mixed query strings, unsupported Vite selectors, inherited package configuration and ambiguous/unassigned source contexts stay unresolved. Existing CSS import scanning remains active, and an unsupported inherited TypeScript configuration still keeps overall analysis incomplete. Source resolution does not assert that installed plugins, compiled URLs or application styling have passed runtime acceptance.

### Verification and frozen handoff

| Gate | Actual result |
| --- | --- |
| Initial `extension-css-red.json` | 72 passed, 6 failed on the frozen prior resolver. |
| Runtime-helper `extension-css-helper-red.json` | 79 passed, 2 failed before type-only helper rejection. |
| Source-bound `extension-css-source-bound-red.json` | 85 passed, 1 failed before unbound-manifest/unknown stylesheet enforcement. |
| Context `extension-css-context-red.json` | 86 passed, 3 failed before prototype/getter rejection and preserving an unreadable exact TSX alias choice. |
| Final module run, `extension-css-green.json` | 89 passed, zero failures/skips. |
| Frozen five-file run, `extension-css-related-frozen.json` | 154 passed, zero failures, one existing skip. Earlier related runs overlapped source refinement and are not claimed as unchanged-source verification. |
| Scoped `oxlint --deny-warnings` and `oxfmt --check` | Passed for both frozen owned files. One earlier lint warning from a shadowed test variable was corrected before these passing checks. |
| Latest complete MCP typecheck | Pending clean rerun after parallel fixture repair: the latest failure is `test/portal/page-api-fixture.ts:44`, passing `string \| undefined` to `string`. No owned resolver/test error was reported. The earlier concurrent CLI `window` diagnostic was repaired by the coordinator. |

The frozen implementation SHA-256 is `d639289cff625c2f3745c9f2a77ed253657ee245b81ac14f2c1372ac5c1c1dcb`; the frozen test file is `ee7aac2ab3ff64ab18d1f9d52acb53d86360828db2bb6d91ee753fe5dbd268fc`. Both paths remain in `.worktrees/baseline/service`, ready for coordinator review/integration. No further source edit is authorized by this handoff until that review is addressed.

At `2026-10-11T06:54:13.280Z`, the service analyzer reread the actual generated samples with this frozen resolver, verified source text hashes and checked the resolver hash before/after analysis. [Durable results](sample-graphs-extension-css.json) preserve the separate source epoch; private full graphs are in `graph-preparation-extension-css-frozen`.

| Sample | Prior generated-input analysis | Current frozen analysis | Remaining exact failures |
| --- | --- | --- | --- |
| C2 | 6 issues | 4 issues | External Epic config inheritance; two virtual server-build imports in `server/app.ts` at 439/541; nonliteral build import in `server/index.ts:5887`. |
| C3 | 3 issues | 3 issues | Unassigned `react-router.config.ts:0`; nonliteral build import in `server.js:1290`; virtual server build in `server/app.ts:294`. |

Both inventories remain complete and both analyses retain `incomplete:true`, `lexicalReviewable:false`, with unchanged underlying middleware/provider/runtime unknowns. Original C3 source hashes remain unchanged. This worker did not run a whole service check or count the earlier `18525cdc...` pass as covering this later source.

### Evidence required for the remaining capabilities

**External Epic TypeScript configuration.** The installed screened `@epic-web/config` is 1.21.3. Its inventory-verified package export maps `./typescript` to `./typescript.json`; that JSON has no further `extends`. Manifest SHA-256 is `eab005b492ef1a6650b533c6d720299657056149b360156e00c9c62495217656`, and configuration SHA-256 is `74cd5c5a43597f09658eb0e0ad6883ae90a8026f3755b39201720bbef7508445`. Actual package presence and a successful supplemental TypeScript read are insufficient for the current resolver API: its supplied source inventory deliberately excludes provisioned `node_modules`.

Resolving this needs a separately defined service-owned installed-package configuration evidence capture, bound to the source/lock fingerprint, resolved package version/integrity, owning package relationship, manifest/export mapping and captured JSONC bytes/hashes. It must preserve dependency/source authority distinctions, deny executable configuration/remote schema reads, revalidate file identities and aliases, and bound inheritance depth/count/bytes. Array-valued `extends` needs left-to-right precedence, config-relative origins and correct child override behavior. Do not copy package facts into ordinary repository source to manufacture inventory membership, waive missing inheritance or enable a general unchecked `node_modules` read in this patch.

**C3 configuration ownership.** Neither current referenced TypeScript project includes `react-router.config.ts`, although the actual React Router typegen loader processes it successfully. This is a framework configuration execution context outside the TypeScript program-root scopes, not established proof that upstream source is broken. Supporting it needs service-captured loader/configuration context, actual source/hash/root/package/version identity, declared or executed mode/conditions and authority for the transformed imports. It must preserve project ambiguity and cannot merely force the source into an arbitrary referenced project or default context.

**Virtual server builds.** `virtual:react-router/server-build` needs a genuine enabled React Router Vite plugin binding, version/config/mode/condition evidence, and service-owned compiler/build output or captured virtual-module bytes tied to the current source/route/type inputs. The generated bundle/manifest and transitive imports need integrity and freshness checks before they can establish source/runtime closure. A dummy export or successful typegen run cannot supply those facts.

**Nonliteral production builds.** Both entry points use an immutable `BUILD_PATH` string and branch on `NODE_ENV`. A bounded static constant evaluator could eventually recognize an unshadowed, unmutated literal binding, but recognizing the pathname alone would not provision the absent production build. Actual build outputs, module/manifest hashes and their bound input/source epoch are still required; generated-output exclusions must remain explicit. Development `ssrLoadModule` and Express mount/middleware behavior need separate implementation/runtime evidence. Before any future C3 startup, its owned `app.listen(PORT)` must be adapted to a verified loopback binding; the original reference remains unchanged.

**Full portal behavior.** Database/client preparation does not seed meaningful legacy user/note/auth data or bind the existing application `.env` to the prepared disposable database. C2 needs explicit owned runtime settings and data/auth preservation tests; C3 still needs the complete required API/data/auth layers. Native backend/data/auth and Chrome frontend acceptance remain separate coordinated gates.

## Independent review repairs at 16:22 KST

The [iteration-two review](iteration-two-review.md) reproduced two P1 defects at resolver `d639289c...`. Its native Vite 7 fixture redirected `style.css?url` through an inline pre-resolution plugin and emitted `other.css` with different CSS bytes, while the service incorrectly reported the original stylesheet as resolved. A second fixture used a plugin `config` hook to change alias behavior. Top-level exported-object binding was insufficient to establish the exact stylesheet. The earlier four-issue C2 result is preserved as dated evidence and superseded for current status below; a runtime-verification disclaimer did not make that incorrect reference target valid.

The other defect was a TypeScript `baseUrl` `.tsx` import whose selected `.ts` fallback was an inventory member without captured text. The service discarded that compiler evidence gap and reported a same-name declared package as external. The installed TypeScript oracle confirmed the local `.ts` selection. These findings were checked against current code before repair; no sample source or broader runtime/configuration policy was changed.

The new regression run, `extension-css-review-red.json`, had **89 passes and 5 failures**, covering unavailable/case-mismatched base-URL targets and inline resolution/config hooks plus unknown call/identifier plugin options. The repaired resolver:

- Accepts core CSS URL binding only when `plugins` is absent or a literal empty array. Every enabled or unproven plugin value remains unresolved until separately bound interception evidence exists. It does not guess another stylesheet, suppress the gap or whitelist Epic's active plugins by name.
- Preserves unreadable/case-mismatched `.tsx` compiler fallback results in the base-URL branch before package fallback. A genuinely missing compiler path can still proceed through the existing declaration lookup, while a readable selected `.ts` remains resolved with its TypeScript configuration evidence.

Frozen verification after the repair:

| Gate | Actual result |
| --- | --- |
| Focused module-resolution file | **94 passed**, zero failures/skips. |
| Related five-file suite, `extension-css-review-related.json` | **159 passed**, zero failures, one existing skip. |
| Complete `pnpm --filter @sfp/mcp typecheck` | Passed after the parallel fixture changes settled. |
| Scoped lint/format | Passed for the two owned files. |
| Source/sample mutation | Only the two owned native resolver/test files changed. No sample, browser, main-copy or runtime-policy edits; no application startup, whole-suite or provenance/index operation. |

Frozen native paths are unchanged. New resolver SHA-256 is `8c00795ce9aa6fb6aa4bf87e592df039b0ea28b42703527a38608414d0c8ebdb`; test SHA-256 is `92967d1c37b351fa6218379007400bd6dca693f8906ac4322a8c1bff12c1ff38`. The independent reviewer received both hashes for rechecking; review/integration and a new whole-source checkpoint remain coordinator work.

At `2026-10-11T07:22:10.120Z`, the service source-analysis helper reprocessed both actual generated samples with this resolver. [Current durable results](sample-graphs-extension-css-reviewed.json) retain the source epoch separately; full private graphs are in `graph-preparation-extension-css-reviewed`.

**Current C2: five issues.** The supplied stylesheet still exists, but `app/root.tsx:1026` now reports `vite-css-url-configuration-required` because the real Vite config contains an active, unverified plugin list. The other issues are external Epic config inheritance, two virtual server-build imports and the nonliteral production-build import. **Current C3: three issues**, unchanged configuration ownership, virtual build and nonliteral build gaps. Both inventories are complete, both analyses remain incomplete and non-reviewable, and original C3 reference hashes remain unchanged.

To close the CSS gap, capture service-owned compiler/loader evidence tied to the exact source/configuration/package versions and mode/conditions, including enabled plugins and actual resolved stylesheet/transitive input bytes. A separately supported plugin subset needs defensible interception/config/load behavior evidence; a successful synthetic core-only build, package name or typegen run is insufficient. The earlier external-configuration, C3 context, generated build and full-portal continuation requirements still apply. Do not restore a lower issue count by assuming those facts.

## Read-only continuation design after the reviewed repair

Date: October 11, 2026, from 16:34 KST. This subsection is a proposed next implementation path, not executed preparation or acceptance. The coordinator requested filesystem/source-only inspection while freezing the service for another whole check. No service/sample/dependency/config/database/build/index mutation, application command, test, source-analysis rerun or Chrome operation was performed in this task; only this report was updated. The observed resolver/test hashes still match `8c00795c...` / `92967d1c...`. The reviewer independently rechecked the fixes and reported 103/103 combined comparator/module tests at 16:26:25 KST, with before/after hashes unchanged. That is the reviewer's dated evidence, not a new test run by this worker.

### Scope and the current five/three failures

The active [four-case plan](../../plans/2026-09-07-portal-four-cases-plan.md) defines C1 as the new-service entry flow: an explicit service reference selects C3's operational-portal strategy, while no reference selects C4's frontend strategy, preserving `requestedCase:C1`. C2 must preserve/extend the relevant legacy UI, API, data, authentication and configuration workflows. C3 must build an independent working portal from the relevant reference patterns and implement missing required layers. The historical plan's older Superpowers sentence is superseded by current repository instructions; its full-portal scope remains authoritative.

Current reported source failures are still C2 five and C3 three, from the source-bound 16:22 analysis above. Their raw inputs were inspected again, without declaring a fresh execution result:

| Gap | Concrete sample evidence | Smallest honest continuation |
| --- | --- | --- |
| C2 external configuration | `tsconfig.json` extends `@epic-web/config/typescript` through an array. Installed config 1.21.3 exports `./typescript.json`; its captured JSON is data, not executable configuration. | Capture and verify that exact provisioned package/configuration separately from repository source, then implement bounded array inheritance. |
| C2 CSS URL | `app/root.tsx` imports `./styles/tailwind.css?url`. `vite.config.ts` enables a cache resolver, environment macros, Tailwind, React Router/devtools, icon generation and conditional Sentry plugins. The resolver correctly leaves these unproven hooks unresolved. | Capture the actual compiler environment, enabled plugin chain, resolved CSS ID and transitive stylesheet inputs. Retain the reviewed conservative rejection until those facts exist. |
| C2/C3 virtual modules | Both `server/app.ts` files import `virtual:react-router/server-build`. C2 uses React Router 7.16.0/Vite 7.3.1; C3 uses React Router 8.4.0/Vite 8.0.3. | A fixed service collector must capture the genuine plugin-generated SSR module and its source/route/package/configuration bindings, or equivalent actual build evidence. |
| C2/C3 nonliteral builds | C2's `server/index.ts` defines `BUILD_PATH='../build/server/index.js'`; C3's `server.js` defines `BUILD_PATH='./build/server/index.js'`, then imports the immutable variable in the production branch. | First recognize the unshadowed/unmutated constant conservatively; keep the resulting target missing until a source-bound actual build receipt supplies it. |
| C3 config context | `tsconfig.node.json` includes only `server.js` and `vite.config.ts`; `tsconfig.vite.json` includes generated/app/server paths, not `react-router.config.ts`. The framework loader executes that configuration outside those TypeScript program roots. | Represent a verified framework configuration transformation context, rather than arbitrarily assigning the file to one TypeScript project or changing the sample's include list. |

These gaps are actual code/evidence boundaries. No file should be manufactured, no plugin list stripped and no existing source failure reviewed away merely to reach zero issues.

### Suggested implementation order and exact file scope

**1. Start with the package JSONC configuration reader.** This is the smallest independent improvement and needs no application execution. Proposed new files: `service/packages/mcp/src/portal/package-config-evidence.ts` and `service/packages/mcp/test/portal/package-config-evidence.test.ts`. Modify `service/packages/mcp/src/portal/module-resolution.ts`, `service/packages/mcp/src/portal/service-graph.ts` and their existing portal tests to consume only verified package configuration evidence. Use the existing bounded native-artifact/package ownership machinery for identities and resolved package roots; keep `source-path-policy.ts` exclusions unchanged.

The capture must bind source/lock identity, owning importer package, exact package version/root identity, manifest/export mapping and configuration bytes/hash. The pure resolver must receive qualified evidence rather than read ambient disk. Planned regressions: the real Epic array extension, config-relative base/paths/rootDirs origins, left-to-right multi-parent precedence, child overrides, cycles/depth/byte caps, absent/changed package/config bytes, outside/reparse aliases, unsupported export conditions and a same-name unverified package. Positive acceptance would remove only the external-config issue; it would not validate Vite or application runtime.

**2. Add one compiler evidence boundary for the remaining three compiler-facing categories.** Proposed service-owned adapter: `service/packages/mcp/src/portal/compiler-evidence.ts`, with `service/packages/mcp/test/portal/compiler-evidence.test.ts`; a proposed fixed producer helper at `service/scripts/collect-portal-compiler-evidence.mjs` must itself have an approved source hash and a test. Define the bounded evidence schema in `service/packages/shared/src/portal.ts` or a dedicated exported `portal-compiler-evidence.ts`, then connect `service/packages/mcp/src/portal/service-graph.ts`, `module-resolution.ts` and `recipes/core-source.ts`. Update contract snapshots only through the existing contract workflow. These are proposed paths, not existing implemented capabilities.

Reuse `native-artifacts.ts`, `native-runner.ts`, `native-module-fence.ts` and their test suites. They already provide exact command/input/artifact authority, in-tree alias validation, generated-output receipts and retained module bytes with producer/hash checks. Their existing `generatedModules` records bind loaded files under approved producer roots; they do **not** currently attest a Vite plugin chain, virtual identifier or an in-memory transformed stylesheet. Add only the missing typed facts, preserving all existing rechecks and loader restrictions.

The bundle must include immutable source/configuration/lock fingerprints, compiler/package identities and bytes, exact Node executable, mode/conditions and environment-key identity without secrets, enabled plugin identities/order, effective root/alias decisions, importer/specifier/resolved ID, source and transformed byte hashes, transitive input membership and producer-command/output receipt. Virtual and generated artifacts need separate qualified targets; do not insert `node_modules`, `build/` or virtual IDs into ordinary repository source inventory. Missing or stale bindings keep the original failure.

Planned regressions include the reviewer's redirect and alias-config plugins, missing plugin/condition/input facts, mismatched source epochs, stylesheet mutation after compile, missing dependency CSS, C3 framework config outside TypeScript roots, conflicting transformation contexts, fake virtual bytes, wrong SSR/client environment, stale generated builds, traversal/reparse targets, failed/timeout producer and changed retained output. A real post-freeze native integration fixture must verify actual existing Vite 7/React Router 7 and Vite 8/React Router 8 behavior. Core-only synthetic output remains insufficient for the real Epic plugin list.

**3. Recognize literal-backed dynamic imports without accepting nonexistent runtime output.** Keep this in `module-resolution.ts` and its test file once the evidence target namespace exists. Bound the evaluator to an immutable string declaration, exact lexical binding, no shadow/reassignment/update/custom loader, and existing path/reference limits. Verify both actual `BUILD_PATH` forms. A recognized but absent generated target must still fail; same-name external packages, conditional branches and unknown expressions cannot substitute for it.

**Preparation reachability is an integration requirement.** `prepareCoreRecipeSources` currently invokes `analyzeServiceGraph` before qualification, and `service-selection.ts` treats module/parse/inventory failures as hard diagnostics. Its source-review allowlist covers weaker semantic/runtime-format observations, not these module gaps. Verify the existing coordinator/profile state path before implementing capture: compiler-source preparation must be reachable for a byte-complete but semantically incomplete snapshot without minting a coding lease or calling it an accepted candidate. Prefer a narrowly admitted preparation phase using existing profile/nonce/native authority. If coordinator routing needs a change, scope it to `service/packages/mcp/src/portal/coordinator.ts` and its preparation/profile tests, leaving normal acceptance gates intact. This cannot be solved by marking hard module issues reviewable.

### Runtime sequence after source checking and profile admission

These steps are planned only. First rehash/re-screen any changed/downloaded dependency or executable and regenerate the source authority after every approved source/configuration adaptation. Use exact native executable hashes and reviewed profiles, with lifecycle scripts disabled. Do not reuse the earlier ad hoc helper's `NODE_OPTIONS` guard as a service native-profile admission; `NativeProfileSchema` rejects caller loader injection and the service supplies its own guard.

1. Collect the package JSONC facts without code execution. Then run fixed compiler-source capture/typegen/build commands in disposable owned copies, with current configuration and package/input/output receipts. C2's original aggregate `setup`, initializer, deploy, browser installation and blanket rebuild remain excluded. Keep Sentry/cloud credentials absent and every required local resource explicit. Building does not establish startup or frontend acceptance.
2. Bind C2's actual runtime to the prepared `.cache/generated-preparation.db` or separately migrate its intended disposable database. Current `.env` still points to `.cache/sample.db`; `app/utils/db.server.ts` constructs Prisma and calls `$connect()`, so a default startup can otherwise use an unprepared database. Retain before/after data baselines and create deterministic synthetic owner/other-user/admin/session/note fixtures through a reviewed scoped command. Do not run the broad `prisma/seed.ts` blindly: its source creates multiple users/notes and image/object-storage data, and it calls its seed function at module load.
3. Preserve C2's existing auth/session/resource ownership behavior. The reviewed working `server/index.ts` already listens on `127.0.0.1`; mocks in `tests/mocks/index.ts` cover named provider/storage/password/email paths but warn on other unhandled requests. The storage helper makes actual `fetch` PUT requests to its configured endpoint. Required storage/provider behavior needs a real owned local resource or explicitly scoped mock-contract evidence; a warning or absent cloud token is not proof of contained traffic or a required integration pass.
4. Before any C3 startup, adapt the **owned** `server.js` listener to an explicit loopback host and record the original/working hashes. Keep the original reference unchanged. Build a new independent portal target; do not apply candidate files to either reference tree. The template currently supplies Express compression/static serving, React Router SSR dispatch and a context message, not complete API/persistence/authentication.
5. Implement C3's required API/data/auth behavior from confirmed workflow contracts. A compatible smallest local baseline can use the existing Express/React Router structure and owned SQLite/session/auth components, reusing documented legacy patterns where appropriate; Node built-ins can avoid new dependency acquisition where their behavior fits. This is a proposed local architecture, not implemented scope or a product decision that real checkout/payment/provider flows are unnecessary. Confirmed manifests must specify actual journeys, contracts, ownership and applicable layers.
6. Execute candidate and applied checks through the public portal/native workflow: install/startup and migration results, frontend-to-API requests, persistence across restart, authorization/ownership/CSRF/validation negatives, unchanged legacy behavior/data, resource cleanup and source/design freshness. Chrome checks use the service's installed-Chrome path after these prerequisites. A successful public plan, source graph, compiler receipt, core-only fixture or private startup cannot substitute for this full portal acceptance.

### Node compatibility and outstanding owner inputs

Observed preparation ran successfully on installed Node 24.21.0: C2/C3 typegen, C2 migration/typed SQL and Vite 7/8 synthetic builds. Epic's manifest still declares `^22.18.0`, excluding Node 24; its full application was not started and declared compatibility was not changed. React Router 7 requires `>=20`, React Router 8 requires `>=22.22.0`, Prisma 6.19.2 requires `>=18.18`, sharp 0.34.5 declares `^18.17.0 || ^20.3.0 || >=21.0.0`, and Sentry profiling 10.38.0 declares `>=18`. Those package ranges permit Node 24 individually and do not certify the assembled Epic app.

The remaining source is material: `server/utils/monitoring.ts` imports native profiling at module scope and constructs its integration; `db.server.ts` connects Prisma; the native engine/library ABI and prepared database must work under the actual reviewed startup. The agent can inspect and later run bounded Node 24 compatibility/import/startup checks, retaining exact failures and repairing concrete owned adaptations when authorized. Do not silently change `engines` to claim compatibility or substitute another Node executable for the admitted native environment. If a concrete incompatibility proves another Node version necessary, identify the required executable/profile/environment change for a coordinated decision; no such incompatibility has yet been executed or established. Chrome remains the required browser throughout.

No new owner input is required to design/implement the bounded evidence contracts, read known installed package facts, add tests after unfreeze, choose safe unused local output paths or prepare deterministic disposable resources within the existing authorization. Full portal execution still requires confirmed workflow manifests and service-supported native profiles. Ordinary local implementation choices can be made by the agent; ask only when the actual required product behavior or a real external environment cannot be inferred. Examples that genuinely change acceptance are a real payment/order flow versus a confirmed local contract, required OAuth/email/storage service testing, or an unavailable required runtime. Keep credentials outside chat and bind externally supplied environment names rather than secret values. Official Figma authentication and complete live design evidence remain separate owner/service prerequisites controlled by the coordinator.

## Installed-package configuration increment in the managed worktree

Date: October 11, 2026 (Asia/Seoul). Implementation preparation uses the managed isolated checkout at `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/service`, aligned by the coordinator with source `6faae627...`. Its initial resolver is `8c00795ce9aa6fb6aa4bf87e592df039b0ea28b42703527a38608414d0c8ebdb`; initial service-graph is `c6f78daa6343a571bc821dbd1c86caca6ff97af2dda1aa1a2d9a54877efb2c4d`. Main and native source remain frozen for their pending whole check. The historical whole pass at `18525cdc...` does not cover this increment or the pending `6faae627...` snapshot.

The coordinator approved only resolver/test, new `package-config-evidence.ts`/test and minimal service-graph/test plumbing. Dependency junctions in the managed checkout are writable aliases to the native installation; no dependency installation, rebuild or linked workspace-package mutation is authorized here. Source inspection and regression writing have begun; **no test/build execution or production implementation has run at this preparation checkpoint**. Execution waits for the coordinator's release.

Installed service TypeScript primary source (`getExtendsConfigPathOrArray`, `parseConfig`, `nodeNextJsonConfigResolver`) confirms left-to-right array inheritance, last-parent option precedence, child overrides and NodeNext JSON-only package config lookup. The service installation was subsequently verified as **6.0.3**; Epic's installed compiler is **5.9.3**, a separate dependency. The collector design uses explicitly admitted native package-tree inventories, source/config/owner-manifest/lock bindings, package name/version/manifest hash, exact captured JSONC bytes and bounded relative inheritance. Captured config evidence remains separate from ordinary source inventory; admitting JSONC cannot admit dependency runtime code or excluded build output. The first lock adapter is bounded to actual Epic's npm package-lock v2/v3 package records. Unsupported lock formats remain blocking for package config inheritance until a verified adapter exists.

Regressions written before implementation cover array ordering and path origins, inherited effective baseUrl, malformed/over-limit/cyclic inheritance, JSONC capture, absent and fabricated admission, stale artifact/source/lock bindings, package identity mismatch, duplicate root authority, escaping and in-tree links, missing/non-JSON targets, package-relative runtime paths remaining excluded, and optional service-graph admission with source-hash binding. Public orchestration does not yet supply this authority, so private preparation evidence cannot establish public C2 acceptance or runtime preparation reachability. Expected actual-sample impact is only C2's verified external-config error removal (5 to 4); its CSS plugin and generated/runtime gaps and C3's three issues remain blocking.

### Implemented and frozen review snapshot at 17:09 KST

The coordinator released focused tests/static checks after the main whole attempt reached its terminal result. That main attempt had 4,996 passes, one older test-assertion failure and 20 existing skips; its subsequent assertion repair and renewed whole attempt are the coordinator's separate work. No whole-source pass is claimed for this managed increment.

Implemented behavior:

- `capturePackageConfigEvidence` reads data only after matching explicit `NativeArtifactAuthority` package-tree inventories. Package location, owner declaration, exact name/version, npm v2/v3 lock record and integrity string, manifest bytes, canonical root/directory identity, recorded file identities and hashes, bounded JSONC closure and final resolution-path rechecks must agree. In-tree package links can be captured; escaping links, missing/unreadable/aliased members and overlapping authorities fail. An additional mutation regression proved that checking a tree before reading config bytes was insufficient; the repaired reader compares every manifest/config read against the inventory observations as well as retained read authority.
- Capture uses at most 128 configuration visits, depth 32, 32 parents per array, 262,144 bytes per manifest/config and 1,048,576 captured text bytes. Repository-source bindings retain the existing 5,000-file, per-file and total-text limits. Malformed compiler-option objects, unsupported config-directory templates, mixed/array export forms and unsupported nested package inheritance remain blocking. The supported package export lookup uses fixed TypeScript NodeNext JSON config conditions (`types`, `require`, `node`, `default`) and literal JSON targets. The service-installed TypeScript parser oracle, subsequently verified as version 6.0.3, independently accepted the corresponding conditional-export/JSONC fixture.
- The resolver consumes opaque in-process captured config bytes without admitting dependency source into ordinary inventory. A copied/fabricated receipt or changed source binding fails. Array inheritance merges left to right, preserves parent-relative path origins and final effective baseUrl, and applies child overrides. Partial rejected capture grants no package target. Ordinary unknown loader/project/runtime issues remain hard failures.
- `analyzeServiceGraph` has an optional explicit `packageConfigAuthority` input. It captures evidence, passes it to the resolver and incorporates the evidence hash into `sourceHash`. Default callers continue to report unverified package inheritance. This does not add a serialized public receipt schema, persist dependency files as repository evidence, or wire authority through public coordinator/preparation routing. Future public integration must recapture and revalidate authority consistently for qualification and freshness checks.

Verification was run from the managed checkout, with native config loading, cache disabled and one Vitest worker to avoid writing through dependency junctions:

```powershell
# Working directory: managed service/packages/mcp
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache --maxWorkers 1 test/portal/module-resolution.test.ts test/portal/package-config-evidence.test.ts test/portal/service-graph.test.ts test/portal/source-inventory.test.ts test/portal/service-connections.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
# oxlint --deny-warnings and oxfmt --check on the six owned source/test files
```

Initial RED: **109 passed / 10 failed**, with the expected missing collector, array-inheritance and graph-admission failures. Additional capture-time mutation, mixed exports and malformed configuration cases failed before their repairs. Final frozen related execution at **17:08:43 KST**: **169 passed, zero failures, one existing platform skip**, across five files. Complete MCP typecheck and scoped lint/format checks passed. Earlier intermediate typechecking caught an unused import, an exact-optional argument and a callback narrowing error; all were repaired before this final snapshot. Private execution records are under `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/.task-evidence/`, including `package-config-related-frozen.json`, `package-config-analysis.mjs` and `package-config-sample-summary.json`.

The actual read-only sample graphs were rerun at **2026-10-11T08:09:08.467Z** using the managed service and only a captured `@epic-web/config` package-root authority. C2 retained 334 text members and inventory `sha256:004ec1713c4b72f9dc27476475ae790b80bc4528402001e6368daa1ffa1ac778`; C3 retained 20 text members and inventory `sha256:886bcf5594b47e2a8429bf36af89ba914ec7745da2f148db1cef15f47937e854`. Original C3's 80 tracked source hashes remained unchanged. No sample, dependency, database, application, daemon or Chrome mutation/execution occurred in this increment.

| Sample | Verified impact | Remaining exact graph issues |
| --- | --- | --- |
| C2 | External `tsconfig.json` inheritance issue removed; **5 to 4** | `MODULE_UNRESOLVED:app/root.tsx:1026:vite-css-url-configuration-required`; `MODULE_UNRESOLVED:server/app.ts:439:unsupported-module-specifier`; `MODULE_UNRESOLVED:server/app.ts:541:unsupported-module-specifier`; `MODULE_UNRESOLVED:server/index.ts:5887:nonliteral-module` |
| C3 | Unchanged, **3** | `MODULE_UNRESOLVED:react-router.config.ts:0:config-project-source-unassigned`; `MODULE_UNRESOLVED:server.js:1290:nonliteral-module`; `MODULE_UNRESOLVED:server/app.ts:294:unsupported-module-specifier` |

Both graphs remain `incomplete:true` and `lexicalReviewable:false`. C2's captured package is version **1.21.3**, manifest `sha256:eab005b492ef1a6650b533c6d720299657056149b360156e00c9c62495217656`, 354-byte `typescript.json` `sha256:74cd5c5a43597f09658eb0e0ad6883ae90a8026f3755b39201720bbef7508445`, lock `sha256:53dbf4d08891cafa5515af283ae083502f64e70f049ecde9f923637e4c8b0a8b` and admitted package-tree `sha256:98ce05112d798e8611d5c3acb3c478d501c3f02f5841a750ae56b14dc3db1a3d`. Evidence hash is `sha256:9eb9aed43af60d534cf67e8a0022aa7ce2cfe9ff2dc296ed3d5f9626c9a34e72`; qualified C2 graph source hash is `sha256:ecdddd32d39a742dad216274a05d3f2e903510c787547c56520d1f8dfacd1db8`. Recorded lock integrity is a package provenance binding, not a new tarball download/signature verification or a malware guarantee.

Final six-file SHA-256 snapshot, relative to the managed service:

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/module-resolution.ts` | `fcebd307eb4f2c7b2aa25600918f80c028b72313b9b9f8fbf04d6389232c38e7` |
| `packages/mcp/src/portal/package-config-evidence.ts` | `ed7e3a05c19f96592d6c0aec1a4e1bf697c341d01acfbff8f8abb7061959b31e` |
| `packages/mcp/src/portal/service-graph.ts` | `1042e728abf21edee6ebc35cc0245ad582965981db06632ab07eb9d1602017ec` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `94f8ab700f1f00cdf20ef93a74287821b96ac4dcd8687010fe55ebbf1fe301bd` |
| `packages/mcp/test/portal/package-config-evidence.test.ts` | `6a4857827ffa6812822b52c404c364d3bca906f4cdb1521c4b8a82f7a5fd4597` |
| `packages/mcp/test/portal/service-graph.test.ts` | `ac9d4495e463811513ff0ec26f978fa90be01e7e1005cd73aaac4b2c24cfc05d` |

Source is frozen for independent review. Integration, public authority reachability, renewed whole verification and complete C1/C2/C3 portal acceptance remain coordinator-owned gates. The next source evidence increment is the separately admitted compiler/plugin/SSR-output boundary described above. C2's explicit disposable database binding and Node 24 versus declared Epic Node 22 compatibility, and C3's required full backend/data/auth implementation, remain open as recorded in the runtime sequence.

### Package selection review repairs at 17:26 KST

The [independent package-config review](package-config-review.md) found two P1 wrong-success cases at the preceding `ed7e3a05...` capture snapshot. PC-1 used a matching `types@>=5.0` export condition followed by a default config; PC-2 used a `typesVersions` path map without exports. In both fixtures the service selected `typescript.json` and `ordinary.ts`, while the real compiler selected `special.json` and `special.ts`. The review's seven ordinary condition-order probes matched the compiler; no widening of those semantics was requested or implemented.

Both findings are repaired conservatively in the same managed worktree. `package-config-evidence.ts` now rejects any manifest `typesVersions` field and versioned `types@...` conditions anywhere in its export structure with `PACKAGE_CONFIG_COMPILER_SELECTION_UNSUPPORTED:<config>`. The bounded scan checks at most 4,096 nodes/pending entries and depth eight; inability to establish a supported selection also rejects admission. Compiler-version-aware selection has not been implemented. A rejected capture cannot attest the default/unmapped config or grant partial targets, and the original external-extends failure remains. This preserves uncertainty until an actual target compiler and its selection evidence are bound.

Regression execution used the same cache-disabled native-config-loading commands and managed paths as above. Each new fixture verifies that the actual service-installed **TypeScript 6.0.3** parser/resolver chooses `special.ts` with no diagnostics before asserting conservative rejection by the service. The earlier report's description of the service oracle as 5.9.3 was an incorrect inference from Epic's own dependency version; the affected sentences above are corrected. Epic's actual package/compiler facts and existing TypeScript 5.9.3 sample probes remain separate historical evidence.

| Verification | Actual result |
| --- | --- |
| `package-config-review-red.json`, 17:24:46 KST | Both added review regressions failed for absent rejection after their compiler-target assertions passed. Nine cases were excluded by this targeted name filter. |
| `package-config-review-green.json`, 17:25:34 KST | All **11 package config cases passed**, zero failures/skips. |
| `package-config-review-related-frozen.json`, 17:26:06 KST | All five related files: **171 passed**, zero failures, one existing platform skip. |
| Full MCP `tsc --noEmit -p tsconfig.json` | Passed. |
| Scoped `oxlint --deny-warnings` and `oxfmt --check` on the six owned files | Passed. |
| `package-config-sample-summary-review-frozen.json`, `2026-10-11T08:26:28.296Z` | Actual C2 **4 issues**, C3 **3 issues**, matching the exact unresolved lists above. Both remain incomplete and not lexically reviewable. |

Private evidence remains in the managed root's `.task-evidence/` directory. The previous graph summary is retained as `package-config-sample-summary-first-frozen.json`. Current actual Epic package admission still has no issues, and its source inventory, package/lock/config byte hashes, evidence hash and qualified source hash are unchanged. Original C3's 80 tracked file hashes remain unchanged. No sample, dependency, application, database, daemon, main/native source, provenance, index or Chrome mutation occurred. The coordinator separately reported a passing main whole check `1a5...` (4,997 passes, zero failures, 20 existing skips, 57 Chrome cases plus one artifact case); that result does not cover this managed repair.

New frozen hashes, superseding only two rows of the 17:09 snapshot:

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/package-config-evidence.ts` | `81bb308767849b3ba7b441e4caeed5c2ceea26ea9ec67ca777fb79d28d559419` |
| `packages/mcp/test/portal/package-config-evidence.test.ts` | `1c3273084d56bdd0c4219497de1ba848c9bbc4d23609e8cc8c04cbd593ad88e5` |

The other four owned file hashes remain exactly as recorded above. Production and test files are frozen again for independent recheck. Public admission routing, serialized evidence transport, compiler/plugin/SSR-output evidence, whole verification after integration and complete portal runtime acceptance remain open.

### CLI initialization diagnosis at 18:36 KST

The coordinator reopened the owned package-config scope after `packages/cli/test/browser-source-open.test.ts` failed during module initialization in the managed checkout. The initial reproduction is retained as `.task-evidence/package-config-cli-init-red.json`: zero cases reached execution, with `PortalCoreDeclarationBatchSchema` undefined at shared `portal.ts:853`. A fresh Node source import of CLI commands reproduced the corresponding temporal-dead-zone `ReferenceError`; the added fresh-process regression also failed before implementation.

Replacing the package-config module's eager artifact-runtime imports with type-only imports and a lazy import inside explicit asynchronous capture preserved all eleven existing package config cases but **did not clear this CLI failure**. A further test-only loader differential removed package-config entirely and the CLI still failed identically. These results prevent attributing the failure to the package feature or other agents' Chrome/a11y changes without evidence. Failed follow-up files whose names contain `green` retain their actual failure results and must not be read as passing verification.

Resolution traces identify two physical shared schema trees. Bare `@sfp/shared` imports follow the managed dependency junction to native `packages/shared/src/index.ts`; the managed `mcp/src/portal/recipes/core-lifecycle.ts` directly imports managed `shared/src/portal-core-lifecycle.ts`. This second tree is entered through core-lifecycle, then recipes and portal, causing the initialization cycle. All four corresponding shared/core-lifecycle source files are byte-identical between managed and native. A fresh read-only import of native baseline CLI succeeds. A private diagnostic Node resolution hook mapping only `@sfp/shared` to the managed shared barrel also makes managed CLI initialization succeed. Diagnostic stubs/aliases are investigation evidence, not service acceptance or production repairs.

At this checkpoint the lazy artifact boundary and new regression are not frozen or accepted, and the fresh CLI regression remains failing under the uncorrected managed workspace identity. The coordinator has been asked to choose the minimal public-barrel import repair in the separate `recipes/core-lifecycle.ts` scope or correct managed test/runtime workspace aliases. No shared schema has been relaxed, and no other owner's Chrome/a11y file, dependency junction, native/main source or live process was changed.

### Managed identity validation and lazy capture boundary at 18:44 KST

The coordinator selected **managed-local validation aliases**, preserving all production shared schemas and core-lifecycle imports. The private config at `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/.task-evidence/managed-cli-vitest.mjs` imports the existing CLI test config and maps only `@sfp/shared` to that managed checkout's `packages/shared/src/index.ts`. Its cache is outside service source, cache is disabled and the worker limit is one. This corrects the physical workspace-package identity for validation; it does not waive a schema or substitute native source for a managed change. Dependency junctions remain untouched.

The existing CLI file passed **17/17** cases at **18:43:06 KST** with this approved consistent managed identity. It uses existing mocked browser connections; no Chrome or daemon was started or controlled. The exact command, from the managed service root, is:

```powershell
node node_modules/vitest/vitest.mjs run --config ../.task-evidence/managed-cli-vitest.mjs --configLoader native --no-cache --maxWorkers 1 packages/cli/test/browser-source-open.test.ts
```

Its report is `.task-evidence/package-config-cli-managed-identity-green.json` under the managed checkout root. Use an **absolute** JSON output path there when recording this command: Vitest resolves relative report paths against its configured CLI root. The first generated CLI report was moved out of service source to this private directory, and its now-empty temporary directory was removed. All other source/dependency trees were preserved.

Only two owned service files changed in the final repair. `package-config-evidence.ts` retains type-only native artifact imports and loads `NativeArtifactAuthoritySchema`/`inventoryNativeArtifact` lazily inside explicit asynchronous capture. This is a separate pure-resolution boundary improvement, not a claim that the lazy import fixed the physical schema identity problem. Its dedicated fresh-process regression intercepts attempted native-artifact runtime resolution and verifies that ordinary in-memory source resolution can initialize and complete without that runtime. The regression failed with the original eager import (`package-config-lazy-boundary-red.json`, **18:42:28 KST**) and passed after the lazy boundary. A second fresh-process regression initializes the real CLI command module with the managed shared-identity hook. These local test hooks are fixed repository-source validation helpers; they are not sample/native-profile loader admission or portal runtime acceptance.

Final unchanged-source results:

| Check | Actual result |
| --- | --- |
| `package-config-lazy-boundary-green.json`, 18:43:10 KST | All **13** package config cases passed, including both fresh-process boundaries and PC-1/PC-2 rejection. |
| `package-config-init-related-frozen.json`, 18:44:13 KST | Five related files: **173 passed**, zero failures, one existing platform skip. |
| Full MCP typecheck; six-file scoped lint and formatting | Passed. |
| `package-config-sample-summary-init-frozen.json`, `2026-10-11T09:44:36.623Z` | C2 **4** and C3 **3** exact remaining issues, unchanged inventories/admitted Epic facts and zero changed original C3 tracked files. |

The accepted package evidence rules and public authority gap are unchanged. Actual sample graphs remain incomplete and not lexically reviewable; no application, database, dependency, live Chrome or daemon mutation/execution occurred. No main/native service source, other owner's Chrome/a11y source, shared/core-lifecycle production source, provenance or Git index was edited.

Latest frozen hashes, superseding the two 17:26 rows:

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/package-config-evidence.ts` | `594a03189b6de2b532f16d1a2c18432493e8f65566df63655598797592d9355e` |
| `packages/mcp/test/portal/package-config-evidence.test.ts` | `d822bcfecb05293df3b527016ba7a7e9857702cec3de771fc3df8a2533132d3e` |

The other four owned hashes are unchanged from the 17:09 table. Source/test edits are frozen for independent review. Integration and whole verification must retain one workspace-package identity; a shared dependency junction does not create a protected or independent source/runtime workspace. Public package-authority routing, compiler/plugin/SSR-output evidence and complete portal acceptance remain pending.

