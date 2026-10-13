# Independent URL-release QA replacement helper review

Date: October 13, 2026, Asia/Seoul. Root review. Source release: `sha256:f8d76e71e491a1df5f5a3b468c705dab8e6645a5e3476e93d07d2f90e8fccf4a`, whole `db9bbfee-f588-4252-9758-c2d659aa6fe4` still pending.

## R1 decision: reject before execution

The new helper is separately prepared under native `.cache/qa-url-replacement-20261013`. The earlier [R2 helper](qa-current-replacement-helper-review-20261013.md) was consumed and remains immutable. R1 review freeze is `cfd9b471997b59b81daa3075522790bda2e0675b1ec94a2eefcf02db698b6878`; runtime manifest is `f483b6b47d5cd7e4a94685395c52eb5d96f094ae7de0a726c3bcc3638bbab36d`.

Root verified the seven exact frozen files, copied them into a separate creator-owned protected review directory, then independently ran the frozen thirty-case suite: **30 passed, zero failed, zero skipped**, exit zero. Tests use only a frozen private fixture, not current QA state. They cover all four fresh needs-input attempts, unchanged deadlines/unknown rows, additions/removals/duplicates, process/listener identity, pending jobs/activities, path/hash substitutions, exact backup bytes, link refusal and creator-owned ACL behavior. Same-user Windows permissions do not provide OS/process isolation. Fixture verification is not runtime replacement acceptance.

Static cross-script inspection found a real defect missed by those thirty tests. `replacement.mjs` and the pinned baseline identify current QA daemon 35816/start 1791861107704 and portal 21836/start 1791861175246. `stop-owned.ps1` line 28 still pins the previous daemon 39796/start 1791785334585 and portal 35244/start 1791785340430. An actual execute would reject the intent's current parents after entering stop-dispatched. No execute or stop was attempted.

Root added an independent test that parses both executable scripts' fixed tuples and compares them with the approved baseline. Against unchanged R1, it **fails one of one**, zero skips; retained TAP SHA-256 is `d5399b2bdb9f3566e777effecf949608f02a40bab8cd6c9ca898c1353479eee6`. R1's thirty passing fixtures are preserved and do not override this failure. The author acknowledged the defect and is preparing a distinct R2 with only the PowerShell tuple repair and a meaningful cross-script test.

## Required continuation

Preserve R1 source/manifests/receipts and original consumed predecessor. Review the exact new R2 freeze, rerun the original independent tuple assertion unchanged, then its complete frozen suite and current-source archive gates. Actual source-bound whole/artifact checks, source-list publication, new gate configuration and read-only runtime preflight remain separate prerequisites. Only the sole controller may execute a newly approved one-use helper. Preserve the same QA namespace, primary servers, retained Chrome windows, complete stopped backup, existing runs/unknowns/grants/deadlines and explicit physical-cleanup limits. No deployment or frontend acceptance is claimed by this review.

## R2 independent review: 13:53 KST

**Approve the exact R2 helper conditionally on fresh chosen-source gates and runtime preflight.** R2 freeze is `2b859a61e69309e8f8bd8c8689609497fc26ca8cd87596ccd9309a68141fdc2f`; runtime manifest is `5a324ae08251eed528c85e95d287027c36cb464c88a94616f063bf6adead73c9`. The only executable delta is the four current PID/start-time values in `stop-owned.ps1`, now SHA-256 `69706703126c024e8780fd92eddf6c652338bbc3f4d45984ac4ec22a2d4923f7`. JavaScript, startup script, pinned baseline, schema, original thirty-case suite and frozen fixture are unchanged. R1 is retained separately, with no live execution.

Root mechanically verified this complete minimal delta against its preserved R1 copy. The original independent tuple assertion remains unchanged and now passes. Root also independently ran the thirty original cases and the new actual JavaScript/PowerShell AST tuple test: **32/32 passed, zero failures/skips**, exit zero, TAP SHA-256 `b200df0f51ac1de6551e681ff5f7685f0aa7cc387f0732c6f43686e71ac71c70`. The AST inspection parses literal tuples; it does not execute retirement or startup commands.

The first copied R2 cohort had 31 passes and one loader failure because the author's test used a relative dependency-resolution anchor that changed in Root's separate directory. Root retained that exact result, SHA-256 `63cf1c5b1caa0849c43e13f8a5bd3faaf2a97fe1264f85eae14ebd98f3e4c25e`, and the original test. Only the private copied test's `createRequire` anchor was changed to the installed native MCP package; no test predicate or frozen executable changed. The corrected full result above is distinct.

This approval covers exact helper logic and fixture protection. Whole/artifact/current archive gates, source-list publication, approved gate configuration, actual read-only process/state/producer checks, complete stopped backup and runtime postchecks remain required before any deployment claim. Root has not controlled live Chrome/QA state or invoked a helper mode. The sole controller may continue preparation but must await actual gates before preflight/execute.
