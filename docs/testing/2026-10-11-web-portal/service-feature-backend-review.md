# Fixed CLI feature adapter backend review

Date: October 11, 2026, Asia/Seoul.

## Baseline and scope

This bounded review used the managed `4d3e/service` copy of the parent's 58 fixed CLI feature adapters, their dependency-injection changes in CLI command handlers and server attachment, and the domain-removal transport repair. It follows [the repository instructions](../../../AGENTS.md), [the canonical service analysis](../../service-analysis.md), [the feature inventory](../../analysis/portal-feature-inventory.json) and [the retained job implementation](service-jobs.md). The parent had integrated the first 47-path increment as native source `9db4aab...`; later Desktop and portable-declaration corrections are separate follow-ups. Published HEAD remains `22517932...` with authorized uncommitted changes.

The reviewer did not edit production feature/client code. After confirming the Desktop finding, the parent authorized a new owned regression file, `packages/cli/test/desktop-feature-invocation.test.ts`; the parent repaired production code. A separately requested declaration fix added explicit portable return types to this worker's existing public tool-catalog wrapper.

## Confirmed and repaired: Desktop reads bypassed retained invocation

The original `ControlClient.readTool` directly posted to `/control/tools/call`. It retained a read-only tool allowlist and a pinned session selector, but bypassed `invoke`, the feature facade's `beforeInvoke` hook and its progress/approval emitter. The actual daemon supplies a server-generated operation ID when the envelope omits one, so the current daemon does **not** necessarily fail with `OPERATION_ID_REQUIRED`. The defect was that the portal did not durably know the original child operation ID before dispatch and could not expose its approval or identify it for cancellation through the normal invocation path.

An owned nonbrowser fixture ran the actual `executeServiceFeature('desktop.connect')`, command handler and Desktop reader with a controlled existing-server attachment and controlled public client. It performed six Desktop read requests. At 21:43:20, the expected six durable hooks were **zero**. The private red receipt is managed `.cache/feature-review-red.json`. An earlier first run used an incorrect expected read count of seven; that fixture-count failure is not the evidence for the production defect.

The parent's repair keeps the read allowlist and delegates `readTool` to `this.invoke` with `approve:false`, `captureResult:false` and its original session/none target rules. The feature facade assigns the admitted signal, emitter and workspace, rejects a conflicting supplied workspace, awaits the retained-operation hook, and checks cancellation before dispatch. The new regression verifies all six child calls for both an omitted workspace and an explicitly selected workspace. This does not test a live Desktop plugin or claim complete Desktop capture.

## Other reviewed boundaries

- Definitions select fixed argument arrays and registered tool names. No shell string, arbitrary executable, arbitrary control route or caller-supplied JavaScript enters the feature dispatcher. Arguments are parsed before dispatch; local path arguments require absolute local paths and exclude network/device aliases.
- Tool/service aliases use the same injected `ControlClient` and never turn on automatic tool approval. `beforeInvoke` runs before the actual invocation. The profile-register/environment-reconcile flags belong to fixed local administration branches, which require the portal's separate reviewed confirmation.
- The supplied client identity is retained through nested administrative methods. Domain removal now supplies its strict nonce in the required header with an empty body. Real owned HTTP tests verify that transport shape and reject additional body fields.
- Portal-bound Desktop preparation/connection set `allowServerStart:false`. A missing or mismatched daemon build fails before spawning an unrelated process. Tests cover both cases and the existing matching-daemon path.
- Operation resolution preserves its exact confirmation string, hashes and action nonce. The actual endpoint accepts that shape. It does not infer a successful unknown operation from an unrelated current read.
- Cancellation signals propagate through the public client and Chrome/desktop adapters. Already started local filesystem work is not an operating-system transaction or rollback. Composite jobs retain an unknown state when their outcome cannot be proven; no automatic replay is introduced.

One lower-priority classification issue was reported to the parent: pure `tools.list` and `figma-mcp.config` feature jobs were classified as local for their metadata and therefore conservatively blocked by an existing unknown-mutation fence. The read-only catalog/settings HTTP views remain available. The proposed correction is an exact read-only allowlist for those two pure features, without relaxing all `kind:'local'` operations. Its disposition is recorded in the follow-up below.

## Executed verification

At 21:44:46, the new Desktop regression passed **3/3**. At 21:47:19, that file plus the public tool-catalog tests passed **5/5**. The new test's format and lint checks and the managed CLI TypeScript check passed. The new test SHA-256 is `67b20d60a9e90e5bc55ca33c29b79d08902b091c42f78bb2bc08af8755c45295`.

The independent combined rerun passed **33/33**, zero failed and zero skipped, across `desktop-feature-invocation.test.ts`, `desktop-reader.test.ts`, `service-functions.test.ts`, `bound-server-session.test.ts` and `control-client-http.test.ts`. The private machine-readable receipt is managed `.cache/feature-review-green.json`. A prior command started from the wrong package directory and selected no tests; it is not counted. The successful command ran from the CLI package:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache test/desktop-feature-invocation.test.ts test/desktop-reader.test.ts test/service-functions.test.ts test/bound-server-session.test.ts test/control-client-http.test.ts --reporter=json --outputFile=../../.cache/feature-review-green.json
```

No browser, source Chrome, Figma connector, real daemon, native permission UI or installation command was used. Controlled fixtures do not prove live execution of all 58 features. The parent owns the integrated native build, contract generation, current-source whole check and real UI/service journeys.

## Portable declaration follow-up

The native compiler, unlike the managed dependency junction, rejected inferred public tool-catalog return types with TS2883 because they referenced a private `@sfp/mcp` source type. The wrapper now declares self-contained interfaces with literal kind/target unions and an opaque JSON-schema value. Runtime schemas and parsers are unchanged. `service-tool-catalog.ts` SHA-256 is `bd5889dc589313207f10af146010165e88420844b40877c2e616496d97142a77`. The parent must verify the real native declaration/build after copying this one-file correction; the managed static pass alone does not establish portability.

## Exact pure-feature classification follow-up

The parent authorized the two-name classification correction. A new regression failed at 21:50:15 with **nine passed and one failed** because the actual adapter returned `readOnly:false` for a pure local feature. The adapter now recognizes exactly feature names `tools.list` and `figma-mcp.config` as read-only. Other local functions retain their prior classification; the same regression checks that `portal_cancel` remains a mutation with an explicit recovery exception.

At 21:50:37, the service-control and service-job suites passed **26/26**. Portal TypeScript, scoped lint and formatting passed. This two-file follow-up is frozen:

- `packages/portal/src/control.ts`: `a0fe970a35f1e259db15e35467d564008be72f74e6a7957ff4acad20b8cbb8b8`
- `packages/portal/test/service-control.test.ts`: `375b611602f9afb13df44e3f9152716766c441a0d3711466013d92fc11bf2917`

No process-stop or replacement attempt was made. The parent's separately blocked portal restart and required owner approval remain outside this worker's verification.

## Local doctor diagnostics classification, 23:43 KST

The parent reported that an actual unknown network-administration job prevented a local `doctor` diagnostic through the generic function UI. The trusted classification treated the registry's `kind:'local'` as a mutation unless already explicitly exempted. This worker synchronized only portal `control.ts` and its adapter test from native before editing, at the preceding `a0fe970a...` / `375b6116...` hashes.

`handleDoctor` in `packages/mcp/src/tools/safe-union.ts` parses the real doctor schema, builds public checks from the supplied daemon role and plugin-connected boolean, and calls `environment.roundTrip()` only when `roundTrip` is true. That callback is wired to pinned `get_metadata`; the registry separately forbids a target for omitted/false and requires one for true. No handler or policy classification was changed.

The adapter now adds exactly `toolName === 'doctor' && toolArgs.roundTrip !== true` to the trusted `readOnly` predicate. This uses arguments already parsed by the registered tool schema and includes the fixed `tools.call` alias. Catalog kind remains local. True round trips and other local functions retain their existing classification.

Three new cases failed first at **23:43:05**: direct and aliased omitted/false diagnostics were classified incorrectly, and an actual `ServiceJobs` fixture blocked a diagnostic behind a retained unknown mutation. After the one-condition repair, the adapter and job suites passed **29/29**, zero failures/skips, at **23:43:35**. The job fixture retains the original unknown status and operation pointer, allows the direct false and aliased omitted diagnostic, and proves both true-round-trip requests remain fenced. It uses a controlled dispatched tool failure to establish the same unknown-mutation guard; it does not replay or resolve the parent's actual network job.

Portal TypeScript, scoped lint and formatting passed. Final two-file hashes:

- `packages/portal/src/control.ts`: `1f9198c796c82febccd2934e58b672aefe93068025ae088586f458112bc6d0c1`
- `packages/portal/test/service-control.test.ts`: `4cf964a39004d3c4d7a4dc4fda89e09a57730396a3a631bba39b6c8f73212a67`

Only these managed files and this report were authored. No source Chrome, UI, running process, daemon state or ACL implementation was changed. The parent owns integration and the real diagnostic rerun; this focused pass does not establish that the separate ACL defect is repaired.

## Later actual DELETE transport finding, October 12

The next actual QA run exposed the same nonce-only DELETE carrier problem beyond the previously fixed network-domain route. Egress reset became unknown, and owned real-HTTP regressions also failed workspace removal and default-workspace clearing. The bounded client-only extension, genuine red/green results, exact two-file hashes and unchanged original unknown job are recorded in [the DELETE nonce transport repair](delete-nonce-transport-repair.md). The earlier passing transport fixture covered network deletion alone and must not be treated as evidence that these other administrative deletions had already worked.
