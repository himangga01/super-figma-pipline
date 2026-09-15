# Task 6C2 independent storage review

Date: September 15, 2026.
Verdict: Scoped PASS. No actionable defect found in the implemented persistence foundation.

## Scope and reviewed bytes

Independently reviewed both frozen paths in task-6c2-owned-files.json and their actual calls into PortalStore, canonical retained-directory mutexes, core derivation/page verification and recipe identity helpers. The reviewer did not author these two files. Both isolated hashes match the manifest, and both paths are still absent from main as their recorded preimages require:

| Service-relative file | SHA-256 |
| --- | --- |
| packages/mcp/src/portal/recipes/core-preparation.ts | dcb3bb7ee1887175ae4d2d14d37ab4dcd0f91714986d0e0628d4e0bad1cb499f |
| packages/mcp/test/portal/core-preparation.test.ts | 70ab59160db2c2510eea0126b0478b2e50e08463dd45a6d97cfc8eddfea6d0f8 |

No frozen source or test file was edited. This is not certification of public coordinator integration, authenticated capture/source admission, current effective recipe-definition selection, blueprint/lease adoption, candidate consumption, live Figma validation or either final whole-code review round. Those remain explicit Task 6D and later responsibilities.

## Reviewed behavior

The preparation path calls the actual fixed core derivation and verifies its actual pages before persistence. Caller-provided completion flags/results cannot replace that path. Owner/workspace, strategy, required selections, core contract and qualified source descriptor correspondence are checked. The signed input record binds one context hash to one derived input hash; another input cannot silently replace it. The supplied context's authority/capture/scope/definition metadata still requires real admission by its caller; hashing it does not grant permission.

A single filesystem mutex spans capacity admission, immutable input/context, preparation and ordered page/result publication. Logical capacity reserves the supported bundle maximum before publication, including context and metadata allowance. Existing failed/cancelled histories remain charged. Finite CAS history is explicit. This is not disk preallocation, unlimited retained history, transient-memory protection or an OS sandbox.

Pages publish before their result, and every result before the terminal checkpoint. Matching immutable orphans are reusable; mismatched bytes are refused. Retry reloads the current checkpoint after publication failures. Cancelled preparations remain cancelled. Blocked results preserve detailed manifests/pages without becoming succeeded. Restart reads verify signatures and context/input/definition/result/page relationships, counts, hashes, canonical material and bundle limits.

Dependency attachment reads and verifies results while holding the same mutex and requires ready status. Dependencies block cancellation. Removing a dependency is an internal lifecycle operation. readResults is also an inspection API and may return historical succeeded rows with a cancelled preparation; future Task 6D must use the ready/dependency lifecycle gate for adoption. No assumption that a prior unlocked read guarantees ongoing readiness was made in this review.

## Independent validation

Original focused suite:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/core-preparation.test.ts --maxWorkers=1

Result: 11 tests passed, 3.87 seconds. It covers seven-result preparation/read after restart, scope/required-selection/contract/source rejection, capacity, interrupted publication prefixes, cancellation, page MAC changes, blocked outputs and dependency rules.

Three additional independent probes used real filesystem/CAS/signing with distinct PortalStore instances where relevant:

1. Two manager/store instances race different intents for a single owner capacity slot. Exactly one succeeds, the other receives CORE_PREPARATION_CAPACITY_EXCEEDED and the signed ledger contains one reservation.
2. A preparation pauses during input publication while a second manager waits on the canonical mutex. Cancelling the second request before releasing the first rejects the waiter with AbortError and leaves exactly the first reservation. No late capacity publication occurs.
3. A simulated crash occurs after the first result is durably written. The retained signed orphan is then deliberately changed through the trusted test store API. A fresh manager refuses it with CORE_ORPHAN_BINDING_MISMATCH and leaves the preparation failed, rather than upgrading the altered prefix to ready. This tests internal mismatch handling, not a claim that an external attacker can sign owner records.

Command:

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/review-6c2-storage.diagnostic.test.ts -t 'independent review:' --maxWorkers=1

Result: 3 diagnostics passed, 11 inherited cases filtered by name; 2.08 seconds.

The diagnostic was retained by an in-place rename after execution and is excluded from ordinary suites:

    C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service/packages/mcp/test/portal/review-6c2-storage.diagnostic.test.ts.disabled

SHA-256: 14951a4b54202427ee4017b5c651faa7c73645489db0b426b09c4dbbaf1c656a.

The standard fixture substitutes permission inspection but retains actual I/O, signatures, CAS and mutex operations. Permission enforcement is not independently tested here. Native tools ran in the separate working copy under the same Windows account with shared filesystem/process/network privileges. No Superpowers, Docker, browser/Figma, live daemon, build, dependency installation, Git mutation, commit, push or main integration occurred.

## Integration condition

Main should recheck both exact hashes and original absent preimages before integration. Public Task 6D must supply genuinely admitted source/capture/scope and effective definition context, attach dependencies before publishing dependent plans/leases, and expose bounded reads without treating metadata or historical inspection as new authority. This review approves only the implemented storage foundation.
