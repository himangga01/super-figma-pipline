# Native supplement URL normalization repair

Date: October 13, 2026, Asia/Seoul. The exact two-file candidate is independently approved and integrated; fresh source-bound whole/artifact and deployment gates remain required.

## Finding and baseline

Root's sole live controller reported a causal read-only experiment: the current signed plan used a percent-encoded colon in `node-id`, while its signed capture descriptor contained the canonical hyphen form. Other observed signature, document, scope and time predicates passed. These are Root-reported live observations; this delegate did not operate the portal, Chrome, state or grants.

Current Main/native baseline is `sha256:ca964193b989acf154ff769490f5732d7e028fe2e2d5a01b06f7edf1571fd84a`. The existing [supplier implementation](native-capture-supplement-implementation.md) and [independent review](native-capture-supplement-review.md), repository instructions and shared analysis policy were read. Historical supplier R2 approval remains evidence for its earlier exact source, not proof that this newly exposed URL case passed.

`StoredNativeContourAcquisition.readVerified` compared `plan.design.url` directly with the canonical `plan.design.capture.source.url`. The raw string comparison rejects `node-id=0%3A1` and `node-id=0:1` against `node-id=0-1`, despite the existing `parseFigmaTarget` returning the same supported target. The controller's page-specific `1378%3A120` versus `1378-120` case follows the same parser rule. A public UI can normalize input back to the colon form, so an input workaround is not a production repair.

## Minimal implementation

Only two files are owned, in the separate regular copy at `.worktrees/_cache/native-supplement-url-repair-20261013/work/service`:

| File | Before SHA-256 | Frozen after SHA-256 |
| --- | --- | --- |
| `packages/mcp/src/portal/capture-native-supplement.ts` | `253535a2a8203a31614869b17aa14c48ec98f5b9aab393048351170fd8a09898` | `4fad40f8b2290da577ce08e144944cadd93a85a34830566404de788331feaa1b` |
| `packages/mcp/test/portal/capture-native-supplement.test.ts` | `02362d84aea8ce22a0a788ca0da49114a5dc71ac00888830444d86fee6021d97` | `3d3f8206054aef21fd8476f9af7b5101ed925370aeb1a607a56bf0c5f08ec00e` |

The entire production diff is:

```typescript
parseFigmaTarget(plan.design.url).url !== plan.design.capture.source.url
```

This replaces the raw comparison. The parser was already imported. The freeze script mechanically compares the complete production file with its preimage plus this single replacement; all other production bytes are identical. It preserves exact signed owner/workspace/plan/descriptor/intrinsic-capture/full-scope checks, document path/bytes/hash/identity checks, actual file/node fields, capture times, original deadline/signal and final signed-state/leaf rechecks. No alternate decoder, acquisition, broad fallback, record rewrite or metadata-only authority was added. Unsupported URLs still fail closed.

## Executed verification

Tests use actual signed plan/design/supplement records and real protected-path/byte checks in an owned disposable fixture. They modify only the signed plan's URL through the fixture store and require the same retained document/capsule, unchanged supplement metadata and no network action. The equivalent forms cover encoded colon, literal colon, and supported host/slug/tracking/fragment normalization. Separate cases deny another file, another node, a missing node and a foreign host.

| Receipt | Result | Interpretation |
| --- | --- | --- |
| `url-red.json` | 0 passed, 7 failed, 45 filtered | Three actual equivalence failures plus four test-reference failures from using the wrong existing closed error code |
| `focused-green-r1.json` | 48 passed, 4 failed | Equivalence repair worked; the same four wrong expected-code references remained |
| `url-red-corrected.json` | 4 passed, 3 failed, 45 filtered | Corrected exact existing error code, original production restored: all three equivalent forms fail and all four foreign-target cases reject correctly |
| `focused-final.json` | 75/75, zero failures/skips, exit 0 | Supplier 26, coherence 26 and actual canonical MCP/authenticated owned HTTP geometry 23 cases |
| `types-mcp-final.json` | Zero diagnostics, no emit, exit 0 | Full regular-copy MCP typecheck against installed native dependencies |

Both initial test-reference failures remain preserved; they are not attributed to production denial behavior. Scoped two-file lint with warnings denied and formatting checks passed. The final test receipt SHA-256 is `0efcee154ab823065955ab5128da02964a8312b5379ce83ce4b0775bb9c463a4`; corrected fail-first receipt is `46a24b827b50f9b70ef7c9c6ae9f3af0040248dae5c89cdba044b2f2cebba966`.

Frozen manifest: `.worktrees/_cache/native-supplement-url-repair-20261013/frozen-files.json`, SHA-256 `47c1aa6f1525cda50fb941c503f3d56bdaec62aa4bc6b7b37753a09986700b3e`. It records both exact source hashes, preserved failures, final checks and the one-comparison production constraint. The copy has 1,215 regular files, no dependency copies, builds or installations. Native dependencies are resolved read-only. Permission behavior is injected in these fixtures; this is not a new native ACL/deployment proof.

## Reproduction and continuation

From `C:/2026_project/super-figma-pipline/.worktrees/baseline/service`:

```powershell
node node_modules/vitest/vitest.mjs run --config C:/2026_project/super-figma-pipline/.worktrees/_cache/native-supplement-url-repair-20261013/work/focused.config.mjs --configLoader native --reporter=json --outputFile=C:/ABS/OWNED/unique-supplement-url-review.json
```

For an independent fail-first run, use the new test file against the exact original supplier source and filter `supported equivalent URL|signed plan URL targeting`; filtered tests are not passes. Then overlay the frozen production comparison and rerun with a distinct receipt. Rehash both files afterward.

Root owns independent review, integration, provenance, chosen whole/artifact gates and a fresh replacement helper because the prior helper was consumed. This delegate made no Main/native production, live browser/runtime, C2, state, grant, deadline, unknown-outcome or Git changes. The ordered-read/non-atomic limitations remain. These fixtures do not establish a deployed geometry read or complete frontend acceptance; three fresh complete journeys remain separately owed. C2 review resumes after this bounded repair.

## Root independent review and integration: 13:29 KST

Root created a separate regular copy of the unchanged Main ca964 source and mechanically verified the entire production delta is the one canonical-parser comparison above. With only the frozen new test file overlaid, the original supplier failed all three equivalence cases. The independent filter selected no denial cases: zero passed, three failed and 72 filtered. Those 72 are not passes. Root then overlaid the exact frozen production file and ran the entire supplier/coherence/public-geometry cohort: **75 passed, zero failed, zero skipped**, exit zero. All four foreign-target cases and the existing signed-state, cancellation, scope and HTTP boundary cases passed unchanged.

Root approves and integrated both exact frozen files into Main and the regular native validation copy. [The exact integration receipt](native-supplier-url-integration-20261013.json) records hashes and independent red/green receipts. The new source before provenance is `sha256:b034422c9a3524400a14c50b4cae9efe7a5815be5b906d386bb8f909192e2389`; it has not had a whole check or runtime replacement.

The first integration helper stopped before writes because the raw owner-index hash changed after a Root `git status` inspection refreshed stat metadata. Read-only comparison verified all 1,759 staged mode/blob/path entries still equal HEAD exactly. [The semantic index receipt](owner-index-stat-refresh-20261013.json) preserves the old/new raw hashes and verification limit. A distinct R2 integration helper used that observed baseline and left it unchanged. No old index was restored and no service changes were staged in the owner index.

The sole controller has stopped further live captures and is preparing a new one-use same-state replacement helper. The earlier consumed R2 helper remains preserved. New helper review, provenance, whole/artifact checks and actual public geometry/generation/application remain separate gates. The UI's supported URL normalization is retained; no private state or geometry substitutes for public acceptance.
