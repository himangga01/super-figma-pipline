# Explicit generated route type suffix review

Date: October 14, 2026, 05:46 KST. Main HEAD is `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with retained working-tree changes. Main/native source baseline is `sha256:98951f61446ee19454d9d51a22b7d71cad50aabb976352d38854e5d1e71e84b1`; the active QA build remains d722/7632. The owner index is unchanged at ECC1808. Read [AGENTS](../../../AGENTS.md) and [the continuation report](../../analysis/c2-c3-continuation-20261013.md) first.

## Finding and approved change

Actual Epic source imports `./+types/root.ts` and `./+types/index.ts`. The protected generated-type branch accepted extensionless and `.tsx` imports, but not `.ts`. Its target construction also appended `.ts` to a target that already had that suffix. These are concrete resolution defects in the same supported generated type path.

Root read the complete two-file diff. The correction accepts the explicit `.ts` suffix and retains it when constructing the exact generated member. The existing type-only, compiler admission, source/inventory identity, rootDirs, unique member and original deadline checks remain. Runtime, mixed runtime/type, dynamic, foreign, absent, ambiguous and unconfigured imports still fail admission. Configuration classification from the earlier repair remains unchanged. No inventory member, review waiver or live authority is manufactured.

Frozen manifest: `.worktrees/_cache/c2-c3-implementation-20261014/c2-explicit-route-type-repair-r1/frozen-explicit-ts-repair.json`, SHA-256 `2a1cfd82299fe52ea0eaaa8cc13de336d68dadeff91a7096bd36539c31801d06`.

| File | Before SHA-256 | Approved SHA-256 |
| --- | --- | --- |
| `packages/mcp/src/portal/module-resolution.ts` | `bb63d231502c716409dffd731c7e17078ba2fcd8f361711b322dd4e6072144bd` | `e9b07c18cc5b1ea17a6778cc7c0dd8be76a2d75168460364c4e28535c1e89250` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `fb442e930b793a7673a4e04232cd5f36b7fd8b68c6bd847846a4a3241e6d7538` | `2efc994f88c057aebb7373837512289adace0f2d31d1ba5e4e0ed495a8315c15` |

## Evidence and limits

The two new assertions passed, zero failed, with 115 historical cases filtered. Their report hashes to `0342d9351174111ceb9a65a501cedf41b074c34b69c332a4e1bec9a036773916`. Admission is an explicit fixture spy, so this does not issue native compiler authority. The first isolated setup attempt reached zero assertions because its package dependency junction lacked `oxc-parser`; the corrected setup and actual executed assertions are recorded separately. Exact two-file lint and format checks passed. Historical passing cases were not repeated.

Root approves only this exact two-file change. Integrate Main/native source with held-file and index checks; leave compiled QA artifacts and active C2 issuer unchanged until the current source preparation and graph operations settle. Affected static checks, provenance and packaging are separate gates. Actual CDD/C2/C3 live capture, guarded application and complete acceptance remain pending behind the recorded Chrome approval failure.
