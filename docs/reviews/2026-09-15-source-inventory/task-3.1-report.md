# Task 3.1 Report: Source Discovery and Byte Inventory

## Scope and status

Task 3.1 is implemented in the separate validation copy and ready for independent review. Only the seven source/test files listed below were edited. This report is the explicitly requested exception outside the validation copy. No main-checkout source files, staged index, existing Task 1/2 changes, dependencies, browser state, daemon process, or primary `packages/mcp/dist` were changed. No build was needed, and no subagents, Docker, VM, WSL, commit, or push were used.

Validation source root: `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

The controller approved the optional `graph.sourceInventory` interface and the separate inventory-stage byte accounting. Native profile/application version enforcement, external artifacts, resource grants, qualified source delivery, and the remaining Task 3 migration are still separate work. This task does not close legacy execution or applied-source authority gaps.

## Implemented behavior

- Added `RepoReader.walk({ mode: 'portal-source-authority' })`. This mode retains the existing directory/path authority machinery, uses fixed service policy, and rejects extension filters or selected subroots. The default semantic walk is unchanged.
- Authority discovery includes `.gitignore`, other nonsecret dotfiles, dotdirectories, ignored generated inputs, checked-in `build`, `dist`, `vendor`, and `test` contents, and every regular file regardless of extension.
- Explicit exclusions identify the normalized relative path, entry kind, and reason. `.git` is Git metadata, `node_modules` is a provisioned-dependency policy boundary, `.sfp` is service runtime, and credential names/directories are excluded by fixed policy. Excluded entries are recorded without content reads or recursive counting. The provisioned-dependency reason is a policy classification, not proof that provisioning or lockfile validation has already succeeded.
- Required junctions/symlinks, nonregular entries, unsafe portable names, non-NFC aliases, portable case collisions, hardlinks, disappeared/unreadable files, and failed directory authority produce explicit errors/incompleteness. Observed exclusion decisions and scan accounting survive a later discovery failure.
- Added exported shared `PortalSourceInventorySchema` and `PortalSourceInventory`. The existing shared barrel already exports `portal.ts`, so no separate barrel edit was needed.
- Added `collectPortalSourceInventory(reader, lowerLimits?)`. It records raw-byte SHA-256 hashes, byte counts, conservative text/binary classification, explicit exclusions, actual limits, scanned entries, total inventoried bytes, completeness, and bounded issues. Invalid UTF-8, NUL, C0 controls other than tab/CR/LF, and C1 controls are binary. Classification does not rewrite bytes or claim parser coverage.
- Default inventory bounds are 5,000 files, 16,777,216 bytes per file, 134,217,728 aggregate bytes, and 20,000 scanned directory entries. Requested inventory limits can only lower these caps. Explicit lower reader byte limits are preserved and recorded.
- `RepoReader.withByteBudget` creates independent inventory-stage accounting while retaining root identity, workspace policy, before/after file and directory hooks, and cancellation. A reader's implicit semantic defaults can use the inventory policy defaults; explicitly configured lower limits cannot be raised by this operation.
- Inventory identity uses a versioned, fixed-order JSON array frame containing policy/version, limits, sorted file paths/content hashes/lengths/classification, sorted exclusion decisions, counters, completeness, and issues. This framing distinguishes individual fields and membership unambiguously. Included content changes and file addition/removal change identity; changing excluded credential content does not hash the secret, while removing its exclusion entry changes identity.
- `analyzeServiceGraph` now returns optional-schema/newly-populated `sourceInventory` alongside the existing filtered semantic `files` and evidence. New `sourceHash` uses the `sfp-service-source-v2` domain and binds the inventory hash plus semantic file evidence. Stored legacy graphs remain valid with the inventory absent; it is never synthesized from their filtered files.
- Inventory failure sets graph incompleteness and disallows lexical-only reviewability. Binary data under a semantic extension is omitted from text evidence and retains `SOURCE_ENCODING` hard incompleteness. Legitimate opaque assets can remain inventory-complete without being parsed as code. API/module inference was not broadened.

## Verification

All commands ran with the native installed toolchain in the separate validation copy. No emitted build output was created.

Final focused test command:

```powershell
pnpm exec vitest run packages/mcp/test/portal/source-inventory.test.ts packages/mcp/test/portal/service-graph.test.ts packages/mcp/test/fs/repo-walk.test.ts packages/shared/test/portal.test.ts packages/mcp/test/tokens/repo-css.test.ts packages/mcp/test/tokens/repo-scss.test.ts packages/mcp/test/icons/repo-icons.test.ts
```

Result: **7 test files passed; 59 tests passed; 1 explicitly skipped; 0 failures; exit 0**. The final run reported 2.76 seconds. The skipped case requires a case-sensitive filesystem to create `A.txt` and `a.txt` as distinct files, so it is explicitly skipped on Windows. The real NFC/decomposed-name rejection test ran on Windows. The real junction and hardlink cases were not skipped.

Other final checks:

| Check | Result |
| --- | --- |
| `pnpm --filter @sfp/mcp typecheck` | Passed, no emitted output |
| `pnpm --filter @sfp/shared typecheck` | Passed, no emitted output |
| `pnpm exec oxlint --deny-warnings` over the seven owned files | Passed, no diagnostics |
| `pnpm exec oxfmt --check` over the seven owned files | Passed |

The real filesystem fixtures cover ignored imported `src/generated/client.ts`, `.editorconfig`, `.config/loader.js`, `.well-known` data, checked-in generated/directory-name inputs, `.mts`, `.cts`, GraphQL, shell/text inputs, raw binary assets, deterministic ordering and change/add/remove identity, secret-content nonreads, no descent into dependency/Git/runtime boundaries, lower file/scan/byte limits, required links, disappeared files, failed child-directory opens, retained root identity, and cancellation after file open.

Default byte caps were exercised with real binary files: eight 16 MiB files were inventoried (128 MiB total), the ninth was rejected, and a 16 MiB plus one-byte file was rejected before content inventory. A 9 MiB asset succeeded under the inventory policy while the default semantic reader's smaller per-file limit still rejected it. Binary/control data in `.js`, `.json`, `.ts`, and `package.json` was explicitly kept out of graph text evidence while preserving hard semantic incompleteness.

TDD evidence: initial graph inventory/explicit-exclusion tests failed because `sourceInventory` was absent, then passed with the implementation. Separate tests exposed raised explicit reader limits and control bytes incorrectly classified as text, then passed after correction. The binary-under-semantic-extension test showed those bytes in `graph.files`, then passed with `SOURCE_ENCODING` and exclusion from text evidence. Further red tests showed discovery failures losing scanned-entry/exclusion evidence, then passed after retaining the partial traversal result. Additional boundary/compatibility tests exercise the real helper and existing retained reader; they do not substitute fabricated complete inventories.

## Limits and remaining work

Inventory completeness is relative to the fixed recorded exclusion policy. It is separate from semantic parse coverage, native provisioning qualification, source-root grants, and permission to execute. Consumers must reject or migrate legacy graphs with no inventory instead of assuming success. Later native/application contracts still need to bind and enforce this new inventory identity.

`totalBytes` is the sum of successfully inventoried source bytes. The isolated stage has a logical 128 MiB default read budget; semantic extraction and project-pattern reads may read the same source again using their own existing budgets. It is not a claim that the entire analysis uses only 128 MiB of physical I/O or process memory. The retained reader protects checked path/descriptor identity during operations; collection does not freeze the whole tree into an atomic filesystem snapshot.

The separate working copy limits which repository files this task edited. It does not provide an OS sandbox, account isolation, network isolation, or process confinement. Native tests ran under the current user's permissions and used controlled temporary fixtures and the existing retained-directory helper. No claim is made that the actual connected daemon runs these source bytes; its older diagnostic `dist` build was preserved.

## Exact owned source hashes

Paths are relative to the validation `service` root above. SHA-256 values were read after formatting and the final source changes.

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/fs/repo-walk.ts` | `ae11891ce63e0dcc29a6f46bc53f5253dc1a4c79c521fd8a6b6d0791dea0472f` |
| `packages/mcp/src/portal/source-inventory.ts` | `3ef6263ac7ecb780824dedc33ef212bdf45365b3e437bda43631d2f1e1ffc4ef` |
| `packages/mcp/src/portal/source-path-policy.ts` | `2f610b84c3a32e15781e37be0ee398c3e21738d6eb7f0ad642ca46ebc62884e0` |
| `packages/mcp/src/portal/service-graph.ts` | `32de16b4c6abdb1e52bc30be5eb63c01db7302c882d7e27168c99060fa3bf4f2` |
| `packages/mcp/test/portal/source-inventory.test.ts` | `974d3305b4044b8a520b762d06260b26643cf93aef784f8ded00301a1fc1603a` |
| `packages/mcp/test/portal/service-graph.test.ts` | `5761dfe0ee635af248c869c61987944fca6b68a05167eefdfb3bcd7d75f4e31f` |
| `packages/shared/src/portal.ts` | `dbe3b137b4b8c9ca6a8f071011c970ffc36a4ad586225add18e05e0e2d8f0a10` |

Independent Task 3.1 review and controller byte integration are still required, followed by the remaining Task 3 substeps and final review/verification.
