# C3 native reference readiness

Date: October 12, 2026 (Asia/Seoul). Scope: screened React Router reference preparation for a separate complete operational portal. Read first: [repository instructions](../../../AGENTS.md), the shared analysis policy, [sample malware screening](../../analysis/oss-samples-malware-review.md), [the four-case plan](../../plans/2026-09-07-portal-four-cases-plan.md), [the prior sample continuation](../2026-10-10-continuation/sample-generated-inputs.md), and [the native portal workflow](../../../service/docs/portal-native.md).

The verified a476 whole remains historical service evidence. The coordinator subsequently overlaid the approval UI and retained regression at `sha256:4b11eac461e23d44a6c6373ff4fce9e74391b4ae1c04ac75f3f6b623591236b5`. This preparation changed no Main/native service source. Its read-only analyzer binds exact native source file hashes below, independently of newer UI integration. Official MCP live acceptance is owner-deferred; Chrome and complete C3 operational acceptance remain applicable.

## Result and limits

The pinned reference now has a separately owned, native-buildable working copy. Type generation, TypeScript project build, actual React Router 8/Vite 8 production build and four local HTTP observations passed. Two narrowly scoped working-copy adaptations bind the server to `127.0.0.1` and prevent an inner Express app from restoring a header disabled by the outer app. The original reference, its dependencies and C2 were preserved.

**C3 is not generated or accepted.** The independent generated target is empty. No service plan/run, coding lease, submission, native profile registration, application, Chrome preview, live Figma read, grant or unknown-outcome recovery was executed here. This task prepares inputs and identifies blockers for the coordinator's actual service workflow. A successful template build does not implement the required new portal API, data or authentication.

## Reference, dependencies and architecture

Pinned source: [React Router node custom server template](https://github.com/remix-run/react-router-templates/tree/067adb378a00a4c2ceb71934d5e8901d0e87c256/node-custom-server), commit `067adb378a00a4c2ceb71934d5e8901d0e87c256`. The original clone's HEAD and clean tracked status were checked. All **80** originally screened tracked file hashes matched before copying and again at final inventory.

The owned child is `.worktrees/_cache/portal-case-samples-20261010/c3-native-readiness-20261012/`. Its `reference-workspace/` is a copy of the screened template workspace; `reference-workspace/node-custom-server/` is the C3 reference application. Its separate `generated-target/` starts empty and receives no reference frontend files. The existing `react-router-owned/`, `epic-legacy/` and pinned reference trees were not modified.

The prior screened dependency inventory contains **8,967 members, 272,759,636 bytes and 670 links**. Every recorded regular file and link was rechecked against the original and copied bytes. Links are relative, resolve inside their respective copied workspace, and preserve the pnpm layout. No new package download, installer or lifecycle hook ran. Prior Defender/provenance evidence remains dated screening, not a guarantee about every future execution. The copied dependencies can be proposed for explicit service artifact admission; this private copy is not admission itself.

Native Node is `v24.21.0`, executable `C:/Program Files/nodejs/node.exe`, SHA-256 `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`. The copied locked runtime uses React Router `8.4.0`, Vite `8.0.3` and TypeScript `5.9.3`. React Router 8's recorded `>=22.22.0` requirement permits this Node version; executed command results below establish this bounded sample compatibility, not all service/product behavior.

The reference's `server.js` supplies compression, static serving and a development Vite SSR loader or production built-app import. `server/app.ts` creates an Express app, loads `virtual:react-router/server-build`, and injects `Hello from Express` through `RouterContextProvider`. The home loader renders that message. There is no business API mutation, database, account/session management or authorization implementation. The reference also contains external Google font/documentation links. No browser navigated them during this HTTP-only preparation.

## Executed commands and preserved failures

All commands use a clean child environment containing selected Windows runtime variables and explicit synthetic sample settings. Ambient credentials, email/OAuth/deployment settings and service state are not inherited. The copied Node preload rejects nonloopback JavaScript network connections and pins default listeners to loopback. It is **not an OS network sandbox**, does not attest every native-library packet, and is not permitted caller loader injection in an actual native profile. The service supplies its own admitted guard for that later workflow.

Run from the repository root:

```powershell
node .worktrees/_cache/portal-case-samples-20261010/c3-native-readiness-20261012/run-baseline.mjs typegen r1
node .worktrees/_cache/portal-case-samples-20261010/c3-native-readiness-20261012/run-baseline.mjs types r1
node .worktrees/_cache/portal-case-samples-20261010/c3-native-readiness-20261012/run-baseline.mjs build r1
```

These exact attempts already exist and must not be overwritten. Use a fresh attempt label only if source changes require another check. The runner invokes the installed `@react-router/dev/bin.cjs` or TypeScript executable directly, with no package-manager lifecycle. It hashes the exact Node executable, command, environment names, stdout/stderr and generated files.

| Receipt under the owned child's `evidence/` | Actual result                                                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typegen-r1.json`                           | Exit 0, four generated type members, no stderr.                                                                                                                                                                 |
| `types-r1.json`                             | Exit 0, no stderr.                                                                                                                                                                                              |
| `build-r1.json`                             | Exit 0, genuine enabled Tailwind/React Router plugin build, seventeen type/client/server members, no stderr.                                                                                                    |
| `reference-runtime-r1.json`                 | Failed home-header assertion after HTTP 200; owned process exited and port became free.                                                                                                                         |
| `reference-runtime-r2.json`                 | Reproduced exact `server-header` failure: inner Express returns `X-Powered-By: Express`. Outer disable alone was ineffective.                                                                                   |
| `header-adaptation.json`                    | Exact before/after hashes for adding inner `app.disable("x-powered-by")`. Pinned source remains unchanged.                                                                                                      |
| `build-r2.json`, `types-r2.json`            | Exit 0 after the inner-app adaptation; no stderr.                                                                                                                                                               |
| `reference-runtime-r3.json`                 | Passed `/` HTTP 200 with real Express context and template UI; `/api/catalog` GET, `/api/session` POST and `/account` GET each 404. Header absent throughout; owned listener freed after observed process exit. |

`probe-reference.mjs <fresh-attempt>` exclusively starts the adapted C3 production app on previously checked loopback port **48223**, sends the four bounded local requests, and stops only its owned child. It never sends credentials. Cleanup records abrupt process exit/free listener; it does not claim graceful diagnostics flushing or browser/plugin-side retirement.

Private schema-bundle preparation initially failed because esbuild was not a direct native service dependency, Windows absolute imports were emitted as invalid ESM specifiers, absolute TS entries were externalized, and Playwright's require entry was unsuitable for an ESM named import. Each failure is recorded in `contract-preparation-failures.json`. The final helper reuses already screened copied esbuild `0.27.3`, bundles native TS entry sources privately, and resolves installed native package imports to their real file URLs/import entry. No dependency was installed or service source changed. The final pure schema checks passed; none creates runtime authority.

## Current service graph blocker

The service's own read-only analyzer was bundled privately and executed against only the new C3 reference working copy. Source inventory is complete, **20 text files**, with hash `sha256:100b5bc3f648d99444d6d2d6ff756e61fa62f1d741e7d11eafbe569f332337d1`. It still reports `incomplete:true`, `lexicalReviewable:false`, three issues and no truncation:

1. `MODULE_UNRESOLVED:react-router.config.ts:0:config-project-source-unassigned`.
2. `MODULE_UNRESOLVED:server.js:1290:nonliteral-module`.
3. `MODULE_UNRESOLVED:server/app.ts:323:unsupported-module-specifier` for the genuine virtual SSR build.

The new offset in `server/app.ts` reflects the exact inner-header adaptation. Actual successful production output does not automatically supply compiler/configuration/runtime-output authority. These are the same substantive gaps retained in the October 11 continuation. Do not change the upstream project include list, fabricate a virtual export, mark these errors reviewable, or switch to C4 to evade them.

The analyzer's native source bindings are:

| Source                                         | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `packages/mcp/src/portal/service-graph.ts`     | `1042e728abf21edee6ebc35cc0245ad582965981db06632ab07eb9d1602017ec` |
| `packages/mcp/src/portal/module-resolution.ts` | `fcebd307eb4f2c7b2aa25600918f80c028b72313b9b9f8fbf04d6389232c38e7` |
| `packages/mcp/src/portal/source-inventory.ts`  | `92dd6d81a36620094a5329858e3c71b1e2d022bf8706bdd534ffc2d6f5c8833b` |
| `packages/mcp/src/fs/repo-walk.ts`             | `e1d848761af2a70a62a348a0bc7bf3bf301e57ccb05b0793902aa20dab6df125` |

All four were rechecked after analysis. Full graph and summary are preserved in `evidence/current-service-graph*.json`. The service needs its separately proposed public compiler-source preparation/admission path, framework configuration context and genuine generated SSR/source closure before normal C3 planning can rely on this reference. Private evidence is preparation, not a public admission bypass.

## Prepared plan, profile and acceptance contracts

`c3-plan-input.json` is the exact CLI argument-file content before path registration. It selects `case:new-reference`, `stack:react-vite`, current Chrome design freshness and three **draft** workflow groups: current design portal, real server/data journey and applicable auth/ownership. It does not invent an actual registered workspace ID. The pure schema check supplied a clearly fixture-only UUID solely to validate the path-resolved shape and confirmed `reference-portal`/operational scope. Every workflow still requires its real blueprint, so no coding lease is ready.

The known design remains file `4IBhv1d8hEclifZQrOYxHS`, initial node `0:1`, unless the coordinator deliberately binds the current C3 journey to a different already supplied design. The template supplies no product semantics. Before confirming, bind actual captured routes/actions to domain schemas, API methods/request/response/status, roles, session/ownership rules and data changes. Local SQLite/session components are a proposed smallest native approach, not implemented or a promise that a real payment/email/provider workflow is unnecessary. Any genuinely irrelevant layer needs evidence-backed treatment; C3 must not silently become frontend-only.

`c3-native-profile-template.json` lists exact native executable/hash, bounded command proposals, owned-SQLite resource declaration, environment **names/settings without secrets**, output declarations and required assertions. It is deliberately **not registerable**: `planId`, `contextHash`, candidate `sourceHash` and complete closure are unbound. Four proposed `acceptance/*.mjs` files do not yet exist because their source belongs to the actual generated candidate. A separate fixture validated only the native schema shape with obvious zero hashes. Never treat those hashes as source authority or submit that validation fixture.

The copied reference dependency roots are suggestions for reviewed artifact provisioning. The generated candidate must receive its own exact runtime dependency authority; reference dependencies cannot silently satisfy a separate target's closure. The coordinator must bind actual plan/owner/context/candidate/source closure, admitted dependency/resource outputs, original run deadlines, current captured oracle PNGs and service-provided preview helper. Native profile registration is reviewed preparation followed by explicit registration, not command execution.

`c3-acceptance-contracts.json` retains twelve required gates: independent target/provenance, native build, real design visual coverage, frontend-to-API/data journey, input negatives, applicable auth/ownership/CSRF, persistence across controlled restart, migration, browser UX, accessibility, owned cleanup and applied source/design freshness. It explicitly leaves domain/provider requirements unresolved. No external OAuth, email, payment or deployment was exercised; absence of those calls is not a passing required integration.

The coordinator's next public commands, **not executed here**, are:

```powershell
node packages/cli/dist/index.mjs portal plan --case new-reference --out C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-case-samples-20261010/c3-native-readiness-20261012/generated-target --reference C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-case-samples-20261010/c3-native-readiness-20261012/reference-workspace/node-custom-server --args-file C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-case-samples-20261010/c3-native-readiness-20261012/c3-plan-input.json
node packages/cli/dist/index.mjs portal run <actual-plan-id> --workspace-id <actual-target-workspace-id>
node packages/cli/dist/index.mjs portal next <actual-run-id> --workspace-id <actual-target-workspace-id>
```

Use only the matching coordinator-owned state/daemon environment. The draft plan may fail its current reference graph or return needs-input. Resolve the genuine authority gaps and confirm evidence-backed workflows before obtaining a lease. Submit independently produced candidate files through that actual lease, prepare/register the real native profile, then run candidate, guarded apply and applied validation. Do not copy the reference frontend into `generated-target/` or count this template startup as pipeline generation.

## Continuation priorities

1. Root reviews the exact private manifests and addresses the three source/compiler admission gaps through the service, retaining old failed evidence.
2. Bind the current design, actual reference/output registrations and operational workflow decisions through a fresh public C3 plan. Preserve original unknown jobs, grants and run deadlines.
3. Generate the separate complete portal with actual applicable API/data/auth/configuration; implement and hash the real acceptance harnesses under its coding lease.
4. Provision owned native resources, execute service-owned installed-Chrome visual/interaction and real HTTP/data/auth journeys, then applied/current-design checks. Required skips/blocked providers remain incomplete.

No new owner credential or browser permission is needed for this completed local preparation. Actual product/provider contracts and current design authority remain concrete coordinator inputs. This preparation does not resolve them or any unknown job.
