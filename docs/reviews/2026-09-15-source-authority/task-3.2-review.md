# Task 3.2 Independent Review

## Verdicts

- **Specification: PASS for the bounded Task 3.2 contract.** Current source authority, legacy fencing, material closure, applied target checks, qualified recovery, and source evidence are implemented. Tasks 3.3, 3.4, and the later recipe/capture contracts remain separate gates.
- **Code quality: PASS.** No actionable task-scoped defect was validated. This is not approval of final product completion or publication.

## Review basis

Read the task brief, implementation report, thirteen-file owned manifest, and controller-generated diff against the prior reviewed main baseline. Independently inspected the changed implementation and tests in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`, including surrounding authority resolution, retained filesystem operations, inventory policy/collection, signed record storage, and coordinator consumers.

Independently computed all thirteen SHA-256 values after testing. Every value matched `task-3.2-owned-files.json`. No source, index, dependencies, primary build output, browser, or daemon was changed. Only this review report was written. No Superpowers skills or subagents were used for this review.

## Assessment

| Contract | Evidence and conclusion |
| --- | --- |
| Current and historical authority | `packages/shared/src/portal.ts` retains absent markers without defaults, explicitly rejects future versions, and provides the version-2 guard. New plan context, plans, runs, registered profiles, native profiles, application records, and native acceptance carry the marker. Coordinator execution gates generation, submission, validation, application, and continuation; registration and standalone native execution independently enforce it. Completion checks require current plan and acceptance markers. Historical status/cancellation remain available, while legacy inspection does not promote or rewrite old authority. |
| Complete project closure | `packages/mcp/src/portal/profile-closure.ts` requires a complete supported inventory and rejects inventory aliases. Legacy material membership is the entire target inventory plus candidate files; new/reference material membership is exactly the submitted candidate. Exact membership and hashes are required in the native profile, without semantic-file fallback. The native runner checks initial included membership before launch and checks closure bytes before each command and afterward. |
| Original source and staging | `native-work.ts` re-observes original inventory using the saved policy limits and discovery hash. Staged membership uses included path/hash equality instead of comparing full discovery hashes across different roots. Every copied baseline byte is verified; replacement preimages are checked and final staged bytes are published directly. Excluded credentials/metadata do not have to appear in scratch. The real fixture confirms ignored GraphQL and opaque binary inclusion alongside excluded metadata omission. |
| Whole actual target | Applied validation checks material membership before staging and again after native commands. Application and continuation check the complete mixed target, including untouched baseline bytes, journal membership, and each permitted pending/intent/written state. Final application checks actual target material. Real paused native fixtures reject actual-target change, addition, and removal; the partial-publication fixture rejects a later untouched baseline edit and retains the journal. |
| Created target identity | New targets receive a durable directory identity before file publication. Mixed/applied checks and publication hooks compare that identity while preserving the original parent authority. The real same-byte directory replacement fixture is rejected. A created but not durably bound target is blocked with an explicit recovery requirement rather than silently adopted. |
| Retained CAS recovery | Recovery inspection is limited to exact journal-derived generation paths and verified preimage/postimage bytes. Linked postimages require the exact target/prepared inode pair and two-link count; arbitrary hardlinks are not accepted by the generic reader. Recovery artifacts are projected before material byte accounting with their own bounded budget. Ordinary quarantine and published-linked interruptions re-enter the existing retained AtomicFileStore replacement protocol. The uncommon unproven hardlink fallback remains explicitly blocked, as documented. |
| Qualified evidence | Inventory/evidence responses carry a grant-derived stable source ID, plan-local index, workspace, role, root path, and relative path. Requested evidence is checked against byte inventory, with explicit errors for excluded/unlisted paths and binary text requests. Verified raw hashes precede text decoding/redaction. Duplicate same-workspace relative filenames remain distinguishable in the real coordinator fixture. |

## Independent verification

Native validation ran in the separate implementation copy. The following nine test files passed together: **66 tests, 0 failures, exit 0**, duration 40.08 seconds.

```text
packages/mcp/test/portal/source-authority.test.ts
packages/mcp/test/portal/native-work.test.ts
packages/mcp/test/portal/native-runner.test.ts
packages/mcp/test/portal/operational-native.test.ts
packages/mcp/test/portal/coordinator.test.ts
packages/mcp/test/portal/store.test.ts
packages/ir/test/portal-completion.test.ts
packages/shared/test/portal.test.ts
packages/cli/test/admin-commands.test.ts
```

The first command also contained an incorrect CLI test selector (`packages/cli/test/portal/portal-commands.test.ts`). Vitest matched the nine valid files; that selector was corrected with a separate explicit run of `packages/cli/test/portal-commands.test.ts`: **5 tests, 0 failures, exit 0**, duration 0.935 seconds. Thus all ten intended files were independently exercised, totaling **71 passing tests**, with no duplicate count.

The suite exercises real filesystem/CAS/native command paths for the important invariants, including retained backup budget projection near the 128 MiB material cap. Tests that synthesize acceptance to isolate publication are explicitly labeled and are not treated as real end-to-end acceptance. Type/lint/format checks in the implementation report were not independently repeated because no source changes or additional static concern arose during this review.

## Boundaries retained for subsequent work

- Exact project closure is not external script, interpreter, validator, browser, dependency-provisioning, or output-manifest authority. Task 3.3 must qualify those separately. The absence of indiscriminate post-build membership equality is intentional here and must not be presented as proof of generated output authority.
- Resource admission, canonical aliases, durable locks, and cleanup quarantine belong to Task 3.4. This review does not establish process confinement.
- A complete byte inventory does not establish complete semantic/service dependency analysis. Qualified source IDs are the interface for Task 4, which still must resolve that broader coverage.
- Filesystem checks are successive retained operations, not an atomic whole-tree snapshot. Separate logical source/recovery budgets are not a global physical I/O or memory quota.
- This native copy runs under the current Windows user's filesystem, network, and process permissions. The retained live daemon's older build and Chrome connection were untouched and do not run these reviewed source bytes merely because this review passed.
- The two user-required final whole-code review rounds and fresh final verification remain mandatory before main-branch publication.
