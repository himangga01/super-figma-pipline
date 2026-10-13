# Preview navigation budget: independent review

Date: October 13, 2026, Asia/Seoul. **Approved exact two-file candidate**, manifest SHA-256 `e94fa3061b64656a6572ba8bdb1ae10abda8753a5282e619a2ffd09846890c6b`, with no blocking findings. Integration, deployment and current CDD acceptance remain unverified.

Read-before: [AGENTS.md](../../../AGENTS.md), the shared analysis policy, [service analysis](../../service-analysis.md), and [the author repair record](preview-navigation-budget-repair-20261013.md). Root owns canonical documentation and actual integration at the verified live-phase boundary. [The closed receipt](preview-navigation-budget-independent-20261013.json) binds this review's source and execution.

## Baseline, purpose and exact change

Main/native baseline is `303de5d1904d11c1fb89bdf80951900e375ac4325ea6cfc932f39ebee2785732`, on HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted work. The owner index remains `ecc1808ab3e14fa2e8c233ae1fc1c91e0a33b5b2e383a7270f1bc3068997e675`.

The service's owned Chrome preview resets a page before exercising a source-bound workflow. Its initial screen navigation already permits 30,000 ms, while this workflow reset inherited the context's 5,000 ms ordinary action timeout. The complete source diff adds only `timeout: 30_000` to that reset `page.goto`, retaining `networkidle`. Source hash changes from `55f5d5be1af3fd79ba47ce452044b4542a6b0d958bf965c5d0072ea07e371718` to `58eac8fb765ed34799d86a431fb7cef39131bcbd5870b97d076b81d76f158f37`. The corresponding test hash changes from `bbe858504b334bb8ebcd88d1c866d9e6d0c3e08aad6f8f77e7e8ae16d9f60125` to `da7dbb42c129bf1408331e71cdf8e13a2a971bea0abe5530fc50e7a1ab68ef0d`.

Full diff and surrounding source inspection confirm unchanged context action timeout, source/workflow binding, visual/interaction criteria, browser ownership and abort cleanup. The function still combines the caller signal with its local 300,000 ms ceiling and closes the owned browser on abort. No original run/native-command deadline changes. The author-recorded original 5,000 ms failure remains historical evidence; this reviewer did not repeat that failing baseline or whole UI suite.

## Independent real-Chrome execution

A new regular copy at `.worktrees/_cache/preview-navigation-budget-independent-20261013/service` was created from 1,357 verified baseline entries, overlaid with only the two frozen files, and used existing native dependencies through a read-only resolver. Only the two changed cases ran under the service's installed Chrome executable and `chrome` channel. The service report observed Chrome **155.0.8059.39**.

- The local server delays the second workflow navigation by 6,200 ms. The real source-bound form reload and two executed workflow actions passed; the case took approximately 8,368 ms.
- A separate 20,000 ms stalled response meets a 3,500 ms caller abort. The service rejects, the signal is aborted, and the second request is observed; the case settled in approximately 3,567 ms.

Vitest 4.1.11 exited zero: **two passed, zero failed, four filtered**, one file, reported duration 13.22 seconds. The receipt records the exact filtered command, case names/durations and raw JSON hash. Type/lint/format were author evidence and were not repeated.

Closing readbacks matched all 1,357 Main/native baseline entries and the review copy's expected two-file delta; the index remained unchanged. The sessions were isolated owned headless fixture sessions. They did not attach to the owner's source Chrome/Figma, retained portal tab, current QA or live APIs.

## Risks, limits and continuation

This pass verifies the navigation allowance and caller cancellation with genuine service-owned Chrome execution. It does not establish current source-to-frontend acceptance, applied freshness or full CDD completion. Same-owner Windows copies, cleanup and hashes provide no OS filesystem, process or network sandbox. No dependency install, build, full suite, source integration, runtime authority change or deployment was performed.

Root may integrate these exact bytes at its verified boundary, bind subsequent release evidence and perform a normal selected-source QA replacement. A bare compiled swap would not establish deployed-source authority. Execute the normal service validation under the original run deadline; do not renew it if the batch finishes late. No product question is required for matching the existing navigation budget. Official-MCP live remains owner-deferred and final eCommerce remains owner-skipped, not passed.
