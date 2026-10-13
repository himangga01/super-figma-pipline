# QA deployment and local-fence recovery readiness

Analysis date: October 12, 2026, approximately 13:45–13:51 KST (04:45–04:51 UTC).

This is a read-only deployment/recovery review under [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [canonical service analysis](../../service-analysis.md), [the retained-tab record](retained-tab-live-qa.md), [the recovery analysis](../../analysis/portal-local-capture-recovery.md) and [the frozen independent review](local-capture-recovery-review.md). The coordinator exclusively owns deployment, source Chrome, live state and any real recovery decision. This review changed only this report.

## Baseline and purpose

The service exposes a same-origin local portal backed by a private daemon. The portal runs public CLI/MCP features, retains job outcomes and mutation fences, and owns a separate Chrome feature connection. The daemon owns workspace registration, journals and policy. A zero-operation local Chrome capture can therefore retain an unknown portal fence without a corresponding unresolved daemon operation.

Main source was read directly as `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`. The coordinator reports renewed whole attempt `f5647503...` is currently in its test gate. No pass or completed package/runtime acceptance is inferred. This source includes the exact reviewed recovery candidate and subsequent reconciliation; the independent source approval remains bound to its twenty-four files, not to an unexecuted whole result.

The actual QA processes were created from compiled source `sha256:31e47b614fbc093b160d562e7b4107a4c1ad473965237b086f100663bb4f5ef5`. Their runtime receipt and preserved compiled manifest identify that source. Later source/build overlays do not establish what all modules already loaded into those processes contain. Current recovery capability must not be assumed deployed until the replacement process/package identities are explicitly verified.

The owner's two approved `chrome.tabs` reads are historical actual QA connection evidence: jobs `05e26523-4eb7-42c1-8774-d19746fe23ad` and `a8697604-e586-48be-80ad-262576af1716` succeeded in the same Chrome 9932 page at portal 4315, with identical output hash. [Their sanitized receipt](qa-chrome-approved-31e4.json) establishes connection reuse for those requests. It grants neither data egress nor permission to abandon a fence.

## Observed runtime and state

Read-only process/listener metadata matched the recorded exact identities:

| Owned QA component | PID | Creation time UTC | Listener |
| --- | ---: | --- | --- |
| Daemon | 36248 | `2026-10-12T02:01:17.0624280Z` | `127.0.0.1:3059`, owned by 36248 |
| Portal | 39752 | `2026-10-12T02:01:17.0820890Z` | `127.0.0.1:4315`, owned by 39752 |

Both are `node.exe`, with parent 37096. Only their console-host descendants were observed: 33072 under the daemon and 44308 under the portal. No execution worker or ACL helper descendant was present at the snapshot. This is a momentary process-tree observation, not proof that every remote browser action or in-memory promise has ended.

The exact complete Windows command lines were hashed as UTF-8 without normalizing quotes, spacing or case; no raw command line or endpoint is needed in a stop/restart receipt. Both executables are `C:\Program Files\nodejs\node.exe`, neither uses `-e`/`--eval` or `--input-type=module`, and their recognized entry paths are:

| PID | Expected entry | Complete command-line SHA-256 | Expected creation epoch ms |
| --- | --- | --- | ---: |
| 36248 | `packages/mcp/dist/daemon-entry.mjs` | `5ccf93669310bd2b91c40eefc316af33789224efa60aa91a5655eaa8ee79ce1f` | 1791770477062 |
| 39752 | `packages/portal/dist/index.mjs` | `f8c8cec83e151dff0a43c87e13be26793eae9228783c4f61d7706ad868d48737` | 1791770477082 |

Before any root-owned process mutation, requery the exact PID and require its executable, creation epoch, complete command-line hash and corresponding loopback-listener ownership to match together. Validate the intended working directory/artifact closure independently because an entry path is relative and a command hash cannot prove the live environment or loaded module bytes. A PID mismatch/reuse, different command hash, absent process or foreign listener is a stop condition, not permission to act on the new owner.

Current `portal-state/server.lock` contains PID 39752, with hash `385666f14cd5105658a2a12924871630847e8db1320ecfd369c83b7aed615d91`. The public diagnostic leader note at the Windows temporary `figwright/leader-3059.json` identifies PID 36248, port 3059 and build ID 1791770276710, with recorded process-start 1791770477135. Its approximately 73 ms difference from CIM is consistent with the note's documented Windows uptime fallback. The note is not credential authority and cannot replace exact CIM/listener checks.

Owned QA anchor: `.worktrees/_cache/portal-cdd-export-repair-20261012/`.

| Persistent scope | Observed content |
| --- | --- |
| `portal-state/service-jobs.json` | Version 1, ten jobs: six succeeded, three failed, one unknown. Zero queued/running/awaiting-confirmation/awaiting-approval rows. |
| `portal-state/portal.json` | Version 2, zero workflows and zero runs; 67 activity rows, none in `started` state. Recorded `intent` activities are observations, not active execution proof. |
| QA daemon journal | Active operations file empty; three tombstones, all `pre-egress-rejected`; no observed queued/dispatched/pending/unknown operation row. Resolution-intent and operation-evidence files were empty. |
| Workspace registry | One workspace, `be9cf50c-fe5c-4638-b504-13e808b56dbe`, pointing to the anchor's `workspace` directory. It is a directory, not a link, and its canonical real path matches its registration. |
| Owned workspace | Zero files, zero observed links. Missing capture files do not classify the old unknown outcome. |
| Network directory | Empty at the filesystem snapshot. No grant was copied, created, renewed or inspected through credential-bearing control calls. Earlier doctor failures were `EGRESS_CONFIG_REQUIRED`. Fresh deployment must verify public fail-closed policy again. |

The jobs and portal file hashes remained identical across the two inspection reads:

| Evidence | SHA-256 |
| --- | --- |
| `portal-state/service-jobs.json` | `f272325ae2ef5b03c62ac11a0a2043b6b5f353778a58b57fb3123705938a6ec7` |
| `portal-state/portal.json` | `d27250c612550c80c552845b82c5e2ec5c9e87059f3f31290746ad24711c5ac1` |
| `appdata/SuperFigmaPipeline/workspaces.v1.json` | `a8d7a5d7715871ee13cc10b81bf7cb75f54fb04d35b864f203e43ddedb17a29e` |
| `runtime.json` | `7d485981a63194772dcd90e9af55f3a9d86aff67a902bcbd60cc0196989fc6f9` |
| Existing compiled-31e4 backup manifest | `833a68627ccc438a0f424e8ca1774217844136feb66d738a357066ead25b4f3e` |

These are snapshot integrity values, not service challenges, secret material or an atomic backup manifest. The registered workspace identity projection currently hashes to `28656dab935f8c44088de87d24ed8f85e0013631aef609a4e7f776eb896167eb`. It must be freshly computed by the deployed public recovery path; the value here cannot authorize a later decision after directory replacement.

## Exact unknown that must survive deployment

| Field | Preserved value |
| --- | --- |
| Job | `fa9b8cbc-2d60-4412-a5b1-a6adb4f6b0e5` |
| Feature/type | `chrome.export`, `feature` |
| Workspace | `be9cf50c-fe5c-4638-b504-13e808b56dbe` |
| Outcome/classification | `unknown`, write-classified composite |
| Original created/updated | `2026-10-12T02:02:34.650Z` / `2026-10-12T02:05:34.722Z` |
| Original deadline | `1791771454650`, `2026-10-12T02:17:34.650Z` (11:17:34.650 KST) |
| Retained daemon operations | Zero |
| Error/output | `CHROME_CONNECTION_REQUIRED`; null output hash/bytes |
| Owner disposition | Absent |

The persisted row serialized with Node `JSON.stringify` has SHA-256 `f167ff33b571a78dd408a009c23bf7f8a34a595a6e4bae0e506c6b31b7843008`. Use it as a before/after integrity baseline together with exact field comparison. It is not an issued recovery fingerprint/challenge and cannot authorize a mutation.

The original attempt reached its 180-second connection limit before the repaired native-export preflight. Its elapsed timeout, later successful tab reads, empty workspace and stopped future process cannot retroactively prove failed-with-no-effects. The ordinary public Inspect action on this old compiled runtime cannot settle this composite. Preserve its row, evidence, deadline, argument hash and result metadata. It continues to fence its workspace and overlapping null-scope administration.

The two older primary portal unknowns and the three original daemon unknowns are separate states. This QA deployment must not touch their processes, roots, grants, evidence or dispositions.

## Private backup scope and restart conditions

A non-following `lstat` inventory observed the whole QA anchor as **65 files / 7,213,700 bytes / 24 directories / zero links**. Its included subtrees were:

| Included subtree | Files | Bytes | Purpose |
| --- | ---: | ---: | --- |
| `appdata` | 25 | 103,640 | Complete QA daemon namespace, registration, journal, diagnostics and opaque authentication material |
| `portal-state` | 4 | 364,156 | Jobs, workflows/runs/activity, diagnostics and lock evidence |
| `workspace` | 0 | 0 | Exact registered filesystem identity and any later capture evidence |
| `compiled-31e4-before-recovery` | 18 | 6,338,742 | Seventeen old compiled files plus existing source-bound manifest |

The remaining files/directories contain runtime metadata, launch logs and the actual failed/export/tab-read/logging evidence. Preserve the entire anchor rather than just `service-jobs.json`. Protect the backup privately under the owner's account. Authentication files may be preserved opaquely by an authorized private backup, but their contents must not be printed, placed in this report, committed or used to manufacture a fresh validation namespace. This reviewer did not read their contents or make a backup.

The old compiled manifest covers thirteen MCP, three CLI and one portal JavaScript dist file. It does not include older frontend assets, build-info metadata or package archives, so it is old compiled-code preservation rather than a proven complete rollback release. Preserve it, and separately bind the actual newly deployed compiled/served assets and source/package receipts. Do not reconstruct or roll back state under an indeterminate operation from this backup.

The current counts are preparatory. Logs may grow and the process can still receive new requests. A safe root-controlled replacement requires these checks at execution time:

1. Wait for the exact a476a925 whole result and required artifact-content/package checks. Verify stable source fingerprints and the actual CLI public proof getter/Chrome owner exports in the new compiled artifacts. A passing old 31e4/f0dc artifact or a cached live library is insufficient. Keep the pinned artifact epoch separate from all execution/grant/confirmation deadlines.
2. Recheck these exact PID/start-time/listener identities, the owned state roots, every pending job/run, journal state and process descendants. Stop intake and preserve any unsaved same-tab UI draft before reload. If state changed, active work appeared, a foreign process owns a listener or cleanup is unconfirmed, stop the replacement sequence and investigate; do not kill the new listener owner.
3. Retire only the owned QA portal/connection, then the owned QA daemon, and record actual termination/listener absence. The service has `server.close` → bridge/Chrome-owner close → bounded diagnostics flush → state-lock cleanup hooks, but a Windows forced process termination is not proof those hooks ran. Do not label an abrupt stop as confirmed graceful cleanup. Keep Chrome 9932 and source Chrome separate and running; do not close their pages/contexts/browser or automate native approval.
4. While the owned writers are stopped, create and verify a new private immutable backup of the whole anchor and exact old compiled closure. Reject unexpected links/path replacement and check the resolved destination stays in the intended backup location. Preserve unknown row/evidence bytes and original workspace identity. This is a same-state deployment snapshot, not permission to copy a grant/history into a fresh test state or roll back an indeterminate action.
5. Launch only the new source-bound QA daemon and portal with the same intended QA roots/3059/4315. Pin `LOCALAPPDATA` to this QA anchor's `appdata`, `FIGWRIGHT_PORT=3059`, `SFP_CONTROL_PORT=3059`, `SFP_PORTAL_PORT=4315`, `SFP_STATE_ROOT` to its existing daemon namespace and `SFP_PORTAL_STATE_ROOT` to its existing `portal-state`. The daemon resolves its default state through `LOCALAPPDATA`; setting only `SFP_STATE_ROOT` does not select its namespace. The portal uses `SFP_STATE_ROOT` for its private CLI client. Derive any existing authorized Chrome profile from verified Unicode-safe user environment, without publishing its private endpoint. Keep any parent environment restoration explicit. Verify new PID/start-time/listener/leader and build identities before exposing the same retained portal page.
6. Read back the ten job statuses, original unknown fields, zero workflow/run count, registration and fail-closed policy through the service's normal public surface. A restart must not clear/reclassify the unknown or replay anything. Inspect logs for startup/recovery/flush errors. Root may then present the new recovery UI and current blocker reasons; displaying the action is not owner acknowledgment or successful recovery.

This report provides conditions for root's already owned deployment work. It neither executes a restart nor creates independent permission for a fence disposition or data grant.

### Expected files and retention behavior on restart

Restart is not byte-inert. Preserve the stopped snapshot first, then distinguish expected metadata changes from any unacceptable change to the original unknown:

| Component | Implemented restart behavior and required check |
| --- | --- |
| Portal lock | `packages/portal/src/index.ts` creates `server.lock` exclusively and writes the new PID. A clean shutdown unlinks it after server closure/flush; an abrupt stop may leave it. Startup only replaces a stale lock after its PID liveness check returns `ESRCH`. Do not manually override a lock whose process remains live. |
| Portal database | `PortalStore.recoverInterrupted()` serializes a database write even when no row qualifies. Server `started` activities become unknown; queued/active/awaiting-approval runs become unknown with restart evidence. This QA currently has neither such activities nor any run. New startup/read activities and diagnostics will legitimately change the database/log bytes, so compare original job fields/evidence rather than requiring every state file hash to remain fixed forever. |
| Service-job database | `ServiceJobs.open()` rewrites only if a pending row exists: awaiting-confirmation becomes cancelled, other dispatched pending states become unknown, with restart error/update time. Current ten rows are terminal; the old unknown must retain its original fields with no automatic disposition. In-memory results, progress observers, producers and challenges start empty. Prior success hashes remain history even when ephemeral result bodies are unavailable. |
| Daemon generation/auth | Becoming leader rotates generation/control/follower credentials through `security/follower-auth.ts` and replaces the private leader-auth file atomically. Existing owner principal/operation-ID keys are loaded or created through their normal private stores. Root must preserve the namespace, not restore stale generation credentials after the new leader binds. No credential value is needed in the review/receipt. |
| Leader note | `election/leader-lock.ts` deliberately leaves its diagnostic note on shutdown/demotion and overwrites it when a new leader binds. A stale note during the no-listener interval is expected. Validate the new live PID/start/listener/build afterward; do not delete shared temporary state to force takeover. Preserve just this old note as optional diagnostic backup, separate from the whole QA anchor. |
| Daemon durable recovery | `index.ts` recovers resolution intents, reservations/durable operation state, remote-domain state and admin audit before exposing the initialized execution runtime. Its recovery finalizer forbids new artifact creation. Depending on retained records, journals/anchors may change during recovery. This is normal reconciliation, not replay authority and not portal fence abandonment. |
| Retention | After initialization, a startup sweep is scheduled on the next timer turn, followed by daily sweeps. It compacts receipt/egress journals, drains cleanup intents, scans available registered workspaces and purges eligible expired tombstones while respecting linked evidence/holds. Existing QA active evidence/egress/cleanup files and workspace were empty, and three terminal tombstones were observed. This reduces current retention exposure but does not promise no metadata/anchor change. Capture the complete stopped namespace/evidence before initialization and retain sanitized sweep/recovery outcomes. |
| Logs/permissions | Readiness/recovery/request logs may append/rotate; private permission initialization can verify or repair the service-owned ACL boundary. Do not count log growth, a new PID or new generation as an unknown-result change or a renewed execution/data deadline. |

These behaviors were traced in current a476a925 source, not executed in this review. The deployment must distinguish any old-runtime shutdown behavior from the new source's startup behavior.

## The separate owner acknowledgment still required

After a controlled restart, `ServiceJobs` has no in-memory producer receipt for the old job. The deployed implementation therefore treats it as historical/legacy. Even a healthy new Chrome owner and confirmed old Node termination do not convert that missing receipt into machine proof of all remote browser actions.

The exact additional assertion required by the public action is `priorProducerRetired:true`, recorded as **`operator-asserted-prior-runtime`**, not `observed`. The owner must explicitly confirm that the original execution producer and all delayed source-changing work/cleanup have completely ended. For this QA attempt, that decision needs the retirement record for old portal 39752/daemon 36248 and an honest limit concerning the surviving borrowed Chrome connection/actions. If that assertion cannot be made, the fence stays intact. Do not obtain it by inference from the old connection error, empty output, expired deadline or later tab success.

Enough evidence to ask that specific question is: a preserved source-bound old compiled closure and complete stopped-state snapshot; exact old process identity validation followed by recorded termination and listener absence; no active job/run/journal/worker at retirement; shutdown/cleanup results with any unconfirmed or forced path explicitly named; new source-bound deployment/readback preserving the original unknown and canonical workspace; and the new recovery projection's current cleanup blocker/legacy-assertion requirement. These facts make the owner's decision concrete. They do not themselves prove all remote browser effects stopped. Do not ask for a blanket recovery approval or state that an absent PID proves remote cleanup. If an old source-changing action remains known pending or cleanup is known failed, resolve that retirement boundary before presenting abandonment as ready.

Root must present the exact job/workspace, original result/deadline, preserved evidence and the remaining uncertainty. Suggested explicit acknowledgment content is:

> I have reviewed unknown Chrome export job `fa9b8cbc-2d60-4412-a5b1-a6adb4f6b0e5` in workspace `be9cf50c-fe5c-4638-b504-13e808b56dbe`. I confirm that its previous execution producer and all delayed source-changing work and cleanup have completely ended. I understand that its original outcome remains unknown. I explicitly authorize recording owner abandonment of this job's local mutation fence only, with the reviewed reason/evidence hashes. This does not authorize replay or a data grant.

The reviewed evidence/rationale must be bound to fresh server-issued `prepare-recovery` output from the new deployment: exact row fingerprint, current canonical workspace identity, one-use challenge and sixty-second expiry. The final `abandon-local` request must include the explicit exact confirmation and reason/evidence hashes, with legacy assertion true. Current producer/deferred-work/cleanup quiescence remains mandatory and is rechecked with fingerprint, binding and expiry immediately before the serialized disposition commit. Do not reuse a copied challenge, this report's hashes or an expired token.

If the owner authorizes that concrete decision, the effect is only a durable separate `fenceDisposition` and audit. Original status stays unknown and original timestamps/deadline/evidence/results stay unchanged. Only this row's fence contribution changes; other unknowns continue to block. Read back after an uncertain response before any further action. Never automatically repeat the mutation.

The earlier Chrome Allow is insufficient for this acknowledgment. The separately pending eight-hour four-class model-data question is also insufficient. Data permission, any new capture request with new job/output identity, CDD acquisition/parity/generation/application, official MCP authentication and final eCommerce acceptance remain separate decisions and gates.

## Evidence and limits

Executed inspection used only instruction/report/source reads, whitelisted persistent-state projections and hashes, `Get-CimInstance` exact-process/descendant metadata, exact-port `Get-NetTCPConnection`, and a Node `lstat` inventory that did not follow links. No service HTTP request, credential read, Chrome control, test, build, process start/stop, source edit, state write, policy grant, fence action, replay or backup occurred. Persistent state files were stable across two reads; this is not an atomic snapshot or an in-memory producer inspection. Root must repeat live quiescence and identity checks after the whole check before deployment.

The retained-tab/canonical reports still contain older chronological pending statements. This report preserves their history while distinguishing the current reviewed source, current compiled QA runtime and actual executed tab reads. No whole pass, new-source QA deployment, capture output or frontend acceptance is claimed.

## Later prepared-helper review, October 12

The earlier read-only snapshot remains historical. The coordinator now reports unchanged a476a925 source passed all sixteen whole gates with 5,395 passes/zero failures/twenty skips and the separate artifact check passed 1/1. No runtime replacement is inferred from those source results. A later exact read-only Windows boundary worker and its console host are separately bound in the prepared launcher; their appearance supersedes the earlier no-worker snapshot for launch-time decisions without rewriting that observation.

Read [the prepared helper static review](qa-recovery-helper-review.md) before operational execution. Its v4 candidate had a blocking startup-order finding: authenticated new-daemon readiness preceded exact spawned-listener ownership validation, and portal bootstrap preceded its listener validation with redirect following. Root's v4 validate-only pass did not exercise that path. The exact v5 correction is now statically approved: launcher `268c0d61859a6aa1bedabe0d806cdaa5c70b2d683e5b0e8a16cafd773da6551a`, companion `c218b6a471b5004da6b62e49993344feee60c7e5be09ce26747af7a78d87b0d1`. It proves new listener identity before requests, repeats proof for each authenticated read/bootstrap, and rejects bootstrap redirects. Root still owns operational validation, actual termination/child exit, snapshot and new deployment evidence. No reviewer process/state/ACL/Chrome/fence/grant action occurred. The owner's later broad work authorization does not manufacture missing Figma registration facts or physical/remote producer retirement proof.
