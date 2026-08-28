# Super Figma Pipeline v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Every behavior change follows RED → GREEN → REFACTOR. Each Task ends with an independent spec review and an independent code-quality review before commit.

**Goal:** 원본 세 OSS를 변경하지 않고 새 `service/`에 Figwright의 전체 기능과 Rust/figmosha 고유 안전 기능을 합쳐 secure Desktop local connector, grounding snapshot, export/doctor CLI를 갖춘 standalone v0.1 서비스를 만든다.

**Architecture:** Figwright TypeScript monorepo를 standalone service baseline으로 vendor하고, MCP·CLI·follower의 모든 tool 실행을 하나의 typed policy/execution pipeline으로 통과시킨다. Rust와 figmosha2에서는 중복 server를 가져오지 않고 deterministic token/PDF export, progress, doctor/error-hint/target UX를 source attribution과 함께 흡수한다. Auth·operation journal은 owner-only service state에, source scan·snapshot·export는 user-approved workspace에 분리한다.

**Tech Stack:** Node 24, pnpm 11.24, TypeScript 6 strict, MCP server v2, Zod 4.4.3, MessagePack, ws, Vue 3/Vite, Vitest, `happy-dom` 20.11.11, `pdf-lib` 1.17.1, Ajv 8.17.1, oxlint/oxfmt/knip.

**Spec:** `docs/code-kb-analysis/05-unified-service-proposal.md` (binding), `docs/code-kb-analysis/04-detailed-comparison.md`, `docs/code-kb-analysis/reviews/agent-a-capability-union-input.md`, and the three implementation-plan reviews.

## Global Constraints

- `code-kb/figma-mcp-rust`, `code-kb/figmosha2`, `code-kb/figwright` are read-only references.
- Production source, package scripts, skills, and runtime config under `service/` never import or read `code-kb/`. Only development-only `vendor-upstreams.mjs` and `verify-upstream-lock.mjs --with-upstreams` may read it; neither ships in runtime package files.
- v0.1 runtime is Node 24 only. Node 20/22 support is not claimed.
- v0.1 connector is Figma Desktop development plugin, single OS user, user-authorized editable Figma Design file.
- Non-loopback bind, raw JavaScript evaluator, Web/public distribution, view-only bypass, and unattended fileKey fetching are absent from the normal v0.1 build.
- Baseline handler parity is exactly 112 MCP tools with `handlerAuthority` 105 plugin-handler/7 server-only. Safe-union registration is atomic and ends at exactly 116 tools with 106 plugin-handler/10 server-only. Execution routing is a separate authority: baseline exact 98 `plugin-direct`/14 `server-adapter`, final exact 99 `plugin-direct`/17 `server-adapter`.
- Motion 7 tools and `export_video` remain advertised as `experimental-native`; unsupported editor/capability calls fail with typed guidance instead of disappearing.
- Canonical tool kinds end at read 23, local 13, write 80. Every tool has input schema, runtime result schema, runtime binding, dynamic effects policy, and artifact manifest row.
- Source ledgers are distinct from the canonical registry: lexical tools 114, figmosha helpers 20, figmosha CLI parser entries 12 with 11 unique behaviors, canonical tools 116.
- `stateRoot` stores owner-only auth, leader identity, config, and operation journal. `workspaceRoots` store user-approved code reads, snapshots, mappings, and exports. Neither is silently inferred from a tool argument.
- Figma-only operations may run with `workspaceId:null` only when dynamic effects contain no filesystem access. Project scan/map/export/snapshot operations require a configured workspace. Approved URL-to-Figma import is network+Figma write and may run without a code workspace; its audit stays under `stateRoot`.
- Every call strict-parses args, resolves every declared filesystem path/overwrite into Task 5 `PolicyInvocationContext.resolvedPaths` without reading content or touching network/runtime, and only then evaluates `effectsFor(args, policyContext)`. It resolves and freezes the operation's declared `TargetRequirement` before approval. Destructive, filesystem-write/overwrite, network, library import, and broad mutation effects require the policy-selected approval. Egress input/result-class preflight runs after effects/approval but before queue dispatch or any Figma/filesystem/network runtime; disallowed or unknown classes produce runtime call count zero.
- Figma writes are serialized by stable file identity, not by socket session. Reads are bounded and cannot overlap a write on the same `FileExecutionKey`.
- Exactly one `ExecutionPlane` exists for one elected leader generation. Followers construct only `FollowerInvocationClient`; `unknown` and `conflicted` election roles reject locally and forward neither tool arguments nor invocation context. Demotion closes admission before abort/drain/durable recovery and destroys the old plane.
- Direct MCP strict-parses args then server-synthesizes selector/workspace; follower carries that exact synthesized `InvocationRequestV1`; authenticated control alone supplies an explicit strict selector/workspace lookup key. Actor, auth session, consent, workspace root, plugin target, file identity/execution key, generation, editor, and capabilities are always server-derived; args/body/`_meta` copies are rejected.
- A 256-bit owner-principal key under secured `stateRoot` derives one stable OS-owner `actor1_…` for direct MCP, follower MCP, and control. Each MCP connection creates one 128-bit session before role choice; `auth1_…` session identities are domain-separated HMACs, survive leader↔follower role changes for that MCP connection, and change on control credential rotation. Raw credentials are never actor/auth-session IDs. Target resolution is a leader-side lookup against authenticated Relay sessions; the resulting target and `FileExecutionKey` are deeply immutable for the invocation.
- Idempotency key is `(actorId, operationId)`, where operationId is server-issued/HMAC/timestamped with 30-day horizon. Reuse mismatch conflicts. Cache stores only canonical bytes of strict already-redacted semantic results with kind/name-aware consent fingerprint; current auth+fingerprint+schema must revalidate before entry-specific reframing. Otherwise replay is payload-free settled+audit and never reruns.
- A dispatched write whose result is lost becomes `outcome-unknown` and is never blindly replayed. Daemon recovery converts persisted dispatched records to that state.
- Persisted snapshots are loss-aware observed records. Section assembly records partial/omitted/failed sections; no “Figma API 전체 lossless IR” claim is made.
- Model egress mode is explicit configuration, never inferred from `source:'mcp'`. Unknown mode fails closed. Audit records hashes/classes/byte counts, not raw design text, image bytes, source code, or secrets.
- Pre-execution and final egress manifests are durable, canonical, hash-chained, fsynced owner-state records. Every reservation is finalized exactly once as output, no-output, or outcome-unknown before capacity release; a missing durable post-runtime finalizer makes the real outcome unknown rather than retryable.
- One-use action nonces are server-issued 256-bit capabilities bound to actor, leader generation, exact action, and request hash for 120 seconds. Semantic validation precedes an atomic consume immediately before the side effect; restart/generation invalidates all outstanding nonces.
- Paired approval-control uses strict versioned redacted prompt/decision frames bound server-side to actor, authenticated session/generations, immutable target, prompt hash, and 120-second TTL. Those control frames may flow while the runtime tool port remains forbidden; the plugin never receives a control token.
- Progress/cancel/result/error semantics are one shared protocol projected to MCP progress tokens, framed follower RPC, control NDJSON, and plugin `$progress`/`$cancel`; transport disconnect alone is neither cancel nor retry.
- Public `/ping` identity is exactly `{ok,product,protocolVersion,serverVersion,buildId,leaderGeneration,role}`. It retains `leaderGeneration` for authenticated-transport binding and exposes no plugin, MCP, Relay session, file, or `activeSessionId` oracle.
- Task7 service registry starts0; Task11 registers `snapshot.capture` and `grounding.refresh` service2 outside canonical tool/handler counts; admin routes remain separate.
- Every service-mutating subcommit from 7A through 16 regenerates and stages `vendor-rules.json`, `vendor-map.json`, and `upstream-lock.json`, passes offline closed-world verification, and receives spec/quality review of the same `git write-tree` before its exact commit.
- URL import keeps the public typed `url` argument but fetches only in the daemon. The plugin receives validated bytes and has no external wildcard domain or `createImageAsync(url)` path. Owner-managed allowed domains live under stateRoot and change only through authenticated control/CLI; one-call approval never expands them.
- Three upstream MIT notices, service license, `pdf-lib` notice, dependency SBOM, provenance, and checksums are present in actual npm/plugin artifacts. figmosha Solar CC BY assets are not copied.
- Tasks 1–16 are the complete authorized objective: a source-complete local service, deterministic local artifacts, automated typed-fake checks, and a non-destructive current-Windows co-presence diagnostic. Their truthful terminal status is `implementationStatus:'source-complete-preview'`, `externalValidationStatus:'not-run'`.
- This source plan creates no upload, signer enrollment, signed attestation, cross-OS bundle, publication authority, or public-availability claim. Tasks 17–18 are non-dispatchable external-validation placeholders only; a separately approved future supplemental plan must define any such validation. Their absence does not block Task7–16 implementation, plan READY, or source-complete status.
- Official MCP/REST limits are documentation-time external facts. No specific call-rate number is compiled into source, tests, config, or docs.

---

## 1. Full Vision and v0.1 Boundary

### 1.1 Full Vision

The full product later adds source AST patching, deterministic code→Figma adapters, three-way sync, framework expansion, artifact/private/Web connectors, optional native workers, signed updates, and selectable local/cloud model connectors.

### 1.2 v0.1 Delivers

- Standalone `service/` monorepo with reproducible upstream provenance.
- Full Figwright 112/105 parity, followed by atomic four-tool union to 116/106.
- `export_tokens`, `export_frames_to_pdf`, `doctor`, `import_library_variable`.
- Source-surface ledgers and canonical 116-tool manifest.
- Owner-only state root, workspace config lifecycle, path sandbox, atomic file adapter.
- Eight-digit one-time pairing code exchanged for a 128-bit one-use WebSocket ticket; rotating resume, follower, and control credentials.
- Host/Origin/PNA/body/path/frame gates and product-identity health checks.
- Dynamic side-effect metadata, approvals, explicit egress consent, per-file queue, journal, outcome-unknown.
- Server-side safe remote image fetch followed by plugin byte import.
- Stable `fileKey` or document plugin-data UUID identity; unstable read-only fallback is capability-negative for persistent diff/snapshot.
- Session-pinned component/token/icon grounding and file-identity design diff.
- Section-assembled `SnapshotV1`, `GroundingGraphV1`, control-only capture endpoint.
- CLI doctor/pair/status/compat/workspace/approval/snapshot/export and typed figmosha wrappers.
- Updated skills, official build-vs-buy document, source CI, SBOM/checksum artifact gates.
- Automated typed-fake source checks plus a non-destructive current-Windows daemon/plugin co-presence diagnostic; unsigned source-complete marker only.

### 1.3 Explicitly Deferred

- Automatic source patching and deterministic code→Figma compiler.
- Automatic three-way merge.
- Native Rust launcher/worker.
- Web/private/Community plugin and FigJam write guarantee.
- Dev Mode write and view-only bypass.
- Raw Plugin API script execution.
- SQLite; v0.1 stores versioned JSON/JSONL with checksum and atomic replacement.
- Destructive or mutating final real-Figma validation; it requires a separate supplemental validation plan, dedicated validation folder, and explicit user scope.

Existing typed writes still permit agent-orchestrated code/spec→Figma work, but v0.1 is not marketed as a deterministic reverse compiler.

### 1.4 Milestones

| Milestone | Tasks | Independent output |
|---|---|---|
| A — reproducible baseline | 1–3 | runnable workspace, 112/105/7 parity, two-layer capability authority |
| B — secure execution plane | 4–9 | state/workspace roots, policy, pairing, executor, safe fs/network, paired plugin |
| C — grounding and safe union | 10–12 | corrected grounding, section snapshot, atomic 116/106/10 union |
| D — UX and source-complete preview | 13–16 | CLI, docs, local artifacts, typed-fake source checks, and current-Windows diagnostic |
| E — external validation placeholder | 17–18 | no dispatched work; a separately approved supplemental plan is required |

The initial estimate remains 8–12 weeks for two experienced TypeScript/plugin engineers, recalibrated after Task2 parity and the Task6 authenticated-pairing spike. Each milestone is a review checkpoint; no later milestone compensates for a failed earlier hard gate.

---

## 2. Reuse and Standalone Vendoring

### 2.1 Selected Architecture

Use a standalone Figwright vendor fork under `service/`. Do not run the three original servers in parallel. Rust supplies token/PDF semantics and progress concepts; figmosha supplies diagnostic/error/target behavior; Figwright remains the canonical TypeScript implementation.

### 2.2 Exact Vendor Rules

`service/vendor-rules.json` expands only tracked files from the pinned Figwright commit and assigns an explicit mode. Task 1 root/package/lock/config authorities are never byte-overwritten:

~~~json
{
  "schemaVersion": 1,
  "upstream": "figwright",
  "copy": [
    "packages/shared/src/**", "packages/shared/test/**",
    "packages/mcp/src/**", "packages/mcp/test/**",
    "packages/plugin/protocol/**", "packages/plugin/src/**", "packages/plugin/ui/**", "packages/plugin/test/**",
    "skills/figma-codegen/**", "skills/figma-build/**", "test/**"
  ],
  "mergeDependencyManifests": [
    "package.json", "packages/shared/package.json", "packages/mcp/package.json", "packages/plugin/package.json"
  ],
  "referenceOnly": [
    "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "tsconfig.json",
    "vitest.config.ts", "knip.json", ".node-version", ".oxlintrc.json", ".oxfmtrc.json",
    "packages/shared/tsconfig.json", "packages/shared/vitest.config.ts",
    "packages/mcp/tsconfig.json", "packages/mcp/tsdown.config.ts", "packages/mcp/vitest.config.ts",
    "packages/plugin/manifest.json", "packages/plugin/tsconfig.json", "packages/plugin/vite.config.ts",
    "packages/plugin/vite.config.main.ts", "packages/plugin/vitest.config.ts"
  ],
  "exclude": ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/*.tsbuildinfo"]
}
~~~

The vendoring script expands this into `service/vendor-map.json`, one row per copied/merged/reference file with mode, origin commit, source path, destination or null, base SHA-256, current SHA-256 where applicable, and license ID. Copy mode materializes only source/test/protocol/UI/skill trees. Every root/package/lock/build/test config and plugin manifest is Task 1 service authority; upstream equivalents are reference-only hashes and are never copied over it. Manifest merge preserves Task 1 names, five-package workspace, scripts, bin/files/exports, Node/pnpm pins, and `ir`/CLI packages; it merges dependency/devDependency keys deterministically after rewriting package dependency names. Upstream `postinstall` and distribution scripts are explicitly dropped because skills are copied directly and no `.claude` mirror is produced. The service lock is regenerated with `pnpm install --lockfile-only`, then frozen install is tested.

Runtime module specifier rewriting and verification are AST-based. `verify-runtime-specifiers.mjs` visits TypeScript/JavaScript import/export declarations, import types, dynamic `import()`, and `require()` literals plus package dependency fields; only specifiers beginning `@figwright/` fail. Protocol tags `@figwright/bridge` and `@figwright/panel`, comments, user guidance, and provenance are permitted and tracked in `vendor-allowed-figwright-strings.json`; they are not runtime package imports and are not blindly rewritten.

`verify-upstream-lock.mjs --offline` checks only service-contained hashes/schema/licenses. `--with-upstreams ../code-kb` additionally checks pinned commits, source hashes, and clean original worktrees. Local packed artifacts use offline mode and never require `code-kb`.

### 2.3 Source Attribution

| Origin | Pinned source | Reused behavior |
|---|---|---|
| Figwright | shared/MCP/plugin/skills/test trees in vendor rules | canonical registry, serializer, relay/election, joins, local tools, UI |
| figma-mcp-rust | `plugin/src/read-styles.ts:181-267` | deterministic token JSON/CSS semantics |
| figma-mcp-rust | `plugin/src/read-export.ts:62-85`, `src/tools/special.rs:293-375`, `src/pdf.rs` | ordered per-node PDF collection/merge behavior |
| figma-mcp-rust | `src/bridge.rs:27-29,280-301` | progress extends idle deadline but not absolute deadline |
| figmosha2 | `figmosha.py:137-179`, `bridge.py:72-109` | doctor stages and error guidance |
| figmosha2 | `plugin/code.js:52-79,96-200,233-315`, `tests/helpers.test.js` | helper/target/font/frame/library-variable behavior tests |

Rust server/election, partial serializer, unauthenticated endpoints, lexical path check, figmosha raw evaluator/globals/Solar assets are not copied.

---

## 3. Binding Contracts

### 3.1 Capability Manifest

~~~ts
export interface UnionManifestV1 {
  schemaVersion: 1;
  canonicalTools: CanonicalToolRow[];
  sourceSurfaces: {
    lexicalTools: SourceToolRow[];
    figmoshaHelpers: SourceFeatureRow[];
    figmoshaCliParsers: SourceFeatureRow[];
  };
}

export interface CanonicalToolRow {
  name: string;
  sourceRefs: readonly string[];
  sourceContracts: readonly { source: string; schemaHash: string }[];
  targetContractHash: string;
  disposition: 'native' | 'adapter' | 'experimental-native';
  registration: 'advertised';
  availability: readonly string[];
  investment: 'active' | 'deferred';
  implementationStatus: 'planned' | 'implemented';
  implementation: string;
  test: string;
  policyId: string;
}

export interface SourceToolRow {
  name: string;
  sources: readonly string[];
  compatibility: 'same' | 'adapter' | 'incompatible' | 'unique';
  sourceContracts: readonly { source: string; schemaHash: string }[];
  canonicalName: string;
}

export interface SourceFeatureRow {
  name: string;
  source: 'figmosha2';
  mapping: string;
  disposition: 'native' | 'adapter' | 'alias' | 'rejected';
  implementation: string | null;
  test: string;
}
~~~

Motion 7 and `export_video` use `experimental-native`, remain advertised/implemented, and have deferred new investment. Raw exec is a rejected source feature and never a canonical tool. The 71 common Rust/Figwright names retain both source hashes plus one canonical target hash.

### 3.2 Tool, Result, Runtime, and Dynamic Policy

~~~ts
export interface ToolSpec<I, O> {
  name: ToolName;
  description: string;
  inputSchema: z.ZodType<I>;
  resultSchema: z.ZodType<O>;
  kind: 'read' | 'write' | 'local';
  policyId: string;
  runtimeId: string;
  handlerAuthority: 'plugin-handler' | 'server-only';
  targetRequirementFor(args: Readonly<I>): TargetRequirement;
  destructive?: true;
  injectedArgs?: readonly string[];
  serverOnlyArgs?: readonly string[] | null;
}

export interface RawToolSpec<I> {
  name: ToolName;
  description: string;
  inputSchema: z.ZodType<I>;
  kind: 'read' | 'write' | 'local';
  destructive?: true;
  injectedArgs?: readonly string[];
  serverOnlyArgs?: readonly string[] | null;
}

export type Effect =
  | { type: 'figma-read' }
  | { type: 'figma-write'; destructive: boolean; broad: boolean }
  | { type: 'figma-ui' }
  | { type: 'figma-library-import' }
  | { type: 'filesystem-read'; pathArgs: readonly string[] }
  | { type: 'filesystem-write'; pathArgs: readonly string[]; destructive: boolean }
  | { type: 'network'; urlArg: string };

export interface ResolvedWorkspacePath {
  path: string;
  overwrites: boolean;
}

export interface PolicyInvocationContext {
  workspace: { workspaceId: string | null; workspaceRoot: string | null };
  resolvedPaths?: Readonly<Record<string, Readonly<ResolvedWorkspacePath>>>;
}

export type TargetRequirement = 'forbidden' | 'optional' | 'required';

export interface OperationPolicy<I> {
  toolName: ToolName;
  possibleEffects: readonly Effect[];
  effectsFor(args: Readonly<I>, context: PolicyInvocationContext): readonly Effect[];
  idempotencyFor(args: Readonly<I>): 'safe-retry' | 'operation-id' | 'never-auto-retry';
  approvalFor(effects: readonly Effect[], context: PolicyInvocationContext): 'none' | 'client' | 'explicit-user';
  concurrency: 'parallel-read' | 'file-write' | 'exclusive-heavy';
}

export interface ToolRuntime<I, O> {
  execute(scope: RuntimeExecutionScope, args: I, signal: AbortSignal): Promise<O>;
}

export interface PinnedPluginRuntimePort {
  execute(scope: RuntimeExecutionScope, toolName: ToolName, args: unknown, signal: AbortSignal): Promise<unknown>;
}

export interface RuntimeBinding<I, O> {
  execution: 'plugin-direct' | 'server-adapter';
  runtime: ToolRuntime<I, O>;
}

export const BASELINE_SERVER_ADAPTER_NAMES = [
  'ping', 'get_screenshot', 'get_design_context', 'save_screenshots', 'save_image_fills',
  'export_pdf', 'export_video', 'analyze_project', 'scan_components', 'component_map',
  'token_map', 'icon_map', 'import_image', 'design_diff',
] as const;

export const FINAL_SERVER_ADAPTER_NAMES = [
  ...BASELINE_SERVER_ADAPTER_NAMES, 'export_tokens', 'export_frames_to_pdf', 'doctor',
] as const;

export interface PluginHandlerOutcome<O> {
  value: O;
  mutated: boolean;
}

export type SandboxMutationHandler<I, O> = (args: I) => Promise<PluginHandlerOutcome<O>>;
export type SandboxReadHandler<I, O> = (args: I) => Promise<O>;

export interface UndoBoundaryPolicy {
  toolName: ToolName;
  commitOnChangedSuccess: boolean;
}

export interface MutationHandlerContract {
  toolName: ToolName;
  noOpSemantics: 'supported' | 'never-on-success';
  changedFixtureId: string;
  noOpFixtureId: string | null;
}
~~~

`handlerAuthority` is the handler-parity authority and is independent from `RuntimeBinding.execution`. `plugin-direct` invokes exactly one pinned plugin handler through `PinnedPluginRuntimePort`; `server-adapter` invokes a typed daemon adapter that may call that same port but never Relay/session selection directly. Baseline `server-adapter` is the exact set `ping`, `get_screenshot`, `get_design_context`, `save_screenshots`, `save_image_fills`, `export_pdf`, `export_video`, `analyze_project`, `scan_components`, `component_map`, `token_map`, `icon_map`, `import_image`, `design_diff` (14); final adds `export_tokens`, `export_frames_to_pdf`, and `doctor` (17). Handler parity remains 105/7 then 106/10, while execution becomes 98/14 then 99/17.

7A is an explicit migration from the checked-in Task3/5 API, not a greenfield type assumption. At its base, `service/packages/shared/src/operations.ts` exports `InvocationContext {workspace,resolvedPaths}`, and `service/packages/mcp/src/tools/runtime-registry.ts` exports `RuntimeExecutionContext.execute(..., authority)` plus `RuntimeBinding.authority:'plugin'|'server'`. The 7A RED first asserts those exact legacy shapes. The same reviewed 7A tree renames policy-only `InvocationContext` to `PolicyInvocationContext`, removes `RuntimeExecutionContext`, splits handlerAuthority from execution, introduces PinnedPluginRuntimePort, updates all imports/tests, and leaves no compatibility alias or mixed authority lookup. `packages/mcp/test/tools/result-validation.test.ts` proves plugin-direct errors remain `PLUGIN_RESULT_INVALID`, server-adapter final-result errors remain `SERVER_RESULT_INVALID`, and pinned plugin subcall validation cannot be bypassed.

Target requirements are exact. Baseline `analyze_project` and `scan_components` are `forbidden`; baseline `ping` is `optional`; every other baseline tool is `required`. Final `doctor` is `required` only when `roundTrip:true`, otherwise `optional`; `export_tokens`, `export_frames_to_pdf`, and `import_library_variable` are `required`. A `forbidden` operation accepts only selector `none` or server-synthesized no target and rejects any selected target as `TARGET_FORBIDDEN`; `required` rejects `none` as `TARGET_REQUIRED`; `optional` accepts either. Target errors occur before approval/runtime and the resolved target is deeply frozen.

MCP annotations use the union of possible effects and are conservative. Before `effectsFor`, the executor collects every `pathArgs` name from `possibleEffects`, resolves each present parsed argument through WorkspacePolicy into canonical path plus overwrite state, and builds the distinct Task 5 `PolicyInvocationContext`. This phase may inspect path metadata/realpath only—never file content, DNS, network, plugin, or another runtime. Runtime approval uses the parsed args and resolved-path policy context. `import_image(data)` has no network effect; `import_image(url)` does. `export_tokens` without outPath has no filesystem write; with outPath it does. Existing output overwrite makes the filesystem effect destructive. Tool kind is registration metadata, not document mutation truth: `navigate_to_page` remains kind write for compatibility but resolves only `figma-ui`, receives no document-write approval, and has no undo boundary.

### 3.3 Invocation, Actor, Consent, Approval, and Journal

~~~ts
export type EgressMode = 'local-trusted' | 'external-model' | 'unknown-fail-closed';
export type DataClass = 'public' | 'project-code' | 'design-text' | 'design-image' | 'secret';

export interface ClassifiedPayload<T> {
  value: T;
  classes: readonly DataClass[];
  bytes: number;
  tokens: number;
}

export interface ResultEgressPolicy<I, O> {
  possibleInputClasses(args: Readonly<I>): readonly DataClass[];
  possibleResultClasses: readonly DataClass[];
  classifyInput(args: Readonly<I>): ClassifiedPayload<Readonly<I>>;
  classifyResult(result: Readonly<O>): ClassifiedPayload<Readonly<O>>;
  redactResult(result: Readonly<O>, allowed: readonly DataClass[]): O;
}

export interface PreExecutionConsentManifest {
  consentId: string | null;
  mode: EgressMode;
  inputClasses: readonly DataClass[];
  possibleResultClasses: readonly DataClass[];
  allowedClasses: readonly DataClass[];
  inputBytes: number;
  inputTokens: number;
  manifestHash: string;
}

export interface OutputEgressManifest {
  preExecutionManifestHash: string;
  finalStatus: 'output';
  resultClasses: readonly DataClass[];
  outputBytes: number;
  outputTokens: number;
  redactedFieldCount: number;
  resultHash: string;
  resultBytes: number;
  payloadHash: string;
  manifestHash: string;
}

export interface NoOutputEgressManifest {
  preExecutionManifestHash: string;
  finalStatus: 'no-output';
  reasonCode: string;
  outputBytes: 0;
  outputTokens: 0;
  manifestHash: string;
}

export interface OutcomeUnknownEgressManifest {
  preExecutionManifestHash: string;
  finalStatus: 'outcome-unknown';
  reasonCode: string;
  observedOutputBytes: number | null;
  manifestHash: string;
}

export type EgressFinalManifest =
  | OutputEgressManifest
  | NoOutputEgressManifest
  | OutcomeUnknownEgressManifest;

export interface EgressManifestLimits {
  maxRowBytes: 65536;
  compactAtRows: 160000;
  compactAtBytes: 201326592;
  maxRowsPerActor: 200000;
  maxBytesPerActor: 268435456;
  retentionDays: 30;
}

export interface EgressManifestRecordV1 {
  schemaVersion: 1;
  requestId: `sfp_req1_${string}`;
  operationId: string;
  sequence: number;
  kind: 'pre-execution' | 'output' | 'no-output' | 'outcome-unknown';
  createdAt: string;
  previousRecordHash: string | null;
  manifestHash: string;
  recordHash: string;
  manifest: PreExecutionConsentManifest | EgressFinalManifest;
}

export interface EgressReservation {
  actorId: `actor1_${string}`;
  requestId: `sfp_req1_${string}`;
  operationId: string;
  leaderGeneration: string;
  preManifestHash: string;
  reservedOutputBytes: 65536;
}

export interface EgressManifestPort {
  reservePre(actorId: `actor1_${string}`, requestId: `sfp_req1_${string}`, operationId: string, manifest: PreExecutionConsentManifest): Promise<EgressReservation>;
  finalize(reservation: EgressReservation, manifest: EgressFinalManifest): Promise<{ finalManifestHash: string; finalized: true }>;
  recover(now: number): Promise<void>;
  flush(): Promise<void>;
}

export type ActionNonceAction =
  | 'workspace.add'
  | 'workspace.remove'
  | 'workspace.set-default'
  | 'operation.resolve'
  | 'network-domain.add'
  | 'network-domain.remove';

export type ActionNonceIssueRequestV1 =
  | { action: 'workspace.add'; requestHash: `sha256:${string}`; registrationPath: string }
  | { action: Exclude<ActionNonceAction, 'workspace.add'>; requestHash: `sha256:${string}` };

export interface ActionNonceClaims {
  value: `sfp_an1_${string}`;
  actorId: `actor1_${string}`;
  leaderGeneration: string;
  action: ActionNonceAction;
  requestHash: `sha256:${string}`;
  issuedAt: number;
  expiresAt: number;
  state: 'issued' | 'consumed';
}

export interface ActionNonceStore {
  issue(actor: Readonly<ActorContext>, action: ActionNonceAction, requestHash: `sha256:${string}`): Promise<ActionNonceClaims>;
  consumeCas(actor: Readonly<ActorContext>, value: string, action: ActionNonceAction, requestHash: `sha256:${string}`): Promise<void>;
}

export const ToolNameSchema = z.string().min(1).max(128).regex(/^[a-z][a-z0-9_]{0,127}$/);
export type ToolName = z.infer<typeof ToolNameSchema>;

export const ServiceOperationNameSchema = z
  .string().min(1).max(128)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/)
  .pipe(z.enum(['snapshot.capture', 'grounding.refresh']));
export type ServiceOperationName = z.infer<typeof ServiceOperationNameSchema>;
export const SystemOperationNameSchema = z.literal('identity.bootstrap');
export type SystemOperationName = z.infer<typeof SystemOperationNameSchema>;
export type OperationKind = 'tool' | 'service' | 'system';
export type OperationName = ToolName | ServiceOperationName | SystemOperationName;

export type InvocationTargetSelector =
  | { kind: 'active' }
  | { kind: 'session'; sessionId: z.infer<typeof Base64Url128Schema> }
  | { kind: 'stable-file'; fileIdentityHash: `sha256:${string}` }
  | { kind: 'none' };

export const SESSION_ID_A = 'AQAAAAAAAAAAAAAAAAAAAA' as const;
export const SESSION_ID_WITH_UNDERSCORE = '-____________________w' as const;
export const TARGET_SELECTOR_MAX_BYTES = 115 as const;

export interface InvocationRequestV1 {
  version: 1;
  requestId: `sfp_req1_${string}`;
  toolName: ToolName;
  rawArgs?: unknown;
  operationId?: string;
  workspaceId?: string | null;
  targetSelector: InvocationTargetSelector;
}

export interface ServiceOperationRequestV1 {
  version: 1;
  requestId: `sfp_req1_${string}`;
  serviceOperationName: ServiceOperationName;
  rawArgs?: unknown;
  operationId?: string;
  workspaceId?: string | null;
  targetSelector: InvocationTargetSelector;
}

export interface ServiceOperationSpec<I, O> {
  name: ServiceOperationName;
  inputSchema: z.ZodType<I>;
  resultSchema: z.ZodType<O>;
  policyId: string;
  possibleEffects: readonly Effect[];
  effectsFor(args: Readonly<I>, context: PolicyInvocationContext): readonly Effect[];
  idempotencyFor(args: Readonly<I>): 'safe-retry' | 'operation-id' | 'never-auto-retry';
  approvalFor(effects: readonly Effect[], context: PolicyInvocationContext): 'none' | 'client' | 'explicit-user';
  concurrency: 'parallel-read' | 'file-write' | 'exclusive-heavy';
  egressPolicy: ResultEgressPolicy<I, O>;
  targetRequirementFor(args: Readonly<I>): TargetRequirement;
  execute(scope: RuntimeExecutionScope, args: I, signal: AbortSignal): Promise<O>;
}

export interface InvocationCancelV1 {
  version: 1;
  requestId: `sfp_req1_${string}`;
  operationId: string;
}

export interface ActorContext {
  actorId: `actor1_${string}`;
  authSessionId: `auth1_${string}`;
  entryPath: 'mcp-direct' | 'mcp-follower' | 'control' | 'internal-system';
}

export interface ConsentContext {
  mode: EgressMode;
  consentId: string | null;
  allowedClasses: readonly DataClass[];
}

export interface ConsentFingerprintV1 {
  schemaVersion: 1;
  operationKind: OperationKind;
  operationName: OperationName;
  mode: EgressMode;
  consentId: string | null;
  allowedClasses: readonly DataClass[];
  policyVersion: 'egress-policy-v1';
  fingerprintHash: `sha256:${string}`;
}

export interface CompletedWireResultCacheEntry {
  readonly operationId: string;
  readonly canonicalRedactedResultBytes: Uint8Array;
  readonly resultSchemaHash: `sha256:${string}`;
  readonly consentFingerprint: Readonly<ConsentFingerprintV1>;
  readonly expiresAt: number;
}

export interface PluginTarget {
  readonly sessionId: string | null;
  readonly pluginGeneration: string | null;
  readonly fileIdentity: Readonly<FileIdentity> | null;
  readonly fileExecutionKey: FileExecutionKey | null;
}

export interface ResolvedInvocationScope extends PolicyInvocationContext {
  readonly requestId: `sfp_req1_${string}`;
  readonly leaderGeneration: string;
  readonly actor: Readonly<ActorContext>;
  readonly target: Readonly<PluginTarget>;
}

export interface RuntimeExecutionScope extends ResolvedInvocationScope {
  readonly consent: Readonly<ConsentContext>;
}

export interface ExecutionPlane {
  readonly leaderGeneration: string;
  invokeTool(principal: Readonly<ActorContext>, request: InvocationRequestV1): AsyncIterable<InvocationFrameV1>;
  invokeService(principal: Readonly<ActorContext>, request: ServiceOperationRequestV1): AsyncIterable<InvocationFrameV1>;
  cancel(principal: Readonly<ActorContext>, request: InvocationCancelV1): Promise<void>;
  prepareDemotion(reason: 'abdicated' | 'lease-lost' | 'shutdown'): Promise<DemotionTicket>;
  finalizeDemotion(ticket: DemotionTicket): Promise<'port-released' | 'port-retained-durability-failure'>;
}

export interface DemotionTicket {
  leaderGeneration: string;
  startedAt: number;
  deadlineAt: number;
  transportDrainDeadlineAt: number;
}

export interface ApprovalRecord {
  approvalId: `sfp_ap1_${string}`;
  actorId: `actor1_${string}`;
  operationId: string;
  decision: 'approved' | 'rejected' | 'expired';
  decidedAt: string;
}

export interface ApprovalPromptV1 {
  version: 1;
  type: 'approval.prompt';
  approvalId: `sfp_ap1_${string}`;
  operationId: string;
  operationKind: OperationKind;
  operationName: OperationName;
  channel: 'plugin-session' | 'owner-control-session';
  promptHash: `sha256:${string}`;
  effectSummary: readonly string[];
  target: { fileIdentityHash: `sha256:${string}` | null; label: string; targetCount: number | null };
  issuedAt: number;
  expiresAt: number;
}

export interface ApprovalDecisionV1 {
  version: 1;
  type: 'approval.decision';
  approvalId: `sfp_ap1_${string}`;
  operationId: string;
  promptHash: `sha256:${string}`;
  decision: 'approved' | 'rejected';
}

export interface ApprovalBindingCommonV1 {
  approvalId: `sfp_ap1_${string}`;
  operationId: string;
  promptHash: `sha256:${string}`;
  actorId: `actor1_${string}`;
  issuedAt: number;
  expiresAt: number;
  state: 'pending' | 'approved' | 'rejected' | 'expired';
}

export type ApprovalBindingV1 = ApprovalBindingCommonV1 & (
  | {
      channel: 'plugin-session';
      pairedSessionId: z.infer<typeof Base64Url128Schema>;
      leaderGeneration: string;
      pluginGeneration: string;
      fileExecutionKey: FileExecutionKey;
      decisionTransport: 'paired-ws';
    }
  | {
      channel: 'owner-control-session';
      originControlAuthSessionId: `auth1_${string}`;
      leaderGeneration: string;
      fileExecutionKey: FileExecutionKey | null;
      decisionTransport: 'authenticated-control';
    }
);

export interface ApprovalDecisionPort {
  decide(scope: ResolvedInvocationScope, operationName: OperationName, effects: readonly Effect[], operationId: string): Promise<ApprovalRecord | null>;
}

export type OperationStatus =
  | 'pending-approval'
  | 'queued'
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'outcome-unknown'
  | 'resolved-applied'
  | 'resolved-not-applied'
  | 'abandoned';

export type ControlRouteClass = 'tool' | 'service' | 'admin';

export interface AuthenticatedControlRoute<I, O> {
  id: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  routeClass: ControlRouteClass;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  handle(principal: Readonly<ActorContext>, input: I, signal: AbortSignal): Promise<O> | AsyncIterable<InvocationFrameV1>;
}

export interface AuthenticatedControlRouter {
  register<I, O>(route: AuthenticatedControlRoute<I, O>): void;
  freeze(): void;
  dispatch(request: unknown, principal: Readonly<ActorContext>, signal: AbortSignal): Promise<unknown>;
}

export interface ControlStatusV1 {
  schemaVersion: 1;
  serverVersion: string;
  buildId: number;
  leaderGeneration: string;
  role: 'leader' | 'follower' | 'unknown' | 'conflicted';
  pairedPluginCount: number;
  activePlugin: null | {
    sessionId: string;
    fileName: string | null;
    pageName: string | null;
    fileIdentityKind: FileIdentity['kind'];
    pluginVersion: string;
    capabilities: readonly string[];
  };
}

export type AdministrativeActionName =
  | ActionNonceAction
  | 'action-nonce.issue'
  | 'pair.challenge'
  | 'approval.list'
  | 'approval.settle'
  | 'workspace.list'
  | 'network-domain.list'
  | 'operation.issue'
  | 'operation.list'
  | 'operation.status';

export interface AdministrativeActionAuditRecord {
  routeClass: 'admin';
  action: AdministrativeActionName;
  actorId: `actor1_${string}`;
  authSessionId: `auth1_${string}`;
  requestHash: string | null;
  decidedAt: string;
}

export interface OperationIdClaims {
  version: 1;
  keyId: string;
  issuedAt: number;
  nonce: string;
  actorHash: string;
}

export interface OperationIdIssuer {
  issue(actorId: `actor1_${string}`, now?: number): string;
  verify(actorId: `actor1_${string}`, operationId: string, now?: number): OperationIdClaims;
}

export type OperationOriginV1 =
  | { kind: 'entry'; entryPath: 'mcp-direct'|'mcp-follower'|'control'; authSessionId: `auth1_${string}` }
  | {
      kind: 'internal-system'; entryPath: 'internal-system'; authSessionId: `auth1_${string}`;
      systemName: 'identity.bootstrap'; pairedSessionHash: `sha256:${string}`;
      targetSessionIdHash: `sha256:${string}`; fileIdentityHash: `sha256:${string}`;
      fileExecutionKeyHash: `sha256:${string}`; pluginGeneration: string; leaderGeneration: string;
      targetBindingHash: `sha256:${string}`;
    };

export interface OperationRecord {
  actorId: `actor1_${string}`;
  originAuthSessionId: `auth1_${string}`;
  origin: OperationOriginV1;
  operationId: string;
  issuedAt: number;
  operationKind: OperationKind;
  operationName: OperationName;
  argsHash: string;
  resultHash: string | null;
  resultBytes: number | null;
  workspaceId: string | null;
  fileExecutionKey: FileExecutionKey | null;
  pluginGeneration: string | null;
  policyId: string;
  effectSummary: readonly string[];
  approvalId: string | null;
  preExecutionConsentManifestHash: string | null;
  finalEgressManifestHash: string | null;
  sequence: number;
  previousStatus: OperationStatus | null;
  status: OperationStatus;
  createdAt: string;
  settledAt: string | null;
  errorCode: string | null;
}

export interface OperationAlreadySettled {
  code: 'OPERATION_ALREADY_SETTLED';
  status: 'succeeded' | 'failed' | 'rejected' | 'resolved-applied' | 'resolved-not-applied' | 'abandoned';
  actorId: `actor1_${string}`;
  operationId: string;
  resultHash: string | null;
  resultBytes: number | null;
  settledAt: string;
}

export interface OperationTombstone {
  actorId: `actor1_${string}`;
  originAuthSessionId: `auth1_${string}`;
  origin: OperationOriginV1;
  operationId: string;
  issuedAt: number;
  expiresAt: number;
  operationKind: OperationKind;
  operationName: OperationName;
  argsHash: string;
  workspaceId: string | null;
  fileExecutionKey: FileExecutionKey | null;
  resultHash: string | null;
  status: 'succeeded' | 'failed' | 'rejected' | 'resolved-applied' | 'resolved-not-applied' | 'abandoned';
}

export interface OperationResolutionRecord {
  actorId: `actor1_${string}`;
  originAuthSessionId: `auth1_${string}`;
  origin: OperationOriginV1;
  resolverAuthSessionId: `auth1_${string}`;
  operationId: string;
  issuedAt: number;
  operationKind: OperationKind;
  operationName: OperationName;
  argsHash: string;
  workspaceId: string | null;
  fileExecutionKey: FileExecutionKey | null;
  decision: 'resolved-applied' | 'resolved-not-applied' | 'abandoned';
  resultHash: string | null;
  reasonHash: string;
  evidenceHash: string;
  confirmedResultHash: string | null;
  confirmationHash: string;
  decidedAt: string;
}

export interface JournalLimits {
  maxRowsPerActor: 10000;
  maxBytesPerActor: 33554432;
  normalOperationBytesPerActor: 32505856;
  resolutionReserveBytesPerActor: 1048576;
  compactAtRows: 8000;
  compactAtBytes: 25165824;
  maxTombstonesPerActor: 1000000;
  maxTombstoneBytesPerActor: 268435456;
  idempotencyHorizonDays: 30;
}

export interface OperationInvocationService {
  invokeTool(scope: RuntimeExecutionScope, toolName: ToolName, rawArgs: unknown, operationId?: string): Promise<unknown>;
  invokeService(scope: RuntimeExecutionScope, operationName: ServiceOperationName, rawArgs: unknown, operationId?: string): Promise<unknown>;
  status(actorId: `actor1_${string}`, operationId: string): OperationRecord | undefined;
}

export const SERVICE_OPERATION_SPECS: Readonly<Partial<Record<ServiceOperationName, ServiceOperationSpec<unknown, unknown>>>> = Object.freeze({});
~~~

Task7 registers its one typed router at the frozen Task6.1 seam's exact `/control` prefix before listen; all sibling paths dispatch internally. Task7 router rejects duplicate method/path/decoder/post-freeze; Task6.1 seam rejects any second/descendant prefix. Task8/11 modify only route-registry; structural tests prove sibling reachability, single response, authenticated default404/body/CORS on decline, no standalone mount/producer edit.

Authenticated `GET /control/status` is a Task7 admin route with empty strict input and exact `ControlStatusV1` output. Its `ControlStatusSource` combines final Task6.1 facade server/role/generation facts with a read-only Relay registry snapshot; it never calls public ping over HTTP. Session/file/plugin/capability oracles exist only here behind control auth. Tests cover unauthorized/foreign stateRoot, exact keys, redaction, zero/multiple plugins, active-session rotation, and absence of credentials/raw file identity values.

Tool and service public schemas remain distinct. Journal/idempotency codecs discriminate OperationKind: tool→ToolName, service→two exact names, system→literal identity.bootstrap. System has no public request/registry and is introduced only Task9C; cross-kind names reject. Tool/service tests retain all syntax boundaries and service count2.

Cancellation accepts only `version`, `requestId`, and `operationId`. Request IDs match `^sfp_req1_[A-Za-z0-9_-]{22}$`. Every entry point rejects unknown keys, including body-supplied `actor`, `actorId`, `authSessionId`, `principal`, `consent`, `mode`, `allowedClasses`, `workspaceRoot`, `target`, `targetSelector` inside tool args or MCP `_meta`, `workspaceId` inside tool args or MCP `_meta`, `FileIdentity`, `fileExecutionKey`, `pluginGeneration`, `editorType`, and `capabilities`. Wire-level `workspaceId` is only a server/control-selected approved-store lookup key, never a root path. `stable-file.fileIdentityHash` matches `^sha256:[0-9a-f]{64}$`, carries no body `FileIdentity`, and is only an authenticated-session-index lookup.

Tool names match `^[a-z][a-z0-9_]{0,127}$`; service names use the exact dotted enum above; workspaceId is null or canonical lowercase UUIDv4 (36 chars). Session selectors parse with frozen `Base64Url128Schema`, exactly22 unpadded characters including `_`/`-`; every positive fixture uses the canonical constants above. Canonical selector JSON uses sorted schema-key order and has exact reachable maximum `TARGET_SELECTOR_MAX_BYTES=115`, attained only by `{"kind":"stable-file","fileIdentityHash":"sha256:<64hex>"}`. Session is55 bytes, active17, none15. Any larger raw invocation envelope is governed only by the separate 9,437,184-byte logical request cap before schema; it is not a selector limit. These checks occur before lookup/allocation and have exact section3.12 fixtures.

Admission order before approval is exact: strict outer/inner/request parse → kind-specific name parser/registry/strict args → server-side MCP workspace binding or authenticated control workspace lookup → resolve declared paths metadata-only into PolicyInvocationContext → effects/idempotency/approval requirement → `targetRequirementFor(parsedArgs)` → server-side selector synthesis for MCP or strict control selector parse → deep-frozen target/key → `ResolvedInvocationScope`. Capacity/pending approval and decision then run. Only after approval does egress authorization produce ConsentContext and freeze final `RuntimeExecutionScope`. No content/DNS/network/plugin runtime tool call occurs earlier; only the paired approval-control broker may exchange the strict prompt/decision frames while waiting. Target rules are section3.2; unstable key includes registered session+generation; no filename fallback/reroute.

Each MCP connection creates one random 128-bit `mcpSession` before election role choice and synthesizes one random 128-bit `sfp_req1_…` request ID per call. After strict tool-args parsing, the MCP adapter calls the registered `targetRequirementFor(parsedArgs)` and synthesizes exactly `forbidden→{kind:'none'}`, `required→{kind:'active'}`, and `optional→{kind:'none'}`. Therefore `ping`, `doctor({roundTrip:false})`, and `doctor({})` use none, while `doctor({roundTrip:true})` and every required plugin tool use active. The same synthesized request and server-resolved MCP workspace binding travel through leader and follower paths; plugin connected/disconnected parity tests prove optional/forbidden calls work without a plugin and required calls fail typed without silently changing selector. Tool args and MCP `_meta` cannot override selector/workspace. Only authenticated control/CLI may choose `session`, `stable-file`, or `none` explicitly in v0.1. Tool-specific node/page/component IDs remain parsed ToolSpec args; they never become session/file identity.

One `ExecutionPlane` singleton is constructed only while the node owns one leader generation. A persisted owner-principal key is exactly 32 random bytes created once at `stateRoot/auth/owner-principal-key.v1`, protected by Task 4 `StatePermissions`, read only by the leader, and never logged/exported. Every valid entry path in that stateRoot receives the same actor ID: `actor1_` plus base64url HMAC-SHA-256 of `sfp-actor-v2\0os-owner`. MCP auth session is `auth1_` plus base64url HMAC-SHA-256 of `sfp-auth-v1\0mcp\0<mcpSession>`; it remains identical when that MCP connection changes leader↔follower role. Control auth session is `auth1_` plus base64url HMAC-SHA-256 of `sfp-auth-v1\0control\0<leaderGeneration>\0<credential-fingerprint>` and changes on credential rotation. The credential fingerprint is itself a domain-separated SHA-256 value; no raw token, ticket, resume value, follower credential, or control credential is ever stored as actor/authSessionId. A different stateRoot has a different owner key, cannot derive the actor/auth sessions, cannot verify operation IDs, and has no authority over the records.

Only daemon derives internal-system principal after authenticated paired session: same owner actor; authSessionId=`auth1_`+base64url HMAC(ownerKey, `sfp-auth-session-v1\0system\0identity.bootstrap\0<pairedSession>\0<leaderGeneration>`). Plugin cannot submit ActorContext/entryPath. Journal records internal origin, paired session hash and generation; reconnect derives new generation-bound auth, cannot cancel/replay old; foreign stateRoot fails.

Shared operations/journal schemas strict-parse `OperationOriginV1` before append and after every load. The internal-system admission builder receives the authenticated source values and, before append, derives and verifies `pairedSessionHash` as `sha256:` plus SHA-256 of `sfp-paired-session-v1\0` and exact UTF-8 paired session ID, `targetSessionIdHash` under `sfp-target-session-v1\0`, `fileIdentityHash` via Task7 shared `canonicalFileIdentityHash(FileIdentity)`, and `fileExecutionKeyHash` under `sfp-file-execution-key-v1\0`. The persisted canonical target object has fields in exact order `{targetSessionIdHash,fileIdentityHash,fileExecutionKeyHash,pluginGeneration,leaderGeneration}`; `targetBindingHash` is SHA-256 of `sfp-target-binding-v1\0` plus its canonical JSON bytes. Append requires the admitted current leader/plugin generations to equal the stored nonsecret generations and rejects any source-to-component mismatch before journal bytes are written.

Restart/load has no raw component source values and therefore never pretends to recompute the four component hashes. It strict-validates their `^sha256:[0-9a-f]{64}$` syntax, discriminator/cross-record equalities and stored generation syntax, then recomputes only `targetBindingHash` from the stored component hashes plus stored generations; it never compares those stored generations with the new process generation. Top-level `originAuthSessionId===origin.authSessionId`; entry origins require `pluginGeneration:null`; internal records require top-level `pluginGeneration===origin.pluginGeneration`, system kind iff `identity.bootstrap`, and top-level `fileExecutionKey:null`. The raw-free guarantee is scoped to `internal-system` origin: no raw paired session ID, target session ID, FileIdentity, file execution key, principal, prompt, UUID, or args enters that origin or its audit copy. Ordinary entry `OperationRecord`, `OperationTombstone`, and `OperationResolutionRecord` may retain their nonsecret `workspaceId` and immutable `fileExecutionKey` exactly as required by the replay/conflict contract; they still never retain raw args/results/credentials.

`identity.bootstrap` is non-replayable: an exact concurrent duplicate with the full canonical origin fingerprint may share only the in-flight promise; after dispatched or settled, every same-ID call returns sanitized status/`OPERATION_ALREADY_SETTLED` and never a cached result or second runtime call. Any auth/session hash, generation, target hash, kind, name, args, actor, or workspace mismatch is `OPERATION_ID_CONFLICT`. Tombstone, resolution, reconnect, status, and audit copy the full strict origin unchanged. Task9C exact schema surface is `service/packages/shared/src/operations.ts`, `service/packages/mcp/src/execution/operation-journal.ts`, `service/packages/mcp/src/execution/operation-resolution-intent.ts`, `service/packages/mcp/test/execution/operation-journal.test.ts`, `service/packages/mcp/test/e2e/internal-system-principal.test.ts`, and `service/packages/mcp/test/e2e/identity-bootstrap.test.ts`; append tests derive every component from exact source vectors and reject one-field source/hash or admitted-generation mismatches before write. Restart tests load the valid old generation without source values, reject malformed component-hash syntax or a recomputed target-binding mismatch, and never require current-generation equality. Tombstone/resolution tests distinguish the raw-free internal origin from permitted nonsecret entry workspace/file keys and cover key order/domain separation, discriminator/equality/iff refinements, first settlement, reconnect, foreign root, and every mismatch. Plugin body identity fields reject before journal.

Cancellation requires both the stable actor and exact `originAuthSessionId`; another MCP connection or rotated control session cannot cancel it. Authenticated control is owner-admin for list/status and manual resolution of any same-actor operation regardless of origin session, and the audit records both `originAuthSessionId` and `resolverAuthSessionId`. Role transition, control rotation, cross-session cancel denial, cross-domain admin resolution, and foreign-stateRoot denial are binding tests. Task6.1 public `/ping` remains exactly `{ok,product,protocolVersion,serverVersion,buildId,leaderGeneration,role}` and exposes no plugin/session/file oracle.

`ApprovalPromptV1Schema`/`ApprovalDecisionV1Schema` are strict/versioned. IDs are `sfp_ap1_`+Base64Url128; summary/label/count/timestamp limits remain exact. The daemon hashes a raw-free prompt with promptHash omitted and persists the strict discriminated binding union. `plugin-session` requires server-derived actor, canonical pairedSessionId, leader+plugin generations, nonnull immutable fileExecutionKey and paired-WS decision transport. `owner-control-session` requires actor, origin control authSessionId, leader generation, authenticated-control transport, and permits target none/fileExecutionKey null. Fields from the other branch are rejected rather than ignored. Plugin-targeted tools and `identity.bootstrap` use plugin-session; grounding.refresh and an authenticated CLI waiter use owner-control-session. Prompts expose only sanitized target hash/label/count; plugin receives no control token.

While pending approval, runtime is uncallable but the broker may exchange control frames. Plugin-branch decisions must arrive on the bound paired WS and match session/generations/file key; control-branch decisions must arrive under the exact origin control authSession and leader generation. Both require exact approvalId+operationId+promptHash, one pending CAS and `now < expiresAt`; duplicate/conflict/wrong branch/session/generation/target/late fails audited with runtime0. Plugin reconnect may redeliver only after same resume session+generation+key and never extends TTL. Control reconnect/credential rotation cannot inherit the old origin authSession. Task7 tests both branches with fakes; Task9C owns real paired plugin, while CLI/control tests own the control branch.

Approval routing matrix is frozen: internal-system identity.bootstrap→plugin-session; MCP direct/follower with nonnull plugin target→plugin-session; MCP target-none that requires approval→typed APPROVAL_CHANNEL_UNAVAILABLE; authenticated control/CLI→owner-control-session regardless target. CLI approve/reject may settle only owner-control binding; plugin WS decision may settle only plugin binding. `approval-routing-matrix.test.ts` covers every entry×target×required combination plus wrong-channel/session/generation/target/hash/duplicate/late.

Followers construct only `FollowerInvocationClient` over the final Task6.1 stream facade; no executor/queue/journal/Relay/auth primitive. Unknown/conflicted forward no args. Task7 consumes only authenticated ordered plaintext Buffers and structurally cannot import Task6.1 private auth/record code.

Demotion is single-flight/two-phase and awaited by election; overlapping ticks cannot promote/demote/release. A one-use exact-generation DemotionTicket fixes one absolute 5,000 ms deadline and a 1,000 ms transport-drain deadline. Order: close admission → generation terminal fence → abort pending/queued → fsync dispatched unknown → finalize/flush egress → bounded drain/force close → destroy → release port. Prepare runs through destruction; finalize rejects stale/reused ticket and releases only after durability. Durability failure retains port with fatal guidance; no successor/old reply overlaps.

Operation IDs are server-issued base64url envelopes with version/keyId/issuedAt/random128-bit nonce/owner-actor hash plus HMAC-SHA-256 under a dedicated stateRoot-lifetime key independent of transport credentials. Verify strict envelope, key/MAC/owner actor before lookup; age `>=2,592,000,000 ms` is `OPERATION_ID_EXPIRED`, future skew `>300,000 ms` or bad key/MAC/actor is `OPERATION_ID_INVALID`, all runtime zero. Exact replay key includes actor, operationId, kind, name, argsHash, workspaceId, and fileExecutionKey; mismatch conflicts. No raw result persists. In-memory result cache follows section3.12; persisted settled without cache returns nonretryable `OPERATION_ALREADY_SETTLED`. Tombstones last through horizon and signed age rejects after purge. Generation change uses bounded demotion. Manual same-owner control resolution is separate admin action with nonce/evidence/exact `${operationId}/${resultHash ?? 'unknown'}`, fsynced 1,048,576-byte reserve, origin/resolver auth audit, no replay authority, and typed reserve-full guidance.

The completed-result cache stores only canonical deterministic UTF-8 JSON bytes of the already-redacted value after its strict result schema succeeds, plus resultSchemaHash and consent fingerprint. It never stores MCP content blocks, follower/control envelopes, progress/terminal framing, unknown objects, raw runtime output or pre-redaction values. Fingerprint input is exactly `{operationKind,operationName,mode,consentId,allowedClasses:sortedUnique,policyVersion:'egress-policy-v1'}` under domain `sfp-consent-fingerprint-v1`. Replay first reauthenticates current entry principal/consent, recomputes exact fingerprint, then parses cached bytes through the named strict result schema. Only exact valid match returns the semantic value; each entry adapter independently reframes it for MCP, follower MessagePack, or control NDJSON. Any kind/name/mode/ID/class/policy/auth/expiry/schema mismatch returns payload-free settled and raw-free old/new fingerprint audit, never runtime. Cross-entry tests assert semantic equality but distinct framing and prove no previous entry wire bytes leak.

The exact fingerprint includes `(operationKind,operationName)`, so tool/service names cannot collide. State/side-effect order is: capacity → durable pending approval if required → approval → raw-free pre-egress fsync/finalizer reservation → queue → dispatched append → dispatched fsync → first plugin/filesystem/network side effect → validation/classification → exactly-one finalizer fsync → terminal status fsync → one terminal frame. No runtime port is callable before dispatched fsync. Generation-fenced terminal CAS makes result/cancel/deadline/demotion races one-winner; crash tests stop after every arrow and never rerun maybe-applied effects.

The full-reserve payload is exactly `{ code:'RESOLUTION_RESERVE_FULL', manualExportCommand:'sfp operations unresolved --json' }`; it contains no raw operation data.

Every reserved resolution record copies `originAuthSessionId`, `issuedAt`, `operationKind`, `operationName`, `argsHash`, `workspaceId`, `fileExecutionKey`, and `resultHash` from the active unknown row and adds the authenticated control `resolverAuthSessionId` before fsync. That complete fingerprint preserves the normal rule after active-row compaction: an exact same-ID call is settled, while any different kind/name/args/workspace/file target is `OPERATION_ID_CONFLICT`.

Authenticated `POST /control/action-nonces` accepts strict `ActionNonceIssueRequestV1`, where requestHash matches `^sha256:[0-9a-f]{64}$`. Every action except `workspace.add` has exactly `{action,requestHash}`; workspace add has exactly `{action:'workspace.add',requestHash,registrationPath}` so the server can resolve and bind the registration identity at issue time. The endpoint issues exactly `sfp_an1_` followed by random 256-bit base64url (43 characters), bound to authenticated actor, current leader generation, action, canonical semantic request hash, and—only for workspace add—the resolver's realPath/identity tuple. TTL is exactly 120,000 ms. The owner-state store permits at most 1,024 rows or 512 KiB per actor; it never evicts an unexpired issued or consumed row to admit another. Semantic request validation occurs first, then revalidation and `consumeCas` run immediately before the protected side effect. A mismatch, filesystem identity change, reuse, concurrent loser, expiry, daemon restart, or generation change fails before the side effect. Consumed rows remain until expiry so replay is distinguishable. Restart and generation recovery invalidate every outstanding row rather than restoring bearer capability.

`hashActionRequest(action,payload)` is owned by `shared/action-nonce.ts`: strict-parse the action-specific semantic payload, omit auth, `actionNonce`, and the nonsemantic spelling `registrationPath`, sort object keys recursively, preserve array order, encode every already-canonical string as its exact UTF-8 bytes with no Unicode normalization/case folding, encode canonical JSON, and hash `sfp-action-request-v1\0<action>\0<canonical-json>` with SHA-256. Exact semantic fields are `{realPath}` for `workspace.add` after `WorkspaceRegistrationResolver.resolveForNonce`, `{workspaceId}` for `workspace.remove`, `{workspaceId:string|null}` for `workspace.set-default`, `{operationId,decision,reasonHash,evidenceHash,confirm}` for `operation.resolve`, and normalized exact `{fqdnAscii}` for both network-domain actions. CLI resolves the same local realPath before requesting a nonce and also sends the original registrationPath; the server independently resolves and compares hash+identity, then repeats that resolution immediately before CAS. The client-supplied hash is never accepted as side-effect authority by itself, and canonically distinct filesystem names never alias through NFC.

The durable egress authority is `stateRoot/journal/{actor-hash}.egress-manifests.v1.jsonl`. Rows use one explicit canonical serializer: recursively sorted object keys, preserved array order, UTF-8 strings without normalization, finite JSON numbers in canonical decimal form, and no undefined values. A manifest's `manifestHash` is SHA-256 over that manifest with `manifestHash` omitted; a record's `recordHash` is SHA-256 over the complete record with `recordHash` omitted and includes `previousRecordHash`. Row byte accounting includes canonical UTF-8 JSON plus its one trailing LF; maximum is 65,536. Compact at 160,000 rows or 201,326,592 bytes, refuse new reservations at 200,000 rows or 268,435,456 bytes, retain 2,592,000,000 ms.

Before queue/runtime, append+fsync the complete raw-free pre-manifest and reserve one finalizer row/65,536 bytes. Every path after reservation calls one generation-fenced idempotent finalizer that fsyncs exactly one output/no-output/outcome-unknown record; only then release capacity. An output finalizer is authoritative settlement intent: if later terminal-journal fsync fails, recovery appends the matching settled terminal from its hashes without rerunning runtime. If runtime may have acted but no output/no-output finalizer became durable, recovery writes outcome-unknown finalizer then journal state. Restart rebuilds reservations; duplicate same finalizer returns same hash, conflict fails closed, finalizer crash holds capacity. Manifests remain raw-free. Only a final truncated row after valid prefix recovers; middle corruption fails startup.

### 3.4 Runtime Paths and Workspace Rules

~~~ts
export interface RuntimePaths {
  stateRoot: string;
  workspaceRoots: readonly WorkspaceRoot[];
}

export interface WorkspaceRoot {
  workspaceId: string;
  path: string;
  realPath: string;
  rootIdentityKey: string;
  addedAt: string;
}

export interface WorkspacePolicy {
  resolveRead(workspaceId: string, input: string): Promise<string>;
  resolveWrite(workspaceId: string, input: string): Promise<{ path: string; overwrites: boolean }>;
  assertWithinRoot(workspaceId: string, path: string): Promise<void>;
}

export interface WorkspaceConfigStore {
  addResolved(
    actorId: string,
    expected: Readonly<ResolvedWorkspaceRegistration>,
    consumeNonceCas: () => Promise<void>,
  ): Promise<WorkspaceRoot>;
  list(): Promise<readonly WorkspaceRoot[]>;
  remove(actorId: string, workspaceId: string): Promise<void>;
  setDefault(actorId: string, workspaceId: string | null): Promise<void>;
  getDefault(): Promise<string | null>;
}

export interface ResolvedWorkspaceRegistration {
  requestedPath: string;
  realPath: string;
  identityKey: string;
}

export interface WorkspaceRegistrationResolver {
  resolveForNonce(path: string): Promise<Readonly<ResolvedWorkspaceRegistration>>;
  revalidateInsideMutation(expected: Readonly<ResolvedWorkspaceRegistration>): Promise<Readonly<ResolvedWorkspaceRegistration>>;
}

export interface McpWorkspaceBinding {
  resolveRequiredForMcpSession(mcpSession: McpSessionId): Promise<string>;
}

export interface WorkspaceUsageGuard {
  hasUnsettled(workspaceId: string): Promise<boolean>;
}

export interface StatePermissions {
  ensureSecure(path: string): Promise<void>;
  verifySecure(path: string): Promise<void>;
}
~~~

Default state locations are `%LOCALAPPDATA%/SuperFigmaPipeline` on Windows, `~/Library/Application Support/SuperFigmaPipeline` on macOS, and `$XDG_STATE_HOME/super-figma-pipeline` on Linux with the documented platform fallback. Unix creates directory/file modes 0700/0600. On Windows, `state-permissions.ts` calls `whoami.exe /user /fo csv /nh` with `execFile` to parse the current SID, then invokes `icacls.exe` with separate argv operations to remove inheritance and grant the current SID plus SYSTEM (`S-1-5-18`) full control; it never uses a shell. Verification parses the `icacls.exe` listing for the resolved stateRoot path and permits only the current SID and SYSTEM allow ACEs; Administrators, Everyone, Users, Authenticated Users, or any unknown allow ACE fails startup.

WorkspaceConfigStore receives `WorkspaceUsageGuard` and `WorkspaceRegistrationResolver` constructor dependencies. Task4's checked-in v1 base has `add/list/remove`; Task7 7B removes authenticated use of `add`, reads v1 with `defaultWorkspaceId:null`, and on next mutation writes checksummed v2 `{version:2,workspaces:[...rootIdentityKey],defaultWorkspaceId,checksum}`. The final public mutation API is `addResolved`; any convenience `add(path)` survives only as a test/bootstrap helper outside `WorkspaceConfigStore` and cannot receive an authenticated principal or nonce. Setting a default requires an existing registration; removing current default fails `WORKSPACE_DEFAULT_IN_USE` until changed/cleared. Restart preserves it; corrupt/stale default fails closed.

`McpWorkspaceBinding` reads only this owner state when parsed args/effects require project filesystem access. An explicit valid default wins; with no default, exactly one configured workspace is selected; zero yields `MCP_WORKSPACE_REQUIRED`, and multiple yields `MCP_WORKSPACE_AMBIGUOUS`. It never selects the first sorted/root row. Figma-only/no-filesystem MCP calls retain workspaceId null. The local MCP adapter resolves a required binding once after tool args parse and before leader/follower choice, then carries the same server-resolved workspaceId through either path. Tool args, request body extensions, and MCP `_meta` cannot override it. Authenticated control/CLI retains explicit workspace selection. Tests cover null Figma-only, required zero/one/multiple, explicit default, cleared/removed/stale default, restart, leader↔follower parity, and forged body/_meta fields.

Workspace registration binds resolved identity at nonce issue. addResolved queues, revalidates/compares, consumes CAS, constructs record from expected bytes with no caller-path reinterpretation or external await between CAS completion and record construction. Swap at every pre-CAS await yields changed, nonce issued, rows/effects0. Durable config-write failure after consumed CAS is explicit COMMIT_OUTCOME_UNKNOWN, never retry. Every later policy access revalidates rootIdentityKey before content. Other safety unchanged.

### 3.5 Pairing, Resume, Follower, and Control Auth

~~~ts
export interface PairChallenge {
  challengeId: string;
  codeHash: string;
  expiresAt: number;
  attemptsRemaining: number;
}

export interface PairChallengeIssued {
  challengeId: string;
  code: string;
  expiresAt: number;
  attemptsRemaining: number;
}

export interface PairExchangeRequest { challengeId: string; code: string }
export interface PairExchangeResult { wsTicket: string; expiresAt: number }

export type HelloCredential =
  | { kind: 'ticket'; value: string }
  | { kind: 'resume'; value: string };

export interface AuthenticatedHello {
  credential: HelloCredential;
  nonce: string;
  protocolVersion: string;
  productVersion: string;
  pluginVersion: string;
  pluginGeneration: string;
  editorType: 'figma' | 'figjam' | 'dev';
  mode: string;
  fileIdentity: FileIdentity;
  fileName: string;
  capabilities: readonly string[];
}

export interface AuthenticatedHelloResult {
  sessionId: string;
  rotatedResumeToken: string;
  resumeExpiresAt: number;
}

/** Frozen in shared/auth.ts as PublicPingV1Schema / PublicPingV1. */
export type PublicPingV1 = {
  ok: true;
  product: 'super-figma-pipeline';
  protocolVersion: string;
  serverVersion: string;
  buildId: number;
  leaderGeneration: string;
  role: 'leader' | 'follower' | 'unknown' | 'conflicted';
};

export type McpSessionId = `mcp1_${string}`;
export type FollowerTransportRequestId = `sfp_req1_${string}`;
export interface FollowerTransportCall { path: '/rpc' | '/abdicate'; transportRequestId: FollowerTransportRequestId; plaintext: Uint8Array }
export interface AuthenticatedPlaintextRecord { readonly sequence: number; readonly final: boolean; readonly plaintext: Uint8Array }
export interface LeaderInfo { serverVersion: string; buildId: number; leaderGeneration: string }
export interface FollowerTransportClient {
  readonly mcpSession: McpSessionId;
  leaderInfo(signal?: AbortSignal): Promise<LeaderInfo | undefined>;
  open(call: FollowerTransportCall, signal: AbortSignal): Promise<AsyncIterable<AuthenticatedPlaintextRecord>>;
}
export interface FollowerResponseSink {
  write(plaintext: Uint8Array, options: { final: boolean }): Promise<void>;
  truncate(): Promise<void>;
}
export interface AuthenticatedFollowerRequest {
  readonly leaderGeneration: string;
  readonly mcpSession: McpSessionId;
  readonly transportRequestId: FollowerTransportRequestId;
  readonly requestDigest: string;
  readonly path: '/rpc' | '/abdicate';
  readonly plaintext: Uint8Array;
}
export interface FollowerTransportServer {
  serveChallengeHttp(req: IncomingMessage, res: ServerResponse): Promise<void>;
  serveHttp(req: IncomingMessage, res: ServerResponse, expectedPath: '/rpc' | '/abdicate', handler: (request: AuthenticatedFollowerRequest, response: FollowerResponseSink, subscriberSignal: AbortSignal) => Promise<void>): Promise<void>;
}
export interface FollowerGenerationAuthority { rotate(): Promise<{ generation: string; createdAt: number }> }
export interface FollowerControlAuthority { authorizeHttp(req: IncomingMessage): Promise<boolean> }
export interface FollowerAuthenticatedTransport {
  readonly client: FollowerTransportClient;
  readonly server: FollowerTransportServer;
  readonly generation: FollowerGenerationAuthority;
  readonly control: FollowerControlAuthority;
}

export type ControlRouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
export interface FrozenControlRouteExtension { handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> }
export class ControlRouteRegistry {
  register(prefix: string, handler: ControlRouteHandler): void;
  freeze(): FrozenControlRouteExtension;
}
~~~

- Control-authenticated `POST /control/pair/challenge` creates a public ten-character base32 `challengeId`, a cryptographically random eight-digit code, five-minute expiry, five attempts, and per-stateRoot rate limit. CLI displays two values and one paste form, for example `Pair ID: ABCDEFGHJK`, `Code: 12345678`, `SFP-ABCDEFGHJK-12345678`. The identifier is public; the code is the short-lived secret. Plugin UI accepts the paste form or two fields and sends both values.
- Plugin UI sends `POST /pair/exchange` with exact `PairExchangeRequest`, `Content-Type: application/json`, and 16 KiB cap. Success consumes the code and returns a random 128-bit one-use ticket valid for 30 seconds.
- WebSocket uses only `/ws`. Ticket/resume credential is sent in the first MessagePack hello, never URL/query/log. Ticket success returns a rotating resume token bound to session and plugin generation.
- A socket flap uses the resume token; plugin restart changes generation and requires re-pair unless a still-valid generation-bound credential exists. Every successful resume rotates the token and rejects the previous value.
- Task6.1 exports `PublicPingV1Schema`/`PublicPingV1`, `McpSessionIdSchema`, and `FollowerTransportRequestIdSchema` from shared auth; exports the facade interfaces above plus `createMcpSessionId`, `createFollowerTransportRequestId`, and `createFollowerAuthenticatedTransport` from `security/follower-transport.ts`; and keeps `follower-auth.ts` private behind that facade. It injects one stable `mcp1_` session and a separate `sfp_req1_` outer transport ID. The outer transport ID is never reused as inner `InvocationRequest.requestId`. Existing `Follower.sendRpc` collects one final; `FollowerTransportClient.open()` yields authenticated ordered plaintext records; Task7 never sees keys/outer records.
- Legacy `Follower.sendRpc(toolName,args,requestId,sessionId,timeoutMs,abort)` signature remains; caller ID such as `r-42` stays inside RpcRequest while outer ID is random128. Collector accepts only sequence0/final/nontruncated one-record response and validates inner response ID; Task7 uses `client.open()` instead.
- Private outer response records have only `seq`, `final`, `truncated`, and ciphertext semantics; each has a 16-byte header and 16-byte AEAD tag and is independently authenticated. Limits: cumulative plaintext 67,108,864; cumulative ciphertext 67,108,864; records4096; complete outer bytes67,239,936. Below/exact/above and truncation/reorder/duplicate/final-count tests belong to Task6.1.
- Record magic/version/flags/reserved/sequence/length, HTTP status/path/generation/challenge/requestDigest/mcpSession/transportRequestId are AEAD-bound. Sequence starts0/increments1, one final required, truncated only empty+final, no bytes after final; parser fills 16-byte header and checks caps before allocating ciphertext+tag. Bad tag yields zero plaintext. Challenge advertises transportVersion1 and old unary/content-type/challenge downgrade is rejected without fallback.
- Shared `auth.ts` owns strict `PublicPingV1Schema`; `/ping` is exactly `{ok,product,protocolVersion,serverVersion,buildId,leaderGeneration,role}`. Public active-session data is absent, and `Follower.resolveActiveSession()` returns `undefined` until Task7 installs its authenticated resolver. Plugin/session/file/capability facts move to `/control/status`.
- The frozen extension seam is literal: `ControlRouteRegistry.register` accepts exactly one root prefix `/control`, rejects `/control/...`, duplicate, and post-freeze registration, and `freeze().handle` matches only `/control` or `/control/...`. A handler returning true must have sent a response; one returning false must not have touched it. `attachLeaderEndpoints` authenticates the `/control` tree first, handles `/control/pair/challenge`, invokes the one frozen extension, then emits the authenticated default 404. Task7 registers one typed sibling router at this root; it does not mount another HTTP listener.
- PNA contract is literal. A plugin preflight is `OPTIONS /pair/exchange` with loopback Host, allowed Origin (`null`, `https://www.figma.com`, or `https://figma.com`), `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: content-type`, and `Access-Control-Request-Private-Network: true`. Success is 204 with the validated Origin echoed in `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: POST`, `Access-Control-Allow-Headers: content-type`, `Access-Control-Allow-Private-Network: true`, `Access-Control-Max-Age: 0`, and `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network`. No credentials header or wildcard is returned. Wrong path/Host/Origin/method/header/private-network value is 403 with no CORS/PNA allow headers. `POST /pair/exchange` requires the same Host/Origin allowlist. Null Origin is not identity; the one-time code/ticket is the credential. Logs and diagnostic bundles redact code/token fields but may retain the public challengeId.
- Actual pair POST CORS is equally binding. For an allowed Origin, success 200 and every typed 4xx/5xx response (`PAIR_CODE_WRONG`, `PAIR_CODE_EXPIRED`, `PAIR_CODE_USED`, `PAIR_RATE_LIMITED`, invalid JSON/body, internal safe error) echo that validated Origin value in `Access-Control-Allow-Origin`, plus `Access-Control-Allow-Private-Network: true` and `Vary: Origin`; they never use `*` or credentials. This lets the Figma UI read both ticket and actionable error JSON. Hostile Origin or absent Origin receives 403, `Vary: Origin`, no ACAO, no ACAPN, and no challenge/ticket oracle body. OPTIONS and POST tests cover all three allowed Origins plus hostile and absent Origin.

Task6.1 owns pair/abdicate/plugin WebSocket and all outer follower record/cumulative caps; Task7 owns only decrypted inner/control/direct-MCP/export limits. Every counter rejects before allocation/decode.

**Frozen Task6.1 handoff:** reviewed base commit `39a29373b91445e9242e82611f0a8a04fca525ea`; canonical facade/stream contract SHA-256 `bd296dabe872f08adca793d93a2cd6a2c7efca60c58127b07924b2f18840b27b`. Both final scoped Task6.1 reviews recorded `ADDRESSED`, Critical 0, Important 0. Commit `bc0cb93c0d8aa84167cea718c0b429a22d3c271d` and its older Task6 contract remain superseded for Task7 onward.

Design input is ignored workspace file `task-6-1-transport-design.md`, SHA-256 `b3811bbc4ca4baa6bc60f641cfa1df78ee167017627c279c8d1a5876d484868f`; it is architectural evidence, not the frozen code contract.

The contract manifest is derived from frozen Git blobs, never dirty worktree bytes. Sort the repo-relative paths below by ordinal UTF-8 bytes. For each path compute lowercase `SHA-256(file bytes)` from `git show 39a29373b91445e9242e82611f0a8a04fca525ea:<path>`, append the UTF-8 row `<path>\0<lowercase-sha256>\n`, concatenate without BOM, then SHA-256 the 925-byte manifest. This is the minimal complete Task6.1 producer **baseline snapshot**: six core paths are byte-frozen, while two adapter baselines freeze the semantics Task7 must preserve if 7C integrates the inner invocation stream. Task7-modifiable consumers such as `index.ts`, `node.ts`, `dispatch.ts`, shared inner `protocol.ts`/`rpc.ts`, Relay, plugin, and Task7 status are intentionally excluded.

| Sorted frozen source path | Freeze class | SHA-256 of exact Git blob bytes |
|---|---|---|
| `service/packages/mcp/src/election/control-route-registry.ts` | byte-frozen core | `d06800476ef4222b76ad3506dfab81c9c1bde145f591daad4d5d93ae34fda6f7` |
| `service/packages/mcp/src/election/follower.ts` | semantic adapter baseline | `0afa7a038644fc2e88d03cd9d4388d90b39f7829422a18ce2028588bd2fa2ad7` |
| `service/packages/mcp/src/election/leader-endpoints.ts` | semantic adapter baseline | `987525a5da9db2d2d3a852cdb4b9cb802d02181c36d17fbecce74d12bb8068f2` |
| `service/packages/mcp/src/security/follower-auth.ts` | byte-frozen core/private | `ead64222bed9dbdb9c0022a12b11a91307f29fcec8848984a9922f0f2acdb61e` |
| `service/packages/mcp/src/security/follower-transport.ts` | byte-frozen core/public facade | `e9599c7053cda26649101997ef44c575b094a05864b549d6bd3f2f4f8daa542f` |
| `service/packages/mcp/src/security/local-access.ts` | byte-frozen core | `8d7950df141199eaa2cb5eb2d6f0ef9b0cbd74dee1f33aa3690df70fbf957244` |
| `service/packages/mcp/src/security/request-limits.ts` | byte-frozen core | `8f3acd27dcb1c145eea703833c100d63133113d0844e6c5031c219fd1c3a7686` |
| `service/packages/shared/src/auth.ts` | byte-frozen core/public schema | `f3f458bfaf3b527638f46c974691304c011ac021192acb2bea1dd486f5013f51` |

Task7 never stages or imports private/core implementation beyond the public exports named above. `follower.ts` remains unchanged: the new `FollowerInvocationClient` consumes `FollowerTransportClient.open()` instead of weakening the legacy `Follower.sendRpc` wrapper. 7C alone may narrowly change `leader-endpoints.ts` to inject the Task7 inner `/rpc` handler. Its review record must show baseline blob `987525a5da9db2d2d3a852cdb4b9cb802d02181c36d17fbecce74d12bb8068f2`, the staged post-integration blob hash, and an unchanged `follower.ts` hash `0afa7a038644fc2e88d03cd9d4388d90b39f7829422a18ce2028588bd2fa2ad7`. Both 7C reviewers verify strict `PublicPingV1`, legacy `sendRpc`/abdication, outer facade/AAD/caps, literal control registry behavior, and `TASK6_1_FROZEN_GREEN`. Any byte-frozen core change returns to a separately reviewed Task6.1 amendment before Task7 can continue.

`TASK6_1_FROZEN_GREEN` means this exact command block; run it before and after every Task7 staged-tree review whose consumer integration touches entry, transport, control routing, or public health:

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/dispatch.test.ts packages/mcp/test/e2e
pnpm -C service typecheck
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts
~~~

### 3.6 Stable File Identity and Per-file Queue

~~~ts
export type FileIdentity =
  | { kind: 'figma-file-key'; value: string }
  | { kind: 'document-plugin-uuid'; value: string }
  | { kind: 'unstable-readonly'; sessionId: string; pluginGeneration: string };

export type FileExecutionKey = `figma:${string}` | `plugin-uuid:${string}` | `unstable:${string}:${string}`;

export declare function canonicalFileIdentityHash(identity: FileIdentity): `sha256:${string}`;

export interface IdentityBootstrapResultV1 {
  operationKind: 'system';
  operationName: 'identity.bootstrap';
  documentPluginUuid: string;
  requiresRehello: true;
}

export type IdentityBootstrapFrameV1 =
  | { version: 1; type: 'accepted'; operationId: string; operationKind: 'system'; operationName: 'identity.bootstrap' }
  | { version: 1; type: 'result'; operationId: string; result: IdentityBootstrapResultV1 }
  | { version: 1; type: 'error'; operationId: string; error: { code: string; retryable: false } };

export interface IdentityBootstrapCoordinator {
  requestForPairedUnstableSession(scope: ResolvedInvocationScope): AsyncIterable<IdentityBootstrapFrameV1>;
}
~~~

Task7 shared `invocation.ts` owns `FileIdentity`, `FileExecutionKey`, and the pure canonical hash before Task9/11. Hash bytes are `sfp-file-identity-v1\0`, one tag byte (`0x01` file-key, `0x02` plugin UUID, `0x03` unstable), then each exact UTF-8 field preceded by unsigned 32-bit big-endian byte length; unstable encodes sessionId then pluginGeneration. There is no Unicode normalization or case folding. `packages/shared/test/file-identity-hash.test.ts` fixes vectors, field order, length-prefix and cross-kind separation. Task9 file identity and Task11 graph/snapshot import this shared function; neither redefines it.

Use figma.fileKey when present. Without fileKey/shared UUID, initial authenticated hello is always `unstable-readonly` and read-only; hello never mutates. After Task9C paired approval channel is live, daemon alone may create internal `identity.bootstrap` system operation. It is not InvocationRequest, MCP tool, service registry or canonical count. It journals/HMAC-IDs like other operations, binds exact unstable session+generation/key, requires plugin-session approval, then dispatches internal `$identity/bootstrap`. Task9B top dispatcher invokes dedicated handler that writes UUID to document-root shared plugin data namespace/key `sfp/file-identity:v1`, returns mutated:true and owns exactly one commitUndo. File-identity module never commits.

Successful result forces plugin to send a new authenticated hello; daemon does not change Relay mapping from the operation response. Only the new hello with `document-plugin-uuid` replaces unstable mapping. Crash after dispatched is outcome-unknown/no autoretry; reconnect reads existing shared UUID and new hello reveals it, allowing operator to resolve unknown without another mutation. Read-only/Dev contexts reject `FILE_IDENTITY_BOOTSTRAP_UNAVAILABLE`, UUID absent remains unstable, and persistent snapshot/diff stays disabled until re-hello. Tests cover approval reject, crash at each arrow, duplicate ID, reconnect discovery, old-hello immutability and one undo. System count is one internal name while service remains2/tool counts unchanged.

Selector resolution never trusts a caller-supplied identity/key. `active` chooses the leader's current authenticated Relay session at admission and pins it; `session` first parses the exact 22-character ID with frozen `Base64Url128Schema`—including valid `_` and `-`—then looks up that authenticated session; `stable-file` looks up the hash in the leader's authenticated-session index and selects the healthy same-identity session with highest server-assigned monotonic `connectedSequence` (lexicographically smallest sessionId breaks a tie), while zero matches fail and a hash collision across different identities fails `TARGET_SELECTOR_AMBIGUOUS`; `none` resolves no plugin target. The resolved session's registered `FileIdentity` alone produces `figma:<fileKey>`, `plugin-uuid:<uuid>`, or `unstable:<registered-sessionId>:<registered-pluginGeneration>`. `fileName` is display-only. The frozen target/key remain unchanged through approval, queueing, runtime, progress, and result settlement; disappearance yields `PINNED_SESSION_LOST`.

Only a `server-adapter` whose `TargetRequirement` resolves to `forbidden` or `optional` may receive a null target. `plugin-direct` always requires a pinned target. `analyze_project`/`scan_components` reject non-none selectors, `ping` can return daemon health with none or use a pin for its typed round trip, and `doctor(roundTrip:false)` may use none while `doctor(roundTrip:true)` must pin. Target resolution never silently upgrades optional none to active.

### 3.7 Snapshot and Grounding

~~~ts
export const Sha256WireSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const Sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const SnapshotIdSchema = z.string().regex(/^sfp_snap1_[A-Za-z0-9_-]{21}[AQgw]$/);
export const RepoRelativePathSchema = z.string().min(1).max(4096).refine(value =>
  !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.includes('\\') &&
  !value.includes(':') && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..'),
);

export const SnapshotLocatorSchema = z.object({
  workspaceId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  fileIdentityHash: Sha256WireSchema,
  snapshotId: SnapshotIdSchema,
}).strict();
export type SnapshotLocator = z.infer<typeof SnapshotLocatorSchema>;

export interface SnapshotFidelity {
  detail: 'full';
  truncated: boolean;
  omitted: string[];
  unsupported: string[];
  visitedCount: number;
  expandedSections: SectionVisit[];
  completeLeafSections: SectionVisit[];
  issues: SectionIssue[];
}

export interface SectionVisit {
  nodeId: string;
  planPath: string[];
  order: number;
  depth: number;
  status: 'expanded-plan' | 'complete-leaf';
}

export interface SectionIssue {
  nodeId: string;
  planPath: string[];
  order: number;
  depth: number;
  status: 'failed' | 'omitted-cycle' | 'omitted-depth' | 'omitted-section-cap';
  code: string;
}

export interface SnapshotV1 {
  schemaVersion: 1;
  locator: SnapshotLocator;
  connector: {
    protocolVersion: string;
    productVersion: string;
    sessionId: string;
    pluginGeneration: string;
    fileIdentity: FileIdentity;
    fileName: string;
    editorType: string;
  };
  target: { nodeIds: string[] };
  observed: GetDesignContextResult;
  fidelity: SnapshotFidelity;
  capturedAt: string;
  contentHash: string;
  extensions: Record<string, unknown>;
}

export interface SnapshotReader {
  captureFull(scope: RuntimeExecutionScope, targetNodeIds: string[], signal: AbortSignal): Promise<SnapshotV1>;
}

export interface SnapshotStorageKey {
  workspaceId: string;
  fileIdentity: FileIdentity;
  fileIdentityHash: `sha256:${string}`;
  snapshotId: `sfp_snap1_${string}`;
}

export interface StoredSnapshotRef extends SnapshotLocator {
  relativePath: string;
  checksum: string;
  bytes: number;
  fidelity: SnapshotFidelity;
}

export interface SnapshotStoragePort {
  save(key: SnapshotStorageKey, snapshot: SnapshotV1): Promise<StoredSnapshotRef>;
  loadByLocator(locator: SnapshotLocator): Promise<{ ref: StoredSnapshotRef; snapshot: SnapshotV1 } | null>;
  list(workspaceId: string, fileIdentityHash: `sha256:${string}`): Promise<readonly StoredSnapshotRef[]>;
  delete(locator: SnapshotLocator, actorId: string, approvalId: string): Promise<void>;
}

export interface SnapshotCaptureArgs { nodeIds: [string, ...string[]] }
export interface SnapshotCaptureResult {
  snapshot: StoredSnapshotRef;
  graph: StoredGroundingGraphRef | null;
  graphIssue: null | { code: string; messageHash: `sha256:${string}` };
}

export type GroundingNodeKind = 'design-node' | 'component' | 'token' | 'code-file' | 'code-symbol';
export type GroundingEdgeKind = 'implements' | 'maps-token' | 'uses-component' | 'derived-from';
export type GroundingEdgeState = 'candidate' | 'verified' | 'stale';

export const GroundingNodeLocatorV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('figma-node'), nodeId: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('repo-path'), path: RepoRelativePathSchema }).strict(),
  z.object({ kind: z.literal('repo-symbol'), path: RepoRelativePathSchema, symbol: z.string().min(1).max(512) }).strict(),
]);

export const GroundingNodeV1Schema = z.object({
  nodeId: z.string().regex(/^sfp_gn1_[0-9a-f]{64}$/),
  kind: z.enum(['design-node', 'component', 'token', 'code-file', 'code-symbol']),
  locator: GroundingNodeLocatorV1Schema,
  contentHash: Sha256WireSchema,
}).strict();

export const GroundingEvidenceRefV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot-node'), nodeId: z.string().min(1).max(256), contentHash: Sha256WireSchema }).strict(),
  z.object({
    kind: z.literal('repo-range'), path: RepoRelativePathSchema,
    startLine: z.number().int().min(1).max(10000000),
    endLine: z.number().int().min(1).max(10000000),
    contentHash: Sha256WireSchema,
  }).strict().refine(value => value.endLine >= value.startLine),
]);

export const GroundingEvidenceV1Schema = z.object({
  source: z.enum(['automatic', 'human']),
  refs: z.array(GroundingEvidenceRefV1Schema).min(1).max(32),
  evidenceHash: Sha256WireSchema,
  verifiedBy: z.union([z.literal('system'), z.string().regex(/^actor1_[A-Za-z0-9_-]{43}$/)]),
  verifiedAt: z.iso.datetime({ offset: true }),
  baseVersion: z.number().int().min(1),
}).strict().superRefine((value, ctx) => {
  if ((value.source === 'automatic') !== (value.verifiedBy === 'system')) {
    ctx.addIssue({ code: 'custom', message: 'evidence source/verifier mismatch' });
  }
});

export const GroundingEdgeV1Schema = z.object({
  edgeId: z.string().regex(/^sfp_ge1_[0-9a-f]{64}$/),
  fromNodeId: z.string().regex(/^sfp_gn1_[0-9a-f]{64}$/),
  toNodeId: z.string().regex(/^sfp_gn1_[0-9a-f]{64}$/),
  kind: z.enum(['implements', 'maps-token', 'uses-component', 'derived-from']),
  state: z.enum(['candidate', 'verified', 'stale']),
  confidence: z.number().finite().min(0).max(1),
  evidence: z.array(GroundingEvidenceV1Schema).min(1).max(16),
}).strict();

const isStrictlySortedUnique = <T>(values: readonly T[], key: (value: T) => string): boolean =>
  values.every((value, index) => index === 0 || key(values[index - 1] as T) < key(value));

declare const canonicalJson: (value: unknown) => string;
declare const groundingGraphContentHash: (value: unknown) => `sha256:${string}`;

export const GroundingGraphV1Schema = z.object({
  schemaVersion: z.literal(1),
  graphVersion: z.number().int().min(1),
  graphId: z.string().regex(/^grounding:sfp_snap1_[A-Za-z0-9_-]{21}[AQgw]$/),
  locator: SnapshotLocatorSchema,
  fileIdentity: FileIdentitySchema,
  snapshotContentHash: Sha256WireSchema,
  baseGraphContentHash: Sha256WireSchema.nullable(),
  nodes: z.array(GroundingNodeV1Schema).max(100000),
  edges: z.array(GroundingEdgeV1Schema).max(200000),
  refreshedAt: z.iso.datetime({ offset: true }),
  contentHash: Sha256WireSchema,
}).strict().superRefine((graph, ctx) => {
  const nodeIds = new Set(graph.nodes.map(node => node.nodeId));
  const edgeIds = new Set(graph.edges.map(edge => edge.edgeId));
  if (graph.graphId !== `grounding:${graph.locator.snapshotId}`)
    ctx.addIssue({ code: 'custom', path: ['graphId'], message: 'graph/locator mismatch' });
  if (canonicalFileIdentityHash(graph.fileIdentity) !== graph.locator.fileIdentityHash)
    ctx.addIssue({ code: 'custom', path: ['fileIdentity'], message: 'file identity hash mismatch' });
  if (nodeIds.size !== graph.nodes.length || !isStrictlySortedUnique(graph.nodes, node => node.nodeId))
    ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'node IDs must be unique and sorted' });
  if (edgeIds.size !== graph.edges.length || !isStrictlySortedUnique(
    graph.edges, edge => `${edge.fromNodeId}\0${edge.toNodeId}\0${edge.kind}\0${edge.edgeId}`,
  )) ctx.addIssue({ code: 'custom', path: ['edges'], message: 'edge keys must be unique and sorted' });
  for (const [edgeIndex, edge] of graph.edges.entries()) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId))
      ctx.addIssue({ code: 'custom', path: ['edges', edgeIndex], message: 'edge endpoint missing' });
    if (!isStrictlySortedUnique(edge.evidence, evidence => `${evidence.source}\0${evidence.evidenceHash}\0${evidence.verifiedAt}`))
      ctx.addIssue({ code: 'custom', path: ['edges', edgeIndex, 'evidence'], message: 'evidence must be unique and sorted' });
    for (const [evidenceIndex, evidence] of edge.evidence.entries()) {
      if (evidence.baseVersion > graph.graphVersion)
        ctx.addIssue({ code: 'custom', path: ['edges', edgeIndex, 'evidence', evidenceIndex, 'baseVersion'], message: 'future evidence version' });
      if (!isStrictlySortedUnique(evidence.refs, ref => canonicalJson(ref)))
        ctx.addIssue({ code: 'custom', path: ['edges', edgeIndex, 'evidence', evidenceIndex, 'refs'], message: 'evidence refs must be unique and sorted' });
    }
  }
  if (groundingGraphContentHash(graph) !== graph.contentHash)
    ctx.addIssue({ code: 'custom', path: ['contentHash'], message: 'content hash mismatch' });
});
export type GroundingGraphV1 = z.infer<typeof GroundingGraphV1Schema>;

export interface StoredGroundingGraphRef extends SnapshotLocator {
  graphId: `grounding:${string}`;
  relativePath: string;
  checksum: string;
  contentHash: string;
  bytes: number;
  refreshedAt: string;
  edgeCount: number;
  staleEdgeCount: number;
}

export interface GraphStoragePort {
  create(key: SnapshotStorageKey, graph: GroundingGraphV1): Promise<StoredGroundingGraphRef>;
  loadByLocator(locator: SnapshotLocator): Promise<{ ref: StoredGroundingGraphRef; graph: GroundingGraphV1 } | null>;
  replaceByLocator(locator: SnapshotLocator, graph: GroundingGraphV1, expectedChecksum: `sha256:${string}`, actorId: string, approvalId: string): Promise<StoredGroundingGraphRef>;
  list(workspaceId: string, fileIdentityHash: `sha256:${string}`): Promise<readonly StoredGroundingGraphRef[]>;
}

export interface GroundingRefreshArgs {
  locator: SnapshotLocator;
  expectedGraphChecksum: `sha256:${string}` | null;
}
export interface GroundingRefreshResult {
  graph: StoredGroundingGraphRef;
  checkedCodeRefs: number;
  verifiedEdges: number;
  staleEdges: number;
}
~~~

`SnapshotCaptureArgsSchema` is strict, requires 1–256 unique normalized node IDs, and rejects unknown keys; workspace/selector/operationId remain in `ServiceOperationRequestV1`. `SnapshotCaptureResultSchema`, `GroundingRefreshArgsSchema`, `StoredGroundingGraphRefSchema`, and `GroundingRefreshResultSchema` are strict Zod authorities. `snapshot.capture` requires a pinned target and server-issues `sfp_snap1_` plus 128 random bits encoded as exact 22-character base64url. `grounding.refresh` requires selector `none`, receives a strict locator, and requires request workspaceId to equal `locator.workspaceId`; it never resolves an active plugin.

`@sfp/ir` owns schemas/ports/codecs; MCP adapters consume workspace/atomic/repo ports. Valid wire hash `sha256:<64hex>` must succeed; storage extracts only verified digest after schema. Snapshot/graph paths are `.sfp/{snapshots|grounding-graphs}/v1/{fileIdentityDigest}/{snapshotId}.json`. Design-diff path is `.sfp/design-diff-baselines/v1/{fileIdentityDigest}/{nodeIdDigest}.json`, where nodeIdDigest is lowercase hex SHA-256 of `UTF8('sfp-node-path-v1\0') || UTF8(exactRawNodeId)` with no normalization. Stored baseline embeds exact rawNodeId+nodeIdDigest and load recomputes both before use. No wire prefix/colon/slash/backslash/drive/UNC/ADS/dot segment reaches join. Tests separately prove valid wire hash→digest path success, malformed wire hash rejection, malicious raw segment rejection, exact-node roundtrip, traversal-like node IDs safely hash, and synthetic digest collision/mismatched embedded node rejection.

`loadByLocator` first resolves only the approved workspace plus digest/snapshotId path, strict-parses the stored object, then reads its embedded full `fileIdentity` and recomputes the canonical wire hash. It requires stored locator workspace/hash/id, recomputed identity hash, graphId, and snapshot locator all equal the request before returning. `replaceByLocator` repeats those checks and exact checksum CAS immediately before atomic replace. Wrong workspace/hash/id, embedded identity mismatch, traversal, stale checksum, and concurrent CAS loser never overwrite.

Capture resolves one session, requests full context, and processes nested section plans with a bounded work queue: stable depth-first pre-order, concurrency two, visited key `(pluginGeneration,nodeId)`, maximum depth 8, maximum 256 fetched sections across the capture. A section that returns another plan is recursively expanded; cycle/depth/count omissions and failed descendants are recorded with their plan path in fidelity. Merge uses stable plan order and node IDs while preserving child order. It never relabels a degraded payload as complete. Snapshot contentHash excludes locator.snapshotId/capturedAt and includes full file identity, target, observed, and fidelity. Snapshot capture is authenticated control-only and does not add another MCP tool.

Task11 owns `canonicalJson` and `groundingGraphContentHash` in IR, but imports `canonicalFileIdentityHash` from Task7 `@sfp/shared`; tests import those same authorities and forbid a shadow hash helper. Graph validation rejects duplicate node/edge IDs, missing edge endpoints, duplicate evidence refs, evidence whose `baseVersion` exceeds graphVersion, invalid source/verifier pairing, unsorted/duplicate semantic keys, confidence outside `[0,1]`, and every declared count/string boundary. Builders sort nodes by nodeId; edges by `(fromNodeId,toNodeId,kind,edgeId)`; evidence by `(source,evidenceHash,verifiedAt)`; refs by canonical JSON before strict parse. contentHash is domain `sfp-grounding-graph-v1` over schemaVersion, graphVersion, locator, canonical full identity, snapshotContentHash, baseGraphContentHash, and sorted nodes/edges with `refreshedAt`/`contentHash` omitted. Checksum covers complete stored canonical JSON.

Capture commits snapshot first, then graph; graph failure returns `graph:null` plus a hashed issue. Refresh loads snapshot/current graph by locator, scans RepoReader, and performs exact checksum CAS. It may add or update automatic evidence, mark automatic edges stale, and increment graphVersion/baseVersion; it may not delete, reorder semantically, alter, or downgrade any human evidence byte. A human edge can change only through a separately approved future human-evidence command, absent in v0.1. `expectedGraphChecksum:null` is create-only; nonnull is replace-only. Boundaries cover zero/max/above nodes (100,000), edges (200,000), 16 evidence entries/edge, 32 refs/evidence, path/symbol/node-ID lengths, line range, graph/base versions, and hash formats. Refresh needs approval and never calls Figma.

Binding amendment: Task11 registers service operations `snapshot.capture` and `grounding.refresh`; neither adds an MCP tool.

### 3.8 New Four Tool Contracts

~~~ts
export interface ExportTokensArgs { format: 'json' | 'css'; mode?: string; outPath?: string }
export interface ExportTokensResult { format: 'json'|'css'; content?: string; path?: string; tokenCount: number; warnings: string[] }

export interface ExportFramesToPdfArgs { nodeIds: [string, ...string[]]; outPath: string }
export interface ExportFramesToPdfResult { path: string; nodeIds: string[]; pageCount: number; bytesWritten: number; warnings: string[] }

export interface DoctorArgs { roundTrip?: boolean }
export interface DoctorCheck { id: string; status: 'pass'|'warn'|'fail'; code: string; message: string }
export interface DoctorResult { overall: 'healthy'|'degraded'|'unavailable'; checks: DoctorCheck[] }

export interface ImportLibraryVariableArgs { key: string }
export interface ImportLibraryVariableResult {
  ok: true;
  id: string;
  key: string;
  name: string;
  resolvedType: string;
  collectionId: string;
}
~~~

`export_tokens`, `export_frames_to_pdf`, and `doctor` are handlerAuthority server-only plus execution server-adapter. `import_library_variable` alone adds plugin handler106 and is plugin-direct. Target requirements follow section3.2. CSS exports requested/default mode with warnings; JSON preserves modes/aliases.

### 3.9 Ordered PDF Merge Algorithm

`service/packages/mcp/src/execution/pdf-merge.ts` uses pinned `pdf-lib`:

~~~ts
export async function mergeSinglePagePdfs(pages: readonly Uint8Array[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('PDF_PAGES_EMPTY');
  const output = await PDFDocument.create();
  for (const [index, bytes] of pages.entries()) {
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    if (source.getPageCount() !== 1) throw new Error(`PDF_PAGE_COUNT_INVALID:${index}`);
    const [copied] = await output.copyPages(source, [0]);
    if (copied === undefined) throw new Error(`PDF_PAGE_COPY_FAILED:${index}`);
    output.addPage(copied);
  }
  return output.save();
}
~~~

The runtime pins one plugin session, requests existing `export_pdf({nodeId,binary:true})` with concurrency two, restores caller order before merge, rejects corrupt/encrypted/non-single-page input, and uses atomic create-new output. It never creates a second PDF plugin handler.

### 3.10 Remote Image Fetcher

~~~ts
export interface RemoteImagePolicy {
  allowedDomains: readonly string[];
  maxRedirects: number;
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}

export interface RemoteDomainRule {
  fqdnAscii: string;
  addedBy: string;
  addedAt: string;
}

export interface RemoteDomainConfigStore {
  add(actorId: string, fqdnInput: string): Promise<RemoteDomainRule>;
  list(): Promise<readonly RemoteDomainRule[]>;
  remove(actorId: string, fqdnAscii: string): Promise<void>;
}

export interface PinnedAddress { address: string; family: 4 | 6 }

export interface RemoteImageFetcher {
  fetchApproved(url: string, policy: RemoteImagePolicy, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string; finalUrlHash: string }>;
}
~~~

The daemon accepts HTTPS only, rejects userinfo and IP-literal URLs, resolves every redirect hop, blocks loopback/private/link-local/multicast/unspecified IPv4 and IPv6, revalidates hostname/domain and DNS answers at every hop, limits redirects, checks Content-Length and streamed bytes, sniffs PNG/JPEG/GIF/WebP signatures against MIME, and aborts over limit. It connects with `node:https.request`: a custom lookup callback (`lookup`) returns one vetted `PinnedAddress`, TLS `servername` and Host remain the original hostname, default `tls.checkServerIdentity` verifies the certificate, and `secureConnect` verifies `socket.remoteAddress` belongs to the vetted set. Every redirect creates a new resolution and pinned connection; a later ordinary hostname lookup is forbidden. Approval happens before the first DNS request. The plugin receives bytes through `createImage`; direct URL payload and wildcard network permission are removed.

Default remote image policy is three redirects, 6 MiB decoded bytes, and MIME allowlist `image/png`, `image/jpeg`, `image/gif`, `image/webp`. The initial allowed-domain set is empty. v0.1 supports exact-host equality only—no suffix/subdomain rule and no PSL dependency. Config input passes through `domainToASCII`, lowercases, rejects trailing dot, wildcard/leading dot/port/path/userinfo/IP literal, and requires three or more RFC hostname labels; this intentionally rejects one/two-label entries such as `com`, `co.uk`, and apex `example.com`, while allowing exact asset hosts such as `assets.example.com`. Redirect hostname must be independently present as an exact rule. Approval cannot add a host.

### 3.11 Progress Transport

~~~ts
export interface ProgressEvent {
  operationId: string;
  phase: string;
  completed: number;
  total: number | null;
  message: string;
  emittedAt: number;
}

export interface ProgressReporter {
  report(event: Omit<ProgressEvent, 'operationId' | 'emittedAt'>): void;
  throwIfCancelled(): void;
}

export type InvocationFrameV1 =
  | { version: 1; type: 'accepted'; requestId: `sfp_req1_${string}`; operationId: string; operationKind: 'tool' | 'service'; operationName: ToolName | ServiceOperationName }
  | { version: 1; type: 'progress'; requestId: `sfp_req1_${string}`; operationId: string; progress: ProgressEvent }
  | { version: 1; type: 'result'; requestId: `sfp_req1_${string}`; operationId: string; result: unknown }
  | { version: 1; type: 'error'; requestId: `sfp_req1_${string}`; operationId: string; error: { code: string; message: string; retryable: boolean } };

export interface InvocationFrameSink {
  emit(frame: InvocationFrameV1, signal: AbortSignal): Promise<void>;
  close(reason: 'terminal' | 'disconnect' | 'deadline' | 'demotion'): Promise<void>;
}

export interface ProgressTransportLimits {
  maxPhaseCharacters: 64;
  maxMessageUtf8Bytes: 1024;
  maxProgressFrameBytesIncludingPrefix: 16384;
  maxSubscriberFrames: 64;
  maxSubscriberBytes: 262144;
  maxProgressFramesPerSecond: 20;
}

export interface InvocationAdmissionLimits {
  maxActiveOperationsPerOwner: 256;
  maxActiveOperationsPerAuthSession: 64;
  maxSubscribersPerOperation: 8;
  maxSubscribersPerOwner: 256;
  maxRawArgsBytesPerOperation: 8388608;
  maxRawArgsBytesPerOwner: 67108864;
  requestIdCharacters: 31;
  maxToolNameCharacters: 128;
  workspaceIdCharacters: 36;
  sessionSelectorCharacters: 22;
  targetSelectorMaxBytes: 115;
}
~~~

Malformed outer/inner framing, unknown fields, invalid IDs, missing requestId, registry misses, and over-limit input are native admission rejections: no operation ID/record, `accepted`, progress, runtime, or terminal operation frame. Every recoverably admitted tool/service request has its initial durable operation row before exactly one `accepted` frame, then zero or more progress frames and exactly one terminal result/error. From acceptance onward one generation-fenced terminal CAS arbitrates runtime, validation, cancel, deadline, disconnect recovery, and demotion; every loser observes the winner and emits no second terminal. All schemas are strict and versioned. Section 3.12 owns inclusive phase/message/frame/subscriber/rate boundaries. The terminal frame takes an exclusive direct write/drain slot outside the bounded nonterminal subscriber queue and blocks later progress. If direct terminal drain misses the absolute deadline, the transport closes while durable status remains queryable. Backpressure awaits drain and never grows an unbounded buffer.

Acceptance timing is deterministic: an approval-required operation emits accepted only after pending-approval fsync and before waiting; an operation requiring no approval emits accepted only after pre-egress reservation and durable queue admission, before dispatched transition. Policy/target/capacity/pre-egress rejection before acceptance is a typed admission rejection with runtime zero; any failure after acceptance goes through terminal CAS and emits one terminal frame.

Task6.1 facade authenticates/reassembles outer records and yields ordered plaintext Buffers. Task7 parses inner four-byte length+strict MessagePack tool/service/cancel; inner total max9,437,184, payload9,437,180. Follower response inner cumulative plaintext67,108,864. Control/direct bounds remain exact. Task7 never parses outer seq/final/truncated/ciphertext.

Task 7 owns shared frame/progress/cancel schemas, daemon adapters, and a fake plugin-port consumer only. It may define the plugin-facing `$progress`/`$cancel` schema and enforce a 67,108,864-byte plugin frame cap in daemon/fake tests, but it does not modify or claim the real plugin consumer. Exact plugin UI/main/dispatcher consumption, listener cleanup, cancel forwarding, and parity tests are Task 9A; packed-artifact parity is Task 15. Direct MCP maps progress/cancel to the standard progress token/cancellation notification. A transport disconnect does not implicitly cancel, retry, or issue a new operation ID.

Progress extends only the idle deadline; it never extends the absolute deadline. Absolute deadline, exact-origin-session `InvocationCancelV1`, plane demotion, and runtime AbortSignal are authoritative. Cancellation is idempotent and requires stable actor plus exact `originAuthSessionId`, requestId, and operationId; owner-admin control may resolve but cannot cross-session cancel. Snapshot, ordered PDF, and video export emit through the same reporter. Pre-execution/final egress manifests contain only classes/counts/hash/reason metadata.

The authenticated follower inner logical media type is exactly `application/x-sfp-msgpack-stream`; Task6.1 wraps/encrypts externally but delivers only authenticated decrypted plaintext to Task7.

### 3.12 Inclusive Limits, Admission, and Boundary Fixtures

Every row has table-driven `below`, `exact`, and `above` tests for declared length and chunked/streamed input where applicable. Counters run before allocation, concatenation, base64/MessagePack/JSON decode, journal append, queueing, or runtime. “Exact held” means persisted state at the cap is valid but the next admission fails; “exact triggers” means the threshold operation runs compaction; “expired exact” means `now - issuedAt >= TTL`.

~~~ts
export interface CapacityCounterPort {
  snapshot(scope: string): Readonly<{ rows: number; bytes: number }>;
  reserve(scope: string, rows: number, bytes: number): boolean;
  release(scope: string, rows: number, bytes: number): void;
}
~~~

| Authority | Below | Exact boundary | Above / next admission |
|---|---|---|---|
| operation ID horizon | `< 2,592,000,000 ms` valid | `2,592,000,000 ms` expired, runtime zero | expired, runtime zero |
| operation ID future skew | `< 300,000 ms` valid | `300,000 ms` valid | invalid, runtime zero |
| action nonce TTL | `< 120,000 ms` valid | `120,000 ms` expired | expired |
| approval prompt TTL | `< 120,000 ms` pending decision valid | `120,000 ms` expired | late/duplicate decision rejected, runtime zero |
| action nonce rows/bytes per actor | below `1,024` and `524,288` admits | exact held valid; next issue fails | recovery with above fails closed |
| journal compaction | below `8,000` rows/`25,165,824` bytes does not compact | either exact threshold triggers | above must compact before admission |
| journal normal cap | below `10,000` rows and `32,505,856` bytes admits | exact held valid; next ordinary append fails | above recovery fails closed |
| resolution reserve/total | below `1,048,576` reserve and `33,554,432` total admits | exact held valid; next reserve append fails | above recovery fails closed |
| tombstone index | below `1,000,000`/`268,435,456` admits | exact held valid; next tombstone fails | above recovery fails closed |
| egress row (canonical JSON + LF) | `< 65,536` bytes valid | `65,536` valid | `65,537` rejected before runtime |
| egress compaction | below `160,000`/`201,326,592` does not compact | either exact threshold triggers | above must compact before reserve |
| egress hard cap | enough room for pre row + one 65,536-byte finalizer admits | exact `200,000`/`268,435,456` held valid; a reservation that would cross either cap fails | above recovery fails closed; no capacity release without finalizer fsync |
| progress phase | 63 ASCII chars valid | 64 valid | 65 invalid |
| progress message | 1,023 UTF-8 bytes valid | 1,024 valid | 1,025 invalid |
| inner progress frame | total prefix+payload `16,383` valid | `16,384` valid (`payload <= 16,380`) | `16,385` invalid |
| subscriber queue | below 64 frames and 262,144 bytes admits | exact buffered state valid; next same-phase coalesces, cross-phase waits | never allocates above; terminal uses direct drain slot |
| progress rate | first 19 in half-open `[t,t+1000)` pass | 20th passes | 21st same-phase coalesces/cross-phase waits; `t+1000` starts a new window |
| pair/abdicate body | `16,383` bytes valid | `16,384` valid | `16,385` rejected by Task6.1 before JSON decode |
| Task6.1 `/abdicate` plaintext/ciphertext | `16,383` each valid | `16,384` each valid | next byte rejected before decrypt/dispatch |
| Task6.1 `/rpc` request plaintext/ciphertext | `9,437,183` each valid | `9,437,184` each valid | next byte rejected before decode/concat |
| follower decrypted request | total `9,437,183` valid | total `9,437,184` valid, including 4-byte prefix and payload `9,437,180` | prefix declaration or stream byte `9,437,185` rejected before allocation/MessagePack |
| Task6.1 outer response records | 4,095 records valid | 4,096 valid; each exact 16-byte header + ciphertext + 16-byte tag | 4,097 rejected; duplicate/reordered/missing-final/truncated semantics fail closed |
| Task6.1 outer cumulative plaintext/ciphertext | `67,108,863` each valid | `67,108,864` each valid | next byte rejected before concat/yield |
| Task6.1 single outer frame | `67,108,895` valid | `67,108,896` = 16 header + 67,108,864 ciphertext + 16 tag valid | next byte rejected |
| Task6.1 complete outer response | `67,239,935` valid | `67,239,936` valid | next byte rejected |
| control/direct MCP logical request | `9,437,183` bytes valid | `9,437,184` valid | `9,437,185` rejected before JSON/schema parse |
| follower response cumulative | `67,108,863` bytes valid | `67,108,864` valid | next byte aborts stream without changing durable terminal state |
| plugin WebSocket frame | `67,108,863` bytes valid | `67,108,864` valid | next byte rejected before decode |
| decoded/base64 image | `6,291,455` decoded and `8,388,607` base64 valid | `6,291,456` decoded and `8,388,608` base64 valid | above either bound rejected before plugin runtime |
| video result | `50,331,647` bytes valid | `50,331,648` valid | next byte returns `EXPORT_TOO_LARGE` without partial result |
| completed-result cache | below 128 entries/8,388,608 bytes/60,000 ms is resident | exact count/bytes resident; age exactly 60,000 ms expires | count/bytes admission evicts LRU; age above expires; durable settled rule remains |
| active operations per owner | 255 admitted | 256 admitted | 257th native `SERVER_BUSY`, no record/runtime |
| active operations per auth session | 63 admitted | 64 admitted | 65th native `SERVER_BUSY` |
| subscribers per operation | 7 admitted | 8 admitted | 9th native `SERVER_BUSY` |
| subscribers per owner | 255 admitted | 256 admitted | 257th native `SERVER_BUSY` |
| canonical serialized rawArgs per operation | 8,388,607 bytes admitted | 8,388,608 admitted | 8,388,609 rejected; leaves 1,048,572 inner-payload bytes for envelope fields |
| aggregate retained rawArgs per owner | 67,108,863 bytes admitted | 67,108,864 admitted | next byte rejected before retention |
| requestId | 30/32 or wrong pattern invalid | exact 31 chars `sfp_req1_`+22 base64url valid | any non-exact length/pattern invalid before map lookup |
| tool name | 127 lower-snake chars valid | 128 valid | 129, dotted, slash, uppercase, or bad first char invalid |
| service operation name | exact `snapshot.capture` and `grounding.refresh` valid | the two literals remain valid under 128-char syntax cap | empty, 128/129-char non-enum dotted values, snake/slash/case/extra-dot variants invalid |
| workspaceId | 35/37 or non-UUID invalid | canonical lowercase UUIDv4 exactly36 valid | invalid before workspace lookup |
| session selector | 21/23 characters invalid | exact22 `Base64Url128Schema`; `SESSION_ID_WITH_UNDERSCORE` valid | bad trailing quantum/padding/alphabet rejected before lookup |
| canonical target selector JSON | none15 / active17 / session55 bytes valid | stable-file exact115 bytes with `sha256:`+64hex is the reachable maximum | 116+ can only be unknown/invalid pre-schema input and is rejected; separate logical envelope cap remains9,437,184 |
| snapshot ID / file hash path segment | 21/23 base64url suffix invalid; verified 63-hex digest invalid | `sfp_snap1_`+22 base64url and extracted 64-lowerhex digest valid | `sha256:`/colon, slash, backslash, drive/UNC/ADS, dot segment rejected before filesystem |
| design-diff node path | any exact UTF-8 raw nodeId hashes safely | exact64hex domain-separated nodeIdDigest used as path segment and embedded raw ID re-verifies | forged digest/raw mismatch or synthetic collision rejected; raw ID never joins path |
| grounding nodes/edges | below 100,000/200,000 valid | exact counts valid | next node/edge rejected before canonicalization/storage |
| grounding evidence/refs | below 16 evidence/edge and 32 refs/evidence valid | exact counts valid | next entry rejected; human evidence remains immutable |

Counts reserve before retaining raw args and release only after terminal durability; duplicate active requestId is native `REQUEST_ID_CONFLICT`. Million-row/256-MiB journal/egress/tombstone boundaries use production `CapacityCounterPort` plus sparse metadata stores so tests do not allocate a million objects or hundreds of MiB. Transport/payload boundaries use real declared and chunked byte streams at below/exact/above—never mocked counters—before MessagePack/JSON/base64 decode.

`packages/mcp/test/execution/boundary-limits.test.ts` is the single table authority and imports the production constants. It covers below/exact/above, declared/chunked, pre-decode/runtime-zero, active operation/subscriber/raw-args admission, malformed/missing requestId native rejection, and exact-one-terminal races among result/cancel/deadline/demotion.

### 3.13 Unsigned Source-complete Preview and Local Diagnostics

~~~ts
export type Sha256Hex = string; // JSON Schema pattern ^[0-9a-f]{64}$
export type PrefixedSha256 = `sha256:${string}`; // suffix pattern ^[0-9a-f]{64}$

export const REQUIRED_BLOCKING_CHECK_IDS = {
  fake: [
    'fake.artifact-integrity', 'fake.daemon-health', 'fake.state-permissions',
    'fake.pair-resume', 'fake.design-context-recursive', 'fake.grounding-maps',
    'fake.snapshot-graph', 'fake.token-pdf-export', 'fake.idempotency-journal',
    'fake.write-fifo', 'fake.approval-undo', 'fake.generation-reconnect',
    'fake.workspace-policy', 'fake.network-policy', 'fake.capability-matrix',
    'fake.diagnostic-redaction',
  ],
} as const;

export interface PreviewCandidateV1 {
  schemaVersion: 1;
  previewVersion: '0.1.0';
  implementationStatus: 'source-complete-preview';
  externalValidationStatus: 'not-run';
  sourceCommit: string; // ^[0-9a-f]{40}$
  sourceDateEpoch: number;
  artifactManifestSha256: Sha256Hex;
  artifactChecksumsSha256: Sha256Hex;
  harnessManifestHash: Sha256Hex;
  artifacts: { mcpSha256: Sha256Hex; cliSha256: Sha256Hex; pluginSha256: Sha256Hex };
  contentHash: PrefixedSha256;
}

export interface SourceCompleteEvidenceV1 {
  schemaVersion: 1;
  evidenceId: `sfp_preview_ev1_${string}`; // ^sfp_preview_ev1_[A-Za-z0-9_-]{22}$
  evidenceKind: 'unsigned-local-preview';
  sourceCommit: string; // ^[0-9a-f]{40}$
  createdAt: string;
  status: 'pass';
  previewCandidateContentHash: PrefixedSha256;
  artifacts: {
    manifestSha256: Sha256Hex;
    checksumsSha256: Sha256Hex;
    mcpSha256: Sha256Hex;
    cliSha256: Sha256Hex;
    pluginSha256: Sha256Hex;
    buildId: number;
    task61ContractSha256: 'bd296dabe872f08adca793d93a2cd6a2c7efca60c58127b07924b2f18840b27b';
  };
  harness: { version: 1; manifestHash: Sha256Hex; fakeResultHash: Sha256Hex };
  checks: readonly {
    id: typeof REQUIRED_BLOCKING_CHECK_IDS.fake[number];
    status: 'pass';
    durationMs: number;
    resultHash: Sha256Hex;
    detailCode: string;
  }[];
  contentHash: PrefixedSha256;
}

export interface SourceCompletePreviewV1 {
  schemaVersion: 1;
  implementationStatus: 'source-complete-preview';
  externalValidationStatus: 'not-run';
  sourceCommit: string;
  harnessManifestHash: Sha256Hex;
  candidateFileSha256: Sha256Hex;
  candidateContentHash: PrefixedSha256;
  evidenceFileSha256: Sha256Hex;
  evidenceContentHash: PrefixedSha256;
  generatedAt: string;
  contentHash: PrefixedSha256;
}
~~~

`PreviewCandidateV1.harnessManifestHash` is the lowercase SHA-256 of a UTF-8 manifest assembled from these exact sorted repo-relative paths at `sourceCommit` (never from worktree bytes):

~~~text
.github/workflows/service-ci.yml
service/.node-version
service/package.json
service/packages/mcp/package.json
service/packages/mcp/src/application.ts
service/packages/mcp/src/daemon-entry.ts
service/packages/mcp/src/index.ts
service/packages/mcp/test/application.test.ts
service/packages/mcp/test/e2e/daemon-entry.test.ts
service/packages/mcp/tsdown.config.ts
service/pnpm-lock.yaml
service/schemas/preview-candidate-v1.schema.json
service/schemas/source-complete-evidence-v1.schema.json
service/schemas/source-complete-preview-v1.schema.json
service/scripts/current-windows-diagnostic.mjs
service/scripts/package-artifacts.mjs
service/scripts/run-fake-source-checks.mjs
service/scripts/source-complete-validator.mjs
service/scripts/verify-artifacts.mjs
service/scripts/write-preview-candidate.mjs
service/scripts/write-source-complete-preview.mjs
service/test/blocking-check-fixture-map.test.ts
service/test/current-windows-diagnostic.test.ts
service/test/daemon-artifact-surface.test.ts
service/test/evidence-schema-draft.test.ts
service/test/preview-candidate.test.ts
service/test/source-complete-evidence.test.ts
service/test/source-harness-binding.test.ts
service/test/workflow-hygiene.test.ts
service/vitest.artifacts.config.ts
service/vitest.config.ts
~~~

For each path, read bytes with `git show <sourceCommit>:<path>`, compute lowercase SHA-256, append UTF-8 `<path>\0<sha256>\n`, and hash the ordered manifest. Missing/extra/reordered paths, dirty substitutes, a Node/package/lock mismatch, or any checked Git-blob mismatch fails local validation.

One Ajv module exports exactly three strict assertions for unsigned `PreviewCandidateV1`, `SourceCompleteEvidenceV1`, and `SourceCompletePreviewV1`; local typed-fake and co-presence parsers are not additional persisted schemas. Canonical JSON omits only the object's own `contentHash` and uses, respectively, `sfp-preview-candidate-v1\0`, `sfp-source-complete-evidence-v1\0`, and `sfp-source-complete-preview-v1\0`. Evidence embeds the complete sorted fake16 check array; there is no intermediate result document.

After the clean Task16 commit, `verify:source-complete` creates exactly three ignored files under `service/artifacts/`: `preview-candidate.v1.json`, `source-complete-evidence.v1.json`, and `source-complete-preview.v1.json`. Each writer uses an exclusive same-directory temporary file, fsync, atomic file replacement, reread/schema/content-hash verification, and parent fsync where supported. The marker rereads candidate and evidence bytes, verifies `candidateFileSha256`/`evidenceFileSha256`, requires `candidateContentHash===candidate.contentHash` and `evidenceContentHash===evidence.contentHash`, and requires identical source commit, harness manifest, artifact manifest/checksum, and artifact tuple across candidate/evidence before hashing itself. No content hash becomes a path segment.

Task16 refactors composition from `packages/mcp/src/index.ts` into `packages/mcp/src/application.ts` with `createMcpApplication(options): Promise<{startHttp,attachStdio,close}>`. Existing `index.ts` remains only the stdio adapter. New `daemon-entry.ts` strict-parses `--state-root` and `--port`, calls only `startHttp`, owns no stdio protocol, ignores stdin/EOF, and stays alive until an awaited signal close. Application/index/daemon parity tests reject a second composition root.

Task16 process tests spawn the daemon entry as a normal child and retain the exact `ChildProcess` handle inside Vitest. They wait for strict public ping, execute the test, terminate and await that same handle in `afterEach`; no detached/background controller exists. The current-Windows diagnostic is non-destructive and supplemental: it may check only concurrent Figma Desktop/source-daemon/plugin connection presence and may return typed `PLUGIN_NOT_CONNECTED`. It cannot pair, create/register/import/mutate/delete, cannot contribute a blocking result, and is never written into the three source-complete documents. Any real-Figma validation requires a separate user-scoped supplemental plan and dedicated validation folder.

| Fake blocking check suffix | Typed fake input and positive assertion | Required negative assertion | Fake teardown |
|---|---|---|---|
| `artifact-integrity` | strict PreviewCandidate plus Task15 artifact manifest/checksum file and three artifact hashes match bytes in a test-owned staging temp; daemon stateRoot is owner-secure | one valid-format candidate/manifest/checksum/artifact mismatch rejects | remove only test-owned staging temp and daemon stateRoot |
| `daemon-health` | retained source child strict ping/build matches | occupied port or wrong build rejects | terminate the retained child |
| `state-permissions` | test-owned daemon stateRoot passes OS policy | wider mode/foreign ACE/reparse rejects | remove only that stateRoot |
| `pair-resume` | typed fake pairing broker exchanges and rotates resume state without a TTY | old fake ticket/token replay rejects | close fake paired transport |
| `design-context-recursive` | in-memory fake page/frame tree returns complete sections | forged/missing fake node fails typed | clear fake document model |
| `grounding-maps` | synthetic code/design/component/token/icon joins verify | wrong workspace/file hash rejects | remove test-owned snapshot temp |
| `snapshot-graph` | fake capture+graph locator/checksum loads | stale checksum/CAS rejects | remove test-owned graph temp |
| `token-pdf-export` | synthetic tokens and ordered fake frames export | existing outPath/corrupt input rejects | remove test-owned export temp |
| `idempotency-journal` | exact same fake operation settles once | same ID/different fingerprint conflicts | close test journal |
| `write-fifo` | two writes against a fake plugin document observe FIFO/final value | stale generation cannot overtake | reset fake document |
| `approval-undo` | fake reject gives runtime0; fake approve mutates with one undo | duplicate/late/wrong binding rejects | reset fake mutation port |
| `generation-reconnect` | fake reconnect/rehello resumes stable identity | old generation reply/cancel rejects | close fake paired transport |
| `workspace-policy` | test-owned root through injected fake store reads/writes inside | symlink/reparse/outside path rejects | remove only the test root |
| `network-policy` | injected fake resolver/fetcher accepts exact allowed FQDN/hash | denied FQDN reaches neither resolver nor transport | reset fake network ports |
| `capability-matrix` | fake runtime capabilities match manifest | unavailable capability returns typed negative | reset fake capability port |
| `diagnostic-redaction` | strict evidence/check details contain only hashes/codes | sentinel text/path/URL/raw content absent | remove diagnostic temp |

`blocking-check-fixture-map.test.ts` requires exactly these 16 typed-fake checks, one positive input/assertion, one negative assertion, and one bounded fake teardown each. Rows execute only in memory or in explicitly test-owned temporary directories. They never invoke a real plugin pair, real Figma/workspace/domain creation, external network, or user-data deletion. Fixture paths, URLs, IDs, source text, image bytes, secrets, tokens, and raw content never enter `SourceCompleteEvidenceV1`.

---

## 4. Exact Service File Map

In addition to vendored files expanded by `vendor-map.json`, create these files:

~~~text
service/
  .editorconfig
  .gitattributes
  .gitignore
  .node-version
  .npmrc
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
  vitest.config.ts
  vitest.artifacts.config.ts
  knip.json
  .oxlintrc.json
  .oxfmtrc.json
  vendor-rules.json
  vendor-map.json
  upstream-lock.json
  LICENSE
  THIRD_PARTY_NOTICES.md
  PROVENANCE.md
  SBOM.spdx.json
  README.md
  SECURITY.md
  capabilities/union-manifest.json
  capabilities/rust-tool-compat.json
  capabilities/figmosha-feature-map.json
  capabilities/change-manifests/
  capabilities/task-8a-direct-fs-importers.json
  capabilities/task-9b-mutation-handlers.json
  capabilities/cli-command-modules.v1.json
  capabilities/task-7a-authority-classes.json
  capabilities/task-14-skill-base.json
  docs/architecture.md
  docs/build-vs-buy.md
  docs/capability-matrix.md
  docs/compatibility.md
  docs/desktop-diagnostics.md
  docs/operation-policy.md
  docs/pairing.md
  docs/snapshot-format.md
  schemas/preview-candidate-v1.schema.json
  schemas/upstream-lock-v2.schema.json
  schemas/source-complete-evidence-v1.schema.json
  schemas/source-complete-preview-v1.schema.json
  licenses/figwright-LICENSE
  licenses/figma-mcp-rust-LICENSE
  licenses/figmosha2-LICENSE
  scripts/vendor-upstreams.mjs
  scripts/verify-runtime-specifiers.mjs
  vendor-allowed-figwright-strings.json
  scripts/verify-upstream-lock.mjs
  scripts/generate-notices.mjs
  scripts/package-artifacts.mjs
  scripts/generate-sbom.mjs
  scripts/generate-checksums.mjs
  scripts/verify-artifacts.mjs
  scripts/verify-staged-change-manifest.mjs
  scripts/smoke-packed-mcp.mjs
  scripts/current-windows-diagnostic.mjs
  scripts/run-fake-source-checks.mjs
  scripts/source-complete-validator.mjs
  scripts/write-preview-candidate.mjs
  scripts/write-source-complete-preview.mjs
  scripts/generate-task9b-handler-ledger.mjs
  scripts/generate-cli-command-module-ledger.mjs
  scripts/update-service-forks.mjs
  packages/shared/src/auth.ts
  packages/shared/src/action-nonce.ts
  packages/shared/src/approval.ts
  packages/shared/src/capability-manifest.ts
  packages/shared/src/config.ts
  packages/shared/src/egress.ts
  packages/shared/src/invocation.ts
  packages/shared/src/error-guidance.ts
  packages/shared/src/operations.ts
  packages/shared/src/progress.ts
  packages/shared/src/envelope.ts
  packages/shared/src/protocol.ts
  packages/shared/src/rpc.ts
  packages/shared/src/service-operations.ts
  packages/shared/src/index.ts
  packages/shared/src/result-schemas.ts
  packages/shared/test/file-identity-hash.test.ts
  packages/ir/src/canonical-json.ts
  packages/ir/src/fidelity.ts
  packages/ir/src/grounding-graph-v1.ts
  packages/ir/src/snapshot-v1.ts
  packages/ir/src/snapshot-storage.ts
  packages/ir/src/store.ts
  packages/ir/src/index.ts
  packages/ir/test/canonical-json.test.ts
  packages/ir/test/fidelity.test.ts
  packages/ir/test/grounding-graph-v1.test.ts
  packages/ir/test/snapshot-v1.test.ts
  packages/ir/test/snapshot-storage.test.ts
  packages/ir/test/store.test.ts
  packages/ir/test/grounding-graph-memory.test.ts
  packages/ir/test/fixtures/grounding-graph-memory.mjs
  packages/mcp/src/runtime-paths.ts
  packages/mcp/src/application.ts
  packages/mcp/src/daemon-entry.ts
  packages/mcp/src/tool-invocation-service.ts
  packages/mcp/src/index.ts
  packages/mcp/src/dispatch.ts
  packages/mcp/src/election/follower.ts
  packages/mcp/src/election/control-route-registry.ts
  packages/mcp/src/election/election.ts
  packages/mcp/src/election/leader-endpoints.ts
  packages/mcp/src/election/node.ts
  packages/mcp/src/relay/relay.ts
  packages/mcp/src/relay/session.ts
  packages/mcp/src/tools/runtime-registry.ts
  packages/mcp/src/security/state-permissions.ts
  packages/mcp/src/security/pairing-manager.ts
  packages/mcp/src/security/follower-auth.ts
  packages/mcp/src/security/follower-transport.ts
  packages/mcp/src/security/request-limits.ts
  packages/mcp/src/security/principal-derivation.ts
  packages/mcp/src/policy/approval-gate.ts
  packages/mcp/src/policy/approval-broker.ts
  packages/mcp/src/policy/approval-prompt.ts
  packages/mcp/src/policy/egress-policy.ts
  packages/mcp/src/policy/operation-policy.ts
  packages/mcp/src/policy/policy-engine.ts
  packages/mcp/src/policy/result-egress-policy.ts
  packages/mcp/src/execution/file-queue.ts
  packages/mcp/src/execution/execution-plane.ts
  packages/mcp/src/execution/mcp-invocation-adapter.ts
  packages/mcp/src/execution/mcp-workspace-binding.ts
  packages/mcp/src/execution/follower-invocation-client.ts
  packages/mcp/src/execution/follower-invocation-endpoint.ts
  packages/mcp/src/execution/identity-bootstrap.ts
  packages/mcp/src/execution/target-resolver.ts
  packages/mcp/src/execution/grounding-router.ts
  packages/mcp/src/execution/service-operation-registry.ts
  packages/mcp/src/execution/operation-id.ts
  packages/mcp/src/execution/operation-executor.ts
  packages/mcp/src/execution/operation-journal.ts
  packages/mcp/src/execution/operation-resolution-intent.ts
  packages/mcp/src/execution/egress-manifest-store.ts
  packages/mcp/src/execution/pdf-merge.ts
  packages/mcp/src/execution/export-pool.ts
  packages/mcp/src/fs/atomic-file.ts
  packages/mcp/src/fs/repo-walk.ts
  packages/mcp/src/fs/workspace-config-store.ts
  packages/mcp/src/fs/workspace-registration-resolver.ts
  packages/mcp/src/fs/workspace-policy.ts
  packages/mcp/src/network/remote-image-fetcher.ts
  packages/mcp/src/network/remote-domain-config-store.ts
  packages/mcp/src/control/approval-endpoints.ts
  packages/mcp/src/control/router.ts
  packages/mcp/src/control/route-registry.ts
  packages/mcp/src/control/status-endpoint.ts
  packages/mcp/src/control/action-nonce-endpoints.ts
  packages/mcp/src/control/action-nonce-store.ts
  packages/mcp/src/control/operation-endpoints.ts
  packages/mcp/src/control/workspace-endpoints.ts
  packages/mcp/src/control/network-domain-endpoints.ts
  packages/mcp/src/control/snapshot-endpoints.ts
  packages/mcp/src/control/grounding-endpoints.ts
  packages/mcp/src/control/tool-call-endpoint.ts
  packages/mcp/src/snapshot/capture-snapshot.ts
  packages/mcp/src/snapshot/build-grounding-graph.ts
  packages/mcp/src/snapshot/refresh-grounding-graph.ts
  packages/mcp/src/snapshot/workspace-snapshot-storage.ts
  packages/mcp/src/snapshot/workspace-graph-storage.ts
  packages/mcp/test/snapshot/snapshot-schema.test.ts
  packages/mcp/test/snapshot/snapshot-capture.test.ts
  packages/mcp/test/snapshot/snapshot-locator.test.ts
  packages/mcp/test/snapshot/snapshot-storage.test.ts
  packages/mcp/test/snapshot/grounding-graph.test.ts
  packages/mcp/test/snapshot/grounding-refresh.test.ts
  packages/mcp/test/snapshot/grounding-storage.test.ts
  packages/mcp/test/snapshot/snapshot-progress.test.ts
  packages/mcp/test/snapshot/service-operation-routing.test.ts
  packages/mcp/src/tools/doctor.ts
  packages/mcp/src/tools/export-tokens.ts
  packages/mcp/src/tools/export-frames-to-pdf.ts
  packages/mcp/src/tools/import-library-variable.ts
  packages/mcp/test/execution/action-nonce.test.ts
  packages/mcp/test/execution/approval-broker.test.ts
  packages/mcp/test/execution/approval-plugin-port.test.ts
  packages/mcp/test/execution/approval-routing-matrix.test.ts
  packages/mcp/test/execution/boundary-limits.test.ts
  packages/mcp/test/execution/completed-result-replay.test.ts
  packages/mcp/test/execution/egress-manifest-store.test.ts
  packages/mcp/test/execution/execution-plane-lifecycle.test.ts
  packages/mcp/test/execution/follower-stream.test.ts
  packages/mcp/test/execution/invocation-boundary.test.ts
  packages/mcp/test/execution/mcp-selector-synthesis.test.ts
  packages/mcp/test/execution/mcp-workspace-binding.test.ts
  packages/mcp/test/execution/no-direct-relay.test.ts
  packages/mcp/test/execution/progress-framing.test.ts
  packages/mcp/test/execution/plugin-progress-adapter.test.ts
  packages/mcp/test/execution/target-resolution.test.ts
  packages/mcp/test/execution/service-operation-registry.test.ts
  packages/mcp/test/execution/service-operation-name.test.ts
  packages/mcp/test/fs/workspace-registration-resolver.test.ts
  packages/mcp/test/fs/workspace-registration-atomicity.test.ts
  packages/mcp/test/tools/skew-notice.test.ts
  packages/mcp/test/security/follower-transport.test.ts
  packages/mcp/test/election/control-route-registry.test.ts
  packages/plugin/src/file-identity.ts
  packages/plugin/src/mutation-handler-contract.ts
  packages/plugin/src/handlers/import-library-variable.ts
  packages/plugin/src/handlers/identity-bootstrap.ts
  packages/plugin/ui/components/TabApproval.vue
  packages/plugin/ui/components/TabPairing.vue
  packages/plugin/ui/composables/useApprovalQueue.ts
  packages/plugin/ui/composables/usePairing.ts
  packages/cli/src/index.ts
  packages/cli/src/client.ts
  packages/cli/src/output.ts
  packages/cli/src/commands/approve.ts
  packages/cli/src/commands/compat.ts
  packages/cli/src/commands/doctor.ts
  packages/cli/src/commands/find.ts
  packages/cli/src/commands/pair.ts
  packages/cli/src/commands/pdf.ts
  packages/cli/src/commands/sel.ts
  packages/cli/src/commands/snapshot.ts
  packages/cli/src/commands/grounding.ts
  packages/cli/src/commands/status.ts
  packages/cli/src/commands/text.ts
  packages/cli/src/commands/tokens.ts
  packages/cli/src/commands/tree.ts
  packages/cli/src/commands/variant.ts
  packages/cli/src/commands/clone.ts
  packages/cli/src/commands/rm.ts
  packages/cli/src/commands/import-component.ts
  packages/cli/src/commands/import-variable.ts
  packages/cli/src/commands/workspace.ts
  packages/cli/src/commands/workspace-set-default.ts
  packages/cli/src/commands/network.ts
  packages/cli/src/commands/operations.ts
  packages/cli/src/compat/rust-tool-map.ts
  packages/cli/test/command-module-ledger.test.ts
  test/bootstrap.test.ts
  test/upstream-parity.test.ts
  test/tool-contract.test.ts
  test/docs-sync.test.ts
  test/change-manifest.test.ts
  test/authority-class-transition.test.ts
  test/service-fork-lineage.test.ts
  test/artifact-contents.test.ts
  test/plugin-built-consumer.test.ts
  test/package-scripts-windows.test.ts
  test/preview-candidate.test.ts
  packages/mcp/test/e2e/built-plugin-approval-roundtrip.test.ts
  packages/mcp/test/e2e/identity-bootstrap.test.ts
  packages/mcp/test/e2e/internal-system-principal.test.ts
  packages/mcp/test/e2e/daemon-entry.test.ts
  packages/mcp/test/application.test.ts
  packages/plugin/test/file-identity-bootstrap-hello.test.ts
  packages/plugin/test/identity-bootstrap-dispatch.test.ts
  test/workflow-hygiene.test.ts
  test/fixtures/assemble-baseline-artifacts.mjs
  test/source-complete-evidence.test.ts
  test/evidence-schema-draft.test.ts
  test/source-harness-binding.test.ts
  test/current-windows-diagnostic.test.ts
  test/daemon-artifact-surface.test.ts
  test/blocking-check-fixture-map.test.ts
~~~

Workspace-root class4 paths are `.gitignore` for ignored local preview outputs and `.github/workflows/service-ci.yml`; workflow build commands use `working-directory: service`. No source-complete workflow publishes or uploads.

---

## 5. Dependency, Build, and Verification

| Package | Runtime dependencies |
|---|---|
| shared | `zod` 4.4.3, `@msgpack/msgpack` 3.1.3 |
| ir | `@sfp/shared` workspace, `zod` 4.4.3, Node crypto only; filesystem is an injected storage port implemented in MCP |
| mcp | `@modelcontextprotocol/server` 2.x lock-resolved, `ws` 8.21.3, `fdir` 6.5.0, `ignore` 7.0.6, `oxc-parser` 0.147.0, `pdf-lib` 1.17.1, shared/ir workspaces |
| plugin | Vue 3.5.41, VueUse 14.4.0, Lucide Vue 1.34.0, Zod 4.4.3, Vite 8.2.2 toolchain |
| cli | shared workspace and Node stdlib; `node:util.parseArgs`; direct build devDependencies `tsdown` `^0.22.14` and `publint` `^0.3.24` |

Task16 adds root direct devDependency `ajv` exactly `8.17.1` for the three unsigned source-complete schemas.

Task15 adds root direct devDependency `happy-dom` exactly `20.11.11` because the root `plugin-built-consumer.test.ts` imports it. Task15 packaging/workflow scripts use Node/JSON and do not import a YAML library, so no direct `yaml` dependency is added. Task11 adds exact IR runtime dependencies `@sfp/shared:"workspace:*"` and `zod:"4.4.3"`; Task12 adds MCP `pdf-lib:"1.17.1"`; Task13 adds CLI `@sfp/shared:"workspace:*"` plus direct CLI devDependencies `tsdown:"^0.22.14"` and `publint:"^0.3.24"`. Each owning task updates its exact package manifest and `service/pnpm-lock.yaml`, runs lockfile-only then frozen install, and stages both.

Packed bundle closure is binding: MCP tsdown `alwaysBundle` contains `@sfp/shared` and `@sfp/ir`; CLI tsdown `alwaysBundle` contains `@sfp/shared`. Packed MCP/CLI manifests contain no `workspace:*` and no runtime dependency on private `@sfp/shared`/`@sfp/ir`; external public dependencies remain ordinary pinned/lock-resolved dependencies. Artifact tests check only `mcp.tgz` or `cli.tgz` in separate empty prefixes with fresh npm caches, run `npm ls --all`, MCP tool-list smoke, and CLI help/status smoke, and reject any resolved workspace path.

Root scripts:

~~~json
{
  "build": "pnpm -r run build",
  "typecheck": "pnpm -r run typecheck",
  "lint": "oxlint --deny-warnings .",
  "format:check": "oxfmt --check .",
  "knip": "knip",
  "test": "vitest run",
  "test:unit": "vitest run --exclude \"**/test/e2e/**\"",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "vitest run packages/mcp/test/e2e",
  "test:artifacts": "vitest run --config vitest.artifacts.config.ts",
  "verify": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test",
  "verify:artifacts": "node scripts/package-artifacts.mjs --clean-only && pnpm verify && node scripts/generate-sbom.mjs && node scripts/generate-notices.mjs && node scripts/package-artifacts.mjs && node scripts/generate-checksums.mjs && pnpm test:artifacts && node scripts/verify-artifacts.mjs",
  "verify:source-complete": "pnpm install --frozen-lockfile && pnpm verify:artifacts && node scripts/write-preview-candidate.mjs --require-clean --source-commit HEAD --source-date-epoch git --artifact-manifest artifacts/artifact-manifest.v1.json --checksums artifacts/SHA256SUMS --output artifacts/preview-candidate.v1.json && node scripts/run-fake-source-checks.mjs --candidate artifacts/preview-candidate.v1.json --artifact-manifest artifacts/artifact-manifest.v1.json --checksums artifacts/SHA256SUMS --output artifacts/source-complete-evidence.v1.json && node scripts/write-source-complete-preview.mjs --candidate artifacts/preview-candidate.v1.json --evidence artifacts/source-complete-evidence.v1.json --output artifacts/source-complete-preview.v1.json",
  "diagnostic:current-windows": "node scripts/current-windows-diagnostic.mjs --json"
}
~~~

~~~ts
// service/vitest.config.ts
export const ARTIFACT_DEPENDENT_TESTS = [
  'test/artifact-contents.test.ts',
  'test/plugin-built-consumer.test.ts',
] as const;
~~~

Task15 owns the exact two-row tuple above. Task16 atomically appends `test/daemon-artifact-surface.test.ts`, making the final tuple exactly three rows. `service/vitest.config.ts` excludes the current tuple from ordinary tests and `vitest.artifacts.config.ts` includes exactly it. Package scripts have no POSIX quote. Windows tests spawn exact `cmd.exe /d /s /c "pnpm run test -- --help"` and `cmd.exe /d /s /c "pnpm run test:artifacts -- --help"`, requiring exit0/no quote token; all OSes assert strings/config. Artifact assembly and verification order remains fixed.

Task15 owns `verify:artifacts`, which creates and verifies only the three local artifacts. Task16 owns the terminal `verify:source-complete`, which runs from a clean Task16 commit and alone creates the ignored candidate/evidence/marker after artifact verification. Package scripts remain shell-neutral and perform no external side effect.

---

## 6. Dependency DAG

~~~text
T1 bootstrap harness
  → T2 vendor + 112/105/7 parity
    → T3 capability/result/runtime authority
      → T4 stateRoot + workspaceRoots
        → T5 dynamic policy + annotations
          → T6 pairing/follower/control auth
            → T7 executor/control/journal/egress/file queue
              → T8 filesystem + RemoteImageFetcher
                → T9 paired plugin + approvals + commitUndo (still 112/105/7)
                  → T10 grounding/reconnect/file identity
                    → T11 snapshot + grounding graph + service2
                      → T12 atomic safe union (116/106/10; service2 unchanged)
                        → T13 CLI
                        → T14 skills/docs/build-vs-buy
                          → T15 hygiene/CI/SBOM/local artifacts
                            → T16 local daemon + unsigned source-complete preview
                              ├→ T17 external Windows validation placeholder (not dispatched)
                              └→ T18 external macOS validation placeholder (not dispatched)
~~~

T11→T12 is sequential: Task11 establishes service registry2 and both mutate closed-world authorities.

### 6.1 Maximum Review Surface per Task

One parent plan is retained, but no reviewer is asked to approve an unbounded subsystem. Generated vendor copies are reviewed by manifest/hash and behavior parity, not as hand-authored semantic diff.

| Task | Maximum semantic review surface |
|---:|---|
| 1 | root harness/hygiene plus five minimal manifests; no product source |
| 2 | vendor script/rules/manifest merge/provenance/parity only; copied rows are hash-generated |
| 3 | manifest+ToolSpec/result/runtime authority only; no policy/executor behavior |
| 4 | state permissions and workspace config/path interfaces only; journal is a fake guard |
| 5 | pure dynamic effects/egress classifiers/config only; no runtime dispatch |
| 6 | pairing/PNA/follower/control authentication only; no tool control endpoint |
| 7 | three staged-tree review slices: 7A operation/principal/target/leader-plane core; 7B approval/control/action nonce; 7C durable egress/progress/framing and production entry-point integration. Shared wire and closed-world authority files may cross slices; there is no artificial module-count cap. |
| 8 | two review slices: filesystem adapters; DNS-pinned network/domain control, each independently rejectable |
| 9 | three slices: 9A plugin hello/read-only identity, 9B plugin mutation/registry/bootstrap handler, 9C cross-package daemon↔built plugin approval/bootstrap integration; each exact manifest/review |
| 10 | grounding pin/file baseline/reconnect only |
| 11 | pure IR schemas plus injected workspace snapshot adapter/recursive assembler only |
| 12 | four hidden adapter implementations followed by one atomic registry/handler/manifest switch; counts cannot partially ship |
| 13 | control client and command mappings only; no daemon mutation implementation |
| 14 | skills and operator/build-vs-buy docs only |
| 15 | package/workflow/SBOM/checksum assembly only |
| 16 | application/daemon entry, typed fake16, non-destructive co-presence diagnostic, and three unsigned schemas only |
| 17 | external placeholder only; no source review surface or dispatch |
| 18 | external placeholder only; no source review surface or dispatch |

For Tasks 7–9 and 12, the spec reviewer records a decision for each named slice before the final Task-wide quality review. A rejected slice returns only that slice to its implementer; later slices do not mask it.

### 6.2 Mandatory Closed-world Commit Protocol for 7A–16

This protocol applies to **every** service-mutating subcommit from 7A through 16, including 7A/B/C, 8A/B, 9A/B/C and 12A/B. The 7A prelude creates `service/scripts/verify-staged-change-manifest.mjs` plus `service/test/change-manifest.test.ts`; 7A itself is the first reviewed tree using it.

Exact slice IDs are `7A`,`7B`,`7C`,`8A`,`8B`,`9A`,`9B`,`9C`,`10`,`11`,`12A`,`12B`,`13`,`14`,`15`,`16`; each owns strict JSON. Paths are repo-root-relative slash form and sort with `Buffer.compare(Buffer.from(path,'utf8'))`, never locale. Rows are A/M staged blob hashes or D/null; authorityPaths is manifest+trio. Verifier uses cached name-status `--no-renames -z`, byte-compares union, hashes index blobs, rejects globs/directories/untracked/unstaged; moves D+A.

`node service/scripts/verify-staged-change-manifest.mjs --write --slice 8A` (or exact listed ID) generates the manifest from a semantic-only index; without `--write` it verifies the complete staged union and never edits files.

~~~ts
export interface ServiceForkLineageCommonV1 {
  originRepo: 'figwright' | 'figma-mcp-rust' | 'figmosha2';
  originPath: string;
  previousMode: 'copy' | 'mergeDependencyManifest' | 'referenceOnly';
  originCommit: string; // ^[0-9a-f]{40}$
  baseSha256: string; // ^[0-9a-f]{64}$
  transitionTask: '7A' | '7B' | '7C' | '8A' | '8B' | '9A' | '9B' | '9C' | '10' | '11' | '12A' | '12B' | '13' | '14' | '15' | '16';
  reason: string;
}

export type ServiceForkLineageV1 =
  | (ServiceForkLineageCommonV1 & {
      transition: 'edit'; destination: string; stagedSha256: string;
    })
  | (ServiceForkLineageCommonV1 & {
      transition: 'move'; oldDestination: string; newDestination: string; newSha256: string;
    })
  | (ServiceForkLineageCommonV1 & {
      transition: 'delete'; destination: string; stagedSha256: null;
    });

export type ServiceAuthorityRefreshV1 =
  | { class: 'serviceFiles'; path: string; stagedSha256: string; refreshSubtype: 'service-owned-source' }
  | {
      class: 'packageAuthorities'; path: string; stagedSha256: string;
      refreshSubtype: 'package-manifest' | 'workspace-lockfile' | 'build-config';
    };
~~~

Class-aware model exact. Protected lineage lives only in strict `service/upstream-lock.json.serviceForks[]`. The schema rejects unknown keys, duplicate transition identity, `oldDestination===newDestination`, and any destination appearing in more than one edit/delete destination or move old/new position. Every path is normalized repo-relative slash form with no absolute, dot, dot-dot, backslash, empty, or NUL segment.

- `edit`: remove the prior `service/vendor-map.json` row, add `destination` to both sorted-unique `service/vendor-rules.json.exclude[]` and `serviceOwned[]`, require the staged A/M blob SHA-256 to equal `stagedSha256`, and make copy-only skip it.
- `move`: require cached name-status exactly `D oldDestination` plus `A newDestination`; remove the old vendor-map row; keep `oldDestination` in `exclude[]` as a no-materialize tombstone but absent from `serviceOwned[]`; add `newDestination` to both `exclude[]` and `serviceOwned[]`; require its staged blob SHA-256 to equal `newSha256`; copy-only skips both destinations.
- `delete`: require cached `D destination`, remove the old vendor-map row, keep `destination` in `exclude[]`, remove it from `serviceOwned[]`, require `stagedSha256:null` and no index/worktree blob, and make copy-only skip recreation.

All variants store originRepo/path/originCommit/previousMode/base from the exact prior row before removal. The updater performs one compare-and-swap rewrite of vendor rules/map/upstream lock and refuses partial or ambiguous transitions. The verifier re-derives the prior row from the parent tree, validates lineage and cached A/M/D bytes, exact exclude/serviceOwned membership, generator skip, no current blob for delete, and no copy-only overwrite. Table tests cover edit, move, delete, duplicate destinations, wrong hashes, incomplete D+A, the Task8 repo-walk source+test moves, the Task9B 77 handler edits, and a deleted upstream fixture. Unchanged upstream alone preserves mode; every changed `serviceFiles`/`packageAuthorities` row carries exactly the matching `ServiceAuthorityRefreshV1.refreshSubtype` and staged hash.

1. Finish semantic edits, then stage only the slice's exact semantic A/M/D paths with explicit `git add -- <files>` and `git rm -- <deletions>`; no directory/glob.
2. Generate manifest, transition every edited upstream row to semantic service fork using `update-service-forks.mjs`, refresh serviceFiles/packageAuthorities, then copy-only.
3. Verify old fork rows are absent/skipped and stage schema/fork lineage/manifest/authority.
4. Run `AUTHORITY_GREEN`, staged-manifest verifier, `git diff --cached --check`; require status only first-column union paths and no unstaged/untracked service file.
5. Record `git write-tree`; independent spec+quality review it. Any fix regenerates manifest/authority/tree and both reviews.
6. Rerun exact GREEN, `TASK6_1_FROZEN_GREEN` when entry/transport changes, `AUTHORITY_GREEN`, verifier; require same tree, commit exact subject and verify `HEAD^{tree}`.

Task7 literal commands are `node service/scripts/update-service-forks.mjs --slice 7A --index service/capabilities/change-manifests/task-7a.json`; `node service/scripts/update-service-forks.mjs --slice 7B --index service/capabilities/change-manifests/task-7b.json`; and `node service/scripts/update-service-forks.mjs --slice 7C --index service/capabilities/change-manifests/task-7c.json`. Each precedes copy-only and lineage/authority tests.

For avoidance of shorthand, the remaining literal invocations are: `node service/scripts/update-service-forks.mjs --slice 8A --index service/capabilities/change-manifests/task-8a.json`; `node service/scripts/update-service-forks.mjs --slice 8B --index service/capabilities/change-manifests/task-8b.json`; `node service/scripts/update-service-forks.mjs --slice 9A --index service/capabilities/change-manifests/task-9a.json`; `node service/scripts/update-service-forks.mjs --slice 9B --index service/capabilities/change-manifests/task-9b.json`; `node service/scripts/update-service-forks.mjs --slice 9C --index service/capabilities/change-manifests/task-9c.json`; `node service/scripts/update-service-forks.mjs --slice 10 --index service/capabilities/change-manifests/task-10.json`; `node service/scripts/update-service-forks.mjs --slice 11 --index service/capabilities/change-manifests/task-11.json`; `node service/scripts/update-service-forks.mjs --slice 12A --index service/capabilities/change-manifests/task-12a.json`; `node service/scripts/update-service-forks.mjs --slice 12B --index service/capabilities/change-manifests/task-12b.json`; `node service/scripts/update-service-forks.mjs --slice 13 --index service/capabilities/change-manifests/task-13.json`; `node service/scripts/update-service-forks.mjs --slice 14 --index service/capabilities/change-manifests/task-14.json`; `node service/scripts/update-service-forks.mjs --slice 15 --index service/capabilities/change-manifests/task-15.json`; `node service/scripts/update-service-forks.mjs --slice 16 --index service/capabilities/change-manifests/task-16.json`.

No edited upstream-managed byte may preserve copy/merge/reference mode. No fork may be overwritten by copy-only. Broad staging/blind class registration remains forbidden.

`AUTHORITY_GREEN` means this exact copy/paste block, in order:

~~~powershell
node service/scripts/vendor-upstreams.mjs --copy-only
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts test/authority-class-transition.test.ts test/service-fork-lineage.test.ts
~~~

---

## 7. Task-by-Task TDD Plan

### Task 1 — Bootstrap the standalone test harness

**Files**

- Create: `service/package.json`, `service/pnpm-workspace.yaml`, `service/tsconfig.base.json`, `service/tsconfig.json`, `service/vitest.config.ts`.
- Create: `service/.node-version`, `service/.npmrc`, `service/.gitignore`, `service/.gitattributes`, `service/.editorconfig`, `service/knip.json`, `service/.oxlintrc.json`, `service/.oxfmtrc.json`.
- Create: minimal manifests at `service/packages/{shared,ir,mcp,plugin,cli}/package.json`.
- Create: service-owned package configs `packages/shared/{tsconfig.json,vitest.config.ts}`, `packages/mcp/{tsconfig.json,tsdown.config.ts,vitest.config.ts}`, `packages/plugin/{manifest.json,tsconfig.json,vite.config.ts,vite.config.main.ts,vitest.config.ts}`, `packages/ir/{tsconfig.json,vitest.config.ts}`, and `packages/cli/{tsconfig.json,tsdown.config.ts,vitest.config.ts}`.
- Create: `service/test/bootstrap.test.ts`.

**Interfaces**

- Consumes: no service code; only Node 24, corepack, and the workspace root.
- Produces: a runnable `pnpm -C service exec vitest` harness, five named `@sfp/*` workspace packages, root scripts from section 5, LF/UTF-8/ignore policy.

- [ ] **Step 1: Create the root manifest and a failing workspace smoke test**

~~~ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('service bootstrap', () => {
  it('declares every package needed by the implementation plan', async () => {
    const names = await Promise.all(
      ['shared', 'ir', 'mcp', 'plugin', 'cli'].map(async dir =>
        JSON.parse(await readFile(new URL(`../packages/${dir}/package.json`, import.meta.url), 'utf8')).name,
      ),
    );
    expect(names).toEqual(['@sfp/shared', '@sfp/ir', '@sfp/mcp', '@sfp/plugin', '@sfp/cli']);
  });
});
~~~

- [ ] **Step 2: Install the root harness and verify the intended RED**

Run: `corepack enable`, then `pnpm -C service install`, then `pnpm -C service exec vitest run test/bootstrap.test.ts`.

Expected: FAIL with `ENOENT ... packages/shared/package.json`; Vitest itself must start successfully.

- [ ] **Step 3: Add the five concrete package manifests and workspace config**

Each package manifest has its exact `@sfp/*` name, `private:true` during bootstrap, `type:"module"`, and `typecheck`/`build` scripts that become active after Task 2 vendoring. Root `package.json` contains the scripts in section 5 and `packageManager:"pnpm@11.24.0"`. Create the package configs and baseline plugin manifest as service-owned adaptations of upstream references; Task 2 may compare/merge dependencies but may not overwrite these files.

- [ ] **Step 4: Verify bootstrap GREEN and frozen lock reproducibility**

Run: `pnpm -C service exec vitest run test/bootstrap.test.ts`, then `pnpm -C service install --frozen-lockfile`.

Expected: PASS and exit 0.

- [ ] **Step 5: Verify file hygiene settings**

Run: `git check-attr text eol -- service/test/bootstrap.test.ts`, `git check-ignore service/node_modules service/.sfp service/packages/mcp/dist`.

Expected: text/LF attributes and all three generated paths ignored.

- [ ] **Step 6: Request independent spec review**

Reviewer checks that the harness—not Figwright behavior—is the only Task 1 output and that Task 2 can now produce a domain RED.

- [ ] **Step 7: Request independent quality review**

Reviewer checks cross-platform paths, root scripts, package names, and absence of source stubs that could mask Task 2 failures.

- [ ] **Step 8: Commit the bootstrap**

Run: `git diff --check`, then `git add service/.editorconfig service/.gitattributes service/.gitignore service/.node-version service/.npmrc service/package.json service/pnpm-lock.yaml service/pnpm-workspace.yaml service/tsconfig.base.json service/tsconfig.json service/vitest.config.ts service/knip.json service/.oxlintrc.json service/.oxfmtrc.json service/packages service/test/bootstrap.test.ts`, then `git commit -m "chore(service): bootstrap standalone test workspace"`.

### Task 2 — Vendor Figwright and prove 112/105/7 parity

**Files**

- Create: `service/vendor-rules.json`, `service/scripts/vendor-upstreams.mjs`, `service/scripts/verify-runtime-specifiers.mjs`, `service/vendor-allowed-figwright-strings.json`, `service/vendor-map.json`, `service/upstream-lock.json`, `service/PROVENANCE.md`.
- Create: `service/LICENSE`, `service/licenses/figwright-LICENSE`, `service/licenses/figma-mcp-rust-LICENSE`, `service/licenses/figmosha2-LICENSE`.
- Create: `service/scripts/verify-upstream-lock.mjs`, `service/test/upstream-parity.test.ts`.
- Materialize: exact paths expanded from section 2.2 into `service/packages/{shared,mcp,plugin}`, `service/skills`, and `service/test`.
- Merge: upstream dependency/devDependency/script inputs into Task 1 service/package manifests without overwriting service names, five-package workspace, lock/config, bin/files/exports, or root scripts.
- Modify: runtime package import/export specifiers to `@sfp/*` without changing protocol tags, comments, user text, or upstream notices.

**Interfaces**

- Consumes: Task 1 Vitest/workspace harness and pinned source commits.
- Produces: `ALL_TOOL_SPECS` 112, `createSandboxHandlers` 105, `SERVER_ONLY_TOOLS` exact 7; per-file vendor provenance; offline and with-upstreams verification modes.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 2A — source-tree materialization | vendor rules/script, AST specifier verifier, copied source/test/skills, vendor map | Task 1 harness GREEN; parity module changes missing→present; runtime-specifier gate passes | `chore(service): vendor pinned source and test trees`; reviewer freezes vendor-map SHA-256 for 2B |
| 2B — service manifest/provenance/parity | deterministic dependency merge, lock, notices/provenance, 112/105/7 | frozen install, parity/typecheck, offline/with-upstreams verification | `chore(service): merge standalone manifests and prove baseline parity`; Task 3 consumes this commit hash |

2B cannot edit copy-mode source except namespace fixes surfaced by 2A review. Either subtask may be rejected independently and later Tasks wait for both commit hashes.

**Binding subtask execution**

- [ ] **2A RED:** Run `pnpm -C service exec vitest run test/upstream-parity.test.ts`; expect registry module resolution failure while Task 1 bootstrap remains green.
- [ ] **2A GREEN:** Run `node service/scripts/vendor-upstreams.mjs --copy-only`, `node service/scripts/verify-runtime-specifiers.mjs`, and `pnpm -C service exec vitest run test/bootstrap.test.ts`; expect copied registry path present, AST gate clean, and bootstrap green.
- [ ] **2A review and commit:** Complete independent spec/quality reviews, then run `git add service/vendor-rules.json service/vendor-map.json service/vendor-allowed-figwright-strings.json service/scripts/vendor-upstreams.mjs service/scripts/verify-runtime-specifiers.mjs service/packages/shared/src service/packages/shared/test service/packages/mcp/src service/packages/mcp/test service/packages/plugin/protocol service/packages/plugin/src service/packages/plugin/ui service/packages/plugin/test service/skills service/test && git commit -m "chore(service): vendor pinned source and test trees"`; record the commit and vendor-map SHA-256.
- [ ] **2B RED:** Before dependency merge/lock regeneration, run `pnpm -C service install --frozen-lockfile`; expect lock/manifest mismatch, not a missing copied source file.
- [ ] **2B GREEN:** Run `node service/scripts/vendor-upstreams.mjs --merge-manifests`, `pnpm -C service install --lockfile-only`, `pnpm -C service install --frozen-lockfile`, `pnpm -C service exec vitest run test/upstream-parity.test.ts test/tool-registry.test.ts`, `pnpm -C service typecheck`, `node service/scripts/verify-upstream-lock.mjs --offline`, and `node service/scripts/verify-upstream-lock.mjs --with-upstreams code-kb`; expect exact 112/105/7 and clean originals.
- [ ] **2B review and commit:** Complete independent spec/quality reviews, then run `git add service/package.json service/pnpm-lock.yaml service/packages/*/package.json service/upstream-lock.json service/PROVENANCE.md service/LICENSE service/licenses service/scripts/verify-upstream-lock.mjs service/test/upstream-parity.test.ts && git commit -m "chore(service): merge standalone manifests and prove baseline parity"`; record the commit hash for Task 3.

- [ ] **Step 1: Write the parity test against the not-yet-vendored registry**

~~~ts
import { describe, expect, it } from 'vitest';
import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';

it('starts at the exact Figwright baseline', () => {
  const toolNames = ALL_TOOL_SPECS.map(x => x.name);
  const handlerNames = Object.keys(createSandboxHandlers({} as never));
  const serverOnly = new Set(toolNames.filter(name => !handlerNames.includes(name)));
  expect(new Set(toolNames).size).toBe(112);
  expect(handlerNames).toHaveLength(105);
  expect(serverOnly).toEqual(new Set([
    'save_screenshots', 'analyze_project', 'scan_components', 'component_map',
    'token_map', 'icon_map', 'design_diff',
  ]));
});
~~~

- [ ] **Step 2: Run parity RED**

Run: `pnpm -C service exec vitest run test/upstream-parity.test.ts`.

Expected: FAIL with module resolution for `packages/mcp/src/tools/registry.js`; the Task 1 runner remains green.

- [ ] **Step 3: Implement deterministic vendoring**

`vendor-upstreams.mjs --copy-only` runs `git -C code-kb/figwright ls-files`, applies copy/referenceOnly modes, copies only source/test/skill/build files, computes SHA-256, writes sorted `vendor-map.json`, and performs AST package-specifier rewrites only for `@figwright/shared`, `@figwright/mcp`, and `@figwright/plugin`. A separate `--merge-manifests` mode applies only mergeDependencyManifests after 2A is frozen. Root/package/lock/config files created by Task 1 are hash-checked before and after and must not be replaced. Deterministic manifest merge preserves service authority, drops upstream postinstall/distribution scripts, and rewrites workspace dependency names.

- [ ] **Step 4: Materialize license and provenance inputs**

Copy the three exact MIT license texts, record all three pinned commits, Rust Go-origin/Rust-port notices, excluded Solar asset decision, and every behavior-only source path from section 2.3.

- [ ] **Step 5: Merge dependencies and regenerate the service lock**

Run `pnpm -C service install --lockfile-only`, then `pnpm -C service install --frozen-lockfile`. Assert root scripts still include all section 5 commands, workspace still has shared/ir/mcp/plugin/cli, knip includes five packages, no upstream postinstall remains, and no missing `scripts/sync-skills.mjs` invocation occurs.

- [ ] **Step 6: Run baseline GREEN**

Run: `pnpm -C service exec vitest run test/upstream-parity.test.ts test/tool-registry.test.ts`, then `pnpm -C service typecheck`.

Expected: 112 unique tools, 105 unique handlers, exact 7 server-only, and typecheck exit 0.

- [ ] **Step 7: Verify standalone and original immutability**

Run: `node service/scripts/verify-upstream-lock.mjs --offline`, `node service/scripts/verify-upstream-lock.mjs --with-upstreams code-kb`, `node service/scripts/verify-runtime-specifiers.mjs`, `rg -n "code-kb/" service/packages service/skills service/package.json`, `rg -n "@figwright/" service/packages service/skills service/PROVENANCE.md`, and `git -C code-kb/figwright status --short` plus the equivalent two original repos.

Expected: both verification modes and AST runtime-specifier gate pass; the production `code-kb/` search is empty; the raw `@figwright/` search output matches exactly the sorted entries in `vendor-allowed-figwright-strings.json` for protocol tags/comments/user guidance/provenance; no runtime import/dependency specifier remains; all original statuses are empty.

- [ ] **Step 8: Request independent spec review**

Reviewer compares expanded vendor-map paths/counts/hashes with the pinned Figwright tree and confirms no safe-union tool was introduced early.

- [ ] **Step 9: Request independent quality review**

Reviewer checks deterministic sort/hash behavior, Windows path handling, namespace rewrite scope, and offline artifact verification.

- [ ] **Step 10: Verify the two-commit handoff without an aggregate commit**

Run: `git diff --check`, `git log -2 --format="%H %s"`, then `git diff --exit-code`. Expected: the two subjects are `chore(service): vendor pinned source and test trees` followed by `chore(service): merge standalone manifests and prove baseline parity`, and the worktree is clean; Task 3 consumes the newer 2B hash. Do not squash or create a third aggregate Task 2 commit.

### Task 3 — Establish capability, result-schema, and runtime authorities

**Files**

- Create: `service/packages/shared/src/capability-manifest.ts`, `service/packages/shared/src/result-schemas.ts`.
- Create: `service/capabilities/union-manifest.json`, `service/capabilities/rust-tool-compat.json`, `service/capabilities/figmosha-feature-map.json`.
- Modify: `service/packages/mcp/src/tools/spec.ts`, `service/packages/mcp/src/tools/registry.ts`, `service/packages/mcp/src/index.ts`.
- Create: `service/packages/mcp/src/tools/runtime-registry.ts`.
- Create: `service/test/tool-contract.test.ts`, `service/packages/mcp/test/tools/result-validation.test.ts`.

**Interfaces**

- Consumes: Task 2 raw 112 ToolSpecs, 105 handlers, 7 server-only names, shared Zod schemas.
- Produces: `UnionManifestV1`; `RawToolSpec`→`ToolSpec<I,O>` finalization; `RESULT_SCHEMAS` and initial runtime rows exact112; `handlerAuthority`/derived `SERVER_ONLY_TOOLS` exact105/7; invalid result errors. Historical Task3 evidence covers handler parity. Task7 7A performs the reviewed non-count-changing migration that adds independent `RuntimeBinding.execution` exact98/14 and `TargetRequirement`.

- [ ] **Step 1: Write contract coverage RED**

~~~ts
it('has one result schema and runtime for every baseline tool', () => {
  const names = ALL_TOOL_SPECS.map(x => x.name).toSorted();
  expect(Object.keys(RESULT_SCHEMAS).toSorted()).toEqual(names);
  expect(Object.keys(TOOL_RUNTIMES).toSorted()).toEqual(names);
  expect(ALL_TOOL_SPECS.filter(x => x.handlerAuthority === 'server-only')).toHaveLength(7);
  expect(Object.keys(TOOL_RUNTIMES)).toHaveLength(112);
  expect(UNION_MANIFEST.canonicalTools).toHaveLength(116);
  expect(UNION_MANIFEST.sourceSurfaces.lexicalTools).toHaveLength(114);
  expect(UNION_MANIFEST.sourceSurfaces.figmoshaHelpers).toHaveLength(20);
  expect(UNION_MANIFEST.sourceSurfaces.figmoshaCliParsers).toHaveLength(12);
});
~~~

- [ ] **Step 2: Run authority RED**

Run: `pnpm -C service exec vitest run test/tool-contract.test.ts packages/mcp/test/tools/result-validation.test.ts`.

Expected: FAIL because `RESULT_SCHEMAS`, `TOOL_RUNTIMES`, and manifest modules are absent.

- [ ] **Step 3: Add finalized ToolSpec construction**

Keep vendored declarations as `RawToolSpec`; registry finalization joins each raw spec to `RESULT_SCHEMAS[name]`, runtime binding ID `runtime:${name}`, policy ID `tool:${name}:v1`, and handler presence. Task 5 fills policies. Derive `handlerAuthority`/`SERVER_ONLY_TOOLS` from exact plugin-handler presence, never from execution routing. Task7 7A separately binds `plugin-direct|server-adapter` and its exact14 list without changing 112/105/7. Missing/duplicate entries throw. Result schemas are strict; `z.unknown()` is not accepted.

- [ ] **Step 4: Create the two-layer manifest**

Generate lexical114, helper20, CLI12 source rows from reviewed ledgers. Generate canonical116 rows with baseline112 `implemented`, four safe-union rows `planned`, Motion7+video `experimental-native`, and raw exec source row rejected. Each of the 71 common names has exactly two `sourceContracts` entries (Rust and Figwright) plus the separate `targetContractHash`; unique rows have one source contract.

- [ ] **Step 5: Validate plugin and canonical results**

Add a test that returns `{unexpected:true}` from a fake `get_selection` handler and expects `PLUGIN_RESULT_INVALID`; add valid binary/screenshot/server-local fixtures so adapters cannot bypass validation.

- [ ] **Step 6: Run authority GREEN**

Run: `pnpm -C service exec vitest run test/tool-contract.test.ts packages/mcp/test/tools/result-validation.test.ts test/tool-registry.test.ts`, then `pnpm -C service typecheck`.

Expected: baseline maps 112/112, manifest source counts 114/20/12, canonical rows 116 with four planned, and no invalid output accepted.

- [ ] **Step 7: Request independent spec review**

Reviewer parses all manifest rows, verifies common-source hashes and Motion/video status, and confirms registry remains 112/105/7.

- [ ] **Step 8: Request independent quality review**

Reviewer checks schema strictness, runtime-map initialization errors, deterministic schema hashing, and no circular package dependency.

- [ ] **Step 9: Commit contract authorities**

Run: `git diff --check`, then `git add service/capabilities service/packages/shared/src/capability-manifest.ts service/packages/shared/src/result-schemas.ts service/packages/mcp/src/tools/spec.ts service/packages/mcp/src/tools/registry.ts service/packages/mcp/src/tools/runtime-registry.ts service/packages/mcp/src/index.ts service/test/tool-contract.test.ts service/packages/mcp/test/tools/result-validation.test.ts`, then `git commit -m "feat(contract): add capability result and runtime authorities"`.

### Task 4 — Separate owner-only state from approved workspaces

**Files**

- Create: `service/packages/shared/src/config.ts`, `service/packages/mcp/src/runtime-paths.ts`.
- Create: `service/packages/mcp/src/security/state-permissions.ts`.
- Create: `service/packages/mcp/src/fs/workspace-config-store.ts`, `service/packages/mcp/src/fs/workspace-policy.ts`.
- Create: `service/packages/mcp/test/fs/runtime-paths.test.ts`, `workspace-config-store.test.ts`, `workspace-policy.test.ts`, `workspace-usage-guard.test.ts`, `shared-dependency-boundary.test.ts`.

**Interfaces**

- Consumes: Task 1 platform baseline and Task 3 shared package exports.
- Produces: `RuntimePaths`, `WorkspaceRoot`, `WorkspacePolicy`, `WorkspaceUsageGuard`, `WorkspaceConfigStore.add/list/remove`, owner-only `StatePermissions.ensureSecure(path)`. Task 4 tests inject a fake guard; shared has no `@sfp/ir` dependency or snapshot-storage declaration, and no Task 7/8/11 module is imported.

- [ ] **Step 1: Write path and state security RED**

~~~ts
it('does not treat a tool rootDir as workspace registration', async () => {
  await expect(policy.resolveRead('missing-workspace', 'src')).rejects.toMatchObject({ code: 'WORKSPACE_NOT_CONFIGURED' });
  expect(await store.list()).toEqual([]);
});

it.runIf(process.platform === 'win32')('rejects a state directory with inherited broad ACL', async () => {
  await expect(permissions.verifySecure(stateRoot)).rejects.toMatchObject({ code: 'STATE_ACL_INSECURE' });
});

it('delegates removal safety to the injected usage guard', async () => {
  const guard = { hasUnsettled: vi.fn().mockResolvedValue(true) };
  const guardedStore = createWorkspaceConfigStore(stateRoot, guard);
  await expect(guardedStore.remove('actor', workspaceId)).rejects.toMatchObject({ code: 'WORKSPACE_IN_USE' });
  expect(guard.hasUnsettled).toHaveBeenCalledWith(workspaceId);
});

it('keeps Task 4 shared code independent from future IR', async () => {
  expect(await runtimeImports('packages/shared/src')).not.toContain('@sfp/ir');
  expect(await fileExists('packages/shared/src/snapshot-storage.ts')).toBe(false);
});
~~~

- [ ] **Step 2: Run RuntimePaths RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/fs/runtime-paths.test.ts packages/mcp/test/fs/workspace-config-store.test.ts packages/mcp/test/fs/workspace-policy.test.ts`.

Expected: FAIL because RuntimePaths and stores are absent.

- [ ] **Step 3: Implement platform stateRoot and owner permissions**

Use platform app-data locations from section 3.4. Unix creates 0700 directory/0600 files. Windows obtains the current SID with `execFile('whoami.exe',['/user','/fo','csv','/nh'])`, parses the CSV SID, invokes `execFile('icacls.exe',[stateRoot,'/inheritance:r'])`, then grants current SID and `*S-1-5-18` with separate `'/grant:r'` argv calls. Verification permits only those two allow principals. No shell string is used; parse/command/verification failure is fatal.

- [ ] **Step 4: Implement workspace config lifecycle**

`add(path)` requires an existing directory, realpath, unique workspaceId, and authenticated explicit action. `remove` calls the injected `WorkspaceUsageGuard`; Task 4 uses an in-memory fake and Task 7 later supplies the journal adapter. Config writes use checksum+atomic rename under stateRoot.

- [ ] **Step 5: Implement read/write resolution rules**

Check each existing descendant realpath. For new files, walk from nearest existing parent and reject symbolic link, junction, mount/reparse escape, alternate separator, case-folded Windows escape, and `..`. Return `overwrites` for dynamic policy.

- [ ] **Step 6: Run path GREEN on the current OS**

Run: `pnpm -C service exec vitest run packages/mcp/test/fs`, then `pnpm -C service typecheck`.

Expected: inside-root paths pass; escape, insecure ACL/mode, missing workspace, and rootDir registration attempts fail with typed codes; shared contains no future IR import or snapshot storage type.

- [ ] **Step 7: Request independent spec review**

Reviewer verifies Figma-only calls can use stateRoot with workspaceId null while any filesystem effect requires a configured workspace.

- [ ] **Step 8: Request independent quality review**

Reviewer checks Windows/Unix permission behavior, path race assumptions, atomic config recovery, and no destructive broad target.

- [ ] **Step 9: Commit runtime paths**

Run: `git diff --check`, then `git add service/packages/shared/src/config.ts service/packages/mcp/src/runtime-paths.ts service/packages/mcp/src/security/state-permissions.ts service/packages/mcp/src/fs service/packages/mcp/test/fs`, then `git commit -m "feat(state): separate owner state and approved workspaces"`.

### Task 5 — Add dynamic effects, annotations, and explicit egress configuration

**Files**

- Create: `service/packages/shared/src/operations.ts`, `service/packages/shared/src/egress.ts`.
- Create: `service/packages/mcp/src/policy/operation-policy.ts`, `service/packages/mcp/src/policy/policy-engine.ts`, `service/packages/mcp/src/policy/result-egress-policy.ts`.
- Modify: `service/packages/mcp/src/tools/spec.ts`, `service/packages/mcp/src/tools/annotations.ts`, `service/packages/mcp/src/tools/registry.ts`.
- Create: `service/packages/mcp/test/policy/operation-policy.test.ts`, `result-egress-policy.test.ts`, `egress-config.test.ts`.

**Interfaces**

- Consumes: Task 3 `ToolSpec`/manifest authority and Task 4 workspace overwrite resolution.
- Produces: distinct auth-independent `PolicyInvocationContext {workspace,resolvedPaths}` with Task4 `ResolvedWorkspacePath`; `OPERATION_POLICIES` exact112; `RESULT_EGRESS_POLICIES` exact112; effects/approval/classifiers/annotations and explicit egress config. Task7 must extend—not replace or shadow—this context after resolving all declared paths before `effectsFor`.

- [ ] **Step 1: Write conditional-effects RED**

~~~ts
it('classifies import_image by parsed source', () => {
  expect(types(policy('import_image').effectsFor({ data: 'AA==' }, ctx))).toEqual(['figma-write']);
  expect(types(policy('import_image').effectsFor({ url: 'https://assets.example.com/a.png' }, ctx))).toEqual(['network', 'figma-write']);
});

it('classifies design_diff update as a destructive filesystem write', () => {
  expect(policy('design_diff').effectsFor({ update: true }, workspaceCtx)).toContainEqual(
    expect.objectContaining({ type: 'filesystem-write', destructive: true }),
  );
});

it('classifies input and possible result classes for every baseline tool', () => {
  expect(Object.keys(RESULT_EGRESS_POLICIES).toSorted()).toEqual(
    ALL_TOOL_SPECS.map(x => x.name).toSorted(),
  );
  expect(RESULT_EGRESS_POLICIES.get_design_context.possibleResultClasses)
    .toEqual(expect.arrayContaining(['design-text', 'design-image']));
  expect(RESULT_EGRESS_POLICIES.scan_components.classifyResult(scanFixture).classes)
    .toContain('project-code');
});
~~~

- [ ] **Step 2: Run policy RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/policy/operation-policy.test.ts packages/mcp/test/policy/result-egress-policy.test.ts packages/mcp/test/policy/egress-config.test.ts`.

Expected: FAIL because dynamic policies and explicit egress config are absent.

- [ ] **Step 3: Implement exact baseline effects**

Cover 112/112 names and all 79 baseline `kind:'write'` entries. Assert multi-effects: component/token/icon maps are `figma-read+filesystem-read`; save/export are `figma-read+filesystem-write`; design diff is both; local filesystem writers are never read-only. `navigate_to_page` alone is `figma-ui` with no document-write approval/undo; the other 78 baseline write kinds include `figma-write`. Original 11 destructive names require explicit-user approval.

- [ ] **Step 4: Implement conservative annotations, exact classifiers, and egress config**

Annotations reflect the union of possible effects. Each result policy implements exact `possibleInputClasses`, `possibleResultClasses`, `classifyInput`, `classifyResult`, and `redactResult`; grouped schemas may share pure helpers but every tool name has one row. Runtime config requires `local-trusted`, `external-model`, or default `unknown-fail-closed`; source `mcp` never selects a mode automatically. Local-trusted may use `consentId:null`; external-model requires a non-null unexpired consent whose allowed classes cover both classified input and possible result classes.

- [ ] **Step 5: Run policy GREEN**

Run: `pnpm -C service exec vitest run packages/mcp/test/policy test/tool-contract.test.ts test/tool-registry.test.ts`.

Expected: operation and egress policy coverage both 112/112, dynamic URL/outPath/update/navigation cases pass, classifiers are exact, annotations are conservative, and no unconfigured external call is allowed.

- [ ] **Step 6: Request independent spec review**

Reviewer compares every complex local tool with binding effect requirements, verifies no filesystem read is mislabeled as requiring write approval, and checks classifier coverage for design text/image, project code, secret, and public results.

- [ ] **Step 7: Request independent quality review**

Reviewer checks policy purity, parsed-args typing, config fail-closed behavior, and no raw sensitive content in audit fixtures.

- [ ] **Step 8: Commit dynamic policy**

Run: `git diff --check`, then `git add service/packages/shared/src/operations.ts service/packages/shared/src/egress.ts service/packages/mcp/src/policy service/packages/mcp/src/tools/spec.ts service/packages/mcp/src/tools/annotations.ts service/packages/mcp/src/tools/registry.ts service/packages/mcp/test/policy`, then `git commit -m "feat(policy): resolve side effects and egress from parsed calls"`.

### Task 6 — Implement pairing, resume, follower auth, PNA, and control middleware

**Files**

- Create: `service/packages/shared/src/auth.ts`.
- Create: `service/packages/mcp/src/security/pairing-manager.ts`, `follower-auth.ts`, `request-limits.ts`.
- Move/modify: `service/packages/mcp/src/security/local-access.ts`.
- Modify: `service/packages/mcp/src/election/leader-endpoints.ts`, `leader-lock.ts`, `follower.ts`, `service/packages/mcp/src/relay/relay.ts`, `session.ts`.
- Create: `service/packages/mcp/test/security/pairing.test.ts`, `pna.test.ts`, `token-rotation.test.ts`, `request-limits.test.ts`, `control-auth.test.ts`.

**Interfaces**

- Consumes: Task 4 secure stateRoot/ACL and Task 5 auth-independent policy types.
- Produces: current Task6 contracts; Task6.1 separately replaces public ping/follower facade and freezes its design before Task7. No Task7 control tool route is created here.

**Frozen Task6.1 handoff:** Tasks7A/7B/7C bind to base `39a29373b91445e9242e82611f0a8a04fca525ea`, contract `bd296dabe872f08adca793d93a2cd6a2c7efca60c58127b07924b2f18840b27b`, and the exact eight-path/925-byte manifest in section 3.5. They consume only the public ping, authenticated follower stream, control authority, and literal `/control` extension exports. No byte-frozen core path may be staged. `follower.ts` stays at its baseline hash; 7C may stage only the explicitly allowlisted `leader-endpoints.ts` adapter change and must preserve every frozen semantic gate under both staged-tree reviews and `TASK6_1_FROZEN_GREEN`.

The frozen tests cover transport/control registry/security/election/dispatch/e2e/authority. Registry allows exactly one `/control` prefix, matches `/control` and every sibling descendant, rejects descendant/duplicate/post-freeze registrations, routes status/tool/workspace/operation siblings once, and preserves authenticated default404/body/CORS on decline. `TASK6_1_FROZEN_GREEN` also requires protocol/challenge health, pre-copy caps, settled-once backpressure, both concurrent-write orders fail closed, legacy unary crypto removal, and every transport gate.

- [ ] **Step 1: Write pairing and authentication RED**

~~~ts
it('exchanges an eight-digit code once for a 128-bit ticket', async () => {
  const challenge = await manager.createChallenge(actor);
  expect(challenge.challengeId).toMatch(/^[A-Z2-7]{10}$/);
  expect(challenge.code).toMatch(/^\d{8}$/);
  const first = await manager.exchange(challenge.challengeId, challenge.code);
  expect(Buffer.from(first.wsTicket, 'base64url')).toHaveLength(16);
  await expect(manager.exchange(challenge.challengeId, challenge.code)).rejects.toMatchObject({ code: 'PAIR_CODE_USED' });
});

it('rejects null Origin without a ticket', async () => {
  await expect(connectWs({ path: '/ws', origin: 'null' })).rejects.toMatchObject({ status: 401 });
});

it('returns the literal PNA response only for an exact pair preflight', async () => {
  const response = await options('/pair/exchange', {
    origin: 'null',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
    'access-control-request-private-network': 'true',
  });
  expect(response.status).toBe(204);
  expect(response.headers).toMatchObject({
    'access-control-allow-origin': 'null',
    'access-control-allow-methods': 'POST',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '0',
  });
});

it.each(['null', 'https://www.figma.com', 'https://figma.com'])
  ('makes POST success and typed errors readable to allowed Origin %s', async origin => {
    const ok = await postPair(validPairBody, { origin });
    expect(ok.status).toBe(200);
    expect(ok.headers).toMatchObject({
      'access-control-allow-origin': origin,
      'access-control-allow-private-network': 'true',
      vary: 'Origin',
    });
    const wrong = await postPair(wrongCodeBody, { origin });
    expect(wrong.status).toBe(401);
    expect(wrong.json.code).toBe('PAIR_CODE_WRONG');
    expect(wrong.headers).toMatchObject({
      'access-control-allow-origin': origin,
      'access-control-allow-private-network': 'true',
      vary: 'Origin',
    });
  });

it.each([undefined, 'https://evil.example'])('does not expose POST CORS to Origin %s', async origin => {
  const response = await postPair(validPairBody, { origin });
  expect(response.status).toBe(403);
  expect(response.headers.vary).toBe('Origin');
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
  expect(response.headers['access-control-allow-private-network']).toBeUndefined();
});

it.each([
  [400, 'PAIR_BODY_INVALID'], [401, 'PAIR_CODE_WRONG'], [401, 'PAIR_CODE_EXPIRED'],
  [409, 'PAIR_CODE_USED'], [429, 'PAIR_RATE_LIMITED'], [500, 'PAIR_INTERNAL'],
])('keeps typed %s/%s readable for an allowed POST Origin', async (status, code) => {
  const response = await postPair(errorFixture(code), { origin: 'null' });
  expect(response).toMatchObject({ status, json: { code } });
  expect(response.headers).toMatchObject({
    'access-control-allow-origin': 'null',
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  });
});

it('returns exact public identity with leaderGeneration and no session oracle', async () => {
  const body = await get('/ping').then(x => x.json());
  expect(Object.keys(body).toSorted()).toEqual([
    'buildId', 'leaderGeneration', 'ok', 'product', 'protocolVersion', 'role', 'serverVersion',
  ]);
  expect(body.leaderGeneration).toBe(currentLeaderGeneration);
  expect(JSON.stringify(body)).not.toMatch(/activeSessionId|plugin|fileName|sessionId/);
});
~~~

- [ ] **Step 2: Run auth RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/security`.

Expected: current null-Origin socket is accepted, RPC lacks bearer auth, paths/body are unbounded, and pairing modules are missing.

- [ ] **Step 3: Implement challenge/exchange/resume**

Create exact endpoints and schemas from section 3.5. Treat challengeId as a public identifier, return `PairChallengeIssued` to the control caller, hash only the eight-digit code with daemon-keyed HMAC, and compare constant-time. Enforce expiry, five attempts, challenge creation/exchange rate limits, one-use ticket, first-message credential, resume rotation, plugin-generation binding, and secret redaction.

- [ ] **Step 4: Implement local request gates and PNA**

Keep all Task6 PNA/Host/WS gates as preserved and strengthened by frozen Task6.1. Task6.1 replaces public ping through its shared strict facade and removes active-session resolution; Task7 depends only on the section 3.5 handoff.

- [ ] **Step 5: Implement follower/control credentials**

Task6.1 owns credentials, outer request Buffer, independently authenticated ordered response records and final stream facade; private keys/records never export to Task7. Unknown forwards no args; no control tool route here.

- [ ] **Step 6: Run auth GREEN**

Run: `pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/relay`, then `pnpm -C service typecheck`.

Expected: pairing/resume/PNA/path/body/token cases pass and baseline registry remains 112/105/7.

- [ ] **Step 7: Request independent spec review**

Reviewer traces code→ticket→hello→rotated resume and leader-generation token lifecycle, including Windows owner-only storage.

- [ ] **Step 8: Request independent quality review**

Reviewer checks entropy, constant-time comparisons, rate limits, log redaction, PNA headers, WS framing, abort/cleanup, and stale credential rejection.

- [ ] **Step 9: Commit authenticated transport**

Run: `git diff --check`, then `git add service/packages/shared/src/auth.ts service/packages/mcp/src/security service/packages/mcp/src/election service/packages/mcp/src/relay service/packages/mcp/test/security`, then `git commit -m "feat(auth): pair and authenticate every local transport"`.

### Task 7 — Build the central executor, approval control, journal, egress, and per-file queue

**Files**

- Create/modify shared wire/policy authority: `service/packages/shared/src/invocation.ts`, `action-nonce.ts`, `approval.ts`, `progress.ts`, `rpc.ts`, `envelope.ts`, `protocol.ts`, `operations.ts`, `service-operations.ts`, `config.ts`, `index.ts`.
- Create `service/packages/shared/test/file-identity-hash.test.ts`; 7A owns the canonical FileIdentity hash vectors consumed later by Task9/11.
- Create operation/identity/target core: `service/packages/mcp/src/execution/execution-plane.ts`, `mcp-invocation-adapter.ts`, `mcp-workspace-binding.ts`, `target-resolver.ts`, `service-operation-registry.ts`, `file-queue.ts`, `operation-id.ts`, `operation-journal.ts`, `operation-resolution-intent.ts`, `operation-executor.ts`, `follower-invocation-client.ts`; create `service/packages/mcp/src/security/principal-derivation.ts` and `service/packages/mcp/src/tool-invocation-service.ts`.
- Create approval/control authority: `service/packages/mcp/src/policy/approval-gate.ts`, `approval-broker.ts`, `approval-prompt.ts`; `service/packages/mcp/src/control/router.ts`, `route-registry.ts`, `status-endpoint.ts`, `action-nonce-store.ts`, `action-nonce-endpoints.ts`, `approval-endpoints.ts`, `tool-call-endpoint.ts`, `workspace-endpoints.ts`, `operation-endpoints.ts`.
- Modify/create workspace ownership: `service/packages/mcp/src/fs/workspace-config-store.ts`, `workspace-registration-resolver.ts`; retain `workspace-policy.ts` unchanged for registration resolution.
- Create durable egress/progress authority: `service/packages/mcp/src/policy/egress-policy.ts`, `service/packages/mcp/src/execution/egress-manifest-store.ts`, `follower-invocation-endpoint.ts`.
- Modify Task7-owned policy/spec/runtime, execution plane/target/service registry, Relay target/session consumers and control router. Create the new follower client over the public facade; keep legacy `follower.ts` unchanged. 7C may modify only the allowlisted semantic adapter `leader-endpoints.ts` to inject the inner streaming handler; Task7 never modifies a byte-frozen Task6.1 core/private producer.
- Create/modify tests: `service/packages/mcp/test/execution/{operation-id,file-queue,operation-journal,operation-executor,execution-plane-lifecycle,invocation-boundary,mcp-selector-synthesis,mcp-workspace-binding,target-resolution,target-requirement,runtime-authority,policy-context,service-operation-name,service-operation-registry,follower-invocation-client,no-direct-relay,action-nonce,approval-broker,approval-plugin-port,operation-resolution,completed-result-replay,egress-policy,egress-manifest-store,egress-finalizer,boundary-limits,progress-transport,progress-framing,plugin-progress-adapter,follower-stream,control-tool-call,workspace-endpoints}.test.ts`; create `service/packages/mcp/test/fs/workspace-registration-resolver.test.ts`, `workspace-registration-atomicity.test.ts`; modify `workspace-config-store.test.ts` and matching policy, dispatch, election, relay, security, and E2E process/wire suites.
- Modify legacy migration proofs: `service/packages/mcp/test/tools/result-validation.test.ts`, `service/packages/mcp/test/tools/skew-notice.test.ts`.
- Create: `service/packages/mcp/test/control/control-router.test.ts`, `control-status.test.ts`; `service/scripts/verify-staged-change-manifest.mjs`, `service/test/change-manifest.test.ts`.
- 7A first fixes the authority generator: modify `service/scripts/vendor-upstreams.mjs`, `service/test/vendor-upstreams.test.ts`, generated `service/vendor-allowed-figwright-strings.json`, then the existing `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. Later slices apply the four closed-world classes in section 6.2.
- Create `service/schemas/upstream-lock-v2.schema.json`, `service/scripts/update-service-forks.mjs`, `service/capabilities/task-7a-authority-classes.json`, `service/test/authority-class-transition.test.ts`, `service/test/service-fork-lineage.test.ts`; modify `verify-upstream-lock.mjs`.

**Interfaces**

- Consumes: Task3/Task5 current authorities, Task4 state/workspace/path, the existing Task6 Relay interfaces where this plan names them, and only the Task6.1 public-ping/follower/control facades frozen at `39a29373b91445e9242e82611f0a8a04fca525ea` under contract `bd296dabe872f08adca793d93a2cd6a2c7efca60c58127b07924b2f18840b27b`; the exact eight export/producer paths and hashes are the section 3.5 manifest.
- Produces: leader-generation singleton `ExecutionPlane`; follower-only `FollowerInvocationClient`; strict distinct tool/service/cancel/frame schemas; MCP selector/workspace synthesis; one stable owner actor plus domain-separated MCP/control auth sessions; immutable `RuntimeExecutionScope extends PolicyInvocationContext`; `OperationInvocationService`; exact handler vs execution authorities (105/7 and 98/14); empty service-operation registry; `OperationIdIssuer`; kind/name-aware journal/tombstone/resolution; consent-fingerprinted redacted replay cache; durable exactly-once egress finalizer; bounded active admission; `FileExecutionKey` queue; strict approval prompt/decision broker with fake paired plugin; action-nonce/progress adapters; `JournalWorkspaceUsageGuard`; workspace default/registration resolver; authenticated tool/cancel/approval/workspace/operation admin routes. It does not wire the real plugin progress/cancel/approval consumer.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 7A — operation, policy, principal, target, and journal core | one owner actor/auth-session derivation, Task5 path-first policy context, handler/execution split14, TargetRequirement, empty service registry, strict admission, issuer/queue/journal, dispatched-fsync ordering, bounded two-phase demotion, opaque follower client | policy/authority/target/ownership/role-transition/demotion/crash-boundary plus ID/queue/journal/limit suites | `feat(execution): add issued idempotent journaled file queue`; exports frozen `RuntimeExecutionScope`, operation/service/journal/usage interfaces to 7B |
| 7B — approval, authenticated admin control, and action nonce | approval durability, nonce issue/CAS/caps/canonical request hash, tool/approval/workspace/operation admin endpoints, cross-domain same-owner resolution audit | control rotation, origin/resolver sessions, cross-session cancel denial, foreign stateRoot, nonce and resolve/workspace-unblock suites | `feat(control): add approved workspace and operation control`; exports authenticated routes and nonce router to Tasks 8/13 |
| 7C — egress finalizer, inner progress/framing, and production integration | durable pre/final manifest store, runtime-zero enforcement, Task6.1-decrypted follower inner framing, control/MCP plus daemon fake-plugin progress/cancel, active admission, every tool invocation entry, generation-fenced terminal CAS | finalizer exit/restart/double/crash, inclusive limits, backpressure/cancel/terminal race, cross-entry parity, no-direct-relay/no-auth-import structural suites | `feat(egress): gate runtime and stream bounded progress`; Task 8 consumes only after all reviewed 7A–7C tree/commit hashes are frozen |

Each subtask receives RED→GREEN, closed-world authority regeneration, and two independent reviews of one exact staged tree before its exact commit. Reviewers inspect `git diff --cached` plus the recorded `git write-tree` hash and do not edit. After either finding, the implementer fixes, restages, recomputes the tree, and repeats both reviews. Immediately before commit, rerun the slice GREEN, prove no unstaged tracked change, prove `git write-tree` still equals the reviewed hash, and after commit prove `HEAD^{tree}` equals it. The three already-reviewed subjects above remain binding; the amendment strengthens their contents and does not silently rename or add a fourth aggregate commit. Task 7 final review checks cross-slice execution order and authority closure without reopening an accepted tree absent a concrete finding.

For every slice, `git status --short -- service` must show only first-column staged entries from that slice's exact allowlist: no unstaged or untracked service path. `git diff --cached --name-only` must equal the allowlist subset actually changed by the slice, and the offline closed-world verifier must account for every managed path. Test output and ignored build artifacts are never staged.

7A defines the plane with injected `ApprovalDecisionPort`, `EgressManifestPort`, and `PinnedPluginRuntimePort` contracts and explicit fakes; it freezes policy/target/runtime/service seams but does not claim production entry convergence while 7B/7C are absent. 7B binds the daemon approval broker/fake paired port plus admin/action-nonce/workspace ports. 7C binds durable egress and daemon frame sinks, then atomically switches all tool invocation entries and the empty service seam to the plane. Real plugin progress/cancel consumption is Task9A and real approval-control consumption is Task9C. Only 7C requires zero legacy Relay/runtime bypass and zero import from Task6.1 auth/key/encryption internals. Intermediate slices are review checkpoints, not delivery boundaries.

7A prelude adds schema/updater/verifier tests before copy-only. Every edited upstream row—including election.ts and any other 7A copy—transitions to serviceFork; raw-string scanner also scans forks/serviceOwned so Relay allowance stays15. Generator skips forks. Tests mutate a fixture row, assert lineage/old-row removal/no overwrite/current hash.

Closed-world order uses class-aware service fork model; edited upstream paths transition before copy-only, byte-unchanged only preserve mode. serviceFiles/packageAuthorities refresh subtype hashes; root paths manifest-only.

Before/after each 7A/7B/7C staged review, run the exact `TASK6_1_FROZEN_GREEN` block in section 3.5 plus the slice's Task7 focused tests. Reports record base `39a29373b91445e9242e82611f0a8a04fca525ea`, contract `bd296dabe872f08adca793d93a2cd6a2c7efca60c58127b07924b2f18840b27b`, manifest bytes 925, and the exact path list. Task7 execution remains gated only by a fresh READY rereview of this newly checksummed binding plan.

**Exact staged path allowlists**

- 7A: `service/packages/shared/src/invocation.ts`, `service/packages/shared/src/operations.ts`, `service/packages/shared/src/service-operations.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/security/principal-derivation.ts`, `service/packages/mcp/src/policy/operation-policy.ts`, `service/packages/mcp/src/policy/policy-engine.ts`, `service/packages/mcp/src/policy/result-egress-policy.ts`, `service/packages/mcp/src/tools/runtime-registry.ts`, `service/packages/mcp/src/execution/execution-plane.ts`, `service/packages/mcp/src/execution/target-resolver.ts`, `service/packages/mcp/src/execution/service-operation-registry.ts`, `service/packages/mcp/src/execution/follower-invocation-client.ts`, `service/packages/mcp/src/execution/file-queue.ts`, `service/packages/mcp/src/execution/operation-id.ts`, `service/packages/mcp/src/execution/operation-journal.ts`, `service/packages/mcp/src/execution/operation-resolution-intent.ts`, `service/packages/mcp/src/execution/operation-executor.ts`, `service/packages/mcp/src/tool-invocation-service.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/src/election/election.ts`, `service/packages/mcp/src/election/node.ts`, `service/packages/mcp/src/relay/session.ts`, `service/packages/mcp/src/tools/ping.ts`, `service/packages/mcp/test/execution/invocation-boundary.test.ts`, `service/packages/mcp/test/execution/policy-context.test.ts`, `service/packages/mcp/test/execution/target-resolution.test.ts`, `service/packages/mcp/test/execution/target-requirement.test.ts`, `service/packages/mcp/test/execution/runtime-authority.test.ts`, `service/packages/mcp/test/execution/service-operation-registry.test.ts`, `service/packages/mcp/test/execution/follower-invocation-client.test.ts`, `service/packages/mcp/test/execution/execution-plane-lifecycle.test.ts`, `service/packages/mcp/test/execution/operation-id.test.ts`, `service/packages/mcp/test/execution/file-queue.test.ts`, `service/packages/mcp/test/execution/operation-journal.test.ts`, `service/packages/mcp/test/execution/operation-executor.test.ts`, `service/packages/mcp/test/policy/operation-policy.test.ts`, `service/packages/mcp/test/policy/result-egress-policy.test.ts`, `service/packages/mcp/test/election/election.test.ts`, `service/packages/mcp/test/election/follower.test.ts`, `service/packages/mcp/test/election/node.test.ts`, `service/packages/mcp/test/relay/session.test.ts`, `service/packages/mcp/test/tools/ping.test.ts`, `service/test/tool-contract.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7A.
- 7B: `service/packages/shared/src/action-nonce.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/policy/approval-gate.ts`, `service/packages/mcp/src/control/action-nonce-store.ts`, `service/packages/mcp/src/control/action-nonce-endpoints.ts`, `service/packages/mcp/src/control/approval-endpoints.ts`, `service/packages/mcp/src/control/tool-call-endpoint.ts`, `service/packages/mcp/src/control/workspace-endpoints.ts`, `service/packages/mcp/src/control/operation-endpoints.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/test/execution/action-nonce.test.ts`, `service/packages/mcp/test/execution/control-tool-call.test.ts`, `service/packages/mcp/test/execution/operation-resolution.test.ts`, `service/packages/mcp/test/execution/workspace-endpoints.test.ts`, `service/packages/mcp/test/election/leader-endpoints.test.ts`, `service/packages/mcp/test/security/control-auth.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7B.
- 7C: `service/packages/shared/src/progress.ts`, `service/packages/shared/src/rpc.ts`, `service/packages/shared/src/envelope.ts`, `service/packages/shared/src/protocol.ts`, `service/packages/shared/src/operations.ts`, `service/packages/shared/src/service-operations.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/policy/egress-policy.ts`, `service/packages/mcp/src/execution/egress-manifest-store.ts`, `service/packages/mcp/src/execution/follower-invocation-endpoint.ts`, `service/packages/mcp/src/execution/execution-plane.ts`, `service/packages/mcp/src/tool-invocation-service.ts`, `service/packages/mcp/src/tools/runtime-registry.ts`, `service/packages/mcp/src/relay/relay.ts`, `service/packages/mcp/src/relay/session.ts`, `service/packages/mcp/src/dispatch.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/src/election/election.ts`, `service/packages/mcp/src/election/leader-endpoints.ts`, `service/packages/mcp/src/election/node.ts`, `service/packages/mcp/test/execution/egress-policy.test.ts`, `service/packages/mcp/test/execution/egress-manifest-store.test.ts`, `service/packages/mcp/test/execution/egress-finalizer.test.ts`, `service/packages/mcp/test/execution/boundary-limits.test.ts`, `service/packages/mcp/test/execution/progress-transport.test.ts`, `service/packages/mcp/test/execution/progress-framing.test.ts`, `service/packages/mcp/test/execution/plugin-progress-adapter.test.ts`, `service/packages/mcp/test/execution/follower-stream.test.ts`, `service/packages/mcp/test/execution/no-direct-relay.test.ts`, `service/packages/mcp/test/execution/execution-plane-lifecycle.test.ts`, `service/packages/mcp/test/execution/service-operation-registry.test.ts`, `service/packages/mcp/test/dispatch.test.ts`, `service/packages/mcp/test/election/election.test.ts`, `service/packages/mcp/test/election/follower.test.ts`, `service/packages/mcp/test/election/leader-endpoints.test.ts`, `service/packages/mcp/test/election/leader-lock.test.ts`, `service/packages/mcp/test/election/node.test.ts`, `service/packages/mcp/test/relay/relay.test.ts`, `service/packages/mcp/test/relay/session.test.ts`, `service/packages/mcp/test/e2e/mcp-wire.test.ts`, `service/packages/mcp/test/e2e/process-lifecycle.test.ts`, `service/test/tool-contract.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7C.

TREE_7A complete union is the base 7A line plus exactly: `service/packages/shared/test/file-identity-hash.test.ts`, `service/packages/mcp/src/tools/spec.ts`, `service/packages/mcp/src/tools/registry.ts`, `service/packages/mcp/src/execution/mcp-invocation-adapter.ts`, `service/packages/mcp/test/execution/mcp-selector-synthesis.test.ts`, `service/packages/mcp/test/execution/service-operation-name.test.ts`, `service/packages/mcp/test/execution/completed-result-replay.test.ts`, `service/packages/mcp/test/tools/result-validation.test.ts`, `service/packages/mcp/test/tools/skew-notice.test.ts`, `service/scripts/vendor-upstreams.mjs`, `service/test/vendor-upstreams.test.ts`, `service/vendor-allowed-figwright-strings.json`, `service/schemas/upstream-lock-v2.schema.json`, `service/scripts/update-service-forks.mjs`, `service/scripts/verify-upstream-lock.mjs`, `service/scripts/verify-staged-change-manifest.mjs`, `service/capabilities/task-7a-authority-classes.json`, `service/capabilities/change-manifests/task-7a.json`, `service/test/change-manifest.test.ts`, `service/test/authority-class-transition.test.ts`, `service/test/service-fork-lineage.test.ts`. No-other-path applies to this entire union. The staged-manifest verifier and its test are created in the 7A prelude because 7A and 7B must execute it before 7C exists.

TREE_7B complete union is base 7B line plus `service/packages/shared/src/approval.ts`, `service/packages/shared/src/config.ts`, `service/packages/mcp/src/policy/approval-broker.ts`, `service/packages/mcp/src/policy/approval-prompt.ts`, `service/packages/mcp/src/execution/mcp-workspace-binding.ts`, `service/packages/mcp/src/fs/workspace-config-store.ts`, `service/packages/mcp/src/fs/workspace-registration-resolver.ts`, `service/packages/mcp/src/control/router.ts`, `service/packages/mcp/src/control/route-registry.ts`, `service/packages/mcp/src/control/status-endpoint.ts`, `service/packages/mcp/test/execution/approval-broker.test.ts`, `service/packages/mcp/test/execution/approval-plugin-port.test.ts`, `service/packages/mcp/test/execution/approval-routing-matrix.test.ts`, `service/packages/mcp/test/execution/mcp-workspace-binding.test.ts`, `service/packages/mcp/test/fs/workspace-config-store.test.ts`, `service/packages/mcp/test/fs/workspace-registration-resolver.test.ts`, `service/packages/mcp/test/fs/workspace-registration-atomicity.test.ts`, `service/packages/mcp/test/control/control-router.test.ts`, `service/packages/mcp/test/control/control-status.test.ts`, `service/capabilities/change-manifests/task-7b.json`, `service/test/authority-class-transition.test.ts`, `service/test/service-fork-lineage.test.ts`. No other path.

TREE_7C additionally includes exact `service/capabilities/change-manifests/task-7c.json`, `service/test/authority-class-transition.test.ts`, and `service/test/service-fork-lineage.test.ts`; it consumes the already committed 7A staged-manifest verifier/test without modifying or restaging them. No other path.

Task6.1 ownership rule: remove all six byte-frozen core paths and legacy `follower.ts` from every 7A/B/C staged allowlist. The sole manifest-path exception is `leader-endpoints.ts` in 7C, limited to inner-handler injection. The 7C staged report records both adapter baseline/staged hashes, proves `follower.ts` unchanged, and gives both reviewers the adapter diff plus `TASK6_1_FROZEN_GREEN` output. Any other manifest path or semantic change is out of scope and returns to Task6.1 review.

**Binding subtask execution**

- [ ] **7A RED:** First assert the checked-in legacy `InvocationContext`, `RuntimeExecutionContext`, and `RuntimeBinding.authority`, then add migration tests and run the first Vitest line of `7A_GREEN_COMMANDS`; expect migration/name/selector/new-plane assertions RED while the legacy-shape fixture is GREEN.
- [ ] **7A GREEN:** Migrate the real legacy types and authority generator in one tree, then run `7A_GREEN_COMMANDS` below verbatim. Expect no `RuntimeExecutionContext`/`RuntimeBinding.authority`/policy `InvocationContext` residual; handler105/7 vs execution98/14; exact distinct name schemas; MCP selector parity; skew/result identities; target/service/journal/demotion gates; frozen Task6.1; and allowed-string count15. Final entry cutover remains 7C.
- [ ] **7A authority, staged review, and exact commit:** Run updater before copy-only; edited `packages/mcp/src/election/election.ts` transitions to serviceFork with originCommit/base/previousMode lineage and staged current hash. Verify old copy row absent/no overwrite, review the same tree, commit exact `feat(execution): add issued idempotent journaled file queue`, and verify `HEAD^{tree}=TREE_7A`.
- [ ] **7B RED:** Run action/approval/tool/resolution/workspace/binding/invocation plus control router/status tests; expect missing strict paired approval broker, workspace registration resolver/default binding, extensible frozen router, authenticated status, durable pending approval, admin/nonce/resolution/cancel gates.
- [ ] **7B GREEN:** Implement strict approval prompt/decision broker and fake paired port, tool/workspace/default/operation admin/action-nonce endpoints, registration resolver, and production MCP workspace binding; update exact 7B authority classes, then run `7B_GREEN_COMMANDS` verbatim. Expect `sfp_an1_`+256-bit format; stat+directory+realpath issue binding and pre-effect revalidation; zero/one/multiple/default/restart workspace behavior; 120,000 ms nonce and approval TTLs; approval session/generation/target/hash CAS; durable pending before wait; same-owner admin resolution; cross-session cancel denial; and reserve/workspace unblock.
- [ ] **7B authority, staged review, and exact commit:** Stage only the exact 7B allowlist, check staged names/diff, record `TREE_7B`, and obtain independent spec+quality PASS. Rerun the entire `7B_GREEN_COMMANDS` block **verbatim**; require no unstaged service path and identical tree; commit exact `feat(control): add approved workspace and operation control`; verify `HEAD^{tree}=TREE_7B`.
- [ ] **7C RED:** Run egress/finalizer/boundary/progress/follower/no-bypass plus `test/change-manifest.test.ts`; expect missing finalizers, exact admission/inner stream, fake-plugin, terminal CAS, staged-byte verifier and convergence.
- [ ] **7C GREEN:** Run `7C_GREEN_COMMANDS` below verbatim. Expect limits/finalizers/stream/router/fake-plugin/one-terminal/verifier parity; real plugin waits for9A.
- [ ] **7C authority, staged review, and exact commit:** The literal updater in `7C_GREEN_COMMANDS` transitions the `leader-endpoints.ts` semantic adapter baseline to serviceFork before copy-only while frozen semantics remain tested. Follower stays unchanged. Verify lineage/no overwrite, staged tree, two reviews, commit exact `feat(egress): gate runtime and stream bounded progress`, and verify `HEAD^{tree}=TREE_7C`.

**`7A_GREEN_COMMANDS` — copy/paste literally before staged review and again before exact 7A commit:**

~~~powershell
pnpm -C service exec vitest run packages/shared/test/file-identity-hash.test.ts packages/mcp/test/execution/invocation-boundary.test.ts packages/mcp/test/execution/policy-context.test.ts packages/mcp/test/execution/mcp-selector-synthesis.test.ts packages/mcp/test/execution/target-resolution.test.ts packages/mcp/test/execution/target-requirement.test.ts packages/mcp/test/execution/runtime-authority.test.ts packages/mcp/test/execution/service-operation-name.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/completed-result-replay.test.ts packages/mcp/test/execution/follower-invocation-client.test.ts packages/mcp/test/execution/execution-plane-lifecycle.test.ts packages/mcp/test/execution/operation-id.test.ts packages/mcp/test/execution/file-queue.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/operation-executor.test.ts packages/mcp/test/tools/result-validation.test.ts packages/mcp/test/tools/skew-notice.test.ts packages/mcp/test/policy/operation-policy.test.ts packages/mcp/test/policy/result-egress-policy.test.ts packages/mcp/test/relay/session.test.ts packages/mcp/test/tools/ping.test.ts test/tool-contract.test.ts
pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/dispatch.test.ts packages/mcp/test/e2e
pnpm -C service typecheck
node service/scripts/update-service-forks.mjs --slice 7A --index service/capabilities/change-manifests/task-7a.json
node service/scripts/vendor-upstreams.mjs --copy-only
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts test/authority-class-transition.test.ts test/service-fork-lineage.test.ts
node service/scripts/verify-staged-change-manifest.mjs --slice 7A
~~~

**`7B_GREEN_COMMANDS` — copy/paste without path substitution before staging review and again before commit:**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/execution/action-nonce.test.ts packages/mcp/test/execution/approval-broker.test.ts packages/mcp/test/execution/approval-plugin-port.test.ts packages/mcp/test/execution/approval-routing-matrix.test.ts packages/mcp/test/execution/control-tool-call.test.ts packages/mcp/test/execution/operation-resolution.test.ts packages/mcp/test/execution/workspace-endpoints.test.ts packages/mcp/test/execution/mcp-workspace-binding.test.ts packages/mcp/test/execution/invocation-boundary.test.ts packages/mcp/test/execution/policy-context.test.ts packages/mcp/test/execution/target-resolution.test.ts packages/mcp/test/execution/target-requirement.test.ts packages/mcp/test/execution/runtime-authority.test.ts packages/mcp/test/execution/service-operation-name.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/follower-invocation-client.test.ts packages/mcp/test/execution/execution-plane-lifecycle.test.ts packages/mcp/test/execution/operation-id.test.ts packages/mcp/test/execution/file-queue.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/operation-executor.test.ts packages/mcp/test/fs/workspace-config-store.test.ts packages/mcp/test/fs/workspace-registration-resolver.test.ts packages/mcp/test/fs/workspace-registration-atomicity.test.ts packages/mcp/test/control/control-router.test.ts packages/mcp/test/control/control-status.test.ts
pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/relay
pnpm -C service exec vitest run packages/mcp/test/policy packages/mcp/test/tools/ping.test.ts test/tool-contract.test.ts
pnpm -C service typecheck
node service/scripts/update-service-forks.mjs --slice 7B --index service/capabilities/change-manifests/task-7b.json
node service/scripts/vendor-upstreams.mjs --copy-only
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts test/authority-class-transition.test.ts test/service-fork-lineage.test.ts
node service/scripts/verify-staged-change-manifest.mjs --slice 7B
~~~

**`7C_GREEN_COMMANDS` — copy/paste without path substitution before staging review and again before commit:**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/execution packages/mcp/test/policy packages/mcp/test/election packages/mcp/test/relay packages/mcp/test/dispatch.test.ts packages/mcp/test/e2e/mcp-wire.test.ts packages/mcp/test/e2e/process-lifecycle.test.ts test/tool-contract.test.ts test/change-manifest.test.ts
pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/dispatch.test.ts packages/mcp/test/e2e
pnpm -C service typecheck
node service/scripts/update-service-forks.mjs --slice 7C --index service/capabilities/change-manifests/task-7c.json
node service/scripts/vendor-upstreams.mjs --copy-only
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts test/authority-class-transition.test.ts test/service-fork-lineage.test.ts
node service/scripts/verify-staged-change-manifest.mjs --slice 7C
~~~

The numbered steps below are the code/test contract elaboration for the matching 7A, 7B, and 7C blocks above, not a second execution sequence. Write, stage, review, and commit each example only in the slice whose exact allowlist contains its file.

- [ ] **Step 1: Write executor, ID-conflict, and same-file queue RED**

~~~ts
it.each(['actorId', 'authSessionId', 'principal', 'consent', 'mode', 'allowedClasses',
  'workspaceRoot', 'target', 'FileIdentity', 'fileExecutionKey', 'pluginGeneration',
  'editorType', 'capabilities'])('rejects body-derived invocation context key %s', async forbidden => {
  await expect(parseInvocationRequest({
    version: 1, requestId, toolName: 'get_selection', targetSelector: { kind: 'active' }, [forbidden]: 'forged',
  })).rejects.toMatchObject({ code: 'INVOCATION_REQUEST_INVALID' });
});

it('resolves every declared path before pure policy and performs no content/network/runtime IO', async () => {
  await admission.parseAndEvaluate(requestFor('design_diff', { rootDir: '.', update: true }));
  expect(events).toEqual(['args-parsed', 'workspace-looked-up', 'paths-realpathed', 'effects-evaluated', 'target-resolved']);
  expect(policyContext.resolvedPaths).toMatchObject({ rootDir: { path: canonicalRoot, overwrites: false } });
  expect(contentRead).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(pluginRuntime).not.toHaveBeenCalled();
});

it('resolves a real export_pdf outPath overwrite before effects', async () => {
  await admission.parseAndEvaluate(requestFor('export_pdf', { nodeId: '1:2', outPath: existingPdf }));
  expect(policyContext.resolvedPaths?.outPath).toEqual({ path: canonicalPdf, overwrites: true });
  expect(effects).toContainEqual({ type: 'filesystem-write', pathArgs: ['outPath'], destructive: true });
});

it('separates handler parity, execution routing, target rules, and service registry', () => {
  expect(groupHandlerAuthority()).toEqual({ 'plugin-handler': 105, 'server-only': 7 });
  expect(groupExecution()).toEqual({ 'plugin-direct': 98, 'server-adapter': 14 });
  expect(serverAdapterNames()).toEqual(BASELINE_SERVER_ADAPTER_NAMES);
  expect(targetRequirement('analyze_project', {})).toBe('forbidden');
  expect(targetRequirement('ping', {})).toBe('optional');
  expect(targetRequirement('get_selection', {})).toBe('required');
  expect(Object.keys(SERVICE_OPERATION_SPECS)).toEqual([]);
});

it.each(['snapshot.capture', 'grounding.refresh'])('parses service name %s outside ToolNameSchema', name => {
  expect(ServiceOperationNameSchema.parse(name)).toBe(name);
  expect(ToolNameSchema.safeParse(name).success).toBe(false);
});

it.each([
  '', 'snapshot_capture', 'snapshot/capture', 'Snapshot.capture', 'snapshot..capture',
  '.snapshot', 'snapshot.', `${'a'.repeat(126)}.b`, `${'a'.repeat(127)}.b`,
])('rejects invalid/non-enum service name %s', name => {
  expect(ServiceOperationNameSchema.safeParse(name).success).toBe(false);
});

it.each([
  ['ping', {}, 'none'], ['get_selection', {}, 'active'],
  ['analyze_project', { rootDir: '.' }, 'none'],
])('synthesizes MCP selector after args for %s', async (toolName, rawArgs, kind) => {
  for (const role of ['leader', 'follower'] as const) {
    const request = await mcpAdapter(role).fromToolCall(toolName, rawArgs, forgedMeta);
    expect(request.targetSelector).toEqual({ kind });
    expect(request.workspaceId).toBe(toolName === 'analyze_project' ? serverResolvedWorkspaceId : null);
  }
});

it('accepts the canonical Base64Url128 selector fixture containing underscore', async () => {
  expect(Base64Url128Schema.parse(SESSION_ID_WITH_UNDERSCORE)).toBe(SESSION_ID_WITH_UNDERSCORE);
  await expect(targetResolver.resolve({ kind: 'session', sessionId: SESSION_ID_WITH_UNDERSCORE })).resolves.toBeDefined();
});

it('uses the reachable exact115-byte stable-file selector maximum', () => {
  const selector = { kind: 'stable-file', fileIdentityHash: `sha256:${'a'.repeat(64)}` } as const;
  expect(Buffer.byteLength(canonicalJson(selector), 'utf8')).toBe(TARGET_SELECTOR_MAX_BYTES);
  expect(parseInvocationTargetSelector(selector)).toEqual(selector);
  expect(() => parseInvocationTargetSelector({ ...selector, extra: 'x' })).toThrow();
});

it.each(['leader', 'follower'] as const)('%s keeps optional/required behavior with plugin disconnected', async role => {
  relay.disconnectAll();
  await expect(callMcp(role, 'ping', {})).resolves.toMatchObject({ overall: 'healthy' });
  await expect(callMcp(role, 'get_selection', {})).rejects.toMatchObject({ code: 'PLUGIN_NOT_CONNECTED' });
  relay.register(authenticatedSessionWithFile());
  await expect(callMcp(role, 'get_selection', {})).resolves.toBeDefined();
});

it('constructs one execution plane only for the current leader generation', async () => {
  expect(nodeFor('leader').executionPlane?.leaderGeneration).toBe('generation-2');
  expect(nodeFor('follower').executionPlane).toBeUndefined();
  expect(nodeFor('unknown').forwardedPayloads).toEqual([]);
  expect(nodeFor('conflicted').forwardedPayloads).toEqual([]);
});

it('derives stable domain-separated principals without trusting body identity', async () => {
  expect(deriveOwnerActor(ownerKey, 'mcp-direct')).toBe(deriveOwnerActor(ownerKey, 'control'));
  expect(deriveOwnerActor(ownerKey, 'mcp-follower')).toBe(deriveOwnerActor(ownerKey, 'mcp-direct'));
  expect(deriveMcpAuthSession(ownerKey, mcpSession, 'leader'))
    .toBe(deriveMcpAuthSession(ownerKey, mcpSession, 'follower'));
  expect(deriveControlAuthSession(ownerKey, controlTokenG1))
    .not.toBe(deriveControlAuthSession(ownerKey, controlTokenG2));
  expect(deriveOwnerActor(otherStateRootKey, 'control')).not.toBe(deriveOwnerActor(ownerKey, 'control'));
});

it('has no production bypass from entry points to relay or runtime', async () => {
  expect(await entryPointBypassesExecutionPlane([
    'packages/mcp/src/index.ts', 'packages/mcp/src/dispatch.ts',
    'packages/mcp/src/election/follower.ts', 'packages/mcp/src/election/leader-endpoints.ts',
  ])).toEqual([]);
  expect(await executionPlaneFactoryCallSites()).toEqual(['packages/mcp/src/election/node.ts']);
  expect(await importsOf('packages/mcp/src/election/follower.ts')).not.toEqual(expect.arrayContaining([
    '../tool-invocation-service.js', '../execution/operation-executor.js', '../relay/relay.js',
  ]));
});

it('derives and freezes the target from an authenticated relay session', async () => {
  relay.register(authenticatedSession({ sessionId: SESSION_ID_A, generation: 'plugin-g1', fileIdentity: fileKey('file-1') }));
  const scope = await plane.resolveScope(principal, request({ targetSelector: { kind: 'session', sessionId: SESSION_ID_A } }));
  relay.setActive(SESSION_ID_WITH_UNDERSCORE);
  expect(scope.target).toMatchObject({ sessionId: SESSION_ID_A, fileExecutionKey: 'figma:file-1' });
  expect(Object.isFrozen(scope.target)).toBe(true);
  expect(Object.isFrozen(scope.target.fileIdentity)).toBe(true);
});

it('fails instead of rerouting when the pinned session disappears', async () => {
  const running = plane.invokeTool(principal, request({ targetSelector: { kind: 'stable-file', fileIdentityHash } }));
  relay.disconnect(SESSION_ID_A);
  await expect(terminal(running)).resolves.toMatchObject({ type: 'error', error: { code: 'PINNED_SESSION_LOST' } });
  expect(relay.dispatchesFor(SESSION_ID_WITH_UNDERSCORE)).toHaveLength(0);
});

it('demotes within 5000 ms and drains at most 1000 ms before port release', async () => {
  journal.seed([record('pending-approval', pendingId), record('queued', queuedId), record('dispatched', dispatchedId)]);
  const ticket = await plane.prepareDemotion('lease-lost');
  expect(ticket.deadlineAt - ticket.startedAt).toBe(5000);
  expect(ticket.transportDrainDeadlineAt - ticket.startedAt).toBe(1000);
  expect(await plane.finalizeDemotion(ticket)).toBe('port-released');
  expect(lifecycleEvents).toEqual([
    'admission-closed', 'generation-fence-installed', 'pending-aborted', 'queued-aborted',
    'dispatched-outcome-unknown-fsynced', 'egress-finalized-and-flushed',
    'transport-drain-started', 'transport-force-closed-at-1000ms', 'plane-destroyed', 'port-released',
  ]);
  expect(clock.elapsed).toBeLessThanOrEqual(5000);
  await expect(terminal(plane.invokeTool(principal, nextRequest)))
    .resolves.toMatchObject({ type: 'error', error: { code: 'LEADER_GENERATION_CLOSED' } });
});

it('retains the leader port when required demotion durability fails', async () => {
  journal.failDispatchedUnknownFsync();
  const ticket = await plane.prepareDemotion('shutdown');
  expect(await plane.finalizeDemotion(ticket)).toBe('port-retained-durability-failure');
  expect(port.release).not.toHaveBeenCalled();
  expect(election.maxConcurrentTicks).toBe(1);
});

it('rejects the same actor operation ID with different args', async () => {
  const opId = issuer.issue(ctx.actor.actorId, fixedNow);
  const first = service.invokeTool(ctx, 'create_text', { text: 'A' }, opId);
  await expect(service.invokeTool(ctx, 'create_text', { text: 'B' }, opId))
    .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  await first;
});

it('serializes two sessions that resolve to the same file identity', async () => {
  const a = plane.invokeTool(principalA, requestForSession(SESSION_ID_A));
  const b = plane.invokeTool(principalB, requestForSession(SESSION_ID_WITH_UNDERSCORE));
  await Promise.all([a, b]);
  expect(maxConcurrentWrites).toBe(1);
});

it.each([
  ['create_text', { text: 'sensitive' }, 'design-text'],
  ['get_screenshot', {}, 'design-image'],
  ['scan_components', { rootDir: '.' }, 'project-code'],
  ['import_image', { url: 'https://assets.example.com/a.png' }, 'design-image'],
])('does not run %s when preflight disallows %s', async (tool, args, deniedClass) => {
  const runtime = vi.fn();
  await expect(invokeWithConsent(tool, args, { mode: 'external-model', allowedClasses: [] }, runtime))
    .rejects.toMatchObject({ code: 'EGRESS_CONSENT_REQUIRED', deniedClass });
  expect(runtime).not.toHaveBeenCalled();
});

it('never re-executes a persisted succeeded operation after restart or generation change', async () => {
  const opId = issuer.issue(ownerActor1, fixedNow);
  const resultHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  journal.seed(succeededRecord({ actorId: ownerActor1, operationId: opId, issuedAt: fixedNow, resultHash }));
  await expect(restarted.invokeTool(ctxWithGeneration('g2'), 'create_text', args, opId))
    .rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED', resultHash });
  await expect(restarted.invokeTool(ctxWithGeneration('g2'), 'create_text', { text: 'different' }, opId))
    .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  expect(runtime).not.toHaveBeenCalled();
});

it('replays only canonical redacted semantic bytes under exact kind/name consent fingerprint', async () => {
  const opId = issuer.issue(ownerActor1, fixedNow);
  const first = await invokeExternal({ operationId: opId, consentId: 'consent-1', allowedClasses: ['public', 'design-text'] });
  expect(first).not.toHaveProperty('secretInternalField');
  expect(Buffer.from(cache.peek(opId).canonicalRedactedResultBytes).toString('utf8')).toBe(canonicalJson(first));
  expect(cache.peek(opId).consentFingerprint).toMatchObject({
    operationKind: 'tool', operationName: 'get_design_context', mode: 'external-model', consentId: 'consent-1',
  });
  expect(cache.peek(opId)).not.toHaveProperty('rawResult');
  const direct = await replayDirect(opId), follower = await replayFollower(opId), control = await replayControl(opId);
  expect([direct.semanticResult, follower.semanticResult, control.semanticResult]).toEqual([first, first, first]);
  expect([direct.frameBytes, follower.frameBytes, control.frameBytes]).not.toEqual([follower.frameBytes, control.frameBytes, direct.frameBytes]);
  expect(runtime).toHaveBeenCalledTimes(1);
});

it.each([
  ['local-to-external', externalConsent('consent-2', ['public'])],
  ['expired', expiredConsent('consent-1')],
  ['rotated', externalConsent('consent-rotated', ['public', 'design-text'])],
  ['narrower', externalConsent('consent-1', ['public'])],
])('returns payload-free settled on %s replay consent mismatch', async (_case, currentConsent) => {
  const opId = await seedRedactedLocalOrExternalSuccess();
  await expect(replayFromControl(opId, currentConsent)).rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED' });
  expect(lastError()).not.toHaveProperty('result');
  expect(lastReplayAudit()).toMatchObject({ operationId: opId, oldFingerprintHash: expect.any(String), newFingerprintHash: expect.any(String) });
  expect(runtime).toHaveBeenCalledTimes(1);
});

it('fails new operations closed when unresolved rows hold the hard journal cap', async () => {
  const existingUnknownId = issuer.issue(ownerActor1, fixedNow);
  journal.seedRows(10000, {
    status: 'outcome-unknown', normalBytes: 32505856,
    operationIdFactory: index => index === 0 ? existingUnknownId : issuer.issue(ownerActor1, fixedNow + index + 1),
  });
  const newOpId = issuer.issue(ctx.actor.actorId, fixedNow);
  await expect(service.invokeTool(ctx, 'get_selection', {}, newOpId))
    .rejects.toMatchObject({ code: 'JOURNAL_CAPACITY_EXCEEDED' });
  expect(service.status(ownerActor1, existingUnknownId)).toBeDefined();
});

it('fails new operations when the in-horizon tombstone index is full', async () => {
  journal.seedTombstones(1000000, { bytes: 268435456, unexpired: true });
  await expect(service.invokeTool(ctx, 'get_selection', {}, issuer.issue(ownerActor1)))
    .rejects.toMatchObject({ code: 'JOURNAL_CAPACITY_EXCEEDED' });
  expect(await control.get('/control/operations?status=succeeded', actorToken)).toBeDefined();
});

it('recovers generation-bound states deterministically', async () => {
  const pendingId = issuer.issue(ownerActor1, fixedNow);
  const queuedId = issuer.issue(ownerActor1, fixedNow + 1);
  const dispatchedId = issuer.issue(ownerActor1, fixedNow + 2);
  journal.seed([
    record('pending-approval', pendingId), record('queued', queuedId), record('dispatched', dispatchedId),
  ]);
  await restarted.recover({ oldGeneration: 'g1', newGeneration: 'g2' });
  expect(statusOf(pendingId)).toEqual(['rejected', 'PLUGIN_GENERATION_CHANGED']);
  expect(statusOf(queuedId)).toEqual(['failed', 'PLUGIN_GENERATION_CHANGED']);
  expect(statusOf(dispatchedId)).toEqual(['outcome-unknown', 'PLUGIN_GENERATION_CHANGED']);
});

it('mounts authenticated workspace lifecycle routes with journal-backed removal guard', async () => {
  await control.post('/control/workspaces', { path: workspacePath, actionNonce: nonce }, actorToken);
  expect(await control.get('/control/workspaces', actorToken)).toContainEqual(expect.objectContaining({ realPath }));
  usageGuard.hasUnsettled.mockResolvedValue(true);
  await expect(control.delete(`/control/workspaces/${workspaceId}`, nextNonce, actorToken))
    .rejects.toMatchObject({ code: 'WORKSPACE_IN_USE' });
});

it('binds MCP workspace without first-root or body/meta override', async () => {
  await expect(binding.resolveRequiredForMcpSession(mcpSession)).rejects.toMatchObject({ code: 'MCP_WORKSPACE_REQUIRED' });
  await store.add(actorId, workspaceA);
  await expect(binding.resolveRequiredForMcpSession(mcpSession)).resolves.toBe(workspaceAId);
  await store.add(actorId, workspaceB);
  await expect(binding.resolveRequiredForMcpSession(mcpSession)).rejects.toMatchObject({ code: 'MCP_WORKSPACE_AMBIGUOUS' });
  await store.setDefault(actorId, workspaceBId);
  await expect(mcpAdapter('leader').fromToolCall('scan_components', { rootDir: '.', workspaceId: workspaceAId }, {}))
    .rejects.toMatchObject({ code: 'INVOCATION_ARGS_INVALID' });
  await expect(mcpAdapter('follower').fromToolCall('scan_components', { rootDir: '.' }, { workspaceId: workspaceAId }))
    .rejects.toMatchObject({ code: 'MCP_META_CONTEXT_FORBIDDEN' });
  const direct = await mcpAdapter('leader').fromToolCall('scan_components', { rootDir: '.' }, {});
  const forwarded = await mcpAdapter('follower').fromToolCall('scan_components', { rootDir: '.' }, {});
  expect([direct.workspaceId, forwarded.workspaceId]).toEqual([workspaceBId, workspaceBId]);
  await expect(store.remove(actorId, workspaceBId)).rejects.toMatchObject({ code: 'WORKSPACE_DEFAULT_IN_USE' });
  expect((await restartedStore.getDefault())).toBe(workspaceBId);
  await restartedStore.setDefault(actorId, null);
  await restartedStore.remove(actorId, workspaceBId);
  await expect(restartedBinding.resolveRequiredForMcpSession(mcpSession)).resolves.toBe(workspaceAId);
});

it('issues and atomically consumes one action-bound 256-bit nonce', async () => {
  const registration = await registrationResolver.resolveForNonce(workspacePath);
  const requestHash = hashActionRequest('workspace.add', { realPath: registration.realPath });
  const claims = await control.post('/control/action-nonces', {
    action: 'workspace.add', requestHash, registrationPath: workspacePath,
  }, actor1ControlToken);
  expect(claims.value).toMatch(/^sfp_an1_[A-Za-z0-9_-]{43}$/);
  clock.advance(119999);
  const attempts = await Promise.allSettled([
    addResolvedWorkspace(claims.value, registration), addResolvedWorkspace(claims.value, registration),
  ]);
  expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect(await nonceStore.get(claims.value)).toMatchObject({ state: 'consumed' });
});

it.each([
  ['raw path hash', (_realPath: string) => hashRaw({ path: workspacePath })],
  ['unicode alias', (_realPath: string) => hashActionRequest('workspace.add', { realPath: unicodeAliasRealPath })],
  ['wrong realpath', (_realPath: string) => hashActionRequest('workspace.add', { realPath: otherRealPath })],
  ['wrong action', (_realPath: string) => hashActionRequest('workspace.remove', { workspaceId })],
])('rejects %s before workspace side effect', async (_label, makeWrongHash) => {
  const registration = await registrationResolver.resolveForNonce(workspacePath);
  const wrongHash = makeWrongHash(registration.realPath);
  await expect(issueWorkspaceAddNonce({ actorId: ownerActor1, registrationPath: workspacePath, requestHash: wrongHash }))
    .rejects.toMatchObject({ code: 'ACTION_NONCE_REQUEST_HASH_MISMATCH' });
  expect(sideEffect).not.toHaveBeenCalled();
});

it.each(['before-queue', 'while-queued', 'during-revalidation', 'immediately-before-cas'])
('revalidates identity inside mutation queue for swap %s', async swapPoint => {
  const registration = await registrationResolver.resolveForNonce(workspacePath);
  const requestHash = hashActionRequest('workspace.add', { realPath: registration.realPath });
  const nonce = await issueWorkspaceAddNonce({ registrationPath: workspacePath, requestHash });
  scheduleDirectorySwap(workspacePath, swapPoint);
  await expect(store.addResolved(ownerActor1, registration, () => consumeNonceCas(nonce)))
    .rejects.toMatchObject({ code: 'WORKSPACE_REGISTRATION_CHANGED' });
  expect(await nonceStore.get(nonce)).toMatchObject({ state: 'issued' });
  expect(await store.list()).toEqual([]);
  expect(sideEffect).not.toHaveBeenCalled();
});

it('revalidates registered root identity on every later access', async () => {
  const registration = await registrationResolver.resolveForNonce(workspacePath);
  await store.addResolved(ownerActor1, registration, consumeValidNonceCas);
  replaceDirectoryAtSameSpelling(workspacePath);
  await expect(workspacePolicy.resolveRead(workspaceId, 'src/index.ts'))
    .rejects.toMatchObject({ code: 'WORKSPACE_ROOT_IDENTITY_CHANGED' });
  expect(fileRead).not.toHaveBeenCalled();
});

it('binds a redacted approval decision to paired session/generation/target and settles once', async () => {
  const prompt = await broker.prompt(resolvedScope, effects, operationId);
  expect(ApprovalPromptV1Schema.parse(prompt)).toEqual(prompt);
  expect(JSON.stringify(prompt)).not.toMatch(/Secret layer|base64|https?:|controlToken|workspacePath/);
  fakePairedPort.reconnectWithResume({ sameSession: true, samePluginGeneration: true });
  expect(await fakePairedPort.nextPrompt()).toMatchObject({ approvalId: prompt.approvalId, promptHash: prompt.promptHash });
  const decision = { version: 1, type: 'approval.decision', approvalId: prompt.approvalId,
    operationId, promptHash: prompt.promptHash, decision: 'approved' } as const;
  await expect(broker.settle(authenticatedBoundSession, decision)).resolves.toMatchObject({ decision: 'approved' });
  await expect(broker.settle(authenticatedBoundSession, decision)).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_SETTLED' });
  expect(runtime).toHaveBeenCalledTimes(1);
  expect(fakePairedPort.receivedControlToken).toBe(false);
});

it.each(['wrong-session', 'wrong-generation', 'wrong-target', 'wrong-hash', 'expired'] as const)
('rejects approval decision bound to %s before runtime', async fault => {
  const { prompt, decision, principal } = approvalFaultFixture(fault);
  if (fault === 'expired') clock.set(prompt.expiresAt);
  await expect(broker.settle(principal, decision)).rejects.toMatchObject({ code: expect.stringMatching(/^APPROVAL_/) });
  expect(runtime).not.toHaveBeenCalled();
});

it('uses owner-control binding for target-none grounding refresh and CLI waiter', async () => {
  const prompt = await broker.prompt(controlResolvedScope({ target: null }), effects, operationId, {
    channel: 'owner-control-session', originControlAuthSessionId,
  });
  const binding = await broker.binding(prompt.approvalId);
  expect(binding).toMatchObject({
    channel: 'owner-control-session', originControlAuthSessionId,
    leaderGeneration, fileExecutionKey: null, decisionTransport: 'authenticated-control',
  });
  await expect(broker.settle(ownerControlPrincipal, decisionFor(prompt))).resolves.toMatchObject({ decision: 'approved' });
  await expect(broker.settle(rotatedControlPrincipal, decisionFor(prompt)))
    .rejects.toMatchObject({ code: 'APPROVAL_CONTROL_SESSION_MISMATCH' });
});

it.each([
  ['wrong actor', otherActor, 'generation-1', 'workspace.add', requestHash],
  ['wrong generation', actor, 'generation-2', 'workspace.add', requestHash],
  ['wrong action', actor, 'generation-1', 'workspace.remove', requestHash],
  ['wrong request', actor, 'generation-1', 'workspace.add', otherRequestHash],
])('rejects a nonce bound to %s before side effect', async (_label, caller, generation, action, hash) => {
  await expect(consumeAndAct(caller, generation, nonce, action, hash)).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
  expect(sideEffect).not.toHaveBeenCalled();
});

it('invalidates outstanding action nonces on restart or generation change and never evicts live rows', async () => {
  await nonceStore.fill({ actorId, rows: 1024, bytes: 524288, unexpired: true });
  const removeHash = hashActionRequest('workspace.remove', { workspaceId });
  await expect(issueNonce(actor, 'workspace.remove', removeHash)).rejects.toMatchObject({ code: 'ACTION_NONCE_CAPACITY_EXCEEDED' });
  await expect(restarted.consumeCas(actor, nonce, 'workspace.remove', removeHash)).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
});

it('rejects forged and expired server-issued operation IDs before runtime', async () => {
  const issued = issuer.issue(ownerActor1, nowMinusDays(31));
  await journal.purgeExpiredTombstones(now);
  await expect(service.invokeTool(ctx, 'create_text', args, issued))
    .rejects.toMatchObject({ code: 'OPERATION_ID_EXPIRED' });
  await expect(service.invokeTool(ctx, 'create_text', args, tamper(issued)))
    .rejects.toMatchObject({ code: 'OPERATION_ID_INVALID' });
  expect(runtime).not.toHaveBeenCalled();
});

it('resolves unknown work without permitting same-ID replay', async () => {
  const unknownId = issuer.issue(ownerActor1, now);
  journal.seed(record('outcome-unknown', unknownId, {
    operationKind: 'tool', operationName: 'create_text', argsHash: hash(args), workspaceId: ctx.workspace.workspaceId,
    fileExecutionKey: ctx.target.fileExecutionKey,
  }));
  await control.post(`/control/operations/${encodeURIComponent(unknownId)}/resolve`, {
    decision: 'resolved-applied', reasonHash, evidenceHash,
    confirm: `${unknownId}/unknown`, actionNonce,
  }, actorToken);
  expect(await control.get(`/control/operations/${encodeURIComponent(unknownId)}`, actorToken))
    .toMatchObject({
      status: 'resolved-applied', operationKind: 'tool', operationName: 'create_text', argsHash: hash(args),
      workspaceId: ctx.workspace.workspaceId, fileExecutionKey: ctx.target.fileExecutionKey,
    });
  await expect(service.invokeTool(ctx, 'create_text', args, unknownId))
    .rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED' });
});

it('allows same-owner admin resolution across domains but binds cancel to origin auth session', async () => {
  journal.seed(record('outcome-unknown', unknownId, {
    actorId: ownerActorId, originAuthSessionId: mcpAuthSession,
    operationKind: 'tool', operationName: 'create_text',
  }));
  await expect(plane.cancel(controlPrincipalAfterRotation, { version: 1, requestId, operationId: unknownId }))
    .rejects.toMatchObject({ code: 'CANCEL_AUTH_SESSION_MISMATCH' });
  await control.resolve(unknownId, resolutionBody, controlPrincipalAfterRotation);
  expect(journal.resolutionIntents.get(unknownId)).toMatchObject({
    actorId: ownerActorId, originAuthSessionId: mcpAuthSession,
    resolverAuthSessionId: controlPrincipalAfterRotation.authSessionId,
  });
  await expect(foreignStateRootControl.status(unknownId)).rejects.toMatchObject({ code: 'OPERATION_NOT_FOUND' });
});

it('uses the reserved resolution intent at the normal hard cap and immediately unblocks', async () => {
  const unknownId = issuer.issue(ctx.actor.actorId, fixedNow);
  journal.seedRows(10000, {
    status: 'outcome-unknown', normalBytes: 32505856,
    operationIdFactory: index => index === 0 ? unknownId : issuer.issue(ctx.actor.actorId, fixedNow + index + 1),
  });
  await control.post(`/control/operations/${encodeURIComponent(unknownId)}/resolve`, {
    decision: 'abandoned', reasonHash, evidenceHash,
    confirm: `${unknownId}/unknown`, actionNonce,
  }, actorToken);
  expect(journal.resolutionIntentFsyncs).toBe(1);
  expect(journal.activeRows).toBe(9999);
  expect(journal.normalBytes).toBeLessThan(32505856);
  await expect(service.invokeTool(ctx, 'get_selection', {}, issuer.issue(ctx.actor.actorId))).resolves.toBeDefined();
});

it('keeps resolution authoritative when the normal tombstone index is full', async () => {
  const unknownId = issuer.issue(ctx.actor.actorId, fixedNow);
  journal.seedTombstones(1000000, { bytes: 268435456, unexpired: true });
  journal.seed(record('outcome-unknown', unknownId, {
    operationKind: 'tool', operationName: 'create_text', argsHash: hash(args), workspaceId: ctx.workspace.workspaceId,
    fileExecutionKey: ctx.target.fileExecutionKey,
  }));
  await control.post(`/control/operations/${encodeURIComponent(unknownId)}/resolve`, {
    decision: 'resolved-not-applied', reasonHash, evidenceHash,
    confirm: `${unknownId}/unknown`, actionNonce,
  }, actorToken);
  expect(journal.resolutionIntents.get(unknownId)?.decision).toBe('resolved-not-applied');
  await expect(service.invokeTool(ctx, 'create_text', args, unknownId))
    .rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED' });
  await expect(service.invokeTool(ctx, 'create_text', { ...args, text: 'different' }, unknownId))
    .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
});

it('fails a full resolution reserve without changing the unknown record', async () => {
  const unknownId = issuer.issue(ctx.actor.actorId, fixedNow);
  journal.seed(record('outcome-unknown', unknownId));
  journal.fillResolutionReserve(1048576);
  await expect(control.post(`/control/operations/${encodeURIComponent(unknownId)}/resolve`, {
    decision: 'abandoned', reasonHash, evidenceHash,
    confirm: `${unknownId}/unknown`, actionNonce,
  }, actorToken)).rejects.toMatchObject({
    code: 'RESOLUTION_RESERVE_FULL', manualExportCommand: 'sfp operations unresolved --json',
  });
  expect(service.status(ctx.actor.actorId, unknownId)?.status).toBe('outcome-unknown');
});

it('fsyncs preflight, dispatched, one finalizer, and terminal before frames', async () => {
  await collect(plane.invokeTool(principal, requestFor('get_screenshot')));
  expect(events).toEqual([
    'pre-manifest-append', 'pre-manifest-fsync', 'output-row-reserved',
    'queued', 'dispatched-append', 'dispatched-fsync', 'first-runtime-side-effect',
    'output-finalizer-append', 'output-finalizer-fsync', 'reservation-released',
    'terminal-operation-fsync', 'terminal-frame',
  ]);
  expect(readDurableManifest(operationId)).not.toHaveProperty('rawArgs');
  expect(readDurableManifest(operationId)).not.toHaveProperty('result');
});

it('fails pre-runtime at manifest capacity and marks a post-runtime durability loss unknown', async () => {
  egressStore.seed({ rows: 200000, bytes: 268435456 });
  await expect(terminal(plane.invokeTool(principal, requestFor('create_text'))))
    .resolves.toMatchObject({ type: 'error', error: { code: 'EGRESS_MANIFEST_CAPACITY_EXCEEDED' } });
  expect(runtime).not.toHaveBeenCalled();
  egressStore.resetBelowCap().failFinalizerFsync();
  await collect(plane.invokeTool(principal, requestFor('create_text')));
  expect(statusOf(operationId)).toEqual(['outcome-unknown', 'EGRESS_MANIFEST_DURABILITY_FAILED']);
  expect(egressStore.reservedBytes(operationId)).toBe(65536);
});

it.each(['output', 'no-output', 'outcome-unknown'])('finalizes %s exactly once across restart', async kind => {
  const reservation = egressStore.seedReservation({ operationId, kind });
  const first = await restarted.finalizeFromJournal(reservation);
  const second = await restarted.finalizeFromJournal(reservation);
  expect(second).toEqual(first);
  expect(egressStore.finalizerRows(operationId)).toHaveLength(1);
  expect(egressStore.reservedBytes(operationId)).toBe(0);
});

it('uses durable output finalizer to repair a missing terminal without reruntime', async () => {
  egressStore.seedFinalizer(outputFinalizer({ operationId, resultHash }));
  journal.seed(record('dispatched', operationId));
  await restarted.recover();
  expect(statusOf(operationId)).toEqual(['succeeded', resultHash]);
  expect(runtime).not.toHaveBeenCalled();
});

it('recovers only a final truncated egress row and fails closed on mid-chain corruption', async () => {
  await expect(recoverEgress(finalTruncatedTailFixture())).resolves.toMatchObject({ truncatedTailDiscarded: true });
  await expect(recoverEgress(midChainCorruptionFixture())).rejects.toMatchObject({ code: 'EGRESS_MANIFEST_CORRUPT' });
});

it('bounds and frames progress without dropping terminal frames', async () => {
  const frames = await followerRpc(requestFor('export_video'), { slowConsumer: true });
  expect(frames.every(hasFourByteBigEndianLengthAndStrictMessagePack)).toBe(true);
  expect(maxObservedSubscriberFrames).toBeLessThanOrEqual(64);
  expect(maxObservedSubscriberBytes).toBeLessThanOrEqual(262144);
  expect(maxObservedProgressRate).toBeLessThanOrEqual(20);
  expect(frames.at(-1)?.type).toMatch(/result|error/);
});

it('uses explicit cancel and does not treat disconnect as cancel or retry', async () => {
  const running = plane.invokeTool(principal, requestFor('export_video'));
  follower.disconnect();
  expect(runtimeSignal.aborted).toBe(false);
  expect(runtimeCalls).toBe(1);
  await plane.cancel(principal, { version: 1, requestId, operationId });
  expect(runtimeSignal.aborted).toBe(true);
  expect(runtimeCalls).toBe(1);
});
~~~

- [ ] **Step 2: Run execution RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/execution`.

Expected: FAIL because strict invocation/principal/target/leader-plane and executor/queue/journal modules are absent; `TASK6_1_FROZEN_GREEN` stays green.

- [ ] **Step 3: Implement queue and idempotency state machine**

Construct one plane with stable actor/auth, policy/target/runtime/journal. Inject the frozen Task6.1 mcpSession/stream/public facade; followers consume AsyncIterable plaintext and unknown/conflicted reject. Public resolver remains undefined until Task7 installs authenticated target resolution; `/control/status` owns oracles.

Issue/verify IDs before lookup. Exact `(actor,ID,kind,name,args,workspace,file)` shares one Promise; mismatch conflicts. Cache limits remain128/8MiB/60s but values are canonical redacted result bytes+schema hash+fingerprint containing kind/name/mode/consent/classes/policy. Replay reauthenticates, validates fingerprint and schema, then adapters reframe; mismatch is payload-free settled+audit. Eviction/restart retains durable settled semantics. Role/control rotation, cancel binding, demotion CAS, read/write concurrency and post-dispatch unknown behavior remain. Structural tests reject literal IDs and bypasses.

- [ ] **Step 4: Implement owner-state operation journal and recovery**

Append transitions under `stateRoot/journal/{actor-hash}.operations.v1.jsonl`, fsync each append, checksum compacted snapshots, retain unsettled/unknown records, mark recovered dispatched records unknown, and tolerate one truncated tail after crash. Apply `JournalLimits`: compact active transitions at 8,000 rows or 24 MiB; stop normal operation appends at 10,000 rows or 31 MiB of the 32 MiB active-state allocation; reserve the final exact 1 MiB exclusively for `resolution-intents.v1.jsonl`; keep the separate normal tombstone index through the signed horizon with a 1,000,000-entry/256 MiB cap. If unresolved transitions prevent active compaction, allow status/doctor/operation list-status-resolve only. Resolve appends and fsyncs one confirmation record to the reserve before changing state, immediately compacts the matching unknown row, and treats the resolution record itself as the no-replay tombstone when the normal tombstone index is full. Reserve records merge into the normal tombstone index only when capacity exists and purge after signed expiry. A full reserve fails `RESOLUTION_RESERVE_FULL` with a sanitized manual-export path and leaves the unknown record unchanged. Every other operation at normal cap fails `JOURNAL_CAPACITY_EXCEEDED`. Persist no raw result. Export `JournalWorkspaceUsageGuard.hasUnsettled(workspaceId)` for Task 4 store wiring.

Records carry `operationKind`/`operationName` and `originAuthSessionId`. Pending approval is appended+fsynced before waiting. Queue dispatch permission is not released until the dispatched transition fsync succeeds; only then may `PinnedPluginRuntimePort`, filesystem, or network observe the operation. Terminal append is generation-CAS fenced and occurs only after one durable egress finalizer. Table-driven crash injection after pending append, pre-manifest reserve, queue, dispatched append-before-fsync, dispatched fsync-before-side-effect, runtime, finalizer, and terminal proves the exact recovery state and runtime call count.

The manual-export guidance in that error is the literal command `sfp operations unresolved --json`; operators choose the output destination in their shell, so the daemon never writes an emergency export outside configured policy.

Before fsync, resolution-intent construction copies the active record’s signed issuedAt and complete tool/args/workspace/file/result fingerprint. Compaction may remove the active row only after that durable fingerprint exists, so reserved resolutions preserve settled-versus-conflict behavior without the normal tombstone index.

- [ ] **Step 5: Implement approvals and central control call**

`/control/tools/call` is routeClass tool and accepts only `InvocationRequestV1`; `/control/tools/cancel` accepts only `InvocationCancelV1` and enforces exact originAuthSession. MCP direct/follower and control tools use the same `invokeTool` plane path. The service-operation registry is exact empty in Task 7; no MCP registration/count changes. Task 11's snapshot/grounding endpoints later construct `ServiceOperationRequestV1` with the distinct dotted schema and call `invokeService`. Pair/workspace/network/approval/operation-resolution endpoints are routeClass admin and cannot pass a tool/service name or runtime. Approval endpoints append+fsync pending before wait, list redacted pending summaries, and route only strict `ApprovalPromptV1`/`ApprovalDecisionV1` through the broker/fake paired port. Runtime remains forbidden until one bound decision CAS; plugin control frames are not runtime and never carry a control token.

Mount authenticated `POST /control/action-nonces` with strict `ActionNonceIssueRequestV1`. Workspace add resolves at issue, then invokes only atomic queued `WorkspaceConfigStore.addResolved(actor,expected,consumeNonceCas)`; `WorkspacePolicy` remains exclusively the registered-workspace access boundary and revalidates root identity on use. Every other nonce route validates its semantic object, recomputes hash, then consumes immediately before effect. Workspace add/remove/default uses JournalWorkspaceUsageGuard and v2 store. Mount POST/DELETE `/control/workspaces/default` with `workspace.set-default` nonce; current default removal is guarded. Operation issue/list/status use stable owner actor. Single-ID resolve records origin+resolver auth, requires nonce/evidence/confirmation, fsyncs reserve, never authorizes replay; foreign root and cross-session cancel fail. Tests cover every awaited directory-swap point with nonce unconsumed/config rows0/effects0, subsequent root replacement, default/restart, actor/generation/action/hash, Unicode, concurrency/expiry, reserve, and same-ID replay. Without valid paired approval or authenticated control waiter, explicit approval is `APPROVAL_CHANNEL_UNAVAILABLE`.

- [ ] **Step 6: Implement result validation, egress ordering, and progress transport**

Execute exact section3.3: strict request→args/workspace/path-policy→effects→target/deep-frozen ResolvedInvocationScope→capacity→durable pending/approval→egress authorization and final RuntimeExecutionScope→pre-egress fsync/reserve→queue→dispatched fsync→first effect→result/classify/hash/redact→one finalizer fsync→terminal fsync→one frame. Unknown/cap/target/policy/reserve rejection is runtime zero; post-runtime breach finalizes unknown. Hashing omits its own hash field.

Use sections 3.11/3.12 exactly. Consume only Task6.1-authenticated decrypted follower plaintext, parse inner prefix before allocation, and keep Task6.1 outer transport opaque. Control uses bounded JSON/NDJSON; direct MCP uses the same logical cap and standard progress/cancel. Task 7 tests `$progress`/`$cancel` against a fake `PinnedPluginRuntimePort` only; Task 9A owns actual plugin listeners/wiring. Enforce inclusive phase/message/frame/rate/subscriber/active/raw-args caps, bounded drain, origin-auth-session cancel, and exact-one terminal CAS. Disconnect is never implicit retry/cancel.

- [ ] **Step 7: Run execution GREEN and cross-entry parity**

Run: `pnpm -C service exec vitest run packages/mcp/test/execution packages/mcp/test/fs/workspace-config-store.test.ts packages/mcp/test/fs/workspace-registration-resolver.test.ts packages/mcp/test/policy packages/mcp/test/election packages/mcp/test/relay packages/mcp/test/security packages/mcp/test/tools/result-validation.test.ts packages/mcp/test/tools/skew-notice.test.ts packages/mcp/test/dispatch.test.ts packages/mcp/test/e2e/mcp-wire.test.ts packages/mcp/test/e2e/process-lifecycle.test.ts test/tool-contract.test.ts`, then `node service/scripts/verify-upstream-lock.mjs --offline`, `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`, and `pnpm -C service typecheck`.

Expected: `TASK6_1_FROZEN_GREEN` plus distinct name parsers, selector/workspace synthesis, owner/auth/policy/target/handler-execution/service0, approval broker, consent-safe replay, journal/demotion/ID/admin/queue/nonce/finalizer/limits/one-terminal gates; fake plugin only and no private outer imports.

- [ ] **Step 8: Request independent spec review**

For each staged tree, review tool/service/admin entry through one plane; Task5 migration, final Task6.1 facade/private boundary, actor/auth, target/runtime, journal/finalizer, limits/router and fake-only plugin. Verdict names tree.

- [ ] **Step 9: Request independent quality review**

For the same tree, the quality reviewer checks owner/auth derivation hygiene, policy/target immutability, operation/terminal/finalizer CAS races, demotion tick/port failure, journal/egress crash recovery, active/raw/subscriber admission, opaque transport separation, result validation, framing/backpressure/cancel, sensitive audit, and closed-world closure.

- [ ] **Step 10: Verify the three-commit execution-plane handoff**

Run diff/log/full GREEN. Expected original subjects/order/reviewed trees, clean worktree, final Task6.1 base/hash/path manifest, tool112 handler105/7 execution98/14 service0. No squash/aggregate.

### Task 8 — Confine filesystem access and move URL fetching into the daemon

**Files**

- Create: `service/packages/mcp/src/fs/atomic-file.ts`, `service/packages/mcp/src/network/remote-image-fetcher.ts`, `remote-domain-config-store.ts`.
- Create network-domain endpoints and modify Task7 route-registry; Task7's consumer adapter installs the frozen router through the final Task6.1 facade hook, so Task8 edits no Task6.1 producer.
- Delete/move repo-walk source/test to `fs/`; modify every import including exact `service/packages/mcp/src/scan/scan.ts` and its `service/packages/mcp/test/scan/scan.test.ts`.
- Modify: local tool modules `analyze-project.ts`, `scan-components.ts`, `component-map.ts`, `token-map.ts`, `icon-map.ts`, `design-diff.ts`, `save-screenshots.ts`, `save-image-fills.ts`, `export-pdf.ts`, `export-video.ts`.
- Modify: `service/packages/mcp/src/tools/runtime-registry.ts` so `import_image(url)` becomes a server wrapper that fetches bytes and dispatches `data`.
- Create: `service/packages/mcp/test/fs/local-tool-boundary.test.ts`, `atomic-file.test.ts`; `service/packages/mcp/test/network/remote-image-fetcher.test.ts`, `dns-pinning.test.ts`, `remote-domain-config.test.ts`, `import-image-runtime.test.ts`.

**Interfaces**

- Consumes: Task 4 WorkspacePolicy, Task 5 `PolicyInvocationContext.resolvedPaths`/effects, Task 7 immutable `RuntimeExecutionScope`, `PinnedPluginRuntimePort`, `server-adapter` routing, target rules, exact image/request limits, and action-nonce router.
- Produces: `AtomicFileStore.createNew/replace`, sandboxed `RepoReader`, DNS-pinned `RemoteImageFetcher`, `RemoteDomainConfigStore`, authenticated `/control/network/domains*`, safe `import_image` server runtime; no direct local tool fs access outside approved adapters. Task 11 consumes `WorkspacePolicy` and `AtomicFileStore` to build snapshot storage after IR owns the port.

**Commit protocol:** Task8 is exactly two subcommits, resolving the former “two slices/one commit” contradiction. 8A manifest is `task-8a.json`; 8B is `task-8b.json`.

| Slice | Exact logical semantic set | Exact subject |
|---|---|---|
| 8A filesystem | repo-walk moves; atomic/workspace; exact scan/scan.ts+test migration; ten tools; generated direct-fs rows; fs/boundary tests | `feat(io): sandbox workspace files` |
| 8B network/control | network fetcher/domain store, network endpoint, route-registry, import-image/runtime registry and exact tests | `feat(io): pin approved remote image domains` |

8A generator scope explicitly includes `packages/mcp/src/scan/scan.ts`; task-8a manifest must contain it and `packages/mcp/test/scan/scan.test.ts` plus declared moves/adapters/tests. Direct-fs ledger includes scoped tool/icon/profile/token/scan importers; no undisclosed scanner.

The repo-walk source and test relocation are exact `ServiceForkLineageV1 transition:'move'` rows: cached index must contain D+A for each old/new pair, both old destinations remain copy-only excluded with no blob/serviceOwned entry, both new destinations are excluded+serviceOwned with exact `newSha256`, and the 8A verifier runs the move/incomplete-pair/no-recreation fixtures before commit.

- [ ] **Step 1: Write filesystem-read/write boundary RED**

~~~ts
it('rejects a symlinked source file returned by repo walking', async () => {
  await makeSymlink(outsideFile, join(workspace, 'src', 'escape.ts'));
  await expect(reader.readText(workspaceId, 'src/escape.ts')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' });
});

it('keeps the old file when atomic replacement fails before rename', async () => {
  await expect(store.replace(target, bytes, { failBeforeRename: true })).rejects.toBeDefined();
  expect(await readFile(target, 'utf8')).toBe('old');
});
~~~

- [ ] **Step 2: Write network SSRF RED**

~~~ts
it.each([
  'https://127.0.0.1/a.png',
  'https://[::1]/a.png',
  'https://169.254.169.254/a.png',
])('rejects private or link-local URL %s', async url => {
  await expect(fetcher.fetchApproved(url, policy, signal)).rejects.toMatchObject({ code: 'REMOTE_ADDRESS_DENIED' });
});

it('pins the vetted address and preserves hostname TLS verification', async () => {
  resolver.mockResolvedValueOnce([{ address: publicA, family: 4 }]).mockResolvedValueOnce([{ address: privateB, family: 4 }]);
  await fetcher.fetchApproved('https://assets.example.com/a.png', policy, signal);
  expect(connector.connectedAddress).toBe(publicA);
  expect(connector.servername).toBe('assets.example.com');
  expect(resolver).toHaveBeenCalledTimes(1);
});

it('rejects remoteAddress drift and a redirect that re-resolves private', async () => {
  connector.remoteAddress = privateB;
  await expect(fetcher.fetchApproved('https://assets.example.com/a.png', policy, signal))
    .rejects.toMatchObject({ code: 'REMOTE_ADDRESS_CHANGED' });
  connector.remoteAddress = publicA;
  connector.redirectTo('https://cdn.example.com/b.png');
  resolver.forHost('cdn.example.com').returns([{ address: privateB, family: 4 }]);
  await expect(fetcher.fetchApproved('https://assets.example.com/a.png', policy, signal))
    .rejects.toMatchObject({ code: 'REMOTE_ADDRESS_DENIED' });
});

it('does not let one-call approval expand an empty domain allowlist', async () => {
  await expect(fetchApprovedOperation('https://new.example.com/a.png', { approved: true }))
    .rejects.toMatchObject({ code: 'REMOTE_DOMAIN_NOT_ALLOWED' });
  expect(await domains.list()).toEqual([]);
});

it.each(['com', 'co.uk', 'example.com', '*.example.com', '.assets.example.com', 'assets.example.com.'])
  ('rejects non-exact or fewer-than-three-label rule %s', async fqdn => {
    await expect(domains.add(actorId, fqdn)).rejects.toMatchObject({ code: 'REMOTE_FQDN_INVALID' });
  });

it('stores only exact ASCII FQDN equality', async () => {
  await domains.add(actorId, 'assets.example.com');
  expect(await domains.list()).toEqual([expect.objectContaining({ fqdnAscii: 'assets.example.com' })]);
  expect(matchesAllowed('img.assets.example.com')).toBe(false);
});
~~~

- [ ] **Step 3: Run slice REDs**

Run 8A RED: `pnpm -C service exec vitest run packages/mcp/test/fs/local-tool-boundary.test.ts packages/mcp/test/fs/atomic-file.test.ts packages/mcp/test/fs/repo-walk.test.ts packages/mcp/test/scan/scan.test.ts`. Run 8B RED: `pnpm -C service exec vitest run packages/mcp/test/network packages/mcp/test/control/control-router.test.ts`.

Expected: direct fs imports and URL plugin dispatch remain; symlink/redirect/size tests fail.

- [ ] **Step 4: Route every project read and write through adapters**

Inject WorkspacePolicy/RepoReader/AtomicFileStore into the ten listed local tools and token/profile/icon scanners. A structural test rejects `node:fs` and `node:fs/promises` imports outside `fs/`, state journal, packaging scripts, and explicitly approved read-only install metadata modules. Repo walk returns scanned/skipped/truncated counts. Do not define or import `SnapshotStoragePort` in Task 8; it exports only the two filesystem primitives that Task 11 later consumes.

- [ ] **Step 5: Implement atomic create-new and replacement semantics**

Create temp files in the target directory, fsync file, rename, fsync parent where supported, and clean temp on failure. `createNew` rejects existing output; `replace` requires destructive effect/approval. No output path is resolved outside a workspace.

- [ ] **Step 6: Implement RemoteImageFetcher and runtime conversion**

Apply every rule in section 3.10 inside the already path/policy/target-resolved scope. `import_image` remains handlerAuthority plugin-handler but execution `server-adapter`; it fetches/validates bytes then invokes only `PinnedPluginRuntimePort` on the frozen required target—never Relay/session resolution. Enforce decoded 6,291,456 and base64 8,388,608 exact inclusive limits before decode/plugin runtime, with declared/chunked below/exact/above tests. Approval and durable pre-egress admission precede DNS/fetch.

- [ ] **Step 7: Implement allowed-domain configuration and control routes**

Persist normalized exact FQDN rules under stateRoot with empty default. Mount `GET /control/network/domains`, `POST /control/network/domains` with `{fqdn,actionNonce}`, and `DELETE /control/network/domains/:fqdn` with `x-sfp-action-nonce` behind Task6.1 control auth. The client first issues a Task 7 nonce for exact `network-domain.add`/`network-domain.remove` plus canonical request hash; these routes reuse Task 7 semantic-validate-then-CAS middleware and do not define another nonce store or wire shape. Reject `com`, `co.uk`, `example.com`, wildcard, leading/trailing dot, IP literal, port/path/userinfo, fewer-than-three labels, body-supplied actor/context, reused/misbound nonce, and approval-based expansion; accept exact ASCII `assets.example.com` and the `domainToASCII` result of a three-label Unicode host. Audit actor/time/exact FQDN only. There is no semantic public-suffix claim or PSL data in v0.1 because suffix matching is absent.

- [ ] **Step 8: Run exact slice GREEN commands**

8A GREEN: `pnpm -C service exec vitest run packages/mcp/test/fs/local-tool-boundary.test.ts packages/mcp/test/fs/atomic-file.test.ts packages/mcp/test/fs/repo-walk.test.ts packages/mcp/test/fs/workspace-policy.test.ts packages/mcp/test/scan/scan.test.ts`; `pnpm -C service typecheck`; `node service/scripts/update-service-forks.mjs --slice 8A --index service/capabilities/change-manifests/task-8a.json`; `AUTHORITY_GREEN`; `node service/scripts/verify-staged-change-manifest.mjs --slice 8A`.

8B GREEN: `pnpm -C service exec vitest run packages/mcp/test/network packages/mcp/test/control/control-router.test.ts packages/mcp/test/execution/action-nonce.test.ts packages/mcp/test/execution/boundary-limits.test.ts`; `TASK6_1_FROZEN_GREEN`; `pnpm -C service typecheck`; `node service/scripts/update-service-forks.mjs --slice 8B --index service/capabilities/change-manifests/task-8b.json`; `AUTHORITY_GREEN`; `node service/scripts/verify-staged-change-manifest.mjs --slice 8B`.

Expected: inside-root local tools pass; path escapes, direct fs imports, redirect-to-private, DNS change, MIME mismatch, chunked oversize, and unapproved fetch fail.

- [ ] **Step 9: Request independent spec review**

Reviewer confirms workspaceId-null Figma data import is allowed only through network approval/state audit and all project/export paths require a workspace.

- [ ] **Step 10: Request independent quality review**

Reviewer checks redirect cleanup, DNS/IP classification, aborts, stream disposal, temp cleanup, Windows reparse handling, and TOCTOU assumptions.

- [ ] **Step 11: Commit the two reviewed trees**

For 8A, use only `task-8a.json` union and commit `feat(io): sandbox workspace files`. Then implement 8B, use only `task-8b.json` union and commit `feat(io): pin approved remote image domains`. Each tree independently runs section6.2 and no aggregate third commit exists.

### Task 9 — Pair the Desktop plugin, expose approvals, remove URL fetch, and set undo boundaries

**Files**

- Modify: `service/packages/plugin/manifest.json`, `protocol/bridge.ts`, `src/code.ts`, `src/dispatcher.ts`, `src/idempotency.ts`, `src/panel.ts`.
- Create: `service/packages/plugin/src/file-identity.ts`.
- Create 9B internal `service/packages/plugin/src/handlers/identity-bootstrap.ts`; it is dispatcher-only and absent from canonical handler registry/counts.
- Create 9B exact `service/scripts/generate-task9b-handler-ledger.mjs`.
- Modify the generated exact handler set for 78 non-batch `WRITE_TOOL_NAMES` rows across exactly 77 unique production modules, plus `batch.ts`, `import-image.ts`, and `registry.ts`; only `lock_nodes` and `unlock_nodes` share `service/packages/plugin/src/handlers/lock-nodes.ts`. The exact tool/path mapping is stored in the Task9B ledger and the contracts still cover all 79 baseline write-kind names including batch.
- Modify: `service/packages/plugin/ui/relay/client.ts`, `ui/App.vue`, `ui/main.ts`, `ui/style.css`.
- Modify for 9A integration: `ui/composables/useRelaySession.ts`, `ui/components/PanelTabs.vue`, `ui/lib/tabs.ts`; create `TabPairing.vue`, `usePairing.ts`. Create 9C `TabApproval.vue`, `useApprovalQueue.ts`.
- Create/modify exact 9A tests `components/pairing-flow.test.ts`, `composables/use-relay-session.test.ts`, `relay/client.test.ts`, auth/protocol/progress-cancel/file-identity; add 9B `idempotency-concurrency.test.ts`; add 9C `approval/approval-control.test.ts`, `approval-reconnect.test.ts`, `approval-ui.test.ts`; plus mutation fixture ledger named below.
- 9C modifies exact daemon integration `service/packages/mcp/src/policy/approval-broker.ts`, `service/packages/mcp/src/relay/relay.ts`, `service/packages/mcp/src/index.ts`; creates `service/packages/mcp/test/e2e/built-plugin-approval-roundtrip.test.ts`.
- 9C creates exact coordinator `service/packages/mcp/src/execution/identity-bootstrap.ts` plus `service/packages/mcp/test/e2e/identity-bootstrap.test.ts` and `internal-system-principal.test.ts`; 9A/9B add hello/dispatcher tests.

**Interfaces**

- Consumes: Task6.1 pairing/resume outer wire; Task7 shared `$progress`/`$cancel`, strict `ApprovalPromptV1`/`ApprovalDecisionV1`, accepted/terminal envelopes, operation IDs, 67,108,864-byte frame cap, and immutable resolved target; Task8 byte-only image dispatch. Task9A is the first real progress/cancel consumer; Task9C is the first real approval-control consumer. Neither redefines daemon semantics or receives a control token.
- Produces paired hello/approval and internal identity.bootstrap across slices; canonical handlers remain105 and service0 until Task11. Mutation/undo79 and dispatcher-only commit remain; internal bootstrap handler/count is separate.

**Commit protocol:** Section 6.2 applies independently to 9A, 9B, and 9C; each exact staged tree includes the authority trio and gets its own two reviews.

9B ledger remains78/77. All77 paths and exact `service/packages/plugin/src/handlers/registry.ts` use `ServiceForkLineageV1 transition:'edit'` when upstream-managed; task-9b stages their exact `stagedSha256` lineage, generator skips, and verifier proves no overwrite.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 9A | pairing/resume/progress; initial hello reads shared UUID or reports unstable, never mutates; bootstrap/rehello schemas/tests | unpaired→hello, no-fileKey read-only, no mutation | `feat(plugin): pair sessions and persist stable file identity` |
| 9B | 78/77 ledger+registry, dispatcher/idempotency, internal identity-bootstrap handler | shared-plugin-data mutation, one undo, internal count excluded | `refactor(plugin): report mutation outcomes and centralize undo` |
| 9C | real broker/Relay/index/built plugin plus identity coordinator | approval matrix; bootstrap approve/reject/crash/reconnect/rehello/read-only; counts unchanged | `feat(plugin): approve capability-gated byte-only operations` |

9B’s generated handler-name set and fixture ledger are reviewed independently from UI work. Task 10 starts only after all three subtask commits pass baseline parity.

**Binding subtask execution**

- [ ] **9A RED:** `pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/protocol packages/plugin/test/file-identity.test.ts packages/plugin/test/file-identity-bootstrap-hello.test.ts packages/plugin/test/components/pairing-flow.test.ts packages/plugin/test/composables/use-relay-session.test.ts packages/plugin/test/relay/client.test.ts`. **GREEN:** `pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/protocol packages/plugin/test/file-identity.test.ts packages/plugin/test/file-identity-bootstrap-hello.test.ts packages/plugin/test/components/pairing-flow.test.ts packages/plugin/test/composables/use-relay-session.test.ts packages/plugin/test/relay/client.test.ts`; `pnpm -C service --filter @sfp/plugin typecheck`; `pnpm -C service --filter @sfp/plugin build`; `node service/scripts/update-service-forks.mjs --slice 9A --index service/capabilities/change-manifests/task-9a.json`; `AUTHORITY_GREEN`; `node service/scripts/verify-staged-change-manifest.mjs --slice 9A`. Bootstrap assertions exact.
- [ ] **9A review and commit:** task-9a exact rows add bootstrap-hello test and file-identity/bridge schema bytes; no daemon coordinator or mutation handler yet; commit exact subject.
- [ ] **9B RED:** run `pnpm -C service exec vitest run packages/plugin/test/mutation-handler-contract.test.ts packages/plugin/test/idempotency-concurrency.test.ts packages/plugin/test/identity-bootstrap-dispatch.test.ts packages/plugin/test/wire-result.test.ts packages/plugin/test/undo-boundary.test.ts packages/plugin/test/dispatcher.test.ts test/tool-registry.test.ts`. Expected behavioral failures: handlers do not return exact `{value,mutated}`; concurrent same-ID dispatch can execute twice; internal bootstrap dispatch/metadata stripping is absent; handler-level/no-op/failure undo counts violate the sole dispatcher boundary; 78/77 ledger+registry coverage fails. Every test exists and runs legacy behavior; missing suites are not acceptable RED.
- [ ] **9B GREEN:** `pnpm -C service exec vitest run packages/plugin/test/mutation-handler-contract.test.ts packages/plugin/test/idempotency-concurrency.test.ts packages/plugin/test/identity-bootstrap-dispatch.test.ts packages/plugin/test/wire-result.test.ts packages/plugin/test/undo-boundary.test.ts packages/plugin/test/dispatcher.test.ts test/tool-registry.test.ts`; `pnpm -C service --filter @sfp/plugin typecheck`; `pnpm -C service --filter @sfp/plugin build`; `node service/scripts/generate-task9b-handler-ledger.mjs --base HEAD --index --output service/capabilities/task-9b-mutation-handlers.json`; `node service/scripts/update-service-forks.mjs --slice 9B --index service/capabilities/change-manifests/task-9b.json`; `AUTHORITY_GREEN`; `node service/scripts/verify-staged-change-manifest.mjs --slice 9B`. Assert lineage.
- [ ] **9B review and commit:** Stage 77 handler paths, batch, plugin handler registry, dispatcher/idempotency/contracts/internal bootstrap handler, exact ledger generator+ledger, fixtures/tests, task-9b manifest and authority. Byte-verify mapping/counts before exact commit.
- [ ] **9C RED:** run `pnpm -C service exec vitest run packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/e2e/internal-system-principal.test.ts packages/mcp/test/e2e/identity-bootstrap.test.ts packages/mcp/test/e2e/built-plugin-approval-roundtrip.test.ts packages/plugin/test/approval packages/plugin/test/identity-bootstrap-dispatch.test.ts`. Expected behavioral failures: legacy origin accepts top-level/auth mismatch; paired/target-session/file-key/target-binding domain vectors do not exist; append accepts current-generation mismatch while restart wrongly compares stored generations to the new current generation; system kind/name iff is unenforced; dispatched/settled bootstrap replays; tombstone/resolution loses origin; packed reject/approve/rehello/crash/no-control-token assertions fail. The test files and legacy bootstrap harness must execute—an absent test file is not acceptable RED.
- [ ] **9C GREEN:** run this complete copy/paste block against the staged `task-9c.json` tree:

~~~powershell
pnpm -C service install --lockfile-only
pnpm -C service install --frozen-lockfile
pnpm -C service --filter @sfp/plugin typecheck
pnpm -C service --filter @sfp/plugin build
pnpm -C service --filter @sfp/mcp typecheck
pnpm -C service --filter @sfp/mcp build
pnpm -C service typecheck
pnpm -C service exec vitest run packages/plugin/test/approval packages/plugin/test/protocol packages/plugin/test/handlers/import-image-policy.test.ts packages/mcp/test/e2e/built-plugin-approval-roundtrip.test.ts packages/mcp/test/e2e/identity-bootstrap.test.ts packages/mcp/test/e2e/internal-system-principal.test.ts packages/mcp/test/execution/operation-journal.test.ts test/tool-registry.test.ts
node service/scripts/update-service-forks.mjs --slice 9C --index service/capabilities/change-manifests/task-9c.json
node service/scripts/vendor-upstreams.mjs --copy-only
pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/dispatch.test.ts packages/mcp/test/e2e
pnpm -C service typecheck
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts
pnpm -C service exec vitest run test/authority-class-transition.test.ts test/service-fork-lineage.test.ts
node service/scripts/verify-staged-change-manifest.mjs --slice 9C
~~~
- [ ] **9C review and commit:** task-9c exact union adds `service/packages/shared/src/operations.ts`, `service/packages/mcp/src/execution/operation-journal.ts`, `service/packages/mcp/src/execution/operation-resolution-intent.ts`, `service/packages/mcp/src/execution/identity-bootstrap.ts`, `service/packages/mcp/test/execution/operation-journal.test.ts`, `service/packages/mcp/test/e2e/identity-bootstrap.test.ts`, `service/packages/mcp/test/e2e/internal-system-principal.test.ts`, daemon/plugin paths and authority. Counts unchanged; exact subject.

- [ ] **Step 1: Write plugin auth, URL, and undo RED**

~~~ts
it('never calls createImageAsync for a relay request', async () => {
  const figma = fakeFigma({ createImageAsync: vi.fn() });
  await expect(createImportImageHandler(figma)({ url: 'https://assets.example.com/a.png' }))
    .rejects.toMatchObject({ message: expect.stringContaining('validated data') });
  expect(figma.createImageAsync).not.toHaveBeenCalled();
});

it('commits one undo boundary for one successful top-level write', async () => {
  await dispatcher.run('create_text', args);
  expect(figma.commitUndo).toHaveBeenCalledTimes(1);
});

it.each([
  ['navigate_to_page', { pageId: 'p2' }],
  ['get_selection', {}],
  ['rename_node', { nodeId: '1:2', name: 'unchanged' }],
])('%s commits zero boundaries for UI/read/no-op', async (tool, args) => {
  await dispatcher.run(tool, args);
  expect(figma.commitUndo).not.toHaveBeenCalled();
});

it('reads pair ticket and typed error bodies through the real UI fetch adapter', async () => {
  pairServer.enqueue(allowedCorsResponse(401, { code: 'PAIR_CODE_EXPIRED' }));
  await expect(pairing.exchange(pairId, code)).rejects.toMatchObject({ code: 'PAIR_CODE_EXPIRED' });
  pairServer.enqueue(allowedCorsResponse(200, { wsTicket, expiresAt }));
  await expect(pairing.exchange(pairId, freshCode)).resolves.toMatchObject({ wsTicket });
});

it.each(MUTATION_FIXTURES)('$tool reports a changed outcome explicitly', async fixture => {
  expect(await fixture.handler(fixture.changedArgs)).toMatchObject({ mutated: true, value: fixture.changedResult });
  if (fixture.contract.noOpSemantics === 'supported') {
    expect(await fixture.handler(fixture.noOpArgs)).toMatchObject({ mutated: false, value: fixture.noOpResult });
  } else {
    expect(fixture.contract.noOpFixtureId).toBeNull();
  }
});

it('sends only handler outcome.value on the plugin wire', async () => {
  const wire = await dispatchToWire('rename_node', renameChangedArgs);
  expect(wire.result).toEqual(renameChangedResult);
  expect(JSON.stringify(wire)).not.toContain('mutated');
});

it('shares one in-flight Promise for concurrent identical operation ID', async () => {
  const [left, right] = await Promise.all([
    dispatcher.run('create_text', args, { operationId }),
    dispatcher.run('create_text', args, { operationId }),
  ]);
  expect(left).toEqual(right);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(figma.commitUndo).toHaveBeenCalledTimes(1);
  await expect(dispatcher.run('create_text', { ...args, text: 'different' }, { operationId }))
    .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
});
~~~

- [ ] **Step 2: Run plugin RED**

Run: `pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/approval packages/plugin/test/protocol packages/plugin/test/handlers/import-image-policy.test.ts packages/plugin/test/undo-boundary.test.ts`.

Expected: plugin connects without credential, has no pairing/approval UI, URL branch calls `createImageAsync`, and commitUndo is never called.

- [ ] **Step 3: Implement paired hello and rotating resume UI**

Render unpaired/pairing/wrong/expired/connected/reconnecting states. Exchange the eight-digit code, hold ticket/resume only in redacted state, send first-message credentials, rotate resume on every successful reconnect, and remove all secrets from diagnostics. Once paired, `protocol/bridge.ts` and the real code/panel/UI relay install exactly one Task7-schema `$progress`/`$cancel` listener per session, route by requestId+operationId, reject oversize before decode, remove listeners on terminal/reconnect/unmount, and prevent late progress after terminal. No plugin/UI field can supply daemon identity/context.

- [ ] **Step 4: Implement strict paired approval-control UI and exactly-once settlement**

`protocol/bridge.ts`, `src/code.ts`, `src/panel.ts`, `ui/composables/useApprovalQueue.ts`, and `ui/components/TabApproval.vue` parse only shared `ApprovalPromptV1Schema`/`ApprovalDecisionV1Schema`. Show operation name, dynamic effect summary, stable file label/hash, target count, overwrite/destructive/network flags; never render/store design text, bytes/base64, absolute path, URL query, actor credentials, or control token. Decision sends only version/type/approvalId/operationId/promptHash/decision over the authenticated paired WS. Reconnect may re-render the same unexpired prompt without extending TTL; terminal/unmount/generation change cleans listeners. Approve/reject exact binding once; duplicate, conflicting, wrong prompt hash, wrong generation/target, and late events show typed degraded state and are audited. The plugin never calls `/control` directly and never receives its credential.

- [ ] **Step 5: Implement no-fileKey identity bootstrap**

9A hello only reads fileKey/shared UUID and otherwise authenticates unstable-readonly. 9B internal handler writes shared namespace/key only after signed system envelope and dispatcher commits once. 9C daemon coordinator creates journaled identity.bootstrap only for paired unstable Design session, uses plugin approval branch, dispatches after fsynced state, returns requiresRehello, and never edits Relay mapping. New hello alone installs stable UUID mapping. Crash after dispatch→unknown/no retry; reconnect observes UUID. Dev/read-only rejects. System operation stays outside tool/service registries/counts.

- [ ] **Step 6: Remove direct URL/wildcard and add undo policy**

Plugin import handler accepts validated data bytes only. Manifest allows only loopback relay and adds no external wildcard. Migrate all 78 non-batch baseline write modules and batch to `SandboxMutationHandler`; each returns `{value,mutated}` and has one `MutationHandlerContract` row. Setters/rename/bind operations with a successful unchanged state use `noOpSemantics:'supported'` and a no-op fixture; creates/deletes or operations that necessarily mutate on every success use `never-on-success` and null no-op fixture. Read handlers remain `SandboxReadHandler`; the dispatcher treats them as `mutated:false` internally. `navigate_to_page` is in the write-name contract for compatibility but always returns `mutated:false` because it changes UI state only. No file under `packages/plugin/src/handlers/**` or `file-identity.ts` may call `commitUndo`. The top-level dispatcher consults exact `UNDO_BOUNDARY_POLICIES`: 79 baseline rows exist, `navigate_to_page` is false/`figma-ui`, and each document-write row commits only when `mutated:true`. Batch commits once after apply/compensation; read/navigation/no-op/failure commits zero; nested batch operations do not double commit. It strips mutation metadata and sends only `value` on the bridge. Structural tests require exactly one production `commitUndo` call site in the top-level dispatcher module.

- [ ] **Step 7: Preserve baseline and experimental handlers**

Keep handler registry exactly 105 and server-only exceptions 7. Motion 7 and video handler stay registered with typed Design-only/experimental capability behavior. Do not add `import_library_variable` yet.

- [ ] **Step 8: Run plugin GREEN**

Run: `pnpm -C service exec vitest run packages/plugin/test test/tool-registry.test.ts`, then `pnpm -C service build`.

Expected: pairing/approval/identity/URL tests pass; mutation contract and fixtures cover all 79 baseline write names, wire output never leaks `mutated`, undo policy covers all 79, navigate/read/no-op/failure commit zero, changed write/batch/system UUID commit once, handler call-site scan is zero; Vite builds pass and registry remains 112/105/7.

- [ ] **Step 9: Request independent spec review**

Reviewer validates the complete pair/reconnect/approval/file-identity/undo flow and confirms the safe-union handler has not appeared early.

- [ ] **Step 10: Request independent quality review**

Reviewer checks Vue state cleanup, secret lifetime, duplicate approval races, bridge schemas, commitUndo placement, manifest domains, and handler parity.

- [ ] **Step 11: Verify the three-commit plugin handoff**

Run: `git diff --check`, `git log -3 --format="%H %s"`, full Task 9 GREEN, then `git diff --exit-code`. Expected: the three recorded 9A/9B/9C subjects exist in order and the worktree is clean. Do not squash or create a fourth aggregate Task 9 commit.

### Task 10 — Fix grounding routing, reconnect outcome, and stable design baselines

**Files**

- Create: `service/packages/mcp/src/execution/grounding-router.ts`; do not modify final Task6.1 index/dispatch/relay producers.
- Modify: `service/packages/mcp/src/tools/token-map.ts`, `component-map.ts`, `icon-map.ts`, `design-diff.ts`, `get-local-components.ts`.
- Modify exact result authority: `service/packages/shared/src/components.ts`, `service/packages/shared/src/result-schemas.ts`, `service/packages/plugin/src/handlers/get-local-components.ts`, `service/packages/plugin/test/handlers/get-local-components.test.ts`, `service/capabilities/union-manifest.json`, `service/test/tool-contract.test.ts`, `service/packages/mcp/test/tools/result-validation.test.ts`.
- Create: `service/packages/mcp/test/tools/grounding-session.test.ts`, `design-diff-file-identity.test.ts`, `component-discovery-capability.test.ts`.
- Create: `service/packages/mcp/test/relay/write-flap-outcome.test.ts`.
- Modify exact `service/packages/mcp/test/e2e/read-tools.test.ts` expected `get_local_components` result to require `scope:'selection-or-subtree'` and `remoteLibraryDiscovery:false`.

**Interfaces**

- Consumes: Task 7 immutable `RuntimeExecutionScope`, operation outcome API, server-resolved target/per-file key, and no-session-oracle `/ping`; Task 9 authenticated Relay session/FileIdentity.
- Produces: plane-consumer grounding router, stable digest-only diff namespace, honest discovery scope, and updated shared/plugin/MCP result contracts with refreshed union schema hashes; tool/handler/execution/service counts remain exactly 112/105/7, 98/14, service0. Task7 already owns flap→unknown. No Task6.1 producer edit.

**Commit protocol:** Section 6.2 applies; stage Task 10 semantic files plus the authority trio and review the same tree.

`task-10.json` exact union additionally includes `service/packages/mcp/test/e2e/read-tools.test.ts`; its real wire fixture must match changed strict result schema. Other exact paths/count invariants remain.

- [ ] **Step 1: Write genuine cross-session/collision/flap RED**

~~~ts
it('pins token variables and styles to one resolved session', async () => {
  const result = await runTokenMapWithActivityFlip(SESSION_ID_A, SESSION_ID_WITH_UNDERSCORE);
  expect(result.provenance.sessionId).toBe(SESSION_ID_A);
  expect(result.variablesFile).toBe(result.stylesFile);
});

it('namespaces the same node ID by stable file identity', async () => {
  expect(pathFor(fileUuidA, '1:2')).not.toBe(pathFor(fileUuidB, '1:2'));
});

it('accepts valid wire file hash but joins only file/node digests', async () => {
  const wireHash = `sha256:${'a'.repeat(64)}` as const;
  const ref = await baselineStore.save({ fileIdentityHash: wireHash, rawNodeId: '../1:2\\ads' }, baseline);
  expect(ref.relativePath).toMatch(/^\.sfp\/design-diff-baselines\/v1\/[0-9a-f]{64}\/[0-9a-f]{64}\.json$/);
  expect(ref.relativePath).not.toMatch(/sha256:|\.\.|1:2|\\/);
  await expect(baselineStore.load({ ...ref, rawNodeId: 'different' })).rejects.toMatchObject({ code: 'DESIGN_DIFF_NODE_ID_MISMATCH' });
});
~~~

- [ ] **Step 2: Run grounding RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/tools/grounding-session.test.ts packages/mcp/test/tools/design-diff-file-identity.test.ts packages/mcp/test/tools/component-discovery-capability.test.ts packages/mcp/test/relay/write-flap-outcome.test.ts packages/mcp/test/e2e/read-tools.test.ts packages/mcp/test/tools/result-validation.test.ts packages/plugin/test/handlers/get-local-components.test.ts test/tool-contract.test.ts`.

Expected behavioral RED: token reads may mix, same node IDs collide, dispatched flap waits for timeout, component scope/remote-library fields are absent or permissive, strict result-schema validation and real read-tools wire fixture reject the legacy result. Every named test exists and executes legacy behavior.

- [ ] **Step 3: Pin all multi-call grounding**

Consume the Task 7 immutable target/session/file identity once; pass the same routed dispatcher to component/token/icon subcalls. Do not call `/ping` or resolve `active` again. If it disappears, fail `PINNED_SESSION_LOST`; never switch files. Include session/file provenance in results.

- [ ] **Step 4: Namespace and migrate design baselines**

Strict-verify wire file hash, extract digest, and domain-hash exact raw nodeId as section3.7 nodeIdDigest; store only the two64hex segments. Baseline embeds raw ID+digest and load recomputes; malformed hash, raw traversal/colon/backslash, forged pair, and synthetic collision fail, while valid `sha256:` succeeds. Legacy node-only baselines remain unsupported with recapture guidance; no migration command.

- [ ] **Step 5: Connect relay flap to OperationExecutor**

Consume Task7's existing flap/outcome port; Task10 adds no Relay hook. Tests prove queued/dispatched/old-reply semantics through the public plane consumer and no fallback target.

- [ ] **Step 6: Make component discovery scope explicit**

Return `scope:'selection-or-subtree'` and `remoteLibraryDiscovery:false` from the shared `GetLocalComponentsResultSchema`, plugin handler, MCP wrapper, component/map results, and union-manifest schema hash. Prompts later use page traversal or known component keys instead of claiming team-library search. Contract tests require the same strict result schema on every layer and prove registry/counts unchanged.

- [ ] **Step 7: Run grounding GREEN**

Run `pnpm -C service exec vitest run packages/mcp/test/tools/grounding-session.test.ts packages/mcp/test/tools/design-diff-file-identity.test.ts packages/mcp/test/tools/component-discovery-capability.test.ts packages/mcp/test/relay/write-flap-outcome.test.ts packages/mcp/test/e2e/read-tools.test.ts packages/mcp/test/tools/result-validation.test.ts packages/plugin/test/handlers/get-local-components.test.ts test/tool-contract.test.ts test/tool-registry.test.ts`; `pnpm -C service typecheck`; `node service/scripts/update-service-forks.mjs --slice 10 --index service/capabilities/change-manifests/task-10.json`; `AUTHORITY_GREEN`; `node service/scripts/verify-staged-change-manifest.mjs --slice 10`.

Expected: no cross-file mix/collision/reroute, Windows-safe digest paths, flap unknown immediate, component discovery honest across shared/plugin/MCP, union hashes refreshed, and all counts unchanged.

- [ ] **Step 8: Request independent spec review**

Reviewer checks stable identity continuity across plugin/daemon restart and confirms read-only unstable sessions cannot persist baselines.

- [ ] **Step 9: Request independent quality review**

Reviewer checks routing races, typed legacy rejection/no migration surface, atomic store, stale reply and provenance.

- [ ] **Step 10: Commit grounding correctness**

Stage only `task-10.json` union, byte-verify, review/rerun exact GREEN, then commit `fix(grounding): pin files and namespace durable design state`.

### Task 11 — Assemble sectioned snapshots and grounding graphs

**Files**

- Modify: `service/packages/ir/package.json` with exact runtime dependencies `@sfp/shared:"workspace:*"` and `zod:"4.4.3"`; modify `service/packages/mcp/package.json` to consume `@sfp/ir:"workspace:*"`; modify `service/pnpm-lock.yaml`.
- Create exact IR sources `service/packages/ir/src/canonical-json.ts`, `fidelity.ts`, `snapshot-v1.ts`, `snapshot-storage.ts`, `grounding-graph-v1.ts`, `store.ts`, and `index.ts`; create exact pure tests `service/packages/ir/test/canonical-json.test.ts`, `fidelity.test.ts`, `snapshot-v1.test.ts`, `snapshot-storage.test.ts`, `grounding-graph-v1.test.ts`, and `store.test.ts`. IR owns `SnapshotV1` and `SnapshotStoragePort` together and imports no filesystem module.
- Create exact MCP snapshot sources `service/packages/mcp/src/snapshot/workspace-snapshot-storage.ts`, `workspace-graph-storage.ts`, `capture-snapshot.ts`, `build-grounding-graph.ts`, and `refresh-grounding-graph.ts`; create exact control sources `service/packages/mcp/src/control/snapshot-endpoints.ts` and `grounding-endpoints.ts`.
- Modify service-operation registry/shared schemas/control route-registry for two reachable routes; the Task7 consumer adapter installs them through Task6.1 facade, with no producer edit.
- Create exact MCP tests `service/packages/mcp/test/snapshot/snapshot-schema.test.ts`, `snapshot-capture.test.ts`, `snapshot-locator.test.ts`, `snapshot-storage.test.ts`, `grounding-graph.test.ts`, `grounding-refresh.test.ts`, `grounding-storage.test.ts`, `snapshot-progress.test.ts`, and `service-operation-routing.test.ts`.
- Create exact memory test/harness `service/packages/ir/test/grounding-graph-memory.test.ts` and `service/packages/ir/test/fixtures/grounding-graph-memory.mjs`.

**Interfaces**

- Consumes: Task 7 empty service-operation seam, immutable policy/path/target-resolved scope, one executor and shared progress/cancel/terminal transport; Task 8 workspace store; Task 10 stable pin. No snapshot type lives in shared.
- Produces: strict snapshot/graph schemas and storage ports, service2, reachable authenticated routes, kind/name journal, and exact refs/results consumed by Task13; MCP remains112.

**Commit protocol:** `task-11.json` enumerates every repo-relative path named in this Task: both package manifests and pnpm lock; all seven IR sources; all six ordinary IR tests plus memory test+fixture; five MCP snapshot sources; two control endpoint sources; all nine MCP snapshot tests; exact shared service-operation schema, MCP service registry, control route-registry/index modifications; package authority, change manifest, and authority trio. No directory/glob row is legal, and the staged-name byte comparison rejects an unlisted IR/snapshot file. Both package manifests and the lock are mandatory staged rows.

- [ ] **Step 1: Write canonical hash and section assembly RED**

~~~ts
it('assembles planned sections in plan order without changing content hash for key order', async () => {
  const first = await reader.captureFull(ctx, ['root'], signal);
  const second = reorderObjectKeys(first);
  expect(hashSnapshot(first)).toBe(hashSnapshot(second));
  expect(first.fidelity.completeLeafSections.map(x => x.nodeId)).toEqual(['section-a', 'section-b']);
});

it('records a failed section instead of claiming complete fidelity', async () => {
  fakeDispatch.fail('section-b', 'PINNED_SESSION_LOST');
  const snapshot = await reader.captureFull(ctx, ['root'], signal);
  expect(snapshot.fidelity.truncated).toBe(true);
  expect(snapshot.fidelity.issues[0]).toMatchObject({
    nodeId: 'section-b', planPath: ['root', 'section-b'], status: 'failed', code: 'PINNED_SESSION_LOST',
  });
});

it('expands nested section plans in bounded stable pre-order', async () => {
  fakeDispatch.plan('root', ['a', 'b']);
  fakeDispatch.plan('a', ['a1', 'a2']);
  fakeDispatch.plan('a2', ['root']);
  const snapshot = await reader.captureFull(ctx, ['root'], signal);
  expect(snapshot.fidelity.expandedSections.map(x => x.nodeId)).toEqual(['root', 'a', 'a2']);
  expect(snapshot.fidelity.completeLeafSections.map(x => x.nodeId)).toEqual(['a1', 'b']);
  expect(snapshot.fidelity.issues).toContainEqual(expect.objectContaining({
    nodeId: 'root', planPath: ['root', 'a', 'a2', 'root'], status: 'omitted-cycle',
  }));
  expect(fakeDispatch.maxConcurrent).toBeLessThanOrEqual(2);
});

it('records depth and total-section caps with exact plan paths', async () => {
  const snapshot = await reader.captureFull(ctx, buildNestedFixture({ depth: 9, sections: 257 }), signal);
  expect(snapshot.fidelity.visitedCount).toBeLessThanOrEqual(256);
  expect(snapshot.fidelity.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: 'omitted-depth', depth: 9 }),
    expect.objectContaining({ status: 'omitted-section-cap', order: 256 }),
  ]));
});

it('returns the SnapshotV1 namespace and checksum from the injected storage port', async () => {
  const result = await captureEndpoint({ workspaceId, nodeIds: ['root'] });
  const fileIdentityDigest = fileIdentityHash.slice('sha256:'.length);
  expect(result.snapshot.snapshotId).toMatch(/^sfp_snap1_[A-Za-z0-9_-]{22}$/);
  expect(result.snapshot.relativePath).toBe(`.sfp/snapshots/v1/${fileIdentityDigest}/${result.snapshot.snapshotId}.json`);
  expect(result.snapshot.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(result.graph?.relativePath).toBe(`.sfp/grounding-graphs/v1/${fileIdentityDigest}/${result.snapshot.snapshotId}.json`);
  expect(result.graphIssue).toBeNull();
  expect(storage.save).toHaveBeenCalledTimes(1);
});

it('strictly rejects extras and CAS-refreshes one graph ref', async () => {
  expect(SnapshotCaptureArgsSchema.safeParse({ nodeIds: ['root'], extra: true }).success).toBe(false);
  const result = await invokeService('grounding.refresh', {
    locator: { workspaceId, snapshotId, fileIdentityHash }, expectedGraphChecksum,
  }, { workspaceId, targetSelector: { kind: 'none' } });
  expect(result.graph).toMatchObject({ graphId: `grounding:${snapshotId}`, relativePath: graphPath });
  expect(result.staleEdges).toBe(1);
  expect(graphStore.replaceByLocator).toHaveBeenCalledWith(
    { workspaceId, snapshotId, fileIdentityHash }, expect.anything(), expectedGraphChecksum,
    expect.anything(), expect.anything(),
  );
});

it.each(['wrong-workspace', 'wrong-hash', 'wrong-snapshot-id', 'embedded-identity-mismatch', 'stale-cas'])
('fails closed on locator/storage mismatch %s', async fault => {
  await seedLocatorFault(fault);
  await expect(graphStore.loadByLocator(locatorFor(fault))).rejects.toMatchObject({ code: expect.stringMatching(/LOCATOR|CHECKSUM/) });
  expect(atomicReplace).not.toHaveBeenCalled();
});

it.runIf(process.platform === 'win32')('accepts valid wire hash and joins only extracted digest', async () => {
  await expect(snapshotStore.loadByLocator({ workspaceId, snapshotId, fileIdentityHash })).resolves.toBeDefined();
  expect(relativePathsOpened.at(-1)).toContain(fileIdentityHash.slice(7));
  expect(relativePathsOpened.at(-1)).not.toMatch(/sha256:|\.\.|\\|:/);
  for (const rawHash of ['a'.repeat(64), 'sha256:C:evil', 'sha256:..', 'sha256:..\\evil', 'sha256:name:stream']) {
    await expect(snapshotStore.loadByLocator({ workspaceId, snapshotId, fileIdentityHash: rawHash }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_LOCATOR_INVALID' });
  }
});

it('preserves human evidence byte-for-byte while refreshing automatic evidence', async () => {
  const before = GroundingGraphV1Schema.parse(graphWithHumanAndAutomaticEvidence());
  const after = await refreshGraph(before, repoChanges);
  expect(canonicalHumanEvidence(after)).toEqual(canonicalHumanEvidence(before));
  expect(after.edges).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'stale' })]));
  expect(after.graphVersion).toBe(before.graphVersion + 1);
  expect(() => GroundingGraphV1Schema.parse(graphAboveDeclaredBoundaries())).toThrow();
});

it('keeps the storage dependency direction IR -> shared and MCP adapter -> IR', async () => {
  expect(await packageImports('@sfp/shared')).not.toContain('@sfp/ir');
  expect(await packageImports('@sfp/ir')).toContain('@sfp/shared');
  expect(await sourceImports('packages/mcp/src/snapshot/workspace-snapshot-storage.ts')).toContain('@sfp/ir');
});
~~~

- [ ] **Step 2: Run snapshot RED**

Run: `pnpm -C service exec vitest run packages/ir/test/canonical-json.test.ts packages/ir/test/fidelity.test.ts packages/ir/test/snapshot-v1.test.ts packages/ir/test/snapshot-storage.test.ts packages/ir/test/grounding-graph-v1.test.ts packages/ir/test/store.test.ts packages/ir/test/grounding-graph-memory.test.ts packages/mcp/test/snapshot/snapshot-schema.test.ts packages/mcp/test/snapshot/snapshot-capture.test.ts packages/mcp/test/snapshot/snapshot-locator.test.ts packages/mcp/test/snapshot/snapshot-storage.test.ts packages/mcp/test/snapshot/grounding-graph.test.ts packages/mcp/test/snapshot/grounding-refresh.test.ts packages/mcp/test/snapshot/grounding-storage.test.ts packages/mcp/test/snapshot/snapshot-progress.test.ts packages/mcp/test/snapshot/service-operation-routing.test.ts`.

Expected: IR modules and section reader are absent.

- [ ] **Step 3: Implement canonical schemas/store**

Implement every strict section3.7 schema/type, SnapshotId/Locator, canonical hashes, SnapshotStoragePort and GraphStoragePort in IR with no fs. MCP adapters use only Task8 WorkspacePolicy/AtomicFileStore/RepoReader, verified digest-only namespaces, embedded identity/workspace/hash/id checks, checksum/CAS atomic create/replace and import-direction gates.

- [ ] **Step 4: Implement bounded section capture**

Capture bounds unchanged. Memory gate spawns isolated `node --expose-gc packages/ir/test/fixtures/grounding-graph-memory.mjs` three times; each builds/canonicalizes strict10,000-node/20,000-edge graph, calls gc before/after, prints JSON heapDelta/serializedBytes, exits0. Wrapper requires max heap delta<=134,217,728 and serialized bytes<=33,554,432 on all3, no averaging/retry.

- [ ] **Step 5: Implement grounding graph and stale checks**

Create/persist strict component/token/icon/design/code nodes and exact edge/evidence/ref contracts. Initial capture create-writes snapshot+graph. Refresh with selector none loads by locator, verifies snapshot/current graph, checks code refs through RepoReader, preserves human evidence byte-for-byte, changes only automatic evidence/state, increments version, CAS-replaces and returns checked/verified/stale counts without Figma.

- [ ] **Step 6: Expose control-only capture**

Register service0→2 with `snapshot.capture` required-target and `grounding.refresh` forbidden-target/locator-only policies. Register both routes through Task7 route-registry and final facade install hook; no index/private producer edit or standalone mount. Test both strict dotted names, schemas/reachability/kind-name/no collision/counts; MCP remains112.

- [ ] **Step 7: Run snapshot GREEN**

Run this complete copy/paste block against the staged `task-11.json` tree:

~~~powershell
pnpm -C service install --lockfile-only
pnpm -C service install --frozen-lockfile
pnpm -C service exec vitest run packages/ir/test/canonical-json.test.ts packages/ir/test/fidelity.test.ts packages/ir/test/snapshot-v1.test.ts packages/ir/test/snapshot-storage.test.ts packages/ir/test/grounding-graph-v1.test.ts packages/ir/test/store.test.ts packages/ir/test/grounding-graph-memory.test.ts packages/mcp/test/snapshot/snapshot-schema.test.ts packages/mcp/test/snapshot/snapshot-capture.test.ts packages/mcp/test/snapshot/snapshot-locator.test.ts packages/mcp/test/snapshot/snapshot-storage.test.ts packages/mcp/test/snapshot/grounding-graph.test.ts packages/mcp/test/snapshot/grounding-refresh.test.ts packages/mcp/test/snapshot/grounding-storage.test.ts packages/mcp/test/snapshot/snapshot-progress.test.ts packages/mcp/test/snapshot/service-operation-routing.test.ts packages/mcp/test/execution/service-operation-name.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/control/control-router.test.ts test/tool-contract.test.ts
pnpm -C service typecheck
pnpm -C service build
node service/scripts/update-service-forks.mjs --slice 11 --index service/capabilities/change-manifests/task-11.json
node service/scripts/vendor-upstreams.mjs --copy-only
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts test/authority-class-transition.test.ts test/service-fork-lineage.test.ts
node service/scripts/verify-staged-change-manifest.mjs --slice 11
~~~

The isolated three-run numeric memory gate is part of that literal Vitest invocation.

Expected: exact package+lock closure, locator/digest/Windows safety, embedded identity verification, full graph/evidence boundaries, human immutability, CAS/corruption/staleness, progress/cancel, router reachability, service registry exact2 kind/name journal/direct-bypass pass; MCP remains112.

- [ ] **Step 8: Request independent spec review**

Reviewer verifies the observed/inferred boundary, shared dependency direction, section fidelity semantics, and canonical registry remains unchanged.

- [ ] **Step 9: Request independent quality review**

Reviewer checks recursive work-queue bounds/order/cycles, deterministic merge/hash, memory bounds, duplicate IDs, cancellation cleanup, injected workspace storage only, and Zod migration hooks.

- [ ] **Step 10: Commit snapshots**

Stage only `task-11.json` union including IR+MCP package manifests, pnpm lock, IR source/tests, shared service-name schema only if its hash changes, snapshot/graph modules, both endpoints, route-registry, service registry/tests and authority; no Task6.1 producer path. Byte-verify, review/rerun GREEN, then commit subject.

### Task 12 — Atomically add four safe-union tools and reach 116/106/10

**Files**

- Modify: `service/packages/mcp/package.json`, `service/pnpm-lock.yaml` to add exact direct runtime dependency `pdf-lib:"1.17.1"`.
- Create: `service/packages/mcp/src/execution/pdf-merge.ts`, `export-pool.ts`.
- Create: `service/packages/mcp/src/tools/export-tokens.ts`, `export-frames-to-pdf.ts`, `doctor.ts`, `import-library-variable.ts`.
- Create: `service/packages/plugin/src/handlers/import-library-variable.ts`.
- Modify atomically: MCP tool/result/runtime/policy registries, plugin handler registry, `service/packages/plugin/manifest.json`, union manifest.
- Create: `service/packages/mcp/test/tools/safe-union.test.ts`, `export-tokens.test.ts`, `export-frames-to-pdf.test.ts`, `doctor.test.ts`; `service/packages/plugin/test/handlers/import-library-variable.test.ts`; modify `service/packages/plugin/test/mutation-handler-contract.test.ts` and `service/packages/plugin/test/fixtures/mutation-outcomes.ts` for the exact final80 set; PDF fixtures under `service/packages/mcp/test/fixtures/pdf`.

**Interfaces**

- Consumes: Task3/5/7/8/9/10 plus Task11 service registry2. New runtimes cannot alter `snapshot.capture` or `grounding.refresh`.
- Produces: tools116, handler106/10, execution99/17, kinds23/13/80, maps116, mutation/undo80; service registry remains exact2.

**Commit protocol:** `task-12a.json` lists MCP package+pnpm lock, pdf merge/export pool, four hidden tool modules, PDF fixtures/tests, hidden library handler/test; package+lock are mandatory staged rows after lockfile-only/frozen install. `task-12b.json` lists exact registry/spec/runtime/policy/result files, plugin registry/contract/fixture/manifest, capability rows and exact tests. Each adds manifest/authority; no directory/glob staging.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 12A — hidden adapters | unregistered token/PDF/doctor runtimes, pdf-lib merger/fixtures, unregistered library handler and tests | focused adapter tests pass while parity remains exactly112/105/7 and four manifest rows stay planned | `feat(union): implement hidden safe-union adapters`; no registry/manifest/permission switch allowed |
| 12B — atomic authority switch | four specs/results/handler+execution/target/effects/egress, handler+undo, permission, manifest | tools116, handler106/10, execution99/17, kinds23-13-80, maps116, undo80; service2 unchanged | `feat(union): atomically advertise four safe-union tools` |

12A can be rejected without changing advertised surface. 12B is one atomic diff and cannot merge with a partial count/permission/manifest transition.

**Binding subtask execution**

- [ ] **12A RED:** Run `pnpm -C service exec vitest run packages/mcp/test/tools/export-tokens.test.ts packages/mcp/test/tools/export-frames-to-pdf.test.ts packages/mcp/test/tools/doctor.test.ts packages/plugin/test/handlers/import-library-variable.test.ts test/upstream-parity.test.ts`; expect missing adapter modules/fixtures while parity remains112/105/7 and four manifest rows remain planned.
- [ ] **12A GREEN:** Run `pnpm -C service install --lockfile-only`; `pnpm -C service install --frozen-lockfile`; `pnpm -C service exec vitest run packages/mcp/test/tools/export-tokens.test.ts packages/mcp/test/tools/export-frames-to-pdf.test.ts packages/mcp/test/tools/doctor.test.ts packages/plugin/test/handlers/import-library-variable.test.ts test/upstream-parity.test.ts`; `pnpm -C service --filter @sfp/mcp build`; `pnpm -C service --filter @sfp/plugin build`; `pnpm -C service typecheck`; `node service/scripts/update-service-forks.mjs --slice 12A --index service/capabilities/change-manifests/task-12a.json`; `AUTHORITY_GREEN`; `node service/scripts/verify-staged-change-manifest.mjs --slice 12A`; expect hidden surface and exact pdf-lib lock closure.
- [ ] **12A review and commit:** Stage only `task-12a.json` union, byte-verify, review/rerun exact GREEN, commit exact subject.
- [ ] **12B RED:** Run `pnpm -C service exec vitest run packages/mcp/test/tools/safe-union.test.ts test/tool-contract.test.ts` before registration; expect exact112/105/7 and four planned rows, proving the switch has not partially happened.
- [ ] **12B GREEN:** Run `pnpm -C service exec vitest run packages/mcp/test/tools/safe-union.test.ts packages/mcp/test/tools/export-tokens.test.ts packages/mcp/test/tools/export-frames-to-pdf.test.ts packages/mcp/test/tools/doctor.test.ts packages/mcp/test/policy packages/plugin/test/handlers/import-library-variable.test.ts packages/plugin/test/mutation-handler-contract.test.ts test/tool-contract.test.ts test/tool-registry.test.ts`; `pnpm -C service build`; `pnpm -C service typecheck`; `node service/scripts/update-service-forks.mjs --slice 12B --index service/capabilities/change-manifests/task-12b.json`; `AUTHORITY_GREEN`; `node service/scripts/verify-staged-change-manifest.mjs --slice 12B`; expect final counts and service2 unchanged.
- [ ] **12B review and commit:** Stage only `task-12b.json` union, byte-verify, review/rerun exact GREEN, commit exact subject.

- [ ] **Step 1: Write atomic-count and new-tool RED**

~~~ts
it('reaches the exact safe-union invariant in one change', () => {
  expect(ALL_TOOL_SPECS).toHaveLength(116);
  expect(Object.keys(createSandboxHandlers({} as never))).toHaveLength(106);
  expect(SERVER_ONLY_TOOLS).toEqual(new Set([
    'save_screenshots', 'analyze_project', 'scan_components', 'component_map', 'token_map',
    'icon_map', 'design_diff', 'export_tokens', 'export_frames_to_pdf', 'doctor',
  ]));
  expect(Object.values(TOOL_RUNTIMES).filter(x => x.execution === 'server-adapter')).toHaveLength(17);
  expect(Object.values(TOOL_RUNTIMES).filter(x => x.execution === 'plugin-direct')).toHaveLength(99);
  expect(groupKinds(ALL_TOOL_SPECS)).toEqual({ read: 23, local: 13, write: 80 });
  expect(Object.keys(RESULT_SCHEMAS)).toHaveLength(116);
  expect(Object.keys(RESULT_EGRESS_POLICIES)).toHaveLength(116);
  expect(Object.keys(UNDO_BOUNDARY_POLICIES)).toHaveLength(80);
  expect(Object.keys(MUTATION_HANDLER_CONTRACTS)).toHaveLength(80);
  expect(Object.keys(SERVICE_OPERATION_SPECS).toSorted()).toEqual(['grounding.refresh', 'snapshot.capture']);
  expect(new Set(Object.keys(MUTATION_HANDLER_CONTRACTS))).toEqual(
    new Set([...BASELINE_WRITE_TOOL_NAMES, 'import_library_variable']),
  );
  expect(MUTATION_FIXTURES.map(x => x.tool).toSorted()).toEqual(
    [...BASELINE_WRITE_TOOL_NAMES, 'import_library_variable'].toSorted(),
  );
  expect(types(policy('export_tokens').effectsFor({ format: 'json' }, ctx))).toEqual(['figma-read']);
  expect(types(policy('export_tokens').effectsFor({ format: 'json', outPath: 'tokens.json' }, workspaceCtx)))
    .toEqual(['figma-read', 'filesystem-write']);
  expect(targetRequirement('doctor', { roundTrip: false })).toBe('optional');
  expect(targetRequirement('doctor', { roundTrip: true })).toBe('required');
  expect(synthesizeMcpSelector('doctor', {})).toEqual({ kind: 'none' });
  expect(synthesizeMcpSelector('doctor', { roundTrip: false })).toEqual({ kind: 'none' });
  expect(synthesizeMcpSelector('doctor', { roundTrip: true })).toEqual({ kind: 'active' });
  expect(targetRequirement('export_tokens', { format: 'json' })).toBe('required');
});
~~~

- [ ] **Step 2: Write PDF/order and library import RED**

~~~ts
it('merges completion-out-of-order exports in caller node order', async () => {
  const result = await exportFrames({ nodeIds: ['a', 'b'], outPath }, fakePdfDispatch({ b: 1, a: 20 }));
  expect(await pageLabels(result.path)).toEqual(['a', 'b']);
});

it('imports one library variable through the new handler', async () => {
  const outcome = await handler({ key: 'VariableCollection:Variable' });
  expect(outcome).toMatchObject({
    mutated: true,
    value: { ok: true, key: 'VariableCollection:Variable' },
  });
  const wire = await dispatchToWire('import_library_variable', { key: 'VariableCollection:Variable' });
  expect(wire.result).toMatchObject({ ok: true, key: 'VariableCollection:Variable' });
  expect(JSON.stringify(wire)).not.toContain('mutated');
});
~~~

- [ ] **Step 3: Run safe-union RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/tools/safe-union.test.ts packages/mcp/test/tools/export-tokens.test.ts packages/mcp/test/tools/export-frames-to-pdf.test.ts packages/mcp/test/tools/doctor.test.ts packages/plugin/test/handlers/import-library-variable.test.ts test/tool-contract.test.ts`.

Expected: registry stays 112/105/7, four ToolSpecs/handler/PDF merger are absent, and four manifest rows remain planned.

- [ ] **Step 4: Implement deterministic token export**

Pin variable/style reads to one session. JSON preserves collections/modes/aliases/style tokens. CSS uses requested/default mode, sanitizes names deterministically, reports collisions and omitted modes. No outPath returns content; outPath uses sandbox, explicit approval, atomic create/replace policy, and returns path without duplicate content.

- [ ] **Step 5: Implement ordered PDF export with progress**

Use section 3.9 algorithm, pinned session, concurrency two, original index restoration, progress per collected/merged page, absolute deadline/cancel, corrupt/encrypted/multi-page input rejection, no-overwrite atomic output. Fixtures cover mixed page sizes, resource/font pages, duplicate node IDs, existing output, and outside-root.

- [ ] **Step 6: Implement doctor and library-variable import**

Doctor checks product magic, role, owner-state security, workspace config, pairing, plugin/session/file identity, editor/capability, version skew, and optional typed round trip without exposing secrets. `doctor.test.ts` runs leader and follower with plugin connected/disconnected and proves undefined/false synthesizes none and succeeds daemon-only, while true synthesizes active and fails typed when disconnected. Library handler validates key, Design/teamlibrary capability, invokes `figma.variables.importVariableByKeyAsync`, returns `PluginHandlerOutcome<ImportLibraryVariableResult>` with explicit `mutated`, and uses operation-ID idempotency. It never calls `commitUndo`; the Task 9 top-level dispatcher commits exactly once only when `mutated:true`.

- [ ] **Step 7: Atomically register contracts and permission**

Add four atomic tool rows; three server-adapters and one plugin-direct handler. Preserve service2 unchanged and outside tool counts; use pinned port and Task9 consumer.

- [ ] **Step 8: Run final registry/policy/runtime GREEN**

Run: `pnpm -C service exec vitest run packages/mcp/test/tools packages/mcp/test/policy packages/shared/test packages/plugin/test test/tool-contract.test.ts test/tool-registry.test.ts`, then `pnpm -C service build`.

Expected: tools116, handler106/10, execution99/17, kind23/13/80, maps116, mutation/undo80, service2, planned0, Motion/video, plugin build.

- [ ] **Step 9: Request independent spec review**

Reviewer verifies all four source semantics, exact count transition, PDF/token fidelity, teamlibrary/approval behavior, and experimental Motion/video preservation.

- [ ] **Step 10: Request independent quality review**

Reviewer checks PDF resource copying/order/corruption, export memory/cancel/progress, token determinism, doctor secret hygiene, handler idempotency, and dependency license entry.

- [ ] **Step 11: Verify the two-commit safe-union handoff**

Run: `git diff --check`, `git log -2 --format="%H %s"`, full Task 12 GREEN/build, then `git diff --exit-code`. Expected: the 12A hidden-adapter commit precedes the 12B atomic-advertisement commit and the worktree is clean. Do not squash or create a third aggregate Task 12 commit.

### Task 13 — Build the authenticated companion CLI and exhaustive mappings

**Files**

- Create: `service/packages/cli/src/index.ts`, `client.ts`, `output.ts`.
- Modify CLI package with dependency `@sfp/shared:"workspace:*"` and direct devDependencies `tsdown:"^0.22.14"`, `publint:"^0.3.24"`; package+lock/task13 authority. GREEN runs CLI build then `pnpm -C service --filter @sfp/cli exec publint`.
- Create: command files listed in section 4, including `approve.ts` and `workspace.ts`.
- Create exact default command `service/packages/cli/src/commands/workspace-set-default.ts` and `service/packages/cli/test/commands/workspace-set-default.test.ts` for `sfp workspaces set-default`.
- Create: `service/packages/cli/src/commands/grounding.ts` and matching strict command test for `grounding refresh`.
- Create: `service/packages/cli/src/compat/rust-tool-map.ts`.
- Create: `service/packages/cli/test/client.test.ts`, `commands/*.test.ts`, `compat-mapping.test.ts`, `fixtures/fake-control-server.ts`.
- Create exact command authority `service/capabilities/cli-command-modules.v1.json`, generator `service/scripts/generate-cli-command-module-ledger.mjs`, and `service/packages/cli/test/command-module-ledger.test.ts`.
- Modify: root/package bin/files/export maps so `sfp` points to `packages/cli/dist/index.mjs`.

**Interfaces**

- Consumes: final Task6.1 facade, Task7 tool/service/admin/status, Task8 domains, Task11 snapshot.capture+grounding.refresh, Task12 final authorities. CLI never sends identity/context or redefines wire.
- Produces: authenticated `ControlClient`; workspace and remote-domain config commands; CLI exit codes 0 healthy, 1 degraded/rejected operation, 2 unavailable/config; command mappings below. CLI is a companion to an active MCP/daemon and never starts a hidden leader. Its library-only `ControlledSourceEndpoint {baseUrl,stateRoot}` option exists solely for an in-process source test runner, requires loopback HTTP plus an owner-only canonical stateRoot, and is not reachable from CLI argv, process environment, request bodies, output, or logs. Normal discovery remains unchanged.

**Commit protocol:** `task-13.json` lists CLI index/client/output, every declared command module/test (including status, workspace set-default, and grounding), command ledger generator+authority+test, compat map/test, fake server, CLI/root package and pnpm lock, manifest/authority. CLI package+lock are mandatory staged rows after lockfile-only/frozen install. Modules/tests are not required to be one-to-one with command spellings.

~~~ts
export interface CommandModuleLedgerRowV1 {
  command: string; // canonical token sequence after `sfp`, lowercase kebab words separated by one U+0020
  module: `packages/cli/src/commands/${string}.ts`;
  test: `packages/cli/test/commands/${string}.test.ts`;
}
export interface CommandModuleLedgerV1 {
  version: 1;
  rows: readonly CommandModuleLedgerRowV1[];
  contentSha256: `sha256:${string}`;
}
~~~

The generator strict-parses every command and alias from the command contract, emits one row per unique spelling sorted by UTF-8 command bytes, and hashes canonical rows without `contentSha256` under `sfp-cli-command-module-ledger-v1\0`. Aliases such as `import-component`/`icomp` are separate command rows and may reference the same module/test; one module may own multiple related commands. The verifier requires every command spelling exactly once, every declared `commands/*.ts` module and `commands/*.test.ts` test referenced at least once, every referenced path present, no unreferenced/extra declared module or test, no duplicate command, no path outside the two strict roots, and the regenerated hash/file byte-identical.

**Command contract**

| Command | Canonical call | Required args/options | Approval/output |
|---|---|---|---|
| `sfp status` | public ping facade health, then authenticated `GET /control/status` | `--json` | strict ControlStatusV1 including owner-only plugin/session/file/capability facts; unavailable2 |
| `sfp doctor` | `doctor` | `--round-trip`, `--json` | ordered checks; degraded 1 |
| `sfp pair` | `POST /control/pair/challenge` then authenticated status wait | optional `--wait-for-authenticated` | streams public Pair ID, eight-digit code, and `SFP-id-code` paste form to the controlling TTY; wait mode exits0 only after paired success |
| `sfp workspace add` | `POST /control/workspaces` | path, one-use action nonce | explicit local action; prints workspaceId |
| `sfp workspace list/remove` | `GET /control/workspaces`, `DELETE /control/workspaces/:id` | remove workspaceId+nonce | removal rejects unsettled references |
| `sfp workspaces set-default` | `POST /control/workspaces/default` | workspaceId, `workspace.set-default` nonce | selected ID must exist; direct/follower MCP binding persists across restart |
| `sfp network domains add` | `POST /control/network/domains` | exact three-or-more-label FQDN, nonce | exact equality only; changes owner allowlist, never implicit approval |
| `sfp network domains list/remove` | `GET /control/network/domains`, `DELETE /control/network/domains/:domain` | remove domain+nonce | empty default; wildcard/IP/public suffix rejected |
| `sfp approvals list` | pending approvals API | `--json` | redacted summaries |
| `sfp approve/reject` | approval settle API | approvalId | exact once; late settlement degraded 1 |
| `sfp operations unresolved` | `GET /control/operations?status=outcome-unknown` | `--json` | unresolved records, no raw args/result |
| `sfp operations status` | `GET /control/operations/:id` | issued operation ID | sanitized record/tombstone/resolution |
| `sfp operations resolve` | `POST /control/operations/:id/resolve` | ID, `--decision` set to applied, not-applied, or abandoned; reason/evidence file hash; `--confirm <operationId/resultHash-or-unknown>`; nonce | owner-local administrative terminal resolution; no normal approval/OperationRecord and never replay permission |
| `sfp compat` | manifest/status | `--json` | Rust 73 same/adapter/incompatible/unique-adapter plus helper20/parser12 |
| `sfp snapshot` | control snapshot capture | `--workspace`, target | ID/path/hash/fidelity |
| `sfp grounding refresh` | service `grounding.refresh` selector none | `--workspace 123e4567-e89b-42d3-a456-426614174000 --snapshot-id sfp_snap1_AAAAAAAAAAAAAAAAAAAAAA --file-hash sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`; optional expected checksum | strict locator/ref/counts |
| `sfp tokens export` | `export_tokens` | format, mode, optional outPath | content or approved sandbox path |
| `sfp pdf export` | `export_frames_to_pdf` | ordered node IDs, outPath | approved create-new PDF and progress |
| `sfp sel/tree/find` | get_selection/get_design_context/search_nodes | target/query/detail | typed reads only |
| `sfp text/variant` | set_text or set_text_range / set_instance_properties | resolved target and values | same executor/approval; one undo boundary |
| `sfp clone/rm` | clone_node / delete_nodes | target, clone direction/gap | rm always destructive approval |
| `sfp import-component` / `icomp` | create_instance(componentKey) | key,parent | typed write |
| `sfp import-variable` | import_library_variable | key | library import approval |
| `sfp exec` | none | any | command absent; compatibility row rejected |

- [ ] **Step 1: Write client auth and command-mapping RED**

~~~ts
it('maps every figmosha source row without exposing exec', () => {
  expect(mappedHelpers).toHaveLength(20);
  expect(mappedParsers).toHaveLength(12);
  expect(uniqueParserBehaviors).toBe(11);
  expect(parseCli(['exec', 'figma.currentPage'])).toMatchObject({ ok: false, code: 'COMMAND_REJECTED' });
});

it('requires an active authenticated daemon for mutation commands', async () => {
  await expect(runCli(['rm', '1:2'])).resolves.toMatchObject({ exitCode: 2, code: 'DAEMON_UNAVAILABLE' });
});

it('uses only an explicit in-process controlled-source endpoint', async () => {
  const client = await createControlClient({}, {
    controlledSource: { baseUrl: 'http://127.0.0.1:38456', stateRoot: secureDaemonRoot },
  });
  expect(client.endpoint).toBe('http://127.0.0.1:38456');
  await expect(createControlClient({}, {
    controlledSource: { baseUrl: 'http://example.com:38456', stateRoot: secureDaemonRoot },
  })).rejects.toMatchObject({ code: 'DAEMON_CONFIG_INVALID' });
  expect(sourceText('packages/cli/src/index.ts')).not.toMatch(/controlledSource/);
  expect(environmentKeysReadByCli()).toEqual([]);
  expect(lastRequestBody()).not.toMatchObject({ stateRoot: expect.anything(), port: expect.anything() });
});

it('maps workspace and network-domain commands to authenticated control routes', async () => {
  await runCli(['workspace', 'add', workspacePath], fakeControl);
  await runCli(['workspaces', 'set-default', workspaceId], fakeControl);
  await runCli(['network', 'domains', 'add', 'assets.example.com'], fakeControl);
  expect(fakeControl.calls.map(x => [x.method, x.path])).toEqual([
    ['POST', '/control/action-nonces'],
    ['POST', '/control/workspaces'],
    ['POST', '/control/action-nonces'],
    ['POST', '/control/workspaces/default'],
    ['POST', '/control/action-nonces'],
    ['POST', '/control/network/domains'],
  ]);
  expect(fakeControl.calls[0]?.body).toMatchObject({ action: 'workspace.add', registrationPath: workspacePath });
});

it('reads public health then owner-only control status without public session oracle', async () => {
  await runCli(['status', '--json'], fakeControl);
  expect(fakeControl.calls.map(x => x.path)).toEqual(['/ping', '/control/status']);
  expect(fakeControl.calls[1]?.headers.authorization).toBeDefined();
  expect(fakeControl.calls[0]?.json).not.toHaveProperty('activePlugin');
});

it('sends selectors only and parses bounded NDJSON until one terminal frame', async () => {
  const result = await runCli(['tree', '--session', SESSION_ID_WITH_UNDERSCORE], fakeControl);
  expect(fakeControl.lastCall.body).toEqual(expect.objectContaining({
    version: 1, targetSelector: { kind: 'session', sessionId: SESSION_ID_WITH_UNDERSCORE },
  }));
  expect(fakeControl.lastCall.body).not.toEqual(expect.objectContaining({ actorId: expect.anything() }));
  expect(result.frames.map(x => x.type)).toEqual(['accepted', 'progress', 'result']);
});

it('resolves an unknown operation without reusing its ID', async () => {
  await runCli([
    'operations', 'resolve', operationId, '--decision', 'applied', '--reason', reasonFile, '--evidence', evidenceFile,
    '--confirm', `${operationId}/unknown`,
  ], fakeControl);
  expect(fakeControl.lastCall.path).toBe(`/control/operations/${encodeURIComponent(operationId)}/resolve`);
  expect(fakeControl.lastCall.body).toMatchObject({
    decision: 'resolved-applied', reasonHash, evidenceHash, confirm: `${operationId}/unknown`,
  });
});

it('covers commands and aliases without assuming module bijection', async () => {
  const ledger = await loadCommandModuleLedger();
  expect(ledger.rows.filter(row => row.module.endsWith('/import-component.ts')).map(row => row.command))
    .toEqual(['icomp', 'import-component']);
  expect(new Set(ledger.rows.map(row => row.command)).size).toBe(ledger.rows.length);
  expect(await unreferencedDeclaredCommandFiles(ledger)).toEqual({ modules: [], tests: [] });
  expect(ledger.contentSha256).toBe(await regenerateCommandModuleLedgerHash());
});
~~~

- [ ] **Step 2: Run CLI RED**

Run: `pnpm -C service exec vitest run packages/cli/test`.

Expected: CLI package source is absent while the workspace harness remains runnable.

- [ ] **Step 3: Implement ControlClient and output contract**

Read the control token from stateRoot; use final Task6.1 public facade only for health, then authenticated `/control/status` for oracles. Strict-parse the library-only controlled-source option before connecting, reject non-loopback/insecure/partial values, and keep it unavailable to the CLI entry, environment, request bodies, output, and logs. Tool/service/admin requests stay separate; parse bounded frames and enforce origin-session cancel.

- [ ] **Step 4: Implement workspace, pairing, and approval commands**

Implement all table rows, terminal-only public Pair ID+code/paste-form display, pending approval list, exact approve/reject, operation issue/list/status/resolve, workspace realpath/default lifecycle, and exact-host allowlist lifecycle. Before each nonce-protected route, canonicalize the exact semantic request, call `POST /control/action-nonces`, and use the returned nonce once; do not generate/cache/reuse nonces locally. Workspace add computes `{realPath}`, but sends strict `{action:'workspace.add',requestHash,registrationPath}` so the server independently binds/revalidates identity. Workspace set-default hashes `{workspaceId}` and calls the exact route. Mutation wrappers request a server-issued operation ID before dispatch and surface it in accepted/progress/error/output. Operation resolve is an owner-local administrative call that requires exact `--confirm <operationId/resultHash-or-unknown>`, hashes reason/evidence locally, requests a bound nonce, and never resubmits the original tool. JSON pair output includes challengeId/expiry but redacts code after exchange; control token supplies actor identity and bodies cannot override it.

`sfp pair --wait-for-authenticated` is explicitly interactive: it requires a TTY, writes Pair ID/code/paste form directly without buffering, never offers JSON/redirection mode, polls authenticated status without reprinting the code, and exits only on paired success, typed expiry/rejection, or interrupt. Its Task13 process tests prove stdout capture is rejected and the code is absent from logs after exchange. Task16 does not invoke this command or a TTY; its `fake.pair-resume` row drives the typed pairing/resume ports directly in process.

- [ ] **Step 5: Implement snapshot/export/read/write wrappers**

Use typed tool/service endpoints. Snapshot obtains operationId and calls `snapshot.capture`; grounding refresh strict-parses `SnapshotLocator {workspaceId,fileIdentityHash,snapshotId}`, validates the expected graph checksum, and calls `grounding.refresh` with matching request workspaceId and selector none. Wrappers print strict result fields. No wrapper owns mutation/progress/cancel state machines.

- [ ] **Step 6: Implement compatibility output**

Report canonical116/source114/helper20/parser12, source/target schema hashes, Motion/video experimental availability, and Rust 2 unique adapters. Official limits appear only as external links/checked date without numeric constants.

- [ ] **Step 7: Run CLI GREEN**

Run this complete copy/paste block against the staged `task-13.json` tree:

~~~powershell
pnpm -C service install --lockfile-only
pnpm -C service install --frozen-lockfile
node service/scripts/generate-cli-command-module-ledger.mjs --write service/capabilities/cli-command-modules.v1.json
pnpm -C service exec vitest run packages/cli/test
pnpm -C service exec vitest run packages/cli/test/command-module-ledger.test.ts
pnpm -C service --filter @sfp/cli typecheck
pnpm -C service --filter @sfp/cli build
pnpm -C service --filter @sfp/cli exec publint
node service/packages/cli/dist/index.mjs --help
node service/scripts/update-service-forks.mjs --slice 13 --index service/capabilities/change-manifests/task-13.json
node service/scripts/vendor-upstreams.mjs --copy-only
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts test/authority-class-transition.test.ts test/service-fork-lineage.test.ts
node service/scripts/verify-staged-change-manifest.mjs --slice 13
~~~

Expected: command table, approval/workspace/auth/progress/CJK/emoji/Windows path tests pass and help lists no exec.

- [ ] **Step 8: Request independent spec review**

Reviewer checks every helper/parser mapping, command→tool policy path, exit codes, active-daemon constraint, and approval behavior.

- [ ] **Step 9: Request independent quality review**

Reviewer checks parseArgs ambiguity, terminal/JSON redaction, path quoting, progress cancellation, Unicode, and fake-server isolation.

- [ ] **Step 10: Commit CLI**

Stage only `task-13.json` union, byte-verify, review/rerun exact GREEN, commit exact subject.

### Task 14 — Correct skills and write capability, security, and official build-vs-buy docs

**Files**

- Modify: `service/skills/figma-codegen/**`, `service/skills/figma-build/**`.
- Create: `service/skills/compat-rust-recipes/` with only schema-validated recipes.
- Create/modify: `service/README.md`, `SECURITY.md`, `docs/architecture.md`, `build-vs-buy.md`, `capability-matrix.md`, `compatibility.md`, `operation-policy.md`, `pairing.md`, `snapshot-format.md`, `desktop-diagnostics.md`.
- Create: `service/test/docs-sync.test.ts`.

**Interfaces**

- Consumes: Task 12 final manifest/policies and Task 13 exact CLI/help output.
- Produces: docs synchronized with tools116, handler106/10, execution99/17, service2.

**Commit protocol:** `task-14.json` explicitly lists README, SECURITY, eight named docs, docs-sync test, every changed skill file and new compat recipe, manifest/authority. Before editing, freeze `service/capabilities/task-14-skill-base.json` from sorted `git ls-files service/skills/figma-codegen service/skills/figma-build` with blob hashes; final manifest may include only those rows plus exact new `skills/compat-rust-recipes/SKILL.md` and schema-validated recipe files.

- [ ] **Step 1: Write docs/skills RED**

~~~ts
it('documents official write and code-to-canvas without frozen rate numbers', async () => {
  const doc = await read('docs/build-vs-buy.md');
  expect(doc).toContain('use_figma');
  expect(doc).toContain('generate_figma_design');
  expect(doc).toContain('search_design_system');
  expect(doc).not.toMatch(/\b(?:calls?|requests?)\s*(?:per|\/)\s*(?:month|day|minute)\b/i);
});

it('does not call scan_components a Figma component browser', async () => {
  expect(await read('skills/figma-build/SKILL.md')).toContain('scan_components scans local code AST');
});
~~~

- [ ] **Step 2: Run docs RED**

Run: `pnpm -C service exec vitest run test/docs-sync.test.ts`.

Expected: copied skills contain the discovery drift and build-vs-buy document is absent.

- [ ] **Step 3: Correct agent workflows**

Use `get_local_components` only for selection/subtree Figma discovery, page traversal for broader local discovery, known keys for library imports, and `scan_components` only for code AST. Add snapshot/compat/export/policy/approval/visual verification sequences and treat annotations/text as untrusted data.

- [ ] **Step 4: Write official build-vs-buy and cost boundary**

Document official `use_figma` write-to-canvas, `generate_figma_design` live UI capture, design-system search/assets, current permission/seat limitations, checked official URLs/date, and separation of official MCP access limits from REST endpoint tiers. No numeric rate is copied. Explain local connector differentiation: repeated local grounding, legacy joins, workspace policy, audit, and fallback limits.

- [ ] **Step 5: Write capability/security/operator docs**

Document final Task6.1 facade/stream boundary, owner/auth/policy/target/runtime, tool/service/admin with snapshot.capture+grounding.refresh service2, status, journal/finalizer/demotion/limits, plugin consumer and prior product boundaries.

- [ ] **Step 6: Run docs GREEN**

Run `pnpm -C service exec vitest run test/docs-sync.test.ts test/tool-contract.test.ts`, `pnpm -C service format:check`, `node service/scripts/update-service-forks.mjs --slice 14 --index service/capabilities/change-manifests/task-14.json`, `AUTHORITY_GREEN`, `node service/scripts/verify-staged-change-manifest.mjs --slice 14`.

Expected: docs counts/commands/URLs/skills/policies match generated authorities and no fixed official rate text exists.

- [ ] **Step 7: Request independent spec review**

Reviewer compares docs against binding 04/05, official-current feature claims, product boundary, and all manifest dispositions.

- [ ] **Step 8: Request independent quality review**

Reviewer checks clarity, links, command examples, policy non-overclaim, no secrets, and no unsupported Web/public/local-only marketing.

- [ ] **Step 9: Commit docs and skills**

Stage only `task-14.json` union, byte-verify, review/rerun GREEN, commit exact subject.

### Task 15 — Add local artifact hygiene, CI, SBOM, checksums, and verification

**Files**

- Modify: `service/package.json`, `service/vitest.config.ts`, package manifests/files/bin/export maps, `service/pnpm-lock.yaml`, hygiene files from Task1; create `service/vitest.artifacts.config.ts`; add exact root devDependency `happy-dom:"20.11.11"` and no YAML dependency.
- Modify: `service/packages/mcp/tsdown.config.ts` and `service/packages/cli/tsdown.config.ts` to bundle internal workspaces; generate packed manifests without private workspace runtime dependencies.
- Create: `.github/workflows/service-ci.yml` only; it verifies source and local preview artifacts and has no publish permission.
- Modify service ignore policy for generated `service/artifacts/**`; Task15 creates no preview candidate/schema/writer/test.
- Create: `service/scripts/generate-sbom.mjs`, `generate-notices.mjs`, `package-artifacts.mjs`, `generate-checksums.mjs`, `verify-artifacts.mjs`, `smoke-packed-mcp.mjs`.
- Create/modify: `service/THIRD_PARTY_NOTICES.md`, `PROVENANCE.md`, `SBOM.spdx.json`.
- Create: `service/test/artifact-contents.test.ts`, `service/test/plugin-built-consumer.test.ts`, `service/test/workflow-hygiene.test.ts`, `service/test/package-scripts-windows.test.ts`, and RED-only fixture; modify `service/test/bootstrap.test.ts` to assert Vitest-config exclusions, quote-safe scripts, exact artifact config, and assembly/verification order.

**Interfaces**

- Consumes: Task 2 offline provenance, Task 12 final manifest and pdf-lib dependency, Task 14 docs/skills.
- Produces deterministic three local artifacts+manifest. SBOM/notices/checksums and `verify:artifacts` form one artifact-only gate; it cannot support a source-complete claim.

**Commit protocol:** `task-15.json` enumerates ignore+service-ci workflow as class4; package+lock; both Vitest configs; hygiene/tsdown; six packaging scripts; legal/SBOM; bootstrap/artifact/plugin/workflow/Windows tests; RED fixture; manifest/authority. Generated local artifacts are ignored; candidate/evidence/marker paths are absent until Task16.

- [ ] **Step 1: Write artifact-content RED**

~~~ts
it.each(['mcp.tgz', 'cli.tgz', 'plugin.zip'])('%s carries legal and capability authorities', async artifact => {
  const names = await listArtifact(artifact);
  for (const required of [
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PROVENANCE.md', 'SBOM.spdx.json',
    'licenses/figwright-LICENSE', 'licenses/figma-mcp-rust-LICENSE', 'licenses/figmosha2-LICENSE',
    'capabilities/union-manifest.json',
  ]) expect(names).toContain(required);
});

it.each([
  ['mcp.tgz', 'node scripts/smoke-packed-mcp.mjs'],
  ['cli.tgz', 'sfp --help'],
])('checks %s alone in an empty prefix and runs %s', async (artifact, smoke) => {
  const install = await installInEmptyPrefix({ artifact, freshCache: true });
  expect(install.packageJson).not.toMatchObject({
    dependencies: expect.objectContaining({ '@sfp/shared': expect.anything(), '@sfp/ir': expect.anything() }),
  });
  expect(await install.npmLsAll()).toMatchObject({ exitCode: 0 });
  expect(await install.run(smoke)).toMatchObject({ exitCode: 0 });
  expect(await install.findWorkspacePaths()).toEqual([]);
});
~~~

Create `test/fixtures/assemble-baseline-artifacts.mjs` with the RED harness: it directly packs the current MCP and CLI package directories into `service/artifacts/mcp.tgz` and `cli.tgz`, copies only current plugin manifest/dist into an isolated temporary Git worktree, commits it with fixed test author/time, and invokes `git archive --format=zip` through `execFile` argv to create `plugin.zip`. It deliberately does not add root legal/capability authorities, removes the temporary `.git`, and is excluded from every packaged artifact.

- [ ] **Step 2: Run artifact RED**

Run: `pnpm -C service build`; `node service/test/fixtures/assemble-baseline-artifacts.mjs`; `pnpm -C service exec vitest run test/artifact-contents.test.ts test/plugin-built-consumer.test.ts test/workflow-hygiene.test.ts test/package-scripts-windows.test.ts test/bootstrap.test.ts`.

Expected behavioral RED: the runnable harness creates all three baseline artifacts; legal/SBOM/capability and isolated-package assertions fail; ordinary/artifact Vitest ordering and Windows cmd quoting fail; workflow permits disallowed or non-frozen behavior; the unpacked built consumer lacks full pair/progress/approval and no-fileKey bootstrap reject/approve/one-undo/rehello/crash/no-control-token parity. Failures come from legacy behavior, not missing tests or future scripts.

- [ ] **Step 3: Implement actual artifact assembly**

Set MCP `alwaysBundle=['@sfp/shared','@sfp/ir']`, CLI `alwaysBundle=['@sfp/shared']`; packed manifests contain no private/workspace runtime dependency. `package-artifacts.mjs --clean-only` resolves and verifies exact fixed artifact targets under `service/artifacts/`, removes only owned staging/temp outputs and exits before build/pack; it never accepts a caller path. Normal mode creates clean `.staging/mcp-package` and `cli-package` with dist, sanitized package.json, README, LICENSE, notices, provenance, SBOM, three licenses and three capability ledgers with exact files arrays. `npm pack` each by argv, normalizes names, checks each package in a fresh empty prefix/cache, runs `npm ls` plus packed-bin smokes, and rejects workspace paths. It emits exact metadata files `artifact-manifest.v1.json` and `SHA256SUMS`; each final artifact/metadata file is written atomically and reread verified. Task15 creates no content directory or pointer. Record final Task6.1 public facade build identity; preserve legal/provenance/Solar/raw-exec/code-kb absence gates.

Plugin staging root is exactly `service/artifacts/.staging/plugin-package/` and contains only `manifest.json`, `dist/code.js`, `dist/index.html`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `PROVENANCE.md`, `SBOM.spdx.json`, three `licenses/*-LICENSE`, and all three capability ledgers (`union-manifest.json`, `rust-tool-compat.json`, `figmosha-feature-map.json`) under `capabilities/`. Manifest main/ui targets must exist. Copy built bytes only; no source/map/temp. Normalize repo path order, modes and `SOURCE_DATE_EPOCH` from the source commit; fixed author/committer; create isolated one-commit repo and `git archive` so two clean builds have identical file list/timestamps/ZIP SHA.

`plugin-built-consumer.test.ts` unpacks actual ZIP, executes built main/UI, and drives it against the real daemon approval broker adapter. Besides pair/reconnect/progress/cancel cleanup it repeats core approval approve→one runtime, reject→runtime0, duplicate ignored, reconnect redelivery without TTL extension, and asserts built plugin receives no control token. Its packed identity-bootstrap sequence is binding: initial authenticated no-fileKey/no-shared-UUID hello reports unstable-readonly; rejected `identity.bootstrap` leaves shared plugin data absent, runtime0 and undo0; approved bootstrap reaches the packaged dispatcher once, writes only `sfp/file-identity:v1`, reports `mutated:true`, and creates exactly one undo; operation result forces rehello and does not remap Relay; the next authenticated hello reads the UUID and yields stable identity. A crash after dispatched is outcome-unknown/no retry; packaged-plugin reconnect reads the existing UUID, rehello exposes the same stable identity, and status/resolution—not another bootstrap—settles it. Wrong generation/target and any plugin control-token access reject. Source tests cannot satisfy. Task15 `task-15.json` explicitly includes the built consumer test plus packaged daemon/bridge capability hashes it asserts, while Task9 remains the only owner of implementation paths.

Task15 packaging derives the executable surface only from named `packages/mcp/package.json` files/exports/bin fields plus the packed artifact manifest; there is no anonymous authority. At Task15 those named fields contain the existing MCP entry and the packed MCP artifact intentionally has no daemon export/bin. Task16 adds `dist/daemon-entry.mjs` to those same named fields and packed smoke/hash authority.

Artifact verifier asserts tools116, handler106/10, execution99/17, service2 exact names, final Task6.1 ping facade fields, no public session oracle, and unpacked plugin consumer parity.

- [ ] **Step 4: Implement source and local-artifact CI**

Create immutable-digest CI with least read/test permissions. It runs frozen dependency restoration and local artifact verification only. There is no distribution, upload, tag, or publish job in this plan.

- [ ] **Step 5: Verify upstream and package contents offline**

Run `pnpm -C service install --lockfile-only`; `pnpm -C service install --frozen-lockfile`; `pnpm -C service verify:artifacts`; `pnpm -C service exec vitest run test/artifact-contents.test.ts test/plugin-built-consumer.test.ts test/workflow-hygiene.test.ts test/package-scripts-windows.test.ts`; `node service/scripts/update-service-forks.mjs --slice 15 --index service/capabilities/change-manifests/task-15.json`; `AUTHORITY_GREEN`; `node service/scripts/verify-staged-change-manifest.mjs --slice 15`. Outputs stay ignored/local; no candidate/evidence/marker exists.

Expected: canonical/source ledgers, handler106/10, execution99/17, service2, plugin parity, Motion/video, legal/SBOM/provenance/checksums and isolated installs.

- [ ] **Step 6: Run workflow hygiene checks**

Run exact `pnpm -C service exec vitest run test/workflow-hygiene.test.ts`. The dependency-free restricted workflow parser rejects unsupported YAML, floating actions, excess permissions, non-frozen dependency restoration, any tag/upload/publish trigger or command, and wrong working-directory. Optional actionlint/zizmor may add diagnostics but cannot replace this gate.

- [ ] **Step 7: Request independent spec review**

Reviewer opens every actual artifact and compares legal/capability/runtime contents with DoD; source-tree presence alone is insufficient.

- [ ] **Step 8: Request independent quality review**

Reviewer checks reproducibility, package surface, workflow permissions, provenance/checksum order, SBOM completeness, ignored outputs, and absence of external side effects.

- [ ] **Step 9: Commit local artifact machinery**

Stage only `task-15.json` union, byte-verify, review/rerun exact GREEN, then commit exact subject.

### Task 16 — Build the source daemon and unsigned source-complete checks

**Files**

- Create `service/packages/mcp/src/application.ts` and `service/packages/mcp/src/daemon-entry.ts`; modify `service/packages/mcp/src/index.ts`, `service/packages/mcp/package.json`, and `service/packages/mcp/tsdown.config.ts`; create `service/packages/mcp/test/application.test.ts` and `service/packages/mcp/test/e2e/daemon-entry.test.ts`.
- Create `service/schemas/preview-candidate-v1.schema.json`, `service/schemas/source-complete-evidence-v1.schema.json`, and `service/schemas/source-complete-preview-v1.schema.json`.
- Create `service/scripts/current-windows-diagnostic.mjs`, `run-fake-source-checks.mjs`, `source-complete-validator.mjs`, `write-preview-candidate.mjs`, and `write-source-complete-preview.mjs`.
- Create exact root tests `service/test/preview-candidate.test.ts`, `source-complete-evidence.test.ts`, `current-windows-diagnostic.test.ts`, `evidence-schema-draft.test.ts`, `source-harness-binding.test.ts`, `blocking-check-fixture-map.test.ts`, and `daemon-artifact-surface.test.ts`; modify `service/test/workflow-hygiene.test.ts`, `service/vitest.config.ts`, and `service/vitest.artifacts.config.ts` so the final artifact-dependent tuple is exactly three rows.
- Modify Task15 `service/scripts/package-artifacts.mjs`, `verify-artifacts.mjs`, the named MCP `files`/`exports`/`bin` fields, and packed artifact manifest to include `dist/daemon-entry.mjs`. There is no anonymous executable authority.
- Modify `service/package.json` and `service/pnpm-lock.yaml` only for direct Ajv `8.17.1`, exact source-complete scripts, and lock authority. Fixed generated files under `service/artifacts/` remain ignored.
- No detached controller, process-state file, automatic pairing, destructive fixture setup/cleanup, real workspace/domain/Figma mutation, external network, or publication workflow belongs to Task16.

**Interfaces**

- Consumes: Task15 verified local artifacts plus all Task1–15 source authorities and frozen Task6.1.
- Produces: `createMcpApplication`, stdio/daemon parity, foreground source daemon entry, the exact fake16 evidence checks, typed non-destructive current-Windows `PLUGIN_NOT_CONNECTED`/co-presence diagnostic, `PreviewCandidateV1`, `SourceCompleteEvidenceV1`, and `SourceCompletePreviewV1`.
- Any real-Figma validation is a separate supplemental plan using a dedicated validation folder and explicit user scope; this plan neither creates nor executes it.

**Commit protocol:** `task-16.json` enumerates the exact two MCP sources plus index, MCP package/build config, two MCP tests, three schemas, five created scripts, two modified Task15 scripts, seven created root tests plus modified workflow test, both Vitest configs, root package+lock, artifact manifest authority, change manifest, and closed-world authority files. Generated outputs are absent from the staged tree; no directory/glob row is legal.

- [ ] **Step 1: Write complete Task16 RED**

~~~ts
it('uses one application composition for stdio and daemon entries', async () => {
  expect(await compositionRootImports()).toEqual({
    index: ['createMcpApplication'],
    daemon: ['createMcpApplication'],
    other: [],
  });
});

it('closes the in-process application gracefully and idempotently', async () => {
  const app = await createMcpApplication({ stateRoot: secureTestRoot });
  const server = await app.startHttp({ host: '127.0.0.1', port: 0 });
  await Promise.all([app.close(), app.close()]);
  await app.close();
  await expect(waitForPortClosed(server.port, 2000)).resolves.toBe(true);
});

it('keeps the child alive after piped stdin EOF and closes the same child cross-platform', async () => {
  const child = await spawnBuiltDaemon({ stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  child.stdin.end();
  await delay(250);
  await expect(strictPing(child.readyPort)).resolves.toMatchObject({ product, buildId });
  const exit = await terminateSameChild(child);
  if (process.platform === 'win32') expect(exit.pid).toBe(child.pid);
  else expect(exit).toMatchObject({ pid: child.pid, code: 0, signal: null });
  await expect(waitForPortClosed(child.readyPort, 2000)).resolves.toBe(true);
});

it('records the Task15 daemon-surface RED before requiring the final packed surface', async () => {
  const before = await inspectPackedMcp('artifacts/mcp.tgz');
  expect(before).toMatchObject({ daemonFile: false, daemonExport: false, daemonBin: false });
  expect(before).toMatchObject({ daemonFile: true, daemonExport: true, daemonBin: true }); // behavioral RED
});

it('keeps the current-Windows diagnostic non-destructive and supplemental', async () => {
  await expect(runCurrentWindowsDiagnostic({ pluginConnected: false }))
    .rejects.toMatchObject({ code: 'PLUGIN_NOT_CONNECTED' });
  expect(pairCalls()).toBe(0);
  expect(workspaceMutations()).toEqual([]);
  expect(figmaMutations()).toEqual([]);
});

it('writes exactly three cross-validated unsigned files', async () => {
  const candidate = await writePreviewCandidate();
  const evidence = await runFake16({ candidate });
  const marker = await writeSourceCompletePreview({ candidate, evidence });
  expect(evidence.checks.map(x => x.id)).toEqual(REQUIRED_BLOCKING_CHECK_IDS.fake);
  expect(marker).toMatchObject({
    externalValidationStatus: 'not-run',
    candidateContentHash: candidate.contentHash,
    evidenceContentHash: evidence.contentHash,
  });
  expect(await sourceCompleteOutputNames()).toEqual([
    'preview-candidate.v1.json',
    'source-complete-evidence.v1.json',
    'source-complete-preview.v1.json',
  ]);
});
~~~

The first packed-surface assertion is a RED-only baseline guard: it must observe the Task15 artifact with no daemon file/export/bin, then the desired assertion fails. Step4 replaces the baseline branch with one final positive assertion; it is not retained as contradictory GREEN code. Source-complete tests also mutate one valid-format file hash, internal content hash, source commit, harness hash, and artifact/checksum tuple in turn and require cross-field rejection after reread.

- [ ] **Step 2: Run literal RED**

~~~powershell
pnpm -C service build
node service/test/fixtures/assemble-baseline-artifacts.mjs
pnpm -C service exec vitest run --config vitest.artifacts.config.ts test/daemon-artifact-surface.test.ts
pnpm -C service exec vitest run packages/mcp/test/application.test.ts packages/mcp/test/e2e/daemon-entry.test.ts test/preview-candidate.test.ts test/source-complete-evidence.test.ts test/current-windows-diagnostic.test.ts test/evidence-schema-draft.test.ts test/source-harness-binding.test.ts test/blocking-check-fixture-map.test.ts test/workflow-hygiene.test.ts
~~~

Expected behavioral RED: baseline inspection positively proves current `mcp.tgz` lacks `dist/daemon-entry.mjs`, `./daemon`, and `sfp-daemon`, then the desired surface assertion fails. Existing index still owns composition; daemon entry/factory and idempotent close contract are absent; stdin-EOF and cross-platform same-child semantics are unmet; typed fake pair/resume, candidate/evidence/marker cross-fields, exact three filenames, and non-destructive diagnostic gates fail through explicit assertions. Every named test exists and runs; a missing test or an accidental module-resolution exception is not an acceptable RED.

- [ ] **Step 3: Extract the application factory and implement foreground lifecycle**

Move all composition into `createMcpApplication(options): Promise<{startHttp,attachStdio,close}>`; `index.ts` remains only the stdio adapter. `close()` is concurrency-safe, idempotent, gracefully stops admission/HTTP/stdio/application resources, and resolves only after owned ports close. `daemon-entry.ts` strict-parses an owner-secure absolute `--state-root` and decimal `--port` (`0` for OS assignment or `1024..65535`), calls only `startHttp`, never attaches stdio, ignores stdin/EOF, and awaits one idempotent close path for signals. A normal process never detaches itself or writes process-state metadata.

The MCP process test spawns the freshly built `dist/daemon-entry.mjs` with piped stdin/stdout/stderr, closes stdin, waits 250 ms, and proves strict ping still works; the artifact-dependent root test separately repeats the core lifecycle against the unpacked tarball. POSIX sends `SIGTERM` and may assert `{code:0,signal:null}` within 5,000 ms because the handler closes cleanly. Windows calls `child.kill()` on the retained handle and asserts only that the same PID exits within 5,000 ms and the port closes; it makes no exit-code/signal claim. `afterEach` always terminates and awaits that exact handle.

- [ ] **Step 4: Build and package the exact daemon executable surface**

`service/packages/mcp/tsdown.config.ts` has exact entries `{index:'src/index.ts',daemon:'src/daemon-entry.ts'}` and asserts outputs `dist/index.mjs` and `dist/daemon-entry.mjs`. `service/packages/mcp/package.json` preserves existing fields, requires `files` to include `dist`, adds export `"./daemon":"./dist/daemon-entry.mjs"`, and adds exact bin `"sfp-daemon":"dist/daemon-entry.mjs"`. Package/artifact tests reject a source-path fallback, an extra daemon path, or any disagreement among package.json, tsdown output, `artifact-manifest.v1.json`, and tar contents.

The unpacked help smoke runs `node package/dist/daemon-entry.mjs --help`, requires exit0 within 2,000 ms, empty stderr, and exact stdout `Usage: sfp-daemon --state-root <absolute-path> --port <0|1024-65535>\n` (UTF-8, at most 512 bytes). Startup runs `node package/dist/daemon-entry.mjs --state-root <verifiedTestTemp> --port 0`; within 5,000 ms stdout must contain exactly one LF-terminated JSON line with key order `{"type":"sfp-daemon-ready-v1","port":<actualPort>}`, actualPort in `1024..65535`, no extra stdout, and empty stderr. The test strict-parses public ping within 2,000 ms, verifies build identity, terminates the retained child under the platform rules above, and proves connect fails/port closes within 2,000 ms. Step1's contradictory baseline assertion is replaced by the final positive file/export/bin assertion.

- [ ] **Step 5: Implement fake16 and the non-destructive diagnostic**

`run-fake-source-checks.mjs` executes exactly the section3.13 rows using typed fakes and test-owned temporary roots. `fake.pair-resume` invokes the pairing/resume broker interfaces directly with deterministic fake transport; it never launches `sfp pair`, allocates a TTY, shows a code, or reads interactive input. The current-Windows diagnostic uses the source runner's retained daemon child, checks only Figma Desktop/plugin co-presence, emits strict JSON to stdout, returns typed `PLUGIN_NOT_CONNECTED` when absent, writes no source-complete file, and cannot pair, create, register, import, mutate, delete, or access external network.

- [ ] **Step 6: Implement the three schemas and three-file pipeline**

Implement the three exact section3.13 schemas and domains through the single Ajv module. `write-preview-candidate.mjs` consumes only the clean source commit, Task15 `artifact-manifest.v1.json`/`SHA256SUMS`, artifact bytes, and exact Git-blob harness manifest. `run-fake-source-checks.mjs` writes the complete fake16 array directly into `source-complete-evidence.v1.json`; there is no intermediate result file. `write-source-complete-preview.mjs` rereads both prior files, enforces all file/content/cross-field equalities, and writes the marker. The only new fixed ignored outputs are the three filenames in section3.13.

- [ ] **Step 7: Run complete precommit GREEN, including the full artifact gate**

~~~powershell
pnpm -C service install --lockfile-only
pnpm -C service install --frozen-lockfile
pnpm -C service verify:artifacts
pnpm -C service test:artifacts
pnpm -C service exec vitest run --config vitest.artifacts.config.ts test/daemon-artifact-surface.test.ts
pnpm -C service exec vitest run packages/mcp/test/application.test.ts packages/mcp/test/e2e/daemon-entry.test.ts test/preview-candidate.test.ts test/source-complete-evidence.test.ts test/current-windows-diagnostic.test.ts test/evidence-schema-draft.test.ts test/source-harness-binding.test.ts test/blocking-check-fixture-map.test.ts test/workflow-hygiene.test.ts
pnpm -C service --filter @sfp/mcp build
pnpm -C service typecheck
node service/scripts/update-service-forks.mjs --slice 16 --index service/capabilities/change-manifests/task-16.json
node service/scripts/vendor-upstreams.mjs --copy-only
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts test/authority-class-transition.test.ts test/service-fork-lineage.test.ts
node service/scripts/verify-staged-change-manifest.mjs --slice 16
node -e "const f=require('node:fs');for(const p of ['service/artifacts/preview-candidate.v1.json','service/artifacts/source-complete-evidence.v1.json','service/artifacts/source-complete-preview.v1.json'])if(f.existsSync(p))process.exit(1)"
~~~

Expected: application/stdio/daemon parity, idempotent application close, EOF survival, platform-specific retained-child teardown, exact package metadata/help/readiness/ping/port-close surface, fake16, supplemental diagnostic, three strict schemas, and full Task15 artifact suites pass. The precommit gate creates no candidate/evidence/marker.

- [ ] **Step 8: Stage the closed world and obtain same-tree reviews**

Stage only the exact `task-16.json` union, compare staged names byte-for-byte with the manifest, run `git diff --cached --check`, record `git write-tree`, and obtain independent specification and quality reviews of that exact tree. Rerun the literal Step7 commands without changing the index, assert the same `git write-tree`, and commit the already-reviewed tree with the exact Task16 subject.

- [ ] **Step 9: Review Task16 quality and scope**

The spec reviewer verifies the source-only boundary and separate user-scoped real-Figma work. The quality reviewer checks one composition root, idempotent close, signal/EOF/platform behavior, bounded output/timeouts, exact package authority, fake determinism, diagnostic non-mutation, and three-file cross-validation. Any staged change restarts both reviews.

- [ ] **Step 10: Run the sole terminal source-complete command after the clean commit**

From the clean Task16 commit run exactly `pnpm -C service verify:source-complete`. Its frozen order is dependency restoration, full source/build checks through `verify:artifacts`, final Task16 artifact assembly/verification, PreviewCandidate creation, direct fake16 evidence creation, and marker reread/cross-validation. Assert the source-complete output-name set is exactly the three section3.13 filenames and rerun `source-complete-validator.mjs` against all three. Only this command supports source-complete status; Task15 `verify:artifacts` does not.

### Task 17 — External Windows validation placeholder

**Files:** none.

**Status:** `external-validation-not-in-scope`; excluded from source implementation dispatch and plan READY criteria.

This plan contains no Windows external-validation files, commands, or completion checkbox. Execution requires a separately scoped, reviewed, and explicitly approved supplemental plan. Until then this Task remains unstarted and makes no completion claim.

### Task 18 — External macOS validation placeholder

**Files:** none.

**Status:** `external-validation-not-in-scope`; excluded from source implementation dispatch and plan READY criteria.

This plan contains no macOS external-validation files, commands, or completion checkbox and cannot authorize external execution. A separately scoped, reviewed, and explicitly approved supplemental plan is required. Until then this Task remains unstarted and makes no completion claim.

---

## 8. v0.1 Definition of Done

### Source-complete Preview Boundary

- Tasks 1–16 complete the authorized implementation objective when all source, artifact, and typed-fake gates below pass.
- The truthful status is always `implementationStatus:'source-complete-preview'` and `externalValidationStatus:'not-run'` within this plan.
- This status may be reported as source implementation complete; it is not a public-availability or cross-OS real-Figma validation claim.

### Functional

- `service/` builds, tests, packs, and runs without `code-kb` imports or runtime reads.
- Baseline audit proves tools112, handlerAuthority105 plugin-handler/7 server-only, execution98 plugin-direct/14 exact server-adapters, and service registry0 before Task11.
- Final audit proves tools116, handler106/10, execution99/17, service2 exact and one internal system name identity.bootstrap outside all canonical counts, kinds23/13/80.
- Result/runtime/policy/egress/TargetRequirement maps cover116 with no fallback; handler parity and execution routing are independently asserted.
- Canonical manifest has 116 implemented rows; source ledgers have lexical114/helper20/parser12 with 11 unique parser behaviors and no unclassified row.
- Motion7 and video1 are present as experimental-native in registry, runtime, policies, docs, and artifacts.
- Selection/context/screenshot/component-token-icon grounding and typed writes pass unit/process/typed-fake checks; optional current-Windows diagnostic returns only typed non-destructive co-presence/connection results.
- Mutating final real-Figma validation is not a DoD gate here; it requires a separately approved supplemental plan with a dedicated validation folder and explicit user scope.
- `export_tokens`, ordered `export_frames_to_pdf`, `doctor`, and `import_library_variable` pass focused/process/source-fake capability tests.
- CLI includes strict authenticated status, workspace set-default, and locator-based grounding refresh plus prior wrappers.
- All tools and Task11 service2 enter one plane; followers consume only final Task6.1 plaintext stream facade; route classes cannot cross-call.
- Strict lower-snake tool and exact dotted service-name parsers feed one kind/name registry+journal; both service literals and invalid dot/slash/case/length/cross-kind fixtures pass. Requests produce native pre-admission rejection or accepted/progress/exactly-one-terminal with no Relay/runtime bypass.
- Task9A real plugin and Task15 packed plugin consume Task7 progress/cancel schemas; Task9C consumes strict bound approval prompt/decision with duplicate/reconnect/late cleanup and no control token. Task7 fakes alone are insufficient.
- Built daemon↔plugin approval E2E and packed ZIP consumer cover both branches/core cases. The packed identity.bootstrap flow proves initial no-fileKey unstable/read-only, reject runtime/undo0, approve one shared-data UUID write/one undo, forced authenticated rehello before Relay remap, and crash-unknown reconnect discovery with no rerun/control token; tool/service counts remain unchanged.
- Internal-system auth1 is daemon HMAC-bound to paired session+leader generation, owner actor unchanged; plugin/body cannot forge it and foreign/reconnect audit tests pass.
- Strict `OperationOriginV1` enforces top-level/origin auth equality and system iff `identity.bootstrap`. Append derives component hashes from admitted source values and matches admitted generations; restart validates component syntax/equalities and recomputes only the target-binding hash from stored hashes/generations. The raw-free guarantee applies to internal-system origin, while ordinary replay records may retain nonsecret workspace/file keys. Settled system operations remain non-replayable.
- SnapshotV1/GroundingGraphV1 use strict locator/full-identity/node/edge/evidence schemas, separate injected ports/refs/checksums/content hashes and atomic loadByLocator/CAS refresh; service2 remains exact and grounding refresh is selector-none locator-only.
- 10k graph isolated three-run memory gate is max heap delta128MiB and serialized32MiB.
- Snapshot/graph validate wire hash then digest path; design-diff additionally domain-hashes exact raw nodeId, embeds/reverifies raw ID+digest, rejects collision/traversal. Valid wire hashes succeed on Windows.
- Skills distinguish code AST scan from Figma component discovery and do not claim deterministic reverse compilation.

### Security and Reliability

- Bind is loopback only; strict Host/Origin/PNA/path/body/WS-frame gates pass.
- Allowed pair POST success and every typed error carry exact ACAO/ACAPN/Vary headers readable by plugin UI; hostile/absent Origin receives no allow headers or oracle body.
- Eight-digit one-time code, 128-bit one-use ticket, rotating resume, follower, and control tokens pass expiry/attempt/rate/rotation/replay tests.
- Final Task6.1 base/contract/path manifest is recorded; public facade has no active-session oracle, and Task7 imports only stream/public facades, never private outer/auth records.
- Task6.1 outer response records independently authenticate seq/final/truncated+ciphertext with exact 16+16 overhead, 4096 records, 64MiB plaintext/cipher and 67,239,936 complete cap; Task7 never parses them.
- One owner key derives one stable actor for MCP leader/follower/control. A 128-bit MCP session exists before role choice and its auth1 HMAC survives role transitions; control auth1 changes on rotation; no raw credential is an ID. Cancel requires origin auth session; owner-admin control may list/status/resolve across same-owner domains and records origin/resolver; foreign stateRoot fails.
- Unix owner modes and Windows current-user DACL are verified; insecure stateRoot startup fails closed.
- Workspace addResolved queues identity validation→nonce CAS→exact record atomically; every await swap leaves nonce/config/effects untouched, and later access revalidates root identity. Default/binding rules remain.
- Nonce caps/lifecycle remain; registration never reinterprets caller path after CAS.
- Null Origin alone never authenticates a plugin. Foreign product/2xx never becomes leader. Unknown role never forwards args.
- Body identity/context is rejected. Path args resolve metadata/realpath into PolicyInvocationContext before effects with no content/network/runtime. MCP synthesizes forbidden→none, required→active, optional→none only after strict args/TargetRequirement; ping and doctor false/undefined are none, doctor true active, with leader/follower connected/disconnected parity. Target/key derive from authenticated Relay, deep-freeze, no filename fallback/reroute.
- Dynamic effects distinguish data/URL, content/outPath, overwrite/create-new, read/write, library import, and experimental heavy operations.
- Destructive, filesystem-write/overwrite, network, library-import, and broad-write actions receive the required explicit approval. Inside-root filesystem reads follow workspace/sensitivity policy without being mislabeled as writes.
- Per-file queue serializes same file across sessions; different file identities can progress independently within read/heavy limits.
- Same `(actorId,operationId,kind,name,args,workspace,file)` applies once; mismatch conflicts. Cache holds canonical redacted semantic bytes, never entry framing; current auth and kind/name/mode/ID/class/policy fingerprint must match before each adapter reframes. Otherwise payload-free settled+audit; no reruntime.
- Operation IDs are server-issued/HMAC-bound to owner actor and issuedAt; age `>=2,592,000,000 ms` is expired, future skew `<=300,000 ms` allowed and above invalid, all runtime zero at rejection.
- Capacity→durable pending→approval→pre-egress reserve fsync→queue→dispatched fsync→first side effect→classification→egress finalizer fsync→terminal fsync→frame ordering and every crash boundary pass. Post-dispatch loss is unknown, never replay.
- Journal compacts active transitions at 8,000 rows/24 MiB, stops normal operation appends at 10,000 rows or 31 MiB, reserves the final exact 1 MiB of its 32 MiB active allocation for fsynced resolution intents, moves ordinary terminal records to a separate 1,000,000-entry/256 MiB tombstone index through each signed 30-day horizon, rejects older IDs from signed issuedAt after purge, and keeps status/resolution/purge routes available to unblock capacity/workspaces.
- Authenticated owner-local operation issue/list/status/resolve and CLI commands record actor/auth/confirmation/reason/evidence hashes without normal approval. A confirmed resolution is an authoritative reserved no-replay tombstone even when the ordinary tombstone index is full; resolved-applied/resolved-not-applied/abandoned release unresolved workspace/cap accounting, while reserve-full fails typed and leaves state unchanged.
- Approval binding strict union enforces plugin-session WS/non-null file key or owner-control auth session/null-capable target; wrong branch fields fail. grounding/CLI use control; plugin/bootstrap use WS. TTL/CAS/reconnect semantics and runtime0 predecision hold.
- Egress canonical hash excludes its own hash field. Every durable reservation finalizes once as output/no-output/unknown; capacity releases only after finalizer fsync. Restart/double/conflict/crash, truncated-tail/mid-corruption, raw-free tests pass.
- All section3.12 below/exact/above fixtures pass for horizons/skew/nonces/journal/egress/progress/pair/follower/control/MCP/WS/images/video/cache plus declared/chunked predecode runtime-zero and active operation/subscriber/raw-args admission.
- Admission limits include canonical session constants and reachable selector max115 (stable-file exact); no impossible256 selector fixture. Other owner/session/subscriber/raw/snapshot/graph bounds remain.
- Bounded demotion is single-flight/awaited: 5,000 ms absolute, 1,000 ms drain, generation fence and durable unknown/finalizers before destroy/port release; durability failure retains port.
- URL import validates approval, HTTPS, every DNS/redirect hop, address ranges, domain, MIME/signature, and streamed size in the daemon. Plugin external URL fetch and wildcard permission are absent.
- URL connections are pinned to the vetted IP with original Host/SNI/certificate verification and secureConnect remoteAddress check; every redirect re-resolves. The default allowlist is empty and v0.1 accepts exact three-or-more-label ASCII FQDN equality only—no wildcard, suffix/subdomain rule, apex two-label host, or PSL dependency.
- The plugin top-level dispatcher is the sole `commitUndo` caller. A changed document write/batch/library import/system UUID creates one boundary; handlers, read, navigation/figma-ui, no-op, and failure create none.
- Exact mutation contracts cover baseline 79 and final 80 write-kind handlers; every mutation handler returns `{value,mutated}`, wire output exposes only value, and production handler files contain zero commitUndo calls.
- Legacy node-only baselines are never silently read/migrated; typed unsupported guidance requires recapture and no CLI migration claim exists.
- Raw evaluator and non-loopback code paths are absent from source and local packaged artifacts.

### Quality and Source-complete Preview

- Frozen install, typecheck, lint, format check, knip, build, unit, integration, process E2E, artifact, and docs-sync tests pass on Ubuntu and Windows CI.
- Edited upstream paths become protected strict edit/move/delete service-fork lineages before copy-only; exact exclude/serviceOwned/A-M/D/D+A/hash/no-blob rules and no-overwrite verification pass, while only byte-unchanged rows retain vendor mode. serviceFiles/packageAuthorities refresh by subtype.
- Fork lineage originCommit/base/mode matches the prior row; election.ts/77 handlers, repo-walk moves and deleted paths cannot be overwritten/recreated by generator.
- Built-dist E2E cannot silently skip in CI or preview verification.
- Ordinary artifact exclusions live in Vitest config; Task15's separate artifact config starts with exact two post-package tests and Task16 atomically extends it to the exact three-row final tuple including daemon surface. Windows cmd script process test passes with no POSIX quotes.
- Task15 `verify:artifacts` packages and verifies artifacts only and cannot support source-complete status. After the clean Task16 commit, the one terminal `verify:source-complete` runs frozen dependency restoration/full tests/build/artifacts, writes exactly candidate/evidence/marker, and reread validates the three fixed ignored files and every cross-field hash.
- MCP bundle contains shared+IR and CLI bundle contains shared; packed manifests have no workspace/private runtime dependency, and each tarball is checked alone in an empty prefix/cache and runs its packed bin/tool smoke.
- Plugin ZIP has exact isolated manifest/dist/legal/capability paths, deterministic hash/timestamps and unpacked VM+happy-dom consumer execution; source tests cannot substitute.
- Three unsigned local schemas cover PreviewCandidate, SourceCompleteEvidence and SourceCompletePreview; all outputs are fixed-name, ignored and hash-validated.
- Packed `daemon-entry.mjs` shares the application factory; named package/tsdown/artifact authorities agree on `dist/daemon-entry.mjs`, `./daemon`, and `sfp-daemon`. Help/readiness output and timeouts are exact, stdin EOF is ignored, application close is idempotent, POSIX signal and Windows retained-child teardown rules pass, and the port closes. Current-Windows co-presence/`PLUGIN_NOT_CONNECTED` output is supplemental and nonbinding.
- Three upstream MIT notices, service license, pdf-lib notice, THIRD_PARTY_NOTICES, PROVENANCE, SBOM, and capability ledgers are present in every applicable artifact.
- Solar CC BY assets and raw exec symbols are absent.
- Offline upstream verification passes without original checkouts; parent-workspace verification confirms all three original repos remain clean at pinned commits.
- Service CI uses frozen dependency restoration, least permissions, and immutable action digests; no upload/publish workflow exists.

### Documentation and Policy

- README/capability matrix state Desktop editable Design v0.1, Dev read-only, FigJam partial, Web/public deferred, and no view-only bypass.
- Build-vs-buy documents official `use_figma`, `generate_figma_design`, design-system search/assets, permissions/current limitations, checked URLs/date, and separate MCP/REST limit authorities without fixed rate numbers.
- Docs say REST/official MCP endpoints are not used by the local path while Figma account/edit/plugin/policy and model-provider costs remain.
- Docs cover final Task6.1 outer/inner facade, authenticated control status/router, actor/auth/policy/target/runtime, service2 graph refresh, journal/finalizer/demotion/limits, real plugin consumer, legacy recapture and prior boundaries.

### External Validation Status

- `externalValidationStatus:'not-run'` is expected and truthful.
- Tasks17–18 are excluded placeholders. This plan contains no authority to sign, bundle, upload, publish, or claim external validation completion.

---

## 9. Post-v0.1 Phases

### v0.2 — Figma→React Legacy Code MVP

- React with Tailwind/CSS Modules, AST-aware isolated source diff, build/test/render/visual verification, quantitative grounding metrics, no automatic merge.

### v0.3 — Code→Figma Semantic Foundation

- Code token/style/asset adapters first, React component instance/property mapping second, staging page+durable saga+post-read, layout/screens after semantic round trip stabilizes.

### v0.4 — Three-way Sync

- Git tree+Figma snapshot baseline, high-confidence text/token/rename merge, manual structure/layout/interaction conflicts, team mapping migration.

### v0.5 — Distribution and Optional Native Components

- Explicit artifact exchange, official connector fallback, private/Web only after policy/browser acceptance, Rust launcher/export worker only after measured TypeScript performance/fidelity need.

---

## 10. Plan Review Resolution Ledger

Decision vocabulary: **accepted** means the plan now contains the requested contract/task/gate. **Partially accepted** means the technical concern is addressed with a different organization and the reason is stated. Critical and Important findings from all three reviews are listed one-for-one.

### Agent A

| Finding | Decision | Resolution |
|---|---|---|
| A-IP-C01 | accepted | Task 9 stays at 112/105/7; Task 12 atomically adds four ToolSpecs, one handler, permission, policies, runtimes, and reaches 116/106/10. |
| A-IP-C02 | accepted/strengthened | Task6 produces auth/opaque transport only; Task7 creates `/control/tools/call` through OperationInvocationService and keeps service/admin seams distinct. |
| A-IP-C03 | accepted | pdf-lib 1.17.1, `pdf-merge.ts`, ordered copy algorithm, corrupt/encrypted/mixed/order/no-overwrite tests are binding. |
| A-IP-C04 | accepted/strengthened | Section3.3 now preserves PolicyInvocationContext and defines RuntimeExecutionScope, stable actor/origin auth, target, kind/name journal, and exact idempotency fingerprint. |
| A-IP-I01 | accepted | Former first task is split into runnable Task 1 harness and Task 2 vendor/parity; RED reaches intended missing registry. |
| A-IP-I02 | accepted/strengthened | T11→T12 sequential for service2 and shared authority trees. |
| A-IP-I03 | accepted | Task 8 moves URL fetch into daemon RemoteImageFetcher and Task 9 removes plugin URL branch/wildcard. |
| A-IP-I04 | accepted | Task 4 creates state-backed workspace add/list/remove authority; Task 13 exposes authenticated workspace commands. |
| A-IP-I05 | accepted | IR explicitly depends on shared; Task 11 defines pinned section plan assembly, fidelity fields, progress/cancel, and 10k-node memory test. |
| A-IP-I06 | accepted | fileKey fallback is a persisted document plugin-data UUID with approval/undo; unstable read-only identity cannot persist snapshot/diff. |
| A-IP-I07 | accepted | Human code is exactly eight digits; internal ticket is 128-bit; endpoints, PNA, expiry/attempt/rate, resume rotation, and Windows DACL are explicit. |
| A-IP-I08 | accepted | Journal lives under owner-only stateRoot, includes actor/workspace/file/policy/approval/hash fields, conflict/recovery/compaction/cap behavior. |
| A-IP-I09 | accepted | Shared egress taxonomy/config and progress contract are wired through executor, snapshot, PDF/video, relay/MCP/CLI, cancel, and absolute deadline. |
| A-IP-I10 | accepted | Task 13 implements approvals list/approve/reject; Task 9 defines commitUndo once per top-level write/batch and zero for other outcomes. |
| A-IP-I11 | accepted | Manifest separates disposition/registration/availability/investment; Motion7+video are experimental-native advertised/implemented. |
| A-IP-I12 | superseded by R15 | Task16 truthfully marks unsigned source-complete with external validation not run; Tasks17/18 are non-dispatchable placeholders. |
| A-IP-I13 | accepted | Every Task contains independent spec review and independent quality review before an exact commit step. |

### Agent B

| Finding | Decision | Resolution |
|---|---|---|
| B-C-01 | partially accepted | The parent requested one directly executable plan, so five separate documents were not created. The same concern is addressed by 18 smaller Tasks, five milestone checkpoints, exact Interfaces, code/test snippets, commands, two reviews, and commits. |
| B-C-02 | accepted | Task1 bootstraps the runner before domain RED; each later RED names the concrete missing module or current buggy behavior; the test skeleton precedes the unavailable-system RED. |
| B-C-03 | accepted | Section 3.2 and Task 5 use `effectsFor(args,context)`, dynamic idempotency/approval, and conservative static annotations. |
| B-C-04 | accepted | Explicit pdf-lib dependency and Task 12 ordered merge implementation remove the impossible GREEN. |
| B-C-05 | accepted | Section 3.4 and Task 4 separate owner-only stateRoot from workspaceRoots; Figma-only/no-workspace and filesystem-required rules are explicit. |
| B-I-01 | accepted | DAG orders RuntimePaths→policy→auth→executor→fs/network→plugin and places control tool call with executor. |
| B-I-02 | superseded by R14 | Task1 hygiene and Task15 source CI/package maps/frozen dependency restoration/artifacts remain; no distribution template exists. |
| B-I-03 | accepted | Section 3.5 defines challenge/exchange/hello/resume, PNA, owner storage, rotation, and eight-digit→128-bit sequence. |
| B-I-04 | accepted | Task 8 routes each descendant read and write through adapters and structurally rejects direct fs imports outside explicit authorities. |
| B-I-05 | accepted | Task 11 specifies full section capture/merge, partial fidelity, same-session pin, memory/progress/cancel tests. |
| B-I-06 | accepted | Task 14 creates `docs/build-vs-buy.md` and docs-sync tests for official write, code-to-canvas, search/assets, date/URLs, no numeric constants. |
| B-I-07 | superseded by R13 | Task9 commitUndo remains; Tasks17/18 are non-dispatchable placeholders. |
| B-I-08 | accepted | Canonical116 and source114/20/12 are separate; common rows carry sourceContracts plus target hash; Motion/video are experimental-native. |
| B-I-09 | accepted | EgressMode is explicit persisted config with unknown fail-closed; it is never inferred from stdio/MCP source. |
| B-I-10 | partially accepted | The single approved plan is retained, but 18 review-sized Tasks and immutable milestone outputs replace the former 12 oversized units. |

### Agent C

| Finding | Decision | Resolution |
|---|---|---|
| C-01 | accepted | Safe-union ToolSpec/handler/permission transition is atomic in Task 12; pre/post exact counts are hard gates. |
| C-02 | accepted | PDF engine, source path, dependency, algorithm, progress, output policy, fixtures, SBOM/license are explicit. |
| C-03 | accepted | UnionManifestV1 has canonicalTools and separate sourceSurfaces; cardinalities and experimental-native override are exact. |
| C-04 | accepted | FileExecutionKey derives from stable file identity and same-file different-session serialization is tested. |
| C-05 | accepted | RemoteImageFetcher performs approval/HTTPS/DNS/redirect/IP/MIME/sniff/size checks; plugin receives bytes only. |
| I-01 | accepted | Ticket/resume hello, rotation, plugin generation, stateRoot control/follower credentials, Windows ACL and tests are defined. |
| I-02 | accepted/strengthened | DAG removes reverse dependencies; R5 intentionally sequences Task11→12 for service registry and closed-world tree ownership. |
| I-03 | accepted | Dynamic effects/approval and overwrite resolution distinguish conditional side effects while MCP annotations remain conservative. |
| I-04 | accepted | Journal records full audit context; same-ID mismatch, startup unknown transition, hard cap, truncated-tail and compaction tests are included. |
| I-05 | accepted | Task 3 establishes strict result schemas and Task 7 fixes execution order before result hashes/egress. |
| I-06 | accepted/strengthened | Maps112→116; handler/execution separate; snapshot/grounding are service2 outside MCP. |
| I-07 | accepted | Motion/video remain registered and Task 12 wires heavy budget, progress, absolute deadline, cancel, payload limits, and Task 17/18 checks. |
| I-08 | accepted | Exact vendor rules/map, per-file hashes, offline/with-upstreams modes, namespace scope, and hygiene are specified. |
| I-09 | accepted | Task 13 defines command mapping/options/policy/output/exit and explicitly chooses active-daemon companion behavior instead of hidden spawn. |
| I-10 | superseded by R14 | Task15 defines the artifact matrix, SBOM, notices, provenance, checksums and local verification. |
| I-11 | superseded by R13 | Task16 now ends at unsigned local source-complete evidence; Tasks17/18 are external placeholders. |

### Round 2 resolutions — Agent A rereview

| Finding | Decision | Round 2 resolution |
|---|---|---|
| A-IP-I04 | accepted | Task 7 now produces authenticated GET/POST/DELETE `/control/workspaces*` routes and JournalWorkspaceUsageGuard; Task 13 maps exact CLI calls. |
| A-IP-I09 | accepted | `RESULT_EGRESS_POLICIES` covers baseline112/final116 with exact classifyInput/classifyResult and possible result classes; Task 7 persists pre-execution consent after approval and returns runtime count zero for disallowed classes, then post-classifies output. |
| A-IP-I10 | accepted | Plugin top-level dispatcher is the only commitUndo call site; handlers including library import never commit; navigate_to_page is figma-ui, and exact changed/no-op/navigation/batch/library tests cover all kind-write rows. |
| AR-IP-N01 | accepted | PreExecutionConsentManifest and OutputEgressManifest are distinct; consentId nullability matches local-trusted; input/result class coverage and destructive/image/code runtime-zero tests are binding. |
| AR-IP-N02 | accepted | Workspace producer files, routes, control-auth actor derivation, action nonce, realpath/unsettled tests, and CLI mappings are explicit. |
| AR-IP-N03 | accepted | Undo owner/effect conflict is resolved by Runtime policy plus PluginHandlerOutcome and dispatcher-only structural gate. |
| AR-IP-N04 | accepted | No raw durable result is stored; exact persisted success returns OPERATION_ALREADY_SETTLED with sanitized hash/status and never executes, while generation transitions and mismatch conflicts are exact. |
| AR-IP-N05 | accepted | HTTPS requests use vetted-IP custom lookup with original Host/SNI/certificate check and remoteAddress verification per redirect; empty-default domain lifecycle has authenticated control/CLI. |

### Round 2 resolutions — Agent B rereview

| Finding | Decision | Round 2 resolution |
|---|---|---|
| B-I-01 | accepted | WorkspaceUsageGuard is defined/injected in Task 4 with a fake and implemented by Task 7 journal; Task 11 explicitly consumes Task 8 WorkspacePolicy/AtomicFileStore without reverse imports. |
| B-I-03 | accepted | challengeId is a public ten-character Pair ID shown with code/paste form; literal PNA OPTIONS request/response/Vary and negative matrix plus exact Windows SID/icacls argv are specified. |
| B-I-04 | accepted | IR defines a storage port only and imports no fs; MCP workspace snapshot store uses Task 8 adapters and structural tests enforce it. |
| B-I-05 | accepted | Nested section plans use bounded stable DFS, `(pluginGeneration,nodeId)` visited keys, depth8/section256 caps, recursion fidelity, cycle tests, and concurrency2. |
| B-I-07 | superseded by R13 | Undo and packed-artifact checks remain; external proof generation is outside this plan. |
| B-I-08 | accepted/strengthened | Source/target hashes, handler106/10, execution99/17, maps116, service2 separate. |
| B-I-10 | superseded by R13 | One parent source plan remains; Tasks17/18 numbering is retained only as external placeholders. |
| N-C-01 | accepted | Vendor rules copy only source/test/skills/build files; root/package/lock/config are merge/reference authorities, Task 1 files are hash-protected, upstream postinstall is dropped, and service lock is regenerated/frozen. |
| N-C-02 | accepted | Runtime import/dependency specifiers are AST-checked; raw @figwright protocol/comment/user/provenance strings use an exact allowlist; production code-kb search remains zero. |
| N-C-03 | accepted | Succeeded old-generation records never execute; queued/pending fail, dispatched becomes unknown, in-memory exact replay is bounded, persisted exact success returns settled status, mismatch remains conflict. |
| N-I-01 | accepted | JournalLimits fixes 8k/24MiB compaction, 10k rows or 31MiB normal hard cap plus a dedicated 1MiB resolution reserve, horizon tombstones, signed-ID expiry, unresolved retention, manual resolution, and exact fail-closed/unblock behavior. |
| N-I-02 | accepted/strengthened | Task7 owns daemon schemas/fake transport, Task9A real plugin consumer, Task11 snapshot service producer, Task12 PDF/video producer, Task13 client. |
| N-I-03 | superseded by R15 | Packed local artifact validation remains in Tasks15–16; external execution stays outside this plan. |

### Round 3 resolutions — Agent A rereview 2

| Finding | Decision | Round 3 resolution |
|---|---|---|
| AR2-IP-N01 | accepted | OperationStatus adds resolved-applied/resolved-not-applied/abandoned; signed operation IDs, tombstones, resolution audit, authenticated issue/list/status/resolve routes, CLI commands, workspace/cap unblock, and no-replay tests are exact. |
| AR2-IP-N02 | accepted via v0.1 scope reduction | Suffix/subdomain rules are removed rather than adding PSL scope. v0.1 accepts exact three-or-more-label ASCII FQDN equality only and syntactically rejects one/two-label suffix-like, wildcard, leading/trailing-dot, path/port/IP entries; no semantic PSL claim/dependency remains. |

### Round 3 resolutions — Agent B rereview 2

| Finding | Decision | Round 3 resolution |
|---|---|---|
| B-I-03 | accepted | Section 3.5 and Task 6 now bind actual POST success plus every typed 4xx/5xx ACAO/ACAPN/Vary response for allowed Origins, hostile/absent no-allow responses, and Task 9 UI fetch integration. |
| B-I-04 | accepted | Task 11 IR declares SnapshotV1 and exact SnapshotStoragePort methods/key/ref together, then its MCP adapter consumes Task 8 WorkspacePolicy/AtomicFileStore; shared has no IR import. |
| B-I-05 | accepted | Fidelity has structured expanded/complete-leaf/issues with path/order/depth/status; nested cycle fixture marks only a1/b complete and depth8/section256 caps have exact tests. |
| B-I-07 | superseded wording by R14 | Task9 mutation rules and Task15 bundled-workspace/isolated tarball smoke remain exact. |
| B-I-10 | superseded by R13 | Source-task slices remain; Tasks17/18 numbering remains as non-dispatchable placeholders. |
| N-C-03 | accepted | Server-issued HMAC operation IDs carry issuedAt/keyId/nonce/actor; terminal rows compact to 30-day tombstones and expired signed IDs always return OPERATION_ID_EXPIRED/runtime0 after purge. |
| N-I-01 | accepted | Unknown-resolution states/API/CLI/audit are implemented in the plan; hard-cap keeps resolution available, resolved rows unblock workspace/cap, and same ID remains settled. |
| N-I-03 | accepted | MCP always-bundles shared+IR and CLI shared; packed manifests have no private/workspace runtime dependency; Task15 checks each tarball alone in empty prefixes/caches and runs packed tools. |
| R2-C-01 | accepted | Exact POST pair CORS matrix and process/UI tests make success/wrong/expired/used/rate/internal responses readable only to validated Figma/null Origins. |
| R2-C-02 | accepted/strengthened by R7 | Task9 mutation authority covers 78 non-batch tool rows over 77 unique paths plus batch, changed/no-op fixtures for all79, internal metadata stripping, final library row80, and sole dispatcher commit site. |
| R2-C-03 | accepted | Exactly-once is explicitly 30 days; signed issuedAt rejects older IDs forever, in-horizon terminal tombstones prevent reexecution, and generation transitions remain deterministic. |
| R2-C-04 | accepted | tsdown internal bundle closure, packed-manifest checks, fresh-cache one-tarball installs, npm ls, MCP116 list-tools, CLI bin smoke, and workspace-path zero gate are Task 15 requirements. |
| R2-I-01 | accepted/strengthened by R7 | IR still owns SnapshotStoragePort with no reverse dependency; R7 replaces the unsafe wire-hash path segment with verified digest-only locator namespaces and loadByLocator. |
| R2-I-02 | accepted | Recursive fidelity schema/fixtures now distinguish expanded plan nodes, complete leaves, and failed/cycle/depth/cap issues with stable planPath/order/depth. |
| R2-I-03 | accepted | Authenticated operation issue/list/status and owner-local confirm-string resolution/CLI commands use reason/evidence hashes plus the reserved resolution intent, never require normal approval or authorize replay, and recover hard-cap/workspace availability. |
| R2-I-04 | accepted via v0.1 scope reduction | includeSubdomains/suffix matching is deleted. Strict exact-host syntax deliberately excludes apex one/two-label and wildcard/dotted suffix forms; exact equality never grants subdomains, so no semantic PSL authority is needed or claimed. |

### Round 4 resolutions — Agent A/B final rereviews and child spot-check

| Finding | Decision | Round 4 resolution |
|---|---|---|
| AR3-IP-N01 | accepted | Every conflict/settled/generation/cap RED now uses `OperationIdIssuer.issue(actorId, issuedAt)`; unsigned literals remain only in explicit invalid/forged tests, and a structural fixture gate prevents regression. |
| AR3-IP-N02 | accepted | Shared and Task 4 contain no snapshot-storage type or IR import. Task 11 IR owns `SnapshotV1` plus the typed port; its MCP adapter consumes Task 8 WorkspacePolicy/AtomicFileStore, removing the package/DAG cycle. |
| AR3-IP-N03 | accepted | Resolution no longer depends on normal approval/OperationRecord. Owner-local control plus nonce and exact ID/result confirmation uses a dedicated 1 MiB fsynced reserve, immediately compacts one unknown row, and has reserve-full/manual-export tests. No bulk route exists. |
| B-I-04 | accepted | Snapshot type/port ownership is wholly in Task 11 IR; Task 4 has a no-future-IR structural test and Task 11 alone creates the filesystem adapter from Task 8 primitives. |
| B-I-10 | accepted | Tasks 2/7/9/12 now contain numbered subtask RED, GREEN, independent reviews, exact git-add/commit commands, clean handoff verification, and explicit no-squash/no-aggregate rules—not tables alone. |
| N-C-03 | accepted | All core Task 7 idempotency fixtures carry valid signed IDs and seeded claims; invalid/expired cases are separate and verification remains before idempotency/cap lookup. |
| N-I-01 | accepted | Normal operation data stops at 31 MiB of 32 MiB and one exact MiB is reserved for resolution intent. The record is an authoritative tombstone even when the ordinary index is full and typed reserve-full leaves state unchanged. |
| R2-C-03 | accepted | The 30-day signed-ID/tombstone model is now exercised only with issuer-generated tokens across conflict, restart, generation, capacity, resolution, and expiry tests. |
| R2-I-01 | accepted | `SnapshotStoragePort` and `SnapshotV1` share one IR owner; key/ref include workspace, file identity/hash, snapshot ID, checksum, path, bytes, and fidelity, with separate design-diff namespace. |
| R2-I-03 | accepted | Single-ID owner-local resolution has exact confirm syntax, CLI command, reserve persistence/fsync, immediate compaction, no-replay, normal-cap recovery, tombstone-full behavior, and reserve-full negative tests. |
| R3-C-01 | accepted | The former shared→future-IR reference is removed from Files, Interfaces, dependency text, tests, and service map; a package import-direction RED locks the new graph. |
| R3-C-02 | accepted | Literal `op-1/new-op` fixtures are replaced by valid issuer output and structural verification disallows future unsigned supplied-ID fixtures. |
| R3-I-01 | accepted | A resolution record can remain in the dedicated reserve as the authoritative tombstone when the normal tombstone index is full; reserved capacity and full-reserve failure are both tested. |
| R3-I-02 | superseded name by R14 | Task15 packaging remains deterministic under `verify:artifacts`; Task16 owns `verify:source-complete`. |
| R4-SPOT-N01 | accepted | Reserved resolution records copy the full issuedAt/tool/args/workspace/file/result fingerprint before fsync, preserving exact settled versus mismatch-conflict behavior after active-row compaction. |
| R4-SPOT-N02 | accepted | MCP/CLI are packed from staged package roots whose `files` arrays and in-root copies include every license/notice/provenance/SBOM/capability authority required by artifact tests; no parent-path npm files assumption remains. |
| R4-SPOT-N03 | accepted | Task 15 RED uses a runnable test-only baseline artifact assembler, so content assertions fail on missing authorities rather than missing future production scripts; the umbrella producer remains the GREEN implementation. |
| R4-SPOT-N04 | accepted | Task 12 updates and stages the mutation-contract test/fixture ledger; final80 is exact baseline79 union `import_library_variable`, not merely a length assertion. |

### 2026-08-28 Task 7 preflight amendment and ruling

Historical ruling updated by the final handoff below: Tasks1–5 evidence remains valid; prior Task6 handoff evidence is superseded only by reviewer-approved Task6.1 base `39a29373b91445e9242e82611f0a8a04fca525ea`. Original plan SHA `5EAFC23397F4A7DD147263ABAB6AF258AABB4207FCE5ED33EE428C13D15B826A`, the first amended checksum, and the later `bc0cb93` checksum are superseded for Task7 onward. Executors use only the new committed checksum after fresh rereview READY.

| Finding | Decision | Amendment resolution |
|---|---|---|
| T7-PF-C01 | accepted | One leader-generation `ExecutionPlane` owns invocation lifecycle. Followers construct only `FollowerInvocationClient`; unknown/conflicted roles forward no args; demotion closes admission, aborts queued/pending, durably marks nonterminal dispatched unknown, fsyncs/drains/destroys. |
| T7-PF-C02 | superseded/strengthened below | Strict request/body boundary remains, but all paths now share one owner actor while domain-separated auth sessions carry origin/cancel authority. |
| T7-PF-C03 | accepted | Active/session/stable-file/none are lookup selectors only. Final target and `FileExecutionKey` derive from authenticated Relay `FileIdentity`, freeze for the invocation, never use fileName, and fail `PINNED_SESSION_LOST` instead of rerouting. |
| T7-PF-C04 | accepted | Action nonce is `sfp_an1_`+256-bit base64url, actor/generation/action/requestHash-bound, 120-second, CAS one-use after semantic validation, capped at 1,024 rows/512 KiB per actor with no live eviction, and invalidated by restart/generation. |
| T7-PF-C05 | superseded/strengthened below | Pre reservation now requires exactly-one durable output/no-output/unknown finalizer before capacity release, with canonical self-hash exclusion. |
| T7-PF-C06 | superseded/strengthened below | Task6 outer transport is opaque; Task7 owns inner/daemon/fake schemas; actual plugin consumer moves to Task9A. |
| T7-PF-I01 | superseded/strengthened below | Ownership remains but now includes policy/runtime/service seams and downstream authority rules through Task16. |
| T7-PF-I02 | accepted | 7A/7B/7C retain the already reviewed exact commit subjects while strengthening boundaries. Each slice is RED→GREEN→closed-world authority→exact staged tree→independent spec+quality reviews→same-tree rerun→exact commit; there is no six-module cap or aggregate fourth commit. |
| T7-PF-I03 | accepted | `vendor-rules.json`, `vendor-map.json`, and `upstream-lock.json` are updated and verified in every slice so new/modified managed files cannot escape the Task 2 closed-world authority. |

### 2026-08-28 final Task6.1 freeze and superseded Review A/B/C resolution

Commit `bc0cb93c0d8aa84167cea718c0b429a22d3c271d` and plan SHA `fc57e5a896aa8687e0188c66248012c14517f9044380df019cc072616c9d2ea7` received fresh NOT READY rereviews and are superseded for Task7 onward. The R5 actor/policy/journal/egress findings remain incorporated, and this R6 amendment resolves the new non-Task6 findings. Task6.1 is reviewer-approved at base `39a29373b91445e9242e82611f0a8a04fca525ea`; its exact eight-path, 925-byte contract manifest hashes to `bd296dabe872f08adca793d93a2cd6a2c7efca60c58127b07924b2f18840b27b`. Tasks1–5 evidence is preserved; the prior Task6 handoff is replaced by this frozen Task6.1 evidence. The newly checksummed plan and fresh plan rereviews, not any unresolved Task6.1 value, are the remaining Task7 gate.

| Deduplicated finding | Review source | Final author resolution in this amendment |
|---|---|---|
| R5-C1 public ping | Review A critical; B/C comparison confirmed | Frozen `PublicPingV1Schema` is the exact seven-field public identity at the section 3.5 base/contract; active session and all other oracles are absent. |
| R5-C2 actor/admin domains | Review A critical; B/C comparison confirmed | One stateRoot owner actor for all paths; MCP/control auth1 derivation, role/rotation behavior, origin cancel, admin resolution, audit and foreign-root tests are exact. |
| R5-I1 policy context/order | Reviews A/B/C deduplicated | Preserve distinct Task5 PolicyInvocationContext/resolvedPaths; resolve declared paths metadata-only before effects, then target requirement/frozen runtime scope. |
| R5-I2 runtime authority | Reviews A/B/C deduplicated | Split handlerAuthority105/7→106/10 from execution98/14→99/17 with exact adapter names and PinnedPluginRuntimePort only. |
| R5-I3 target requirement | Reviews A/B/C deduplicated | Exact forbidden/optional/required matrix and typed none/selected errors for baseline/final tools. |
| R5-I4 journal order | Reviews A/B/C deduplicated | Pending/dispatched/egress/terminal fsync order, first-side-effect barrier, generation terminal CAS and every-arrow crash tests. |
| R5-I5 egress finalizer | Reviews A/B/C deduplicated | Every reservation finalizes output/no-output/unknown exactly once; capacity releases only after fsync; restart/double/conflict/crash tests. |
| R5-I6 bounded demotion | Reviews A/B/C deduplicated | election.ts single-flight prepare/finalize, 5,000 ms absolute/1,000 ms drain, durability-before-port-release and retained-port failure. |
| R5-I7 opaque Task6 transport | Reviews A/B/C deduplicated | Frozen Task6.1 stream facade supplies authenticated ordered plaintext only; Task7 cannot import/stage byte-frozen private/core paths. Legacy follower stays byte-identical; only 7C's exact leader-endpoint inner-handler adapter exception is reviewed against the full frozen suite. |
| R5-I8 real plugin consumer | Reviews A/B/C deduplicated | Task7 daemon/fake only; exact Task9A bridge/code/panel/UI consumer/tests; Task15 packed parity. |
| R5-I9 service operation seam | Reviews A/B/C deduplicated | R6 extends Task11 to service2 snapshot.capture+grounding.refresh outside116 with strict storage/router/CLI contracts. |
| R5-I10 downstream authority | Reviews A/B/C deduplicated | Superseded/extended by R12: Section6.2 applies authority trio and same-tree reviews to every 7A–16 subcommit. |
| R5-I11 wire/admission bounds | Reviews A/B/C deduplicated | Opaque outer vs exact inner/control/MCP/response/plugin caps; pre-allocation rejection, active/raw/subscriber caps and exact-one terminal admission model. |
| R5-I12 inclusive fixtures | Review C value audit; A/B comparison confirmed | Section3.12 is the single table-driven below/exact/above authority for every supplied numeric value and declared/chunked/runtime-zero path. |
| R5-M1 exact rerun | Review A/B quality finding; C confirmed | 7B_GREEN_COMMANDS lists exact paths and full security/typecheck/authority commands and is rerun verbatim on the reviewed tree. |
| R5-M1 canonical hashes | Review A/B/C minor comparison | Auth session is HMAC not credential; manifest/record self-hash fields omitted; path action hash uses exact resolved bytes with no Unicode normalization alias. |

### R6 fresh rereview resolutions and frozen handoff

| Finding cluster | Resolution |
|---|---|
| R6 current-type migration | 7A starts from checked-in Task5 InvocationContext and Task3 RuntimeExecutionContext/RuntimeBinding.authority; result-validation is in files/allowlist/GREEN. |
| R6 fixture correctness | design_diff uses real rootDir; export_pdf tests outPath overwrite; nonce hashes Task4 realPath with actor1 and raw/Unicode/action/realpath negatives. |
| R6 admission boundaries | Explicit rows cover owner/session/subscriber/raw/string caps; per-op raw is reachable8MiB; sparse capacity seams vs real transport streams are separated. |
| R6 exact subcommit trees | Superseded/extended by R12: staged change-manifest schema/verifier byte-compares every 7A–16 slice; Task8 is true8A/8B with repo-walk deletions/moves; R7 strengthens 9B to exact78 rows/77 unique paths. |
| R6 router/status | Task7 owns strict frozen control router and authenticated status; Task8/11 register reachable routes through exact registry/index paths; CLI maps status. |
| R6 plugin integration | 9A names App/main/style/useRelaySession/PanelTabs/tabs plus mounted lifecycle test and legacy-client gate. |
| R6 snapshot/grounding | Strict snapshot/refresh schemas, GraphStoragePort/path/hash/CAS refresh, service2, CLI result and IR dependency lock/frozen-install gates. |
| R6 legacy baseline | Unimplemented migration promise removed; typed unsupported/manual recapture, no CLI command. |
| R6 plugin artifact | Task15 exact isolated plugin root, deterministic archive and unpacked built-consumer execution gate. |
| R6 evidence validator | Superseded by R14: Ajv validates three unsigned source-complete schemas only. |
| R6 brief lifecycle | Exact task-7 brief path regenerates only after this plan's final checksum and fresh READY rereviews. |
| R6 Task6.1 freeze | Base `39a29373b91445e9242e82611f0a8a04fca525ea`, contract `bd296dabe872f08adca793d93a2cd6a2c7efca60c58127b07924b2f18840b27b`, six byte-frozen core paths plus two semantic adapter baselines, per-blob hashes, 925 manifest bytes, derivation algorithm, literal `/control` seam, adapter before/after review rule, and exact frozen GREEN block are final; `bc0cb93` remains superseded. |

### 2026-08-28 R7 final-review amendment

Commit `bb433f3a84557e34331691c8dde01901e95dd2ca` and plan SHA `9326a80b4f3bfc37de2db6d37caedc004d41ec7abc8685934c16eab5fd6ac238` received final NOT READY reviews and are superseded for Task7 onward. Completed Tasks1–5 and the reviewer-approved Task6.1 base/contract remain valid and byte-identical; R7 changes only the binding plan for Task7 onward.

| R7 finding | Resolution |
|---|---|
| C1 operation names | Separate strict lower-snake ToolNameSchema and exact dotted ServiceOperationNameSchema feed the same kind-aware registry/idempotency/journal; both positives and dot/slash/case/length/cross-kind negatives are exact. |
| C2 MCP selector | Post-args TargetRequirement synthesis is forbidden→none, required→active, optional→none; ping/doctor matrix, leader/follower, connected/disconnected and anti-override tests are owned by 7A/12. |
| I1 session selector | Frozen Base64Url128Schema replaces 1–128 ASCII; exact22 and generated underscore fixture are binding. |
| I2 paired approval | Shared versioned prompt/decision, redacted daemon broker, server binding+120s CAS, reconnect/duplicate/late rules, no plugin control token, Task7 fake and Task9C real consumer are exact. |
| I3 grounding locator | Server-issued path-safe snapshot ID and SnapshotLocator drive loadByLocator identity/workspace/hash/id checks and selector-none refresh. |
| I4 replay egress | R8 strengthens cache to transport-neutral canonical redacted result bytes plus kind/name-aware consent fingerprint; adapters reframe only after current auth/fingerprint/schema validation. |
| I5 MCP workspace | Versioned defaultWorkspaceId/store APIs and McpWorkspaceBinding implement explicit default/sole-root/typed zero-or-multiple behavior for filesystem-required leader/follower calls while Figma-only remains null; CLI set-default is exact. |
| I6 Windows hashes | API hashes retain `sha256:`; storage extracts verified 64hex digest for snapshot/graph/design-diff paths and rejects colon/drive/UNC/ADS/traversal. |
| I7 local artifact order | Exact artifact suites run only inside Task15 `verify:artifacts`; Task16 consumes that gate later. |
| I8 skew migration | `packages/mcp/test/tools/skew-notice.test.ts` is in Task7 Files, 7A allowlist, literal GREEN, migration and review. |
| I9 literal 7A GREEN | Full copy/paste 7A_GREEN_COMMANDS names focused/frozen/security/election/e2e/typecheck/copy/authority tests and is rerun on the same tree. |
| I10 registration resolver | Fs-owned WorkspaceRegistrationResolver stat+directory+realpath/identity-binds nonce issue and revalidates immediately before CAS; no nonexistent WorkspacePolicy API. |
| I11 Task9 ledger | Exact78 tool rows span77 unique paths; only lock_nodes/unlock_nodes share lock-nodes.ts, with identical hashes and cardinality tests. |
| I12 Task10 results | Exact shared component/result, MCP map tools, plugin handler/test, union manifest and contract/hash tests change together; counts stay baseline. |
| I13 graph schema | Full strict graph/node/locator/edge/evidence schemas, canonical sort/hash inputs, human immutability, automatic refresh semantics and boundaries are section3.7/Task11 authorities. |
| I14 vendor allowed generator | 7A prelude scans copy+serviceOwned destinations so the Relay raw import remains in exactly15 sorted rows; generator/test/output/authority share TREE_7A. |
| I15 authority classes | Superseded by R9 semantic service-fork lineage for any edited upstream-managed path. |
| I16 dependencies | Task11 shared+zod, Task12 pdf-lib, Task13 CLI shared, Task15 root happy-dom and Task16 Ajv are direct exact dependencies with package+lock, lockfile-only/frozen/staging gates; no YAML import/dependency. |
| I17 current-Windows diagnostic | Task16 GREEN runs a Vitest child-wrapper that proves raw nonzero `PLUGIN_NOT_CONNECTED` while the wrapper exits zero; raw failure is not a GREEN command. |
| I18 former external ceremony | Superseded/pruned by R13: Tasks1–16 retain only unsigned local source-complete evidence; external work requires a separately approved supplemental plan. |
| I19 plugin artifact | Prior exact isolated plugin staging root, built dist/legal/capability contents, deterministic order/timestamps/hash and unpacked execution remain unchanged. |
| I20 service count | Task11 registers exact service2 and Tasks12–16 preserve it outside tool counts. |
| I21 resolution fixture | Reserved record assertion uses `.decision`; fake hash is replaced by a valid `sha256:`+64hex constant. |
| I22 concurrent plugin ID | Task9B idempotency-concurrency test requires one shared Promise, handler and undo for concurrent identical ID and conflict on different args. |
| I23 source marker | Superseded by R8: schema/writer stay tracked, generated marker moves to ignored artifacts and is never authority/staged. |

### 2026-08-28 R8 final-review amendment

Commit `95fcfe8faec102015523be62d328f35aa957d9ac` and plan SHA `b666df08051c77cd0149485fb15baafd287ed15ab797e26f57a4c7c41a7e1b67` received NOT READY R8 reviews and are superseded for Task7 onward. Task6.1 base/contract remains byte-identical.

| R8 item | Binding resolution |
|---|---|
| 1 selector fixtures/cap | All positive session fixtures are canonical Base64Url128 constants including underscore; selector maximum is reachable stable-file115, raw envelope cap separately named. |
| 2 workspace atomicity | addResolved queues revalidation→nonce CAS→exact validated record; every swap leaves nonce/config/effect untouched; later root use revalidates identity. |
| 3 approval union | Strict plugin-session vs owner-control-session branches/transport/target rules; grounding/CLI uses control, plugin/bootstrap uses WS. |
| 4 replay bytes | Cache stores canonical redacted strict-result bytes and kind/name-aware consent fingerprint; adapters reframe after current authorization. |
| 5 Windows/node paths | Valid wire hash succeeds to digest-only path; design-diff node uses domain SHA-256, embeds/reverifies raw ID, rejects mismatch/collision/traversal. |
| 6 artifact test defaults | Vitest config owns exact ordinary exclusions; artifact config owns exact includes; JSON scripts are cmd-safe and Windows process-tested. |
| 7 former candidate ceremony | Superseded by R13–R15: Task15 owns artifacts only; Task16 creates an unsigned local preview after its clean commit. |
| 8 former external design | Superseded/pruned by R13; external execution is not part of this plan. |
| 9 7A authority | Superseded by R9: edited election.ts transitions to semantic service fork; only unchanged upstream preserves copy mode. |
| 10 Task8 scan | scan/scan.ts and scan.test are exact 8A migration/manifest/GREEN rows. |
| 11 Task9B registry | plugin handlers/registry.ts is explicit staged union and ledger mapping authority. |
| 12 Task10 E2E | e2e/read-tools result fixture is exact changed schema row and GREEN input. |
| 13 Task16 marker/workflow | Superseded by R14: only clean Task16 `verify:source-complete` writes the ignored candidate/evidence/marker. |
| 14 built approval | 9C daemon↔real built plugin covers full decision matrix; Task15 packed consumer repeats core, no control token. |
| 15 identity bootstrap | Internal system operation spans 9A read-only hello, 9B dispatcher shared-data+undo, 9C approval/coordinator/rehello/crash; counts unchanged. |
| 16 former external commands | Superseded/pruned by R13; Tasks17/18 contain no commands. |
| 17 paths/ledger | Every new source/test/script/schema/config is assigned to exact slice/file map/command; this ledger supersedes stale R7 wording. |

### 2026-08-28 R9 authority and external-scope amendment

Commit `0a668859709bcd9ae79705f5919d4fb73c48c08a` and plan SHA `494b0de2ba76c49d004547d4110c4f3828046399259c04ab25d7e61717649dfe` are superseded for Task7 onward; Task6.1 remains frozen.

| R9 | Resolution |
|---|---|
| 1 authority | Semantic service forks transition before copy-only with protected lineage; unchanged upstream alone preserves mode; serviceFiles/packageAuthorities refresh subtypes. |
| 2 TREE_7A | Complete base+missing11+fork schema/updater/verifier/tests union is explicit and closed. |
| 3 CLI | Task13 adds direct tsdown devDependency/package/lock/build authority. |
| 4 approval | Frozen entry×target matrix and wrong-channel tests bind plugin vs owner-control branches. |
| 5 Ajv | Superseded by R14: Task16 validates exactly three unsigned schemas. |
| 6 source binding | Superseded by R15: PreviewCandidate harness hash uses exact sourceCommit Git blobs, Node pin, package, and lock inputs. |
| 7 former external assets | Superseded/pruned by R13; only local preview artifacts remain. |
| 8 former external ownership | Superseded/pruned by R13 and moved outside this implementation plan. |
| 9 system principal | internal-system auth HMAC derives only daemon-side from paired session/generation; audit/reconnect/foreign-root tests exact. |
| 10 R8 paths | scan.ts, plugin registry and read-tools E2E remain exact manifests/commands. |
| 11 R8 safety | Workspace atomicity, approval union, replay bytes, and path digests remain retained; later preview scope supersedes the former external-candidate rules. |
| 12 external status | Superseded by R13 placeholders and a separately approved supplemental-plan requirement. |
| 13 memory | Isolated --expose-gc three-run max heap<=128MiB and serialized<=32MiB replaces vague 10k claim. |
| 14 ledger/DoD | R9 paths, commands, scope, and authority DoD supersede stale R8 claims. |

### 2026-08-28 R10 final authority/evidence amendment

Commit `eec92771062e9ddef87a3bb9431dc2b13169d40f` and plan SHA `88facdc2b97b9111af27ffa39a399527757ecd6ab2d1d1d1f8fa55e627549ed2` are superseded; Task6.1 unchanged.

| R10 item | Resolution |
|---|---|
| 1 | election.ts edited copy now serviceFork before copy-only; stale copy claim removed. |
| 2 | updater-before-copy/lineage tests apply to every 7A–16 slice with slice manifest. |
| 3 | Strict internal-system `OperationOriginV1` persists only raw-free auth/session hashes, generations, and name through journal/status/audit; R15 clarifies ordinary replay keys separately. |
| 4 | Superseded by R14 three-schema local validator scope. |
| 5 | Superseded/pruned by R13; no external final CLI remains. |
| 6 | Superseded/pruned by R13; local preview harness paths remain hash-bound. |
| 7 | Superseded/pruned by R13; only the local current-Windows diagnostic remains. |
| 8 | Superseded/pruned by R13 external placeholders. |
| 9 | Superseded by R13–R15 local source-complete scope; no detached external workflow is authorized. |
| 10 | Superseded by the R11 exact commit/SHA handoff; brief remains post-READY only. |
| 11 | Fork lineage includes exact originCommit and prior-row match. |
| 12 | CLI direct tsdown+publint dependencies/build gates exact. |
| 13 | Task9C/11 GREEN blocks include full tests/build/type/authority/updater/verifier surfaces. |
| 14 | Superseded by R13 unsigned local preview schema tests. |
| 15 | Superseded by R13 local-only harness path manifest. |
| 16 | R10 ledger/DoD supersedes stale R9 wording. |

### 2026-08-28 R11 now-superseded external/daemon amendment

Commit `46b15a1395073500da5dd58a9d50e0290ed4f64d` and plan SHA `5d6fad0f96b743bd43d8489741e7135b5a01558ac94242b8b2860aac37deaa44` received NOT READY R10 rereviews and are superseded for Task7 onward. The frozen Task6.1 base/contract and all prior non-conflicting rulings remain unchanged.

| R11 item | Binding resolution |
|---|---|
| 1 service-fork lifecycle | `ServiceForkLineageV1` is a strict edit/move/delete union with unique destination identities, exact A/M/D/D+A hashes, exclude/serviceOwned rules, deleted no-blob and generator no-recreation tests including repo-walk and 77 handlers. |
| 2 former external trust design | Superseded/pruned by R13; no external trust ceremony is implemented in Tasks1–16. |
| 3 former external key initialization | Superseded/pruned by R13. |
| 4 former external key design | Superseded/pruned by R13; no key lifecycle is in source scope. |
| 5 former detached external runs | Superseded/pruned by R13; local frozen install remains. |
| 6 former background orchestration | Superseded/pruned by R14; retained foreground child lifecycle remains. |
| 7 system origin | Internal cross-field auth/kind/name/session/generation/target hashes are strict/raw-free; `identity.bootstrap` is non-replayable after dispatch/settlement and full origin mismatch conflicts. |
| 8 9C gate | Literal 9C GREEN adds MCP/plugin builds+typechecks, root typecheck and full frozen Task6.1 security suite. |
| 9 Task11 paths | File map/Task11 manifest/GREEN enumerate seven IR sources, six pure tests, memory pair, five snapshot sources, two endpoints and nine snapshot tests with no directory rows. |
| 10 CLI ledger | Strict hash-bound CommandModuleLedger maps every command/alias once while allowing shared module/tests and rejects unreferenced/extraneous files. |
| 11 former external orchestration | Superseded/pruned by R13; local daemon scripts retain process tests. |
| 12 former external bundle design | Superseded/pruned by R13; no external bundle code or dependency remains. |
| 13 Task16 GREEN | Superseded by R14–R15 exact local daemon/fake/diagnostic/three-schema test surface. |
| 14 packed bootstrap | Task15 built consumer proves no-fileKey reject/approve UUID, one undo, forced rehello, crash-unknown reconnect and no control token. |
| 15 former automatic fixture orchestration | Superseded/pruned by R14; only typed fakes and non-destructive co-presence remain. |
| 16 former external commands | Superseded/pruned by R13. |
| 17 retained paths | Task8 scan, Task9 registry, Task10 read-tools, Task13 dependencies and all earlier exact path/authority rulings remain. |
| 18 ledger/handoff | This R11 ledger, companion checksum and resulting docs commit become the sole fresh READY rereview target; no Task7 brief is regenerated beforehand. |

### 2026-08-28 R12 now-superseded external-preflight/daemon amendment

Commit `be49d274445ba1400dd054a64d074dda62f769a4` and plan SHA `a3ddcdfd0e281f7df3cb528513355821e440f17e9b4f0514b0bef8ffc6254f2a` received NOT READY R11 rereviews and are superseded for Task7 onward. Frozen Task6.1 and all prior non-conflicting product/authority rulings remain unchanged.

| R12 item | Binding resolution |
|---|---|
| 1 former automatic cleanup | Superseded/pruned by R14; Task16 has no resource mutation or cleanup authority. |
| 2 former external shell orchestration | Superseded/pruned by R13. |
| 3 former external preflight | Superseded/pruned by R13. |
| 4 persistent daemon entry | Task16 adds MCP daemon-entry build/export/pack/test with strict args, no stdio/EOF lifecycle and awaited signals; packed artifact smoke is mandatory. |
| 5 former background lifecycle | Superseded/pruned by R14; source tests retain and terminate the foreground child handle directly. |
| 6 former lifecycle machinery | Superseded/pruned by R14; retained child handle teardown is test-local. |
| 7 former external enrollment | Superseded/pruned by R13. |
| 8 former external key lifecycle | Superseded/pruned by R13. |
| 9 former install orchestration | Superseded/pruned by R14. |
| 10 OperationOrigin formulas | Exact paired-session and target-binding domains/order plus plugin-generation/kind iff refinements are tested at append/load/tombstone/resolution; system remains status-only non-replayable. |
| 11 former publication design | Superseded/pruned by R14; fixed ignored files are written atomically after Task16. |
| 12 former external bundle caps | Superseded/pruned by R13 with the removed bundle feature. |
| 13 former cleanup orchestration | Superseded/pruned by R14. |
| 14 former Figma version source | Superseded/pruned by R14; only typed co-presence remains. |
| 15 behavioral REDs | Superseded by R14 exact source-daemon/fake/co-presence/three-schema RED. |
| 16 9C gates retained | MCP/plugin build+typecheck, root typecheck, frozen Task6.1 and closed-world gates remain literal. |
| 17 Task11 retained | Exact IR/snapshot source/test path manifest and commands remain unchanged. |
| 18 packed bootstrap retained | Task15 unpacked built-consumer identity-bootstrap approval/undo/rehello/crash/no-token E2E remains artifact-dependent. |
| 19 Task13 ledger retained | CommandModuleLedger authority remains; interactive pair wait is an option on its existing command row, not a new unmapped command. |
| 20 former external wrapper | Superseded/pruned by R13. |
| 21 closed-world scope | Active global/section wording now applies exact closed-world protocol to every 7A–16 subcommit. |
| 22 Task16 complete authority | Superseded by R14 three-schema source-only authority and no install/cleanup paths. |
| 23 R12 handoff | This ledger, companion checksum and resulting docs commit are the sole next rereview target; no Task7 brief or implementation proceeds before READY. |

### 2026-08-28 R13 source-scope correction

Commit `59feb6936efaef0395b758c274e8ee2290cad77f` and plan SHA `f66afc86e51e906bb70064fde3c0209b96511832dc5b80c9051161f75725f12b` are superseded for Task7 onward. Frozen Task6.1 and all service/product functionality remain unchanged; only unsupported external ceremony is pruned from this source implementation plan.

| R13 item | Binding resolution |
|---|---|
| A source boundary | Tasks1–16 end at local service/artifacts/fake+typed current-Windows diagnostics with unsigned marker and external validation not run; no external side effect is authorized. |
| B1 application factory | Task16 creates one application composition factory consumed by existing stdio index and persistent daemon entry with exact package/build/tests. |
| B2 former background lifecycle | Superseded/pruned by R14; daemon tests retain the child process handle directly. |
| B3 former install schema | Superseded/pruned by R14. |
| B4 former cleanup recovery | Superseded/pruned by R14. |
| B5 OperationOrigin | Internal raw-free component hashes and exact nonsecret generations permit target-binding recomputation with discriminator-scoped equality and status-only system operations; R15 defines append versus restart validation. |
| B6 former local publication | Superseded by R14 fixed ignored atomic files after Task16. |
| B7 local diagnostics | R14 retains fake16 and non-destructive current-Windows co-presence only. |
| B8 packed bootstrap | Task9/15 built identity.bootstrap approval/undo/rehello/crash tests remain unchanged. |
| B9 Task16 exactness | Superseded by R14 three-schema source-only scope and `verify:source-complete`. |
| B10 external placeholders | Tasks17–18 have no files, commands, dispatch, or completion claim and require a separately approved supplemental plan. |
| retained prior fixes | ServiceFork, TREE7A, Tasks8–15 IO/plugin/grounding/union/CLI/docs/artifact fixes and original Task7 commit subjects remain binding. |
| DoD | Plan READY and source-complete criteria exclude Tasks17–18; `externalValidationStatus:'not-run'` remains truthful. |
| stale-prune | External-only schemas, dependencies, scripts, tests, workflows, paths, commands and active ledger claims are removed. |
| R13 handoff | The resulting docs commit/checksum is the sole rereview target; no Task7 brief or implementation proceeds before READY. |

### 2026-08-28 R14 Task16 source simplification

Commit `ff9cd3de6417bad369895fbaa74ec7bbadc72ea8` and plan SHA `47d3ac72ce7780834efc0eb4cdcd9e502ea5dd5cb45260ade61286c2816dd9e5` are superseded for Task7 onward. Frozen Task6.1 and Tasks1–15 functionality remain unchanged.

| R14 item | Binding resolution |
|---|---|
| A Task16 scope | Task16 contains only application factory/daemon entry, fake16, non-destructive co-presence diagnostic and three unsigned source-complete schemas. |
| B child lifetime | Vitest/source runner retains and terminates the exact foreground child handle; no detached background design remains. |
| C ownership | Task15 stops at `verify:artifacts`; Task16 owns PreviewCandidate and the sole terminal `verify:source-complete`. |
| D removed orchestration | Background setup, fixture mutation/deletion, external ceremony naming, and related schemas/scripts/tests/dependencies are removed. |
| E OperationOrigin | Exact session/file-key domains, canonical file identity, target order and append-vs-restart generation validation are binding. |
| F fixed outputs | Superseded by R15: candidate/evidence/marker are the only three fixed ignored outputs; no intermediate result file or pointer exists. |
| G RED coverage | New literal 9B RED, expanded Task10 RED, full Task15 artifact/workflow/Windows/packed RED and retained Task16 RED precede GREEN. |
| H executable authority | Named MCP package files/exports/bin plus packed manifest are the only daemon executable authority. |
| I terminal command | Only clean Task16 `verify:source-complete` can support source-complete status. |
| J stale prune | Removed terms/paths/deps/DoD/ledger claims are absent from active Tasks1–16. |
| K diagnostic | Current-Windows result is typed co-presence only; real Figma validation requires a separate user-scoped supplemental plan. |
| L handoff | Superseded by the R15 docs/checksum rereview target; Tasks17–18 remain excluded placeholders. |

### 2026-08-28 R15 source-daemon and three-file amendment

Commit `2046b805a9679881ac786bd8a98c472969011d67` and plan SHA `43d1b27729f3adab0d0eda38264f87bdba9402c11cca13b12e3b9188c0a34dce` received NOT READY R14 rereviews and are superseded for Task7 onward. Frozen Task6.1 and Tasks1–15 product scope remain unchanged.

| R15 item | Binding resolution |
|---|---|
| 1 OperationOrigin | Append derives/verifies internal component hashes from authenticated source values and current admitted generations. Restart has no source values, validates strict stored syntax/equalities, and recomputes only targetBindingHash from stored hashes/generations. Raw-free applies to internal origin; ordinary replay records may retain nonsecret workspace/file keys. |
| 2 stale source-harness scope | Task13 exposes only an in-process controlled-source endpoint seam; Task16 drives typed fake pair/resume without TTY and keeps current-Windows co-presence supplemental/non-destructive. Obsolete background/external ceremony paths are absent. |
| 3 exact outputs | Source completion creates exactly preview-candidate, source-complete-evidence with embedded fake16 checks, and source-complete-preview. Three hash domains plus file/content/cross-field reread checks are binding; no intermediate result file exists. |
| 4 Task15/16 ownership | Task15 remains artifact-only. Task16 RED records the Task15 MCP artifact's missing daemon surface, then GREEN runs the full artifact gate on the exact staged tree before review/commit. Only the post-commit terminal command creates the three outputs. |
| 5 package authority | MCP tsdown entries, `dist/index.mjs`, `dist/daemon-entry.mjs`, package files, `./daemon`, `sfp-daemon`, artifact manifest, bounded help/readiness stdout, ping, teardown, and closed-port smokes are exact. |
| 6 lifecycle | In-process application close is graceful/idempotent; piped stdin EOF does not stop the child; POSIX signal and Windows retained-handle assertions are platform-correct and bounded. |
| 7 exact Task16 tree | Deleted orchestration test names are absent; exact application/daemon/artifact/schema/fake/diagnostic paths, literal RED/GREEN, full artifact suite, and closed-world same-tree reviews are binding. |
| 8 retained TDD | Exact 9B, Task10, and Task15 behavioral RED additions remain binding. |
| 9 executable authority | MCP package.json, tsdown config, and artifact manifest are the only executable authorities; no anonymous/source fallback exists. |
| 10 diagnostic | Current-Windows checks only co-presence/connection and never pair or mutate. |
| 11 handoff | The resulting R15 docs commit/checksum is the sole rereview target. No Task7 brief or implementation starts before READY. |

Prior service findings remain incorporated. Prior external-ceremony findings are explicitly superseded by this scope correction and require separate future authorization.

---

## 11. Execution Handoff

Commit this R15 plan/checksum docs-only and record the resulting exact commit+plan SHA as the sole review target. No Task7/brief until READY. The post-READY brief records the R15 plan/commit SHA, frozen Task6.1 hash, and original 7A/B/C subjects. Tasks17/18 remain non-dispatchable external placeholders.
