# Portal activity history

Design and implementation date: October 11, 2026 (Asia/Seoul).

This record supplements [the usage backend](usage-backend.md), [the user guide](../../portal-user-guide.md), [the canonical service analysis](../../service-analysis.md) and [the repository instructions](../../../AGENTS.md). The coordinator owns actual UI/service execution and integration. The backend worker owns managed portal store, contract, server, bridge/control integration and focused tests; the frontend worker owns activity presentation and UI-intent instrumentation.

## Approved-scope API proposal before implementation

- `POST /api/activities` accepts only an allowlisted UI intent with optional workflow/run/workspace IDs and closed metadata. It cannot supply an outcome, authority, request body, path, password, credential, lease, code or requirement text. Existing Host, Origin, Fetch Metadata, CSRF and JSON guards apply. The server assigns source `client`, status `intent`, local-owner/session labels and request identity. Response: HTTP 201 `{activity}`.
- `GET /api/activities` accepts `after`, `limit` (1..100), and optional type, workflow, run, source and status filters. Response: `{activities,nextCursor,hasMore,retention,audit}`. Activity records have sequence/ID/times, type, source, status, actor/session/request labels, optional correlated IDs and closed metadata. No raw headers, arbitrary URL/query, body, file path or text is retained.
- Server-owned workspace/workflow/run/action results are distinct from client intents. A mutation reserves a durable started record before its effect and settles that record afterward. Late/unknown effects retain honest status; activity records do not replace existing service operation proof or run fences.
- Service-origin records describe changes actually observed from service results, including later external-agent results observed on refresh. They do not claim unobserved external tool calls.
- History is bounded to 2,000 records without automatic eviction. Capacity and recording health are visible. New effects requiring audit admission fail before dispatch if no record can be reserved. Existing record settlement, read-only history, cancellation and unknown-outcome inspection remain available; failed audit of necessary cleanup/inspection must be visible rather than blocking that operation or silently claiming complete history.
- UI telemetry covers meaningful commits, not keystrokes or mouse movement. Drag/zoom and draft-field intents are coalesced by the frontend. Failed optional telemetry is visible but does not prevent necessary cleanup or reading results.

## Implemented checkpoint

The managed implementation uses database version 2 and migrates version-1 workflow/run data without discarding it. Each activity has a stable UUID and a monotonically increasing change sequence. Settling a pending server record advances its sequence and `updatedAt`, so an `after` cursor receives the update; consumers upsert by stable ID. Interrupted pending server records recover as unknown without replay. The log session ID is a new random logger correlation ID, never the service's private authentication session ID.

History has a 2,000-record capacity with no eviction. New effects reserve a persisted server record before dispatch. Their completion updates that same record, including at full capacity. Missing capacity or a failed initial write prevents new workspace/workflow/run effects. A write failure after an effect returns `ACTIVITY_WRITE_FAILED` and leaves no false succeeded record. Necessary cancellation, refresh and inspect-only reconciliation remain available with `X-SFP-Activity-Warning`; original run proof/fences remain in force. Failed recording attempts increment visible gap accounting, persisted when storage permits. Existing history remains readable at capacity. No archive rotation or history deletion UI is claimed.

Server-derived activity covers workspace registration, workflow creation/update/validation, run starts/actions, safe rejected requests, connection state changes, capture outcomes, approval waits and service run-state/file-count/issue-count changes actually observed. Unchanged connection polls and unchanged status refreshes do not create noise. An external agent's candidate transition is recorded only when a service result actually reports it. Request-handled success is distinct from service run completion; service observations retain the actual run state.

Strict schemas separate client intents from server/service outcomes. Metadata contains only fixed field names, canonical file/node IDs, validated workflow/run/workspace IDs, counts, enumerated actions/states and safe error codes. Raw headers, request bodies, arbitrary paths/query strings, requirement text, code, passwords, credentials and leases are not activity fields. Repeated unverified rejection categories coalesce into one bounded record with a rejection count and newer change sequence, avoiding unauthenticated traffic consuming the entire activity history. This does not coalesce authenticated user effects or remove older records.

GET filters include `after`, `limit`, type, workflow/run ID, source, status and ISO `from`/`to` timestamps. Pagination applies to the retained records before returning bounded pages. Responses include retention capacity/count/remaining/full/sequence values and audit availability/completeness/error/gap counts. Bootstrap exposes the same activity health. Client telemetry failure can be presented independently of a successful necessary cleanup action.

## Executed checks

The new real-HTTP activity regression failed first at **20:38:21 KST** because the route returned 404. It then passed after implementation. The final unchanged backend run at **20:55:50 KST** passed **65/65 cases**, zero failures and zero skips. Portal TypeScript, scoped lint and formatting passed for all six owned files. This includes the prior 56 first-run/lifecycle/security cases and nine activity cases.

The activity cases exercise version migration, persisted reload, filters and cursor-visible settlement, complete record retention at capacity, settlement at capacity, interrupted-record recovery, unverified-request coalescing, observed external state/file-count changes, unchanged-poll suppression, strict client intent versus authoritative outcomes, synthetic private-header/text exclusion, actual storage faults before and after workspace effects, and read-only unknown-outcome inspection at capacity with its original fence preserved.

Storage faults use only an owned temporary fixture: the existing JSON file is retained under a fixture backup name and a directory is placed at the publication path to make the real atomic rename fail. They do not alter the user's portal store. All tests use controlled service ports and owned local HTTP servers; no actual daemon or source Chrome operation is part of these results.

```text
# Managed service/packages/portal:
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache test/backend.test.ts

# Managed service:
node node_modules/typescript/lib/tsc.js --noEmit -p packages/portal/tsconfig.json
node node_modules/oxlint/bin/oxlint --deny-warnings packages/portal/src/contract.ts packages/portal/src/control.ts packages/portal/src/store.ts packages/portal/src/server.ts packages/portal/src/bridge.ts packages/portal/test/backend.test.ts
node node_modules/oxfmt/bin/oxfmt --check packages/portal/src/contract.ts packages/portal/src/control.ts packages/portal/src/store.ts packages/portal/src/server.ts packages/portal/src/bridge.ts packages/portal/test/backend.test.ts
```

## Frozen checkpoint and remaining work

The six-file checkpoint froze after verification at **20:56:38 KST**, with slice SHA-256 `55f4abd40ff71403c9fe9b67c83dd236ec74cf2d040076ab4cfa0a861a4ba479`. The digest is SHA-256 over JSON of the ordered `{path,sha256}` records below without hash prefixes. The base is the copied verified `935216d1...` portal plus the separately recorded first-run changes. This is a scoped checkpoint, not a new whole-source pass.

| Managed service path | SHA-256 |
| --- | --- |
| `packages/portal/src/contract.ts` | `0f6d0d108a3eca03db0a926468497f865ec4143e1336544f4bfb92c3550f7a02` |
| `packages/portal/src/control.ts` | `b5a91ebce470fba988df4a0a0844156e8c2e758e6c206ebee6e765ab680933d5` |
| `packages/portal/src/server.ts` | `e6505ddd18b999e987bf31b883acb5b9fdf763bd0f73079f9d44513ad6b074ba` |
| `packages/portal/src/bridge.ts` | `9f37bbffc7fef4a13f641ba5f747b5fd84be9e5703834b88f3f9033a4747439d` |
| `packages/portal/src/store.ts` | `d6fcade97b2dc47c4942acb49de4ea2142b13a593aeb1aaab32bb94483af4d28` |
| `packages/portal/test/backend.test.ts` | `a73c333c06bd98ffaa97827e87d9d0a2c4d58344c6c08e4fc7d5a8039cab2aaf` |

Independent review, frontend integration and three actual UI/service runs remain coordinator-owned. Official-MCP settings and the owner's broader request to expose implemented service functions are separate next increments. The private generation driver was paused after read-only inspection, without executing mutations or altering candidate/helper inputs. No source Chrome, daemon restart, dependency install, Superpowers, main/native service edit, commit, index change or whole-suite run was performed by this backend worker. Native tests run as the Windows owner and are not an OS sandbox.
