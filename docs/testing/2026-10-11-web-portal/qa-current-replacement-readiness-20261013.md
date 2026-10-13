# Current QA same-state replacement readiness

Analysis date: October 13, 2026, Asia/Seoul. Final read-only snapshot: 09:08:18.068 KST (`2026-10-13T00:08:18.068Z`).

**The current QA instance is conditionally prepared for a new, one-use replacement. Deployment is still gated by fresh source-bound whole and artifact results. No replacement was executed in this review.** Root exclusively owns implementation and execution of the new helper, live Chrome and state decisions. Ordinary same-state replacement is already authorized; native browser security approvals remain manual.

This supplement follows [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [canonical service analysis](../../service-analysis.md), [the earlier readiness review](qa-recovery-deployment-readiness.md), [the helper review](qa-recovery-helper-review.md), [the a476 continuation](qa-a476-continuation-20261012.json), and the protected publication-failure receipt. It supersedes their snapshot counts for current readiness, while preserving their failed attempts and outcomes.

## Baseline, architecture and verification

The same-origin portal retains public workflow runs, jobs and mutation fences. Its private daemon owns signed core plans/runs, policy, registry and journals. The compiled release can change on disk while an existing process continues using earlier loaded modules. Root reported the integrated production fingerprint `sha256:213acbf4d43369d5f30856121406359c5047e2e319e1b8581f2a19d28d991a65`; documentation/derived metadata and fresh whole/artifact gates were still pending. This review did not run Git or assert that fingerprint independently. Exact inspected recovery-source hashes are in the receipt. The existing protected running-runtime receipt remains bound to source `a476a925...`, not to current disk contents.

Executed inspection used Windows CIM/listener metadata, fixed read-only ACL inspection, opaque filesystem hashing, and the native compiled service's `ControlClient`. Allowed HTTP calls were GET `/ping`, `/control/status`, `/control/egress`, `/control/operations?limit=1000`, and same-origin `/api/health`. Each private request was preceded by exact QA ownership proof, repeated at the client's final request hook. Portal health required exact URL, no redirect and HTTP 200. No browser automation, source acquisition, job dispatch, stop/start, state repair, grant/fence change or unknown resolution was requested.

Initial diagnostic-script failures were a malformed PowerShell depth argument and a Windows ESM import lacking `file:///`. Both failed before private service requests, were corrected locally, and are not service failures. The corrected inspector completed twice. The public receipt contains only sanitized projections and hashes; operation handles, credentials, bearer tokens, browser addresses, raw command lines and encoded script bodies are omitted.

| Evidence | SHA-256 |
| --- | --- |
| [Sanitized current receipt](qa-current-replacement-readiness-20261013.json) | `0589b1f2c2fb670cc70f9d6a2676f2c666535475f82bbf4b00ee366fd029b4ad` |
| Protected prior running-runtime receipt | `2d09f4857d45a0e3b63ab862be1a3be76923eb5ebe17c5e4b11688f1ab72872c` |
| Preserved failed original intent | `ff37402ffd6bcea325d8cd0562f4dbe864f0b9a27d995b0fd5d22fb32b5ee449` |
| Original empty runtime publication | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, zero bytes |

## Exact process and listener continuity

QA anchor: `C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-cdd-export-repair-20261012`.

| Component | PID | Creation epoch ms | Listener or disposition |
| --- | ---: | ---: | --- |
| QA daemon | 39796 | 1791785334585 | Sole `127.0.0.1:3059` owner |
| QA portal | 35244 | 1791785340430 | Sole `127.0.0.1:4315` owner |
| Primary daemon | 7460 | 1791764383322 | `127.0.0.1:3055`, leave untouched |
| Primary portal | 27636 | 1791764388627 | `127.0.0.1:4310`, leave untouched |
| Retained portal Chrome | 9932 | 1791721736935 | Leave browser, context and existing tab untouched |
| Separate source Chrome | 2072 | 1791527888383 | No control or replacement authority delegated |

Both QA parents are `C:/Program Files/nodejs/node.exe`, parent 17492. Their complete UTF-8 command hashes match the protected receipt: daemon `5ccf93669310bd2b91c40eefc316af33789224efa60aa91a5655eaa8ee79ce1f`, portal `f8c8cec83e151dff0a43c87e13be26793eae9228783c4f61d7706ad868d48737`. Recognized entry paths are `packages/mcp/dist/daemon-entry.mjs` and `packages/portal/dist/index.mjs`. The identities matched before and after service reads and inventory hashing. Relative entry paths do not independently prove working directory, environment or loaded bytes.

Console hosts 40032/38188 remain under the corresponding QA parents. Read-only requests also retained local PowerShell ACL boundary helpers 26892 under 39796 (creation 1791850050609) and 29232 under 35244 (1791850057441). Both were present before/after the final snapshot; later read-only decoding verified complete command hash `c6a6361951ec0ab8ab45f9ee8de0f79973ca2c1400a4d4cc54ef56a8dc0b4310` and decoded UTF-8 script hash `8cdde0ad2fb7f820492c508b5e32b301593a2f19f114c7c682cdfeefe0aae602`. The scripts contain ACL operations and stdin `ReadLine`; these facts alone do not authorize execution or killing. Root must compare their exact script to the trusted permission-boundary implementation and freshly bind their handles. Reads can renew a helper, so stale child PIDs must cause refusal and a newly reviewed preflight, not a broad PowerShell allowlist.

The retired coding broker's `62481` is an **execution-session identifier**, not a proven Windows PID. [Root's exit receipt](idle-coding-broker-exit-20261013.json), independently read and hashed here, reports exit 0 and 16 responses for 16 requests, no pending request, no cancellation/deadline reset or replay. This is distinct from observed browser-side cleanup.

## Current jobs, policy and expired generation

Daemon health succeeded, role was leader, browser connection was connected, and portal health returned 200 with `available:true`. The authenticated journal returned 27 rows: 21 succeeded and six pre-egress-rejected, with no pending or outcome-unknown rows. Portal jobs contain 30 rows: 19 succeeded, eight failed, one cancelled and two unknown; no queued/running/awaiting-confirmation/awaiting-approval row. There is one workflow, two portal runs and zero started server activities.

Both original unknown jobs remain unknown with their original deadlines and existing dispositions:

- `fa9b8cbc-2d60-4412-a5b1-a6adb4f6b0e5`: deadline 1791771454650, zero daemon operations, `CHROME_CONNECTION_REQUIRED`; existing `owner-abandoned` disposition records `operator-asserted-prior-runtime`. This is not observed remote cleanup.
- `3cb0290a-4327-4b02-83be-a70a6c61cc25`: deadline 1791816981864, zero daemon operations, `SERVICE_UNAVAILABLE`; existing `owner-abandoned` disposition records `observed`. This newer observation was read from retained state, not inferred from the older task handoff. Neither outcome is replayed or rewritten by replacement.

The policy read matches the new owner-approved grant: external-model, classes public/project-code/design-text/design-image, configured `2026-10-12T23:00:48.660Z`, expires **October 13 at 16:00:48.660 KST**. Preserve the exact existing namespace and opaque policy/network bytes. Replacement neither copies authority into a fresh namespace nor renews expiry.

| Portal run | Retained public status | Signed core run | Retained state and original expiry |
| --- | --- | --- | --- |
| `bc5c4cc6-2261-48b8-b393-f6cc475138cb`, workflow revision 2 | awaiting-agent | `sfp_portal1_1888b85dfa365426c760b5f06ae066b3` | generating; deadline 1791824815611; lease expiry 1791822234539; both expired |
| `13524e1e-e652-4519-bcc1-9742b9cbd791`, revision 1 | awaiting-input | `sfp_portal1_fd039f7fe288366d56a27b8e9193c620` | needs-input; deadline 1791824333611 expired; no lease |

Neither signed run has a candidate or applied hash. Reading signed envelope payloads here is a filesystem projection, not independent MAC validation; the new daemon must validate retained authority through its own store.

The inspected portal `recoverInterrupted()` changes only queued/active/awaiting-approval runs and started server activities to unknown. It preserves these awaiting-agent/awaiting-input rows. `ServiceJobs.open()` would classify newly found pending jobs as cancelled (awaiting-confirmation) or unknown, without dispatch. The signed MCP store has no startup generation replay. Therefore replacement is expected to retain the expired `generating` label and lease bytes, not automatically mark it complete, failed or resumable. Explicit claim/resume rejects the expired run budget; submission also rejects the expired lease. A future generation requires a genuinely new admitted run and fresh authority through the existing public pipeline. No old lease or deadline is extended by the helper. Root's source-bound postcheck must verify these predictions rather than treating this static review as an executed restart.

## Private preservation scope

Final live inventory: 492 regular single-link files, 136 directories, 218,281,334 bytes; zero observed symbolic links, hard-linked files or special entries. Opaque ordered inventory hash: `2c53a9aaa1ac1bd9d4ed82164e408c5ab8df28145af278f5fb76d85d00b6b886`. The earlier inventory had 20,523 fewer bytes because the live instance continued logging. This is a read snapshot, **not an atomic immutable backup**.

Copy the complete stopped anchor: daemon auth/pairing/signing keys and policy/network bytes; journals/evidence/resolution intents and registry; all portal signed records/captures, outputs and workspace files; public portal jobs/database/locks/preferences; logs; old runtime metadata; old failed helper intent, empty publication and historical backup; retained captures and coding-session evidence. Preserve empty directories. Exclude only the newly created replacement backup subtree to prevent recursion. Separate compiled-release closure and archive evidence are also required because the anchor is not a rollback release.

Read-only ACL inspection found the daemon state root and old backup protected with owner+SYSTEM FullControl only. `portal-state` inherits broader access, including Authenticated Users Modify. This review changed no ACL. The new stopped backup, private logs, intent and final receipt must be created below a newly protected owner+SYSTEM directory before writing opaque bytes. Do not claim existing portal files are owner-only or that Windows ACLs isolate a hostile process running as the same user. Root may separately address existing portal-state permissions; that is not silently included in this replacement specification.

## New one-use helper specification for Root

This is a proposed helper contract, not a new executable restart helper or a validate-only deployment pass. Never invoke the consumed October 12 launcher/support intent or retry its failed finish.

1. **Pin gates and release.** In a fresh dedicated hidden PowerShell process, require the final Main/native source fingerprint, exact completed whole attempt/report hashes and all required exited-zero gates, then the matching artifact/archive receipts and raw release manifest. Refuse pending pointers, existence-only checks, mismatched archives/dist/web assets or source changes. Pin the complete new compiled closure before touching either QA process. Primary ports/processes and both Chrome roots remain outside the mutation scope.
2. **Fresh bound preflight.** Repeat exact parent PID/start/executable/command/listener proof, retained public status/journal reads, private jobs/database/signed-run hashes, grant/network hashes and descendant inventory. The allowed retained expired runs are these exact IDs, original deadlines/lease and no candidate/applied publication; they are not a blanket exemption for active work. Refuse any new pending producer, unresolved active journal row, newly running job or unexpected descendant. Pin the broker exit receipt separately. Local/remote producer quiescence must be stated honestly; historical fence dispositions remain historical facts.
3. **Exclusive private intent.** Create a new uniquely named handoff directory beneath the protected daemon state root using exclusive creation. Verify its owner/protected ACL and exact owner+SYSTEM rules first. Create an exclusive closed-schema intent with gate hashes, source/release binding, old identities, state hashes, intended destinations and `automaticReplayAllowed:false`. A preexisting directory/intent or unexpected phase refuses. There is no reuse of the old runtime filename or failed intent.
4. **Held exact stops.** Hold process handles validated against the freshly bound creation identities. Stop only QA portal 35244, then QA daemon 39796, recording each phase. Do not stop by port, command pattern or process name. Pin exact verified console/permission-helper descendants; expect stdin EOF exit within one bounded wait after parent termination. Require fresh absence of those old identities, no orphan under bound parents, and free 4315/3059. A new PID/listener, unexpected descendant or unconfirmed exit is a failed stage, not authority to kill it. No Chrome close/disconnect command or source action is issued. Abrupt parent exit does not prove graceful diagnostics flush or remote cleanup.
5. **Stopped immutable backup.** After confirmed local retirement and before startup, inventory the stopped complete anchor without following links. Reject reparse/symlink/hard-link/special entries and any resolved path outside the owned source/destination roots. Copy to exclusive private destinations, retaining empty directories; publish a full opaque file manifest. Rehash destination and a second stopped-source inventory and require equality. Keep the raw backup immutable, including original run/grant/fence bytes. Any difference blocks startup. Freeze the complete new compiled closure separately with hashes and dependency/package provenance; do not install or build through managed junctions.
6. **Same-state startup.** Launch only the verified compiled daemon and portal entrypoints from the explicit native release root, with QA3059/4315 and the same existing state, workspace and portal directories. Preserve original policy expiry; never seed a fresh namespace. Private logs belong under the new protected handoff directory. Use hidden processes and never print private environment values. Record actual new PIDs/creation times from spawned handles. Wait boundedly for exact sole loopback ownership before any private bearer request. Foreign ownership or identity loss refuses immediately; transport readiness alone may be retried within the fixed startup bound.
7. **Postcheck and publication.** Recheck new ownership before every authenticated read and after readiness. Require the new build/source/archive closure and leader binding; primary identities and Chrome9932 unchanged; signed records remain readable; no automatic operation replay; both old unknown outcomes/dispositions and deadlines retained; policy/network authority unchanged except legitimate leader credential rotation; exact expected startup recovery for any preflight-allowed rows. For these two waiting rows, expect preserved expired core state rather than fabricated completion. Opaque auth/signing material and original keys must remain consistent; new leader metadata need not byte-match old credentials. Create the final runtime receipt exclusively **inside the already protected new directory**, verify its inherited privacy and safe projection before publication, and never attempt owner-setting on the old empty anchor file. Finish only after every postcheck passes.
8. **Failure handling.** Every failure durably retains its phase, previous phase and bound identities, with closed error code plus truncated-message hash. No raw exception, secret or browser endpoint is printed. Preserve partly started processes and backup for Root inspection. No automatic restart, rollback, intent replay, unknown resolution or deadline/grant renewal follows a failed stage. Any subsequent action uses a separately reviewed new intent tied to the actual resulting state.

## Remaining gates and limits

Priority is fresh whole/artifact completion followed by Root's concrete helper implementation/review and execution-time rebind. The present report is insufficient to stop/start processes: its live log inventory is mutable and its child identities can naturally change. Current expired generation is retained evidence, not an active coding broker or successful frontend acceptance. No new source capture, native security approval, runtime replacement, stopped backup, final artifact pass or end-to-end application result was executed here. Root should link this supplement and its receipt from the canonical analysis and AGENTS bridge when integrating the report, preserving unrelated concurrent edits.
