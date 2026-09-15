# Task 3.2 Report: Versioned Source and Applied-Tree Authority

## Scope and review status

Implemented in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`. Ready for independent controller review. The thirteen owned source/test paths are listed with exact hashes at the end. All earlier Task 1/2/3.1 working-copy changes and the existing index were preserved. The controller SDD report is the only explicitly authorized write outside this validation copy.

No primary checkout source or index edit, dependency change, emitted build, staging, commit, push, subagent, Docker, VM, WSL, browser operation, or daemon operation was performed. The retained actual service PID 23776/session 64596, its state, ports, Chrome session, and primary `packages/mcp/dist` were not touched. Existing task-owned outputs from earlier work were not rebuilt or removed.

This is the source-authority component of Task 3. It does not complete external artifact/provisioning/recipe authority (3.3), resource lifecycle/quarantine (3.4), broader service/dependency resolution (Task 4), or the later complete current-authority contract (Task 6).

## Durable version and compatibility behavior

- Added optional `sourceAuthorityVersion` with explicit current value `2` to plan/run, native profile/registration, native runner profile, application journal, and acceptance records. New plans/runs, accepted profiles, journals, and native acceptance carry version 2. Missing values remain missing; no complete inventory or later environment proof is synthesized.
- Unsupported future values fail with `PORTAL_SOURCE_AUTHORITY_VERSION_UNSUPPORTED`. Legacy authority fails current generation, submission, native execution, application, continuation, and completion with `PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED`.
- Signed legacy records still parse and remain available for status/cancellation. Public status identifies `legacy-replan-required` and distinguishes old completed runs as `historical-completed`. Current version is a component marker, not a blanket assertion that every workflow is verified.
- Legacy recovery inspection can report retained row outcomes without promoting the old run, changing its acceptance, or rewriting its application journal as current. Legacy continuation requires a fresh plan/current authority. There is no silent in-place migration of old partial effects.
- Completion requires a current acceptance marker as well as current plan authority and all pre-existing completion checks. Standalone native runner execution and owner profile registration each independently enforce current authority.

## Material source and staging

`requirePortalInventory` requires a complete, supported Task 3.1 byte inventory and rejects missing or case-aliased entries. For legacy portals, project closure is the complete target inventory plus submitted replacements/creates. For C3/C4, it is exactly the candidate file set. Missing, wrong-hash, case-aliased, and extra closure entries fail; semantic `graph.files` is no longer the closure fallback.

Original-source verification recollects inventory under its saved limits and compares the complete discovery identity. The already-bound semantic graph and owner source reviews remain subject to their existing completeness requirements. Copied/staged/applied membership is instead compared explicitly by included path and raw-byte hash; full discovery hashes are not equated across trees with different exclusions or directory observations.

Staging reads every baseline byte through retained readers, checks its planned hash, and writes exactly the final material source using retained `createNew` publications. Replacement preimages are verified without performing unnecessary scratch replacements. The scratch tree is checked before execution, and the native runner independently checks initial included membership before its first command. Excluded Git metadata, credentials, dependencies, and service runtime are not copied to force inventory-hash equality. Legitimate outputs of native commands remain distinct: the existing closure-byte checks continue after commands, but no indiscriminate post-build whole-directory equality check was added.

## Actual target and recovery

- Applied validation checks the complete expected target material set before staging and after native commands. Untouched configuration/backend inputs, new included files, removals, and content changes invalidate the actual-target claim even if staged commands pass.
- Every application/continuation checks untouched baseline files and each journal row's permitted pending/intent/written preimage or postimage, including between publications. Journal rows must match the submitted file set. Baseline checks are not skipped because a journal exists.
- New C3/C4 target directories acquire a durable `targetIdentity` in the application journal before source-file effects. Their original parent grant is preserved. Applied/resume checks and retained publication/recovery hooks verify the created directory identity; copying identical bytes into a replacement directory cannot reuse the journal. A crash between directory creation and durable identity binding requires `PORTAL_TARGET_IDENTITY_RECOVERY_REQUIRED` and preserves the directory/journal.
- Exact CAS recovery artifacts are recognized only from current signed non-pending replacement rows, by exact relative pathname and verified preimage/prepared hash. Known backups do not consume the material source budget. The material scan remains bounded to 5,000 included source files and 128 MiB, with scan/file allowance for the specifically qualified recovery paths; recovery artifacts have a separate bounded 128 MiB accounting. A recovery-looking file present in the original baseline remains ordinary bound source.
- Real AtomicFileStore interruptions after quarantine rename and after postimage publication are supported. The first has a missing target plus verified retained/prepared generations; the second has an exact two-link target/prepared postimage pair. Retained parent authority, exact bytes and link identity prove these states. Continuation re-enters the existing `AtomicFileStore.replace`; it does not weaken generic reader link checks, change generic AtomicFileStore, or delete recovery evidence. Inspection labels these rows `recoverable`, distinct from an actual preimage/postimage.
- Unproven hardlinks, including the uncommon old-target/retained two-link fallback that generic retained scanning cannot safely resume, return `PORTAL_RETAINED_CAS_RECOVERY_REQUIRED`. Missing or conflicting recovery proof remains blocked. User edits, exact journals, and committed/unknown evidence survive failures.

The source and recovery budgets are bounded logical accounting, not one global physical I/O or memory quota. Inventories, source reviews, target checks, and recovery proof may read the same bytes more than once. Retained reads and CAS protect checked operations; they do not freeze a whole filesystem into an atomic snapshot.

## Qualified source evidence interface for Task 4

`portal_next.sourceInventory[]` now returns the complete byte-inventory page with `sourceId`, `sourceIndex`, `workspaceId`, `role`, and `rootPath`. Each evidence row returns those same fields plus the file-relative `path`, `sourceHash`, and redacted `content`.

`sourceId` is `contentHash('sfp-portal-qualified-source-v1', { workspaceId, role, rootPath, canonicalPath, identity })` from the verified saved repository grant. It is stable independently of profile ordering; `sourceIndex` is the plan-local request selector. Same-workspace references with equal relative filenames therefore remain distinct. Requests are checked against byte inventory, not semantic file selection. Excluded or unlisted paths fail with `PORTAL_SOURCE_EVIDENCE_NOT_INCLUDED`; binary text requests fail with `PORTAL_SOURCE_TEXT_EVIDENCE_UNSUPPORTED`. Paging, aggregate response limits, and existing literal/URL redaction remain bounded. A content hash never grants source-read permission by itself.

## Verification and TDD evidence

Meaningful red/green cases:

1. The initial four closure tests failed because `.mts`, GraphQL, binary, and missing complete inventory were silently omitted by the old semantic closure. They pass with complete inventory consumption and exact closure enforcement.
2. A native runner test added an unexpected GraphQL input to its scratch directory. Before the initial membership guard, the command actually ran and the rejection assertion failed; afterward it is rejected before launch.
3. A replacement-row user-edit reconciliation test initially threw during recovery-artifact inspection instead of returning exact conflict evidence. The reconciliation fix preserves the edit and reports the affected row as conflict.
4. Integration testing exposed legitimate retained CAS backups making scratch whole-inventory comparisons fail. Staging now publishes final bytes directly, while actual-target recovery uses the explicit qualified projection described above.

The 10-file focused integration command passed **70 tests, 0 failures**, exit 0, in 38.86 seconds before the final replacement-row conflict regression/fix:

```powershell
pnpm exec vitest run packages/mcp/test/portal/source-authority.test.ts packages/mcp/test/portal/native-work.test.ts packages/mcp/test/portal/native-runner.test.ts packages/mcp/test/portal/operational-native.test.ts packages/mcp/test/portal/coordinator.test.ts packages/mcp/test/portal/store.test.ts packages/ir/test/portal-completion.test.ts packages/shared/test/portal.test.ts packages/cli/test/admin-commands.test.ts packages/cli/test/portal-commands.test.ts
```

Final focused follow-up after that fix:

```powershell
pnpm exec vitest run packages/mcp/test/portal/native-work.test.ts packages/mcp/test/portal/coordinator.test.ts
```

Result: **2 test files passed; 35 tests passed; 0 failures; exit 0**, in 39.91 seconds. The final test inventory across the integration command and this added regression is 71 distinct tests.

Successful no-emit type checks: `pnpm --filter @sfp/mcp typecheck`, `pnpm --filter @sfp/shared typecheck`, `pnpm --filter @sfp/ir typecheck`, and `pnpm --filter @sfp/cli typecheck`. MCP typecheck was repeated after the final reconciliation edit. `pnpm exec oxlint --deny-warnings` and `pnpm exec oxfmt --check` passed for all thirteen owned files after final edits.

Real fixtures cover source changes/additions/removals; omitted excluded metadata; opaque and ignored source copying; signed legacy waiting/candidate/partial/completed inspection and fencing; future version rejection; duplicate reference evidence; binary refusal; real native execution; paused validation with actual untouched target changes/additions/removals; interrupted journal continuation with baseline edits; preimage/postimage intent; two ordinary retained CAS interruption states; same-byte target-directory replacement; and a roughly 120 MiB material target with a separate 15 MiB retained backup. The latter succeeds while its physical tree exceeds 128 MiB, demonstrating budget projection before material accounting. Native HTTP/SQLite/authorization fixtures use generated temporary trees and a free loopback port. Publication-specific acceptance fixtures are explicitly synthetic and are not claimed as real end-to-end product acceptance.

Initial development runs also caught outdated test fixtures without explicit current markers and a cancellation ordering regression introduced by new authority awaits. Current fixtures now request version 2 intentionally, and cancellation is checked after those awaits. The final passing runs include the existing cancellation tests with no unhandled errors.

## Protection limits and remaining gates

This separate native working copy limits which repository bytes were edited. It is not an OS sandbox, account sandbox, network sandbox, or process-confinement boundary; tests run under the current user's permissions. No claim is made that the live daemon runs these source bytes. Independent Task 3.2 review and reviewed-byte integration remain required, followed by 3.3/3.4, later task reviews, and the final broad verification/merge gates.

## Exact owned hashes

Paths are relative to the validation `service` root above. Hashes are SHA-256 of final formatted bytes.

| File | SHA-256 |
| --- | --- |
| `packages/shared/src/portal.ts` | `3248f73943c9fc532860b2be526b65fa3061f997d081c0fd9bfb33117e9d3180` |
| `packages/ir/src/portal-run.ts` | `d3fc4a36aab3f0e476236361b5c3efa9ed82cbebec05e842992679cdf9a65dcc` |
| `packages/ir/test/portal-completion.test.ts` | `322d78e3ca91ac2b38f746ae30c1ec59aeff59d90a8b361d599883fed2a56caa` |
| `packages/mcp/src/portal/control.ts` | `ec946950ffeeb175b7856cddf3528595bfba39e5851d4b04521127a302870bce` |
| `packages/mcp/src/portal/coordinator.ts` | `3f833d67226ff0c58393e8a382db54766e86d623c44fe4eaf65e204847ccf632` |
| `packages/mcp/src/portal/native-runner.ts` | `07b74cba3a7598ad0d1aab5186c4b5d48773ac5327e7a4a024e080523358b5c3` |
| `packages/mcp/src/portal/native-work.ts` | `3dc71ac19d1651f9e57e9238615398f3ca728baa9bcd92da98e265e2c3f68ecd` |
| `packages/mcp/src/portal/profile-closure.ts` | `a0140e6b4681100d4c0b58e2156ddbf3f8e427b6a81b71f8acb11462936b6c09` |
| `packages/mcp/test/portal/coordinator.test.ts` | `c07778eee0431e45bda0301d4aed900b979b808f47f2b7002652b808dd1577bd` |
| `packages/mcp/test/portal/native-runner.test.ts` | `f499f7a299b276f4a2bfd3ae0f56183c42bf64752f9b71435ffea399cb72d041` |
| `packages/mcp/test/portal/native-work.test.ts` | `d6ddd74aa00ce9288cf86c0cbd653f87607f7c04a2e57fe91f8778aaed8157dc` |
| `packages/mcp/test/portal/operational-native.test.ts` | `7bfd8d5c3762db427ef1a66fa5311c979a2c3b436e30c54acf50d0861e3bd823` |
| `packages/mcp/test/portal/source-authority.test.ts` | `df8c8b39f44c950393d0550f55ab7ed32f3bd28a65e59697cfe16f3864c69e36` |
