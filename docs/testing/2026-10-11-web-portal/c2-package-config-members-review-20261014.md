# Admitted package configuration member review

Date: October 14, 2026 (Asia/Seoul). Main HEAD22517932 retains owner changes; Main/native baseline source is `sha256:eeef1b0da0f5c05e083ecfa43c8ddb37edc2228ca526538a75857277040fa876`, after intermediate R68 registration. QA runtime remains d722/7632. Root read the full two-file diff, opaque capture accessor and graph/connection call chain. Read [AGENTS](../../../AGENTS.md) and [the actual C2 result](c2-d722-actual-source-graph-20261014.json).

## Finding and correction

Module resolution consumes protected package `extends` configuration through an opaque admitted capture. The connection analyzer receives only source text and hash-only source inventory members, so the same configuration has no member and emits `CONFIGURATION_SOURCE_MISSING`. The earlier generated-route target correction does not address this package configuration input.

The approved change adds configuration members only from the existing private capture accessor, which binds the exact full source text map and inventory paths. Each member requires a unique package configuration metadata match for path, content checksum and byte count, an existing owner manifest/service and no case-folded source/member collision. Invalid metadata produces a hard diagnostic. These inputs remain configuration data; no runtime module or source inventory entry is added. Existing sourceHash construction includes the protected package evidence hash, so the public schema is unchanged. Ordinary missing/unadmitted configuration remains blocking. Runtime, issuer and deadline guards remain unchanged.

Frozen manifest `.worktrees/_cache/c2-c3-implementation-20261014/c2-package-config-members-repair-r1/frozen-package-config-members.json` hashes to `be91a8a67d8ae5d37ed014872cb371798bf0a5912a4fdd359b167e5fbf0e6a65`.

| File | Before SHA-256 | Approved SHA-256 |
| --- | --- | --- |
| `packages/mcp/src/portal/service-graph.ts` | `ec6a6f1a6c36873b64aa701ae2b4b1caf67f051bf090d4da3c8b47d745b6e43e` | `e3a725707655e699e987b41e1c342a9c119c428a802963f5624f0eb9c4d10f7c` |
| `packages/mcp/test/portal/service-graph.test.ts` | `1d7ffde27e28beb59da91172b06e2d2a137d2b815a0a340f2972ad329dd6d9cc` | `a4d238f8053115a687c5c045eee3fb9ed8995ed50cda19d2a55d5955c6be3bc8` |

## Verification and limits

Two new assertions passed across preserved distinct reports. The original report95509c28 retained a passed negative and failed positive because the test expected a public packageConfigEvidenceHash field that does not exist. The corrected positive asserts the actual sourceHash construction and passed in report28c96c3f. Only that failed assertion was rerun;16/17 historical assertions remained filtered. Exact two-file lint/format passed. Tests use an explicitly synthetic artifact authority and do not issue native production authority. Guarded temporary cleanup checks canonical path, expected parent/prefix and filesystem identity.

Root approves this exact change for Main/native source integration. Affected static checks, generated catalog registration, final provenance/build and actual current-source C2 graph consumption remain separate gates. The connection/member fixture does not prove full graph closure, Figma capture, coding lease, generated case operation or guarded application. Chrome approval remains unavailable to click; no approval or live acceptance is inferred.
