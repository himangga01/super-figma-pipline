# Final coverage and source integrity

Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3`. All 1,084 manifest files still match their recorded SHA-256 values. HEAD is unchanged. Coverage is the union of actual reviewer records: **1,052 complete body reads and 32 metadata consistency inspections; zero remaining targeted-only or unread manifest files**.

Complete body coverage includes first-party production, tests, scripts, configuration and service documentation. Metadata depth covers generated inventories, dependency locks, release metadata, retained license texts and authority evidence with concrete structural/hash checks. It does not claim line-by-line legal review, dependency implementation review or legal certification. The [manifest](source-manifest.json) defines the boundary; generated node_modules, external upstream checkouts, user data and historical project documents outside it are not a second source tree reviewed exhaustively. Root README/AGENTS/.gitignore supplied repository context; no additional root first-party executable source was found.

## Primary lane coverage

| Primary lane | Manifest files | Complete body | Metadata |
| --- | --- | --- | --- |
| portal | 47 | 46 | 1 |
| analysis | 67 | 67 | 0 |
| platform | 185 | 184 | 1 |
| capture | 399 | 399 | 0 |
| contracts | 262 | 262 | 0 |
| verification | 124 | 94 | 30 |

Round one recorded 760 complete bodies, 84 targeted bodies, 208 unread bodies and 32 metadata inspections in the union. Round two completely read all 292 remaining test bodies (2,681,749 bytes), challenged production findings with rotated full/targeted counterchecks and rechecked all 32 metadata files. A targeted second-round production read remains targeted in its individual report even when round one already read that file completely. This is not a claim that every production line was independently read twice.

## Individual coverage artifacts

| Round / perspective | Records including cross-reads | Full | Targeted | Metadata | Unreviewed |
| --- | --- | --- | --- | --- | --- |
| [round-1-analysis](round-1-analysis-coverage.json) | 89 | 69 | 6 | 1 | 13 |
| [round-1-capture](round-1-capture-coverage.json) | 411 | 238 | 10 | 1 | 162 |
| [round-1-contracts](round-1-contracts-coverage.json) | 286 | 227 | 12 | 1 | 46 |
| [round-1-platform](round-1-platform-coverage.json) | 185 | 102 | 82 | 1 | 0 |
| [round-1-portal](round-1-portal-coverage.json) | 63 | 48 | 13 | 2 | 0 |
| [round-1-verification](round-1-verification-coverage.json) | 124 | 94 | 0 | 30 | 0 |
| [round-2-analysis](round-2-analysis-coverage.json) | 112 | 89 | 23 | 0 | 0 |
| [round-2-capture](round-2-capture-coverage.json) | 120 | 111 | 8 | 1 | 0 |
| [round-2-contracts](round-2-contracts-coverage.json) | 78 | 61 | 17 | 0 | 0 |
| [round-2-platform](round-2-platform-coverage.json) | 81 | 55 | 24 | 2 | 0 |
| [round-2-portal](round-2-portal-coverage.json) | 57 | 50 | 7 | 0 | 0 |
| [round-2-verification](round-2-verification-coverage.json) | 62 | 24 | 4 | 34 | 0 |

Individual records can overlap and include supplemental documents; summing their row counts is not a unique-source count. [coverage-summary.json](coverage-summary.json) retains the manifest path, primary lane, digest, final depth and contributing coverage records for every source file. [Explicit closure assignments](round-2-closure-assignments.json) retain the first-round gaps rather than rewriting them as earlier full reads.

## Actual verification limits

The main session independently traced accepted findings and counterexamples in [main-verification-notes.md](main-verification-notes.md). Read-only Python/PowerShell/Git parsing, hashing and document checks were performed. No test, build, installation, repository helper, browser, daemon, native fixture or live Figma/service acceptance was executed. Test assertions inspected are not passing test results. No Docker or substitute isolation environment was used. A future separate native working copy retains the Windows owner's filesystem privileges, process namespace and network access; it is not an OS sandbox.
