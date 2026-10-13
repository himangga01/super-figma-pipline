# Produced dynamic route diagnostic compatibility review

Date: October 14, 2026 (Asia/Seoul). Main/native baseline source is5715ff0b after package configuration member integration; HEAD22517932 and owner indexECC1808 remain unchanged. QA runtime remains d722/7632. Root read the original complete two-file diff and both cleanup revisions. Read [AGENTS](../../../AGENTS.md), [the actual C2 graph](c2-d722-actual-source-graph-20261014.json) and the independent selection review before reuse.

The connection producer emits `DYNAMIC_OR_PATTERN_ROUTE` for eight actual C2 occurrences. The existing exact semantic review allowlist supports other dynamic route tags but omits this emitted tag. The production correction adds that single tag. It does not infer endpoints, clear raw graph diagnostics or establish graph closure. Existing sourceId/index/path/hash/offset/issue matching, unused/duplicate review rejection and conservative retention of every source candidate remain. Byte, parse, inventory, truncation and limit failures remain blocking.

Two new assertions failed before the change with `PORTAL_SOURCE_REVIEW_NOT_BOUND`, then passed after it, with44 historical assertions filtered. Report hashes are7b2b2154 andf06dd6cc. Cleanup changed after those closed passes, so no final all-test run is claimed. R1 lacked guarded cleanup. R2 transferred roots only after the legacy fixture factory completed; Root found its write-failure path could still invoke unguarded cleanup. Both original manifests and bytes are preserved.

Final R3 constructs only the two new fixtures directly under the canonical temporary parent, records guarded identity before writing files, and rechecks parent, prefix, canonical path, physical directory and bigint device/inode before recursive removal. The44 historical factory/cleanup branches remain unchanged. Default/extra fixture bytes and assertion logic remain the same; the assertion suffix is byte-identical to R2. Changed-test lint/format passed. Closed functional assertions were not repeated.

The final freeze `.worktrees/_cache/service-selection-pattern-20261014/frozen-files.json` hashes to `3568cc9446c9edbdc3b436654c7198ae570de7651d1a15b3ea12bd8f154dc76d`. Source files are under that folder's `service/` child.

| File | Before SHA-256 | Approved SHA-256 |
| --- | --- | --- |
| `packages/mcp/src/portal/service-selection.ts` | `14c2c50facfb41c82802df43572221c69be75b7e1f85ad48d3abbaa5ea5a2d1c` | `4c8ec77c46972434c9ea4f5e445f7aa2b89d442d52a129adefd499faa915e20f` |
| `packages/mcp/test/portal/core-recipes.test.ts` | `4829b6b2457cdd4841aae4e373f20150c2345491e74d6a1ccf345e8df3a29b3c` | `42746c63cc8fb7d98135c9339cd6dcd3ac2c2374ad8588a6c73ac146eeaef3e1` |

Root approves only the exact final R3 pair. Affected combined static checks, normal diagnostic catalog generation, R69 registration/build and a fresh current-code compiler/graph proof remain separate gates. This compatibility change cannot satisfy full case operation, design freshness or guarded application. No native approval succeeded; the supported desktop SDK's actual native pipe remains unavailable.
