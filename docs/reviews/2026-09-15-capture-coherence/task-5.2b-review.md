# Task 5.2b independent review

Date: 2026-09-15. Reviewer: /root/review_capture_coherence.

## Verdict

- Specification: PASS for the assigned capture-port, referenced dependency, coherence and asset boundary.
- Code quality: PASS.
- Actionable findings: none. No P0, P1 or P2 defect was reproduced in the nine frozen files.
- Integration recommendation: accept the frozen bytes after the controller's normal preimage checks. This is not final capture admission, live Figma acceptance, native execution acceptance or release verification.

The review read the implementation report, nine-file manifest and review diff, inspected all five changed production files and the related normalization/evidence contracts, and reran the stated ten-file suite. All nine isolated candidate hashes and all nine main preimages matched at review start. Candidate hashes matched again before this report.

## Evidence and boundaries reviewed

| Area | Source location | Result |
| --- | --- | --- |
| Whole-attempt observation | service/packages/mcp/src/portal/design-capture.ts:299 | Before read, fresh exports and after read share the bounded attempt. Both semantic and supported-reader content are compared; mismatch starts a fresh folder and does not reuse old PNG evidence. A reader content mismatch also uses the bounded retry. |
| Honest provenance | service/packages/mcp/src/portal/design-capture.ts:38 | File identity derives from the validated target; service page object and collector attempt identity are explicitly labeled. The record states no document epoch and no atomic snapshot. |
| Current and historical records | service/packages/mcp/src/portal/design-capture.ts:56 | Version/evidence combinations are strict. The current helper checks raw checksum, normalized capabilities/coherence/source binding and deterministic fingerprints; historical records remain readable and fail current admission helper checks. |
| Referenced dependency closure | service/packages/cli/src/snapshot-reader.ts:288 | Remote aliases, their collections and referenced node/mixed-text styles are traversed under round/ID/query/byte bounds. Missing APIs/lookups or unresolved mixed-style observations stay incomplete. Reference queries participate in ordered reobservation. |
| Node capability evidence | service/packages/cli/src/read-program.ts:64 | The closed program distinguishes observed binding/reaction surfaces and component applicability. Instances use actual main-component or component-set definitions rather than interpreting missing APIs as an empty successful contract. |
| Asset reuse and budgets | service/packages/cli/src/capture-assets.ts:88 | Every reused in-attempt file is size/hash verified before new allocation. Retained bytes reserve budget before earlier pending queries allocate. Capture-port retained bytes carry across invalidated attempts. New attempts reuse no prior checkpoint assets. |
| Distinct visual identities | service/packages/cli/src/capture-assets.ts:45 | Root PNGs remain separate ordered queries and separate output paths even when their bytes match. Original image usages may share an immutable image query without erasing usage evidence. |
| Failure and inspection evidence | service/packages/mcp/src/portal/design-capture.ts:314 | Attempt records preserve completed boundaries and known manifests. Earlier coherent progress is not overwritten by a failed retry. Primary errors and cancellation retain precedence; cleanup elapsed time begins before cleanup. |

Content reobservation cannot prove atomicity, cannot detect ABA changes or unsupported properties, and cannot exclude changes after an earlier query's final reread. These limits are expressly represented rather than hidden. The 512 MiB budget applies to logical assets in one capture call, not all historical owner-state storage. Native filesystem tests run with the same Windows account, filesystem permissions, network access and process namespace; the separate working copy is not an OS sandbox.

## Verification performed by reviewer

1. The reported ten-file suite passed again: 125 tests, exit 0. It includes controlled actual capture-port/generated-reader execution, fresh retry/checkpoint behavior, same-ID content changes, referenced catalogs, cancellation and native asset-file verification. No browser connection was made.
2. A unique ignored diagnostic suite at artifacts/review-capture-coherence-20260915/review.test.ts passed: 14 tests, exit 0. Ten are the original controlled capture-port cases. Four additional probes verify raw/fingerprint tampering and future-version rejection, equal-byte distinct roots, missing instance component API incompleteness, and a whole-attempt retry after a change detected inside the first reader. The first run of the fourth probe failed because the reviewer accessed an uncalled mock result; correcting only the diagnostic fixture produced the passing run. No production defect was inferred from that fixture error.
3. CLI TypeScript no-emit check passed, exit 0.
4. Frozen source/test hashes were verified before and after review. No owned source/test file, index, dependency, primary dist, daemon or browser state was modified. No Superpowers skill, subagent, Docker, commit or push was used.

The controller already disabled the unrelated MCP admission diagnostic described by the implementer. This review does not claim a fresh MCP-wide typecheck or full-source verification.

## Explicit handoffs, not findings against this bounded change

The report accurately leaves current plan/IR/native/coordinator descriptor fencing, explicit source admission, catalog/style consumer paging, Desktop capture, selected required interactions, distinct executable visual receipts and final live recipe/C4 acceptance for their assigned follow-ups. The current helper checks recorded manifest metadata and does not independently reopen every asset; actual file-byte verification remains a separate required boundary. The helper is typed collector evidence validation, not an authorization grant. Existing generic reader change errors can safely terminate incomplete capture; only the dedicated content-mismatch retry is asserted by the reproduced case.

## Frozen candidates

| Path | SHA-256 | Review check |
| --- | --- | --- |
| `service/packages/cli/src/read-program.ts` | `6577dc65ff6c42cc4474c1ee3f008eeca6b3b7a713e62cb242c9ffe44a170c56` | Matched |
| `service/packages/cli/src/scripter-bridge.ts` | `30b3107d011f86c751ff64e772f057227b5488b31e2007926b9b374c60b75603` | Matched |
| `service/packages/cli/src/snapshot-reader.ts` | `980572926a4dee5656cfc11730cb426ecc25bb61e3de11483f59c89d02c37863` | Matched |
| `service/packages/cli/src/capture-assets.ts` | `bf119fa10b63f0529022b62552d92be9c1b689f765abd6128366df702e2e0fd6` | Matched |
| `service/packages/mcp/src/portal/design-capture.ts` | `b543a8d2d051ef281413d4d28af2db08f47d2ca17b39f8d52e80e3bb305bbadf` | Matched |
| `service/packages/cli/test/scripter-catalogs.test.ts` | `c753185535ee7794628ffca5cf035759110c9b6962da87bc8c2211368c5fe2e2` | Matched |
| `service/packages/cli/test/capture-assets.test.ts` | `d4af6a3f22165d45b2145307cd5b8943f98d77f1a8b0a4617e09ce770110048d` | Matched |
| `service/packages/mcp/test/portal/capture-session.test.ts` | `3bc8c791787125a50ba561eea40f3b0f60b14df5e3d8edfba159aad553d77a25` | Matched |
| `service/packages/mcp/test/portal/capture-coherence.test.ts` | `e602ea2902939ca1b628eaa4872cfdac3d1c68d1509289b9c69139893224436e` | Matched |
