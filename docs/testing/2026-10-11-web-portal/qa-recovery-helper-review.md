# Prepared QA restart helper: independent static review

Review date: October 12, 2026 (Asia/Seoul).

This review follows [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [canonical analysis](../../service-analysis.md), [the read-only deployment readiness review](qa-recovery-deployment-readiness.md) and [the retained-tab record](retained-tab-live-qa.md). The coordinator owns live execution. The reviewer owns this report only and has not invoked any helper mode, service request, process operation, ACL write, Chrome action, policy grant, fence disposition or replay.

## Bound candidate and source

The prepared v4 helper is native ignored tooling, not production source:

| File | SHA-256 |
| --- | --- |
| `service/.cache/restart-qa-recovery-20261012.ps1` | `599b7001c49a51fee2d53f88cc4be8332a94bcd109eefbc4ed6d9796c5c9ca3e` |
| `service/.cache/qa-recovery-support-20261012.mjs` | `ff211e8c1f69f22586904be32b46a9641730c362218181c8c61ccafea913adb8` |

Both hashes were checked before source inspection. Main/native production source remains `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`. The coordinator reports the exact renewed whole passed all sixteen gates with 5,395 passed, zero failed and twenty skips, including 117 required Chrome cases; the separate artifact-content check passed 1/1. The helper pins whole attempt `f5647503-041f-4d6d-8659-913c4755c936` and report hash `16b7116fcc45106482524acfc805b75341fe99dff276bea002340720f18da09d`. The artifact checkpoint was read at `full-source-a476/artifact-contents-checkpoint.json`, bound to that source/attempt and focused run `b33762c5-d369-473c-9fdb-9d03eb723c03`.

Root's actual v4 `-ValidateOnly` pass is coordinator evidence. It does not exercise parent stopping, new listener startup, stopped backup or recovery finalization. Earlier Windows separator and strict descendant refusals remain preserved. No reviewer execution is claimed.

## Blocking static finding

**P1: v4 authenticates to a replacement daemon before proving its listener belongs to the spawned process.** The launcher runs `Start-Process`, records the new daemon and calls support `daemon-ready`, then performs `Assert-NewQaListener`. The support stage constructs the compiled `ControlClient` and issues authenticated `/control/status` requests. `ControlClient.request` loads the private QA generation/bearer and sends it over native HTTP; it does not verify Windows listener PID. A foreign listener that wins the port-free-to-spawn gap can therefore receive private authentication before the helper later rejects its ownership. The current daemon may fail to bind/become a follower, while the foreign service receives the readiness request. This is a source-confirmed ordering concern, not an executed port takeover.

The corresponding portal sequence calls `postcheck`/bootstrap before validating its new 4315 listener. That request contains no explicit private bearer, but its `fetch` defaults to following redirects, permitting an unexpected loopback listener to send the helper beyond its intended owned endpoint. A successful bootstrap response alone must not establish process ownership.

Required narrow correction: wait within a fixed bound for each exact newly spawned PID/start/executable/entry and listener ownership before issuing any authenticated daemon request or portal bootstrap. Reject a foreign listener or lost/reused process immediately; never kill it. Retain the post-readiness listener/lock rechecks. Use error/manual redirects and validate the exact bootstrap response URL/status. Preserve consumed intent and any new owned processes on refusal. These checks reduce the local startup race; they do not create an OS network/process sandbox.

This finding was sent promptly to the coordinator and helper author. **v4 remains rejected historical evidence.** The exact v5 correction and current approval are recorded below; no foreign-listener takeover was executed by this reviewer.

## Other critical boundaries inspected

| Boundary | Static observation |
| --- | --- |
| Old process scope | Exact native cwd, Node executable, complete command-line hashes, creation times and sole loopback listener PID are checked for only portal 39752/4315 and daemon 36248/3059. A process handle is bound before `Stop-Process -InputObject`; PID presence/reuse after exit is rejected. No primary/other QA/Chrome process is stopped. |
| Specific child scope | Optional worker 40136 and its conhost 34560 are bound by parent/start/executable/full command hash; worker decoded UTF-16 script hash is pinned. Exact console hosts 33072/44308 are separately bound. Arbitrary/new descendants and orphans under known helper IDs are rejected. No blanket PowerShell whitelist or child kill exists. Held handles must exit under one ten-second bound after parent stop, followed by fresh PID/descendant absence and free ports. This verifies local retirement only. |
| One-use progression | Existing backup/new-runtime record blocks replay. Exclusive private intent and closed expected phase transitions record preparation, old parent stops, backup, new startup and completion. Failure retains previous stage and forbids automatic replay/rollback. A partially started process is preserved for coordinator inspection, not silently killed. |
| Source/new artifact guards | Both main/native fingerprints, exact source-check pointer/report/hash, sixteen exited-zero gates and separate source-bound artifact report/scope are verified. Archive hashes and current dist/served-web content match manifests. The new release closure is separately copied into a private subtree and hash-checked. Recheck/prepare-logs/finish retain source/closure equality. |
| Old state guard | Exact old runtime, registry, seventeen-file old JS backup and original `fa9b8cbc...` row hash/status/deadline/update time/zero operations/no disposition are pinned. Jobs and portal DB are parsed/hashed from the same buffers. Preparation/recheck require no active jobs/runs/started activities. The stopped copy keeps full job/DB hash and run/workflow counts equal before declaring backup complete. Network files/policy bytes must remain unchanged. |
| Private preservation | Full stopped anchor is copied, excluding only the newly created backup subtree. `lstat`, real paths and single-link regular-file checks reject links/hardlinks/special files; empty directories are retained. Copy destinations remain within owned roots, creation is exclusive, destination hashes and a second stopped-source inventory are checked. Full manifest is published before final stopped-intake equality assertions so a refusal still preserves evidence. |
| Windows ACL | Existing state ACL is verified read-only. Only the newly owned backup subtree/new runtime record/temp files receive protected owner plus SYSTEM FullControl ACLs through fixed .NET/PowerShell tooling. Exact rules/owner/protection/inheritance are checked. Files inherit a private parent before final explicit ACL verification. No real credential values are printed. Same-user adversarial replacement is outside the sandbox guarantee. |
| Error/log secrecy | Support failures expose a closed stage/code, truncated-message hash and own module line/column only. The launcher emits fixed failure text, no raw request/credential/stack. Opaque auth is privately copied rather than reported. Compiled service stdout/stderr stays in private ACL-bound logs. |
| Honest finish limits | Final record explicitly retains unknown state, no fence/data/deadline/replay effects, and `gracefulDiagnosticsFlushConfirmed:false`, `browserSideRetirementConfirmed:false`, `legacyOwnerAssertionStillRequired:true`. Abrupt Windows process termination is not presented as graceful flush or remote browser retirement. |

The launcher changes its own process environment without a restoration block. Execute it only from a fresh dedicated PowerShell process, not by dot-sourcing into a retained operator shell. Child-local QA environment changes do not alter existing primary/Chrome processes. A stopped backup and successful new leader do not authorize claiming the legacy remote producer is observed-quiescent or abandoning its fence; any subsequent disposition still needs its actual bound recovery checks and truthful owner assertion.

## Evidence and continuation

Executed review consisted of file hashes/source reads and the existing source's `ControlClient` request trace. No helper mode, including `gates` or `-ValidateOnly`, was run by this reviewer. Source/state/process/ACL/browser remain untouched. Report actual stop/start/backup results separately; this review cannot predict them from a validate-only pass.

## v5 correction and final static approval

**The exact v5 prepared helper is statically approved for root's controlled validation/execution.** No outstanding blocker remains in the reviewed helper. This is a source review of private tooling, not a claim that deployment, backup or physical/remote retirement happened.

| Current file | SHA-256 |
| --- | --- |
| `restart-qa-recovery-20261012.ps1` | `268c0d61859a6aa1bedabe0d806cdaa5c70b2d683e5b0e8a16cafd773da6551a` |
| `qa-recovery-support-20261012.mjs` | `c218b6a471b5004da6b62e49993344feee60c7e5be09ce26747af7a78d87b0d1` |

Both hashes matched before and after inspection. The complete v4-to-v5 delta was read against the preserved v4 files. It adds only the reviewed startup/read-ownership and redirect guards; the exact old-process/child scopes, one-use progression, source/artifact/stopped-state/ACL/unknown-policy preservation and honest retirement flags remain as inspected above.

- The launcher now waits up to forty-five seconds for the exact spawned PID/start/executable/entry/full command hash and sole `127.0.0.1` listener before invoking new-daemon authenticated readiness or portal bootstrap. No listener permits bounded waiting; a foreign listener, lost/reused PID or command mismatch refuses immediately. It never kills that listener owner.
- The companion independently checks ownership before every authenticated status request and every journal page, every new readiness iteration, and again after readiness. New daemon references come from the consumed intent; old preflight references remain the exact old binding. These identity failures sit outside transport retry catches and cannot be treated as transient readiness errors.
- Portal bootstrap uses `redirect:'manual'`, exact response URL equality, `redirected:false` and explicit 3xx refusal. Identity and redirect violations are outside the JSON/transport retry catches. Existing post-readiness listener and portal-lock checks remain.

The author reports syntax checks for both files and the two fixed embedded PowerShell programs passed. Root owns any actual `-ValidateOnly` or operational run; this reviewer did neither. Fresh dedicated PowerShell invocation and execution-time identity/state/child-exit checks remain required. A read-only ownership check before a request is a practical continuity guard, not atomic mutual authentication or an OS sandbox against same-user hostile replacement.

The owner's broad work authorization is acknowledged by the coordinator. It does not create missing Figma client eligibility or prove that a borrowed browser's already issued actions and cleanup ended. Any later local fence disposition remains separately bound to the real recovery transaction and truthful producer-retirement facts; the helper itself performs no such action.

## v6 metadata-only rebind and later execution limit

The coordinator reported v5 execution refused before intent/process mutation because its safe reads naturally renewed the fixed boundary worker. The exact v6 launcher `5dc09a4e3c7e319a060b7c2cf98f1e0add2254919b4110da66c1a21f39a9688a` was compared against preserved v5 and statically approved for **only two metadata-row changes**: worker 40136/start 1791782920683 became worker 45152/start 1791784730178 with parent 36248; console host 34560/start 1791782920699/parent 40136 became 18804/start 1791784730183/parent 45152. Exact executable/command/script hashes and every scope, EOF-exit, ownership-before-read, one-use, ACL and state guard stayed unchanged. Companion remains `c218b6a471b5004da6b62e49993344feee60c7e5be09ce26747af7a78d87b0d1`.

The coordinator subsequently reported v6 retired its exact old parents/children, captured a complete stopped 65-file backup and started replacement daemon 39796/portal 35244, but finish failed before publishing its runtime receipt. The inherited anchor ACL did not permit the non-elevated process to set ownership on the newly opened zero-byte receipt file. The consumed intent is failed with previous stage postchecked; the empty file and failed evidence are retained. This report does not convert that partial operational result into a helper success and does not authorize retrying finish/restart. Any separately placed private completion receipt is a new coordinator decision with exact actual readback, not replay authority. The reviewer executed none of those operations or subsequent ACL investigations.
