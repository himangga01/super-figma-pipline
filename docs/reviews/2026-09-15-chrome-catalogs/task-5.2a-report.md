# Task 5.2a implementation report

## Result

The closed Chrome/Scripter reader now transports local paint, text, effect and grid styles through the generated Plugin API program, strict Zod wire parser and paginated snapshot reader. Variables and collections retain their existing arrays; styles use `styles.paints`, `styles.texts`, `styles.effects` and `styles.grids`, matching the Desktop family names.

Each family has an independent offset and a bounded descriptor containing `state`, `count`, `nextOffset` and `valueTruncated`. Successful empty enumeration is `empty` with count zero. Missing APIs are `unsupported` with count null; getter, enumeration and identity failures are `failed`. Earlier-page value loss cannot be promoted by a later complete page. Observation capability entries use `{name,status,count}`, including explicit null for unknown counts.

Root and child continuation uses exact identity sequences, rejects duplicates and checks cursor progress and returned identity slices. All successful first-pass queries are retained as bounded query/hash receipts and reexecuted in an ordered final second pass. Changed same-ID node properties or catalog values fail with `BROWSER_CONTENT_CHANGED`; exhausted reobservation budget remains incomplete. Content identity includes source URL, page, scope, requested depth, exact root IDs, tree, catalogs and statuses; capture timestamps are excluded.

Raw mode maps, variable aliases, style bindings, and mixed-text style IDs and bindings remain available. Referenced variable IDs absent from the local catalog are explicitly unsupported; no default-mode inference, remote import or document mutation was introduced. The reader does not claim external variable closure from local enumeration.

## Ownership

Only the five files below were changed. No MCP/shared/plugin/asset collector/native/index/dependency files were edited. No Chrome attachment, browser, Figma, daemon, primary dist, process, Git index, commit or push operation was performed.

| Path | SHA-256 |
| --- | --- |
| `packages/cli/src/read-program.ts` | `50f872b153a7a14d102251cb4657b5cf8bc97a1c4289ee7293a541852b00bc50` |
| `packages/cli/src/scripter-bridge.ts` | `44e416fea740ab566c415f0ea3c245a637f1ab8f2514507f9503a9acfd611df8` |
| `packages/cli/src/snapshot-reader.ts` | `b023a21567212fe98a823c50a297cfcddcda404c2b1b4b3b215d41999ac83b51` |
| `packages/cli/test/scripter-catalogs.test.ts` | `6486894dde8cec8d399c4a06e16050bdda4b7526ed62a3bcfc03dc9044f420ae` |
| `packages/cli/test/scripter-reader.test.ts` | `2935d3cb5e6b31a07c7c4fce6f87677bad242c961e6e2cb50913f182ec3f7160` |

## Verification

Native validation ran in `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`, a separate working copy under the same Windows account and filesystem/process/network permissions. It is not an OS sandbox. No Docker, Superpowers skill or subagent was used.

- Initial four TDD regressions failed against the original producer/parser/reader, confirming missing catalogs and missing content reobservation.
- Final four-file focused run: **50 tests passed**, exit 0. Files: `scripter-catalogs.test.ts`, `scripter-reader.test.ts`, `browser-session.test.ts`, and `asset-program.test.ts`.
- CLI TypeScript check: `tsc --noEmit -p packages/cli/tsconfig.json`, exit 0.
- MCP TypeScript follow-up found no errors in the owned CLI files; it exited 1 for concurrent, out-of-scope unused `PortalPlan` and `PortalRun` imports at `packages/mcp/test/portal/native-work.test.ts:9` and `:10`. These were reported to the main agent and not edited.
- Owned-file `oxlint --deny-warnings`, exit 0.
- Owned-file `oxfmt --check`, exit 0.

New cases cover 513 styles with zero variables, independent 257-variable/258-collection continuation, missing versus failed versus empty APIs, duplicate catalog/root identities, exact reordered child identities, same-ID node/catalog value changes, bounded second-pass exhaustion, stable content identity across timestamps, earlier-page value loss, actual mode/raw alias preservation, mixed-text variable/style references and cancellation before touching the existing page. Existing browser-session cancellation tests retain the no-additional-transport checks.

The existing editable-text payload assertion was adjusted from 20 KB to 40 KB because diagnostics now count a full final reread plus catalog descriptors. The fixture uses approximately 24 KB; this does not change the shared 12 MB read budget or glyph-outline omission.

## Limits and remaining integration

- The aggregate reader still allows at most 256 logical program calls and 12,000,000 parsed-response bytes, including the second pass. A response is at most 8,000,000 bytes. Root/child identities and catalog enumeration are bounded at 100,000 entries, with 256 catalog rows per page. Existing recursive-value depth, property, array and string limits remain explicit truncation. Native Figma enumeration APIs return their arrays before those bounds can be checked; the application does not claim a memory sandbox around the API itself.
- The reader retains at most 1,024 warning rows while preserving value-loss state and unfinished scopes. Full result bytes can differ from accumulated wire/read bytes.
- Reobservation is a bounded observation of supported read surfaces, **not an atomic snapshot**. `capture.atomic` and observation atomic remain false. Changes after an earlier query's final reread, transient ABA changes, unsupported property surfaces and unsupported remote dependencies are not proof of coherent capture.
- `observation` is raw local collector metadata, not trusted `DesignCollectorEvidence`. Legacy flags and this metadata alone must not authorize current capture acceptance. Task 5.2b must construct source-bound evidence separately, bind tree/catalog reads to asset export and checkpoint reuse, and evaluate required capabilities. No tree-to-export coherence or fresh live C4 acceptance is claimed here.
- `readComplete` requires successful final reread, complete requested catalogs, complete tree scope and no unresolved referenced variable IDs. Legacy `truncated` continues to describe actual value or scope loss; unavailable catalogs additionally carry explicit unsupported/failed statuses. Consumers must inspect the versioned capability contract rather than treating legacy flags as proof.
