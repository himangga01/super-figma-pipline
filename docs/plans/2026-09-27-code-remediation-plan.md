# Code remediation plan: two-round critical review

Date: September 27, 2026. Baseline: `main` at `0a0f3ad`. Status: proposed, awaiting owner approval. The review changed no source code.

Execution order, task scope and gates are governed by the [prioritized fix plan](2026-09-27-prioritized-fix-plan.md). This document remains the evidence record. The findings ledger (section 3) and the fix directions to avoid (Appendix B) stay normative. The workstreams (section 4) and phases (section 5) are design guidance; where they differ from the prioritized fix plan, that plan wins, and it lists each deviation.

This plan does two things:

- It records the findings of a whole-repository code and service review.
- It turns those findings into ordered, testable remediation work.

It complements the active [four-case plan](2026-09-07-portal-four-cases-plan.md) and the [remaining-work plan](2026-09-14-remaining-work-plan.md) and does not change the four-case scope. It is a prerequisite for them. The current code cannot complete any portal run, and several defects wedge the daemon over time. Remaining-work Tasks 6E through 8 therefore cannot be accepted until the blocking items below are fixed.

Repository rules apply to all work under this plan:

- Write Markdown in English.
- Do not use Docker, a VM or WSL as a substitute for native validation.
- Validate natively in a separate working copy.
- Do not use Superpowers skills.
- Preserve historical evidence.
- Ask the owner before running test suites on the owner's machine (console pop-up policy).

## 1. Review method

The review ran in three stages.

**Baseline analysis.** Five area reviews produced 26 known findings, K1–K26. The areas were:

- portal;
- platform core;
- tools and contracts;
- plugin and CLI;
- build and documentation.

**Round 1.** Five reviewers, each with a distinct lens, reported 42 findings and 7 extensions of known findings. The lenses were:

- correctness and concurrency (CC);
- security (SEC);
- service and product fitness (SVC);
- Windows reliability and operations (OPS);
- verification and maintainability (VER).

**Round 2.** Five fresh reviewers challenged round 1 and reported 40 new findings. They covered:

- refutation and severity calibration (R2A);
- fix design and sequencing (R2B);
- design-data fidelity (FID);
- service analysis and recipes (SA);
- upgrade, lifecycle and multi-client behavior (LC).

**Main-session verification.** For every critical and high finding, the main session re-read the code path before accepting it. Medium and low findings were spot-checked. Ledger rows are marked in one of two ways:

- **V:** the main session read the cited code.
- **A:** a reviewer traced the path and the result is consistent with the surrounding code, but the main session did not re-read every line.

**Outcome.** No finding was rejected outright. Eleven severities were lowered and several findings were merged (Appendix A).

**Limitations.** This was a static review. No tests, builds or processes were run: this checkout has no `node_modules`, and the owner restricts runs that open console windows. Findings that depend on runtime behavior are labeled. That behavior includes:

- PowerShell console decoding;
- antivirus locks;
- the browser's local-network gating;
- MCP client timeouts.

## 2. Current state

The owner's machine runs Windows 11 with a Korean locale, and its user profile path contains Korean characters. On this machine a C4 run is blocked at four independent points. In the order a run reaches them:

1. **OPS-1:** owner-state access fails. The directory-lease broker garbles non-ASCII paths, and the state root lives under the profile.
2. **OPS-2:** every run record fails at its 65th replacement, and each `portal_next` call writes the run record.
3. **SVC-1:** a native profile cannot be registered, so `portal_validate` cannot run.
4. **K1:** completion requires a recipe-consumption receipt that no code produces.

C2 and C3 planning is additionally blocked for ordinary repositories (SA-1, SA-2, SA-3, SA-4, K2, SVC-8).

The daemon also wedges over time, however it is used:

- 30 days after the first snapshot capture (LC-1);
- when any registered workspace is moved or deleted (LC-2);
- after about ten native validations (K9).

The test suite and CI are red against the current source (K3–K6). The last full-suite run on record is from September 10, 2026.

The remediation fixes defects inside the existing architecture instead of replacing it. These parts are sound and must be preserved:

- fail-closed admission and egress;
- HMAC-signed compare-and-swap state;
- the journaled executor and apply journal, which never overwrite newer user edits;
- SSRF-resistant image fetching;
- symlink and junction defenses;
- exact tool/handler parity, checked when modules load;
- one canonical mapping module;
- honest capability labels.

## 3. Findings ledger

Paths are relative to `service/packages/` unless they start with `service/`, `docs/` or `.github/`.

- **V/A:** V means the main session verified the cited code; A means a reviewer traced it.
- **WS:** the workstream in section 4 that fixes the finding.

### 3.1 Critical

| ID | Area | Finding | Evidence | V/A | WS |
| --- | --- | --- | --- | --- | --- |
| K1 | Portal | Completion is unreachable. `portalCompletionIssues` requires `recipeConsumption`, which validation never sets, and `verifyConsumptionObservations` has no caller. | `ir/src/portal-run.ts:216-233`; `mcp/src/portal/native-work.ts:671-752`; `mcp/src/portal/coordinator.ts:1586-1627` | V | WS-5B |
| SVC-1 | Portal | Native profile registration always fails. Prepare drops `recipeUse` and cannot carry `observationManifest`. Registration re-prepares and compares hashes. | `mcp/src/portal/control.ts:15-20,87-97`; `mcp/src/portal/native-work.ts:164-175,791-803,974-984` | V | WS-5A |
| OPS-1 | Windows | The lease broker reads stdin in the OEM code page while Node sends raw UTF-8. Non-ASCII paths, including a state root under a user profile with Korean characters, are garbled. A JSON parse outside the inner `try` kills the broker. | `mcp/src/fs/atomic-file.ts:53-74,196-222,381-384`; `mcp/src/fs/windows-directory-lease-broker.ts:238` | V (decoding inferred) | WS-1 |
| OPS-2 | Storage | Atomic replace keeps every previous generation as `.replace-retained`, so the 65th replacement of a record fails with `REPLACE_RETAINED_CAPACITY_EXCEEDED`. Runs, the apply journal and capture progress are affected. | `mcp/src/fs/atomic-file.ts:1825-1968,2048`; `mcp/src/portal/store.ts:118-139` | V | WS-2 |
| LC-1 | Lifecycle | The startup retention sweep throws when it cleans up snapshot or grounding-graph evidence. Cleanup intents are durable and drained without isolation, so leader initialization fails permanently 30 days after the first capture. | `mcp/src/index.ts:865-882,958`; `mcp/src/execution/operation-evidence-receipt-store.ts:462-475,531-545` | V | WS-3 |
| LC-2 | Lifecycle | Moving, deleting or re-cloning one registered workspace makes the whole workspace store throw `WORKSPACE_ROOT_IDENTITY_CHANGED`. Startup, tools and `workspace remove` all fail. | `mcp/src/fs/workspace-config-store.ts:414-436,488`; `mcp/src/fs/workspace-registration-resolver.ts:22-23`; `mcp/src/index.ts:934` | V | WS-3 |
| SA-1 | C2/C3 | Convention evidence is capped at 32 entries per category, and every import counts. Truncation makes core recipe preparation throw `CORE_SOURCE_PATTERN_INCOMPLETE`. | `mcp/src/profile/conventions.ts:81-91,155-165`; `mcp/src/portal/recipes/core-source.ts:309-322` | V | WS-7 |
| SA-2 | C2/C3 | The service graph reads lockfiles and data files as text, with limits of 256 KiB per file, 8 MiB in total and 512 evidence rows per service. Exceeding any limit is a hard incompleteness that cannot be reviewed. | `mcp/src/portal/service-graph.ts:97-112,244-249` | V | WS-7 |

### 3.2 High

| ID | Area | Finding | Evidence | V/A | WS |
| --- | --- | --- | --- | --- | --- |
| K2 | C2/C3 | Reviewable issue codes do not match the codes actually emitted, so any `:id` route leaves the run in `needs-input`. | `mcp/src/portal/service-selection.ts:26-43,112-132,165`; `mcp/src/portal/service-connections.ts:564-572` | V | WS-7 |
| K3–K6 | Verification | Tool counts disagree: the registry has 128, root tests expect 125/106/99, and a CLI test expects 127. Docs-sync fails. The upstream lock, provenance and SBOM are stale. CI checks out shallow while a test runs `git show`. | `service/test/tool-contract.test.ts:79,109,121`; `service/test/docs-sync.test.ts:15-27`; `service/upstream-lock.json:32-33`; `.github/workflows/service-ci.yml:22-24` | V | WS-0 |
| K7 | Execution | Any post-dispatch error without `committed` is journaled as `failed`, even though plugin effects may continue. This covers UI timeouts, relay timeouts and socket closes. Retries can duplicate edits. | `mcp/src/execution/operation-executor.ts:1714-1772`; `mcp/src/relay/relay.ts:774-786`; `plugin/ui/sandbox/tool-bridge.ts:113-118` | V | WS-4 |
| K9 | Portal | Native-attempt and core-preparation capacity is never reclaimed. `checkRetention` walks every retained attempt, including `node_modules`, so validation stops after roughly ten Vite attempts. | `mcp/src/portal/native-lifecycle.ts:74,277-311`; `mcp/src/portal/recipes/core-preparation.ts:135-140` | V (estimate A) | WS-5D |
| CC-2 | Portal | An acquire interrupted after `mkdir` but before its identity is persisted blocks every later validation with `RETENTION_RECONCILIATION_REQUIRED`. Reconcile cannot clear it. | `mcp/src/portal/native-lifecycle.ts:124-129,203-249,296-309,564-565` | V | WS-5D |
| SVC-2 | Capture | Capture completeness is all-or-nothing, and every prototype reaction is required. A URL action, MOUSE_ENTER/LEAVE trigger, spring easing or one failed asset keeps even C4 in `needs-input`. | `mcp/src/portal/design-capture.ts:500-565`; `mcp/src/portal/interaction-evidence.ts:66-92,175-182,230`; `mcp/src/portal/coordinator.ts:922-925` | V | WS-5E |
| SVC-6 | Portal | By default, `portal_next` returns up to 16 files (1 MiB) of source plus design pages of up to 512 KiB, all in one text block. | `mcp/src/portal/coordinator.ts:1339-1346`; `mcp/src/portal/design-evidence.ts:20-32`; `mcp/src/portal/presentation.ts:5-24` | V | WS-5C |
| SVC-8 | C2/C3 | The authority inventory excludes only `.git`, `node_modules`, `.sfp` and credentials. `dist`, `build`, `.next`, `.venv` and `target` therefore count toward the 5,000-file cap. An NFD or reserved-character path aborts the scan without naming the path. | `mcp/src/portal/source-path-policy.ts:6-29`; `mcp/src/portal/source-inventory.ts:9-14`; `mcp/src/fs/repo-walk.ts:530-533` | V | WS-7 |
| VER-1 | Verification | CI never installs Firefox. The real `npm ci` plus Vite test is opt-in and never enabled. `verify:source` does not record skipped suites. | `.github/workflows/service-ci.yml:43-56`; `mcp/test/portal/preview-consumption.test.ts:76` | V | WS-0 |
| VER-3 | Verification | CLI orchestration (`connect`, `chrome-inspect`), plugin bootstrap and artifact code have no tests. The packed smoke test never contacts a daemon. | `cli/src/commands.ts`; `cli/src/plugin-bootstrap.ts`; `service/scripts/smoke-packed-mcp.mjs:39` | A (two reviews) | WS-9 |
| VER-4 | Release | Builds are not reproducible because the build ID is `Date.now()`, and the artifact manifest is not bound to a commit. `verify-artifacts` does not require runtime entries. | `service/scripts/build-server.mjs:9-11`; `service/scripts/verify-artifacts.mjs:66-80` | V | WS-9 |
| OPS-3 | Windows | One workspace file read costs about 6 config reloads, about 18 `whoami.exe` launches and more than 40 PowerShell round trips. This includes K11. | `mcp/src/fs/repo-walk.ts:239-324`; `mcp/src/fs/workspace-policy.ts:237,474`; `mcp/src/security/state-permissions.ts:170-190,684-703` | V (K11), A (chain) | WS-1 |
| OPS-4 | Portal | Design evidence paging reloads, verifies and parses the whole design on every page, so paging costs grow quadratically. | `mcp/src/portal/design-evidence.ts:53-100`; `mcp/src/portal/store.ts:82-98` | A | WS-5C |
| LC-3 | Recipes | Recipe evidence holds are never released. They are bound to an auth session that includes the leader generation, so after a handover nobody can release them, and capacity runs out for good. | `cli/src/control-recipe-client.ts:44-47`; `mcp/src/portal/recipes/evidence-hold.ts:195-199,239-254` | A | WS-4 |
| LC-4 | Execution | The receipt and egress stores re-read and fully re-verify their logs, up to 131k and 200k rows, on every locked operation. | `mcp/src/execution/operation-evidence-receipt-store.ts:975-976`; `mcp/src/execution/egress-manifest-store.ts:607-608` | A (impact suspected) | WS-2 |
| LC-5 | Lifecycle | A newer build can take leadership while server-side work runs, because "busy" checks only relay traffic. Portal runs are left stranded in `applying` or `validating-*`. | `mcp/src/election/leader-endpoints.ts:326-329`; `mcp/src/execution/execution-plane.ts:1203-1211` | A | WS-3 |
| LC-6 | Lifecycle | The lazy control handler caches a rejected initialization forever, and `/ping` always reports healthy. An unhealthy leader therefore looks healthy, and followers never take over. | `mcp/src/control/router.ts:443-451`; `mcp/src/election/leader-endpoints.ts:246-248` | V | WS-3 |
| SA-3 | C2/C3 | Files with a UTF-8 BOM fail with `SOURCE_HASH_MISMATCH`, because the decoded text is hashed and compared with the raw-byte hash. | `mcp/src/portal/service-graph.ts:131`; `mcp/src/portal/service-connections.ts:172-175` | V | WS-7 |
| SA-4 | C2/C3 | Module resolution fails on default project templates. It rejects tsconfig `references`, `tsconfig.app.json`, package `extends`, ancestor manifests, export conditions and `#imports`. | `mcp/src/portal/module-resolution.ts:247-460` | A | WS-7 |
| SA-5 | C2/C3 | False-positive diagnostics exceed the 512-review cap. Any `const x = call()` becomes an HTTP receiver, and every `.vue`, `.svelte` or Dockerfile is flagged. | `mcp/src/portal/service-connections.ts:321-326,543-550,672-677` | A | WS-7 |
| SA-6 | C2/C3 | NestJS, Next.js route handlers, tRPC, Fastify plugins and imported axios instances produce empty producer and client lists with no diagnostic, which looks like completeness. | `mcp/src/portal/service-connections.ts:437-441,498-516,646-671` | A | WS-7 |
| SA-7 | C2/C3 | Layer detection matches exact package names and treats `.sql` and `.prisma` files as assets. Persistence, migration and authorization checks may therefore never be required. | `mcp/src/portal/service-graph.ts:52-62,183,206,384`; `ir/src/portal-run.ts:318-329` | A | WS-7 |
| SA-8 | Recipes | Obligations are keyed by display name. Duplicate component names crash with `CORE_DUPLICATE_ROW`, and two references that share a name block. This is latent today. | `mcp/src/portal/recipes/core-derivation.ts:1017-1040`; `mcp/src/join/component-map.ts:141,383` | A | WS-7 |
| FID-1 | Fidelity | The default deduplicated design view drops opacity, blend mode and variable bindings for gradient, image and pattern paints and for effects. | `shared/src/design-context-dedupe.ts:75-123` | V | WS-6 |
| FID-2 | Fidelity | Mapping parses raw collector paints with a string-record schema, but their bindings are alias objects. Any bound paint therefore makes mapping unavailable. The component API shapes also differ (`definitions` versus `properties`). | `mcp/src/mapping/design-mapping.ts:212-243`; `shared/src/serialized-node.ts:35,44` | V | WS-6 |
| FID-3 | Fidelity | `componentPropertyReferences`, `overrides` and `exposedInstances` are never captured, and dedupe collapses instances that have non-visual overrides. | `shared/src/figma-capture-read.ts:85-199`; `plugin/src/handlers/get-design-context.ts:433-457` | A | WS-6 |
| FID-4 | Fidelity | Consumption checks compare raw variable values instead of rendered values, and only `fills/N/color` paths are mapped. Other bound paths become blocking requirements. | `mcp/src/portal/recipes/core-consumption.ts:152-155`; `mcp/src/portal/recipes/consumption-values.ts:58` | A (opacity scale suspected) | WS-5B |
| R2B-1 | Storage | A crash between the rename and link steps of a replace leaves a signed record missing. `get` returns null, and callers treat the record as absent. | `mcp/src/fs/atomic-file.ts:2048-2071`; `mcp/src/portal/store.ts:82-85` | V | WS-2 |
| R2A-1 | Portal | The apply journal is replaced 2N+1 times, so applying 32 or more files fails midway and `resume continue` cannot finish. This is latent behind K1. | `mcp/src/portal/native-work.ts:1558-1651`; `mcp/src/portal/store.ts:118-139` | V | WS-2 |

### 3.3 Medium

| ID | Finding | Evidence | V/A | WS |
| --- | --- | --- | --- | --- |
| K8 | Batch-style tools deep-observe the whole current page and fail above 5,000 nodes. They fail before mutating anything. | `plugin/src/mutation.ts:262,319` | V | WS-6 |
| K10 | After a failed demotion the leader keeps the port while refusing all work (a zombie leader). | `mcp/src/execution/execution-plane.ts:1193-1253` | V | WS-3 |
| K11 | `whoami.exe` runs on every verification, and `whoami` and `icacls` are called by bare name. Unauthenticated pairing requests can trigger it (SEC-C1). | `mcp/src/security/state-permissions.ts:105-121,170-190,751-757` | V | WS-1 |
| K12 | Pairing state grows without bound. A generation-fence log over 1 MiB becomes `JOURNAL_CORRUPT`. | `mcp/src/execution/operation-journal.ts:1319-1328` | V | WS-2 |
| K13 | The workspace policy rejects `/` separators on Windows. | `mcp/src/fs/workspace-policy.ts:176-186` | V | WS-1 |
| K14 | An apply preflight failure ends in the `conflict` dead end, and the one-hour budget also covers apply and applied validation. | `mcp/src/portal/native-work.ts:268,1496-1501`; `mcp/src/portal/coordinator.ts:1653-1658` | A | WS-5C |
| K15 | Native validation is Windows-only and supports only `npm ci`. The listener check matches the English word `LISTENING`. | `mcp/src/portal/native-artifacts.ts:463,491-511`; `mcp/src/portal/preview-listener.ts:20` | A | WS-1, WS-7 |
| K16 | Mapping gaps. Graphs have no local catalogs. Invalidation is over-broad. Same-name tokens with different values are graded "reuse". Walk truncation is ignored. | `mcp/src/snapshot/build-grounding-graph.ts:104`; `mcp/src/mapping/design-mapping.ts:274-286`; `mcp/src/join/token-map.ts:614-635` | A | WS-6 |
| K17 | Only 7 of 34 recipes execute, and the CLI recipe engine cannot be reached. Pending helpers are labeled `alias`. | `mcp/src/portal/recipes/definitions.ts:372-394`; `mcp/src/portal/recipes/feature-inventory.ts:302-305` | A | WS-9 |
| K18 | CLI issues. Chrome with debugging off gives a raw TypeError. One poll error cancels the operation. The stale-daemon check runs only in `connect`. | `cli/src/chrome-endpoint.ts:27,35`; `cli/src/control-client.ts:264-272` | A | WS-5E |
| K19 | Plugin handlers still write after awaiting without re-checking cancellation, and unbounded read results drop the socket. | `plugin/src/handlers/set-text.ts:24-26`; `plugin/src/serializer.ts:771-778` | A | WS-6 |
| K21 | Scripts and tests spawn processes without `windowsHide`. | `service/scripts/verify-upstream-lock.mjs:188,194`; `service/scripts/vendor-upstreams.mjs:130,136` | A | WS-0 |
| K23 | Each validation fully re-hashes the same artifacts many times (OPS-C2 extends this to provisioned `node_modules`). | `mcp/src/portal/native-work.ts:435,506,540`; `mcp/src/portal/native-runner.ts:343,442,493` | A | WS-5D |
| K24 | The credential path policy excludes ordinary modules such as `credentials.ts` and `secret.ts`, and also `.env.example`. | `mcp/src/portal/source-path-policy.ts:11-18` | V | WS-7 |
| K25 | Admission busy-waits. A rejected control initialization is cached. Control calls ignore abort. | `mcp/src/execution/execution-plane.ts:1029-1037`; `mcp/src/control/router.ts:443-451` | V (router) | WS-3 |
| K26 | Journal recovery validates historical rows against the current tool registry. | `mcp/src/execution/operation-journal.ts:162,1166,1229-1232` | A | WS-3 |
| SVC-3 | MCP portal tools need an unambiguous workspace, C3 registers several, and only `workspace default` mitigates it. | `mcp/src/execution/mcp-workspace-binding.ts:34-45`; `mcp/src/execution/mcp-invocation-adapter.ts:95-99` | V | WS-5C |
| SVC-4 | `ping` and `list_files` are pre-authorized with the `secret` class, so external-model consent always denies them. The server instructions still tell agents to ping first. | `mcp/src/policy/result-egress-policy.ts:39,61,325-331`; `mcp/src/policy/policy-engine.ts:110-126`; `mcp/src/instructions.ts:15` | V | WS-5C |
| SVC-5 | The daemon's Chrome transport never recovers until a restart. | `mcp/src/portal/chrome-transport.ts:50,94,101-107,176-188`; `cli/src/browser-session.ts:130-134` | V | WS-5E |
| SVC-7 | Repair feedback is blind: the preview report is sent only on success. Each candidate needs a new owner registration. | `mcp/src/portal/preview-worker.ts:64-66,180-203`; `mcp/src/portal/coordinator.ts:1524-1540` | V | WS-5A |
| SVC-9 | The visual gate requires exact dimensions and at most 3% difference, with no per-root waivers. | `mcp/src/portal/visual-evidence.ts:136-137,196-197` | V | WS-5E |
| SVC-10 | The CLI desktop plan uses target `none`, which gives `TARGET_REQUIRED`. The one-use pair code is re-submitted on relaunch. | `cli/src/portal-commands.ts:197`; `mcp/src/portal/capture-source-admission.ts:58`; `cli/src/plugin-bootstrap.ts:10-24` | V | WS-5E |
| SEC-1 | The plugin approval UI labels native execution and Chrome reads as "read design information", and prompts show argument names, not values. | `plugin/ui/components/TabApprovals.vue:9-17`; `mcp/src/policy/approval-prompt.ts:28-44` | V | WS-8 |
| SEC-2 | The global pairing limiter is charged before the challenge is looked up, so unauthenticated callers can lock pairing out. | `mcp/src/security/pairing-manager.ts:367-372,723-771` | V | WS-8 |
| SEC-3 | Pre-authentication WebSocket frames of up to 64 MiB are msgpack-decoded without limits. | `mcp/src/relay/relay.ts:122,131,442-452`; `shared/src/codec.ts:8-12` | V (allocation suspected) | WS-8 |
| SEC-4 | The prompt calls Figma annotations "authoritative ground truth", and nothing marks design text or repository content as untrusted. | `mcp/src/prompts/figma-to-code.ts:23`; `mcp/src/instructions.ts` | V | WS-8 |
| CC-1 | Pre-dispatch cancel races the `dispatched` append. The egress finalizer conflicts, the row gets stuck and the reservation leaks. | `mcp/src/execution/operation-executor.ts:953-956,1556-1570,2003-2050`; `mcp/src/execution/operation-journal.ts:1066-1074` | V | WS-4 |
| CC-3 | `portal_resume(reconcile: 'none')` resurrects runs in `cancel-requested` or `validating-*`. | `mcp/src/portal/coordinator.ts:294-346,441-477,552-568` | V | WS-4 |
| CC-4 | An unhandled `demotionSettlement` rejection can crash the leader. | `mcp/src/execution/operation-executor.ts:976-1011` | V | WS-3 |
| VER-2 | The plugin compatibility check always passes. Versions and `PROTOCOL_VERSION` are never bumped (LC-8), and the plugin is excluded from the build identity. | `shared/src/version.ts:56,163-167`; `service/scripts/build-identity.mjs:6-9` | V | WS-3 |
| VER-5 | The tool list is maintained by hand in 7 or more places. `plugin-contract.json` lacks 3 tools, and the smoke tests compare 128 against 125. | `mcp/test/plugin-contract.json`; `cli/test/admin-commands.test.ts:13` | V | WS-0 |
| VER-6 | `knip` runs in non-production mode, which hides dead production code. | `service/package.json:12,23` | V | WS-0 |
| VER-7 | About 7,100 lines of embedded programs, plus the root tests and scripts, are never type-checked or linted. | `service/tsconfig.json`; `service/package.json:22` | V | WS-9 |
| VER-8 | Packaging and test git commands inherit the global git configuration (signing, hooks). | `service/scripts/package-artifacts.mjs:54-78` | V | WS-0 |
| VER-C1 | The runtime-specifier allowlist is pinned by line and column. The staged change-manifest check is unwired, and no change manifest exists after September 10. | `service/vendor-allowed-figwright-strings.json`; `service/scripts/verify-staged-change-manifest.mjs` | A | WS-0 |
| OPS-5 | PowerShell helpers have 2–5 s cold-start budgets that include Add-Type, and retire after 5 s idle. | `mcp/src/fs/windows-boundary-probe-worker.ts:566-568,751-758`; `mcp/src/fs/atomic-file.ts:204-219,520` | A (suspected) | WS-1 |
| OPS-6 | Tools that run synchronously for up to an hour exceed common MCP client timeouts. | `shared/src/tool-budgets.ts:48-53`; `mcp/src/portal/coordinator.ts:1571-1580` | A (client-dependent) | WS-5C |
| OPS-8 | Helper stderr is discarded, and localized PowerShell errors are decoded with the wrong code page. | `mcp/src/fs/windows-directory-lease-broker.ts:152-160`; `mcp/src/portal/native-runner.ts:709` | A | WS-1 |
| OPS-9 | Every reparse point is rejected, which rejects folders backed by OneDrive. | `mcp/src/fs/workspace-policy.ts:141-146` | A (suspected) | WS-1 |
| OPS-10 | EACCES on the fixed port 3055 kills the server before stdio starts. | `mcp/src/election/election.ts:136-139`; `mcp/src/index.ts:1412` | A | WS-1 |
| OPS-C1 | Add-Type, Constrained Language Mode or AMSI restrictions break every lease-guarded operation. | `mcp/src/fs/atomic-file.ts:53-203` | A (environmental) | WS-1 |
| LC-7 | A missing owner principal key is silently regenerated, which invalidates all signed state. There is no keyring or rotation. | `mcp/src/security/principal-derivation.ts:96-98,168` | A | WS-2 |
| LC-8 | The leader is chosen by build timestamp, so an older build can lead over newer state. | `mcp/tsdown.config.ts:13`; `mcp/src/election/election.ts:193` | A | WS-3 |
| LC-9 | Leases are bound to an auth session that includes the leader generation. A handover strands the lease and costs an attempt. | `mcp/src/portal/coordinator.ts:1221-1239` | V | WS-4 |
| LC-10 | Follower errors omit the operation ID. `outcome-unknown` rows are never compacted and block workspace removal. | `mcp/src/index.ts:1505-1508`; `mcp/src/execution/operation-journal.ts:83-91,896` | A | WS-3 |
| LC-11 | There is no supported state reset. An extra ACE on the state root kills every process at startup. | `mcp/src/security/state-permissions.ts:344-348,755-757` | A | WS-2 |
| SA-9 | HTTP contracts require an undocumented `portal.routes.json`, and there is no contract matching across sources. | `mcp/src/portal/service-graph.ts:449`; `mcp/src/portal/service-connections.ts:858-866` | A | WS-7 |
| SA-10 | Layers from reviews are treated as provided by the source, which suppresses construct obligations for C3. | `mcp/src/portal/service-selection.ts:188`; `mcp/src/portal/recipes/core-derivation.ts:846-848` | A | WS-7 |
| FID-5 | Scope checks demand CSS values that correct code cannot produce (gap, `normal`, ellipse radius). | `mcp/src/portal/recipes/core-consumption.ts:174,195`; `mcp/src/portal/recipes/consumption-values.ts:101` | A | WS-5B |
| FID-6 | The serializer drops HUG/FIXED sizing and the constraints of absolutely positioned children. | `plugin/src/serializer.ts:548,570` | A | WS-6 |
| FID-7 | The transform model loses flips and bounding boxes. | `plugin/src/serializer.ts:417-419,724-725` | A | WS-6 |
| FID-8 | Mixed text runs, leading trim, lists and text case are lost. | `plugin/src/serializer.ts:697-705`; `shared/src/figma-capture-read.ts:267-279`; `plugin/src/handlers/get-styles.ts:106-116` | A | WS-6 |
| FID-9 | PNG oracles use render bounds, so shadows enlarge them, and color-profile chunks are dropped. | `shared/src/figma-capture-assets.ts:96-100`; `mcp/src/portal/preview.ts:63` | A (P3 suspected) | WS-5E |
| R2B-2 | A prepared profile can exceed the 9 MiB control request limit. This constrains the SVC-1 fix. | `mcp/src/control/router.ts:6` | V | WS-5A |
| R2B-3 | Consumption batch splitting ignores the 4 MiB preview channel limit. | `mcp/src/portal/preview-channel.ts:33,55`; `mcp/src/portal/recipes/core-consumption.ts:323-330` | A | WS-5B |
| R2B-4 | Profile registration is create-only, so a browser update that changes an artifact makes the candidate unregistrable. | `mcp/src/portal/native-work.ts:804-809` | A | WS-5A |
| R2B-5 | Repair attempts are counted per lease, not per submission. | `mcp/src/portal/coordinator.ts:1229-1233` | V | WS-4 |
| R2A-2 | Reverting a file and re-applying the identical change fails, because sidecar names derive only from the digests. | `mcp/src/fs/atomic-file.ts:1825-1828,1990-2004` | A | WS-2 |
| R2A-3 | Pre-image backups pile up in user project trees and are later read in as source. | `mcp/src/portal/native-work.ts:1526-1535,1641` | A | WS-2 |

### 3.4 Low

| ID | Finding | Evidence | V/A | WS |
| --- | --- | --- | --- | --- |
| K20 | Status documents are stale or inconsistent (tool counts, paths, branch names, the Superpowers contradiction). | `docs/implementation-status-ko.md`; `docs/plans/2026-09-14-remaining-work-plan.md:13,233` | A | WS-9 |
| K22 | `portal_next` after finishing consumes an attempt, and submitted candidate files cannot be removed. The hold leak is covered by LC-3. | `mcp/src/portal/coordinator.ts:1221-1241,1462-1464` | A | WS-4 |
| SEC-5 | The plugin UI accepts `pluginMessage` from any window. | `plugin/ui/sandbox/messaging.ts:52-58` | V | WS-8 |
| SEC-6 | The retained CDP proxy uses a denylist and stays open for the daemon's lifetime. | `mcp/src/portal/chrome-transport.ts:13-23` | V | WS-8 |
| SEC-C2 | `/follower/challenge` admits requests without an Origin header, such as browser no-cors requests. | `mcp/src/election/leader-endpoints.ts:241-263` | V | WS-8 |
| CC-5 | A post-apply bookkeeping failure is recorded as `conflict`. | `mcp/src/portal/coordinator.ts:1631-1659` | V | WS-4 |
| CC-6 | Cancelling during an approval returns `OperationIdConflict` and leaves the prompt open. | `mcp/src/execution/operation-executor.ts:1175-1182` | V | WS-4 |
| CC-7 | The compaction rename does not retry on EPERM or EBUSY. | `mcp/src/execution/operation-journal.ts:1281-1290` | V (antivirus behavior suspected) | WS-2 |
| VER-9 | Operator documentation contradicts the code: `tools list`, Firefox installation, and lifecycle scripts in the `.ps1` helpers. | `service/README.md:9`; `service/connect-desktop.ps1:10` | A | WS-9 |
| FID-10 | VIDEO and PATTERN fills produce no assets, yet the capture is marked complete. | `mcp/src/portal/design-normalization.ts:718` | A | WS-6 |
| R2A-4 | MCP tool descriptions do not say which portal steps need the CLI owner channel. | `mcp/src/tools/portal.ts:6-19` | A | WS-5C |

## 4. Workstreams

### WS-0: Truthful baseline

Findings: K3–K6, K21, VER-1, VER-5, VER-6, VER-8, VER-C1. Size: S–M. Depends on: nothing.

1. **Generated tool contracts.** Add one `contracts:update` script that generates three artifacts from `ALL_TOOL_SPECS`:
   - `capabilities/union-manifest.json`;
   - `packages/mcp/test/plugin-contract.json`;
   - the README count sections.

   Tests assert derived equalities: the registry equals the 125 upstream canonical tools plus an explicit list of service-local tools. CI runs the generator followed by `git diff --exit-code`. Do not bump literal counts.
2. **docs-sync.** Either generate the tool-count line in `service/README.md` from the same source, or point the test at the generated section.
3. **Provenance.** Do this in a working copy with `code-kb/` re-cloned at the pinned SHAs:
   - Record a change-manifest slice covering `8a8dd01`, `8a0b4c7` and `0a0f3ad`.
   - Refresh `upstream-lock.json`.
   - Regenerate the SBOM and notices with `SOURCE_DATE_EPOCH` set to the commit time.
   - Anchor the Figwright string allowlist by content instead of by line and column.
   - Wire up `verify-staged-change-manifest`.
4. **CI.**
   - Set `fetch-depth: 0`.
   - Take the Node version from `.node-version`.
   - Install with `--ignore-scripts`, as documented.
   - Install Playwright Firefox.
   - Split the gates into separate steps with `if: always()`.
   - Run `verify-upstream-lock --with-upstreams`.
   - Add a drift check after regenerating the SBOM and notices.
   - Remove the Windows-only npm/pnpm entry-path assumptions (`release-common.mjs:49-50`, `smoke-packed-mcp.mjs:10`).
   - Add a nightly job with `SFP_NATIVE_VITE_ACCEPTANCE=1`.
5. **Visible skips.**
   - Required suites fail when prerequisites are missing, unless `SFP_ALLOW_SKIP=<suite>` is set.
   - `run-source-checks` records skipped tests from the Vitest JSON report.
   - Platform guards use `ctx.skip()` instead of a bare `return`.
6. **No pop-ups.**
   - Add `windowsHide: true` to every spawn in `service/scripts` and in the tests.
   - Give packaging and test fixtures a hermetic git environment: an empty `GIT_CONFIG_GLOBAL`, no hooks or templates, `commit.gpgsign=false` and `--no-verify`.
7. **Static gates.** Run `knip --production`, and type-check `scripts/` and the root `test/` directory through a `checkJs` configuration.
8. **Expected-failure tests.** Add an `it.fails` reproduction for each critical finding. Each becomes a normal test when its fix lands.

Exit gate:

- CI is green on `windows-latest`.
- `verify:source` is green in a separate Windows working copy. Run it only with the owner's confirmation.

### WS-1: Windows host substrate

Findings: OPS-1, OPS-3, K11, SEC-C1, OPS-5, OPS-8, OPS-9, OPS-10, OPS-C1, K13, K15 (listener detection). Size: M. Depends on: WS-0.

1. **OPS-1: directory-lease protocol v2.**
   - Node sends ASCII-only requests, with each path as base64 of its UTF-16LE bytes.
   - The script uses explicit UTF-8 stdin and stdout streams without a BOM.
   - It parses each request inside the per-request `try`.
   - It opens paths with the `\\?\` prefix and echoes the SHA-256 of the path it opened. Node closes the broker on any mismatch.
   - Bump the protocol literal (`atomic-file.ts:194`, `native-artifacts.ts:69`). Version-1 artifact authorities fail with an explicit re-prepare error.
   - Apply the same stream setup to the boundary worker and to the test-only probes in `state-permissions.ts`.
2. **OPS-3 and K11: process cost.**
   - Cache the current user SID for the life of the process.
   - Pin `whoami.exe` and `icacls.exe` to `%SystemRoot%\System32`.
   - Snapshot the workspace registry once per operation.
   - Within one operation, cache boundary verdicts per path, device and inode.
   - Take one lease per root per operation.
   - Never cache ACL verdicts across operations.
   - Reject unknown pairing challenge IDs in memory, before any disk or ACL work (SEC-C1).
3. **OPS-5 and OPS-8: helper budgets and errors.**
   - Give helpers a 30-second startup budget with pre-warming, retire them after minutes of idleness rather than 5 s, and back off exponentially.
   - Cache process-identity probes per PID.
   - Keep the first 4 KiB of helper stderr in errors, and force UTF-8 output in every helper script.
4. **OPS-C1: restricted PowerShell.** Probe for Add-Type and Constrained Language Mode at startup, and fail with `HOST_POWERSHELL_RESTRICTED`. Never fall back to lease-less writes.
5. **K13.** Normalize `/` to `\` at MCP admission on Windows, before policy checks.
6. **OPS-9.** Accept cloud-file reparse tags (OneDrive placeholders), keep rejecting name-surrogate reparse points, and give an explicit OneDrive message.
7. **OPS-10.** Treat EACCES or EPERM on bind as a conflicted state, with an `excludedportrange` diagnosis. Keep stdio alive, and allow a configured port.
8. **K15.** Detect preview listeners without parsing localized `netstat` state text.

Tests:

- A Windows CI lane with non-ASCII `TEMP` and `LOCALAPPDATA`. Code page 437 already reproduces OPS-1.
- A native soak on the owner's machine: 1,000 leases under the Korean-named user profile, with no visible windows.
- An instrumented inventory of 2,000 files that launches no `whoami.exe` after the first call.

### WS-2: Durable store integrity

Findings: OPS-2, R2B-1, R2A-1, R2A-2, R2A-3, CC-7, K12, LC-4, LC-7, LC-11. Size: M. Depends on: WS-1.

1. **Retention modes.** `replace()` requires `retention: 'discard' | 'keep'`.
   - `discard` is for owner-state stores, document bindings, and snapshot and graph storage. After durable publication, it verifies that the retained file is exactly the previous generation and unlinks it. If the unlink fails, the failure is logged, not reported as a failed commit.
   - `keep` stays for user-target writes until item 3 relocates them.
   - Recipe holds stay on `keep` until decision D3.
2. **Recovery.** Add `reconcileReplaceArtifacts(target)`, which runs under the path mutex. It:
   - rolls forward interrupted publications;
   - removes retained aliases that share the target's inode;
   - collects legacy retained generations.

   `PortalStore.create` refuses while interrupted artifacts exist (R2B-1).
3. **User-target sidecars.**
   - Move apply pre-images into content-addressed owner-state backups.
   - Add a per-intent nonce to sidecar names (R2A-2).
   - Exclude atomic sidecars from source inventories (R2A-3).
4. **Apply journal.** Use an append-only intent log, or bounded generations pruned after each durable step, so that 300-file applies and `resume continue` complete (R2A-1).
5. **Journal hygiene.**
   - Retry the compaction rename on EPERM or EBUSY.
   - Treat a compaction failure after a durable tombstone as non-fatal (CC-7).
   - Prune pairing state and compact the generation-fence log (K12).
6. **Log verification.** The receipt and egress stores keep a verified in-memory index and verify only appended rows (LC-4).
7. **Keys and reset.**
   - Envelopes carry a key ID, and a keyring supports rotation.
   - A missing key with existing dependent state fails with `STATE_KEY_MISSING`.
   - Add supported `state reset` and `rotate-key` commands.
   - An owner-invoked ACL repair removes foreign ACEs instead of the process dying (LC-7, LC-11).

Invariants:

- The compare-and-swap check before the rename is unchanged.
- Never delete bytes that are not proven to be our own.
- During an interrupted publication, apply recovery still sees the retained and prepared files.

Tests:

- Crash injection at every replace hook, plus a forced `link` EPERM. A new process must read A or B, never null.
- 5,000 sequential run updates.
- A 300-file apply killed at file 150 and then resumed.
- Change A→B, revert, then A→B again.
- After an apply, `git status --porcelain` lists only candidate paths.
- The key is deleted while state exists, and startup refuses.

### WS-3: Leader lifecycle and retention

Findings: LC-1, LC-2, LC-5, LC-6, K10, CC-4, K25, K26, LC-8, VER-2, LC-10. Size: M.

Depends on: WS-2 for store changes. K10 fail-stop also depends on the WS-5D generation sweep.

1. **LC-1: retention sweep.**
   - Implement cleanup for `snapshot` and `grounding-graph` evidence.
   - Treat a missing path or an unregistered workspace as already removed.
   - Isolate each cleanup item, and quarantine intents that keep failing.
   - Run the sweep after initialization, not inside it.
2. **LC-2: workspace store.** Validate workspace rows individually and mark failures `unavailable`. Allow removing unavailable rows, and add a rebind command.
3. **LC-5: step-down.** "Busy" includes executor work and native runs. Drain in-flight work before stepping down.
4. **LC-6 and K25: health and admission.**
   - Reset a rejected lazy initialization, and report runtime health in `/ping`.
   - Yield leadership after repeated initialization failures.
   - Replace the `setImmediate` admission loop with a promise.
   - Make control tool calls honor abort.
5. **K10 and CC-4: failed demotion.**
   - On a demotion durability failure, fail-stop: close the listener and exit. Journal recovery turns `dispatched` into `outcome-unknown`.
   - Attach a handler to `demotionSettlement`.
   - Add a process-level rejection logger.
6. **LC-8 and VER-2: versioning.**
   - Advertise a state-format version, and refuse leadership over newer state.
   - Include a schema hash in the follower handshake and the plugin build hash in `hello`.
   - Bump `PROTOCOL_VERSION` whenever wire schemas change.
7. **LC-10 and K26: operation IDs and recovery.**
   - Include the operation ID in every error, and make a retry with the same ID return the stored outcome.
   - Add bulk abandon for `outcome-unknown` rows.
   - Recover historical journal rows with a reader that tolerates retired tools.

Tests:

- A 31-day-old snapshot receipt whose `.sfp` folder was deleted.
- A registered workspace that was deleted.
- A newer build started during `portal_apply`.
- Injected single and persistent initialization failures.
- An older build started over newer state.

### WS-4: Execution-plane correctness

Findings: K7, CC-1, CC-3, CC-5, CC-6, LC-3, K22, LC-9, R2B-5. Size: M.

Depends on: WS-0. It can run in parallel with WS-1 and WS-2, because the files are disjoint.

1. **K7: post-dispatch failures.**
   - After dispatch, any failure of an effectful tool is recorded as `outcome-unknown` unless the code proves the effect never started.
   - Add a distinct plugin bridge timeout code.
   - The plugin reports late results after a cancel.
2. **CC-1: cancel race.**
   - Set a synchronous per-operation dispatch claim before awaiting the journal, and have cancel consult that claim.
   - Only the pre-dispatch winner finalizes egress, and only then does it transition the journal.
   - A journal compare-and-swap on the expected status is defense in depth only.
   - Reset memoized settlements when they reject.
   - `finalizeUnknown` reuses an existing finalizer and always releases the reservation.
3. **CC-3.** `portal_resume(reconcile: 'none')` rejects runs in `cancel-requested` or `validating-*`, and runs with a live job.
4. **CC-5 and CC-6.**
   - Errors raised after `work.apply` resolves are marked committed.
   - `rejectToolApproval` is idempotent for settled rows.
   - Cancelling a pending portal run also cancels the broker prompt.
5. **LC-3 and K22: recipe holds.**
   - Bind holds to the actor and the plan.
   - Release them on completion or abort.
   - Expire unverified holds and prune released rows.
6. **LC-9 and R2B-5: leases.** Issue a lease token that is valid across sessions of the same owner, and count generation attempts per submission.

Tests:

- A latch-based race test for each scenario.
- A mid-run handover keeps the lease and the attempt count.

### WS-5: C4 end to end on the owner's machine

Size: L. Depends on: WS-1, WS-2 and WS-4. WS-5B also depends on WS-5A.

**WS-5A: profile preparation and registration** (SVC-1, R2B-2, R2B-4, SVC-7).

- **Server-side storage.** Store prepared profiles server-side at `prepared-profiles/<preparedHash>`, with the owner, plan, candidate and expiry, a per-owner cap and a TTL.
- **Prepare** returns the hash plus a paged review of the prepared profile. The review shows:
  - executables and arguments;
  - the working directory and timeouts;
  - lifecycle scripts and outputs;
  - split core commands and their assertions;
  - environment variable names and service values;
  - external artifacts and authority hashes;
  - the recipe-use status;
  - every recipe review.
- **Register** takes `{planId, preparedHash, actionNonce}`, and the nonce's request hash covers both values. Keep the re-prepare comparison as the time-of-check guard.
- **Re-registration.** Allow compare-and-swap re-registration when authorities change (R2B-4). Pin the validation browser (decision D4).
- **Repair feedback (SVC-7).**
  - Return the blocking requirements from prepare.
  - Send the per-screen preview report on failure, and expose diff images.
  - Add `reprepare --from <hash>`. It reuses the reviewed commands for a new candidate, but each candidate still needs its own nonce.
- **Determinism.** Make preparation idempotent and locale-independent: replace the `localeCompare` ordering.

**WS-5B: consumption receipt, remaining-work Task 6E** (K1, R2B-3, FID-4, FID-5).

- After output and module evidence, and after `assertPreparedProfile`:
  - parse each preview receipt's consumption report and require the batch hashes to match;
  - verify every check with a refactored, per-check `verifyConsumptionObservations`, and require full coverage;
  - emit `recipeConsumption` in exactly the shape `portalCompletionIssues` checks.
- **On failure:** emit no receipt. Add a required failed `core-consumption` check with a bounded list of check IDs and error codes, which doubles as repair feedback.
- **Channel limits:** split batches by encoded size so they respect the 4 MiB preview channel (R2B-3).
- **Values (FID-4, FID-5):**
  - Compare rendered values, scaling opacity variables.
  - Reduce bindings to one check per rendered CSS property.
  - Emit gap checks only for auto-layout frames, using per-axis longhands.
  - Skip radius and box checks for ellipses and vectors.
  - Treat `normal` as zero where that is equivalent.
- Never relax the gate for C4, and never trust worker flags.

**WS-5C: run protocol and agent surface** (SVC-6, OPS-4, K14, OPS-6, SVC-3, SVC-4, R2A-4).

- **SVC-6 and OPS-4: evidence paging.**
  - `portal_next` only claims or renews the lease and returns an envelope of at most 64 KiB, with section cursors.
  - Evidence moves to read-only, paged `portal_status` sections of at most 64 KiB each.
  - Those sections are served from a cached, verified design index and never touch the run record.
- **K14.** Apply preflight failures with `committed=false` return to a recoverable `blocked` state. Generation, validation and apply get separate bounded budgets.
- **OPS-6.** Long operations return an operation ID immediately, and clients poll `portal_status`. Document the client timeout settings.
- **SVC-3.** Post-plan portal tools resolve the workspace from the plan or run. Only `portal_plan` requires a default.
- **SVC-4.** Redact `fileKey` so that `ping` and `list_files` never need the `secret` class. Name the `egress allow` command in errors, and make consent renewable.
- **R2A-4.** Tool descriptions state which steps need the CLI owner channel.

**WS-5D: native lifecycle** (K9, CC-2, K23, OPS-C2).

- **Usage accounting.** Record disk usage when an attempt finishes, and sum the recorded values at admission. Walk only legacy attempts.
- **Reclaimer.**
  - Reclaim released attempts that no non-terminal run references.
  - Keep quarantined attempts and the latest completed attempt per plan.
  - Delete without following junctions.
- **CC-2.**
  - Persist the directory identity before exposing the directory: create it under a temporary name, persist the identity, then rename.
  - `checkRetention` quarantines unverifiable attempts instead of failing globally.
  - At leader start, a sweep quarantines attempts from other generations once the recorded process is proven gone.
- **K23 and OPS-C2.** Hash external artifacts once per validation, and inventory provisioned dependencies once.

**WS-5E: capture robustness** (SVC-2, SVC-5, SVC-9, FID-9, SVC-10, K18).

- **SVC-2.**
  - Separate blocking issues from advisory ones.
  - Map URL actions to external links, and MOUSE_ENTER/LEAVE to hover.
  - Allow owner-recorded exclusions per reaction and per root.
  - Return the actual blocking codes with matching instructions.
- **SVC-5.** On a transport failure, discard the transport and the browser, and recreate both on the next capture with backoff. Never bypass Chrome's consent prompt.
- **SVC-9 and FID-9.**
  - Export oracles with absolute bounds, and store the render bounds separately.
  - Record the document color profile.
  - Allow per-root waivers for frames that are not screens.
  - Apply the height policy chosen in decision D2.
- **SVC-10.**
  - The CLI desktop plan uses the `portal-source` selector.
  - Persist the plugin's resume credential in client storage.
  - Remove the one-use pairing code after it is used.
- **K18.**
  - Report a typed `CHROME_CONNECTION_REQUIRED` when remote debugging is off.
  - Retry transient poll errors.
  - Run the stale-daemon check for every command.

Exit gate: two consecutive C4 runs of the supplied design complete on the owner's machine, with the profile path containing Korean characters, without restarting the daemon.

- Each run goes through: plan, prepare, register by hash, candidate validation, apply, applied validation, and `completed`.
- The evidence is recorded in an English review document.

### WS-6: Design-data fidelity

Findings: FID-1, FID-2, FID-3, FID-6, FID-7, FID-8, FID-10, K16, K19, K8. Size: M–L.

Depends on: WS-0. It can run in parallel with WS-4 and WS-5, because it touches plugin and shared files. FID-4 and FID-5 live in WS-5B.

1. **FID-2: one adapter.** Add one adapter from the raw capture to the mapping projection: alias objects become IDs, and `definitions` becomes `properties`. Core-source, the inspector and the snapshot builder all use it.
2. **FID-1: paint detail.** Carry opacity, blend mode, and bindings per paint, per gradient stop and per effect through the simplified types. In-process consumers use an undeduplicated projection.
3. **FID-3: overrides.**
   - Capture `componentPropertyReferences`, `overrides` and `exposedInstances`.
   - Do not deduplicate instances that have non-visual overrides or different modes.
4. **Serializer and assets.**
   - FID-6: emit sizing modes, and the constraints of absolutely positioned children.
   - FID-7: emit the transform, or the bounding box with flip flags.
   - FID-8: add the missing text-segment triggers, leading trim, lists and text-style fields.
   - FID-10: plan assets for VIDEO and PATTERN fills, or mark the capture partial.
5. **K16: mapping.**
   - Give persisted graphs the same local catalogs as `token_map`.
   - Scope invalidation to the affected rows.
   - Flag same-name tokens that have different values.
   - Propagate walk truncation as incompleteness.
6. **K19 and K8: handlers.**
   - Add a shared cancel check before the first write in every handler.
   - Return a typed `RESULT_TOO_LARGE` instead of dropping the socket.
   - Observe only the requested targets, not the whole current page.

Tests:

- One fixture per case above.
- The Chrome and Desktop routes produce identical normalized observations for the same fixture.

### WS-7: C2/C3 service analysis

Findings: K2, SA-1 through SA-10, SVC-8, K24, K15 (package managers). Size: L.

Depends on: WS-5 for integrated acceptance. Analysis work can start after WS-0.

Decision D1 comes first. Publish a supported-stack matrix, for example:

- Express, Fastify, NestJS or Next.js;
- Prisma, Drizzle or `pg`;
- React or Vue with Vite.

Outside the matrix, emit explicit unsupported diagnostics. Completion claims apply only inside the matrix. The round-2 verdict was that the current analyzer design cannot reach the full-stack promise without the following work.

1. **K2 and SA-5: diagnostics and reviews.** Keep one diagnostic-code registry, checked exhaustively. Owners review by rule (code plus path pattern) instead of by byte offset, and reviews survive a re-clone.
2. **SA-1.** Record convention evidence as a sample with counts. Block only on unread effective inputs.
3. **SA-2.**
   - Treat lockfiles and large data files as hashes only.
   - Aggregate evidence per service, specifier and kind.
   - Emit one configuration candidate per configuration file.
4. **SA-3.** Decode tolerantly of a BOM, or compare raw-byte hashes.
5. **SA-4: module resolution.** Support:
   - project references and `tsconfig.app.json`;
   - package `extends` and ancestor manifests;
   - export conditions treated as alternatives, with a reviewable `BUILD_OUTPUT_MISSING`;
   - `#imports`.
6. **SA-5 and SA-6: frameworks.**
   - Create receivers only from proven HTTP factories.
   - Parse `.vue` and `.svelte` script blocks.
   - Add framework adapters for the matrix.
   - Emit `UNSUPPORTED_FRAMEWORK:<pkg>` when a known framework is imported and no adapter handles it.
7. **SA-7 and SA-10: layers.**
   - Use a dependency-category table that covers subpaths and framework wrappers.
   - Server files of full-stack frameworks count as backend, and schema files count as data.
   - Separate "relevant to the review" from "provided by the source".
   - C3 always emits construct obligations.
8. **SA-8.** Key obligations by mapping row ID, and let the owner select the source for each mapping.
9. **SA-9.**
   - Match contracts across sources at plan level.
   - Build routing bindings from reviews.
   - Normalize trailing slashes.
   - Document or remove `portal.routes.json`.
10. **SVC-8 and K24: inventory policy.**
    - Record generated-output directories (`dist`, `build`, `.next`, `.venv`, `target`) as explicit exclusions.
    - Name offending paths, escaped.
    - Return plan issues instead of throwing.
    - Narrow credential matching to credential file formats and names, not ordinary modules.
11. **K15.** Support pnpm and yarn install commands in native profiles.

Exit gate:

- Representative fixtures for each matrix stack reach `waiting-agent` with no owner reviews for ordinary code.
- Negative fixtures produce explicit unsupported diagnostics.
- C2 fixtures raise `MISSING_REQUIRED_CHECK` for persistence, API and authorization where those apply.

### WS-8: Security hardening

Findings: SEC-1 through SEC-6, SEC-C2. Size: S–M. Depends on: WS-0. It can run in parallel with WS-4.

1. **SEC-1: approval honesty.**
   - Give every effect an explicit label, checked exhaustively; an unknown effect disables approval.
   - Show resolved values in prompts: profile ID, executable hashes, output paths, URL host and Chrome target.
   - Keep the destructive and broad qualifiers.
   - Reject bidi and format characters in portal paths, and render labels isolated.
2. **SEC-2: pairing limiter.**
   - Count attempts per challenge.
   - Reject unknown challenge IDs in memory.
   - Throttle per connection.
   - Mint bootstrap tickets through an internal path.
3. **SEC-3: pre-auth frames.**
   - Cap unauthenticated frames at 16 KiB before decoding.
   - Set decoder length and depth limits.
   - Cap the number of unauthenticated sockets.
4. **SEC-4: untrusted data.** State in the prompt and the server instructions that Figma text, repository content and command output are untrusted data. Wrap such fields in an untrusted envelope in tool results.
5. **SEC-5.** Accept `pluginMessage` only from `window.parent`.
6. **SEC-6: CDP proxy.**
   - Use a method allowlist.
   - Bind sessions to the selected Figma target.
   - Release the connection after capture or after an idle period.
7. **SEC-C2.** Require a custom request header on `/follower/challenge`, so that browser no-cors requests cannot reach it.

### WS-9: Release integrity and documentation

Findings: VER-3, VER-4, VER-7, VER-9, K17 (metadata honesty), K20. Size: M. Depends on: WS-0.

- **Reproducible builds.** Set `SOURCE_DATE_EPOCH` from the commit.
- **Bound artifacts.** The artifact manifest binds the commit, a dirty flag, the build identity and the source hash.
- **Offline smoke.** Ship a shrinkwrap derived from the pnpm lock, and run the smoke test offline.
- **Required runtime files.** `verify-artifacts` requires `portal-validation.mjs`, `build-info.json` and the plugin dist.
- **Real smoke.** The packed smoke exercises `status` through a real daemon, plus the plugin bootstrap.
- **CLI tests.** Add CLI orchestration tests with fakes.
- **Embedded programs.** Move embedded PowerShell, C# and preload programs into real files that are linted, type-checked and pinned by hash.
- **Metadata.** Mark pending helpers as `pending` in the capability metadata.
- **Operator documentation.** Fix three items:
  - `tools list`;
  - Firefox for packed installs;
  - `--ignore-scripts` in the `.ps1` helpers.
- **Status documents.** Add historical banners to superseded status documents, and update the ledger in the remaining-work plan.

## 5. Phases and sequencing

| Phase | Workstreams | Exit gate |
| --- | --- | --- |
| 0. Truthful baseline | WS-0 | CI is green on Windows; each critical finding is reproduced by an expected-failure test. |
| 1. Host survival | WS-1, WS-2, and WS-3 items LC-1, LC-2 and LC-6. In parallel: WS-4, plus quick WS-8 items (SEC-1 labels, SEC-3 frame cap). | The daemon runs on the owner's machine under the Korean profile path; 5,000 run updates pass; the 31-day and deleted-workspace scenarios pass. |
| 2. C4 end to end | WS-5A, then WS-5B; WS-5C, WS-5D and WS-5E; the rest of WS-3 | Two consecutive completed C4 runs on the owner's machine. |
| 3. Fidelity | WS-6 (may start during Phase 1, on plugin and shared files) | The fixture suite and Chrome/Desktop parity pass; the C4 run is re-validated. |
| 4. C2/C3 | Decision D1, then WS-7 | Matrix fixtures pass integrated acceptance. |
| 5. Release and review | WS-9 and the rest of WS-8; the two post-implementation review rounds required by the remaining-work plan; final source and package verification | The remaining-work plan's W10 gates. |

File ownership for parallel work:

- `native-work.ts` is shared by WS-5A, WS-5B and WS-2 item 4. Only one owner may work on it at a time.
- `index.ts` receives small hooks from WS-3 and WS-5D. Land them in sequence.
- WS-5C owns `shared/src/portal.ts`.
- WS-4 owns `relay.ts`. The WS-3 plugin-hash change goes through WS-4.

Mapping to the remaining-work plan:

| This plan | Remaining-work plan |
| --- | --- |
| WS-5B | Task 6E |
| WS-5 exit gate | W02 |
| WS-6 | W07 |
| WS-7 | Prerequisite for W03–W05 |
| WS-0 and WS-9 | Part of W10 |

## 6. Verification strategy

- Validate every change natively, in a separate working copy bound to the source hash. Do not use Docker, a VM or WSL.
- Complete WS-0 item 6 (`windowsHide` and hermetic git) before the first local full-suite run, and ask the owner before running it.
- Required lanes:
  - Windows CI with non-ASCII `TEMP` and `LOCALAPPDATA`;
  - nightly native Vite acceptance with Firefox;
  - the owner's machine for phase exit gates.
- Per finding, add the failing reproduction first (the WS-0 expected-failure tests), then fix it and flip the test.
- Record phase evidence in English under `docs/reviews/2026-09-27-remediation/`.

## 7. Owner decisions required

| ID | Decision | Related findings | Recommendation |
| --- | --- | --- | --- |
| D1 | The supported-stack matrix for C2/C3, and whether C2/C3 claims are limited to it | SA-1–SA-10 | Limit claims to a published matrix. |
| D2 | Keep exact-dimension visual acceptance, or adopt a documented height policy with per-root waivers | SVC-9, FID-9 | Keep the 3% threshold; add per-root waivers and absolute-bounds oracles. |
| D3 | Whether recipe-hold history is evidence to keep, or can be discarded after release | OPS-2, LC-3 | Discard after release; keep only active holds. |
| D4 | Pin a Firefox ESR build for validation with updates disabled | R2B-4 | Pin. |
| D5 | For `ping` and `list_files`: redact `fileKey`, or add a configurable local-trusted egress mode | SVC-4 | Redact. |
| D6 | Make long-running portal operations asynchronous, with polling | OPS-6 | Adopt. |
| D7 | The semantics of `state reset` and key rotation | LC-7, LC-11 | Reset requires all clients stopped and an explicit confirmation. |
| D8 | Keep per-candidate profile approval with `reprepare --from`, or relax it | SVC-7 | Keep. |

## 8. Interim operating guidance

These workarounds apply until the fixes land. They follow from the code and have not been verified at runtime.

- **OPS-1:** run the daemon and CLI with `LOCALAPPDATA` pointing to an ASCII directory, and use ASCII `--out` paths.
- **LC-2:** unregister a workspace before moving or deleting its folder.
- **LC-1:** avoid `snapshot capture` and `grounding refresh`, or plan a state reset within 30 days of using them.
- **SVC-3:** for MCP-driven runs, set `sfp workspace default <id>` to the plan's workspace.
- **K1 and SVC-1:** portal runs cannot complete until WS-5 lands. Do not read a `blocked` validation as a defect in the candidate.

## 9. Out of scope

- New features beyond the four-case plan, including the 27 planned upstream recipes. WS-9 fixes only their metadata.
- Non-Windows native acceptance.
- Signing and distribution.

## Appendix A: severity adjustments and merges

**Lowered after refutation:**

| ID | Change | Reason |
| --- | --- | --- |
| SVC-2 | Critical → high | — |
| K8 | High → medium | It fails before mutating anything. |
| K10 | High → medium | It needs a durability failure within the 5-second deadline. |
| SVC-3 | High → medium | `workspace default` mitigates it. |
| SVC-4 | High → medium | Fail-closed egress and expiry are deliberate; the defect is the `secret` upper bound. |
| SVC-5 | High → medium | A restart recovers. |
| SVC-7 | High → medium | Per-candidate approval is deliberate. |
| SEC-1 | High → medium | Only desktop-capture validation reaches the plugin UI, and the commands were owner-reviewed at registration. |
| SEC-3 | High → medium | — |
| CC-1 | High → medium | The race window is narrow. |
| OPS-C1 | High → medium | It is environmental and scoped to lease-guarded operations. |

**Kept at medium:** the refuter proposed low for VER-2. The main session kept medium, because VER-2 combines with LC-8: the protocol version is never bumped, and the plugin is excluded from the build identity.

**Merged:**

- OPS-7 into SVC-8.
- The core-capacity part of OPS-2 into K9.
- K22's hold leak into LC-3.

**Extensions of other findings:**

| Finding | Extends |
| --- | --- |
| LC-6 | K25 and K10 |
| SEC-C1 | K11 |
| CC-C1 | K7 |
| CC-C2 | K9 |
| OPS-C2 | K23 |
| VER-C1 | K5 |

**Root causes corrected:**

- **OPS-2:** the failure comes on the 65th replacement of one record; plans and designs are create-only.
- **K8:** the current page is always deep-walked, whatever the requested scope.
- **SVC-8:** the fixed exclusion list is the main trigger.
- **SVC-1:** the CLI also discards the rewritten commands and assertions.

## Appendix B: fix directions to avoid

1. Deleting all retained generations, or raising the caps (OPS-2).
2. Relying on console code pages or `chcp`, or changing the lease script without a protocol bump (OPS-1).
3. Any of these for SVC-1:
   - round-tripping the full prepared profile through the CLI;
   - skipping re-preparation;
   - trusting client authorities;
   - hiding recipe reviews.
4. Dropping `candidateHash` from the profile key (SVC-7).
5. Relaxing the completion gate for C4, or trusting worker flags (K1).
6. A journal compare-and-swap alone for CC-1, because egress is finalized first.
7. Retrying demotion, or releasing the port without exiting (K10).
8. Deleting the oldest attempts unconditionally (K9).
9. Releasing claims at restart without proof that the process is gone (CC-2).
10. Choosing a default workspace automatically, or letting the agent choose the target workspace (SVC-3).
11. Admitting the `secret` class, or unbounded consent (SVC-4).
12. Bumping literal test counts (K3).
13. Caching ACL verdicts (OPS-3).
14. Paging evidence through `portal_next` (SVC-6).
15. Widening the global one-hour deadline (K14).

## Appendix C: grow-only state

| Store or structure | Growth trigger | Cap | Collector | At cap |
| --- | --- | --- | --- | --- |
| Journal active log | Operation transitions; `outcome-unknown` rows stay | 10,000 rows / 31 MiB | Compaction; manual resolve | New operations are refused |
| Journal tombstones | Each settled operation | 1,000,000 / 256 MiB | Sweep (stops under LC-1 and LC-2) | Over the cap at recovery → `JOURNAL_CORRUPT` |
| Evidence receipts | Each durable operation | 131,072 / 192 MiB | After 30 days; held operations leak | Operations are refused |
| Cleanup-intent log | Each expired receipt | 192 MiB | Truncated only when nothing is pending | Compaction fails |
| Egress manifests | Two rows per operation | 200,000 / 256 MiB | After 30 days; pre-only rows never expire | Operations are refused |
| Recipe-hold index | Each recipe step | 2,048 rows | None | Recipes are blocked permanently |
| `.replace-retained` generations | Each replacement | 64 per target | None | The record can no longer be written (OPS-2) |
| Native attempts and core preparations | Each validation or plan | 128 / 32 per owner | None | Validation and planning stop (K9) |
| Portal records, captures, `.sfp` snapshots | Each plan, capture or snapshot | None | None | Disk usage grows without bound |
