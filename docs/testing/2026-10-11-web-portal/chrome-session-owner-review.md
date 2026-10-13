# Independent review of the portal Chrome session owner

Analysis date: October 12, 2026 (Asia/Seoul).

This report follows [repository instructions](../../../AGENTS.md), the shared analysis policy and [canonical service analysis](../../service-analysis.md). It reuses [the earlier endpoint/dispatch review](chrome-dispatch-independent-review.md) and [retained-tab execution evidence](retained-tab-live-qa.md). The coordinator owns final integration, source reconciliation and actual retained-Chrome acceptance. No live Chrome, native runtime, policy, root index or production source mutation is authorized by this reviewer scope.

## Baseline and purpose

The protected native/main source supplied by the coordinator is `sha256:673629ce8080ac1e697d144143b7b5d2c3a58482745a7ef885d0ea09578a0bfa`, on published HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted integration work. Its whole attempt failed with **5,306 passing tests, eight failures and twenty existing skips**. Seven artifact-fixture failures and the remaining native-work fixture failure received separately reviewed repairs; see the packaging section below and [the native feedback fixture review](native-work-feedback-fixture-review.md). Those narrow approvals do not rerun the failed whole. This Chrome owner and the separately reviewed diagnostics retry are not covered by that failed checkpoint or by the earlier `34438...` pass.

The actual portal previously created and physically closed one `ExistingChromeConnection` per public Chrome CLI feature. A daemon's separate approved socket does not grant connection reuse to the portal. The candidate adds one process-owned Chrome connection with per-job logical source sessions. It must keep pending native approval alive after a logical job fails, preserve the original job deadline/cancellation and source guard, and close the portal's own connection during portal shutdown. It must not automate approval or infer source acquisition from an open socket.

The author uses managed service root `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`. Final production/test hashes were pending at preparation; the binding below supersedes that checkpoint. The reviewer independently read these immutable native comparison bytes:

| Native service path | Baseline SHA-256 |
| --- | --- |
| `packages/cli/src/browser-session.ts` | `5a34bf368faae00467489e1f184b64210d6c119e7e5affbd72cac24c826f971f` |
| `packages/cli/src/commands.ts` | `74cdeb89eb100eaec58caa8bbd80acbe437bf46e3eb3a16909b78861340eff1a` |
| `packages/cli/src/library.ts` | `703a5f2ce21a22f9dfc7f08780421831d03a1dae6679ff51a36690168472b52a` |
| `packages/cli/src/service-functions.ts` | `e0c957acaa72319b33ae283074a978825770596f3c875e0cb4b1d2f9107f19bf` |
| `packages/portal/src/control.ts` | `1f9198c796c82febccd2934e58b672aefe93068025ae088586f458112bc6d0c1` |
| `packages/portal/src/bridge.ts` | `2497b28f32adfd41cfc93c896187d67d2a4c50a740423e0e210e9e6b81faf0fe` |
| `packages/portal/src/server.ts` | `9ae5ede1ce50cd56012945db98e7a56d7cfd784ce42fa7ae9a07ce9b93ce08c5` |

Managed reads during author edits are intermediate observations, never baseline or final approval evidence. Source deltas must be checked against the native bytes above so earlier author edits remain included. The independently owned root artifact-startup fixture is outside the Chrome author's production scope; coordinate its new CLI-owner stub/export needs without overlapping edits.

## Independent review plan

After the author freezes all production and test files, verify each exact hash and inspect the full delta. Then check:

- Repeated public Chrome CLI calls use one portal-owned physical transport, while each command releases only its logical session. Standalone CLI calls retain their existing ownership behavior.
- A failed/timed-out logical attachment preserves the same native permission generation until explicit owner approval or portal shutdown. A later new job has its own deadline; no historical job or expired deadline is reset.
- Retained transport opening/selection callbacks cannot create or navigate a source after their original command has cancelled or expired. Pure tab reads may retain the physical approval generation; `openIfMissing` and node selection require disarming or retirement before a late approval can act. Test the resolve-versus-abort settlement race as well as cancellation during a pending native handshake. An already issued browser action cannot be treated as proven absent merely because its waiter failed.
- Busy guards reject concurrent source use/retargeting, selected-file/node checks remain intact, endpoint validation stays loopback-only, and default-profile/explicit-WebSocket/HTTP discovery keep the previously reviewed boundaries.
- An explicit idle endpoint change releases the old owned connection before creating a fresh generation. Its cleanup, discovery and attachment spend one absolute deadline. Cancellation or expiry during transition must not leave the owner permanently bound to a closed connection. Close and transition operations must serialize without creating a connection after shutdown.
- Shutdown stops new HTTP admission, closes the bridge/owner, records sanitized closure errors and flushes diagnostics before reporting callback completion. Closure failures cannot produce a clean shutdown claim or overwrite unknown operation outcomes.
- The public CLI library exports the new class in an actual isolated built artifact. The packaged portal can resolve/use that public export, and the separately repaired root artifact fixture remains compatible. Source typechecking or a stub-only artifact is not evidence that the actual candidate library export was built correctly.
- Actual Vitest registration names are unique and executed focused results match the declared cases. Owned installed-Google-Chrome headless fixtures remain separate from the owner's live Chrome and final Figma/frontend acceptance.

One draft-only state question was sent to the author: after endpoint A is physically closed for an A-to-B transition, a logical abort/expiry can occur before assigning the fresh connection. Once cleanup settles, a following A request must not silently reuse the already closed A object. This is a review question before execution, not a confirmed runtime finding. Independent transition-cancellation/recovery probes will decide it on the frozen candidate.

## Final candidate and independent execution

The author froze eleven files in managed `.task-evidence/portal-chrome-session-owner/frozen-files.json`, with declared manifest aggregate `a743c7b04fd152088ef34e2cdebb9b013d7637e20bc9897584b9001f1d76fc00`. Every hash was independently verified before execution and again before approval. The seven production deltas were inspected against the native baseline, including code added before the review began.

| Managed service path | Final reviewed SHA-256 |
| --- | --- |
| `packages/cli/src/browser-session.ts` | `7b6e91c2a9a203436200a633b9be3eff64cbb9d39af55c685cfaaa1ae2ec4fcc` |
| `packages/cli/src/commands.ts` | `798226f3bbec41321bf32c76caad936e5fe761409c83c0869e8d41e2ef4793a1` |
| `packages/cli/src/service-functions.ts` | `7094acaa954573a6ce7d9f4405bd5410ceab0fcd778db8cc1127015efe0c845f` |
| `packages/cli/src/library.ts` | `b1c3bac768fb102758d0dd6917b32c312d388fc69e57c56348f320c1608d016b` |
| `packages/portal/src/control.ts` | `63441d66a3fb1e89656a28f2b7df8d177edfd34058aa0684b16b81c671b7898f` |
| `packages/portal/src/bridge.ts` | `56db66aaef06b09f184f72728a2a5123c20c1e9581a0323995c6ab81b3cb999d` |
| `packages/portal/src/server.ts` | `3196dbefedaa3c67293ee81a583dd76827e0c16fd6e84acf511f1820946cc594` |
| `packages/cli/test/browser-session.test.ts` | `46ccd3874a078c69f0badf3230c403f4a9cb5a81ddad48d0d52b4403fc61e54a` |
| `packages/cli/test/browser-session-reconnect.test.ts` | `311c25668af4888f0205c2973b8f2c0bd7d2f3f39339db67abd9584e3d314e54` |
| `packages/portal/test/service-control.test.ts` | `1c7e2b01f36737538068513db3a4bc5ca477b835a19710a8b3552053b5142e86` |
| `packages/portal/test/backend.test.ts` | `e788e7330434cadbc28bad0179b5fe7dfa7fa57bfc0a80501406280d1cc7355a` |

The portal control creates one public CLI `ChromeSessionOwner`, injects it through feature context/command execution, and exposes closure through the bridge. Logical command completion releases only its selected session. Standalone execution still uses its original private connection ownership. No user-provided feature argument can supply this host-owned context object.

The interrupted endpoint-switch concern was addressed before freeze: confirmed cleanup marks the connection retired, so a subsequent new validated job can create a fresh generation even for the earlier endpoint. Pending cleanup remains busy. An unconfirmed retirement is quarantined; neither a later close nor a new job can silently turn it into successful cleanup. Transition cleanup deducts elapsed time from the requesting command's original connection bound.

The coordinator's late-effect concern was also addressed before freeze. Pure read cancellation/timeout retains the physical permission generation without resetting its initialization deadline. A failed/cancelled source-opening or node-selection initialization retires that generation. `ExistingChromeConnection.close` synchronously clears opening/selection callbacks before asynchronous teardown, so a later native approval cannot execute the original intent. The resolve-versus-abort boundary releases a delivered session instead of returning a live lease, and copy command execution checks cancellation before issuing its first navigation. These precautions do not prove that an already issued action was absent or undo a navigation that had already started.

Portal HTTP closure invokes bridge/owner closure before diagnostic flush and callback completion. Closure errors, including non-Error rejection values, become error objects with their original cause and a safe code. They are logged before flush and passed to the callback; they cannot report a clean shutdown. Existing Node close errors retain their precedence and unconfirmed diagnostic flush remains explicit.

Executed independent verification:

| Check | Result |
| --- | --- |
| Eleven exact hashes, preflight and postflight | All matched |
| Private controlled lifecycle/late-approval probes | **14 passed, zero failed** |
| Four actual source suites | **127 passed, zero failed, zero skipped** |
| Actual registered/executed names | CLI session: 39; CLI reconnect: seven; portal control: 14; portal backend: 67; every name unique and matched |
| CLI and portal TypeScript checks | Both passed |
| Actual isolated candidate CLI library build/import | Passed; new public class, `open`, `close`, pre-cancelled-open reason and idempotent idle close verified |

The private lifecycle probes evaluate the exact frozen browser-session source with controlled transport/Playwright objects. They cover physical reuse, logical release, overlap rejection, invalid-input preservation, remaining switch budget, cancelled/expired switch recovery to the earlier endpoint, shutdown during transition, pure-read late approval, cancelled/timed-out opening and selection callbacks, settlement cancellation and failed-retirement quarantine. No real browser or live service connection occurs in those probes. The actual source suite separately executes the service-owned installed-Google-Chrome headless fixture and real portal HTTP/close fixtures; unrelated owned pages remain intact. That does not test the owner's actual native security approval.

The isolated build uses the existing CLI tsdown configuration and package working directory, overriding only the library entry, private output, nonpackage publint setting and explicit Playwright externalization. Output lives in the ignored CLI `.cache`, resolves the existing package-scoped dependencies, and is removed only after canonical path verification. No install, existing junction change or production `dist` write occurs. The actual built `library.mjs` hash was `ff1734473b30c0b11c03592db7aa5474c82e60e9b56666defc807776e1427bda`. This verifies the actual candidate's public export/import behavior; it is not a complete production portal build, extracted release startup or live connection.

Two initial isolated-build setup attempts failed before an owner action: the first used service-level output where package-scoped Playwright was unavailable; the next used the wrong build working directory and incorrectly bundled a native parser dependency. Correcting private output location and using the real CLI package working directory fixed the harness without source or dependency changes. No package installation suggestion from the dependency error was followed. The first registration-name comparison also failed because the review harness compared the collector's ` > ` ancestor form with JSON `fullName`'s space form. Using the existing scope checker's ancestor/title normalization fixed that comparison; no test or checker was changed.

Independent commands, from the managed service root:

```powershell
node .cache/chrome-session-owner-independent-probes.mjs ../.task-evidence/portal-chrome-session-owner/frozen-files.json
node node_modules/vitest/vitest.mjs run packages/cli/test/browser-session.test.ts packages/cli/test/browser-session-reconnect.test.ts packages/portal/test/service-control.test.ts packages/portal/test/backend.test.ts --reporter=json --outputFile=.cache/portal-chrome-owner-independent-tests-20261012.json
node .cache/chrome-owner-built-export-probe.mjs ../.task-evidence/portal-chrome-session-owner/frozen-files.json
node node_modules/typescript/bin/tsc --noEmit -p packages/cli/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/portal/tsconfig.json
```

The service's `scripts/collect-test-registrations.mjs --file <path>` was independently run for all four test files. Its collected cases exactly matched executed ancestor/title names, with no duplicates.

Private managed receipts:

| Receipt | SHA-256 |
| --- | --- |
| `.cache/chrome-session-owner-independent-probes-result-20261012.json` | `efcf681eb21b194fee309390763bce781c673239fb9e1a3517f1fb61e8170100` |
| `.cache/portal-chrome-owner-independent-tests-20261012.json` | `ebb9a3fe359829b47fdbf620330377442fcd181cb7a06253ba975d470624c262` |
| `.cache/chrome-owner-built-export-result-20261012.json` | `1b398388dd5ad171b617d6080be7759e58137110dcf93a697b8ee0ff166cf91e` |

## Current disposition and limits

**Approved for exact-file integration of the eleven-file manifest above.** No blocking finding remains in this bounded lifecycle review. The transition-retirement and late-effect concerns were addressed before freeze and independently verified on the final candidate. No unexecuted intermediate source is described as a reproduced runtime failure.

The reviewer changed no author files, native/main production source, root index, live runtime, policy or Chrome session. Fixtures share the current Windows account and dependencies; they do not create an OS sandbox. Source/controller probes cannot establish why the earlier real handshake remained unaccepted. Root retains exact integration of this owner and its separately reviewed diagnostics/packaging/test companions, a new source fingerprint, fresh whole/artifact checks and actual same-tab portal acceptance. No original job was replayed or resolved, no expired job deadline was reset, and no successful Figma acquisition, generation or frontend acceptance is claimed.

## Separately owned packaged-startup compatibility

The coordinator authorized a separate packaging follow-up owned by the diagnostics author. It is outside the seven production Chrome files. The verifier now requires the new public `ChromeSessionOwner` export; the startup fixture seeds `DEBUGGING.md` and a minimal owner construct/close stub, while preserving the original seven positive/negative cases and adding an eighth missing-owner-export case.

The reviewer began an independent seven-case run with the earlier fixture hash `7b48c53306d2ecaa5af8808589ad075b793914aa8f1bf26b4211b989100e5e70`. It passed seven cases. During that run, the coordinator-authorized second revision changed the fixture and coupled verifier. Postflight hash verification detected the drift and withheld current approval. The original receipt `.cache/portal-artifact-startup-independent-20261012.json`, hash `82fe85353a3176fb5b85dfb4c706d8a35e1d7b43eb36a7b08970db9bcc943347`, remains historical execution evidence with a changing coupled-verifier limit; it does not verify the eighth case or the later frozen snapshot.

After revision 2 froze, both exact hashes were independently checked before and after a separate execution:

| Path under managed service | Native baseline SHA-256 | Final packaging SHA-256 |
| --- | --- | --- |
| `test/portal-artifact-startup.test.ts` | `1f4ed6af649eb524180419d0eca972607d4732406065fed9f6f053af31c95289` | `9889022b1a644d33c5060b03d9fd76b182a6413fcdb45edb0571603c6a107a01` |
| `scripts/verify-artifacts.mjs` | `d10e76a87729c7203692fd052a1f9cd695d1ae7a07839390ab5649ba92d01ce0` | `0f79be058077fb98e53a3c18a84d53d81e87f69316f1d4d5c1d7bb77feee4d67` |

The declared revision-2 manifest aggregate is `5314648c9370246322efbdc075672f43e808101c6aa7e11c2e8d53250184026d`. The production verifier delta adds only `ChromeSessionOwner` to the existing required function-export list. The new negative fixture expects `PORTAL_CLI_EXPORT_MISSING:ChromeSessionOwner` before portal startup. The former asset/control/feature-export checks remain unchanged.

Independent command:

```powershell
node node_modules/vitest/vitest.mjs run test/portal-artifact-startup.test.ts --project root --reporter=json --outputFile=.cache/portal-artifact-startup-independent-v2-20261012.json
```

Result: **eight passed, zero failed, zero skipped**. Receipt SHA-256: `e97a5b5502abda0aedb439a9da225df66307a927c8243de5085b56cd43ae14ca`.

**The exact two-file packaging revision is approved for integration with the Chrome-owner public export.** Its real packaging/extraction/startup mechanism uses miniature fixture modules. It does not prove that the actual production owner was compiled, loaded or connected. The separate isolated-built-export and eleven-file lifecycle checks above now pass, while a full integrated production portal startup remains pending. The verifier requirement does not establish that the old CLI already had the new export.
