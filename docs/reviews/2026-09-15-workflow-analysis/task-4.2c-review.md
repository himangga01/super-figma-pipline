# Task 4.2c independent review

## Outcome

Specification: changes required. Quality: changes required. Three P2 helper findings reproduced. None asks this bounded task to implement the later detailed coverage gate or coordinator integration.

Reviewed only `service/packages/mcp/src/portal/workflow-requirements.ts` and its test, with read-only shared requirement-schema and previous-helper context. The source hash remains `9fec36ffcad8a64dfd5b3ac4a67a4a3bf193457198064c7aea1d74f1992be3ec`; test hash remains `8644d628e479b85147df9a6b282764a218be1f4939906fb8554b6daa60505a49`.

## Findings

### P2: Retain the child observation that supplies the candidate's action label

Location: `service/packages/mcp/src/portal/workflow-requirements.ts:397`, with label extraction at lines 431-436.

The interpreter reads immediate child labels, but `add` records only the control and its ancestor/sibling context. A root button named `Button` with a text child `Create document` produces a document-create candidate whose entire `evidenceIds` list points to the control record labeled only `Button`. The child evidence containing `Create document` exists in the analysis but is not linked to the candidate. The control's evidence hash also excludes child labels. Consequently, the candidate's evidence and per-layer decision references do not bind the observation used to derive the mutation, even though the overall analysis hash binds the complete evidence array.

Retain the exact child observations used for label interpretation in each candidate's supporting evidence. Keep interaction identity on the control if appropriate; the child need not become a separate required interaction. The independent diagnostic requiring the child's evidence ID in the candidate fails.

### P2: Make the control-label observation cap explicit instead of silently hiding conflicts

Location: `service/packages/mcp/src/portal/workflow-requirements.ts:433-436`.

`observation.children.slice(0, 32)` silently discards further immediate control labels during interpretation while all those nodes can still be traversed and retained. A button with `Create document` as its first text child and `Edit document` as child 33 returns only document-create, `analysisComplete: true`, `interactionCoverage: 'draft'`, and no issues. The same conflicting labels inside the slice would trigger `AMBIGUOUS_WORKFLOW`. This is a local interpretation limit losing an otherwise supported conflict, not a request to support arbitrary descendant prose.

When relevant control-label observations exceed the interpretation bound, record a stable limit/incomplete issue and retain the affected control as uncertain, or process all relevant labels within a bounded budget. Review the neighboring sibling-context cap consistently when it can hide required state observations. The independent child-33 assertion requiring incomplete analysis fails.

### P2: Resolve generic mutation context by locality or retain ambiguity

Location: `service/packages/mcp/src/portal/workflow-requirements.ts:465-477`.

The noun selection tests all ancestor labels for documents before testing any for tasks, ignoring their proximity. A `Documents` frame containing a `Task editor` frame with a `Save` button becomes document-edit, with complete analysis and no ambiguity. The immediate context supports a task edit; the distant document label should not win solely because its branch appears first in the code.

Use the nearest supported context when sufficiently specific, or retain conflicting contexts as ambiguous instead of asserting a document-only interpretation. Add the inverse nesting as a regression so the fix does not merely reverse the fixed noun priority. The independent diagnostic expecting the immediate task interpretation fails; an explicit ambiguity outcome would also address the review finding.

## Verified strengths and accepted scope

- All candidates and requirement workflows remain draft. No confirmed interaction coverage, implemented routes or successful runtime contracts are fabricated.
- Read-only dashboards and search remain frontend candidates without source hints; they do not automatically acquire authentication or database layers. Forms do not automatically acquire a database.
- Source hints rehash supplied text, retain qualified source identity and reject conflicting snapshots. This proves byte consistency only; hint semantics and admission must still be established by the future caller. The helper does not grant execution or review authority.
- Missing, empty, malformed, cyclic/shared and duplicate-ID observations have explicit diagnostics. Retained evidence and traversal budgets are finite, and the wide-array regression avoids argument spreading.
- C4 keeps local frontend behavior, and the existing commerce/account wrapper identifiers remain compatible. Exact short-label matching avoids the previous unrestricted prose-substring behavior.
- The detailed coverage gate, source-hint derivation/admission, coordinator integration, richer reaction semantics and coherent capture authority remain later work. Their absence is not a finding here.

## Verification and diagnostic artifacts

Executed in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`:

- `corepack pnpm exec vitest run packages/mcp/test/portal/workflow-requirements.test.ts`: 14 passed, exit 0.
- `corepack pnpm exec vitest run --config .cache/review-task4-2c/vitest.config.mjs`: three independent assertions failed, exit 1, reproducing the findings above.
- Fresh SHA-256 checks matched both reviewed owned hashes.
- `git check-ignore` confirmed the unique diagnostic files are excluded by the existing `.cache/` rule.

Retained diagnostics: `service/.cache/review-task4-2c/adversarial.test.ts` and `vitest.config.mjs`. They are excluded from source integration; no deletion is required. No owned file was edited. No Superpowers, subagents, Docker, browser, daemon, build, primary dist, index, commit or push operation occurred. The worker's owned-root TypeScript and lint results were read, not independently rerun; no full MCP typecheck success is claimed while the unrelated native task is changing its files.

Native validation shares the Windows account, filesystem, process namespace and network. A separate working copy is not an OS sandbox or atomic filesystem snapshot.
