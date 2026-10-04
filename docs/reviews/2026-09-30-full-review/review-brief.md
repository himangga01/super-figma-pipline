# Full code and service review brief

Date: September 30, 2026. Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`, branch `remediation/2026-09-27`.

The owner requested two rounds of parallel critical code and service review, main-session revalidation of valid criticisms, and a completed English Markdown remediation plan. This review changes documentation only. Six reviewer perspectives run in each round, in batches of three because the root shares a four-agent concurrency limit. Five subagent identities contributed in round one. Further thread creation was rejected by the tool limit, so completed threads are reused with rotated assignments for the sixth perspective and round two. Distinct perspectives and counterchecks are recorded; fresh reviewer identities or different models are not claimed.

## Authority and boundaries

- Follow root `AGENTS.md`. Do not use Superpowers or Docker.
- Only C4 is frontend-only. C2 and C3 require all relevant service layers; C1 inherits C3 or C4.
- Read the current source rather than treating September 27 findings as current facts. T01, T02, T03, T04, T08, T09 and T26 have integrated changes; their reports describe scoped evidence, not full acceptance.
- Do not execute tests, builds, package installation, native helpers, browsers or daemons during this static review. Do not touch user state, source, Git index, original `code-kb` references, commits or remote branches.
- Read-only filesystem and Git inspection are allowed. Each reviewer may write only its assigned English review report and machine-readable coverage file in this directory.
- Separate statically proved behavior, test evidence inspected but not run, and runtime-dependent hypotheses. Do not convert an expected-error characterization test into a passing product claim.

## Coverage

`source-manifest.json` binds every tracked file under `service/` and `.github/` to the baseline bytes and assigns one primary review lane. Review every assigned first-party code, test and configuration file; inspect generated metadata and retained third-party evidence for consistency. List precise limitations for files only sampled or not inspected. Cross-lane reads are encouraged and must be recorded.

Each reviewer writes `round-<n>-<lane>.md` and `round-<n>-<lane>-coverage.json`. The coverage JSON is an array of objects with `path`, `depth` (`full`, `targeted`, `metadata`, or `unreviewed`) and `notes`. Only mark `full` after actually reading the complete file; a grep alone is `targeted`. Large fixture or generated files may use `metadata` with a concrete integrity or contract inspection. Do not claim full line-by-line coverage where it did not occur.

Round one uses primary manifest lanes. Round two uses the explicit remaining-body assignments in `round-2-closure-assignments.json`, rotated production counterchecks and metadata rechecks. Overall coverage is the union of actual read records. A round-two targeted countercheck does not claim a second complete read of that production file.

## Required findings format

Every actionable finding includes a stable reviewer-local ID, severity, current file and line evidence, trigger, observable consequence, root cause, counterevidence checked, relation to an older finding, proposed fix boundary and meaningful acceptance tests. Distinguish current defects, regressions introduced by the recent changes, design decisions, and unresolved hypotheses. No minimum finding count. Reject stale or unproved accusations.

Each report also records its service assessment, sound invariants worth preserving, inspected tests, coverage limitations, and recommended order. Send the root concise high-priority findings early. Round two must challenge round one, check proposed fixes for regressions, and search for omissions rather than simply repeat it.

## Main-session disposition

The root independently follows code paths for each proposed finding and records accepted, accepted with narrower scope or lower severity, merged, rejected, already fixed, or runtime verification required. Reports remain historical review evidence. The final plan uses only the main-session dispositions and carries explicit validation limits and dependencies.
