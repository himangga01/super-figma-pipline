# Task 5.2c independent catalog paging review

## Verdict

Scoped PASS. No actionable defect was found in the two owned changes. This is a review of catalog evidence paging, not approval of unfinished qualified-consumer integration, capture admission, or the whole service.

## Exact scope and integrity

Reviewed the report, owned-file manifest, main-to-validation diff, complete evidence reader, existing Desktop normalization adapter, focused tests, and the current related portal_next input/result schema fields and coordinator forwarding.

| Owned path | Verified SHA-256 |
| --- | --- |
| service/packages/mcp/src/portal/design-evidence.ts | f58f449eaae7b0caf291d7841814e2089391f8377d5609011faefe6af3ba6955 |
| service/packages/mcp/test/portal/design-evidence.test.ts | 0891ef706f14a220f933e0d27d593bcff890d25025efe53bcf40d2bb31b17bd8 |

Both validation-copy hashes match the supplied manifest. Main-copy preimages match the manifest beforeHash values. No owned source or test was changed during review.

## Findings assessed

- Each catalog has its own offset and continuation. A byte-limited page advances by the actual retained row count, preventing gaps caused by a fixed 128-row increment.
- Catalog pages count serialized UTF-8 bytes, including array delimiters and commas, and preserve whole raw JSON rows. A row that cannot fit an empty page rejects explicitly; a later row continues on the next page.
- All applied catalog cursors must be safe integers between zero and 100,000. Catalogs longer than the public cursor range reject rather than becoming partly unreachable. Empty or exhausted pages terminate with null continuation.
- Tokens and collections retain the Desktop normalization adapter's original variable mode values, alias objects, and collection mode IDs. The selected style family is returned without coercion or flattening.
- An absent requested style family reports unavailable; an observed empty array reports available with zero rows. Availability is only raw-array presence and does not establish collector completeness. A present non-array requested family rejects explicitly.
- Existing owner-state artifact lookup and raw checksum comparison remain before JSON parsing and evidence return. Repository artifact reads retain their existing policy and file-size bound. Asset read behavior is unchanged.
- The currently edited shared portal_next input schema exposes the same collectionOffset, styleFamily, and styleOffset arguments with compatible bounds. The result schema accepts the emitted metadata and raw JSON rows. The coordinator forwards these values to the helper. These related worker-owned changes were inspected only; their broader unfinished changes were not certified.

## Verification

Command executed in C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/design-evidence.test.ts --maxWorkers=1
```

Result: one test file passed, six tests passed, duration 1.40 seconds. This includes original hierarchy/value/checksum verification and binary submission checks, large independent collection/style pages, byte-sized token continuation and indivisible row rejection, Desktop raw catalog values, absent versus empty styles, malformed family and negative offset rejection, and excessive retained catalog rejection.

No additional diagnostic was needed. No browser, daemon, build, dependency, Git, Docker, or Superpowers action was performed. The separate native working copy uses the same Windows account and is not an operating-system sandbox. Full public-route execution with the finalized qualified-consumer changes remains a later integration check.
