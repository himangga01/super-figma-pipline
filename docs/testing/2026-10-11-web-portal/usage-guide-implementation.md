# Portal usage guide, guided draft setup and activity view

Date: October 11, 2026, 20:57 KST. This bounded frontend increment was prepared in `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`. Its starting portal snapshot was copied by the integration owner at 20:00:59 from source epoch `935216d1aadd504a3e3e1757fde2f7c5056329cdb76220730a64a2522aa184dd`. The native portal, its served port 4310, daemon, Chrome source session, dependencies, Git index and generated provenance were not changed by this frontend author.

Read this alongside the [web portal plan](../../plans/2026-10-11-service-web-portal.md), [canonical service analysis](../../service-analysis.md), [practical usage guide](../../portal-user-guide.md) and the backend/real-UI execution reports in this directory. This is implementation and focused verification evidence, not the owner's requested three real functional rounds or complete exposure of every service function.

## Implemented behavior

- A persistent Korean usage-guide entry opens a native accessible dialog, including during initial connection failure. It explains workspace registration, Figma URL/node versus output folder, the current five-stage flow, cases, explicit save/check/start, service approvals versus native Chrome Allow, unresolved or unknown states, and coding-agent handoff. The input checklist describes field readiness rather than capture or validation success.
- Guided setup uses ordinary fields for workspace, URL/node, case, target/reference folders and requirements, roles, states, routes, API/data contracts and explicit confirmation. New workflows remain unsaved drafts. Existing requirement IDs, other requirements and untouched contracts/evidence are preserved; switching requirements while editing asks the user to apply the draft first. Technical IDs and contracts are available in a disclosure. The registration form uses the actual backend registration response rather than optimistic success.
- Pending-decision review uses only the selected run's complete, appropriately live-verified `workflowCoverage`, its analysis hash, actual unresolved evidence IDs and existing required confirmed requirements. Supported choices are `implement`, `reuse`, and `extend`. Explicit choices and rationale are staged in the draft only. Saving and a new run remain manual; the existing run is not replayed. Incomplete, missing, ambiguous or stale evidence remains unavailable.
- Normal coding handoff provides the retained service run/workspace and the target bound to that run's context. An external agent obtains and submits its lease through its own same MCP/CLI connection. Web context/submission is marked advanced and limited to the same web connection. Local three-second polling does not claim to refresh externally changed service state; the user requests service status explicitly.
- The activity view reads persisted records and supports timestamp, action, workflow, source and status filters, pagination and safe identifier details. Stable record IDs are upserted when a started server record settles with a later change sequence. Viewing records preserves unsaved workflow changes. Client intents are visibly distinct from authoritative server/service results.
- Client telemetry records guide/setup, draft field presence, navigation, node/edge changes, debounced zoom, save/start/action intents, decision staging and errors. The fixed metadata allowlist excludes raw field values, local paths, descriptions, tokens, headers, passwords, leases and code. Only validated canonical Figma file/node identifiers are extracted from a URL. Queued intent delivery is bounded and serialized; unavailable/full audit storage produces visible warnings without replacing successful service results or blocking cleanup/draft work. The transport surfaces the backend audit-warning response header.

## Frozen owned paths

All paths below are relative to the managed service root. SHA-256 values were captured after final scoped verification.

| Path | SHA-256 |
| --- | --- |
| `packages/portal/web/app.js` | `d1e6e139c823af7896f9b35f49376aef20f7ed8b13590de32302bb6515c98935` |
| `packages/portal/web/styles.css` | `acd5fdd09cf1ba483d50876bd42c46856ade1a41ecd510b293323e438cecbbb7` |
| `packages/portal/web/model.js` | `a47a354624735951ae1ba6ca7cd54272890d6c0ffa8244bfd7e75a778cb72709` |
| `packages/portal/web/index.html` | `412a66ea1bca0396e3105f37635ad7973510b657e2549aac1337d03f2dfcd690` |
| `packages/portal/web/api.js` | `60875039c613958dfcc27210f8ae8d8227addca63ad9208fe2003a07ec0e5a5f` |
| `packages/portal/web/tests/model.test.mjs` | `16eff6ffa1069d9150fd050d949253bd791d28b82ca98e8798bd4ec67f46ee91` |
| `packages/portal/web/tests/api.test.mjs` | `293fa2d08fed0c03318bbbb973f76f57143ce875256916fcf2ae41fb8ab5ef0f` |

## Executed verification and limits

At 20:57:20 KST, direct installed Vitest invocation from the managed `packages/portal` directory, `run --config vitest.config.ts web/tests/model.test.mjs web/tests/api.test.mjs test/browser.test.ts --no-cache`, passed 21/21 tests across three files. The existing browser suite uses service-owned installed Google Chrome and fixture backend inputs. These two browser cases are not real Figma/service functional rounds. The model/API regressions cover draft preservation, invalid input rejection, unavailable workspace statuses, missing/incomplete/stale/foreign decision evidence, exact manual decision binding, privacy allowlisting, settlement upserts, audit warnings and retained-run handoff targets.

Direct installed Oxlint with `--deny-warnings` passed the five owned JavaScript/test files. Direct installed Oxfmt `--check` passed all seven owned files. `node --check packages/portal/web/app.js` passed. The first test invocation from the service root with a package-relative configuration found no tests; rerunning from the package's actual root resolved the invocation error. Initial lint warnings were corrected before the final pass. No installation, build, whole check, live source capture or real UI/service acceptance was executed by this author for this increment.

The integration owner retains responsibility for backend integration, matching API authority, native mirroring, final source provenance/build and three real UI/service rounds. The actual complete fresh CDD plan prepared by the owner at 20:06 has eight unresolved scopes; it was inspected only for shape and is not auto-imported or auto-confirmed by the frontend. Its earlier incomplete run remains unavailable for confirmation. Source-fixture success cannot establish code generation, application or runtime acceptance.

## Immediate continuation

The owner expanded the product requirement to expose all implemented public service functions. The authoritative inventory at `docs/analysis/portal-feature-inventory.json` records 128 registered MCP tools and 56 public CLI feature branches with overlap. Complete exposure is still pending. The next frontend increment will add an extensible navigation/view boundary for service-function schema forms, connection settings and administration, using actual backend capabilities and clear prerequisites. In particular, plugin-dependent writes must not be labeled Chrome-only reads. The independently owned Figma settings module and its actual probe/save APIs must be integrated before connection success can be reported. No saved setting alone proves connection or complete capture.

### Freeze correction

Before integration, source readback found that the shared render path called the builder-only canvas binder on the activity view. The binder now returns when no canvas exists. A Korean activity-warning label damaged by shell pipe encoding was also corrected. The final app hash above supersedes the initial freeze, and the same three-file suite passed 21/21 again at 20:57:20. Existing Chrome fixture cases do not exercise the new activity view; its actual interaction and persistence remain part of the owner-run real UI rounds.

## Registered service-function and settings frontend increment

Date: October 11, 2026, 21:19 KST. After the coordinator copied the first frozen increment to main/native at 21:00, editing of managed `app.js`, `api.js`, `model.js` and `styles.css` was released for the next increment. The coordinator approved new `web/service-functions.js`, `web/schema-form.js` and related form tests. The independently owned `web/figma-settings.js` is not included in this author's hashes or ownership.

### Implemented frontend behavior

Persistent navigation now exposes service functions, connection settings and administration alongside builder, run and activities. Connection settings dynamically mount the independently reviewed module with its exact API contract. Explicit application of a saved official endpoint changes only the unsaved workflow draft, clears the Chrome collector field and does not save or run it. View cleanup and asynchronous mount identity prevent a late module load from replacing a different view.

The service-function catalog consumes the actual backend descriptors, preserving `tool:name` and `feature:name` identities and declared aliases. It does not hardcode a selected subset. Search, grouping and transport filters retain all supplied records. Tool and CLI branch counts are displayed separately because aliases overlap. Administration uses the same authoritative feature forms, initially filtered to public CLI feature branches, with other transports still available.

Common JSON Schema inputs use controls for strings, numbers, integers, booleans, enums, constants, nullable or other explicit alternatives, nested objects, typed dictionaries and repeatable arrays. Optional properties remain omitted until included. False, zero and explicit null retain their actual types. Tagged object alternatives have readable discriminant labels; workspace-ID fields offer registered-workspace choices. Known local field constraints produce feedback, while the server remains the authoritative complete validator. Truly unstructured/unsupported complex fields use an advanced JSON disclosure. There is no schema execution or external-resource import.

The user explicitly selects a workspace and service target, reviews the concrete request and manually sends it. Declared prerequisites distinguish Desktop/plugin-dependent editing from Chrome reading. Retained jobs show actual status, operation IDs, safe approvals, enabled action descriptors and disabled reasons. Unknown outcomes instruct inspection without replay. Job approval/rejection/cancellation/inspection is manual and uses the recorded job and approval IDs. No catalog request is labeled overall generation or acceptance success. Function inputs are debounced into safe named-function presence events; raw arguments are never sent as activity metadata, and unrelated catalog operations do not inherit the displayed workflow's IDs.

### API dependency and verification limits

The agreed backend boundary is `GET /api/service/catalog`, `GET/POST /api/service/jobs`, `GET /api/service/jobs/:id`, and `POST /api/service/jobs/:id/actions`. Catalog descriptors contain name, kind, group, input schema, prerequisites, confirmation flag and optional `aliasOf`. Create requests contain `{type,name,args,workspaceId,targetSelector}`. Target selectors are explicit `none`, `active`, `session`, `stable-file` or `portal-source`; actual session IDs or file identity hashes must be supplied. Actions use `{action,approvalId?}` and are exposed only when the backend descriptor marks the action enabled. Backend implementation and live contract acceptance were still being prepared independently when this frontend was frozen. No successful invocation of the complete runtime catalog is claimed here.

The source-bound inventory inspected for preparation contains 128 registered MCP tools and 58 public CLI branches. Inventory SHA-256 was `296912e7698087bfe0c0a7b29f33ea7c26186059f7c4e1bef416036ac3386c05`, recording source epoch `935216d1...`. An ephemeral loopback Chrome DOM preparation rendered all 128 tool schemas, then iteratively included ordinary optional fields; both passes reported 128 rendered, no errors and no initially rendered advanced JSON fields. This checked form construction for that snapshot only. It did not fill every alternative/list item, invoke tools, verify the runtime catalog, or validate the 58 CLI schemas that the backend will provide.

The first real Chrome DOM serialization regression failed at 21:06:59 because an array pair's inherited `entries` method was mistaken for the internal dictionary-entry marker, dropping required fields. Checking an own marker corrected the serializer; the same regression passed at 21:07:15. The final four-file scoped run at 21:22:54 passed 30/30 tests: model, API, schema forms and the two existing portal Chrome fixtures. The new form fixture used an owned installed Google Chrome session and loopback-only page, exercised omitted optional values, nested lists, an empty dictionary, typed numeric dictionary values, explicit null defaults and false/zero preservation. These three Chrome fixture cases are not three real functional rounds. Oxlint passed all eight owned JavaScript/test files, Oxfmt passed nine files, and the app/schema/catalog modules passed Node syntax checks. Dependencies, source Chrome and the daemon were not changed.

### Second frozen hashes

Paths are relative to the managed service root. These supersede the first increment only for the listed files; the original index/API-test hashes remain unchanged.

| Path | SHA-256 |
| --- | --- |
| `packages/portal/web/app.js` | `59857d5724e82a6f26201432e1cd18a430a2d9b55a39c47328433c843114033c` |
| `packages/portal/web/api.js` | `ca48afaa74f8cd025cadc898ed8a71c73c3b072c5d8c4947843f23d9a2354605` |
| `packages/portal/web/model.js` | `4be8488eb188ec799c4264aa78596dd8dd005173d185ff0ba831bad3b11190b4` |
| `packages/portal/web/styles.css` | `47267a7738904f221ad77e0d1d18463d7b268a310735ab026388cbd8d8262b8a` |
| `packages/portal/web/schema-form.js` | `f2d65468647aa10e92d86cff7b357439b35dd65d9b4d1b491d693201969ba8ea` |
| `packages/portal/web/service-functions.js` | `b88a19d84fd8cea8de71973c1207bf422d239f483c50c8d6b278d2bd2c341b6b` |
| `packages/portal/web/tests/schema-form.test.mjs` | `717e277b575641c50be99d4cb13cc4f4cb3df4bbeee878c60bcce76a038dea52` |
| `packages/portal/web/tests/model.test.mjs` | `cf5176d70c1534d55909daa6db93bb54a20819b409c9d679564684776c2eee29` |

The coordinator owns static/public asset admission and package distribution wiring for the three new runtime modules, backend contract integration, current-source verification and real UI/service rounds. Complete all-function availability, dedicated Chrome/Desktop connection interaction and end-to-end code implementation remain pending acceptance; a successful guide/form fixture is not substituted for them.

### Final contract/freeze recheck at 21:23

The backend confirmed `outputHash`, `outputBytes` and `outputUnavailable` (fixed `RESULT_NOT_RETAINED_AFTER_RESTART`/`RESULT_LIMIT` codes). The frontend displays the missing-response limitation explicitly, preserves recorded status and never replays an operation to reconstruct output. Portal management confirmations and original service approvals are labeled separately. The owned Chrome fixture now also proves that previewing a function sends no invocation, explicit request preserves exact arguments/target, a disabled inspection action is absent, both tool/alias entries remain visible, and unavailable output remains visible. A test-harness dynamic import was initially transformed by Vitest into an unavailable SSR helper inside Chrome; moving the fixture imports into its actual browser module script corrected that harness failure. The final current four-file run passed 30/30 at 21:22:54. The hashes in the second table are final; all frontend paths are held for integration/review while the author switches to read-only collector diagnosis.

### Pending-job request preview follow-up

The backend added memory-only `requestPreview` for active jobs so a local approval can review exact original inputs after a UI reload. The catalog now displays that actual object with DOM `textContent`, without activity logging or persistence. Final catalog hash is `b88a19d84fd8cea8de71973c1207bf422d239f483c50c8d6b278d2bd2c341b6b`; the other seven frontend hashes remain unchanged. Scoped lint, formatting and syntax checks passed. No additional Chrome was launched for this small follow-up because the owner now requires coordinated use of the single visible portal window/tab. Its live interaction remains an integration check.
