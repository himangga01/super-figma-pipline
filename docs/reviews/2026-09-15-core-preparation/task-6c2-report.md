# Task 6C2 core preparation persistence

Status: Implemented foundation, awaiting independent review. Not integrated into main or the public coordinator yet. Task 6D remains required; this module does not establish capture/source admission by itself.

## Behavior

`CorePreparations.prepare` runs the actual fixed seven-core derivation rather than accepting caller results, pages or completion flags. It validates owner/workspace, strategy, mandatory selections, current core contract and exact qualified source descriptor correspondence. The coordinator must supply its already admitted context and current source/capture inputs; metadata hashes are not permission grants.

A signed immutable context binds the derived input hash. The same admitted context cannot be reused with different core inputs. Preparation identity includes context and input; result identity includes context, input, recipe and definition. All retained records use the existing signed PortalStore and retained-directory protections. A canonical filesystem mutex spans capacity admission and publication across instances. This is native same-account coordination, not an OS sandbox or protection against arbitrary memory compromise.

Capacity is reserved before publishing context, pages or results. The reservation supports the full 128 MiB core bundle plus 16 MiB metadata/envelope allowance and the actual context bytes. The ledger limits each owner to 32 preparations / 5 GiB and all owners to 128 preparations / 20 GiB. These are logical reservations, not disk preallocation. Existing records and cancelled histories remain charged; no live or historical evidence is silently deleted to admit work. Finite underlying CAS history limits remain applicable. There is currently no automatic physical garbage collector; this is explicit retained capacity, not an unlimited service claim.

The state machine retains pending, running, blocked, failed, cancelled and ready. Pages precede their signed result; all results precede the terminal checkpoint. Exact matching orphan records are adopted on retry. Changed context/result/page bytes cannot be adopted. Cancelled preparations never silently resume. Blocked derivations retain their detailed manifests and pages while their result is not marked succeeded. Independent reads revalidate signatures, all result/context/definition/input bindings, page membership/count/hash/material and aggregate page/byte limits. Attaching a server dependency re-reads actual results. Active dependencies block cancellation; ending a dependency is an internal server lifecycle operation, not a client assertion.

## Validation

Native working copy: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

- `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/core-preparation.test.ts --maxWorkers=1`: 11 passed, 4.23 seconds, September 15 at 08:41:19.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/mcp/tsconfig.json`: passed after the owned edits settled.
- Owned-file oxlint with `--deny-warnings`: passed.
- Owned-file oxfmt: formatted successfully.

Tests use actual filesystem, signing, CAS and canonical mutex operations. They exercise seven-result ready state, restart/idempotent read, missing core selection, stale contract/source/owner/workspace, capacity before publication, conservative cancellation accounting, two manager concurrency, interrupted context/preparation/page/result publication, page MAC tampering after ready, blocked results, dependency lifecycle and cancellation after partial publication. Export bytes are controlled unit data, not live PNG/Figma acceptance. Permission enforcement has separate project tests; this fixture substitutes only permission inspection while retaining real I/O.

The full source check is deferred until coordinator wiring: a new service module without a public consumer is expected to be unused to Knip until Task 6D. No ignore has been added to hide that dependency. No build, daemon, browser, dependency update, main copy, Git index mutation, commit or push was performed for this slice.

## Remaining integration

Use actual effective core definitions and admitted source/capture/scope/workflow contexts in portal_plan. Link required result hashes and obligations into blueprint identity before coding leases. Provide bounded public page/work-item reads and candidate declarations, then actual server consumption evidence. Wire dependency retention to plans/runs and cancellation. Current task does not certify these consumers, cross-session authoring recovery, portable capture, live case matrix or final review rounds.
