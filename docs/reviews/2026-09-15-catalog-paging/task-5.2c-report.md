# Task 5.2c: Independent catalog evidence paging

The main agent implemented the bounded evidence-reader changes in the separate native copy. The qualified-consumer worker owns the coordinated shared input/result schemas and coordinator forwarding, which remain pending. No complete public-route or capture authority claim is made until those changes and tests integrate.

The previous reader rejected every design with more than 256 collections and never delivered style pages. Two new regressions failed with PORTAL_DESIGN_TOKEN_LIMIT before implementation. The reader now independently pages tokens, collections and a requested paint/text/effect/grid style family. Each catalog page preserves complete raw rows, returns its actual continuation and total retained rows, and permits at most 128 rows or 512 KiB of serialized rows. A row that cannot fit alone fails explicitly. Node pages retain their separate 512 KiB bound. Thus the design evidence payload has at most four bounded sections, plus small structural metadata. This is not the total portal_next response budget, which also includes independent source/asset evidence.

The optional final argument is {collectionOffset,styleFamily,styleOffset}; existing tokenOffset remains the preceding argument. All collection offsets are bounded nonnegative integers at the helper boundary. Selected style availability only reports whether the raw family array exists; it is not proof of collector completeness or API capability. Missing differs from observed empty, and a malformed non-array requested family rejects explicitly. The existing signed/raw artifact hash check remains mandatory.

Native verification: six tests pass, including original hierarchy/value/hash integrity and binary submission tests; new tests cover 300 collections, 270 paint styles, independent family/offset selection, byte-sized token continuations, oversized rows, Desktop aliases/modes, missing versus empty, malformed family and negative offset, and retained catalogs exceeding the public 100,000 cursor range. Focused lint and format pass. Full MCP typecheck currently exits 1 only in the concurrent Task4.2b IR optional analysisVersion contract; no owned-file diagnostic. No browser, daemon, build, Docker, dependency, index, commit or push action. Same-account native copy is not an OS sandbox.

## Exact owned bytes

| Path | SHA-256 |
| --- | --- |
| service/packages/mcp/src/portal/design-evidence.ts | f58f449eaae7b0caf291d7841814e2089391f8377d5609011faefe6af3ba6955 |
| service/packages/mcp/test/portal/design-evidence.test.ts | 0891ef706f14a220f933e0d27d593bcff890d25025efe53bcf40d2bb31b17bd8 |
