# Pure compiler lookup initialization: independent repair review

Date: October 13, 2026, 10:07 KST. Reviewer: Root. Author: `server_diagnostics`. Main baseline is `22517932dc9b2cb974c177ec4eacb84d4b16e254` with uncommitted work. Follow [AGENTS.md](../../../AGENTS.md), the shared analysis policy and [canonical analysis](../../service-analysis.md).

**The exact import-only R2 repair is approved and integrated.** Whole `c767a7fd-75d7-4ed4-97e5-12fb953f597c` genuinely failed its existing fresh-process test because pure module resolution imported the compiler lookup, which eagerly initialized native artifact/module/runner code. This is distinct from the other four stale source-tool census assertions.

R1 was preserved after Root found that its external candidate had been formatted with different defaults, producing a broad quote/arrow change. R2 uses the actual repository configuration. Root inspected the normalized diff: four eager import declarations are removed and equivalent runtime imports occur inside the existing asynchronous preparation, capture and verification functions. Private issuance maps and pure lookup identity remain unchanged. No public stamping function, caller-JSON proof or test-hook relaxation was introduced.

| Binding | SHA-256 |
| --- | --- |
| Original `react-router-compiler-evidence.ts` | `c17c1a3bc0d37c6ef32c9feb0d1360c5b38abcc84e8e9fdbe298f1481b5ea12d` |
| Integrated R2 file | `829200906970fa63c18f5fe89f03489d38faf55ceeeac65592bb0308e4d321b9` |
| R2 freeze manifest | `3468fa432918f4acd5d152c02dba01d02dd8b7d8abe3ce5d4eb0bd64fbed065e` |

The author's selected fresh-process case passed with twelve other cases filtered out. Root instead ran the complete three-file cohort from the native working copy: `package-config-evidence.test.ts` (13), `module-resolution.test.ts` (110), and `react-router-compiler-evidence.test.ts` (6). **All 129 passed, zero failed or skipped**, exit zero. This includes the unchanged strict fresh-process guard and an actual native fake-build refusal. Full formatting, Knip and offline upstream verification also passed after the combined repair. [The integration receipt](pure-import-r2-integration-20261013.json) records the exact one-file overlay; its original pending-cohort field describes the time it was written and is superseded by this executed review.

Root also repaired the four source-tool census tests, with forty focused cases passing. [R22 provenance](whole-c767-r22-provenance-20261013.json) covers the combined current source: 246 semantic changes, four derived authorities, unchanged owner index and Main/native fingerprint `sha256:db69ea3b1fa4363176712640af1a7e733706ce09542406fe18fc84b6c81f2f0a`. A first manifest-verification command was rejected for an unsupported `--index` argument before writing; the valid command then wrote and verified the alternate-index manifest. No failed whole or focused revision was relabeled as passing.

A fresh whole is now running for db69. These scoped/source results do not establish artifact completion, QA deployment, actual C2 HTTP/native compilation, new native-geometry authoring or frontend application. Those separate tasks remain open; the live QA backend still has the earlier a476 release loaded. Native execution uses the same Windows account and is not an OS/process sandbox.
