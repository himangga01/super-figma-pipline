# Round 1 main-session dispositions

Date: September 30, 2026. Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`. Status: round-one main dispositions complete. Six perspectives produced 40 raw findings, merged into 39 canonical accepted/narrowed findings. Every first-party production/configuration body has been read; remaining test bodies are explicitly assigned for round-two closure.

The main session independently followed each path in the [verification notes](main-verification-notes.md). This is static source verification, not execution of a reproduction. Canonical F IDs below remain stable through round two. High means a core workflow, durable recovery, source authority or effect classification is materially wrong. Medium means a narrower fidelity, feedback, operational lifetime or product usability problem. Priorities are implementation order, not an exploit score. A latent defect is still actionable when another known blocker currently hides its trigger.

## Accepted findings and first fix directions

| ID | Reviewer evidence | Main disposition | Severity | Fix direction for round-two challenge |
| --- | --- | --- | --- | --- |
| F01 | R1-P01 / MV01 | Accepted | High | Version one canonical prepared-profile contract across prepare, registration and hashing; retain exact owner nonce binding. |
| F02 | R1-P02 / MV02 | Accepted | High | Produce authenticated consumption observations and verify them before report creation; retain mandatory receipt acceptance. |
| F03 | R1-P03, R1-PL01 / MV03 | Merged, accepted | High | Reclaim proved unneeded retained generations with crash-safe authority; increasing the cap alone is insufficient. |
| F04 | R1A-05 / MV04 | Narrowed | High | Distinguish known collections from HTTP receivers while preserving uncertainty for unknown clients. |
| F05 | R1A-02 / MV05 | Narrowed | High | Recognize qualified global fetch with lexical shadowing checks; do not infer endpoint existence beyond evidence. |
| F06 | R1A-04 / MV06 | Accepted | High | Carry original source bytes/hash through BOM-aware decoding and workflow hints. |
| F07 | R1-PL04 / MV07 | Accepted | Medium | Keep settlement linkage for evidence retention, and preserve held operations. |
| F08 | R1-PL02 / MV08 | Accepted | High | Preserve a concurrent in-place edit at its visible path, or provide explicit safe restoration without overwriting a newer file. |
| F09 | R1-P05 / MV09 | Narrowed | Medium | Reclaim closed native attempts only after detaching or retaining recovery receipt authority. |
| F10 | R1-P04 / MV10 | Accepted | High | Persist attempt creation intent and prove directory ownership during interrupted-create reconciliation. |
| F11 | R1-P06 / MV11 | Accepted | High | Serialize resume with active validation/cancellation and enforce state/fence checks. |
| F12 | R1-P07 / MV12 | Accepted | High | Make target-root ownership durable before publication; recover the interruption using durable proof. |
| F13 | R1A-03 / MV13 | Narrowed | High | Bind reuse obligations to stable mapping-row identity, not a display name. |
| F14 | R1A-01 / MV14 | Narrowed | High | Track required local stylesheet dependencies into excluded output, or block unsupported inputs explicitly. |
| F15 | R1A-06 / MV15 | Accepted | High | Resolve supported SVG loader queries with explicit loader semantics and raw asset identity. |
| F16 | R1-PL03 / MV16 | Accepted | High | Dispatched effectful timeouts remain outcome-unknown until authoritative reconciliation; do not replay blindly. |
| F17 | R1A-07 / MV17 | Narrowed | Medium | Unresolved component types and rest props remain incomplete, with field-level evidence. |
| F18 | R1-P08 / MV18 | Accepted | Medium | Distinguish proved pre-effect failure from unproved post-dispatch failure and provide recoverable transitions. |
| F19 | R1-P09 / MV19 | Accepted | Medium | Separate bounded generation, effect and recovery budgets without bypassing owner authority. |
| F20 | R1-P10 / MV20 | Accepted | Medium | Deliver authenticated failed preview evidence for repair; never use failed results as acceptance. |
| F21 | R1-PL06 / MV21 | Narrowed | Medium | Preserve edited service metadata during cleanup; exported assets are outside this deletion path. |
| F22 | R1-PL05 / MV22 | Narrowed | High | Evict failed single-flight initialization safely; distinguish control readiness from public liveness. |
| F23 | R1-C01 / MV23 | Narrowed | Medium | Add explicit same-owner authorized hold release after session rotation without making evidence reusable across sessions. |
| F24 | R1-C02 / MV24 | Narrowed | Medium | Preserve non-solid paint opacity separately from stop alpha and node opacity in simplified styles. |
| F25 | CAP-04 / MV25 | Narrowed | Medium | Settle cancelled/unknown UI activity without certifying no effects. |
| F26 | CAP-05 / MV26 | Narrowed | High | Add cooperative cancellation checks after awaited preflight and immediately before effects. |
| F27 | CAP-01 / MV27 | Narrowed | Medium | Dedicated Desktop portal CLI must accept an explicit target; generic administrative planning remains a workaround. |
| F28 | CAP-02 / MV28 | Narrowed | Medium | Expose bounded previews/artifact references for captures above the response reader cap; original copying already works. |
| F29 | CAP-03 / MV29 | Narrowed | High | Replace failed Chrome transports with fresh authenticated generations. |
| F30 | CAP-06 / MV30 | Narrowed | High | Preflight reject unsupported mixed typography inverses or preserve full ranges and verify restoration. |
| F31 | CAP-07 / MV31 | Narrowed product limitation | Medium | Implement missing required reaction semantics or permit explicit evidence-bound relevance decisions; never silently drop them. |
| F32 | CAP-08 / MV32 | Accepted | High | Preserve supported reaction fields in read/write round trips, reject unsupported shapes before effects. |
| F33 | CAP-09 / MV33 | Narrowed | Medium | Preserve generic sizing/absolute-child constraints; canonical portal capture already retains them. |
| F34 | CAP-10 / MV34 | Narrowed | Medium | Trigger generic text segments for mixed tracking/leading; canonical capture already retains them. |
| F35 | R1-V01 / MV35 | Narrowed | High | Bind required test presence to the intended collection manifest; retain strict ledger and skip rules. |
| F36 | R1-V02 / MV36 | Narrowed | Medium | Publish current-attempt status and isolate logs; an old success remains historical, never current. |
| F37 | R1-V03 / MV37 | Accepted existing open work | High | Complete legitimate T05 change slices and protected provenance hashes; no blanket hash refresh that obscures origin. |
| F38 | R1-V04 / MV38 | Accepted | Medium | Align the published lock schema with the canonical verifier's valid transition grammar. |
| F39 | R1-V05 / MV39 | Accepted | High | Bind authority transaction CAS to the bytes originally read for derivation, not a later staging snapshot. |

## Rejected, corrected or not promoted

- Old Korean-path corruption, unconditional whole-workspace availability failure, T09 initialization failure and the old T26 graph-hash/limit allegations are not carried forward as unchanged current defects. Their integrated repairs have specific scoped historical evidence.
- Mixed currentColor plus fixed SVG fills does not prove destructive flattening: the selected operation changes currentColor rather than fixed fills. Keep fidelity intent as a separate concern.
- The non-core recipe catalog accurately marks planned capabilities. Catalog presence alone does not claim runnable implementation.
- Native attempt admission is finite, but an approximate ten-run estimate is not used; the actual ID, entry and byte limits govern.
- Large image capture is not wholly unusable: verified original-copy submission has a larger supported budget.
- Native manifest cleanup concerns private metadata, not arbitrary source files or exported assets.
- Mixed text shortening and lost run boundaries need runtime reproduction beyond the statically proved mixed-property inverse defect.
- The plugin approval fallback wording is incomplete. Desktop native validation can reach the panel, but `index.ts:1052` supplies an explicit native-execution/same-owner/no-OS-sandbox label and the panel renders it. Chrome capture resolves a forbidden plugin target. The broader claim that these flows conceal native execution is rejected; consistent effect labels remain a usability improvement.

## Round-two requirements

Challenge these dispositions and proposed repairs independently. Trace production callers and counterexamples, not just helper tests. Close every remaining first-party source/test/config body listed in round-one coverage. Keep a concrete record for generated metadata and legal evidence. Report new omissions without a quota. Preserve byte identity, ownership, cancellation fences, mandatory consumption, full C2/C3 scope and bounded native execution. Do not run repository code during this review.
