# Fresh CDD page-API readiness

Analysis date: October 12, 2026 (Asia/Seoul).

Scope: read-only readiness review for the coordinator's next independent Chrome page-API CDD run. This follows [AGENTS.md](../../AGENTS.md), the shared analysis policy, [canonical service analysis](../service-analysis.md), [retained-tab evidence](../testing/2026-10-11-web-portal/retained-tab-live-qa.md), [the live-usage contract](../testing/2026-10-11-web-portal/usage-live-tests.md), [the current CDD record](../testing/2026-10-03-cdd-generation/README.md) and [independent acquisition evidence](../testing/2026-10-02-chrome-parity/README.md). Only this report was changed. The coordinator exclusively controls the live portal and Chrome.

## Baseline and current boundary

Main and native service source were independently recomputed and both match **`sha256:f0dc149a95da3bc7f8e52aecb094362d6e0166ae69e4ba29946a393e90f220c8`**. Git HEAD remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with the existing uncommitted integration/documentation work. The canonical report binds this source to the passing sixteen-gate whole check, 5,338 passes, twenty unchanged skips, 104 mandatory Chrome cases and the separate artifact check. Those results are code/package verification, not fresh CDD acceptance.

The current primary deployment is daemon 7460 on 3055 and portal 27636 on 4310, with the retained portal Chrome 9932 and separate source Chrome. The deployment record preserves ten workflows/runs, 353 journal rows and the same three unresolved unknown-operation hashes. The prior model-data grant expired at 05:32:59 KST; the restart did not renew it. This review did not read authentication material or query those live processes.

After the recorded deployment's failed connection attempt, the coordinator reports that two consecutive new `chrome.tabs` jobs, prefixes `c6b19ac1...` and `9b1d92c9...`, succeeded at approximately 01:20 UTC after manual owner approval. That later evidence supersedes the earlier tab-read failure for connection readiness, while preserving its failed job. It does not establish page-API identity, complete capture or the daemon's separate capture connection. This worker did not independently perform those reads.

**Latest coordinator steering:** two new local capture jobs on the main state's two existing workspace scopes now remain unknown. The page-API attempt found the API unavailable; native export encountered a blocking Figma Dev Mode web modal. Both jobs and their fences must remain unchanged. They are separate from the original three journal unknowns. A global `egress.allow` job on main would overlap the unknown fence; selecting another workspace or using a lower-level administrative call must not bypass it.

**Readiness conclusion:** use a genuinely new owned validation daemon/portal state and new outputs after the exact exporter repair is integrated and verified. Root has already requested explicit fresh-QA eight-hour/four-class model-data approval; it is pending and cannot be inferred from Chrome Allow. Do not configure egress on the fenced main state, copy its old policy/snapshot into the new state, resume old runs or clear any unknown. Fresh state alone does not repair an unavailable page API; successful native `.fig` export must remain a distinct collector and cannot be relabeled page-API acceptance.

## Exact model-data authorization

In the genuinely new owned QA state, after actual approval, the supported public action is **CLI feature `egress.allow` with arguments `{}`**, no Figma target and no workspace. Its fixed `ControlClient.allowModelData()` implementation requests:

```json
{
  "mode": "external-model",
  "allowedClasses": ["public", "project-code", "design-text", "design-image"],
  "expiresInSeconds": 28800
}
```

The backend obtains a fresh authenticated action nonce, writes a new audited configuration and generates its own consent identity. Never copy a nonce, consent, grant file or previous policy into a new state. `secret` is excluded. The policy is stored once at the daemon state root as `egress.v1.json`; the actor identifies the audited administrative caller, but the grant has **no file, workspace or model-provider restriction field**. The current public feature has **no narrower class or duration inputs**. An approval must describe the actual daemon-state-wide four-class/eight-hour permission, even though intended work remains the CDD frontend task.

Concrete authorization wording for the coordinator to present:

> Allow the newly owned QA service state to expose public data, project code, design text and design images to the external coding/model session for eight hours, for fresh independent CDD capture and frontend generation after the verified repair. The supported permission applies to this QA daemon state rather than only one Figma file. Secret data remains excluded. Use new C4 outputs without reference frontend code, preserve all existing unknown operations and local capture jobs, and revoke the new QA grant through the normal public reset after the authorized work finishes.

The owner must actually approve this renewed scope before execution. Earlier Chrome Allow and the expired grant are not renewed model-data consent. If the owner requests a narrower grant, do not pretend `egress.allow` implements that request: the generic backend schema supports 60–28,800 seconds, but the implemented public CLI/UI action fixes eight hours and all four non-secret classes. A supported narrower control would need separate concrete implementation/review, outside this analysis.

This is distinct from `network.add`, the remote-domain registry. For the Chrome page-API path, `portal_plan` selects its declared `external-browser-read` collector effect; the official-server network effect is selected only for official MCP. Do not add a domain or borrow OAuth/provider credentials to satisfy this Chrome path. Official MCP's authentication-required state remains a separate acceptance obligation.

After a confirmed new grant, record safe status fields such as config hash, classes, expiry and `expired:false`. A failed/unknown configuration outcome must not be retried automatically; a later status snapshot cannot resolve its original outcome. The planned normal reset is a new authorized administration action, not a replay of any previous reset. If reset becomes unknown, preserve that outcome and use the service's reviewed recovery rules.

Evidence: `service/packages/cli/src/control-client.ts:434`, `service/packages/cli/src/admin-commands.ts:311`, `service/packages/cli/src/service-functions.ts:148`, `service/packages/shared/src/egress.ts:324`, `service/packages/mcp/src/policy/policy-engine.ts:135`, and `service/packages/mcp/src/policy/operation-policy.ts:424`.

## Inputs that can be reused, and authority that cannot

| Existing evidence/input | Permitted reuse | Required fresh replacement |
| --- | --- | --- |
| Authorized source URL `https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120` | Product/source selection; C4 `new-blank`, references empty | Current source page/file identity, complete collector output and asset manifest |
| Four requirements in `.worktrees/_cache/portal-usage-20261011/config.json` | Product intent: `figma-account-session`, `language-selection`, `registration-demo`, `frontend-presentation`; local demos, locale persistence and responsive/accessible presentation | Current saved workflow revision and new observed interaction decisions |
| Historical 192-node, three-root/25-asset captures and independent comparison reports | Expected scope and diagnostic comparison only; GUIDE `1381:285`, Mobile `1381:530`, Desktop `1381:541` | Fresh page-API facts and original assets; counts may change and are not hard-coded acceptance |
| Old page-API context `.worktrees/_cache/cdd-page-api-context-20261011-prep-r2` | Product-input/template structure and historical failure attribution | New capture/plan IDs, analysis/context/source hashes, coding lease, declaration/consumption receipts and one-hour run window |
| `.worktrees/_cache/cdd-page-api-profile-20261011` and old validator helpers | Reviewed command/profile structure and known failure lessons | New candidate closure, toolchain/filesystem identity, source epoch, prepared profile, reviewed registration and accepted consumption |
| Old generated frontend/candidate and R8 applied output | Preserve untouched as historical output and diagnostic evidence | New independent implementation from fresh source; do not use old frontend code as C4 reference/seed |
| Primary handoff snapshot | Preservation only | It cannot restore expired authority or prove current file/process identity |

The old page-API R2 plan is `sfp_portal1_1459262f8e0752efd5db0519931fe827`; its earlier complete capture and decisions are not current authority. The later web Scripter run `sfp_portal1_173fec8db0ca8a8d82d3f574b29f283d` reached agent waiting, later admitted a candidate, and failed native preview/semantic acceptance. Its old target `cdd-usage-round-2-r2`, profile and candidate must not be resumed by changing deadlines. New service runs receive a one-hour deadline in `PortalCoordinator`; do not copy or reset the old one.

Historical implementation lessons can inform a new build without copying code: preserve real source text including Unicode separators, interactive pointer handling, accessible names and captured text effects; distinguish visible glyph measurements from nominal API font size; use direct supported compiler entry points. The last Mobile diagnostic still failed at 1.0760% against the unchanged 1% criterion. It is a failure reference, not a new source oracle or acceptance waiver.

## Existing helper/config paths

All paths below exist and were inspected only for safe operation/path metadata. They are examples/templates, not ready-to-run fresh commands:

- `service/packages/portal/web/tests/live-usage-check.mjs`: current SHA-256 `ae469a6553c8be630041d7bb7e7f3e71512f82c3663a399a0b95d6502185a855`; actual UI runner restricted to portal 4310. It requires all three configured rounds, separate targets, page-API/Scripter/page-API order and one existing owner-controlled page. Current reuse mode must not create another browser/context/page.
- `.worktrees/_cache/portal-usage-20261011/config.json`: reviewed product requirements and previous round targets. Its retained browser endpoint and old `decisions.json` must not be copied as current connection/decision authority. It currently requires `agent-handoff`, which does not mean generation acceptance.
- Native private `.cache/prepare-cdd-page-api-20261011-r2.mjs`: invokes `portal_plan`, reads the old R8 request and the prior page-API R1 plan, then builds old preparation output. Rebuild only product inputs; discard old decisions/bindings/targets.
- Native private `.cache/start-cdd-page-api-20261011.mjs` and `.cache/fetch-cdd-page-api-context-20261011.mjs`: `portal_start`/`portal_next` sequence and paginated-context examples. Do not execute with their old file/run inputs or transfer a lease across sessions.
- Native private `.cache/web-cdd-live-20261011-r6.mjs`: actual UI start example reading the old page-API R2 request. Rebind a new workflow and fresh output rather than rerunning the old request.
- Native private `.cache/validate-cdd-page-api-20261011-v2.mjs`, and the profile directory's `prepare-native.mjs`/`compose-config.mjs`: validation configuration examples. Reprepare and review actual fresh hashes/authority before registration or execution.

The old helpers use `new ControlClient()` without an explicit state-root literal and rely on their invoking environment. Primary service state is under `.worktrees/_cache/cdd-native-appdata/SuperFigmaPipeline`; the default CLI port is 3055, but the ordinary Windows-user state default is not automatically that primary state. The fresh reviewed helper must instead bind the newly owned QA state and its exact new port, plus the corresponding owner `LOCALAPPDATA` anchor, preserving/restoring its caller environment. Do not point old-default commands at primary or retained QA 3056/3057/3058 states. Do not copy primary state, policy, old job records or the primary handoff snapshot into the new test state.

## Safe coordinator sequence

1. Preserve the primary state, original three journal unknowns and the two new unknown local capture jobs/fences. Finish the exact managed exporter repair, independent review and root integration/provenance checks. Bind the actual new source/build; the existing f0dc pass does not cover unintegrated export changes. Start only a genuinely new owned validation state with no copied policy/history/authority, then navigate the same owner-controlled portal tab to that actual QA portal. Do not stop/restart primary or create another visible Chrome window as a readiness shortcut.
2. Wait for the explicit fresh-QA data-grant approval already requested by root. In the new state only, select service function `egress.allow`, preview `{}` with no workspace/target, confirm once, and verify the new safe status/expiry. Keep its job/audit identity separate from all historical grants/resets. Do not dispatch this global action on main or attach an artificial workspace to evade its unknown fence.
3. Register a new empty owned workspace and use new previously unused relative output targets in the fresh state. Runner round 1 requires the registration folder to be empty. Candidate name `cdd-fresh-page-api-20261012-f0dc-r1` was absent under the two old output roots at this read, but those roots now belong to fenced main scopes and are not the recommended fresh-QA targets. Root must choose/check fresh owned paths and label them with the actual post-repair source rather than relying on this example's f0dc suffix.
4. Optionally use service feature `chrome.inspect.runtime` in that new state with the CDD URL, `open:false`, a fresh capture-output folder, selected owned result-capture workspace and a bounded wait. It maps to `chrome-inspect --ui-only --probe-runtime`. Inspect safe `available`, `identityVerified`, key-match/type and API/page stability fields; it remains `fullCapture:false`. The latest actual page-API failure is unavailable: if this persists, stop this collector and investigate its supported runtime access rather than substituting native/Scripter facts. Missing/mismatched identity must not be filled from the requested URL. The new daemon's independent capture connection may require its own manual native approval even after portal-owned tab reads succeeded.
5. Create/save a new guided workflow with the five ordered stages, case `new-blank`, source `chrome-page-api`, the CDD page URL, `require-live`, empty references and the four reviewed product requirements. Start once through the actual UI. The bridge creates a new `portal_plan` and `portal_start`; original operation prompts may be approved only for the current workspace/run/effects and unexpired prompt. Native Chrome Allow remains manual.
6. Require new page-API provenance `existing-chrome-page-api-v1`, complete/live-verified capture, matched URL/file/page/scope, complete-or-empty capabilities, fresh asset/source/contract/evidence fingerprints and captured PNG/SVG/original-image assets. Two tab reads or a synchronous runtime probe are insufficient. On `FIGMA_PAGE_IDENTITY_CHANGED`, cleanup-unconfirmed or incomplete capture, stop at the recorded failure rather than weakening guards or supplying Scripter facts.
7. If fresh capture returns unresolved interactions, review its current analysis hash and every evidence row. Stage `implement` choices against the appropriate confirmed requirement, save a new draft revision, and start a fresh plan as the UI contract prescribes. Preserve the first input-wait run. Do not attach old `decisions.json` or assume the earlier eight IDs/hashes are current.
8. When the new service run reaches coding-agent waiting, obtain fresh paginated context/recipes/assets and a lease through the same authenticated CLI/MCP connection that will submit. Keep runner `requestContext:false` for an external agent; do not obtain a web lease and paste it into a different session. Generate new frontend files from fresh source and submit their new closure. An agent-handoff or waiting state is not generated output.
9. Prepare and review a fresh native profile through `portal.profile.prepare`; register the exact prepared result through `portal.profile.register`. Bind the new plan/run/context/candidate/toolchain/artifact/environment identities and fresh source oracles. Execute candidate validation with unchanged visual/interaction/accessibility/independence criteria. Do not reuse old profile registration, consumption receipts or a source-bound preparation copied from a backup.
10. Continue only through recorded passing gates: candidate validation, explicit guarded application to the fresh target, applied runtime validation and final live-source freshness. Preserve all failed attempts and unknown outcomes. Finish the CDD obligation and three complete UI-to-frontend journeys before the separately required reference-free eCommerce official-MCP/Chrome outputs.

If using the existing UI runner, root must prepare a new private config and evidence directory, rebuild the current owner-controlled endpoint field privately, omit stale decision authority, provide three fresh targets and select the actual required outcome. **The current runner hard-restricts origin to primary port 4310. A QA portal on another port cannot use it unchanged.** Root must use an authorized service-owned UI helper for the exact new QA origin, or implement/review a bounded origin adaptation before invoking this runner. Do not pretend a config-only port change passed its guards. The following commands are proposals only after that runner/origin contract is satisfied:

```powershell
# Native service working directory; config is a newly reviewed file, not the old config.
node packages/portal/web/tests/live-usage-check.mjs --config <fresh-reviewed-config.json> --round 1 --dry-run
node packages/portal/web/tests/live-usage-check.mjs --config <fresh-reviewed-config.json> --round 1 --execute
```

Runner observation time does not extend a service operation or the one-hour coding run. Its normal periodic UI poll reads retained cache; external-agent progress needs explicit bounded service-status refresh. Use the coordinator's existing browser connection and disconnect only test clients. A fresh evidence root, capture/context directory, candidate directory, profile identity and output target are all required; no old attempt directory or exclusive target claim is erased.

## Verification limits and continuation

Executed here: instruction/report/source inspection, sanitized historical JSON metadata extraction, filesystem existence/absence checks and independent main/native source hashing. No service endpoint, Chrome/page API, Figma/official MCP, model-data grant, operation approval, compiler, candidate script, test, profile prepare/register, process start/stop, state write, credential read, package install or dependency change occurred. The only write is this English Markdown report. No credential, nonce, consent identity, raw private browser endpoint or private-state payload is recorded here.

Remaining facts need root's actual repaired service workflow: confirmed new QA origin/state/build, supported page-API runtime access, stable identity, fresh complete acquisition/parity, actual renewed permission, fresh workspace and native authority, and accepted frontend behavior. The report supplies the safe ordering and exact authorization scope; it does not certify a new preparation or frontend. No product requirement change is proposed. Root's fresh-QA eight-hour grant question remains pending; narrower permission needs a separately supported control rather than assumed scope.
