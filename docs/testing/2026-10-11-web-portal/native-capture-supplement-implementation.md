# Trusted native capture supplement and lookup port

Date: 2026-10-13, Asia/Seoul. Author: SOL delegate. Frozen implementation: four managed source/test files.

The opt-in Chrome capture now exports a native document inside the original coherent capture, retains immutable signed supplemental evidence after confirmed cleanup, and supplies a separate lookup-only native-contour port. The four-file implementation passes 55 relevant fixtures and scoped lint/format. Integration still needs a narrow CLI type bridge, root production wiring, independent review and source-bound release checks. No live supplement was acquired here.

## Baseline, authority and scope

Read-before references: [repository instructions](../../../AGENTS.md), the shared analysis policy, [retained-tab evidence](retained-tab-live-qa.md), [the contour diagnostic review](cdd-residual-renderer-review.md), and the separately frozen native-contour producer report. Reuse this document and verify current source and newer evidence before updating it.

The service binds admitted Figma source observations to owner-state plans, candidate declarations and native validation. This increment supplies trusted supplementary native bytes for contour verification. It does not replace the primary Chrome collector, manufacture collector parity or declare full native acquisition complete.

Root assigned only managed `packages/mcp/src/portal/capture-native-supplement.ts`, its new test, `packages/mcp/src/portal/design-capture.ts` and the narrow associated `capture-coherence.test.ts`. Main/native service source, `index.ts`, NativeWork, producer/shared schemas, compiler policy, live Chrome/runtimes/state, grants, unknown operations and Git were not edited. The initial recorded main/native whole source was `398e26cdf683d8b8a3a25b9ac3f2eaeb9612eb5f9134ccdb5856800685249e16`; subsequent root integration is distinct. Exact file preimages, not a claimed whole check, identify this change.

Producer dependency: the exact twelve-file manifest `538ac2ac4a2d239e38f4f6cca8ae3bf0a52d0720d483babbaa8634738c0fa307`. Its strict scope helper accepts the actual observed full scope and requested node before a plan exists, while full signed-descriptor callers remain compatible. The final regular private fixture contains those twelve exact files plus the supplier overlay. No shared producer file was edited by this delegate.

## Acquisition and persistence

`ExistingChromeDesignCapture` accepts a fourth internal options argument `{ nativeContourSupplement?: boolean }`. It defaults to disabled. Both retained Scripter and page-API coherent ports preserve ordinary callers and existing fixtures; Desktop and official-MCP transports are not granted this capability. Opt-in requires a signed PortalStore and an admitted Chrome session exposing the internal native export method.

Within one existing 300-second coherent-read deadline, the order is: select/ready, before snapshot, primary asset export, native export, after snapshot, coherence comparison, final readiness/schema, and confirmed session cleanup. The native method uses the existing `exportFigmaWebDocument` with the same capture signal/deadline and page/target. Its physical work and cleanup promises are tracked. A swallowed restoration rejection or still-pending source work makes cleanup unconfirmed and prevents another attachment. The native bytes count against the retained attempt byte budget; changed attempts retain orphan bytes and consume the original budget without resetting it.

Only a complete current primary observation with matching before/after content and confirmed cleanup reaches supplement publication. A partial primary capture retains its original result and obtains no accepted supplemental authority. Cancelled, late and cleanup-failed attempts do not return a completed capture. The native export retains `fullCapture:false`; primary raw facts, collector evidence and normalized output remain unchanged.

The actual document is stored separately at the fixed `document.fig` leaf inside the newly secured capture directory. It is not a caller path or a candidate JSON resource. Publication revalidates protected directory/file identity, bounded bytes and the export hash using RepoReader. The document bound is the existing 128 MiB export limit.

The signed `native-contour-supplements/<planId>.json` record binds the exact internal plan ID and canonical content hash of the full `PortalCapturedDesign`, including its raw/content/contract/source/assets/evidence/provenance/full scope/directory/captured time. It also retains actual native hash/size/time, before/after content hashes and the original capture deadline. Record creation is exclusive. No retained supplement is overwritten. Ordered-read evidence explicitly records `atomic:false` and `ordered-read-ABA-and-post-read-changes-unobservable`.

Capture occurs before the coordinator signs a plan and design. Root explicitly approved signing intrinsic capture identity at that stage rather than inventing an owner/workspace or synthesizing an admission. The full actual admission/descriptor is checked at lookup after the signed plan exists. In particular, omitted and explicit Scripter collector declarations both use their actual signed plan admission without changing the primary evidence.

Signed supplemental metadata alone is not an accepted plan or capsule. PortalStore creation is an asynchronous atomic write; a cancellation during a write cannot be described as an OS-atomic rollback. A failed capture can leave retained diagnostic bytes or a private record, but lookup requires the actual completed current signed plan/design to match its complete intrinsic identity. Such orphan evidence is not authority to replay, replace or complete a failed operation.

## Lookup-only boundary

`StoredNativeContourAcquisition(stateRoot, permissions, store)` implements `PortalNativeContourAcquisitionPort.read(request, signal)`. It has no browser, transport, exporter or remote-network capability.

The read path validates a cloned strict request, then retrieves the actual signed current plan and primary design. It requires exact owner, workspace and plan IDs, a complete live owner-state design, exact artifact path/hash/manifest identity, and exact request descriptor equality with the signed plan. `assertPortalCaptureDescriptor` independently recomputes the actual descriptor using that plan's admission. The full JSON `capture.source.scopeId` and its strictly resolved numeric page ID are preserved separately.

The metadata must match the same full intrinsic capture hash, source URL/file identity, full scope, page, before/after content and exact retained primary `capturedAt`. Native time must be finite and no later than primary time; primary time must be finite and no later than now. A newer capture with an unchanged semantic fingerprint cannot reuse the old supplement.

Protected reads resolve only the fixed service capture directory and leaf. Retained directory authority, secure permissions and RepoReader reject path escapes, links/hardlinks, missing files, changed size/hash and substituted roots. After reading, the port rereads the signed plan and design and rejects ownership or record changes. Returned bytes are copied, so a consumer cannot alter the retained buffer. Missing or unproved material fails with the fixed `PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN` code. It cannot trigger an export during profile preparation or registration.

Logical cancellation and the request's remaining original deadline also bound the lookup. A held readonly filesystem/permission promise can settle later, but it cannot deliver a late capsule or perform source work. No original run, lease or grant deadline is renewed by this path.

## Executed verification and preserved failures

- Actual acquisition-before fixture: 11 passed and one failed, exit 1. The new opt-in test showed the original constructor never called the native exporter. This is preserved in `acquisition-before.json`.
- Final focused supplier/capture cohort: **55/55**, zero skips/failures, exit 0. It covers chronological before/export/after/cleanup publication, default disabled behavior, retained changed-attempt bytes and byte budget, original deadline expiry, logical cancellation with a pending physical export, failed session cleanup, swallowed restoration quarantine, and the relevant existing capture/session/failure/descriptor behavior.
- New lookup cases use real PortalStore signatures/CAS and actual file I/O. They cover owner/workspace/plan/full-scope/time mismatches, missing signed proof, a newer equal-fingerprint capture, changed/missing/hardlinked bytes, unsigned metadata edits, ownership replacement during protected read, prompt held-read cancellation, expiry before document access, future native timestamps and immutable record creation. Global fetch is forbidden in these controlled lookup fixtures.
- Scoped lint and format pass for all four owned files.
- The exact producer12 plus supplier4 and the prepared CLI type bridge passes a real native MCP TypeScript noEmit virtual overlay: **1,194 source files, zero diagnostics**. This proof is conditional on that bridge; it is not a passing current managed whole/package assertion.

The tests use controlled VM/transport/export fixtures and injected permission verification. They do not establish actual Chrome native export, actual Windows ACL protection or complete native document decoding. The separately frozen producer's real-document/Chrome evidence remains distinct. No source Chrome, live service state, model-data grant or actual coding/profile operation was used.

An initial after-test used the older fixture's non-portal ID `coherence` for the new strict signed record and correctly failed. Only the opt-in fixture was changed to a valid portal plan ID; ordinary historical tests retain their old fixture identity. Initial typecheck narrowing errors were corrected without weakening runtime guards. Preliminary failure receipts remain private and are not counted as passes.

## Narrow integration prerequisite: module-local CLI type bridge

Importing the existing CLI native exporter into the MCP package exposes browser callback references to `HTMLAnchorElement` and `window`, while MCP typechecks under Node libraries. A trial global DOM reference fixed those names but polluted Node fetch/Response typing and broke two untouched follower-transport Buffer cases. The reference was removed from the final owned source. No follower test or global package configuration was changed.

A concrete prepared file is `.worktrees/_cache/capture-native-supplement-20261013/figma-web-export-proposed.ts`. It adds only module-local type declarations for the browser callback names. Runtime code, exports, guards and budgets remain unchanged. TypeScript transpilation with comments removed produces byte-identical JavaScript, SHA-256 `32721276ecb4c123fbfde47993aeafb0dce714f7705923976c3823bb51beeee6`.

The CLI source was outside the assigned four-file ownership, and root was idle when the scope decision was requested. **The proposed CLI bridge is not applied to managed/Main/native source. Root must approve/apply or own this narrow bridge before package/whole verification.** Its before hash is `f47dbf2c5e482f358fb88912726b36feba1edaf98c9ed194d3fd39cbfca78970`; prepared after hash is `2374462137a7e3856cbb1b364ef17084d763bb274975051acc3a7aee75a01457`. The final private runtime fixture uses the prepared equivalent bridge, and the manifest records this distinction.

## Frozen files and evidence

Private root: `.worktrees/_cache/capture-native-supplement-20261013/`. Frozen manifest SHA-256: `4e51a9b0f426e4f3cbd7db8569bfdadac57c7f0b544cd61448911ec925caf2ed` at `frozen-files.json`.

| File under managed service | Before SHA-256 | Frozen SHA-256 |
| --- | --- | --- |
| `packages/mcp/src/portal/capture-native-supplement.ts` | New | `e3309416718d99facfee87b707cbf07c23f778b42a0c04c1489dfc3fbda42844` |
| `packages/mcp/test/portal/capture-native-supplement.test.ts` | New | `49285a968524e1ca5b8755ba7892961cfa4188ade9b7cd87b8323d7eb65d9e00` |
| `packages/mcp/src/portal/design-capture.ts` | `0db6ee493563dff2b0f34de47fcf7d6c3ececc4065c4a4caf60adb89a5f48c26` | `42d22b1d300455de81aec494df4a713262450fc838172ec4bc4911f1cb21dbe7` |
| `packages/mcp/test/portal/capture-coherence.test.ts` | `e602ea2902939ca1b628eaa4872cfdac3d1c68d1509289b9c69139893224436e` | `6c9ba0df017c048f30c8dbd81dd5e638989f3f662f4c54bd54357a49839bf043` |

| Evidence under private root | SHA-256 |
| --- | --- |
| `acquisition-before.json` | `44481ac036f1a1182e88f6d6ee19d64990dbf4391fe73971993603d0072b83d9` |
| `supplier-final.json` | `7579dbdbf7559b3abcf5c89a860103f0b0894e180254ff877ccd2b10565a69d9` |
| `bridge-equivalence.json` | `3c59de2c708e8df58b163e1618c88f5210c0438ce7b36dafc46af0071b5de902` |
| `typecheck-proposal.json` | `666c6bb22f663bbc330422d14b391dead37a40823572afabb9535bb76c5586a2` |

From native service cwd, use its Vitest binary, the private absolute file filters and `C:/2026_project/super-figma-pipline/.worktrees/_cache/capture-native-supplement-20261013/review.config.mjs` with `--configLoader native`. The five actual test paths under private `service/` are `packages/mcp/test/portal/{capture-native-supplement,capture-coherence,capture-session,capture-failure,capture-descriptor}.test.ts`. Supply a new distinct JSON output path; preserve the final receipt. No installation or build through a managed junction was performed.

## Root continuation and actual limits

Root must resolve the type bridge, independently review the frozen supplier and producer, wire the production capture opt-in and `StoredNativeContourAcquisition` into NativeWork options in its owned index/registration scope, then complete source-bound whole/artifact gates. Only afterward can root collect a genuinely fresh admitted Chrome capture with its native supplement and submit a new bounded candidate/declaration closure for actual profile/semantic/interaction/visual/application acceptance.

No earlier native export, candidate glyph JSON, old plan or later state snapshot can supply the missing new signed supplement. Old failed/unknown jobs, grants, lease/deadline values and original evidence remain untouched. Official MCP live verification remains owner-deferred. No complete frontend or portal acceptance is claimed here.
