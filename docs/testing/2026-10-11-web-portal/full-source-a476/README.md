# Integrated recovery source verification

Recorded: October 12, 2026, 14:00 KST (Asia/Seoul).

The exact integrated source **`sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`** passed the local whole check and separate artifact-content check. Main remains at `22517932dc9b2cb974c177ec4eacb84d4b16e254` with uncommitted work. Main and the separate native validation copy had equal source fingerprints before and after verification. The owner's index remained unstaged; alternate-index R15 reconciles provenance without replacing it.

## Executed evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Whole source/package/runtime check | All sixteen gates passed; 467 files, 5,415 cases, 5,395 passed, zero failed, twenty existing skips | [Checkpoint](full-source-checkpoint.json), [full report](full-source-report.json), [tests](full-source-tests.json), [declared scope](full-source-scope.json) |
| Required Chrome-suite registrations | 117/117 passed in fourteen files, no skips | Checkpoint, full tests and [skip census](full-source-skips.json) |
| Known-failure ledger | Empty; no failure waiver | Full report |
| Skip identities | Match the preserved earlier census; no blocked or unknown allowed suite | Skip census and checkpoint |
| Separate artifact-content check | 1/1 passed, zero failures/skips, same source and whole attempt | [Checkpoint](artifact-contents-checkpoint.json), [tests](artifact-contents-tests.json), [scope](artifact-contents-scope.json) |

Whole attempt: `f5647503-041f-4d6d-8659-913c4755c936`. Artifact attempt: `b33762c5-d369-473c-9fdb-9d03eb723c03`. The whole report's integrity hash is `16b7116fcc45106482524acfc805b75341fe99dff276bea002340720f18da09d`.

The native working directory was `.worktrees/baseline/service`. Execution used the existing native Node/pnpm toolchain and `node scripts/run-source-checks.mjs`, with `SOURCE_DATE_EPOCH=1791202532` and a separate owned verification state root. The artifact case was separately declared and adjudicated through `.cache/run-artifact-scope-20261010.mjs`. Private runner helpers are not portable product source; their actual scopes, toolchain bindings, report/log hashes and results are retained in the linked evidence. No Docker was used. The separate working copy and state roots do not provide an operating-system or process sandbox; the processes run under the same Windows user.

## Scope and limits

This checkpoint includes the reviewed native-export modal repair, typed incomplete-native-evidence rejection, strengthened logger fixture and 24-file local capture recovery/proof/progress integration. [Combined provenance](../combined-recovery-provenance-20261012.json), [recovery review](../local-capture-recovery-review.md) and [whole-failure repair](../31e4-whole-failure-repairs.md) preserve their exact boundaries. The earlier epoch-invariant and two-test 31e4 failures remain failed historical evidence.

Required Chrome-suite counts include all registrations in the required files. They are registry/scope counts, not a claim that every assertion launches a browser or is live Figma acceptance. The export-focused report separately identifies its retained controlled Page stub. Twenty existing platform/optional prerequisite cases remain explicitly skipped; none are silently promoted to success.

At publication, QA 3059/4315 still had compiled 31e4 and primary 3055/4310 had f0dc loaded. This pass does not establish new-source deployment, successful source capture, owner fence abandonment, model-data consent or authenticated official MCP. It also does not establish three complete Figma-to-frontend journeys, current CDD visual/application/freshness acceptance, final dual-path eCommerce acceptance or remote CI. The report retains `realFigmaValidated:false`, `targetServiceValidated:false` and `remoteCiValidated:false`.

Follow [the QA deployment readiness review](../qa-recovery-deployment-readiness.md) for controlled same-state replacement. Preserve the complete stopped state before startup recovery and retention, retain original unknown outcomes/deadlines/evidence, and use a read-only connection bootstrap before new capture writes. The same retained Chrome window/tab and separate source Figma session remain required. A legacy fence disposition requires specific owner acknowledgment and a fresh server-bound challenge; this whole pass does not supply that acknowledgment.

Canonical continuation authority: [service analysis](../../../service-analysis.md) and [repository instructions](../../../../AGENTS.md).
