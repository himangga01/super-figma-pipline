# Produced pattern-route diagnostic compatibility

Date: October 14, 2026, Asia/Seoul.

This bounded implementation follows the current C2 evidence in [c2-d722-actual-source-graph-20261014.json](c2-d722-actual-source-graph-20261014.json) and the execution history in [cdd-current-public-journeys-20261013.md](cdd-current-public-journeys-20261013.md). It changes only the existing source-selection module and its existing core-recipe test file in an owned regular validation copy. Main, native runtime, QA state, Chrome and source acquisition were not changed by this task.

## Baseline and purpose

The source copy started from the owner-reported source `eeef1b0da0f5c05e083ecfa43c8ddb37edc2228ca526538a75857277040fa876`. Both exact file preimages were checked again against the native source before freezing. The actual QA runtime remained `d722c32152149464c961c660622a95e3da603eb00f291e28b15c024507bcd87d`, with build identity beginning `7632acd6`. Current genuine C2 analysis reported eight `DYNAMIC_OR_PATTERN_ROUTE` occurrences among its 77 unresolved service connections. Its full service selection and frontend acceptance remain incomplete.

The source-selection layer accepts exact owner-reviewed semantic uncertainty and conservatively retains every potentially relevant service. The producer emits `DYNAMIC_OR_PATTERN_ROUTE`, while the existing reviewable set included `DYNAMIC_ROUTE` and `DYNAMIC_HTTP_ROUTE` but omitted that actual producer tag. Consequently, an otherwise correctly bound review was rejected as unused.

## Implemented change and retained boundaries

The sole production change adds `DYNAMIC_OR_PATTERN_ROUTE` to the existing reviewable set. The matching algorithm, graph interpretation and closure traversal are unchanged. Every review still binds the source ID, source index, path, file hash, offset and issue tag. Unused reviews still fail. A reviewed uncertain route retains all source candidates, including candidates outside the initially selected service.

The change does not extract an endpoint, rewrite a graph-completion flag or remove the original diagnostic. Incomplete byte inventory, truncated diagnostics, parse errors and byte-limit errors keep their existing blocking behavior. A complete conservative service selection is distinct from a complete raw graph and from live design or full portal acceptance.

## Verification executed

Two new tests were inserted into `packages/mcp/test/portal/core-recipes.test.ts`:

- The real source-graph producer analyzes an Express parameterized route and emits the actual tag. An exact review then retains every service candidate while preserving the original incomplete graph and connection diagnostics.
- Data-level negative cases reject a changed source ID, index, path, hash, offset or tag and an unused duplicate review. Incomplete inventory, truncated diagnostics, parse errors and byte-limit errors remain blocked.

Before the one-line production change, both selected tests failed with `PORTAL_SOURCE_REVIEW_NOT_BOUND`. After the change, both passed with zero failures. The 44 other tests in the file were filtered and were not rerun. No installation or build was performed. Dependencies were copied into the owned regular project; the project did not execute through a managed node_modules junction.

The initial fixture load failed before any test because package-local dependencies were missing. That separate loader failure is preserved as `loader-r1-failure.json`; copying the existing package-local dependency links into the owned project corrected the fixture. It is not counted as the behavioral fail-before evidence.

Final whitespace formatting occurred after the two passing tests and is explicitly recorded in the freeze. The production diff remains exactly one set entry, and a mechanical removal of the two inserted tests recovers the exact original test bytes. Root owns the subsequent combined static checks and integration review. No full-file, whole-project, browser, native source or live acceptance test was performed for this task.

## Frozen inputs and handoff

Frozen manifest: `service-selection-pattern-20261014/frozen-files.json`, SHA-256 `8536900f719685aa96bf16ef9fafb94b47ca2215219dbbbe7ec8763d74a492eb`.

| File | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `packages/mcp/src/portal/service-selection.ts` | `14c2c50facfb41c82802df43572221c69be75b7e1f85ad48d3abbaa5ea5a2d1c` | `4c8ec77c46972434c9ea4f5e445f7aa2b89d442d52a129adefd499faa915e20f` |
| `packages/mcp/test/portal/core-recipes.test.ts` | `4829b6b2457cdd4841aae4e373f20150c2345491e74d6a1ccf345e8df3a29b3c` | `99f9866ba8de87a144002a7485ffff1b564ae2a3f21402fe4229672dded67ba4` |

The implementation reviewer received the exact frozen two-file closure. Root must integrate those exact bytes and finish the affected static checks before counting the compatibility repair as released. New genuine pipeline results must separately establish the current source-bound service-selection outcome. Historical C2 and C3 false-completion fields remain unchanged.

There is no new product-scope decision in this patch. The remaining live blocker is the actual Chrome native approval gate. The current five C2 configuration diagnostics and other source-review occurrences are separate work; this tag addition does not waive them.

## R2 cleanup-only review correction

The independent reviewer approved the semantic change but found that the two new fixtures inherited the historical unguarded recursive cleanup. R1 remains preserved as manifest `8536900f719685aa96bf16ef9fafb94b47ca2215219dbbbe7ec8763d74a492eb`, together with restored, mechanically hash-verified R1 source bytes and the original fail-before/pass-after reports.

R2 gives only these two new roots a separate lifecycle. Their wrapper removes them from the historical cleanup list. Before deletion, it verifies the canonical temporary parent, expected prefix and canonical path, a physical directory without a symbolic link, and the retained exact bigint device and inode identity. The historical fixture cleanup branch remains unchanged.

The first cleanup-only lint run rejected standalone Vitest assertions in the cleanup callback and reported naming/sorting warnings. The guards now use Node assertions, a distinct fixture variable and nonmutating sorting. The changed test file passed scoped lint and format checks with exit zero. The two previously passing functional tests were not repeated. Their assertion logic is unchanged; the guarded cleanup itself has not been re-executed. Root owns the final combined type/static validation.

Final R2 manifest SHA-256: `463578d24c04f18b8e3959f78038c936e27acf27dbd554ee6ef004865e4404fa`. Production remains exactly `4c8ec77c46972434c9ea4f5e445f7aa2b89d442d52a129adefd499faa915e20f`. The existing test file is now `91c7cfdc533cc1bc8fcf8104eb3dcce04c27dc7fdf07dd435a93936b1bb57908`; its original preimage remains `4829b6b2457cdd4841aae4e373f20150c2345491e74d6a1ccf345e8df3a29b3c`. This supersedes the R1 test byte hash for integration, without superseding its actual executed results.

## Final R3 fixture-creation failure path

Root found that R2 called the historical factory before removing its root from the historical cleanup list. A file-write failure inside that factory could therefore still reach unguarded historical cleanup. R3 constructs only the two new fixtures directly under the canonical temporary parent. It validates and registers the private exact directory identity before writing any fixture files. It never calls the historical factory or registers a new root in the historical cleanup list.

The default three file contents and each test's extra files are identical to the earlier fixtures. The entire test assertion suffix is mechanically byte-identical to R2. The guards recheck the current canonical temporary parent, path, prefix, physical directory type, absence of a symbolic link, and retained bigint device and inode before recursive removal. Historical fixture branches remain unchanged. Creation or write failure cannot transfer a new root to their cleanup.

R3 changed-test lint and format checks passed with exit zero. The two closed functional passes were not rerun. The revised fixture lifecycle has not been executed; its review and Root's combined static checks remain distinct from the preserved functional results. R1 and R2 manifests and exact historical source bytes were retained and hash-verified.

**Final integration input:** manifest `3568cc9446c9edbdc3b436654c7198ae570de7651d1a15b3ea12bd8f154dc76d`; production `4c8ec77c46972434c9ea4f5e445f7aa2b89d442d52a129adefd499faa915e20f`; existing test file `42746c63cc8fb7d98135c9339cd6dcd3ac2c2374ad8588a6c73ac146eeaef3e1`. Root and the independent reviewer received this exact two-file closure. R3 supersedes R2 for integration only, with no new live or full-graph acceptance claim.
