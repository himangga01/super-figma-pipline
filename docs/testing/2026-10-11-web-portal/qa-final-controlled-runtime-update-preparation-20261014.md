# Final controlled same-state runtime update preparation

Date: October 14, 2026, Asia/Seoul. This preparation follows [the earlier readiness review](qa-current-replacement-readiness-20261013.md), [the actual retained-runtime observation](retained-runtime-after-r69-disk-build-20261014.json), [the R69 publication review](r69-nine-stage-publication-review-20261014.md) and [AGENTS.md](../../../AGENTS.md). Root owns approval and execution; this document and the draft do not authorize effects.

## Implemented lifecycle and practical boundary

Current retained QA is daemon 41920 on 3059, started `1791922116470`, command hash `5ccf93669310bd2b91c40eefc316af33789224efa60aa91a5655eaa8ee79ce1f`, and portal 18448 on 4315, started `1791922185752`, command hash `f8c8cec83e151dff0a43c87e13be26793eae9228783c4f61d7706ad868d48737`. The earlier actual read proved their d722/7632 runtime identity and availability. New disk source a28/build0c4 and published release `30c8d969-324c-45dd-9215-911b8f0cb9a6` are not already deployed.

The public CLI has no daemon/portal stop or restart command. `daemon-entry.ts` documents foreground Ctrl+C, but these QA processes were launched hidden with redirected logs and no retained stdin/console lifecycle handle. Daemon mode deliberately omits stdin-EOF shutdown. Authenticated election abdication admits only a strictly newer build ID; old and new builds both retain the explicit epoch ID `1791202532000`. Faking a newer epoch or assuming a targetable console signal would be unsupported.

Root therefore authorized preparation of a controlled exact-process alternative. It explicitly uses forced parent retirement and makes no graceful diagnostics flush or browser cleanup claim. Source Chrome 2072, retained portal Chrome 9932, and primary 3055/4310 remain outside its mutation scope.

## Critical durable-state preservation

A bounded read-only inventory prepared 228 regular single-link files totaling 41,337,609 bytes. The proposed backup target has zero existing files and must contain the same 228 files after stopped-state copy and validation. Private scope receipt SHA-256: `071e18b4c764936c6c1f6b5369437267f131465d7772f927ea78e70ff06a0340`; content-manifest hash: `1a2553012093f63d2677e5566cf4a05d0224322f95be6ba9ad6457da8aa629c9`.

It includes authentication/signing material, policy and registry, operation/evidence/audit journals, signed plans/runs/profiles/preparations, environment and compiler records, capture/supplement metadata, core publication/results metadata, validation records, and the portal database/jobs/lock. Secret bytes remain private and are never printed.

Capture payloads, design/content/core-page payloads, native attempt artifacts, work/dependency trees and old handoffs remain in place. Their six named store-root directory identities were recorded, without following or reinventorying the 89,000-entry work tree. This is **not a full anchor or disaster-recovery backup**, does not establish an OS sandbox, and does not prove every retained artifact byte unchanged. The procedure must not delete or reconstruct these preserved trees.

Read-only state observation found 18 portal runs, 13 workflows, 36 jobs and 20 Core runs. Two jobs remain unknown. There were zero pending jobs, active portal runs or started server activities; every coding lease was absent or expired. Seven environment attempts were released with execution closed and every recorded process stopped. Four compiler attempts were ready with `runner-returned`. Original logical generating states, deadlines, grants, candidate/report records and unknown outcomes remain preserved.

## Reviewable draft and exact execution boundary

Draft directory: `.worktrees/_cache/qa-final-controlled-update-preparation-20261014/`.

Frozen proposal manifest SHA-256: `a6ce3285d88f186d059de822fd83b66ddcba609a309862d7e86ae9912bdc128d`.

| File | SHA-256 |
| --- | --- |
| `replacement.mjs` | `05d2acaf37bfa549ddc0ae580b6c2e1e20fb06ce0955bd604f53aa5653164363` |
| `stop-owned.ps1` | `e5416fbc292af771bbe144184b426c828ae93f704973bdab71e8878b617099be` |
| `start-owned.ps1` | `89c718414ec8dea310665ddc501e9162e62bedacc41998d37615c420bc825a08` |
| `physical-script.json` | `d3fd64a79cecf8c256c4524ff4ee3972c4b48ca997dcdfac47f926741fc266df` |
| `critical-scope-private.json` | `071e18b4c764936c6c1f6b5369437267f131465d7772f927ea78e70ff06a0340` |

The new scripts specialize the reviewed held-process retirement and normal entrypoint startup primitives. They do not invoke the consumed R4 helper modes. The draft imports only their pure ownership/descendant assertions and privacy helper, with dependency hashes recorded in its manifest. Root must review that dependency boundary and all runtime guards before approving a mode.

The proposed commands, from the exact native service working directory, are `node <new-directory>/replacement.mjs preflight <reviewed-freeze-hash>` and, only after Root reviews the actual zero-write result, `node <new-directory>/replacement.mjs execute-once <same-reviewed-freeze-hash>`. These commands were **not run**. They are not a substitute for the concrete final approval.

The draft rechecks current release/report/source-list/compiled/archive pins, exact parents and strictly known descendants, protected primary/Chrome identities, current quiescence, original grant and critical metadata. A new exclusive private intent records stop, stopped state, backup, each startup and completion. Only the bound parents are terminated; children must retire through their existing EOF path. Metadata is copied through exclusive synced files, destination hashes and a stopped-source recheck. Startup uses the same namespace and normal compiled entries. Postchecks require current build identity and unchanged critical records, with only leader-auth and server-lock rotation allowed. A failed phase retains actual partial state and prohibits automatic replay or rollback.

## Actual verification limits

Only read-only metadata/source inspection, draft creation and a syntax check were performed. No preflight, process stop/start, backup copy, grant request, state repair, unknown resolution, Source action, browser action, native approval, test, build or Git mutation occurred. This remains a proposal for bounded Root review, not a ready/deployed runtime claim. Existing healthy QA must remain intact if the review cannot establish safe quiescence, preservation or exact startup behavior.

## R2 and final R3 review corrections

R1 remains preserved. Root and the independent reviewer required explicit dependency verification before dynamically importing the old pure helper exports, exact frozen-row/count/hash/grant binding, STATE/PORTAL canonical directory and bigint identity checks, owner-index preservation, closed PowerShell diagnostics and durable spawn identity before later command checks. R2 added these guards and retained syntax-only verification; no mode was executed.

The R2 PowerShell catch tails were malformed because JavaScript string replacement interpreted the literal PowerShell `$'` sequence. Root and the independent reviewer rejected them before execution. R2 files and freeze `92471b22b14ddf6e270c862c951ffd3d0d4e2233a261d51a2df8fcd69d8cb66c` remain unchanged. R3 reconstructs the tails with literal structured text, with exactly one proper stop `finally` and the closed error-code regex. PowerShell's read-only `Parser.ParseFile` reported zero errors for both files; neither script was executed. Parser receipt: `454fc538bb730a62b241b024244a4ba0129232b6d9cc8c1945902f2d1d199038`.

The review also clarified that `computeBuildIdentity` establishes source/configuration identity, not installed DIST byte identity. R3 keeps that check but additionally pins the actual archive manifest `19bf1dc8af4a9e4c086dce9d8040839c0560937ad8adbe358556c81be0ed9f0b` and validates installed entrypoints, libraries, staged plugin mappings and portal web files against every relevant archive hash and size. Published package metadata is checked through the existing reviewed projection. These checks precede retirement, startup and final postchecks.

**Final review input:** `.worktrees/_cache/qa-final-controlled-update-preparation-r3-20261014/frozen-files.json`, SHA-256 `f0defb5e6a3aa19436c02e65228947a4becc705a18bf0aa12c51f70d7dea7054`. Its five runtime files are:

| File | Final SHA-256 |
| --- | --- |
| `replacement.mjs` | `9436cb5b6c4928e38c22f92ef22c7fedc0fd75aa8ad84ed381697a401b2c65ef` |
| `stop-owned.ps1` | `e0df25ed87acf5e6894fc1343ad4e70d8b99aec0b18ea68c25b41f9d7425a832` |
| `start-owned.ps1` | `efd80a605505f6f105290eb2a9b2e80d4acd0f10e9a97f6d303d71766b026f8c` |
| `physical-script.json` | `d3fd64a79cecf8c256c4524ff4ee3972c4b48ca997dcdfac47f926741fc266df` |
| `critical-scope-private.json` | `ba2bb9c6b250503ab6b30ca528e425e797bf180b675c76ead7a616cd8d3441cd` |

The root-identity addition does not change the original 228 rows, 41,337,609 bytes, grant or deadline metadata. Only post-start leader-auth and server-lock replacement are allowed; every other critical row remains exact. Root must review the exact final freeze and a subsequent actual zero-write preflight before authorizing effects. The R3 JavaScript syntax check and PowerShell parser check passed. No behavioral test, helper mode or runtime mutation was performed during these revisions.

## R3 preflight failure and R4 exact CWD correction

The authorized R3 preflight exited before service calls, physical inspection, intent creation or runtime effects because its exact CWD comparison used inconsistent Windows path separators. The actual working directory was the requested Native service directory. R3 and its closed failure receipt remain preserved.

R4 changes only the exact comparison: both paths are resolved, backslashes become slashes, and case-insensitive equality remains mandatory. The PowerShell scripts, physical script, frozen critical state and release guards are unchanged. Node syntax passed. R4 freeze SHA256 is 2185c30a7ce7cacf57dccb796cd026a27a2163b4e2b0a9e75faf3a1f6f2ef232; replacement SHA256 is 55865c7c275deefd27e1c41c71183dc6df7739f21f474c4ffeab1e7e5a45fd8d. No R4 mode has run at this record boundary. Runtime remains the retained d722 process cohort, not the current disk build.

## Canonical grant wrapper correction

The fresh R4 preflight rejected before intent or runtime effects because the helper read a nonexistent top-level expiresAt. The canonical stored policy places that field in config. A closed read confirmed the original grant remains valid until 2026-10-13T23:32:02.947Z. No authorization was renewed or rewritten. R4 failure remains preserved.

R6 reads config.expiresAt with presence, string, finite parsed date and future-time checks. The exact frozen policy bytes and all retained-state guards remain required. R5 was preserved without invocation when the explicit finite-date guard was added. R6 freeze SHA256: 8a53735cad37f75ae52eaeb6bbb97471e2b139a4c769297bbe9547baa960bccd. Replacement SHA256: b8176dc7101a83066cd997072c011f6ef5e8bd3fdfce92c81dec2547f5d88fd1. Node syntax passed; the other four runtime files are unchanged. No replacement has been dispatched.

## Actual R6 zero-write preflight

The authorized fresh R6 preflight passed with exit 0 in 6.7 seconds. It emitted zero output writes and created no intent. The exact retained process pair 41920 and 18448, two owned children, frozen 228 critical files totaling 41,337,609 bytes, original grant, source/config identity and installed compiled archive closure passed. Metadata hash remains 1a2553012093f63d2677e5566cf4a05d0224322f95be6ba9ad6457da8aa629c9. The saved closed result SHA256 is 7ad10a55be087a0b99218253779bd8d9579d2321a76c0f5b5dde7dde76f025f1. Actual replacement still awaits the parent controller review of this result. No deployment or live acceptance is claimed at this boundary.

## R6 partial startup outcome and portal-only continuation

R6 retired the exact old QA pair and completed the 228-file durable metadata backup. Its launcher then exceeded the 60-second wrapper limit after emitting a successful spawn record. The preserved failed intent identifies daemon-start-dispatched. A bounded authenticated diagnosis verified new daemon 36208, start 1791930906393, the exact expected command and build identity 0c4, listening on 3059 as leader. The portal was never dispatched and 4315 is absent. Exit telemetry recorded status 0, killed false and empty stderr; inherited pipe retention is an interpretation, not a proven underlying OS cause.

The new portal-only continuation pins the original failed intent, the healthy daemon receipt and exact process, backup-root identity, original 228 backup rows and bytes, current critical metadata, source and installed compiled closure, owner index and untouched primary/Chrome processes. It creates one new intent and starts only the missing portal with ignored wrapper streams. It performs no stop, daemon restart, metadata recopy, Source request or browser action. Freeze SHA256: 1f3dd16617efd0c38b24532aa0f377b10a4b4ae458ca28fd533a92489633128c. Syntax passed. No continuation mode has run at this boundary.

## Actual portal startup and final read-only verification boundary

The chosen R3 portal-only preflight passed, then the authorized single continuation spawned portal 28816 at 1791931747658 with the exact expected command. Its server lock contains 28816. The continuation failed its strict postcheck because portal.json retained exact bytes but acquired a new inode. Primary PortalStore.recoverInterrupted always writes through an atomic rename even when there are no interrupted operations. Actual comparison found only this identical-content inode replacement and the expected server lock change; the other 229 current critical rows were identical. Both original failed intents remain failed and unchanged.

A bounded service-owned observation confirmed daemon 36208 and portal 28816 own 3059 and 4315. The daemon reports leader and current identity 0c4. Portal health returns HTTP 200 and available true. These establish availability without changing the failed continuation outcome. No stop or start was repeated.

A new read-only finalizer pins the current process receipts, both failed intents, original backup, journal equivalence, exact current compiled closure and all retained data. It allows the portal.json inode replacement only when bytes, hash, size and device match and the file is regular, single-link and not a symlink. All other critical rows remain exact. Finalizer freeze SHA256 is 71a4131449fe10ec9adf622c0e2beed60f54a166e66d8c174cf4c2f00de8c9d0. It has no stop/start/recovery branch. It remains uninvoked at this record boundary. Live CDD acceptance remains blocked by native Chrome approval; runtime availability does not establish that acceptance.

## Final actual runtime verification

The authorized R3 final read-only verification passed with exit 0 in 5.71 seconds. Daemon 36208 and portal 28816 own QA ports 3059 and 4315 with their exact recorded starts and command hashes. The deployed source is a28 and build identity is 0c4. Existing service health confirmed the daemon leader and portal HTTP 200 with available true. The final verifier made no portal HTTP request, Source call, stop, start or recovery action.

The exact current 231 critical rows and original 228-file backup passed. Both original failed intents remain failed and unchanged. All 229 other current rows, all 656 original activities, all runs, workflows, unknown states, original deadlines and the existing grant were preserved. One prior normal health-bootstrap connection observation is retained explicitly. Journal logical equality passed through the actual readers on disposable copies; the original state and original backup were not used for recovery. Artifacts and dependency trees remain in place. This is a critical durable-state backup, not a complete anchor backup or OS sandbox. Forced retirement is recorded; graceful flushing was not established.

Private final proof SHA256: 745c930c03536a2dfaaa18d14fccde4680047bd53ac552ff2eb1715fcc0b06da. Portable proof: [qa-final-runtime-verified-20261014.json](qa-final-runtime-verified-20261014.json). This closes runtime availability and preservation, while complete CDD application, source freshness and complete C2/C3 live acceptance remain unpassed because the required native Chrome approval is unresolved. Earlier Native generation checks and source-only compiler/selection proofs remain separate evidence. No further runtime effects are scheduled by this controller.
