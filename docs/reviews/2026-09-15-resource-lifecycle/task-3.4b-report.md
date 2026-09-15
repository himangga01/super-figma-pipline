# Task 3.4b implementation report

## Status

Implementation is ready for independent review in the isolated native working copy. This is not a final service, release, visual-fidelity, or publication completion claim. No primary daemon build, live browser operation, Docker/VM/WSL use, dependency change, Git staging, commit, or push was performed. Main must review and integrate only the exact owned bytes listed below.

The existing reviewed multi-resource queue from Task 3.4a is consumed without changing its implementation.

## Implemented contracts

- `native-resources.ts` prepares a read-only owner/profile/source-bound resource grant before owner registration. The exact prepared native profile contains environment authority, broker binary identity/hash, fixed broker-program hash, configuration bindings, actions, a 24-hour grant lifetime, and the retained-artifact disposition. Registration and subsequent preparation verify existing authority rather than silently renewing it. Unsupported providers and non-Windows process-proof hosts return explicit prerequisites. Historical missing environment authority remains parseable but cannot register/execute current validation or satisfy completion.
- The default resource is an actual owned SQLite database in a unique per-operation directory directly below the approved state root. Candidate and applied attempts derive different identities. Configuration expansion is separate from the immutable `native.environment` whose hash Task 3.3 already verifies. Reserved environment bindings, duplicate bindings/resources, invalid actions, source/artifact overlaps, and changed configuration are rejected.
- Shared local SQLite keys bind retained parent identity plus a normalized ASCII leaf. Missing-to-created databases retain the same key. Case variants converge; URI/device/network paths, unresolved aliases, junction ancestors, nonregular files, hardlinks, reserved Windows names, and alternate short-name leaves reject. WAL/SHM/journal companion files belong to the same database and are checked. The shared file's approved identity and parent observations are retained through release/reconciliation.
- Repository authority remains unchanged. A separate execution-authority hash binds operation/run/owner, target, candidate source, complete profile/grant hashes, broker identity, resource set, concrete directory, and runtime environment. Executor fingerprints bind it before admission. Validation takes the repository read lane, per-run process lane, and all database lanes together; apply retains the repository write lane. Resolved environment paths and resources appear in approval effects/labels.
- `native-lifecycle.ts` uses actual signed PortalStore CAS records for the bounded retained-attempt index, per-attempt state, and canonical shared/owned resource claims. Claims and acquisition/creation intents precede effects. Attempt directories, staged work, and private HOME have persisted identities. The real SQLite database is provisioned and retained, including module policy/trace/generated evidence. Replayed operation attempts never relaunch.
- Windows broker launch uses a separate control pipe with an independent secret token. The fixed broker waits until its actual PID/birth identity, executable identity, daemon generation, parent PID, attempt, and token are persisted before project code receives a permit. Queued stop requests persist in the in-memory control protocol and prevent a later permit. Parent EOF and kill-on-close Job safeguards remain. A bounded native Job membership drain uses owned process handles and verifies membership before terminating descendants; it never kills a disk-recorded PID. Stop receipts are separate from project output and must match the recorded broker PID/birth/token.
- Success, ordinary failure, timeout, cancellation, and parent EOF release durable resources only after verified native stop evidence and retained-directory/resource checks. Missing stop proof, broker loss, creation identity gaps, directory replacement, and failed persistence retain quarantine. Reconstruction consults signed claims rather than in-memory ownership. Interrupted acquisition with no creation/process effects releases only claims proven to belong to that attempt.
- Owner-only inspect/reconcile routes and CLI commands expose retained attempts without resolving project sources. Reconciliation binds a fresh exact inspected receipt through an action nonce. It can repair release/retention persistence after already recorded stop proof. Missing process/tree evidence remains quarantined; there is no caller boolean, PID-only kill, recursive deletion, or arbitrary shared-database cleanup.
- Native acceptance contains the execution and terminal lifecycle receipt hashes, attempt, candidate/applied target, and retained disposition. Apply checks the signed receipt's owner/run/candidate/repository/target binding. IR completion requires current lifecycle authority.

## Consuming defects found during implementation

1. Queued abort and the ordinary executor cancel endpoint could race and finalize egress twice after adding real queue cancellation. Both now share one durable pre-dispatch settlement promise. The regression awaits invocation settlement before releasing the incumbent queue lane.
2. Public `portal_cancel` previously could not reach validation waiting outside the coordinator's active map. It now invokes an owner/run-bound executor bridge for pending portal reservations. A real Coordinator + Executor + journal regression exercises public cancellation and proves no native dispatch while the incumbent remains held.
3. Source authority used an identity transform, preventing actual executor result-schema hashing with `toJSONSchema()`. A throwing numeric refinement plus declarative maximum 2 preserves historical version 1/missing inspection, current version-2 enforcement, and the stable future-version error. No schema-hash weakening or `unrepresentable: any` escape was added.
4. Generic AtomicFileStore defaults retain only 64 generations per target, insufficient for a supported 32-command lifecycle. PortalStore now supplies bounded higher limits only for `environment-*` kinds. Generic AtomicFileStore and unrelated record kinds are unchanged.

## Capacity and actual protection limits

The retained-attempt index admits at most 128 attempts. It never drops old or unknown attempts. Admission bounds retained-tree observation to 200,000 entries and 8 GiB; exhaustion requires operator attention. These checks are admission/retention checks, not an OS disk quota during running project code.

An attempt normally needs at most 121 CAS replacements: 16 claims, 3 directory transitions, 4 work/HOME transitions, 96 command intent/permit/stop transitions, and 2 terminal transitions. Existing grant/path/command/count bounds keep normal generated record history below the 64 MiB byte limit. Environment records permit 512 retained generations and 100,000 directory scan entries, leaving finite capacity for interrupted cleanup/reconciliation. The index needs at most 127 replacements for its 128 admitted attempts. A shared resource ordinarily needs at most three state replacements per admitted attempt including quarantine/release. A real signed-store test exercises all 32 command receipt sequences beyond the old 64-generation limit. Capacity failures propagate; they never synthesize stopped/released evidence or delete history.

Current automatic process-proof support is Windows. Other native hosts return `PORTAL_ENVIRONMENT_PROCESS_PROOF_HOST_REQUIRED`; they are not claimed verified by this work. SQLite is the supported declared provider. Remote databases/services, arbitrary network calls, undeclared source-side resource access, and protection against arbitrary code running under the same Windows account are outside this protocol. Declared actions/configuration are review and admission authority, not an OS sandbox or interception of every SQL/filesystem/network operation. Retained evidence has no automatic collector in this initial disposition; old/unknown artifacts remain until an independently authorized supported collection workflow exists. Restart reconciliation deliberately cannot clear a lost process proof just because the root PID disappeared.

## Verification

- Full eight-file native/queue/executor/IR/shared sweep before the final additional native cases: **97 passed**, exit 0, using one Vitest worker.
- Expanded real native environment suite: **16 passed**, exit 0, including parent EOF and lost real broker evidence.
- Final current protocol/source sweep: **99 passed across 8 files**, exit 0, one Vitest worker, 132.35 seconds. Command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-environment.test.ts packages/mcp/test/portal/native-work.test.ts packages/mcp/test/portal/native-runner.test.ts packages/mcp/test/portal/operational-native.test.ts packages/mcp/test/execution/operation-executor.test.ts packages/mcp/test/execution/file-queue.test.ts packages/ir/test/portal-completion.test.ts packages/shared/test/portal.test.ts --maxWorkers=1`.
- Final MCP, CLI, shared, and IR TypeScript checks each passed with exit 0. Formatter check and lint with `--deny-warnings` passed for all 20 owned files. A final comment wrap in `native-process-control.ts` was formatted; the report and manifest contain its refreshed exact hash.
- No primary distribution output was rebuilt. C# broker code was compiled and executed by the real Windows PowerShell process in temporary test fixtures.
- Security fixture permission injection follows the repository's existing test pattern; filesystem ACL behavior remains the dedicated permission suite's responsibility. The native broker/store/SQLite tests use real processes, filesystem I/O, HMAC records, and CAS. The 32-command capacity test deliberately uses synthetic process receipts only to isolate store capacity; real process proofs are covered separately.

## Review focus

Review the acyclic preparation/expansion hash chain, preservation of repository authority, public pending-cancellation bridge, persist-before-permit ordering, stop-proof authentication and Job drain, mixed claim/persistence interruptions, identity checks before release, finite history limits, and acceptance/apply consumption. Final broad service reviews, release contracts/provenance, live C4, other portal fixture matrices, and Git publication remain main-session gates.

`service/.task-3.4b-owned.json` is a local diagnostic path list and is not an integration artifact. No unrelated capture/normalization/source-analysis files are owned by this task.

## Exact owned source bytes

| Path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/native-resources.ts` | `addcbe9eda0a17e4d935d6caeaf09f4e94253cfc379777af3b91cba7a9f6ac1a` |
| `packages/mcp/src/portal/native-lifecycle.ts` | `d8df006564d9d5abe77b10b6cf20906e1978455c047656c5a588e853de3cd269` |
| `packages/mcp/src/portal/native-process-control.ts` | `1ca2dbc1bc6d4e15232bce66cf947820f9f017d97454046fb747a8b22fe9e62b` |
| `packages/mcp/src/portal/windows-job.ts` | `28ea5569387faa5a6babc9923bdad842d3c74aeeb6444b04dfbe38a0c5e68415` |
| `packages/mcp/src/portal/native-runner.ts` | `5757fe36a87cff31804c03e93d2237b292021e178556cee6c6fd8a1596d940a4` |
| `packages/mcp/src/portal/native-work.ts` | `46a2868134fd1f83b012aba6d3f52ba12a6e906ac9260b60e2c477dd21e9e852` |
| `packages/mcp/src/portal/coordinator.ts` | `2cb14fd3a1c439d44ef9fc12fcad5ad1956a89da3dac9e378c08002cc45d3bcc` |
| `packages/mcp/src/portal/control.ts` | `da09cd3d7d949531648525e472693bb6356fdf5499a55b0b565de41ea055506d` |
| `packages/mcp/src/execution/operation-executor.ts` | `3930c8fab85cf252961e77e105ecd0d1fb12aecaf7a75e577c424328e2683f91` |
| `packages/mcp/src/index.ts` | `3ea059558996b38d8944449feaaa7b10863826d39c66739cfab87489fdafbb78` |
| `packages/shared/src/portal.ts` | `c10c882181bc7e75fb2552a224c38ee62ac560996f8c5625df6f89b733eeeb87` |
| `packages/shared/src/action-nonce.ts` | `638b2b69bb97dee3316fc5869140057b73fd7e9ff93d11f0822c8101b43f4561` |
| `packages/ir/src/portal-run.ts` | `e77007720f5b0739f59542182e27238a9075455b68eafa9b48da4359ceac5dc2` |
| `packages/cli/src/admin-commands.ts` | `67eef61ab3d5082ead07f4047c1ee79527839437dc565cd2e860f71b52824ac9` |
| `packages/mcp/test/portal/native-environment.test.ts` | `3933292985b54301e3b642fcbd059c01fd3eff6d4e205b8be9d1b4e8c746c949` |
| `packages/mcp/test/portal/native-work.test.ts` | `1018124f57193a88f5fc390874e20c1a48972b8dd887b197b4a737593bb827d1` |
| `packages/mcp/test/execution/operation-executor.test.ts` | `23a32c67a14a4655eaea792a241eff3d4d1fa4cfd61b6de4143e7b56e5417911` |
| `packages/ir/test/portal-completion.test.ts` | `7516e604afdc8ffde121e47223933d2147b783ff8f0b6098ca4b9739852922fb` |
| `packages/shared/test/portal.test.ts` | `efe06d7db6c7425732a97bcad5e663d09fe5345531806927907d4a957f41b3b9` |
| `packages/mcp/src/portal/store.ts` | `d983e32c4f43692f272f2433d1863feb985f3649387dd6173f25a121b5ffc86f` |
