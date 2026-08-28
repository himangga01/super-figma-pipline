# Super Figma Pipeline v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Every behavior change follows RED → GREEN → REFACTOR. Each Task ends with an independent spec review and an independent code-quality review before commit.

**Goal:** 원본 세 OSS를 변경하지 않고 새 `service/`에 Figwright의 전체 기능과 Rust/figmosha 고유 안전 기능을 합쳐 secure Desktop local connector, grounding snapshot, export/doctor CLI를 갖춘 standalone v0.1 서비스를 만든다.

**Architecture:** Figwright TypeScript monorepo를 standalone service baseline으로 vendor하고, MCP·CLI·follower의 모든 tool 실행을 하나의 typed policy/execution pipeline으로 통과시킨다. Rust와 figmosha2에서는 중복 server를 가져오지 않고 deterministic token/PDF export, progress, doctor/error-hint/target UX를 source attribution과 함께 흡수한다. Auth·operation journal은 owner-only service state에, source scan·snapshot·export는 user-approved workspace에 분리한다.

**Tech Stack:** Node 24, pnpm 11.24, TypeScript 6 strict, MCP server v2, Zod 4, MessagePack, ws, Vue 3/Vite, Vitest, `pdf-lib` 1.17.1, oxlint/oxfmt/knip.

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
- MCP, follower, and control requests carry only strict `InvocationRequestV1` selectors. Actor, auth session, consent, workspace root, plugin target, file identity/execution key, generation, editor, and capabilities are always server-derived; request-body copies are rejected as unknown fields.
- A 256-bit owner-principal key under secured `stateRoot` derives one stable OS-owner `actor1_…` for direct MCP, follower MCP, and control. Each MCP connection creates one 128-bit session before role choice; `auth1_…` session identities are domain-separated HMACs, survive leader↔follower role changes for that MCP connection, and change on control credential rotation. Raw credentials are never actor/auth-session IDs. Target resolution is a leader-side lookup against authenticated Relay sessions; the resulting target and `FileExecutionKey` are deeply immutable for the invocation.
- Idempotency key is `(actorId, operationId)`, where operationId is a server-issued timestamped/HMAC token with a 30-day exactly-once horizon. A forged/future/expired ID fails before runtime. Reuse with different tool, argsHash, workspace, or file target fails `OPERATION_ID_CONFLICT`. Terminal records compact to horizon tombstones; persisted success is never re-executed and returns `OPERATION_ALREADY_SETTLED` when its bounded in-memory result is unavailable.
- A dispatched write whose result is lost becomes `outcome-unknown` and is never blindly replayed. Daemon recovery converts persisted dispatched records to that state.
- Persisted snapshots are loss-aware observed records. Section assembly records partial/omitted/failed sections; no “Figma API 전체 lossless IR” claim is made.
- Model egress mode is explicit configuration, never inferred from `source:'mcp'`. Unknown mode fails closed. Audit records hashes/classes/byte counts, not raw design text, image bytes, source code, or secrets.
- Pre-execution and final egress manifests are durable, canonical, hash-chained, fsynced owner-state records. Every reservation is finalized exactly once as output, no-output, or outcome-unknown before capacity release; a missing durable post-runtime finalizer makes the real outcome unknown rather than retryable.
- One-use action nonces are server-issued 256-bit capabilities bound to actor, leader generation, exact action, and request hash for 120 seconds. Semantic validation precedes an atomic consume immediately before the side effect; restart/generation invalidates all outstanding nonces.
- Progress/cancel/result/error semantics are one shared protocol projected to MCP progress tokens, framed follower RPC, control NDJSON, and plugin `$progress`/`$cancel`; transport disconnect alone is neither cancel nor retry.
- Public `/ping` identity is exactly `{ok,product,protocolVersion,serverVersion,buildId,leaderGeneration,role}`. It retains `leaderGeneration` for authenticated-transport binding and exposes no plugin, MCP, Relay session, file, or `activeSessionId` oracle.
- Task 7 starts with an empty non-MCP `ServiceOperationSpec` registry; Task 11 registers only `snapshot.capture`. Service operations use the same execution plane but never enter the canonical 116-tool or 106-handler counts; administrative control routes are separately classified and never masquerade as tools.
- Every service-mutating subcommit in Tasks 8–16 regenerates and stages `vendor-rules.json`, `vendor-map.json`, and `upstream-lock.json`, passes offline closed-world verification, and receives spec/quality review of the same `git write-tree` before its exact commit.
- URL import keeps the public typed `url` argument but fetches only in the daemon. The plugin receives validated bytes and has no external wildcard domain or `createImageAsync(url)` path. Owner-managed allowed domains live under stateRoot and change only through authenticated control/CLI; one-call approval never expands them.
- Three upstream MIT notices, service license, `pdf-lib` notice, dependency SBOM, provenance, and checksums are present in actual npm/plugin artifacts. figmosha Solar CC BY assets are not copied.
- Tasks 1–16 define the **source-complete v0.1 preview**: implementation, artifacts, and automated acceptance harness may truthfully complete with release status `blocked-external-evidence`. Tasks 17–18 are external GA evidence gates; missing either blocks GA/release, not the truthful source-complete implementation milestone.
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
- Updated skills, official build-vs-buy document, CI/release templates, SBOM/checksum artifact gates.
- Automated acceptance harness and blocking Windows/macOS evidence.

### 1.3 Explicitly Deferred

- Automatic source patching and deterministic code→Figma compiler.
- Automatic three-way merge.
- Native Rust launcher/worker.
- Web/private/Community plugin and FigJam write guarantee.
- Dev Mode write and view-only bypass.
- Raw Plugin API script execution.
- SQLite; v0.1 stores versioned JSON/JSONL with checksum and atomic replacement.

Existing typed writes still permit agent-orchestrated code/spec→Figma work, but v0.1 is not marketed as a deterministic reverse compiler.

### 1.4 Milestones

| Milestone | Tasks | Independent output |
|---|---|---|
| A — reproducible baseline | 1–3 | runnable workspace, 112/105/7 parity, two-layer capability authority |
| B — secure execution plane | 4–9 | state/workspace roots, policy, pairing, executor, safe fs/network, paired plugin |
| C — grounding and safe union | 10–12 | corrected grounding, section snapshot, atomic 116/106/10 union |
| D — UX and release | 13–16 | CLI, docs, artifacts, automated acceptance harness |
| E — external release evidence | 17–18 | Windows and macOS signed evidence |

The initial estimate remains 8–12 weeks for two experienced TypeScript/plugin engineers, recalibrated after Task 2 parity and Task 6 live pairing spike. Each milestone is a review checkpoint; no later milestone compensates for a failed earlier hard gate.

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

The vendoring script expands this into `service/vendor-map.json`, one row per copied/merged/reference file with mode, origin commit, source path, destination or null, base SHA-256, current SHA-256 where applicable, and license ID. Copy mode materializes only source/test/protocol/UI/skill trees. Every root/package/lock/build/test config and plugin manifest is Task 1 service authority; upstream equivalents are reference-only hashes and are never copied over it. Manifest merge preserves Task 1 names, five-package workspace, scripts, bin/files/exports, Node/pnpm pins, and `ir`/CLI packages; it merges dependency/devDependency keys deterministically after rewriting package dependency names. Upstream `postinstall` and release scripts are explicitly dropped because skills are copied directly and no `.claude` mirror is produced. The service lock is regenerated with `pnpm install --lockfile-only`, then frozen install is tested.

Runtime module specifier rewriting and verification are AST-based. `verify-runtime-specifiers.mjs` visits TypeScript/JavaScript import/export declarations, import types, dynamic `import()`, and `require()` literals plus package dependency fields; only specifiers beginning `@figwright/` fail. Protocol tags `@figwright/bridge` and `@figwright/panel`, comments, user guidance, and provenance are permitted and tracked in `vendor-allowed-figwright-strings.json`; they are not runtime package imports and are not blindly rewritten.

`verify-upstream-lock.mjs --offline` checks only service-contained hashes/schema/licenses. `--with-upstreams ../code-kb` additionally checks pinned commits, source hashes, and clean original worktrees. Release artifacts use offline mode and never require `code-kb`.

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
  name: string;
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
  name: string;
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
  toolName: string;
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
  execute(scope: RuntimeExecutionScope, toolName: string, args: unknown, signal: AbortSignal): Promise<unknown>;
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
  toolName: string;
  commitOnChangedSuccess: boolean;
}

export interface MutationHandlerContract {
  toolName: string;
  noOpSemantics: 'supported' | 'never-on-success';
  changedFixtureId: string;
  noOpFixtureId: string | null;
}
~~~

`handlerAuthority` is the handler-parity authority and is independent from `RuntimeBinding.execution`. `plugin-direct` invokes exactly one pinned plugin handler through `PinnedPluginRuntimePort`; `server-adapter` invokes a typed daemon adapter that may call that same port but never Relay/session selection directly. Baseline `server-adapter` is the exact set `ping`, `get_screenshot`, `get_design_context`, `save_screenshots`, `save_image_fills`, `export_pdf`, `export_video`, `analyze_project`, `scan_components`, `component_map`, `token_map`, `icon_map`, `import_image`, `design_diff` (14); final adds `export_tokens`, `export_frames_to_pdf`, and `doctor` (17). Handler parity remains 105/7 then 106/10, while execution becomes 98/14 then 99/17.

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
  | 'operation.resolve'
  | 'network-domain.add'
  | 'network-domain.remove';

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

export type InvocationTargetSelector =
  | { kind: 'active' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'stable-file'; fileIdentityHash: `sha256:${string}` }
  | { kind: 'none' };

export interface InvocationRequestV1 {
  version: 1;
  requestId: `sfp_req1_${string}`;
  toolName: string;
  rawArgs?: unknown;
  operationId?: string;
  workspaceId?: string | null;
  targetSelector: InvocationTargetSelector;
}

export interface ServiceOperationRequestV1 {
  version: 1;
  requestId: `sfp_req1_${string}`;
  serviceOperationName: string;
  rawArgs?: unknown;
  operationId?: string;
  workspaceId?: string | null;
  targetSelector: InvocationTargetSelector;
}

export interface ServiceOperationSpec<I, O> {
  name: string;
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
  entryPath: 'mcp-direct' | 'mcp-follower' | 'control';
}

export interface ConsentContext {
  mode: EgressMode;
  consentId: string | null;
  allowedClasses: readonly DataClass[];
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
  approvalId: string;
  actorId: `actor1_${string}`;
  operationId: string;
  decision: 'approved' | 'rejected' | 'expired';
  decidedAt: string;
}

export interface ApprovalDecisionPort {
  decide(scope: ResolvedInvocationScope, operationName: string, effects: readonly Effect[], operationId: string): Promise<ApprovalRecord | null>;
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

export interface OperationRecord {
  actorId: `actor1_${string}`;
  originAuthSessionId: `auth1_${string}`;
  operationId: string;
  issuedAt: number;
  operationKind: 'tool' | 'service';
  operationName: string;
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
  operationId: string;
  issuedAt: number;
  expiresAt: number;
  operationKind: 'tool' | 'service';
  operationName: string;
  argsHash: string;
  workspaceId: string | null;
  fileExecutionKey: FileExecutionKey | null;
  resultHash: string | null;
  status: 'succeeded' | 'failed' | 'rejected' | 'resolved-applied' | 'resolved-not-applied' | 'abandoned';
}

export interface OperationResolutionRecord {
  actorId: `actor1_${string}`;
  originAuthSessionId: `auth1_${string}`;
  resolverAuthSessionId: `auth1_${string}`;
  operationId: string;
  issuedAt: number;
  operationKind: 'tool' | 'service';
  operationName: string;
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
  invokeTool(scope: RuntimeExecutionScope, toolName: string, rawArgs: unknown, operationId?: string): Promise<unknown>;
  invokeService(scope: RuntimeExecutionScope, operationName: string, rawArgs: unknown, operationId?: string): Promise<unknown>;
  status(actorId: `actor1_${string}`, operationId: string): OperationRecord | undefined;
}

export const SERVICE_OPERATION_SPECS: Readonly<Record<string, ServiceOperationSpec<unknown, unknown>>> = Object.freeze({});
~~~

`InvocationRequestV1` is the strict tool wire schema; its only keys are `version`, `requestId`, `toolName`, optional `rawArgs`, optional `operationId`, optional `workspaceId`, and `targetSelector`. `ServiceOperationRequestV1` substitutes `serviceOperationName` and is accepted only by the service-operation seam. Cancellation accepts only `version`, `requestId`, and `operationId`. Request IDs match `^sfp_req1_[A-Za-z0-9_-]{22}$`. Every entry point rejects unknown keys, including body-supplied `actor`, `actorId`, `authSessionId`, `principal`, `consent`, `mode`, `allowedClasses`, `workspaceRoot`, `target`, `FileIdentity`, `fileExecutionKey`, `pluginGeneration`, `editorType`, and `capabilities`. `workspaceId` is only an approved-store lookup key, never a root path. `stable-file.fileIdentityHash` matches `^sha256:[0-9a-f]{64}$`, carries no body `FileIdentity`, and is only an authenticated-session-index lookup.

Admission order before approval is exact: strict outer/inner/request parse → registry/strict args → workspace lookup → resolve declared paths metadata-only into PolicyInvocationContext → effects/idempotency/approval requirement → TargetRequirement and deep-frozen target/key → `ResolvedInvocationScope`. Capacity/pending approval and decision then run. Only after approval does egress authorization produce ConsentContext and freeze final `RuntimeExecutionScope`. No content/DNS/network/plugin/runtime occurs earlier. Target rules are section3.2; unstable key includes registered session+generation; no filename fallback/reroute.

Each MCP connection creates one random 128-bit `mcpSession` before election role choice and synthesizes one random 128-bit `sfp_req1_…` request ID per call. The leader adapter uses selector `active`; the same connection in follower role forwards selector `active` through Task 6's opaque authenticated transport without changing its MCP/auth session. Only authenticated control/CLI may choose `session`, `stable-file`, or `none` explicitly in v0.1. Tool-specific node/page/component IDs remain parsed ToolSpec args; they never become session/file identity.

One `ExecutionPlane` singleton is constructed only while the node owns one leader generation. A persisted owner-principal key is exactly 32 random bytes created once at `stateRoot/auth/owner-principal-key.v1`, protected by Task 4 `StatePermissions`, read only by the leader, and never logged/exported. Every valid entry path in that stateRoot receives the same actor ID: `actor1_` plus base64url HMAC-SHA-256 of `sfp-actor-v2\0os-owner`. MCP auth session is `auth1_` plus base64url HMAC-SHA-256 of `sfp-auth-v1\0mcp\0<mcpSession>`; it remains identical when that MCP connection changes leader↔follower role. Control auth session is `auth1_` plus base64url HMAC-SHA-256 of `sfp-auth-v1\0control\0<leaderGeneration>\0<credential-fingerprint>` and changes on credential rotation. The credential fingerprint is itself a domain-separated SHA-256 value; no raw token, ticket, resume value, follower credential, or control credential is ever stored as actor/authSessionId. A different stateRoot has a different owner key, cannot derive the actor/auth sessions, cannot verify operation IDs, and has no authority over the records.

Cancellation requires both the stable actor and exact `originAuthSessionId`; another MCP connection or rotated control session cannot cancel it. Authenticated control is owner-admin for list/status and manual resolution of any same-actor operation regardless of origin session, and the audit records both `originAuthSessionId` and `resolverAuthSessionId`. Role transition, control rotation, cross-session cancel denial, cross-domain admin resolution, and foreign-stateRoot denial are binding tests. Task 6 public `/ping` remains exactly `{ok,product,protocolVersion,serverVersion,buildId,leaderGeneration,role}` and exposes no plugin/session/file oracle.

Followers construct only `FollowerInvocationClient`, which uses Task 6 `FollowerAuthenticatedTransport`; they do not construct `OperationInvocationService`, an executor, queue, journal, approval gate, egress store, Relay dispatcher, or auth primitive. `unknown` and `conflicted` roles reject before serializing and forward no args. Task 7 may parse only the decrypted inner length-prefixed plaintext delivered by that opaque port and has a structural no-import gate for Task 6 follower keys/challenge/encryption modules.

Demotion is single-flight/two-phase and awaited by election; overlapping ticks cannot promote/demote/release. A one-use exact-generation DemotionTicket fixes one absolute 5,000 ms deadline and a 1,000 ms transport-drain deadline. Order: close admission → generation terminal fence → abort pending/queued → fsync dispatched unknown → finalize/flush egress → bounded drain/force close → destroy → release port. Prepare runs through destruction; finalize rejects stale/reused ticket and releases only after durability. Durability failure retains port with fatal guidance; no successor/old reply overlaps.

Operation IDs are server-issued base64url envelopes with version/keyId/issuedAt/random128-bit nonce/owner-actor hash plus HMAC-SHA-256 under a dedicated stateRoot-lifetime key independent of transport credentials. Verify strict envelope, key/MAC/owner actor before lookup; age `>=2,592,000,000 ms` is `OPERATION_ID_EXPIRED`, future skew `>300,000 ms` or bad key/MAC/actor is `OPERATION_ID_INVALID`, all runtime zero. Exact replay key includes actor, operationId, kind, name, argsHash, workspaceId, and fileExecutionKey; mismatch conflicts. No raw result persists. In-memory result cache follows section3.12; persisted settled without cache returns nonretryable `OPERATION_ALREADY_SETTLED`. Tombstones last through horizon and signed age rejects after purge. Generation change uses bounded demotion. Manual same-owner control resolution is separate admin action with nonce/evidence/exact `${operationId}/${resultHash ?? 'unknown'}`, fsynced 1,048,576-byte reserve, origin/resolver auth audit, no replay authority, and typed reserve-full guidance.

The exact fingerprint includes `(operationKind,operationName)`, so tool/service names cannot collide. State/side-effect order is: capacity → durable pending approval if required → approval → raw-free pre-egress fsync/finalizer reservation → queue → dispatched append → dispatched fsync → first plugin/filesystem/network side effect → validation/classification → exactly-one finalizer fsync → terminal status fsync → one terminal frame. No runtime port is callable before dispatched fsync. Generation-fenced terminal CAS makes result/cancel/deadline/demotion races one-winner; crash tests stop after every arrow and never rerun maybe-applied effects.

The full-reserve payload is exactly `{ code:'RESOLUTION_RESERVE_FULL', manualExportCommand:'sfp operations unresolved --json' }`; it contains no raw operation data.

Every reserved resolution record copies `originAuthSessionId`, `issuedAt`, `operationKind`, `operationName`, `argsHash`, `workspaceId`, `fileExecutionKey`, and `resultHash` from the active unknown row and adds the authenticated control `resolverAuthSessionId` before fsync. That complete fingerprint preserves the normal rule after active-row compaction: an exact same-ID call is settled, while any different kind/name/args/workspace/file target is `OPERATION_ID_CONFLICT`.

Authenticated `POST /control/action-nonces` accepts strict `{action,requestHash}`, where requestHash matches `^sha256:[0-9a-f]{64}$`, and issues exactly `sfp_an1_` followed by random 256-bit base64url (43 characters), bound to authenticated actor, current leader generation, action, and canonical semantic request hash. TTL is exactly 120,000 ms. The owner-state store permits at most 1,024 rows or 512 KiB per actor; it never evicts an unexpired issued or consumed row to admit another. Semantic request validation occurs first, then `consumeCas` runs atomically immediately before the protected side effect. A mismatch, reuse, concurrent loser, expiry, daemon restart, or generation change fails before the side effect. Consumed rows remain until expiry so replay is distinguishable. Restart and generation recovery invalidate every outstanding row rather than restoring bearer capability.

`hashActionRequest(action,payload)` is owned by `shared/action-nonce.ts`: strict-parse the action-specific semantic payload, omit auth and `actionNonce`, sort object keys recursively, preserve array order, encode every already-canonical string as its exact UTF-8 bytes with no Unicode normalization/case folding, encode canonical JSON, and hash `sfp-action-request-v1\0<action>\0<canonical-json>` with SHA-256. Exact semantic fields are `{realPath}` for `workspace.add` after Task 4 canonical realpath resolution, `{workspaceId}` for `workspace.remove`, `{operationId,decision,reasonHash,evidenceHash,confirm}` for `operation.resolve`, and normalized exact `{fqdnAscii}` for both network-domain actions. CLI resolves the same local realPath before requesting a nonce; the server re-resolves and requires byte equality before CAS. The client-supplied hash is never accepted as side-effect authority by itself, and canonically distinct filesystem names never alias through NFC.

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
  addedAt: string;
}

export interface WorkspacePolicy {
  resolveRead(workspaceId: string, input: string): Promise<string>;
  resolveWrite(workspaceId: string, input: string): Promise<{ path: string; overwrites: boolean }>;
  assertWithinRoot(workspaceId: string, path: string): Promise<void>;
}

export interface WorkspaceConfigStore {
  add(actorId: string, path: string): Promise<WorkspaceRoot>;
  list(): Promise<readonly WorkspaceRoot[]>;
  remove(actorId: string, workspaceId: string): Promise<void>;
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

WorkspaceConfigStore receives a `WorkspaceUsageGuard` constructor dependency. Task 4 tests it with an in-memory fake and never imports the later journal; Task 7 supplies `JournalWorkspaceUsageGuard`. Workspace registration takes an existing directory, resolves realpath, requires authenticated explicit user action, and writes only the normalized record to stateRoot. Removal calls the guard and returns `WORKSPACE_IN_USE` for unsettled references. Raw `rootDir`/`outPath` arguments cannot add roots. Existing paths are realpath checked per file; new outputs validate the nearest existing parent and reject symlink/junction/reparse traversal.

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

export interface PublicPingV1 {
  ok: true;
  product: 'super-figma-pipeline';
  protocolVersion: string;
  serverVersion: string;
  buildId: number;
  leaderGeneration: string;
  role: 'leader' | 'follower' | 'unknown' | 'conflicted';
}

export interface AuthenticatedFollowerPlaintext {
  leaderGeneration: string;
  mcpSession: `mcp1_${string}`;
  plaintext: AsyncIterable<Uint8Array>;
}

export interface FollowerAuthenticatedTransport {
  sendEncryptedRequest(plaintext: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
  authenticateAndDecrypt(request: unknown, signal: AbortSignal): Promise<AuthenticatedFollowerPlaintext>;
  encryptAndWriteResponse(response: unknown, plaintext: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<void>;
}
~~~

- Control-authenticated `POST /control/pair/challenge` creates a public ten-character base32 `challengeId`, a cryptographically random eight-digit code, five-minute expiry, five attempts, and per-stateRoot rate limit. CLI displays two values and one paste form, for example `Pair ID: ABCDEFGHJK`, `Code: 12345678`, `SFP-ABCDEFGHJK-12345678`. The identifier is public; the code is the short-lived secret. Plugin UI accepts the paste form or two fields and sends both values.
- Plugin UI sends `POST /pair/exchange` with exact `PairExchangeRequest`, `Content-Type: application/json`, and 16 KiB cap. Success consumes the code and returns a random 128-bit one-use ticket valid for 30 seconds.
- WebSocket uses only `/ws`. Ticket/resume credential is sent in the first MessagePack hello, never URL/query/log. Ticket success returns a rotating resume token bound to session and plugin generation.
- A socket flap uses the resume token; plugin restart changes generation and requires re-pair unless a still-valid generation-bound credential exists. Every successful resume rotates the token and rejects the previous value.
- Follower and control credentials are distinct owner-state secrets rotated on leader generation. `/rpc` and `/abdicate` require Task 6 follower authentication; `/control/*` requires Task 6 control authentication. Task 6 alone owns follower challenge/replay protection, authentication, encryption, outer framing, outer byte caps, key lifetime, and constant-time checks, and exports only opaque `FollowerAuthenticatedTransport` plus authenticated `mcpSession`/leaderGeneration/plaintext. Task 7 cannot import follower auth/key/encryption modules and parses only the decrypted inner plaintext. Every MCP process creates its 128-bit `mcp1_…` session before role choice and preserves it across role transitions.
- Public `/ping` is frozen as exact strict `PublicPingV1`: `{ok,product,protocolVersion,serverVersion,buildId,leaderGeneration,role}`. It intentionally retains leaderGeneration for Task 6 channel binding and exposes no activeSessionId, plugin/Relay/MCP session, file identity/name, capability, or plugin count.
- PNA contract is literal. A plugin preflight is `OPTIONS /pair/exchange` with loopback Host, allowed Origin (`null`, `https://www.figma.com`, or `https://figma.com`), `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: content-type`, and `Access-Control-Request-Private-Network: true`. Success is 204 with the validated Origin echoed in `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: POST`, `Access-Control-Allow-Headers: content-type`, `Access-Control-Allow-Private-Network: true`, `Access-Control-Max-Age: 0`, and `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network`. No credentials header or wildcard is returned. Wrong path/Host/Origin/method/header/private-network value is 403 with no CORS/PNA allow headers. `POST /pair/exchange` requires the same Host/Origin allowlist. Null Origin is not identity; the one-time code/ticket is the credential. Logs and diagnostic bundles redact code/token fields but may retain the public challengeId.
- Actual pair POST CORS is equally binding. For an allowed Origin, success 200 and every typed 4xx/5xx response (`PAIR_CODE_WRONG`, `PAIR_CODE_EXPIRED`, `PAIR_CODE_USED`, `PAIR_RATE_LIMITED`, invalid JSON/body, internal safe error) echo that validated Origin value in `Access-Control-Allow-Origin`, plus `Access-Control-Allow-Private-Network: true` and `Vary: Origin`; they never use `*` or credentials. This lets the Figma UI read both ticket and actionable error JSON. Hostile Origin or absent Origin receives 403, `Vary: Origin`, no ACAO, no ACAPN, and no challenge/ticket oracle body. OPTIONS and POST tests cover all three allowed Origins plus hostile and absent Origin.

Task 6 ingress limits include pair/abdicate metadata JSON exactly 16,384 bytes and plugin WebSocket frames exactly 67,108,864 bytes; Task 6 outer follower encrypted-envelope limits remain opaque to Task 7 and are enforced by the frozen Task 6 suite. Section 3.12 owns only decrypted Task 7 inner/control/direct-MCP limits and export payload limits. Every declared/chunked counter rejects before allocation/concatenation/decode; over-limit exports return typed `PAYLOAD_TOO_LARGE`/`EXPORT_TOO_LARGE` without partial output or runtime.

**Frozen Task6 boundary:** reviewer-approved base commit `dcbba9b919c8a54e3c33719e1964129b41f858fe`; canonical PublicPingV1/opaque follower-authenticated-outer-transport contract SHA-256 `6a68c9405a2feebce439d105fe83199c6aef4538f9ebf3bd14963ffa4309c7b3`.

The contract hash is reproducible and never reads the dirty checkout. At the frozen commit, sort the paths below by ordinal UTF-8 path bytes. For each, read exact Git blob bytes with `git show <commit>:<path>`, compute lowercase SHA-256, append manifest bytes `<path UTF-8><NUL><64 lowercase hex><LF>`, concatenate all rows, then SHA-256 the 784-byte manifest.

| Sorted frozen source path | SHA-256 of exact Git blob bytes |
|---|---|
| `service/packages/mcp/src/election/follower.ts` | `c3fc69b03ce323cd737ede410dbc1999aa06a6e156c4e3c770c5e8cb471fa4e9` |
| `service/packages/mcp/src/election/leader-endpoints.ts` | `4a14267766e14f4a17311d95dc4a6ea2eebf8392f3099dd7d45ebc47c4800bdd` |
| `service/packages/mcp/src/security/follower-auth.ts` | `db404fe31d0e6a700f62bdcbeaa2d5762b7ebe842a831d9855d038241ded4a53` |
| `service/packages/mcp/src/security/local-access.ts` | `8d7950df141199eaa2cb5eb2d6f0ef9b0cbd74dee1f33aa3690df70fbf957244` |
| `service/packages/mcp/src/security/request-limits.ts` | `d6e808489579b7278fb75a09bc8e1ae2e55cadb2cd3541fc4b37262fec13ee95` |
| `service/packages/shared/src/auth.ts` | `df945a0db981991f6e57dccfd838913ee105f3460f58769fda30583e78eb2ecf` |
| `service/packages/shared/src/protocol.ts` | `3a75bf832d56cdb09ea264d023040c4bea653363c841d6f56339c3e70c343dc1` |

The seven paths are minimal for the frozen public/outer contract: public product/protocol constants, exact ping/follower endpoints, follower AEAD/challenge logic, loopback/local-access gates, and request/response caps. Inner Task7 schemas are deliberately excluded. Both an in-memory Git-blob implementation and an independent Git-Bash `git show | sha256sum` pipeline produced the recorded contract hash.

### 3.6 Stable File Identity and Per-file Queue

~~~ts
export type FileIdentity =
  | { kind: 'figma-file-key'; value: string }
  | { kind: 'document-plugin-uuid'; value: string }
  | { kind: 'unstable-readonly'; sessionId: string; pluginGeneration: string };

export type FileExecutionKey = `figma:${string}` | `plugin-uuid:${string}` | `unstable:${string}:${string}`;
~~~

Use `figma.fileKey` when non-null. Otherwise, an explicitly approved editable Design session creates one UUID in document root pluginData key `sfp:file-uuid` through an audited top-level system mutation. The plugin dispatcher—the sole undo owner—commits that changed system operation once; `file-identity.ts` never calls `commitUndo()` directly. The UUID is reused across plugin/daemon restarts. Dev/read-only contexts that cannot persist it get `unstable-readonly`; persistent snapshot/design-diff returns `FILE_IDENTITY_UNSTABLE` instead of guessing from fileName. Queue key derives only from FileIdentity, so two sessions on the same file serialize.

Selector resolution never trusts a caller-supplied identity/key. `active` chooses the leader's current authenticated Relay session at admission and pins it; `session` looks up that exact authenticated session; `stable-file` looks up the hash in the leader's authenticated-session index and selects the healthy same-identity session with highest server-assigned monotonic `connectedSequence` (lexicographically smallest sessionId breaks a tie), while zero matches fail and a hash collision across different identities fails `TARGET_SELECTOR_AMBIGUOUS`; `none` resolves no plugin target. The resolved session's registered `FileIdentity` alone produces `figma:<fileKey>`, `plugin-uuid:<uuid>`, or `unstable:<registered-sessionId>:<registered-pluginGeneration>`. `fileName` is display-only. The frozen target/key remain unchanged through approval, queueing, runtime, progress, and result settlement; disappearance yields `PINNED_SESSION_LOST`.

Only a `server-adapter` whose `TargetRequirement` resolves to `forbidden` or `optional` may receive a null target. `plugin-direct` always requires a pinned target. `analyze_project`/`scan_components` reject non-none selectors, `ping` can return daemon health with none or use a pin for its typed round trip, and `doctor(roundTrip:false)` may use none while `doctor(roundTrip:true)` must pin. Target resolution never silently upgrades optional none to active.

### 3.7 Snapshot and Grounding

~~~ts
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
  snapshotId: string;
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
  fileIdentityHash: string;
  snapshotId: string;
}

export interface StoredSnapshotRef extends SnapshotStorageKey {
  relativePath: string;
  checksum: string;
  bytes: number;
  fidelity: SnapshotFidelity;
}

export interface SnapshotStoragePort {
  save(key: SnapshotStorageKey, snapshot: SnapshotV1): Promise<StoredSnapshotRef>;
  load(key: SnapshotStorageKey): Promise<{ ref: StoredSnapshotRef; snapshot: SnapshotV1 } | null>;
  list(workspaceId: string, fileIdentity: FileIdentity, fileIdentityHash: string): Promise<readonly StoredSnapshotRef[]>;
  delete(key: SnapshotStorageKey, actorId: string, approvalId: string): Promise<void>;
}
~~~

`@sfp/ir` owns `SnapshotV1`, its fidelity types, `SnapshotStoragePort`, and the Zod/canonical codecs together in Task 11; shared and Task 4 contain no snapshot-storage type and never import future IR. Task 11 also creates the MCP adapter that implements the IR port by consuming Task 8 `WorkspacePolicy` and `AtomicFileStore`. Its namespace is exactly `.sfp/snapshots/v1/{fileIdentityHash}/{snapshotId}.json`; `workspaceId` selects the approved root and never appears as an untrusted path segment, while `fileIdentityHash` must match the canonical hash of `fileIdentity`. Design-diff baselines use the separate `.sfp/design-diff-baselines/v1/{fileIdentityHash}/{sanitizedNodeId}.json` namespace. Capture resolves one session, requests full context, and processes nested section plans with a bounded work queue: stable depth-first pre-order, concurrency two, visited key `(pluginGeneration,nodeId)`, maximum depth 8, maximum 256 fetched sections across the capture. A section that returns another plan is recursively expanded; cycle/depth/count omissions and failed descendants are recorded with their plan path in fidelity. Merge uses stable plan order and node IDs while preserving child order. It never relabels a degraded payload as complete. Content hash excludes snapshotId/capturedAt and includes file identity, target, observed, and fidelity. Snapshot capture is authenticated control-only and does not add another MCP tool.

Binding amendment: authenticated control-only snapshot capture enters the Task11 service-operation row `snapshot.capture`; “does not add another MCP tool” remains true.

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
  | { version: 1; type: 'accepted'; requestId: `sfp_req1_${string}`; operationId: string; operationKind: 'tool' | 'service'; operationName: string }
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
  maxRawArgsBytesPerOperation: 9437180;
  maxRawArgsBytesPerOwner: 67108864;
}
~~~

Malformed outer/inner framing, unknown fields, invalid IDs, missing requestId, registry misses, and over-limit input are native admission rejections: no operation ID/record, `accepted`, progress, runtime, or terminal operation frame. Every recoverably admitted tool/service request has its initial durable operation row before exactly one `accepted` frame, then zero or more progress frames and exactly one terminal result/error. From acceptance onward one generation-fenced terminal CAS arbitrates runtime, validation, cancel, deadline, disconnect recovery, and demotion; every loser observes the winner and emits no second terminal. All schemas are strict and versioned. Section 3.12 owns inclusive phase/message/frame/subscriber/rate boundaries. The terminal frame takes an exclusive direct write/drain slot outside the bounded nonterminal subscriber queue and blocks later progress. If direct terminal drain misses the absolute deadline, the transport closes while durable status remains queryable. Backpressure awaits drain and never grows an unbounded buffer.

Acceptance timing is deterministic: an approval-required operation emits accepted only after pending-approval fsync and before waiting; an operation requiring no approval emits accepted only after pre-egress reservation and durable queue admission, before dispatched transition. Policy/target/capacity/pre-egress rejection before acceptance is a typed admission rejection with runtime zero; any failure after acceptance goes through terminal CAS and emits one terminal frame.

Task 6 authenticates/decrypts follower RPC and hands Task 7 only `AuthenticatedFollowerPlaintext`. Task 7 then parses exactly one inner four-byte unsigned big-endian length plus strict MessagePack `InvocationRequestV1`, `ServiceOperationRequestV1`, or `InvocationCancelV1`; it never sees or reimplements outer challenge/auth/replay/encryption/caps. The inner plaintext total is at most 9,437,184 bytes including the prefix, so declared payload is at most 9,437,180 bytes. Follower response inner frames use the same four-byte prefix and have cumulative plaintext cap 67,108,864 bytes. Control tool/service JSON is at most 9,437,184 bytes and streams `application/x-ndjson; charset=utf-8`; authenticated `/control/tools/cancel` accepts exact cancel and returns 202. Direct MCP logical request content obeys the same 9,437,184-byte bound before parse. All declared/chunked/prefix counters reject before allocation.

Task 7 owns shared frame/progress/cancel schemas, daemon adapters, and a fake plugin-port consumer only. It may define the plugin-facing `$progress`/`$cancel` schema and enforce a 67,108,864-byte plugin frame cap in daemon/fake tests, but it does not modify or claim the real plugin consumer. Exact plugin UI/main/dispatcher consumption, listener cleanup, cancel forwarding, and parity tests are Task 9A; release-artifact parity is Task 15. Direct MCP maps progress/cancel to the standard progress token/cancellation notification. A transport disconnect does not implicitly cancel, retry, or issue a new operation ID.

Progress extends only the idle deadline; it never extends the absolute deadline. Absolute deadline, exact-origin-session `InvocationCancelV1`, plane demotion, and runtime AbortSignal are authoritative. Cancellation is idempotent and requires stable actor plus exact `originAuthSessionId`, requestId, and operationId; owner-admin control may resolve but cannot cross-session cancel. Snapshot, ordered PDF, and video export emit through the same reporter. Pre-execution/final egress manifests contain only classes/counts/hash/reason metadata.

The authenticated follower inner logical media type is exactly `application/x-sfp-msgpack-stream`; Task6 may wrap/encrypt externally but delivers only authenticated decrypted plaintext to Task7.

### 3.12 Inclusive Limits, Admission, and Boundary Fixtures

Every row has table-driven `below`, `exact`, and `above` tests for declared length and chunked/streamed input where applicable. Counters run before allocation, concatenation, base64/MessagePack/JSON decode, journal append, queueing, or runtime. “Exact held” means persisted state at the cap is valid but the next admission fails; “exact triggers” means the threshold operation runs compaction; “expired exact” means `now - issuedAt >= TTL`.

| Authority | Below | Exact boundary | Above / next admission |
|---|---|---|---|
| operation ID horizon | `< 2,592,000,000 ms` valid | `2,592,000,000 ms` expired, runtime zero | expired, runtime zero |
| operation ID future skew | `< 300,000 ms` valid | `300,000 ms` valid | invalid, runtime zero |
| action nonce TTL | `< 120,000 ms` valid | `120,000 ms` expired | expired |
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
| pair/abdicate body | `16,383` bytes valid | `16,384` valid | `16,385` rejected by Task 6 before JSON decode |
| follower decrypted request | total `9,437,183` valid | total `9,437,184` valid, including 4-byte prefix and payload `9,437,180` | prefix declaration or stream byte `9,437,185` rejected before allocation/MessagePack |
| control/direct MCP logical request | `9,437,183` bytes valid | `9,437,184` valid | `9,437,185` rejected before JSON/schema parse |
| follower response cumulative | `67,108,863` bytes valid | `67,108,864` valid | next byte aborts stream without changing durable terminal state |
| plugin WebSocket frame | `67,108,863` bytes valid | `67,108,864` valid | next byte rejected before decode |
| decoded/base64 image | `6,291,455` decoded and `8,388,607` base64 valid | `6,291,456` decoded and `8,388,608` base64 valid | above either bound rejected before plugin runtime |
| video result | `50,331,647` bytes valid | `50,331,648` valid | next byte returns `EXPORT_TOO_LARGE` without partial result |
| completed-result cache | below 128 entries/8,388,608 bytes/60,000 ms is resident | exact count/bytes resident; age exactly 60,000 ms expires | count/bytes admission evicts LRU; age above expires; durable settled rule remains |

Active-memory admission is additionally exact: maximum 256 active operations per owner actor, 64 per `originAuthSessionId`, eight subscribers per operation, 256 subscribers per owner, 9,437,180 raw-argument bytes per operation, and 67,108,864 aggregate raw-argument bytes per owner. These values bound one OS user's concurrent work, prevent one connection from monopolizing all slots, cap subscriber buffering to at most 64 MiB, and allow seven near-maximum requests without retaining unbounded payloads. Count/byte reservations happen before retaining raw args; equality is allowed, the next admission is native `SERVER_BUSY` with no operation record/runtime, and all reservations release in `finally` after terminal durability. Duplicate requestId while active is native `REQUEST_ID_CONFLICT`.

`packages/mcp/test/execution/boundary-limits.test.ts` is the single table authority and imports the production constants. It covers below/exact/above, declared/chunked, pre-decode/runtime-zero, active operation/subscriber/raw-args admission, malformed/missing requestId native rejection, and exact-one-terminal races among result/cancel/deadline/demotion.

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
  docs/architecture.md
  docs/build-vs-buy.md
  docs/capability-matrix.md
  docs/compatibility.md
  docs/desktop-acceptance.md
  docs/operation-policy.md
  docs/pairing.md
  docs/snapshot-format.md
  docs/evidence-schema.json
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
  scripts/smoke-installed-mcp.mjs
  scripts/desktop-acceptance.mjs
  scripts/install-release-artifacts.mjs
  scripts/sign-evidence.mjs
  scripts/verify-evidence-signature.mjs
  packages/shared/src/auth.ts
  packages/shared/src/action-nonce.ts
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
  packages/ir/src/canonical-json.ts
  packages/ir/src/fidelity.ts
  packages/ir/src/grounding-graph-v1.ts
  packages/ir/src/snapshot-v1.ts
  packages/ir/src/snapshot-storage.ts
  packages/ir/src/store.ts
  packages/mcp/src/runtime-paths.ts
  packages/mcp/src/tool-invocation-service.ts
  packages/mcp/src/index.ts
  packages/mcp/src/dispatch.ts
  packages/mcp/src/election/follower.ts
  packages/mcp/src/election/election.ts
  packages/mcp/src/election/leader-endpoints.ts
  packages/mcp/src/election/node.ts
  packages/mcp/src/relay/relay.ts
  packages/mcp/src/relay/session.ts
  packages/mcp/src/tools/runtime-registry.ts
  packages/mcp/src/security/state-permissions.ts
  packages/mcp/src/security/pairing-manager.ts
  packages/mcp/src/security/follower-auth.ts
  packages/mcp/src/security/request-limits.ts
  packages/mcp/src/security/principal-derivation.ts
  packages/mcp/src/policy/approval-gate.ts
  packages/mcp/src/policy/egress-policy.ts
  packages/mcp/src/policy/operation-policy.ts
  packages/mcp/src/policy/policy-engine.ts
  packages/mcp/src/policy/result-egress-policy.ts
  packages/mcp/src/execution/file-queue.ts
  packages/mcp/src/execution/execution-plane.ts
  packages/mcp/src/execution/target-resolver.ts
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
  packages/mcp/src/fs/workspace-policy.ts
  packages/mcp/src/network/remote-image-fetcher.ts
  packages/mcp/src/network/remote-domain-config-store.ts
  packages/mcp/src/control/approval-endpoints.ts
  packages/mcp/src/control/action-nonce-endpoints.ts
  packages/mcp/src/control/action-nonce-store.ts
  packages/mcp/src/control/operation-endpoints.ts
  packages/mcp/src/control/workspace-endpoints.ts
  packages/mcp/src/control/network-domain-endpoints.ts
  packages/mcp/src/control/snapshot-endpoints.ts
  packages/mcp/src/control/tool-call-endpoint.ts
  packages/mcp/src/snapshot/capture-snapshot.ts
  packages/mcp/src/snapshot/build-grounding-graph.ts
  packages/mcp/src/snapshot/workspace-snapshot-storage.ts
  packages/mcp/src/tools/doctor.ts
  packages/mcp/src/tools/export-tokens.ts
  packages/mcp/src/tools/export-frames-to-pdf.ts
  packages/mcp/src/tools/import-library-variable.ts
  packages/mcp/test/execution/action-nonce.test.ts
  packages/mcp/test/execution/boundary-limits.test.ts
  packages/mcp/test/execution/egress-manifest-store.test.ts
  packages/mcp/test/execution/execution-plane-lifecycle.test.ts
  packages/mcp/test/execution/follower-stream.test.ts
  packages/mcp/test/execution/invocation-boundary.test.ts
  packages/mcp/test/execution/no-direct-relay.test.ts
  packages/mcp/test/execution/progress-framing.test.ts
  packages/mcp/test/execution/plugin-progress-adapter.test.ts
  packages/mcp/test/execution/target-resolution.test.ts
  packages/mcp/test/execution/service-operation-registry.test.ts
  packages/plugin/src/file-identity.ts
  packages/plugin/src/mutation-handler-contract.ts
  packages/plugin/src/handlers/import-library-variable.ts
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
  packages/cli/src/commands/network.ts
  packages/cli/src/commands/operations.ts
  packages/cli/src/compat/rust-tool-map.ts
  test/bootstrap.test.ts
  test/upstream-parity.test.ts
  test/tool-contract.test.ts
  test/docs-sync.test.ts
  test/artifact-contents.test.ts
  test/fixtures/assemble-baseline-artifacts.mjs
  test/acceptance-harness.test.ts
~~~

Workspace-root workflows are `.github/workflows/service-ci.yml` and `.github/workflows/service-release.yml`; their commands always use `working-directory: service`.

---

## 5. Dependency, Build, and Verification

| Package | Runtime dependencies |
|---|---|
| shared | `zod` 4.4.3, `@msgpack/msgpack` 3.1.3 |
| ir | `@sfp/shared` workspace, `zod` 4.4.3, Node crypto only; filesystem is an injected storage port implemented in MCP |
| mcp | `@modelcontextprotocol/server` 2.x lock-resolved, `ws` 8.21.3, `fdir` 6.5.0, `ignore` 7.0.6, `oxc-parser` 0.147.0, `pdf-lib` 1.17.1, shared/ir workspaces |
| plugin | Vue 3.5.41, VueUse 14.4.0, Lucide Vue 1.34.0, Zod 4.4.3, Vite 8.2.2 toolchain |
| cli | shared workspace and Node stdlib; `node:util.parseArgs` |

Published bundle closure is binding: MCP tsdown `alwaysBundle` contains `@sfp/shared` and `@sfp/ir`; CLI tsdown `alwaysBundle` contains `@sfp/shared`. Packed MCP/CLI manifests contain no `workspace:*` and no runtime dependency on private `@sfp/shared`/`@sfp/ir`; external public dependencies remain ordinary pinned/lock-resolved dependencies. Artifact tests install only `mcp.tgz` or `cli.tgz` into separate empty prefixes with fresh npm caches, run `npm ls --all`, MCP tool-list smoke, and CLI help/status smoke, and reject any resolved workspace path.

Root scripts:

~~~json
{
  "build": "pnpm -r run build",
  "typecheck": "pnpm -r run typecheck",
  "lint": "oxlint --deny-warnings .",
  "format:check": "oxfmt --check .",
  "knip": "knip",
  "test": "vitest run --exclude 'test/artifact-contents.test.ts'",
  "test:unit": "vitest run --exclude '**/test/e2e/**' --exclude 'test/artifact-contents.test.ts'",
  "test:e2e": "vitest run packages/mcp/test/e2e",
  "test:artifacts": "vitest run test/artifact-contents.test.ts",
  "verify": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test",
  "verify:release": "pnpm verify && node scripts/generate-sbom.mjs && node scripts/generate-notices.mjs && node scripts/package-artifacts.mjs && node scripts/generate-checksums.mjs && pnpm test:artifacts && node scripts/verify-artifacts.mjs",
  "desktop:acceptance": "node scripts/desktop-acceptance.mjs"
}
~~~

The general `test`/`verify` phase deliberately excludes `test/artifact-contents.test.ts`; `verify:release` invokes that suite only after `package-artifacts.mjs` has created all three artifacts. After Task 1 creates the lock, CI/release use only `pnpm install --frozen-lockfile`. `service/.gitattributes` fixes text LF, `.gitignore` excludes node_modules/dist/coverage/`.sfp`/temporary package artifacts, and `.editorconfig` fixes UTF-8/final newline.

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
                    → T11 section snapshot + graph + service1
                      → T12 atomic safe union (116/106/10; service1 unchanged)
                        → T13 CLI
                        → T14 skills/docs/build-vs-buy
                          → T15 hygiene/CI/release/SBOM/artifacts
                            → T16 automated acceptance harness
                              ├→ T17 Windows live evidence
                              └→ T18 macOS live evidence
~~~

The Review A/B/C amendment makes T11→T12 sequential: Task11 establishes service registry1 and both tasks mutate the closed-world authority trio, so parallel trees would conflict. Every edge is binding.

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
| 9 | three review slices: plugin auth/identity; approval/undo; URL removal/manifest, all within plugin package |
| 10 | grounding pin/file baseline/reconnect only |
| 11 | pure IR schemas plus injected workspace snapshot adapter/recursive assembler only |
| 12 | four hidden adapter implementations followed by one atomic registry/handler/manifest switch; counts cannot partially ship |
| 13 | control client and command mappings only; no daemon mutation implementation |
| 14 | skills and operator/build-vs-buy docs only |
| 15 | package/workflow/SBOM/checksum assembly only |
| 16 | fake/live acceptance harness and evidence schema only |
| 17 | Windows external evidence only |
| 18 | macOS external evidence only |

For Tasks 7–9 and 12, the spec reviewer records a decision for each named slice before the final Task-wide quality review. A rejected slice returns only that slice to its implementer; later slices do not mask it.

### 6.2 Mandatory Closed-world Commit Protocol for Tasks 8–16

This protocol applies to **every** service-mutating subcommit in Tasks 8–16, including 9A/9B/9C and 12A/12B; it is part of each later commit step even where the task-specific `git add` line lists only semantic files.

1. Add every new managed path to `service/vendor-rules.json.exclude` and sorted `service/upstream-lock.json.destinationClosure.serviceOwnedFiles`; update SHA-256 for every modified service-owned path without weakening/deleting prior authority.
2. Run `node service/scripts/vendor-upstreams.mjs --copy-only`; update `service/upstream-lock.json` with resulting vendor-map SHA/counts and final service-owned hashes.
3. Run `node service/scripts/verify-upstream-lock.mjs --offline` and `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`.
4. Stage the task/subcommit's exact semantic allowlist **plus** `service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`. `git status --short -- service` may show only first-column staged allowlisted paths; no unstaged/untracked service path is allowed.
5. Run `git diff --cached --check` and `git write-tree`; record the tree. Independent spec and quality reviewers inspect that exact staged tree. A finding invalidates the tree and requires fix, restage, new tree, and both reviews again.
6. Rerun the task's exact GREEN, full Task 6 security suite when transport/entry code is touched, and both authority commands. Require no unstaged path and the same `git write-tree`; commit the task's already specified exact subject and verify `HEAD^{tree}` equals the reviewed tree.

No Task 8–16 commit may defer authority updates to Task 15, and copied upstream classification may not replace a service-owned row merely to satisfy closure.

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

`vendor-upstreams.mjs --copy-only` runs `git -C code-kb/figwright ls-files`, applies copy/referenceOnly modes, copies only source/test/skill/build files, computes SHA-256, writes sorted `vendor-map.json`, and performs AST package-specifier rewrites only for `@figwright/shared`, `@figwright/mcp`, and `@figwright/plugin`. A separate `--merge-manifests` mode applies only mergeDependencyManifests after 2A is frozen. Root/package/lock/config files created by Task 1 are hash-checked before and after and must not be replaced. Deterministic manifest merge preserves service authority, drops upstream postinstall/release scripts, and rewrites workspace dependency names.

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

Reviewer checks deterministic sort/hash behavior, Windows path handling, namespace rewrite scope, and offline release verification.

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
- Produces: contracts in section 3.5; authenticated control middleware but **not** `/control/tools/call`; opaque `FollowerAuthenticatedTransport`; follower/control rotation; strict public `/ping` exact `{ok,product,protocolVersion,serverVersion,buildId,leaderGeneration,role}`; `/pair/exchange`; `/ws`.

**Frozen handoff:** Task6 final reviewed base is `dcbba9b919c8a54e3c33719e1964129b41f858fe`; contract hash is `6a68c9405a2feebce439d105fe83199c6aef4538f9ebf3bd14963ffa4309c7b3`. Tasks7A/7B/7C consume it opaquely and rerun `pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/relay` without weakening tests.

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

Keep loopback Host validation. Implement the literal OPTIONS and actual POST success/error CORS/PNA/Vary contracts and allowed/hostile/absent-Origin matrix from section 3.5, require JSON content type/body cap on exchange, require `/ws` path, and configure WS maxPayload. A single response helper applies allowed-Origin headers before every safe typed POST success/error/500 write; rejected Origin uses a separate no-oracle helper. `/control/pair/challenge` is control-authenticated Node traffic and never receives CORS/PNA headers. `/ping` returns only exact `PublicPingV1`, including leaderGeneration and excluding every plugin/session/file oracle; foreign/lookalike 2xx is not a leader.

- [ ] **Step 5: Implement follower/control credentials**

Generate distinct credentials per leader generation under stateRoot. Require Task 6 challenge/replay/auth/encryption on `/rpc`/`/abdicate`, control auth on `/control/*`, rotate on handoff, reject old tokens, and make Unknown role fail before sending args. Export only `FollowerAuthenticatedTransport` authenticated plaintext/response methods; do not expose key material or add `/control/tools/call` in this Task.

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

- Create/modify shared wire/policy authority: `service/packages/shared/src/invocation.ts`, `action-nonce.ts`, `progress.ts`, `rpc.ts`, `envelope.ts`, `protocol.ts`, `operations.ts`, `service-operations.ts`, `index.ts`.
- Create operation/identity/target core: `service/packages/mcp/src/execution/execution-plane.ts`, `target-resolver.ts`, `service-operation-registry.ts`, `file-queue.ts`, `operation-id.ts`, `operation-journal.ts`, `operation-resolution-intent.ts`, `operation-executor.ts`; create `service/packages/mcp/src/security/principal-derivation.ts` and `service/packages/mcp/src/tool-invocation-service.ts`.
- Create approval/control/action-nonce authority: `service/packages/mcp/src/policy/approval-gate.ts`; `service/packages/mcp/src/control/action-nonce-store.ts`, `action-nonce-endpoints.ts`, `approval-endpoints.ts`, `tool-call-endpoint.ts`, `workspace-endpoints.ts`, `operation-endpoints.ts`.
- Create durable egress/progress authority: `service/packages/mcp/src/policy/egress-policy.ts`, `service/packages/mcp/src/execution/egress-manifest-store.ts`.
- Modify policy/spec/runtime and every production entry that must converge on the plane: `service/packages/mcp/src/policy/operation-policy.ts`, `policy-engine.ts`, `result-egress-policy.ts`, `service/packages/mcp/src/tools/spec.ts`, `registry.ts`, `runtime-registry.ts`, `index.ts`, `dispatch.ts`, `relay/relay.ts`, `relay/session.ts`, `election/election.ts`, `election/follower.ts`, `election/leader-endpoints.ts`, `election/node.ts`.
- Create/modify tests: `service/packages/mcp/test/execution/{operation-id,file-queue,operation-journal,operation-executor,execution-plane-lifecycle,invocation-boundary,target-resolution,target-requirement,runtime-authority,policy-context,service-operation-registry,no-direct-relay,action-nonce,operation-resolution,egress-policy,egress-manifest-store,egress-finalizer,boundary-limits,progress-transport,progress-framing,plugin-progress-adapter,follower-stream,control-tool-call,workspace-endpoints}.test.ts`; modify matching policy, dispatch, election, relay, security, and E2E process/wire suites.
- Modify closed-world authorities in every slice: `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. Task 7 uses the existing Task 2 authority schema/verifier and does not weaken or redesign it.

**Interfaces**

- Consumes: Task3 ToolSpec/result/runtime baseline, Task4 state/workspace/path, Task5 PolicyInvocationContext/policies/egress, and frozen Task6 PublicPingV1/opaque FollowerAuthenticatedTransport/control/Relay at `dcbba9b919c8a54e3c33719e1964129b41f858fe` with contract hash `6a68c9405a2feebce439d105fe83199c6aef4538f9ebf3bd14963ffa4309c7b3`.
- Produces: leader-generation singleton `ExecutionPlane`; follower-only `FollowerInvocationClient`; strict tool/service/cancel/frame schemas; one stable owner actor plus domain-separated MCP/control auth sessions; immutable `RuntimeExecutionScope extends PolicyInvocationContext`; `OperationInvocationService`; exact handler vs execution authorities (105/7 and 98/14); empty service-operation registry; `OperationIdIssuer`; kind/name-aware journal/tombstone/resolution; durable exactly-once egress finalizer; bounded active admission; `FileExecutionKey` queue; approval/action-nonce/progress/fake-plugin adapters; `JournalWorkspaceUsageGuard`; authenticated tool/cancel/approval/workspace/operation admin routes. It does not wire the real plugin progress/cancel consumer.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 7A — operation, policy, principal, target, and journal core | one owner actor/auth-session derivation, Task5 path-first policy context, handler/execution split14, TargetRequirement, empty service registry, strict admission, issuer/queue/journal, dispatched-fsync ordering, bounded two-phase demotion, opaque follower client | policy/authority/target/ownership/role-transition/demotion/crash-boundary plus ID/queue/journal/limit suites | `feat(execution): add issued idempotent journaled file queue`; exports frozen `RuntimeExecutionScope`, operation/service/journal/usage interfaces to 7B |
| 7B — approval, authenticated admin control, and action nonce | approval durability, nonce issue/CAS/caps/canonical request hash, tool/approval/workspace/operation admin endpoints, cross-domain same-owner resolution audit | control rotation, origin/resolver sessions, cross-session cancel denial, foreign stateRoot, nonce and resolve/workspace-unblock suites | `feat(control): add approved workspace and operation control`; exports authenticated routes and nonce router to Tasks 8/13 |
| 7C — egress finalizer, inner progress/framing, and production integration | durable pre/final manifest store, runtime-zero enforcement, Task6-decrypted follower inner framing, control/MCP plus daemon fake-plugin progress/cancel, active admission, every tool invocation entry, generation-fenced terminal CAS | finalizer exit/restart/double/crash, inclusive limits, backpressure/cancel/terminal race, cross-entry parity, no-direct-relay/no-auth-import structural suites | `feat(egress): gate runtime and stream bounded progress`; Task 8 consumes only after all reviewed 7A–7C tree/commit hashes are frozen |

Each subtask receives RED→GREEN, closed-world authority regeneration, and two independent reviews of one exact staged tree before its exact commit. Reviewers inspect `git diff --cached` plus the recorded `git write-tree` hash and do not edit. After either finding, the implementer fixes, restages, recomputes the tree, and repeats both reviews. Immediately before commit, rerun the slice GREEN, prove no unstaged tracked change, prove `git write-tree` still equals the reviewed hash, and after commit prove `HEAD^{tree}` equals it. The three already-reviewed subjects above remain binding; the amendment strengthens their contents and does not silently rename or add a fourth aggregate commit. Task 7 final review checks cross-slice execution order and authority closure without reopening an accepted tree absent a concrete finding.

For every slice, `git status --short -- service` must show only first-column staged entries from that slice's exact allowlist: no unstaged or untracked service path. `git diff --cached --name-only` must equal the allowlist subset actually changed by the slice, and the offline closed-world verifier must account for every managed path. Test output and ignored build artifacts are never staged.

7A defines the plane with injected `ApprovalDecisionPort`, `EgressManifestPort`, and `PinnedPluginRuntimePort` contracts and explicit fakes; it freezes policy/target/runtime/service seams but does not claim production entry convergence while 7B/7C are absent. 7B binds real approval/admin/action-nonce ports. 7C binds durable egress and daemon frame sinks, then atomically switches all tool invocation entries and the empty service seam to the plane. Task 7's plugin sink remains a fake; real plugin consumption is Task 9A. Only 7C requires zero legacy Relay/runtime bypass and zero import from Task 6 auth/key/encryption internals. Intermediate slices are review checkpoints, not releases.

Closed-world regeneration order is binding in every slice: add every new service-owned managed path to `vendor-rules.json.exclude` and `upstream-lock.json.destinationClosure.serviceOwnedFiles`; update hashes for already-owned modified paths; run `node service/scripts/vendor-upstreams.mjs --copy-only`; then update the resulting `vendorMap.sha256`/counts and final current SHA-256 values in `upstream-lock.json`; finally run the offline verifier and exact vendor test command. Do not weaken managed roots, delete another service-owned row, or reclassify Task 1–6 service authority as upstream copy to make verification pass.

Before and after each 7A/7B/7C staged review, run the frozen Task6 command verbatim: `pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/relay`. Task7 may add assertions but cannot weaken it. Reports record base `dcbba9b919c8a54e3c33719e1964129b41f858fe` and contract hash `6a68c9405a2feebce439d105fe83199c6aef4538f9ebf3bd14963ffa4309c7b3`.

**Exact staged path allowlists**

- 7A: `service/packages/shared/src/invocation.ts`, `service/packages/shared/src/operations.ts`, `service/packages/shared/src/service-operations.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/security/principal-derivation.ts`, `service/packages/mcp/src/policy/operation-policy.ts`, `service/packages/mcp/src/policy/policy-engine.ts`, `service/packages/mcp/src/policy/result-egress-policy.ts`, `service/packages/mcp/src/tools/runtime-registry.ts`, `service/packages/mcp/src/execution/execution-plane.ts`, `service/packages/mcp/src/execution/target-resolver.ts`, `service/packages/mcp/src/execution/service-operation-registry.ts`, `service/packages/mcp/src/execution/file-queue.ts`, `service/packages/mcp/src/execution/operation-id.ts`, `service/packages/mcp/src/execution/operation-journal.ts`, `service/packages/mcp/src/execution/operation-resolution-intent.ts`, `service/packages/mcp/src/execution/operation-executor.ts`, `service/packages/mcp/src/tool-invocation-service.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/src/election/election.ts`, `service/packages/mcp/src/election/follower.ts`, `service/packages/mcp/src/election/node.ts`, `service/packages/mcp/src/relay/session.ts`, `service/packages/mcp/src/tools/ping.ts`, `service/packages/mcp/test/execution/invocation-boundary.test.ts`, `service/packages/mcp/test/execution/policy-context.test.ts`, `service/packages/mcp/test/execution/target-resolution.test.ts`, `service/packages/mcp/test/execution/target-requirement.test.ts`, `service/packages/mcp/test/execution/runtime-authority.test.ts`, `service/packages/mcp/test/execution/service-operation-registry.test.ts`, `service/packages/mcp/test/execution/execution-plane-lifecycle.test.ts`, `service/packages/mcp/test/execution/operation-id.test.ts`, `service/packages/mcp/test/execution/file-queue.test.ts`, `service/packages/mcp/test/execution/operation-journal.test.ts`, `service/packages/mcp/test/execution/operation-executor.test.ts`, `service/packages/mcp/test/policy/operation-policy.test.ts`, `service/packages/mcp/test/policy/result-egress-policy.test.ts`, `service/packages/mcp/test/election/election.test.ts`, `service/packages/mcp/test/election/follower.test.ts`, `service/packages/mcp/test/election/node.test.ts`, `service/packages/mcp/test/relay/session.test.ts`, `service/packages/mcp/test/tools/ping.test.ts`, `service/test/tool-contract.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7A.
- 7B: `service/packages/shared/src/action-nonce.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/policy/approval-gate.ts`, `service/packages/mcp/src/control/action-nonce-store.ts`, `service/packages/mcp/src/control/action-nonce-endpoints.ts`, `service/packages/mcp/src/control/approval-endpoints.ts`, `service/packages/mcp/src/control/tool-call-endpoint.ts`, `service/packages/mcp/src/control/workspace-endpoints.ts`, `service/packages/mcp/src/control/operation-endpoints.ts`, `service/packages/mcp/src/election/leader-endpoints.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/test/execution/action-nonce.test.ts`, `service/packages/mcp/test/execution/control-tool-call.test.ts`, `service/packages/mcp/test/execution/operation-resolution.test.ts`, `service/packages/mcp/test/execution/workspace-endpoints.test.ts`, `service/packages/mcp/test/election/leader-endpoints.test.ts`, `service/packages/mcp/test/security/control-auth.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7B.
- 7C: `service/packages/shared/src/progress.ts`, `service/packages/shared/src/rpc.ts`, `service/packages/shared/src/envelope.ts`, `service/packages/shared/src/protocol.ts`, `service/packages/shared/src/operations.ts`, `service/packages/shared/src/service-operations.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/policy/egress-policy.ts`, `service/packages/mcp/src/execution/egress-manifest-store.ts`, `service/packages/mcp/src/execution/execution-plane.ts`, `service/packages/mcp/src/tool-invocation-service.ts`, `service/packages/mcp/src/tools/runtime-registry.ts`, `service/packages/mcp/src/relay/relay.ts`, `service/packages/mcp/src/relay/session.ts`, `service/packages/mcp/src/dispatch.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/src/election/election.ts`, `service/packages/mcp/src/election/follower.ts`, `service/packages/mcp/src/election/leader-endpoints.ts`, `service/packages/mcp/src/election/node.ts`, `service/packages/mcp/test/execution/egress-policy.test.ts`, `service/packages/mcp/test/execution/egress-manifest-store.test.ts`, `service/packages/mcp/test/execution/egress-finalizer.test.ts`, `service/packages/mcp/test/execution/boundary-limits.test.ts`, `service/packages/mcp/test/execution/progress-transport.test.ts`, `service/packages/mcp/test/execution/progress-framing.test.ts`, `service/packages/mcp/test/execution/plugin-progress-adapter.test.ts`, `service/packages/mcp/test/execution/follower-stream.test.ts`, `service/packages/mcp/test/execution/no-direct-relay.test.ts`, `service/packages/mcp/test/execution/execution-plane-lifecycle.test.ts`, `service/packages/mcp/test/execution/service-operation-registry.test.ts`, `service/packages/mcp/test/dispatch.test.ts`, `service/packages/mcp/test/election/election.test.ts`, `service/packages/mcp/test/election/follower.test.ts`, `service/packages/mcp/test/election/leader-endpoints.test.ts`, `service/packages/mcp/test/election/leader-lock.test.ts`, `service/packages/mcp/test/election/node.test.ts`, `service/packages/mcp/test/relay/relay.test.ts`, `service/packages/mcp/test/relay/session.test.ts`, `service/packages/mcp/test/e2e/mcp-wire.test.ts`, `service/packages/mcp/test/e2e/process-lifecycle.test.ts`, `service/test/tool-contract.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7C.

Binding 7A allowlist extension: add exactly `service/packages/mcp/src/tools/spec.ts` and `service/packages/mcp/src/tools/registry.ts` to the 7A line above; “No other path” applies to the resulting union. They carry only the handlerAuthority/TargetRequirement finalization needed by 7A.

**Binding subtask execution**

- [ ] **7A RED:** Add strict tests first, then run `pnpm -C service exec vitest run packages/mcp/test/execution/invocation-boundary.test.ts packages/mcp/test/execution/policy-context.test.ts packages/mcp/test/execution/target-resolution.test.ts packages/mcp/test/execution/target-requirement.test.ts packages/mcp/test/execution/runtime-authority.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/execution-plane-lifecycle.test.ts packages/mcp/test/execution/operation-id.test.ts packages/mcp/test/execution/file-queue.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/operation-executor.test.ts`; expect missing distinct policy context/path-first resolution, stable owner/auth sessions, target/runtime/service seams, bounded demotion, issued ID/queue/journal/executor. Frozen Task 6 remains green.
- [ ] **7A GREEN:** Implement only 7A core with injected fake later-slice ports. Run the exact 7A RED command; `pnpm -C service exec vitest run packages/mcp/test/policy packages/mcp/test/election packages/mcp/test/relay packages/mcp/test/tools/ping.test.ts test/tool-contract.test.ts`; the full frozen Task 6 command; and `pnpm -C service typecheck`. Expect `PolicyInvocationContext.resolvedPaths`, exact handler105/7 vs execution98/14, target rules, empty service registry, one actor/stable MCP auth across roles, origin-session cancel guard, 5,000/1,000 ms demotion, dispatched-fsync crash boundaries, signed-ID replay/conflict, journal caps, and no follower executor/auth import. Final entry cutover remains 7C.
- [ ] **7A authority, staged review, and exact commit:** Register every added/changed managed file in `vendor-rules.json` exclusion authority and sorted `upstream-lock.json.destinationClosure.serviceOwnedFiles`, run `node service/scripts/vendor-upstreams.mjs --copy-only` to regenerate `vendor-map.json`, and run `node service/scripts/verify-upstream-lock.mjs --offline` plus `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`. Stage only the exact 7A shared invocation/operations/index, execution/security/principal/target/follower/lifecycle files and tests, and the three authority files; reject any staged path outside that reviewed allowlist with `git diff --cached --name-only`. Run `git diff --cached --check`; run `git write-tree` and record its stdout as `TREE_7A`; obtain independent spec and quality PASS decisions naming `TREE_7A`; rerun the exact 7A GREEN and authority commands; require `git diff --name-only` empty and a second `git write-tree` equal to `TREE_7A`; then run `git commit -m "feat(execution): add issued idempotent journaled file queue"`. Require `git rev-parse "HEAD^{tree}"` equals `TREE_7A` and record tree+commit hashes.
- [ ] **7B RED:** Add tests first, then run `pnpm -C service exec vitest run packages/mcp/test/execution/action-nonce.test.ts packages/mcp/test/execution/control-tool-call.test.ts packages/mcp/test/execution/operation-resolution.test.ts packages/mcp/test/execution/workspace-endpoints.test.ts packages/mcp/test/execution/invocation-boundary.test.ts`; expect missing durable pending approval, strict admin/nonce routes, same-owner cross-domain resolution, resolver-session audit, and cross-session cancel denial while all 7A gates stay green.
- [ ] **7B GREEN:** Implement approval/tool/workspace/operation admin/action-nonce endpoints, update the exact 7B authority trio, then run the `7B_GREEN_COMMANDS` block below verbatim. Expect `sfp_an1_`+256-bit format; exact realPath/FQDN request hashing without Unicode alias; 120,000 ms TTL; 1,024/524,288 caps; durable pending approval before wait; one CAS winner; consumed retention/restart/generation invalidation; stable control actor with rotating auth session; same-owner MCP/follower operation list/status/resolve; resolver audit; foreign stateRoot/cross-session cancel denial; reserve and workspace unblock.
- [ ] **7B authority, staged review, and exact commit:** Stage only the exact 7B allowlist, check staged names/diff, record `TREE_7B`, and obtain independent spec+quality PASS. Rerun the entire `7B_GREEN_COMMANDS` block **verbatim**; require no unstaged service path and identical tree; commit exact `feat(control): add approved workspace and operation control`; verify `HEAD^{tree}=TREE_7B`.
- [ ] **7C RED:** Add tests first, then run `pnpm -C service exec vitest run packages/mcp/test/execution/egress-policy.test.ts packages/mcp/test/execution/egress-manifest-store.test.ts packages/mcp/test/execution/egress-finalizer.test.ts packages/mcp/test/execution/boundary-limits.test.ts packages/mcp/test/execution/progress-transport.test.ts packages/mcp/test/execution/progress-framing.test.ts packages/mcp/test/execution/plugin-progress-adapter.test.ts packages/mcp/test/execution/follower-stream.test.ts packages/mcp/test/execution/no-direct-relay.test.ts`; expect missing exactly-once finalizers, inclusive admission limits, Task6-decrypted inner framing, daemon fake-plugin adapter, terminal CAS, and production convergence while 7A/7B stay green.
- [ ] **7C GREEN:** Implement egress finalization, strict inner frames/admission, daemon/fake-plugin adapters, and all tool/service production entry convergence. Run `pnpm -C service exec vitest run packages/mcp/test/execution packages/mcp/test/policy packages/mcp/test/election packages/mcp/test/relay packages/mcp/test/dispatch.test.ts packages/mcp/test/e2e/mcp-wire.test.ts packages/mcp/test/e2e/process-lifecycle.test.ts test/tool-contract.test.ts`; the full frozen Task 6 command; `pnpm -C service typecheck`; and both authority commands. Expect every section 3.12 boundary, runtime-zero native reject, durable finalizers, inner framing, control/MCP/fake-plugin progress/cancel, exact-one terminal, demotion cleanup, no Task6 auth imports, empty service registry, and full tool-entry parity. Real plugin consumer remains absent until Task 9A.
- [ ] **7C authority, staged review, and exact commit:** Update closed-world authorities, run `node service/scripts/vendor-upstreams.mjs --copy-only`, then run `node service/scripts/verify-upstream-lock.mjs --offline` plus `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`. Stage only the exact 7C allowlist above; check `git diff --cached --name-only` and `git diff --cached --check`; run `git write-tree` and record stdout as `TREE_7C`; obtain independent spec+quality PASS on that tree; rerun the exact 7C GREEN and authority commands; require `git diff --name-only` empty and a second `git write-tree` equal to `TREE_7C`; then run `git commit -m "feat(egress): gate runtime and stream bounded progress"`. Require `git rev-parse "HEAD^{tree}"` equals `TREE_7C` and record tree+commit hashes.

**`7B_GREEN_COMMANDS` — copy/paste without path substitution before staging review and again before commit:**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/execution/action-nonce.test.ts packages/mcp/test/execution/control-tool-call.test.ts packages/mcp/test/execution/operation-resolution.test.ts packages/mcp/test/execution/workspace-endpoints.test.ts packages/mcp/test/execution/invocation-boundary.test.ts packages/mcp/test/execution/policy-context.test.ts packages/mcp/test/execution/target-resolution.test.ts packages/mcp/test/execution/target-requirement.test.ts packages/mcp/test/execution/runtime-authority.test.ts packages/mcp/test/execution/service-operation-registry.test.ts packages/mcp/test/execution/execution-plane-lifecycle.test.ts packages/mcp/test/execution/operation-id.test.ts packages/mcp/test/execution/file-queue.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/operation-executor.test.ts
pnpm -C service exec vitest run packages/mcp/test/security packages/mcp/test/election packages/mcp/test/relay
pnpm -C service exec vitest run packages/mcp/test/policy packages/mcp/test/tools/ping.test.ts test/tool-contract.test.ts
pnpm -C service typecheck
node service/scripts/vendor-upstreams.mjs --copy-only
node service/scripts/verify-upstream-lock.mjs --offline
pnpm -C service exec vitest run test/vendor-upstreams.test.ts
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
  await admission.parseAndEvaluate(requestFor('design_diff', { rootDir: '.', update: true, outPath }));
  expect(events).toEqual(['args-parsed', 'workspace-looked-up', 'paths-realpathed', 'effects-evaluated', 'target-resolved']);
  expect(policyContext.resolvedPaths).toMatchObject({ outPath: { path: canonicalOut, overwrites: true } });
  expect(contentRead).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(pluginRuntime).not.toHaveBeenCalled();
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
  relay.register(authenticatedSession({ sessionId: 'relay-a', generation: 'plugin-g1', fileIdentity: fileKey('file-1') }));
  const scope = await plane.resolveScope(principal, request({ targetSelector: { kind: 'session', sessionId: 'relay-a' } }));
  relay.setActive('relay-b');
  expect(scope.target).toMatchObject({ sessionId: 'relay-a', fileExecutionKey: 'figma:file-1' });
  expect(Object.isFrozen(scope.target)).toBe(true);
  expect(Object.isFrozen(scope.target.fileIdentity)).toBe(true);
});

it('fails instead of rerouting when the pinned session disappears', async () => {
  const running = plane.invokeTool(principal, request({ targetSelector: { kind: 'stable-file', fileIdentityHash } }));
  relay.disconnect('relay-a');
  await expect(terminal(running)).resolves.toMatchObject({ type: 'error', error: { code: 'PINNED_SESSION_LOST' } });
  expect(relay.dispatchesFor('relay-b')).toHaveLength(0);
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
  const a = plane.invokeTool(principalA, requestForSession('relay-a'));
  const b = plane.invokeTool(principalB, requestForSession('relay-b'));
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
  const opId = issuer.issue('a', fixedNow);
  journal.seed(succeededRecord({ actorId: 'a', operationId: opId, issuedAt: fixedNow, resultHash: 'sha256:r' }));
  await expect(restarted.invokeTool(ctxWithGeneration('g2'), 'create_text', args, opId))
    .rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED', resultHash: 'sha256:r' });
  await expect(restarted.invokeTool(ctxWithGeneration('g2'), 'create_text', { text: 'different' }, opId))
    .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  expect(runtime).not.toHaveBeenCalled();
});

it('fails new operations closed when unresolved rows hold the hard journal cap', async () => {
  const existingUnknownId = issuer.issue('a', fixedNow);
  journal.seedRows(10000, {
    status: 'outcome-unknown', normalBytes: 32505856,
    operationIdFactory: index => index === 0 ? existingUnknownId : issuer.issue('a', fixedNow + index + 1),
  });
  const newOpId = issuer.issue(ctx.actor.actorId, fixedNow);
  await expect(service.invokeTool(ctx, 'get_selection', {}, newOpId))
    .rejects.toMatchObject({ code: 'JOURNAL_CAPACITY_EXCEEDED' });
  expect(service.status('a', existingUnknownId)).toBeDefined();
});

it('fails new operations when the in-horizon tombstone index is full', async () => {
  journal.seedTombstones(1000000, { bytes: 268435456, unexpired: true });
  await expect(service.invokeTool(ctx, 'get_selection', {}, issuer.issue('a')))
    .rejects.toMatchObject({ code: 'JOURNAL_CAPACITY_EXCEEDED' });
  expect(await control.get('/control/operations?status=succeeded', actorToken)).toBeDefined();
});

it('recovers generation-bound states deterministically', async () => {
  const pendingId = issuer.issue('a', fixedNow);
  const queuedId = issuer.issue('a', fixedNow + 1);
  const dispatchedId = issuer.issue('a', fixedNow + 2);
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

it('issues and atomically consumes one action-bound 256-bit nonce', async () => {
  const claims = await control.post('/control/action-nonces', {
    action: 'workspace.add', requestHash: hashCanonical({ path: workspacePath }),
  }, actorToken);
  expect(claims.value).toMatch(/^sfp_an1_[A-Za-z0-9_-]{43}$/);
  clock.advance(119999);
  const attempts = await Promise.allSettled([
    addWorkspace(claims.value, workspacePath), addWorkspace(claims.value, workspacePath),
  ]);
  expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect(await nonceStore.get(claims.value)).toMatchObject({ state: 'consumed' });
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
  await expect(issueNonce(actor, 'workspace.add', requestHash)).rejects.toMatchObject({ code: 'ACTION_NONCE_CAPACITY_EXCEEDED' });
  await expect(restarted.consumeCas(actor, nonce, 'workspace.add', requestHash)).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
});

it('rejects forged and expired server-issued operation IDs before runtime', async () => {
  const issued = issuer.issue('a', nowMinusDays(31));
  await journal.purgeExpiredTombstones(now);
  await expect(service.invokeTool(ctx, 'create_text', args, issued))
    .rejects.toMatchObject({ code: 'OPERATION_ID_EXPIRED' });
  await expect(service.invokeTool(ctx, 'create_text', args, tamper(issued)))
    .rejects.toMatchObject({ code: 'OPERATION_ID_INVALID' });
  expect(runtime).not.toHaveBeenCalled();
});

it('resolves unknown work without permitting same-ID replay', async () => {
  const unknownId = issuer.issue('a', now);
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
  expect(journal.resolutionIntents.get(unknownId)?.status).toBe('resolved-not-applied');
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

Expected: FAIL because strict invocation/principal/target/leader-plane and executor/queue/journal modules are absent; Task 6 auth suites stay green.

- [ ] **Step 3: Implement queue and idempotency state machine**

Construct `ExecutionPlane` only from the elected leader-generation factory. It owns strict tool/service admission, one stable owner actor, domain-separated auth sessions, path-first `PolicyInvocationContext`, target requirement/lookup, deeply immutable `RuntimeExecutionScope`, handler/execution routing, queue/journal/approval/egress, and terminal CAS. Create the 128-bit MCP session before role choice; preserve its auth session on leader↔follower transition. Followers use only opaque `FollowerAuthenticatedTransport`; unknown/conflicted reject before serializing args. Consume exact Task 6 public ping including leaderGeneration and remove only active/plugin/session/file oracles. Resolve target from authenticated Relay, never body/file name; required pin loss is `PINNED_SESSION_LOST`.

Issue and verify operation IDs exactly as sections 3.3/3.12 before idempotency lookup. A first call without an ID receives a newly issued ID only after its initial operation row is durable, then `accepted`; control/CLI requests an ID before mutations. Exact `(actorId,operationId,operationKind,operationName,argsHash,workspaceId,fileExecutionKey)` shares one in-flight Promise; mismatch conflicts. The completed-result cache is exact 128 entries/8,388,608 bytes/60,000 ms with section 3.12 boundaries; eviction/restart leaves durable settled behavior. Stable actor permits exact replay across MCP role/control rotation, while cancellation remains origin-auth-session bound. Generation change uses the bounded prepare/finalize demotion protocol and terminal CAS. Allow four reads only when no same-file write is active, writes exclusive, exclusive-heavy alone. Before-dispatch flap may resume only same generation; after durable dispatched, flap appends+fsyncs unknown and never auto-replays. Structural tests reject literal IDs outside invalid fixtures and any production Relay/runtime bypass; valid fixtures use `OperationIdIssuer.issue`.

- [ ] **Step 4: Implement owner-state operation journal and recovery**

Append transitions under `stateRoot/journal/{actor-hash}.operations.v1.jsonl`, fsync each append, checksum compacted snapshots, retain unsettled/unknown records, mark recovered dispatched records unknown, and tolerate one truncated tail after crash. Apply `JournalLimits`: compact active transitions at 8,000 rows or 24 MiB; stop normal operation appends at 10,000 rows or 31 MiB of the 32 MiB active-state allocation; reserve the final exact 1 MiB exclusively for `resolution-intents.v1.jsonl`; keep the separate normal tombstone index through the signed horizon with a 1,000,000-entry/256 MiB cap. If unresolved transitions prevent active compaction, allow status/doctor/operation list-status-resolve only. Resolve appends and fsyncs one confirmation record to the reserve before changing state, immediately compacts the matching unknown row, and treats the resolution record itself as the no-replay tombstone when the normal tombstone index is full. Reserve records merge into the normal tombstone index only when capacity exists and purge after signed expiry. A full reserve fails `RESOLUTION_RESERVE_FULL` with a sanitized manual-export path and leaves the unknown record unchanged. Every other operation at normal cap fails `JOURNAL_CAPACITY_EXCEEDED`. Persist no raw result. Export `JournalWorkspaceUsageGuard.hasUnsettled(workspaceId)` for Task 4 store wiring.

Records carry `operationKind`/`operationName` and `originAuthSessionId`. Pending approval is appended+fsynced before waiting. Queue dispatch permission is not released until the dispatched transition fsync succeeds; only then may `PinnedPluginRuntimePort`, filesystem, or network observe the operation. Terminal append is generation-CAS fenced and occurs only after one durable egress finalizer. Table-driven crash injection after pending append, pre-manifest reserve, queue, dispatched append-before-fsync, dispatched fsync-before-side-effect, runtime, finalizer, and terminal proves the exact recovery state and runtime call count.

The manual-export guidance in that error is the literal command `sfp operations unresolved --json`; operators choose the output destination in their shell, so the daemon never writes an emergency export outside configured policy.

Before fsync, resolution-intent construction copies the active record’s signed issuedAt and complete tool/args/workspace/file/result fingerprint. Compaction may remove the active row only after that durable fingerprint exists, so reserved resolutions preserve settled-versus-conflict behavior without the normal tombstone index.

- [ ] **Step 5: Implement approvals and central control call**

`/control/tools/call` is routeClass tool and accepts only `InvocationRequestV1`; `/control/tools/cancel` accepts only `InvocationCancelV1` and enforces exact originAuthSession. MCP direct/follower and control tools use the same `invokeTool` plane path. The service-operation registry is exact empty in Task 7; no MCP registration/count changes. Task 11's snapshot endpoint later constructs `ServiceOperationRequestV1` and calls `invokeService`. Pair/workspace/network/approval/operation-resolution endpoints are routeClass admin and cannot pass a tool/service name or runtime. Approval endpoints append+fsync pending before wait, list redacted pending summaries, and settle exact approvalId once.

Mount authenticated `POST /control/action-nonces` with strict `{action,requestHash}` and section 3.3/3.12 rules. Every nonce-protected admin route semantically validates and resolves canonical realPath/FQDN first, recomputes exact byte hash, then atomically consumes immediately before side effect. Workspace add/remove uses JournalWorkspaceUsageGuard. Operation issue/list/status query the one stable owner actor, not the current auth session. Single-ID resolve accepts same-owner MCP/follower/control origins, records origin+resolver auth sessions, requires bound nonce/evidence/exact confirmation, fsyncs reserve, and never authorizes replay; foreign stateRoot fails. There is no bulk resolution. Cross-session cancel remains denied. Tests cover rotation, cross-domain resolution, wrong actor/generation/action/hash, Unicode-distinct path hashes, reuse/concurrency/expiry/restart, confirmation/evidence/reserve, and same-ID replay. Without paired UI/authenticated CLI waiter ordinary explicit approval is `APPROVAL_CHANNEL_UNAVAILABLE`.

- [ ] **Step 6: Implement result validation, egress ordering, and progress transport**

Execute exact section3.3: strict request→args/workspace/path-policy→effects→target/deep-frozen ResolvedInvocationScope→capacity→durable pending/approval→egress authorization and final RuntimeExecutionScope→pre-egress fsync/reserve→queue→dispatched fsync→first effect→result/classify/hash/redact→one finalizer fsync→terminal fsync→one frame. Unknown/cap/target/policy/reserve rejection is runtime zero; post-runtime breach finalizes unknown. Hashing omits its own hash field.

Use sections 3.11/3.12 exactly. Consume only Task6-authenticated decrypted follower plaintext, parse inner prefix before allocation, and keep Task6 outer transport opaque. Control uses bounded JSON/NDJSON; direct MCP uses the same logical cap and standard progress/cancel. Task 7 tests `$progress`/`$cancel` against a fake `PinnedPluginRuntimePort` only; Task 9A owns actual plugin listeners/wiring. Enforce inclusive phase/message/frame/rate/subscriber/active/raw-args caps, bounded drain, origin-auth-session cancel, and exact-one terminal CAS. Disconnect is never implicit retry/cancel.

- [ ] **Step 7: Run execution GREEN and cross-entry parity**

Run: `pnpm -C service exec vitest run packages/mcp/test/execution packages/mcp/test/policy packages/mcp/test/election packages/mcp/test/relay packages/mcp/test/security packages/mcp/test/dispatch.test.ts packages/mcp/test/e2e/mcp-wire.test.ts packages/mcp/test/e2e/process-lifecycle.test.ts test/tool-contract.test.ts`, then `node service/scripts/verify-upstream-lock.mjs --offline`, `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`, and `pnpm -C service typecheck`.

Expected: exact PublicPingV1/opaque Task6 transport remains green; one owner actor and role-stable MCP auth/rotating control auth pass; policy resolvedPaths/target rules/handler105-7/execution98-14/service0 pass; journal dispatched-fsync and 5,000/1,000 ms demotion crash gates pass; issued ID, same-ID, admin resolution/cancel boundary, queue, nonce, reservation/finalizer, all section 3.12 limits, exact-one terminal, and runtime-zero cases pass; only fake plugin progress consumer exists; direct Relay/auth-key bypass and unregistered service-owned files are zero.

- [ ] **Step 8: Request independent spec review**

For each staged tree, the spec reviewer traces all tool entries and empty service seam through one plane; checks Task5 policy/path preservation, frozen Task6 public/opaque boundary, stable actor/auth-session rules, target/runtime authorities, operation kind/name, exact journal/finalizer ordering, sections 3.11/3.12, admin route separation, and absence of real plugin consumer. The verdict names the `git write-tree` hash.

- [ ] **Step 9: Request independent quality review**

For the same tree, the quality reviewer checks owner/auth derivation hygiene, policy/target immutability, operation/terminal/finalizer CAS races, demotion tick/port failure, journal/egress crash recovery, active/raw/subscriber admission, opaque transport separation, result validation, framing/backpressure/cancel, sensitive audit, and closed-world closure.

- [ ] **Step 10: Verify the three-commit execution-plane handoff**

Run: `git diff --check`, `git log -3 --format="%H %T %s"`, full Task 7 GREEN/authority verification, then `git diff --exit-code`. Expected: the three original subjects exist in order; each tree equals its reviewed staged tree; worktree/index clean; frozen Task6 base/hash recorded; tool112, handler105/7, execution98/14, service registry0. Do not squash, rename subjects, or create a fourth aggregate commit.

### Task 8 — Confine filesystem access and move URL fetching into the daemon

**Files**

- Create: `service/packages/mcp/src/fs/atomic-file.ts`, `service/packages/mcp/src/network/remote-image-fetcher.ts`, `remote-domain-config-store.ts`.
- Create: `service/packages/mcp/src/control/network-domain-endpoints.ts`.
- Move/modify: `service/packages/mcp/src/repo-walk.ts` → `service/packages/mcp/src/fs/repo-walk.ts`; modify `service/packages/mcp/src/fs/workspace-policy.ts`.
- Modify: local tool modules `analyze-project.ts`, `scan-components.ts`, `component-map.ts`, `token-map.ts`, `icon-map.ts`, `design-diff.ts`, `save-screenshots.ts`, `save-image-fills.ts`, `export-pdf.ts`, `export-video.ts`.
- Modify: `service/packages/mcp/src/tools/runtime-registry.ts` so `import_image(url)` becomes a server wrapper that fetches bytes and dispatches `data`.
- Create: `service/packages/mcp/test/fs/local-tool-boundary.test.ts`, `atomic-file.test.ts`; `service/packages/mcp/test/network/remote-image-fetcher.test.ts`, `dns-pinning.test.ts`, `remote-domain-config.test.ts`, `import-image-runtime.test.ts`.

**Interfaces**

- Consumes: Task 4 WorkspacePolicy, Task 5 `PolicyInvocationContext.resolvedPaths`/effects, Task 7 immutable `RuntimeExecutionScope`, `PinnedPluginRuntimePort`, `server-adapter` routing, target rules, exact image/request limits, and action-nonce router.
- Produces: `AtomicFileStore.createNew/replace`, sandboxed `RepoReader`, DNS-pinned `RemoteImageFetcher`, `RemoteDomainConfigStore`, authenticated `/control/network/domains*`, safe `import_image` server runtime; no direct local tool fs access outside approved adapters. Task 11 consumes `WorkspacePolicy` and `AtomicFileStore` to build snapshot storage after IR owns the port.

**Commit protocol:** Section 6.2 applies to this commit; its staged allowlist is the Task 8 files plus the authority trio, and reviewers inspect the same tree.

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

- [ ] **Step 3: Run fs/network RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/fs packages/mcp/test/network`.

Expected: direct fs imports and URL plugin dispatch remain; symlink/redirect/size tests fail.

- [ ] **Step 4: Route every project read and write through adapters**

Inject WorkspacePolicy/RepoReader/AtomicFileStore into the ten listed local tools and token/profile/icon scanners. A structural test rejects `node:fs` and `node:fs/promises` imports outside `fs/`, state journal, packaging scripts, and explicitly approved read-only install metadata modules. Repo walk returns scanned/skipped/truncated counts. Do not define or import `SnapshotStoragePort` in Task 8; it exports only the two filesystem primitives that Task 11 later consumes.

- [ ] **Step 5: Implement atomic create-new and replacement semantics**

Create temp files in the target directory, fsync file, rename, fsync parent where supported, and clean temp on failure. `createNew` rejects existing output; `replace` requires destructive effect/approval. No output path is resolved outside a workspace.

- [ ] **Step 6: Implement RemoteImageFetcher and runtime conversion**

Apply every rule in section 3.10 inside the already path/policy/target-resolved scope. `import_image` remains handlerAuthority plugin-handler but execution `server-adapter`; it fetches/validates bytes then invokes only `PinnedPluginRuntimePort` on the frozen required target—never Relay/session resolution. Enforce decoded 6,291,456 and base64 8,388,608 exact inclusive limits before decode/plugin runtime, with declared/chunked below/exact/above tests. Approval and durable pre-egress admission precede DNS/fetch.

- [ ] **Step 7: Implement allowed-domain configuration and control routes**

Persist normalized exact FQDN rules under stateRoot with empty default. Mount `GET /control/network/domains`, `POST /control/network/domains` with `{fqdn,actionNonce}`, and `DELETE /control/network/domains/:fqdn` with `x-sfp-action-nonce` behind Task 6 control auth. The client first issues a Task 7 nonce for exact `network-domain.add`/`network-domain.remove` plus canonical request hash; these routes reuse Task 7 semantic-validate-then-CAS middleware and do not define another nonce store or wire shape. Reject `com`, `co.uk`, `example.com`, wildcard, leading/trailing dot, IP literal, port/path/userinfo, fewer-than-three labels, body-supplied actor/context, reused/misbound nonce, and approval-based expansion; accept exact ASCII `assets.example.com` and the `domainToASCII` result of a three-label Unicode host. Audit actor/time/exact FQDN only. There is no semantic public-suffix claim or PSL data in v0.1 because suffix matching is absent.

- [ ] **Step 8: Run fs/network GREEN**

Run: `pnpm -C service exec vitest run packages/mcp/test/fs packages/mcp/test/network packages/mcp/test/tools`, then `pnpm -C service typecheck`.

Expected: inside-root local tools pass; path escapes, direct fs imports, redirect-to-private, DNS change, MIME mismatch, chunked oversize, and unapproved fetch fail.

- [ ] **Step 9: Request independent spec review**

Reviewer confirms workspaceId-null Figma data import is allowed only through network approval/state audit and all project/export paths require a workspace.

- [ ] **Step 10: Request independent quality review**

Reviewer checks redirect cleanup, DNS/IP classification, aborts, stream disposal, temp cleanup, Windows reparse handling, and TOCTOU assumptions.

- [ ] **Step 11: Commit safe I/O**

Run section 6.2, then `git add service/packages/mcp/src/fs service/packages/mcp/src/network service/packages/mcp/src/control/network-domain-endpoints.ts service/packages/mcp/src/tools service/packages/mcp/src/tools/runtime-registry.ts service/packages/mcp/test/fs service/packages/mcp/test/network service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`; review the staged tree, rerun GREEN/authority, then `git commit -m "feat(io): sandbox files and pin approved remote image domains"`.

### Task 9 — Pair the Desktop plugin, expose approvals, remove URL fetch, and set undo boundaries

**Files**

- Modify: `service/packages/plugin/manifest.json`, `protocol/bridge.ts`, `src/code.ts`, `src/dispatcher.ts`, `src/idempotency.ts`, `src/panel.ts`.
- Create: `service/packages/plugin/src/file-identity.ts`.
- Modify glob: every `service/packages/plugin/src/handlers/*.ts` module whose registry key is in baseline `WRITE_TOOL_NAMES` (78 non-batch modules), plus `batch.ts`, `import-image.ts`, and `registry.ts`; the generated exact set is stored in `service/packages/plugin/src/mutation-handler-contract.ts` and must equal all 79 baseline write-kind names.
- Modify: `service/packages/plugin/ui/relay/client.ts`, `ui/App.vue`, `ui/main.ts`, `ui/style.css`.
- Create: `service/packages/plugin/ui/components/TabPairing.vue`, `TabApproval.vue`, `ui/composables/usePairing.ts`, `useApprovalQueue.ts`.
- Create: tests under `service/packages/plugin/test/auth`, `approval`, `protocol` including exact `protocol/progress-cancel.test.ts`, `handlers/import-image-policy.test.ts`, `file-identity.test.ts`, `mutation-handler-contract.test.ts`, `wire-result.test.ts`, `undo-boundary.test.ts`; create hand-derived changed/no-op fixture rows for every baseline write name under `service/packages/plugin/test/fixtures/mutation-outcomes.ts`.

**Interfaces**

- Consumes: Task 6 pairing/resume outer wire; Task 7 shared `$progress`/`$cancel` schemas, approval events, accepted/terminal envelopes, operation IDs, 67,108,864-byte frame cap, and immutable resolved target; Task 8 byte-only image dispatch. Task 9A is the first real plugin consumer/wiring and does not redefine daemon semantics.
- Produces: paired plugin hello/capability/file identity, 105-handler baseline parity, approval UI, in-flight Promise dedupe, `PluginHandlerOutcome<T>{value,mutated}` and `MUTATION_HANDLER_CONTRACTS` for exact 79 baseline write-kind handlers including batch/navigation, `UNDO_BOUNDARY_POLICIES` exact 79 rows, plugin top-level dispatcher as the sole `figma.commitUndo()` owner, and wire responses containing only `outcome.value`.

**Commit protocol:** Section 6.2 applies independently to 9A, 9B, and 9C; each exact staged tree includes the authority trio and gets its own two reviews.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 9A — pair/resume/file identity/progress consumer | relay client, bridge/code/panel/dispatcher listeners, pairing UI/composable, capability hello, plugin-data UUID, real `$progress`/`$cancel` lifecycle | auth/protocol/progress-cancel/file-identity suites, frame below/exact/above, listener cleanup and real UI CORS fixture | `feat(plugin): pair sessions and persist stable file identity`; produces authenticated identity and actual plugin consumer for 9B |
| 9B — mutation outcome and undo | 78 non-batch write modules, batch, mutation contract/fixtures, dispatcher/idempotency | exact79 outcome rows, changed/no-op fixtures, wire-value-only, sole commit call | `refactor(plugin): report mutation outcomes and centralize undo`; produces handler contract for Task 12 |
| 9C — approvals, URL removal, capability UI | approval UI/control bridge, import-image data-only, manifest domains, editor capability display | approval/protocol/URL/manifest/Motion-video preservation suites | `feat(plugin): approve capability-gated byte-only operations`; final 112/105/7 handoff |

9B’s generated handler-name set and fixture ledger are reviewed independently from UI work. Task 10 starts only after all three subtask commits pass baseline parity.

**Binding subtask execution**

- [ ] **9A RED:** Run `pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/protocol packages/plugin/test/file-identity.test.ts`; expect unpaired relay, absent stable UUID, and no real progress/cancel consumer/listener cleanup.
- [ ] **9A GREEN:** Implement pair/resume/file identity plus exact Task7 frame consumer; run `pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/protocol packages/plugin/test/file-identity.test.ts packages/mcp/test/security/pna.test.ts`; expect authenticated hello, rotation, real UI fetch, `$progress` delivery, origin operation cancel, listener cleanup, one terminal, and 67,108,863/exact67,108,864/above rejection green.
- [ ] **9A review and commit:** Apply section6.2, then stage `service/packages/plugin/protocol/bridge.ts service/packages/plugin/ui/relay service/packages/plugin/ui/components/TabPairing.vue service/packages/plugin/ui/composables/usePairing.ts service/packages/plugin/src/file-identity.ts service/packages/plugin/src/code.ts service/packages/plugin/src/panel.ts service/packages/plugin/src/dispatcher.ts service/packages/plugin/test/auth service/packages/plugin/test/protocol service/packages/plugin/test/file-identity.test.ts service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`; review/rerun same tree, then commit exact `feat(plugin): pair sessions and persist stable file identity`.
- [ ] **9B RED:** Run `pnpm -C service exec vitest run packages/plugin/test/mutation-handler-contract.test.ts packages/plugin/test/wire-result.test.ts packages/plugin/test/undo-boundary.test.ts`; expect raw handler results, missing exact79 contracts, and no dispatcher-owned boundary.
- [ ] **9B GREEN:** Migrate the generated 78 non-batch set plus batch, then run `pnpm -C service exec vitest run packages/plugin/test/mutation-handler-contract.test.ts packages/plugin/test/wire-result.test.ts packages/plugin/test/undo-boundary.test.ts test/tool-registry.test.ts`; expect exact baseline79, every changed/no-op fixture, wire-value-only output, and one production commitUndo call site.
- [ ] **9B review and commit:** Apply section 6.2 and stage the named handler/dispatcher/idempotency/fixture files plus `service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`; independent reviewers approve that tree, rerun GREEN/authority, then commit exact `refactor(plugin): report mutation outcomes and centralize undo`.
- [ ] **9C RED:** Run `pnpm -C service exec vitest run packages/plugin/test/approval packages/plugin/test/handlers/import-image-policy.test.ts packages/plugin/test/protocol`; expect missing approval UI and remaining direct URL/wildcard behavior while 9A/9B stay green.
- [ ] **9C GREEN:** Implement approvals, byte-only import, manifest/editor capability UI and run `pnpm -C service exec vitest run packages/plugin/test test/tool-registry.test.ts`, then `pnpm -C service build`; expect final baseline112/105/7 and Motion/video preservation.
- [ ] **9C review and commit:** Apply section 6.2 and stage the named manifest/approval/UI/import/panel tests plus `service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`; independent reviewers approve that tree, rerun GREEN/authority, then commit exact `feat(plugin): approve capability-gated byte-only operations`.

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
~~~

- [ ] **Step 2: Run plugin RED**

Run: `pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/approval packages/plugin/test/protocol packages/plugin/test/handlers/import-image-policy.test.ts packages/plugin/test/undo-boundary.test.ts`.

Expected: plugin connects without credential, has no pairing/approval UI, URL branch calls `createImageAsync`, and commitUndo is never called.

- [ ] **Step 3: Implement paired hello and rotating resume UI**

Render unpaired/pairing/wrong/expired/connected/reconnecting states. Exchange the eight-digit code, hold ticket/resume only in redacted state, send first-message credentials, rotate resume on every successful reconnect, and remove all secrets from diagnostics. Once paired, `protocol/bridge.ts` and the real code/panel/UI relay install exactly one Task7-schema `$progress`/`$cancel` listener per session, route by requestId+operationId, reject oversize before decode, remove listeners on terminal/reconnect/unmount, and prevent late progress after terminal. No plugin/UI field can supply daemon identity/context.

- [ ] **Step 4: Implement approval UI and exactly-once settlement**

Show tool, dynamic effect summary, stable file label, target count, overwrite/destructive/network flags; redact text/base64/URL query. Approve/reject exact approvalId once; late duplicate events are ignored and audited.

- [ ] **Step 5: Implement editor capabilities and stable file UUID**

Advertise Design/Dev/FigJam capabilities. Prefer fileKey; otherwise request explicit approval to create document-root pluginData UUID through the dispatcher-owned system-mutation wrapper. The file-identity module returns `PluginHandlerOutcome` and never commits directly. Dev/read-only returns unstable identity and disables persistent snapshot/diff.

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

- Modify: `service/packages/mcp/src/index.ts`, `dispatch.ts`, `relay/relay.ts`, `relay/session.ts`.
- Modify: `service/packages/mcp/src/tools/token-map.ts`, `component-map.ts`, `icon-map.ts`, `design-diff.ts`, `get-local-components.ts`.
- Create: `service/packages/mcp/test/tools/grounding-session.test.ts`, `design-diff-file-identity.test.ts`, `component-discovery-capability.test.ts`.
- Create: `service/packages/mcp/test/relay/write-flap-outcome.test.ts`.

**Interfaces**

- Consumes: Task 7 immutable `RuntimeExecutionScope`, operation outcome API, server-resolved target/per-file key, and no-session-oracle `/ping`; Task 9 authenticated Relay session/FileIdentity.
- Produces: one plane-resolved pinned dispatcher per multi-read operation; stable `{fileIdentity,nodeId}` diff namespace; explicit `remoteLibraryDiscovery:false`; relay callback that marks dispatched writes unknown. It never pins or discovers a target from `/ping`, file name, request body, or a second active-session lookup.

**Commit protocol:** Section 6.2 applies; stage Task 10 semantic files plus the authority trio and review the same tree.

- [ ] **Step 1: Write genuine cross-session/collision/flap RED**

~~~ts
it('pins token variables and styles to one resolved session', async () => {
  const result = await runTokenMapWithActivityFlip('file-A', 'file-B');
  expect(result.provenance.sessionId).toBe('file-A');
  expect(result.variablesFile).toBe(result.stylesFile);
});

it('namespaces the same node ID by stable file identity', async () => {
  expect(pathFor(fileUuidA, '1:2')).not.toBe(pathFor(fileUuidB, '1:2'));
});
~~~

- [ ] **Step 2: Run grounding RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/tools/grounding-session.test.ts packages/mcp/test/tools/design-diff-file-identity.test.ts packages/mcp/test/relay/write-flap-outcome.test.ts`.

Expected: token reads may mix, same node IDs collide, and dispatched flap waits for opaque timeout.

- [ ] **Step 3: Pin all multi-call grounding**

Consume the Task 7 immutable target/session/file identity once; pass the same routed dispatcher to component/token/icon subcalls. Do not call `/ping` or resolve `active` again. If it disappears, fail `PINNED_SESSION_LOST`; never switch files. Include session/file provenance in results.

- [ ] **Step 4: Namespace and migrate design baselines**

Store under `.sfp/design-diff-baselines/v1/{fileIdentityHash}/{sanitizedNodeId}.json` through AtomicFileStore, separate from SnapshotV1 storage. Reject unstable identity. Legacy node-only baseline is read only by authenticated CLI migration with explicit source/target identity; no silent rebaseline.

- [ ] **Step 5: Connect relay flap to OperationExecutor**

Wire grounding-specific Relay flap observation into the Task 7 plane without creating a second executor or target resolver. Before-dispatch queued entries may resume only on the same plugin generation. Generation change fails pending/queued records deterministically. Socket close after dispatch invokes executor `markOutcomeUnknown(actorId,operationId,pluginGeneration)` immediately; safe read re-execution uses a new operation ID. Old socket reply cannot settle a rotated generation, succeeded old-generation records return settled status without runtime, and no code path falls back to `/ping` or another active target.

- [ ] **Step 6: Make component discovery scope explicit**

Return `scope:'selection-or-subtree'` and `remoteLibraryDiscovery:false`; prompts later use page traversal or known component keys instead of claiming team-library search.

- [ ] **Step 7: Run grounding GREEN**

Run: `pnpm -C service exec vitest run packages/mcp/test/tools/grounding-session.test.ts packages/mcp/test/tools/design-diff-file-identity.test.ts packages/mcp/test/tools/component-discovery-capability.test.ts packages/mcp/test/relay`, then `pnpm -C service typecheck`.

Expected: no cross-file mix/collision/reroute, flap unknown is immediate, and component discovery is honest.

- [ ] **Step 8: Request independent spec review**

Reviewer checks stable identity continuity across plugin/daemon restart and confirms read-only unstable sessions cannot persist baselines.

- [ ] **Step 9: Request independent quality review**

Reviewer checks routing races, legacy migration safety, atomic store use, stale reply rejection, and provenance completeness.

- [ ] **Step 10: Commit grounding correctness**

Run section 6.2, stage `service/packages/mcp/src/index.ts service/packages/mcp/src/dispatch.ts service/packages/mcp/src/relay service/packages/mcp/src/tools service/packages/mcp/test/tools service/packages/mcp/test/relay service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`, review/rerun same tree, then commit exact `fix(grounding): pin files and namespace durable design state`.

### Task 11 — Assemble sectioned snapshots and grounding graphs

**Files**

- Modify: `service/packages/ir/package.json` to depend on `@sfp/shared`.
- Create: `service/packages/ir/src/canonical-json.ts`, `fidelity.ts`, `snapshot-v1.ts`, `snapshot-storage.ts`, `grounding-graph-v1.ts`, `store.ts`, `index.ts` and matching pure tests; IR owns `SnapshotV1` and `SnapshotStoragePort` together and imports no filesystem module.
- Create: `service/packages/mcp/src/snapshot/workspace-snapshot-storage.ts`, `capture-snapshot.ts`, `build-grounding-graph.ts`, `control/snapshot-endpoints.ts`.
- Modify: `service/packages/mcp/src/execution/service-operation-registry.ts` to add only `snapshot.capture`; modify `service/packages/shared/src/service-operations.ts` only if the already-reviewed generic schema needs the concrete typed row export.
- Create: `service/packages/mcp/test/snapshot/section-assembly.test.ts`, `snapshot-storage-adapter.test.ts`, `snapshot-store.test.ts`, `grounding-graph.test.ts`, `progress-integration.test.ts`.

**Interfaces**

- Consumes: Task 7 empty service-operation seam, immutable policy/path/target-resolved scope, one executor and shared progress/cancel/terminal transport; Task 8 workspace store; Task 10 stable pin. No snapshot type lives in shared.
- Produces: IR `SnapshotV1`/storage, workspace adapter, reader/graph, and exact service registry row `snapshot.capture` with required target, workspace filesystem effects, strict args/result, and progress. `/control/snapshots/capture` is a typed adapter to `invokeService`; OperationRecord is `{operationKind:'service',operationName:'snapshot.capture'}`. Tool registry remains baseline112 here and reaches116 only in Task12.

**Commit protocol:** Section 6.2 applies; stage snapshot/IR/service-registry files plus the authority trio and review the same tree.

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
  expect(result.relativePath).toBe(`.sfp/snapshots/v1/${fileIdentityHash}/${result.snapshotId}.json`);
  expect(result.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(storage.save).toHaveBeenCalledTimes(1);
});

it('keeps the storage dependency direction IR -> shared and MCP adapter -> IR', async () => {
  expect(await packageImports('@sfp/shared')).not.toContain('@sfp/ir');
  expect(await packageImports('@sfp/ir')).toContain('@sfp/shared');
  expect(await sourceImports('packages/mcp/src/snapshot/workspace-snapshot-storage.ts')).toContain('@sfp/ir');
});
~~~

- [ ] **Step 2: Run snapshot RED**

Run: `pnpm -C service exec vitest run packages/ir/test packages/mcp/test/snapshot`.

Expected: IR modules and section reader are absent.

- [ ] **Step 3: Implement canonical schemas/store**

Use strict Zod schemas, stable sorted-key JSON/number encoding, UTF-8 SHA-256, and explicit mixed/unset/unsupported/notLoaded/omitted states. Hash excludes capturedAt/snapshotId. Define `SnapshotV1`, `SnapshotStorageKey/Ref`, and `SnapshotStoragePort.save/load/list/delete` together in `@sfp/ir`; `StoredSnapshotRef` carries workspaceId, fileIdentity/hash, snapshotId, checksum, relative path, bytes, and fidelity. Implement `WorkspaceSnapshotStorage` in the MCP snapshot package by resolving every workspace/path through Task 8 WorkspacePolicy and performing save/delete through AtomicFileStore, checksum validation on load, and stable snapshotId sort on list. Structural tests reject `node:fs` in IR, reject any shared→IR import, and permit WorkspacePolicy/AtomicFileStore only in the MCP adapter—not in IR or the capture assembler.

- [ ] **Step 4: Implement bounded section capture**

Fetch initial full context through the same immutable `RuntimeExecutionScope`. Process nested plans with stable depth-first pre-order, concurrency two, visited `(pluginGeneration,nodeId)`, depth cap 8, total fetched-section cap 256, and exact plan-path fidelity. Recursively expand every nested plan until full leaf, cycle, cap, failure, deadline, or explicit Task 7 cancel. Merge completed leaves by stable pre-order and node IDs, dedupe global styles/variables deterministically, emit bounded Task 7 progress after each leaf, and retain nested failed/omitted reasons. A 10k-node fixture must stay inside a measured memory ceiling recorded in the test.

- [ ] **Step 5: Implement grounding graph and stale checks**

Create component/token/icon edges with structured refs, evidence, confidence, verified flag, snapshotId, and code path/token existence checks. Human-verified edges outrank fuzzy matches; stale refs report status instead of disappearing.

- [ ] **Step 6: Expose control-only capture**

Register `ServiceOperationSpec<SnapshotCaptureArgs,SnapshotCaptureResult>` name `snapshot.capture` (service0→1): possible/dynamic effects exactly figma-read+filesystem-write to server-generated snapshot namespace, operation-id idempotency, explicit filesystem-write approval, `parallel-read` file concurrency, strict metadata egress, required stable target/workspace. Mount the endpoint only as strict adapter to `invokeService`; it supplies node IDs/workspace/selector. Structural tests prove no direct reader/store/runtime call, service/tool collision rejection, kind/name journal, and unchanged tool/handler/execution counts.

- [ ] **Step 7: Run snapshot GREEN**

Run: `pnpm -C service exec vitest run packages/ir/test packages/mcp/test/snapshot`, then `pnpm -C service typecheck`.

Expected: full/partial assembly, progress/cancel, store corruption, graph priority/staleness, control auth, service registry exact1/kind-name journal/direct-bypass negatives pass; MCP registry remains112.

- [ ] **Step 8: Request independent spec review**

Reviewer verifies the observed/inferred boundary, shared dependency direction, section fidelity semantics, and canonical registry remains unchanged.

- [ ] **Step 9: Request independent quality review**

Reviewer checks recursive work-queue bounds/order/cycles, deterministic merge/hash, memory bounds, duplicate IDs, cancellation cleanup, injected workspace storage only, and Zod migration hooks.

- [ ] **Step 10: Commit snapshots**

Run section 6.2, stage `service/packages/ir service/packages/shared/src/service-operations.ts service/packages/mcp/src/execution/service-operation-registry.ts service/packages/mcp/src/snapshot service/packages/mcp/src/control/snapshot-endpoints.ts service/packages/mcp/test/snapshot service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`, review/rerun same tree, then commit exact `feat(snapshot): assemble loss-aware design state and grounding graph`.

### Task 12 — Atomically add four safe-union tools and reach 116/106/10

**Files**

- Modify: `service/packages/mcp/package.json`, `service/pnpm-lock.yaml` to add `pdf-lib` 1.17.1.
- Create: `service/packages/mcp/src/execution/pdf-merge.ts`, `export-pool.ts`.
- Create: `service/packages/mcp/src/tools/export-tokens.ts`, `export-frames-to-pdf.ts`, `doctor.ts`, `import-library-variable.ts`.
- Create: `service/packages/plugin/src/handlers/import-library-variable.ts`.
- Modify atomically: MCP tool/result/runtime/policy registries, plugin handler registry, `service/packages/plugin/manifest.json`, union manifest.
- Create: `service/packages/mcp/test/tools/safe-union.test.ts`, `export-tokens.test.ts`, `export-frames-to-pdf.test.ts`, `doctor.test.ts`; `service/packages/plugin/test/handlers/import-library-variable.test.ts`; modify `service/packages/plugin/test/mutation-handler-contract.test.ts` and `service/packages/plugin/test/fixtures/mutation-outcomes.ts` for the exact final80 set; PDF fixtures under `service/packages/mcp/test/fixtures/pdf`.

**Interfaces**

- Consumes: Task3 planned rows, Task5 policy, Task7 scope/executor/wire, Task8 store, Task9 plugin/undo, Task10 pin, and Task11 service registry1. New runtimes cannot accept body context, reroute, call Relay, redefine wire, or alter `snapshot.capture`.
- Produces: section3.8/3.9 contracts; exact final tools116; handlerAuthority106 plugin-handler/10 server-only; execution99 plugin-direct/17 server-adapter; kinds23/13/80; maps116; mutation/undo80; service registry remains exact1 `snapshot.capture`; all canonical rows implemented.

**Commit protocol:** Section 6.2 applies independently to 12A and 12B; each stages its semantic files plus authority trio and reviews the same tree.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 12A — hidden adapters | unregistered token/PDF/doctor runtimes, pdf-lib merger/fixtures, unregistered library handler and tests | focused adapter tests pass while parity remains exactly112/105/7 and four manifest rows stay planned | `feat(union): implement hidden safe-union adapters`; no registry/manifest/permission switch allowed |
| 12B — atomic authority switch | four specs/results/handler+execution bindings/target requirements/effects/egress, one handler+undo row, permission, manifest | one RED→GREEN changes to tools116, handler106/10, execution99/17, kinds23-13-80, maps116, undo80; service1 unchanged | `feat(union): atomically advertise four safe-union tools`; Task13 consumes |

12A can be rejected without changing advertised surface. 12B is one atomic diff and cannot merge with a partial count/permission/manifest transition.

**Binding subtask execution**

- [ ] **12A RED:** Run `pnpm -C service exec vitest run packages/mcp/test/tools/export-tokens.test.ts packages/mcp/test/tools/export-frames-to-pdf.test.ts packages/mcp/test/tools/doctor.test.ts packages/plugin/test/handlers/import-library-variable.test.ts test/upstream-parity.test.ts`; expect missing adapter modules/fixtures while parity remains112/105/7 and four manifest rows remain planned.
- [ ] **12A GREEN:** Implement only hidden adapters/handler; run focused tests/build. Expected: adapter tests green while advertised tools112, handler105/7, execution98/14, service1, and four planned rows remain unchanged.
- [ ] **12A review and commit:** Apply section6.2; stage the named hidden adapter/dependency/fixture files plus authority trio, but no registry/permission/capability switch; review/rerun same tree; commit exact `feat(union): implement hidden safe-union adapters`.
- [ ] **12B RED:** Run `pnpm -C service exec vitest run packages/mcp/test/tools/safe-union.test.ts test/tool-contract.test.ts` before registration; expect exact112/105/7 and four planned rows, proving the switch has not partially happened.
- [ ] **12B GREEN:** Apply specs/results/handlerAuthority/execution/TargetRequirement/effects/egress, one handler+mutation/undo, permission, manifest in one diff; run focused/full plugin tests and build. Expected: tools116, handler106/10, execution99/17, kinds23/13/80, maps116, mutation/undo80, service1, planned0; all three non-doctor new tools required, doctor conditional target.
- [ ] **12B review and commit:** Apply section6.2; stage the named atomic registry/policy/plugin/manifest/tests plus authority trio; review/rerun same tree; commit exact `feat(union): atomically advertise four safe-union tools`.

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
  expect(Object.keys(SERVICE_OPERATION_SPECS)).toEqual(['snapshot.capture']);
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

Doctor checks product magic, role, owner-state security, workspace config, pairing, plugin/session/file identity, editor/capability, version skew, and optional typed round trip without exposing secrets. Library handler validates key, Design/teamlibrary capability, invokes `figma.variables.importVariableByKeyAsync`, returns `PluginHandlerOutcome<ImportLibraryVariableResult>` with explicit `mutated`, and uses operation-ID idempotency. It never calls `commitUndo`; the Task 9 top-level dispatcher commits exactly once only when `mutated:true`.

- [ ] **Step 7: Atomically register contracts and permission**

Add four specs/results/handlerAuthority/execution/TargetRequirement/operation/egress rows; add only library handler+mutation/undo so79→80; permission and manifest transitions. `export_tokens`, `export_frames_to_pdf`, and `doctor` are new server-adapters (baseline14→final17); `import_library_variable` is plugin-direct (98→99) and adds handler106. The three non-doctor tools require target; doctor is optional/required by roundTrip. Every adapter uses supplied scope and only PinnedPluginRuntimePort. Wire heavy budgets/progress/cancel through Task7 and actual Task9A plugin consumer. Service registry `snapshot.capture` stays exact1 and outside tool counts.

- [ ] **Step 8: Run final registry/policy/runtime GREEN**

Run: `pnpm -C service exec vitest run packages/mcp/test/tools packages/mcp/test/policy packages/shared/test packages/plugin/test test/tool-contract.test.ts test/tool-registry.test.ts`, then `pnpm -C service build`.

Expected: tools116, handlerAuthority106/10, execution99/17, kind23/13/80, maps116, mutation/undo80, service1, manifest planned0, Motion7+video, no handler commitUndo, plugin build.

- [ ] **Step 9: Request independent spec review**

Reviewer verifies all four source semantics, exact count transition, PDF/token fidelity, teamlibrary/approval behavior, and experimental Motion/video preservation.

- [ ] **Step 10: Request independent quality review**

Reviewer checks PDF resource copying/order/corruption, export memory/cancel/progress, token determinism, doctor secret hygiene, handler idempotency, and dependency license entry.

- [ ] **Step 11: Verify the two-commit safe-union handoff**

Run: `git diff --check`, `git log -2 --format="%H %s"`, full Task 12 GREEN/build, then `git diff --exit-code`. Expected: the 12A hidden-adapter commit precedes the 12B atomic-advertisement commit and the worktree is clean. Do not squash or create a third aggregate Task 12 commit.

### Task 13 — Build the authenticated companion CLI and exhaustive mappings

**Files**

- Create: `service/packages/cli/src/index.ts`, `client.ts`, `output.ts`.
- Create: command files listed in section 4, including `approve.ts` and `workspace.ts`.
- Create: `service/packages/cli/src/compat/rust-tool-map.ts`.
- Create: `service/packages/cli/test/client.test.ts`, `commands/*.test.ts`, `compat-mapping.test.ts`, `fixtures/fake-control-server.ts`.
- Modify: root/package bin/files/export maps so `sfp` points to `packages/cli/dist/index.mjs`.

**Interfaces**

- Consumes: Task6 control auth/exact PublicPingV1; Task7 tool/service/admin separation, stable owner/rotating auth session, strict request/cancel/frame/nonce routes; Task8 domains; Task11 `snapshot.capture`; Task12 final handler/execution authorities. CLI never sends identity/context or redefines wire.
- Produces: authenticated `ControlClient`; workspace and remote-domain config commands; CLI exit codes 0 healthy, 1 degraded/rejected operation, 2 unavailable/config; command mappings below. CLI is a companion to an active MCP/daemon and never starts a hidden leader.

**Commit protocol:** Section6.2 applies; stage CLI/package files plus authority trio and review the same tree.

**Command contract**

| Command | Canonical call | Required args/options | Approval/output |
|---|---|---|---|
| `sfp status` | unauth exact PublicPingV1 then authenticated status | `--json` | product/protocol/server/build/leaderGeneration/role only; unavailable 2 |
| `sfp doctor` | `doctor` | `--round-trip`, `--json` | ordered checks; degraded 1 |
| `sfp pair` | `POST /control/pair/challenge` | none | prints public Pair ID, eight-digit code, and `SFP-id-code` paste form only to terminal |
| `sfp workspace add` | `POST /control/workspaces` | path, one-use action nonce | explicit local action; prints workspaceId |
| `sfp workspace list/remove` | `GET /control/workspaces`, `DELETE /control/workspaces/:id` | remove workspaceId+nonce | removal rejects unsettled references |
| `sfp network domains add` | `POST /control/network/domains` | exact three-or-more-label FQDN, nonce | exact equality only; changes owner allowlist, never implicit approval |
| `sfp network domains list/remove` | `GET /control/network/domains`, `DELETE /control/network/domains/:domain` | remove domain+nonce | empty default; wildcard/IP/public suffix rejected |
| `sfp approvals list` | pending approvals API | `--json` | redacted summaries |
| `sfp approve/reject` | approval settle API | approvalId | exact once; late settlement degraded 1 |
| `sfp operations unresolved` | `GET /control/operations?status=outcome-unknown` | `--json` | unresolved records, no raw args/result |
| `sfp operations status` | `GET /control/operations/:id` | issued operation ID | sanitized record/tombstone/resolution |
| `sfp operations resolve` | `POST /control/operations/:id/resolve` | ID, `--decision` set to applied, not-applied, or abandoned; reason/evidence file hash; `--confirm <operationId/resultHash-or-unknown>`; nonce | owner-local administrative terminal resolution; no normal approval/OperationRecord and never replay permission |
| `sfp compat` | manifest/status | `--json` | Rust 73 same/adapter/incompatible/unique-adapter plus helper20/parser12 |
| `sfp snapshot` | control snapshot capture | `--workspace`, target | ID/path/hash/fidelity |
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

it('maps workspace and network-domain commands to authenticated control routes', async () => {
  await runCli(['workspace', 'add', workspacePath], fakeControl);
  await runCli(['network', 'domains', 'add', 'assets.example.com'], fakeControl);
  expect(fakeControl.calls.map(x => [x.method, x.path])).toEqual([
    ['POST', '/control/action-nonces'],
    ['POST', '/control/workspaces'],
    ['POST', '/control/action-nonces'],
    ['POST', '/control/network/domains'],
  ]);
});

it('sends selectors only and parses bounded NDJSON until one terminal frame', async () => {
  const result = await runCli(['tree', '--session', relaySessionId], fakeControl);
  expect(fakeControl.lastCall.body).toEqual(expect.objectContaining({
    version: 1, targetSelector: { kind: 'session', sessionId: relaySessionId },
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
~~~

- [ ] **Step 2: Run CLI RED**

Run: `pnpm -C service exec vitest run packages/cli/test`.

Expected: CLI package source is absent while the workspace harness remains runnable.

- [ ] **Step 3: Implement ControlClient and output contract**

Read control token only from secured stateRoot and validate exact PublicPingV1 including leaderGeneration. Tool calls send InvocationRequestV1; snapshot sends the endpoint's ServiceOperationRequestV1 adapter fields; admin routes never send operation names. Middleware derives stable actor/current auth session/context. Parse bounded NDJSON, surface operation kind/name/ID, and cancel only operations originated by this same auth session; after control rotation, advise status/resolve rather than cross-session cancel. Redact secrets and never call follower RPC directly.

- [ ] **Step 4: Implement workspace, pairing, and approval commands**

Implement all table rows, terminal-only public Pair ID+code/paste-form display, pending approval list, exact approve/reject, operation issue/list/status/resolve, workspace realpath lifecycle, and exact-host allowlist lifecycle. Before each nonce-protected route, canonicalize the exact semantic request, call `POST /control/action-nonces` with action+requestHash, and use the returned nonce once; do not generate/cache/reuse nonces locally. Mutation wrappers request a server-issued operation ID before dispatch and surface it in accepted/progress/error/output. Operation resolve is an owner-local administrative call that requires the operator to type/paste exact `--confirm <operationId/resultHash-or-unknown>`, hashes the user-provided reason/evidence files locally, requests a bound `operation.resolve` nonce, and never requests ordinary approval or resubmits the original tool. JSON pair output includes challengeId/expiry but redacts code after exchange; control token supplies actor identity and bodies cannot override it.

- [ ] **Step 5: Implement snapshot/export/read/write wrappers**

Use only typed tool/snapshot endpoints. Snapshot requests obtain a server-issued operation ID and enter service `snapshot.capture`; tool wrappers enter invokeTool. Encode selector only, resolve node/page through pinned reads, reject incompatible targets, preserve PDF/clone recipes. No wrapper owns mutation, progress, or cancel state machines.

- [ ] **Step 6: Implement compatibility output**

Report canonical116/source114/helper20/parser12, source/target schema hashes, Motion/video experimental availability, and Rust 2 unique adapters. Official limits appear only as external links/checked date without numeric constants.

- [ ] **Step 7: Run CLI GREEN**

Run: `pnpm -C service exec vitest run packages/cli/test`, `pnpm -C service --filter @sfp/cli build`, then `node service/packages/cli/dist/index.mjs --help`.

Expected: command table, approval/workspace/auth/progress/CJK/emoji/Windows path tests pass and help lists no exec.

- [ ] **Step 8: Request independent spec review**

Reviewer checks every helper/parser mapping, command→tool policy path, exit codes, active-daemon constraint, and approval behavior.

- [ ] **Step 9: Request independent quality review**

Reviewer checks parseArgs ambiguity, terminal/JSON redaction, path quoting, progress cancellation, Unicode, and fake-server isolation.

- [ ] **Step 10: Commit CLI**

Run section6.2, stage `service/packages/cli service/package.json service/pnpm-lock.yaml service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`, review/rerun same tree, then commit exact `feat(cli): add authenticated diagnostics approvals and typed wrappers`.

### Task 14 — Correct skills and write capability, security, and official build-vs-buy docs

**Files**

- Modify: `service/skills/figma-codegen/**`, `service/skills/figma-build/**`.
- Create: `service/skills/compat-rust-recipes/` with only schema-validated recipes.
- Create/modify: `service/README.md`, `SECURITY.md`, `docs/architecture.md`, `build-vs-buy.md`, `capability-matrix.md`, `compatibility.md`, `operation-policy.md`, `pairing.md`, `snapshot-format.md`, `desktop-acceptance.md`.
- Create: `service/test/docs-sync.test.ts`.

**Interfaces**

- Consumes: Task 12 final manifest/policies and Task 13 exact CLI/help output.
- Produces: user/operator docs synchronized with tools116, handler106/10, execution99/17, service1, corrected skills, and current official build-vs-buy explanation.

**Commit protocol:** Section6.2 applies; docs/skills/tests and authority trio form one reviewed tree.

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

Document Desktop Design v0.1; Dev read-only; FigJam partial; Web/public deferred. Document exact PublicPingV1, opaque Task6 outer vs Task7 inner transport, one owner actor/domain-separated auth sessions, origin-session cancel vs owner-admin resolution, path-first policy context, target rules, handler106/10 vs execution99/17, tool/service/admin separation and snapshot.capture service1, exact journal/egress finalizer order, bounded demotion, all section3.12 limits, Task9 real plugin progress consumer, pairing/workspace/FQDN/URL/undo/snapshot/release/source-complete boundaries, and Motion/video experimental status.

- [ ] **Step 6: Run docs GREEN**

Run: `pnpm -C service exec vitest run test/docs-sync.test.ts test/tool-contract.test.ts`, then `pnpm -C service format:check`.

Expected: docs counts/commands/URLs/skills/policies match generated authorities and no fixed official rate text exists.

- [ ] **Step 7: Request independent spec review**

Reviewer compares docs against binding 04/05, official-current feature claims, product boundary, and all manifest dispositions.

- [ ] **Step 8: Request independent quality review**

Reviewer checks clarity, links, command examples, policy non-overclaim, no secrets, and no unsupported Web/public/local-only marketing.

- [ ] **Step 9: Commit docs and skills**

Run section6.2, stage `service/README.md service/SECURITY.md service/docs service/skills service/test/docs-sync.test.ts service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`, review/rerun same tree, then commit exact `docs(service): align skills capabilities and build-versus-buy`.

### Task 15 — Add release hygiene, CI, SBOM, checksums, and artifact verification

**Files**

- Modify: `service/package.json`, package manifests/files/bin/export maps, lockfile, hygiene files from Task 1.
- Modify: `service/packages/mcp/tsdown.config.ts` and `service/packages/cli/tsdown.config.ts` to bundle internal workspaces; generate packed manifests without private workspace runtime dependencies.
- Create: `.github/workflows/service-ci.yml`, `.github/workflows/service-release.yml`.
- Create: `service/scripts/generate-sbom.mjs`, `generate-notices.mjs`, `package-artifacts.mjs`, `generate-checksums.mjs`, `verify-artifacts.mjs`, `smoke-installed-mcp.mjs`.
- Create/modify: `service/THIRD_PARTY_NOTICES.md`, `PROVENANCE.md`, `SBOM.spdx.json`.
- Create: `service/test/artifact-contents.test.ts`, `service/test/fixtures/assemble-baseline-artifacts.mjs` (RED-only harness, never shipped).

**Interfaces**

- Consumes: Task 2 offline provenance, Task 12 final manifest and pdf-lib dependency, Task 14 docs/skills.
- Produces: one umbrella `package-artifacts.mjs` producer for deterministic `service/artifacts/mcp.tgz`, `cli.tgz`, and `plugin.zip`; `service/artifacts/manifest.json` with relative paths/build identities/SHA-256 values; SPDX SBOM/notices; checksums; CI/release workflows; one-command `verify:release` hard gate.

**Commit protocol:** Section6.2 applies; release source/config/tests plus authority trio form the reviewed tree. Generated artifacts remain ignored outputs, not staged authority substitutes.

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
  ['mcp.tgz', 'node scripts/smoke-installed-mcp.mjs'],
  ['cli.tgz', 'sfp --help'],
])('installs %s alone in an empty prefix and runs %s', async (artifact, smoke) => {
  const install = await installInEmptyPrefix({ artifact, freshCache: true });
  expect(install.packageJson).not.toMatchObject({
    dependencies: expect.objectContaining({ '@sfp/shared': expect.anything(), '@sfp/ir': expect.anything() }),
  });
  expect(await install.npmLsAll()).toMatchObject({ exitCode: 0 });
  expect(await install.run(smoke)).toMatchObject({ exitCode: 0 });
  expect(await install.findWorkspacePaths()).toEqual([]);
});
~~~

Create `test/fixtures/assemble-baseline-artifacts.mjs` with the RED harness: it directly packs the current MCP and CLI package directories into `service/artifacts/mcp.tgz` and `cli.tgz`, copies only current plugin manifest/dist into an isolated temporary Git worktree, commits it with fixed test author/time, and invokes `git archive --format=zip` through `execFile` argv to create `plugin.zip`. It deliberately does not add root legal/capability authorities, removes the temporary `.git`, and is excluded from every release artifact.

- [ ] **Step 2: Run artifact RED**

Run: `pnpm -C service build`, `node service/test/fixtures/assemble-baseline-artifacts.mjs`, then `pnpm -C service exec vitest run test/artifact-contents.test.ts`.

Expected: the runnable RED harness creates all three baseline archives, then content assertions fail because they omit notices/SBOM/capability files—not because a future production script/module is missing.

- [ ] **Step 3: Implement actual artifact assembly**

Set MCP tsdown `deps.alwaysBundle` to `['@sfp/shared','@sfp/ir']` and CLI to `['@sfp/shared']`; assert built files contain those modules and packed package.json has neither private package nor `workspace:*` runtime dependency. `package-artifacts.mjs` starts from clean `service/artifacts/.staging`, creates separate staged MCP and CLI package roots, copies each built dist plus its sanitized package.json, copies `service/README.md` into each root as `README.md`, and copies `LICENSE`, `THIRD_PARTY_NOTICES.md`, `PROVENANCE.md`, `SBOM.spdx.json`, all three upstream license files, and capability ledgers into each staged root. Each staged package.json rewrites `files` to exact `['dist','README.md','LICENSE','THIRD_PARTY_NOTICES.md','PROVENANCE.md','SBOM.spdx.json','licenses','capabilities']`. Invoke `npm pack` on each staged root with argv, normalize to `mcp.tgz`/`cli.tgz`; create plugin ZIP from an isolated fixed-author/time Git repository with `git archive --format=zip`; remove staged `.git`; atomically write artifact manifest; generate SBOM/notices before packaging and sorted checksums after final artifacts. No package relies on parent paths. Record package versions/bin and exact PublicPingV1 build identity. Verify legal/provenance and absence of Solar/raw exec/RED harness/dev vendor/code-kb runtime references.

Artifact verifier additionally asserts tools116, handlerAuthority106/10, execution99/17 with exact adapter-name set, service registry1 `snapshot.capture`, exact PublicPingV1 fields, and no active-session oracle. It opens plugin.zip and runs built protocol parity fixtures proving Task9A real `$progress`/`$cancel` consumer/listener cleanup and 67,108,864-byte bound—not only daemon fake tests.

- [ ] **Step 4: Implement CI and release workflows**

Reuse immutable action digests already pinned in the vendored Figwright workflow authority. CI uses frozen install, type/lint/format/knip/build/test on Ubuntu and Windows and fails if built-dist E2E skips. Release-candidate job triggers only version tags, reruns `verify:release`, and uploads checksummed draft artifacts. GA publish is a separate protected-environment job that verifies both OS evidence schemas, detached signatures, public-key fingerprints against the pre-registered owner fingerprints, matching candidate artifact hashes, and `waived:false`; absent or untrusted evidence leaves a draft/source-complete preview and cannot publish npm/plugin assets.

- [ ] **Step 5: Verify upstream and package contents offline**

Run: remove only the generated `service/artifacts` directory, then `node service/scripts/verify-upstream-lock.mjs --offline` and `pnpm -C service verify:release`. The exact internal order is verify/build → generate SBOM → generate notices → package all three artifacts → generate checksums → artifact tests → artifact verifier. The verifier creates independent `mkdtemp` prefixes/caches, installs exactly one tarball per prefix, runs `npm ls --all`, calls `smoke-installed-mcp.mjs --expect-tools 116` on the installed MCP bin, requires installed CLI `--help` exit 0 and `status` exit 2 with `DAEMON_UNAVAILABLE`, scans for workspace paths, and removes temporary roots.

Expected: artifacts contain canonical116/source114/helper20/parser12, handler106/10, execution99/17, service1, Task9 plugin progress parity, Motion7+video, legal/SBOM/provenance/checksums; isolated installs and bins pass without workspace paths.

- [ ] **Step 6: Run workflow hygiene checks**

Run the repository actionlint/zizmor workflow checks if available; otherwise run the pinned workflow validation commands documented by the parent repository. Structural tests reject floating `uses:` refs and non-frozen installs.

- [ ] **Step 7: Request independent spec review**

Reviewer opens every actual artifact and compares legal/capability/runtime contents with DoD; source-tree presence alone is insufficient.

- [ ] **Step 8: Request independent quality review**

Reviewer checks reproducibility, package surface, workflow permissions, provenance/checksum order, SBOM completeness, and release failure handling.

- [ ] **Step 9: Commit release machinery**

Run section6.2, stage the named workflows/manifests/scripts/legal/tests plus `service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`, review/rerun same tree, then commit exact `build(release): verify standalone licensed service artifacts`.

### Task 16 — Build the automated Desktop acceptance harness and evidence schema

**Files**

- Create: `service/docs/evidence-schema.json`, `service/scripts/desktop-acceptance.mjs`, `install-release-artifacts.mjs`, `sign-evidence.mjs`, `verify-evidence-signature.mjs`, `service/test/acceptance-harness.test.ts`; generate `service/artifacts/source-complete-preview.json`.
- Modify: `service/docs/desktop-acceptance.md`, `service/package.json` acceptance script.

**Interfaces**

- Consumes: Task 13 CLI/control API and Task 15 build/artifact hashes.
- Produces: `AcceptanceEvidenceV1` and `AcceptanceAttestationV1`, checksum-verified temporary packed-artifact installer/launcher, fake-control harness tests, live runner that returns typed `PLUGIN_NOT_CONNECTED`, detached Ed25519 evidence signatures, source-complete preview marker `releaseStatus:'blocked-external-evidence'`, and nonzero exit on any GA-blocking live check.

**Commit protocol:** Section6.2 applies; harness/schema/docs/package and authority trio form the reviewed tree.

- [ ] **Step 1: Write evidence-schema and fake-runner RED**

~~~ts
it('rejects PASS evidence without build hashes or operator', () => {
  expect(EvidenceSchema.safeParse({ schemaVersion: 1, status: 'pass' }).success).toBe(false);
});

it('redacts file names, text, URLs and node contents from evidence', async () => {
  const evidence = await runAgainst(fakeHealthyControlWithSensitiveData());
  expect(JSON.stringify(evidence)).not.toContain('Secret layer text');
});

it('rejects evidence whose detached signature or packed artifact hash does not verify', async () => {
  const signed = await signFixture(validEvidence, localTestKey);
  signed.evidence.artifacts.mcpSha256 = 'tampered';
  await expect(verifyEvidence(signed)).rejects.toMatchObject({ code: 'EVIDENCE_SIGNATURE_INVALID' });
});
~~~

- [ ] **Step 2: Run harness RED**

Run: `pnpm -C service exec vitest run test/acceptance-harness.test.ts`.

Expected: evidence schema and runner modules are absent.

- [ ] **Step 3: Implement AcceptanceEvidenceV1**

Require OS/arch, OS acceptance owner, operator, timestamp, Figma Desktop version, plugin/MCP/CLI packed SHA-256, exact PublicPingV1 including leaderGeneration, tools116, handler106/10, execution99/17, service1, capability set, redacted file identity kind, check IDs/status/code/duration, and `waived:false` for every blocking check. `AcceptanceAttestationV1` requires attester/time, `method:'ed25519-local-owner'`, public-key fingerprint/keyId, evidence SHA-256, and detached signature filename. Owner private key lives only under secured stateRoot; public PEM/signature may be committed. Screenshots are not committed, only optional hashes.

- [ ] **Step 4: Implement fake-control acceptance flow**

Exercise doctor, pair, selection/context/grounding, `snapshot.capture` service kind/name, token/PDF, library import, same actor across leader/follower/control rotation, origin-session cancel denial and owner-admin resolution, same-ID/conflict, journal dispatched-fsync crash points, egress output/no-output/unknown finalizers, bounded demotion port-retain failure, all section3.12 table boundaries, Task9 real plugin progress/cancel, writes/approval/undo/flap/path/URL/Motion/video/redaction. Assert no raw data.

- [ ] **Step 5: Implement packed-artifact install, launch, and evidence signing**

`install-release-artifacts.mjs` reads Task 15 artifact/checksum manifest, verifies MCP/CLI tarballs and plugin ZIP before extraction, creates the requested isolated prefix, and invokes `npm install --ignore-scripts --prefix service/.acceptance-tmp/windows` or `service/.acceptance-tmp/macos` with the two manifest-resolved tarball paths as separate argv values. It records exact installed bin paths and ZIP hash and refuses workspace package paths. `desktop-acceptance.mjs --release-install service/.acceptance-tmp/windows/release-install.json` (or the macOS counterpart) spawns only the installed MCP bin, calls only the installed CLI bin, and requires `/ping` build identity to match artifact metadata. Evidence signing uses local Ed25519 private key; verification uses committed public PEM and detached signature.

- [ ] **Step 6: Run harness GREEN and mark source-complete preview**

Run: `pnpm -C service exec vitest run test/acceptance-harness.test.ts`, then `pnpm -C service desktop:acceptance -- --require-live` with no plugin.

Expected: fake/signature/artifact-tamper tests PASS; live command reaches the domain and exits nonzero with `PLUGIN_NOT_CONNECTED` plus pairing instructions—not script/module missing. Generate `source-complete-preview.json` with implementation/release statuses, Task 15 artifact hashes, harness result hash, and timestamp. Tasks 1–16 may now report implementation status `source-complete-preview` and release status `blocked-external-evidence`; they do not claim GA.

- [ ] **Step 7: Request independent spec review**

Reviewer maps every DoD live requirement to one evidence check ID and confirms Windows/macOS are independently blocking.

- [ ] **Step 8: Request independent quality review**

Reviewer checks redaction, schema validation, exit propagation, partial evidence cleanup, deterministic check IDs, and no committed Figma data.

- [ ] **Step 9: Commit acceptance harness**

Run section6.2, stage `service/docs/evidence-schema.json service/docs/desktop-acceptance.md service/scripts/desktop-acceptance.mjs service/scripts/install-release-artifacts.mjs service/scripts/sign-evidence.mjs service/scripts/verify-evidence-signature.mjs service/test/acceptance-harness.test.ts service/package.json service/vendor-rules.json service/vendor-map.json service/upstream-lock.json`, review/rerun same tree, then commit exact `test(acceptance): verify packed artifacts and signed evidence`.

### Task 17 — Record blocking Windows Figma Design evidence

**Files**

- Create: `service/docs/evidence/windows-desktop-v0.1.json`, `.sig`, and `windows-owner.pub.pem` after a successful run.
- Do not create: Figma file exports, screenshots, tokens, pairing codes, URLs, or design text in the repository.

**Interfaces**

- Consumes: Task 15 checksummed artifacts and Task 16 live runner/evidence schema.
- Produces: schema-valid, detached-signature-verified Windows evidence from packed artifacts. Absence/failure leaves GA blocked but does not undo the truthful Task 16 source-complete preview.

- [ ] **Step 1: Assign the blocking owner and fixture access**

Release manager records one named Windows acceptance owner and that owner’s Ed25519 public-key fingerprint in the protected release environment before the run, provides a disposable editable Figma Design file, an approved library-variable key when available, and an owned HTTPS image fixture with pinned content hash.

- [ ] **Step 2: Install and verify the exact packed artifacts**

Run: `node service/scripts/install-release-artifacts.mjs --manifest service/artifacts/manifest.json --dest service/.acceptance-tmp/windows` and inspect the produced `release-install.json`.

Expected: every SHA-256 matches Task 15, installed MCP/CLI bins are under the isolated prefix, plugin ZIP hash matches, no workspace bin path appears.

- [ ] **Step 3: Verify pre-pair RED from installed bins**

Run: `node service/scripts/desktop-acceptance.mjs --release-install service/.acceptance-tmp/windows/release-install.json --require-live --os windows --output service/docs/evidence/windows-desktop-v0.1.json` before opening the plugin.

Expected: nonzero `PLUGIN_NOT_CONNECTED`; no PASS evidence is written.

- [ ] **Step 4: Pair and run the Windows live matrix from installed bins**

Import the exact release ZIP from `release-install.json`, enter Pair ID+eight-digit code, and rerun the same installed-bin command. `/ping` build identity and MCP/CLI/plugin hashes must match the release manifest. Required checks: strict product/status, full context+recursive section assembly, three grounding maps, snapshot/graph, JSON/CSS tokens, ordered PDF, same-ID once/mismatch conflict/persisted settled response, write FIFO, approval reject/approve, dispatcher-owned one-command undo boundary, flap/generation transitions, outside-root reject, allowed-domain add/remove and approved/denied DNS-pinned URL paths, library import success or coded capability-negative, Motion/video small success or typed unsupported result, diagnostic redaction.

- [ ] **Step 5: Sign and validate Windows evidence and automated gate**

Run: `node service/scripts/sign-evidence.mjs --evidence service/docs/evidence/windows-desktop-v0.1.json --state-root auto --signature service/docs/evidence/windows-desktop-v0.1.sig --public-key service/docs/evidence/windows-owner.pub.pem`, then `node service/scripts/verify-evidence-signature.mjs --evidence service/docs/evidence/windows-desktop-v0.1.json --signature service/docs/evidence/windows-desktop-v0.1.sig --public-key service/docs/evidence/windows-owner.pub.pem`, `pnpm -C service exec vitest run test/acceptance-harness.test.ts`, and `pnpm -C service verify:release`.

Expected: all blocking Windows check IDs PASS, `waived:false`, artifact hashes match, full release gate remains green.

- [ ] **Step 6: Request independent spec review**

Reviewer verifies fixture permissions, exact release hashes, capability-negative semantics, and single-step Ctrl+Z/Cmd+Z scope without viewing sensitive design data.

- [ ] **Step 7: Request independent quality review**

Reviewer inspects evidence redaction/schema/check durations and confirms no external fixture secret or file content entered Git.

- [ ] **Step 8: Commit Windows evidence**

Run: `git diff --check`, then `git add service/docs/evidence/windows-desktop-v0.1.json service/docs/evidence/windows-desktop-v0.1.sig service/docs/evidence/windows-owner.pub.pem`, then `git commit -m "test(acceptance): record signed windows release evidence"`.

### Task 18 — Record blocking macOS Figma Design evidence

**Files**

- Create: `service/docs/evidence/macos-desktop-v0.1.json`, `.sig`, and `macos-owner.pub.pem` after a successful run.
- Do not create: Figma file exports, screenshots, tokens, pairing codes, URLs, or design text in the repository.

**Interfaces**

- Consumes: Task 15 checksummed artifacts and Task 16 live runner/evidence schema; independent macOS machine/owner.
- Produces: schema-valid, detached-signature-verified macOS evidence from the same packed artifact hashes. Absence/failure leaves GA blocked even when Windows passes; Task 16 source-complete status remains truthful.

- [ ] **Step 1: Assign the blocking owner and fixture access**

Release manager records one named macOS acceptance owner and that owner’s Ed25519 public-key fingerprint in the protected release environment before the run, then provisions the same semantic fixture matrix as Task 17 without sharing secrets through Git.

- [ ] **Step 2: Install and verify the exact packed artifacts**

Run: `node service/scripts/install-release-artifacts.mjs --manifest service/artifacts/manifest.json --dest service/.acceptance-tmp/macos`.

Expected: checksums match and installed MCP/CLI/plugin paths are isolated from the workspace.

- [ ] **Step 3: Verify pre-pair macOS RED**

Run: `node service/scripts/desktop-acceptance.mjs --release-install service/.acceptance-tmp/macos/release-install.json --require-live --os macos --output service/docs/evidence/macos-desktop-v0.1.json` before opening the plugin.

Expected: nonzero `PLUGIN_NOT_CONNECTED`; no PASS evidence is written.

- [ ] **Step 4: Pair and run the full macOS live matrix**

Repeat every Task 17 check using the exact release checksums. Verify macOS Application Support stateRoot permissions, reconnect/resume rotation, Cmd+Z one-operation undo scope, and plugin re-import after `teamlibrary` manifest change.

- [ ] **Step 5: Sign and validate macOS evidence and final release gate**

Run: `node service/scripts/sign-evidence.mjs --evidence service/docs/evidence/macos-desktop-v0.1.json --state-root auto --signature service/docs/evidence/macos-desktop-v0.1.sig --public-key service/docs/evidence/macos-owner.pub.pem`, then `node service/scripts/verify-evidence-signature.mjs --evidence service/docs/evidence/macos-desktop-v0.1.json --signature service/docs/evidence/macos-desktop-v0.1.sig --public-key service/docs/evidence/macos-owner.pub.pem`, `pnpm -C service exec vitest run test/acceptance-harness.test.ts`, and `pnpm -C service verify:release`.

Expected: all blocking macOS IDs PASS, `waived:false`, hashes match, and both OS evidence files identify the same service artifact checksums.

- [ ] **Step 6: Request independent spec review**

Reviewer confirms all required checks match Windows semantics and no unsupported editor/plan result was silently treated as success.

- [ ] **Step 7: Request independent quality review**

Reviewer checks redaction, permission evidence, timing, artifact equality, and absence of committed user data.

- [ ] **Step 8: Commit macOS evidence**

Run: `git diff --check`, then `git add service/docs/evidence/macos-desktop-v0.1.json service/docs/evidence/macos-desktop-v0.1.sig service/docs/evidence/macos-owner.pub.pem`, then `git commit -m "test(acceptance): record signed macos release evidence"`.

---

## 8. v0.1 Definition of Done

### Source-complete Preview Boundary

- Tasks 1–16 complete the authorized implementation objective when all source/artifact/harness gates below pass.
- The truthful status at that point is `implementationStatus:'source-complete-preview'` and `releaseStatus:'blocked-external-evidence'` unless both external evidence Tasks have already passed.
- This status may be reported as implementation complete; it may not be described as GA, released, or Desktop-live-accepted on both OSes.

### Functional

- `service/` builds, tests, packs, and runs without `code-kb` imports or runtime reads.
- Baseline audit proves tools112, handlerAuthority105 plugin-handler/7 server-only, execution98 plugin-direct/14 exact server-adapters, and service registry0 before Task11.
- Final audit proves tools116, handlerAuthority106/10, execution99/17, service registry1 `snapshot.capture`, kind read23/local13/write80.
- Result/runtime/policy/egress/TargetRequirement maps cover116 with no fallback; handler parity and execution routing are independently asserted.
- Canonical manifest has 116 implemented rows; source ledgers have lexical114/helper20/parser12 with 11 unique parser behaviors and no unclassified row.
- Motion7 and video1 are present as experimental-native in registry, runtime, policies, docs, and artifacts.
- Selection/context/screenshot/component-token-icon grounding and typed writes pass unit/process/fake-control acceptance; Tasks 17/18 separately prove live editable Design.
- `export_tokens`, ordered `export_frames_to_pdf`, `doctor`, and `import_library_variable` pass focused/process/harness capability tests; GA evidence records live positive or typed capability-negative outcomes.
- CLI doctor/status/pair/workspace/approvals/compat/snapshot/token/PDF/read/write/import wrappers use authenticated control and the same executor.
- All tool entries and Task11 service operation enter one leader-generation plane; followers own only client+opaque Task6 transport; unknown/conflicted forward zero args. Tool/service/admin route classes cannot cross-call.
- Strict tool/service/cancel requests produce native pre-admission rejection or accepted/progress/exactly-one-terminal; no Relay/runtime bypass. Snapshot journal rows are kind service/name snapshot.capture outside116.
- Task9 real plugin and Task15 packed plugin consume Task7 progress/cancel schemas with listener cleanup, exact frame cap, and parity; Task7 fake alone is insufficient.
- SnapshotV1/GroundingGraphV1 persist under an approved workspace with stable file identity, section fidelity, checksum, and atomic writes.
- Snapshot storage uses only the injected port and `.sfp/snapshots/v1/{fileIdentityHash}/{snapshotId}.json`; recursive fidelity distinguishes expanded plans, complete leaves, failed/cycle/depth/cap issues with stable path/order.
- Skills distinguish code AST scan from Figma component discovery and do not claim deterministic reverse compilation.

### Security and Reliability

- Bind is loopback only; strict Host/Origin/PNA/path/body/WS-frame gates pass.
- Allowed pair POST success and every typed error carry exact ACAO/ACAPN/Vary headers readable by plugin UI; hostile/absent Origin receives no allow headers or oracle body.
- Eight-digit one-time code, 128-bit one-use ticket, rotating resume, follower, and control tokens pass expiry/attempt/rate/rotation/replay tests.
- Task6 frozen base/contract is recorded; public ping exact fields retain leaderGeneration and exclude all plugin/session/file oracles. Task7 imports only opaque FollowerAuthenticatedTransport and never auth/key/encryption internals.
- One owner key derives one stable actor for MCP leader/follower/control. A 128-bit MCP session exists before role choice and its auth1 HMAC survives role transitions; control auth1 changes on rotation; no raw credential is an ID. Cancel requires origin auth session; owner-admin control may list/status/resolve across same-owner domains and records origin/resolver; foreign stateRoot fails.
- Unix owner modes and Windows current-user DACL are verified; insecure stateRoot startup fails closed.
- `stateRoot` and `workspaceRoots` are distinct; workspace add/list/remove is authenticated and every project read/write is sandboxed per path.
- Nonce routes use server-issued 256-bit values bound actor/generation/action/exact semantic hash for 120,000 ms; caps1024/524288, no live eviction, CAS after validation, restart/generation invalidation. Path hash uses exact resolved canonical UTF-8 bytes without Unicode normalization; FQDN uses exact ASCII. CLI issues, never invents; approvals keep exact-once IDs.
- Null Origin alone never authenticates a plugin. Foreign product/2xx never becomes leader. Unknown role never forwards args.
- Body identity/context is rejected. Path args resolve metadata/realpath into PolicyInvocationContext before effects with no content/network/runtime. TargetRequirement exact forbidden/optional/required rules pass; target/key derive from authenticated Relay, deep-freeze, no filename fallback/reroute.
- Dynamic effects distinguish data/URL, content/outPath, overwrite/create-new, read/write, library import, and experimental heavy operations.
- Destructive, filesystem-write/overwrite, network, library-import, and broad-write actions receive the required explicit approval. Inside-root filesystem reads follow workspace/sensitivity policy without being mislabeled as writes.
- Per-file queue serializes same file across sessions; different file identities can progress independently within read/heavy limits.
- Same `(actorId,operationId,kind,name,args,workspace,file)` applies once across role/control rotation; mismatch conflicts. Persisted success settles runtime-zero; cancel remains origin-session bound.
- Operation IDs are server-issued/HMAC-bound to owner actor and issuedAt; age `>=2,592,000,000 ms` is expired, future skew `<=300,000 ms` allowed and above invalid, all runtime zero at rejection.
- Capacity→durable pending→approval→pre-egress reserve fsync→queue→dispatched fsync→first side effect→classification→egress finalizer fsync→terminal fsync→frame ordering and every crash boundary pass. Post-dispatch loss is unknown, never replay.
- Journal compacts active transitions at 8,000 rows/24 MiB, stops normal operation appends at 10,000 rows or 31 MiB, reserves the final exact 1 MiB of its 32 MiB active allocation for fsynced resolution intents, moves ordinary terminal records to a separate 1,000,000-entry/256 MiB tombstone index through each signed 30-day horizon, rejects older IDs from signed issuedAt after purge, and keeps status/resolution/purge routes available to unblock capacity/workspaces.
- Authenticated owner-local operation issue/list/status/resolve and CLI commands record actor/auth/confirmation/reason/evidence hashes without normal approval. A confirmed resolution is an authoritative reserved no-replay tombstone even when the ordinary tombstone index is full; resolved-applied/resolved-not-applied/abandoned release unresolved workspace/cap accounting, while reserve-full fails typed and leaves state unchanged.
- Effects/approval and exact `classifyInput`/possible-result preflight occur before queue/runtime; disallowed external/unknown classes yield runtime zero. Strict result validation and `classifyResult` occur afterward, actual classes must fit the preflight upper bound, and audit contains no raw code/design/image/secret payload.
- Egress canonical hash excludes its own hash field. Every durable reservation finalizes once as output/no-output/unknown; capacity releases only after finalizer fsync. Restart/double/conflict/crash, truncated-tail/mid-corruption, raw-free tests pass.
- All section3.12 below/exact/above fixtures pass for horizons/skew/nonces/journal/egress/progress/pair/follower/control/MCP/WS/images/video/cache plus declared/chunked predecode runtime-zero and active operation/subscriber/raw-args admission.
- Bounded demotion is single-flight/awaited: 5,000 ms absolute, 1,000 ms drain, generation fence and durable unknown/finalizers before destroy/port release; durability failure retains port.
- URL import validates approval, HTTPS, every DNS/redirect hop, address ranges, domain, MIME/signature, and streamed size in the daemon. Plugin external URL fetch and wildcard permission are absent.
- URL connections are pinned to the vetted IP with original Host/SNI/certificate verification and secureConnect remoteAddress check; every redirect re-resolves. The default allowlist is empty and v0.1 accepts exact three-or-more-label ASCII FQDN equality only—no wildcard, suffix/subdomain rule, apex two-label host, or PSL dependency.
- The plugin top-level dispatcher is the sole `commitUndo` caller. A changed document write/batch/library import/system UUID creates one boundary; handlers, read, navigation/figma-ui, no-op, and failure create none.
- Exact mutation contracts cover baseline 79 and final 80 write-kind handlers; every mutation handler returns `{value,mutated}`, wire output exposes only value, and production handler files contain zero commitUndo calls.
- Raw evaluator and non-loopback code paths are absent from source and release bundles.

### Quality and Release

- Frozen install, typecheck, lint, format check, knip, build, unit, integration, process E2E, artifact, and docs-sync tests pass on Ubuntu and Windows CI.
- Every Tasks8–16 subcommit has the authority trio, offline verifier/vendor test, and spec/quality PASS on the same tree; no later task backfills authority.
- Built-dist E2E cannot silently skip in CI/release.
- `verify:release` runs verify/build → SBOM → notices → umbrella `package-artifacts.mjs` → checksums → artifact tests/verifier, producing and inspecting MCP/CLI tarballs and plugin ZIP from a clean artifact directory.
- MCP bundle contains shared+IR and CLI bundle contains shared; packed manifests have no workspace/private runtime dependency, and each tarball installs alone in an empty prefix/cache and runs its installed bin/tool smoke.
- Artifact verifier opens plugin ZIP and proves real Task9 progress/cancel parity plus exact tools/handler/execution/service authorities and PublicPingV1 fields.
- GA evidence launches checksum-verified installed tarball bins plus the exact plugin ZIP, binds `/ping` build identity to artifact hashes, and verifies detached owner Ed25519 signatures.
- Three upstream MIT notices, service license, pdf-lib notice, THIRD_PARTY_NOTICES, PROVENANCE, SBOM, and capability ledgers are present in every applicable artifact.
- Solar CC BY assets and raw exec symbols are absent.
- Offline upstream verification passes without original checkouts; parent-workspace verification confirms all three original repos remain clean at pinned commits.
- Service CI/release workflows use frozen install, least permissions, immutable action digests, and protected release approval.

### Documentation and Policy

- README/capability matrix state Desktop editable Design v0.1, Dev read-only, FigJam partial, Web/public deferred, and no view-only bypass.
- Build-vs-buy documents official `use_figma`, `generate_figma_design`, design-system search/assets, permissions/current limitations, checked URLs/date, and separate MCP/REST limit authorities without fixed rate numbers.
- Docs say REST/official MCP endpoints are not used by the local path while Figma account/edit/plugin/policy and model-provider costs remain.
- Docs cover Task6 outer/Task7 inner boundary, public ping, stable actor/auth sessions, origin cancel/admin resolution, path-policy/target/runtime authorities, tool/service/admin split, journal/finalizer/demotion/section3.12 limits, real plugin consumer, plus all prior egress/retention/workspace/URL/snapshot/Motion/CLI boundaries.

### GA Release Evidence

- `windows-desktop-v0.1.json` and `macos-desktop-v0.1.json` both validate against AcceptanceEvidenceV1.
- Both name an acceptance owner/operator, contain matching release artifact hashes, set every blocking check to pass with `waived:false`, and contain no Figma content or secret.
- If either environment/owner/fixture is unavailable, GA/release remains blocked; automated tests do not substitute for the missing live gate, while the Task 16 source-complete preview status remains valid.

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
| A-IP-I02 | accepted/strengthened | Safe union consumes auth/executor/fs/plugin/grounding; R5 makes T11→T12 sequential because service1 and authority-trio trees are shared. |
| A-IP-I03 | accepted | Task 8 moves URL fetch into daemon RemoteImageFetcher and Task 9 removes plugin URL branch/wildcard. |
| A-IP-I04 | accepted | Task 4 creates state-backed workspace add/list/remove authority; Task 13 exposes authenticated workspace commands. |
| A-IP-I05 | accepted | IR explicitly depends on shared; Task 11 defines pinned section plan assembly, fidelity fields, progress/cancel, and 10k-node memory test. |
| A-IP-I06 | accepted | fileKey fallback is a persisted document plugin-data UUID with approval/undo; unstable read-only identity cannot persist snapshot/diff. |
| A-IP-I07 | accepted | Human code is exactly eight digits; internal ticket is 128-bit; endpoints, PNA, expiry/attempt/rate, resume rotation, and Windows DACL are explicit. |
| A-IP-I08 | accepted | Journal lives under owner-only stateRoot, includes actor/workspace/file/policy/approval/hash fields, conflict/recovery/compaction/cap behavior. |
| A-IP-I09 | accepted | Shared egress taxonomy/config and progress contract are wired through executor, snapshot, PDF/video, relay/MCP/CLI, cancel, and absolute deadline. |
| A-IP-I10 | accepted | Task 13 implements approvals list/approve/reject; Task 9 defines commitUndo once per top-level write/batch and zero for other outcomes. |
| A-IP-I11 | accepted | Manifest separates disposition/registration/availability/investment; Motion7+video are experimental-native advertised/implemented. |
| A-IP-I12 | accepted | Tasks 17/18 name blocking acceptance-owner roles, schema-valid evidence, fixture provisioning, and no-GA behavior; Task 16 may truthfully mark source-complete/release-blocked. |
| A-IP-I13 | accepted | Every Task contains independent spec review and independent quality review before an exact commit step. |

### Agent B

| Finding | Decision | Resolution |
|---|---|---|
| B-C-01 | partially accepted | The parent requested one directly executable plan, so five separate documents were not created. The same concern is addressed by 18 smaller Tasks, five milestone checkpoints, exact Interfaces, code/test snippets, commands, two reviews, and commits. |
| B-C-02 | accepted | Task 1 bootstraps the runner before domain RED; each later RED names the concrete missing module or current buggy behavior; acceptance skeleton precedes live absence RED. |
| B-C-03 | accepted | Section 3.2 and Task 5 use `effectsFor(args,context)`, dynamic idempotency/approval, and conservative static annotations. |
| B-C-04 | accepted | Explicit pdf-lib dependency and Task 12 ordered merge implementation remove the impossible GREEN. |
| B-C-05 | accepted | Section 3.4 and Task 4 separate owner-only stateRoot from workspaceRoots; Figma-only/no-workspace and filesystem-required rules are explicit. |
| B-I-01 | accepted | DAG orders RuntimePaths→policy→auth→executor→fs/network→plugin and places control tool call with executor. |
| B-I-02 | accepted | Task 1 adds git/editor/npm hygiene; Task 15 adds exact CI/release, package maps, frozen install, and artifacts. |
| B-I-03 | accepted | Section 3.5 defines challenge/exchange/hello/resume, PNA, owner storage, rotation, and eight-digit→128-bit sequence. |
| B-I-04 | accepted | Task 8 routes each descendant read and write through adapters and structurally rejects direct fs imports outside explicit authorities. |
| B-I-05 | accepted | Task 11 specifies full section capture/merge, partial fidelity, same-session pin, memory/progress/cancel tests. |
| B-I-06 | accepted | Task 14 creates `docs/build-vs-buy.md` and docs-sync tests for official write, code-to-canvas, search/assets, date/URLs, no numeric constants. |
| B-I-07 | accepted | Task 9 adds commitUndo rules; Tasks 17/18 define blocking OS owners, library/URL fixtures, negative capability and evidence. |
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
| I-06 | accepted/strengthened | Maps cover112→116; final handlerAuthority106/10 and execution99/17 are separate; snapshot is service1 outside MCP tools. |
| I-07 | accepted | Motion/video remain registered and Task 12 wires heavy budget, progress, absolute deadline, cancel, payload limits, and Task 17/18 checks. |
| I-08 | accepted | Exact vendor rules/map, per-file hashes, offline/with-upstreams modes, namespace scope, and hygiene are specified. |
| I-09 | accepted | Task 13 defines command mapping/options/policy/output/exit and explicitly chooses active-daemon companion behavior instead of hidden spawn. |
| I-10 | accepted | Task 15 defines MCP/CLI/plugin artifact matrix, SPDX SBOM, notices, provenance, checksums, and release verification. |
| I-11 | accepted | Task 16 defines runner/evidence schema/source-complete marker; Tasks 17/18 define owners, redaction, stable fixture policy, detached signatures, and GA-blocking evidence. |

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
| B-I-07 | accepted | Undo is dispatcher-only; acceptance installs checksum-verified MCP/CLI tarballs and exact plugin ZIP, binds ping identity to hashes, and produces verifiable detached Ed25519 owner evidence. |
| B-I-08 | accepted/strengthened | Source/target hashes remain; RuntimeBinding now carries execution99/17 while ToolSpec handlerAuthority carries106/10; maps116 and service1 are separate. |
| B-I-10 | partially accepted | One parent plan remains per instruction. Section 6.1 now gives every Task a maximum semantic review surface and makes large Tasks 2/7/8/9/12 separately rejectable slices without changing the required Tasks17/18 evidence numbering. |
| N-C-01 | accepted | Vendor rules copy only source/test/skills/build files; root/package/lock/config are merge/reference authorities, Task 1 files are hash-protected, upstream postinstall is dropped, and service lock is regenerated/frozen. |
| N-C-02 | accepted | Runtime import/dependency specifiers are AST-checked; raw @figwright protocol/comment/user/provenance strings use an exact allowlist; production code-kb search remains zero. |
| N-C-03 | accepted | Succeeded old-generation records never execute; queued/pending fail, dispatched becomes unknown, in-memory exact replay is bounded, persisted exact success returns settled status, mismatch remains conflict. |
| N-I-01 | accepted | JournalLimits fixes 8k/24MiB compaction, 10k rows or 31MiB normal hard cap plus a dedicated 1MiB resolution reserve, horizon tombstones, signed-ID expiry, unresolved retention, manual resolution, and exact fail-closed/unblock behavior. |
| N-I-02 | accepted/strengthened | Task7 owns daemon schemas/fake transport, Task9A real plugin consumer, Task11 snapshot service producer, Task12 PDF/video producer, Task13 client. |
| N-I-03 | accepted | Tasks 17/18 install verified tarballs into isolated prefixes, execute installed bins, verify plugin ZIP/ping hashes, and validate detached local-owner signatures. |

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
| B-I-07 | accepted | Task 9 migrates exact baseline79 mutation handlers with hand-derived fixtures/wire-value stripping/dispatcher-only undo; Task 15 bundles internal workspaces and isolated tarball smoke proves release closure. |
| B-I-10 | accepted | Tasks 2/7/9/12 now have dependency-visible subtask slices, slice-specific RED/GREEN, independent reviews, commits, frozen hashes, and downstream handoffs while fixed Tasks17/18 numbering remains. |
| N-C-03 | accepted | Server-issued HMAC operation IDs carry issuedAt/keyId/nonce/actor; terminal rows compact to 30-day tombstones and expired signed IDs always return OPERATION_ID_EXPIRED/runtime0 after purge. |
| N-I-01 | accepted | Unknown-resolution states/API/CLI/audit are implemented in the plan; hard-cap keeps resolution available, resolved rows unblock workspace/cap, and same ID remains settled. |
| N-I-03 | accepted | MCP always-bundles shared+IR and CLI shared; packed manifests have no private/workspace runtime dependency; Task 15 installs each tarball alone in empty prefixes/caches and runs installed tools. |
| R2-C-01 | accepted | Exact POST pair CORS matrix and process/UI tests make success/wrong/expired/used/rate/internal responses readable only to validated Figma/null Origins. |
| R2-C-02 | accepted | Task 9 Files glob and mutation-handler authority cover 78 non-batch modules+batch, changed/no-op fixtures for all79, internal metadata stripping, final library row80, and sole dispatcher commit site. |
| R2-C-03 | accepted | Exactly-once is explicitly 30 days; signed issuedAt rejects older IDs forever, in-horizon terminal tombstones prevent reexecution, and generation transitions remain deterministic. |
| R2-C-04 | accepted | tsdown internal bundle closure, packed-manifest checks, fresh-cache one-tarball installs, npm ls, MCP116 list-tools, CLI bin smoke, and workspace-path zero gate are Task 15 requirements. |
| R2-I-01 | accepted | IR-owned SnapshotStoragePort save/load/list/delete signatures and `.sfp/snapshots/v1/{fileIdentityHash}/{snapshotId}.json` are exact; design diff uses a separate namespace and shared has no future IR reference. |
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
| R3-I-02 | accepted | Umbrella `package-artifacts.mjs` deterministically produces mcp.tgz, cli.tgz, and plugin.zip before checksums/tests; one clean `verify:release` command covers creation through isolated verification. |
| R4-SPOT-N01 | accepted | Reserved resolution records copy the full issuedAt/tool/args/workspace/file/result fingerprint before fsync, preserving exact settled versus mismatch-conflict behavior after active-row compaction. |
| R4-SPOT-N02 | accepted | MCP/CLI are packed from staged package roots whose `files` arrays and in-root copies include every license/notice/provenance/SBOM/capability authority required by artifact tests; no parent-path npm files assumption remains. |
| R4-SPOT-N03 | accepted | Task 15 RED uses a runnable test-only baseline artifact assembler, so content assertions fail on missing authorities rather than missing future production scripts; the umbrella producer remains the GREEN implementation. |
| R4-SPOT-N04 | accepted | Task 12 updates and stages the mutation-contract test/fixture ledger; final80 is exact baseline79 union `import_library_variable`, not merely a length assertion. |

### 2026-08-28 Task 7 preflight amendment and ruling

Historical ruling: Tasks1–5 evidence remains valid and Task6 is frozen at its final reviewed base. Original SHA `5EAFC23397F4A7DD147263ABAB6AF258AABB4207FCE5ED33EE428C13D15B826A` and first amended checksum are superseded by the final Review A/B/C amendment below. Executors use only the new committed checksum after fresh rereview READY.

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

### Final 2026-08-28 Review A/B/C comparison resolutions — frozen Task6

Three independent reviews compared the prior amendment and returned **NOT READY: Critical2 / Important12 / Minor1**. This author amendment resolves their deduplicated findings against frozen Task6 base `dcbba9b919c8a54e3c33719e1964129b41f858fe` and contract hash `6a68c9405a2feebce439d105fe83199c6aef4538f9ebf3bd14963ffa4309c7b3`. Prior plan SHA `7739ef989caf5ea9cdc4a51b898ceeb0bb559d88b18cd5dfd34a2075cc9beb75` is superseded. Tasks1–5 evidence and reviewer-approved Task6 evidence remain preserved. Three fresh scoped rereviews run against the committed final plan/checksum before Task7 execution.

| Deduplicated finding | Review source | Final author resolution in this amendment |
|---|---|---|
| R5-C1 public ping | Review A critical; B/C comparison confirmed | Exact PublicPingV1 retains leaderGeneration and removes only session/plugin/file oracles; Task7 consumes frozen Task6. |
| R5-C2 actor/admin domains | Review A critical; B/C comparison confirmed | One stateRoot owner actor for all paths; MCP/control auth1 derivation, role/rotation behavior, origin cancel, admin resolution, audit and foreign-root tests are exact. |
| R5-I1 policy context/order | Reviews A/B/C deduplicated | Preserve distinct Task5 PolicyInvocationContext/resolvedPaths; resolve declared paths metadata-only before effects, then target requirement/frozen runtime scope. |
| R5-I2 runtime authority | Reviews A/B/C deduplicated | Split handlerAuthority105/7→106/10 from execution98/14→99/17 with exact adapter names and PinnedPluginRuntimePort only. |
| R5-I3 target requirement | Reviews A/B/C deduplicated | Exact forbidden/optional/required matrix and typed none/selected errors for baseline/final tools. |
| R5-I4 journal order | Reviews A/B/C deduplicated | Pending/dispatched/egress/terminal fsync order, first-side-effect barrier, generation terminal CAS and every-arrow crash tests. |
| R5-I5 egress finalizer | Reviews A/B/C deduplicated | Every reservation finalizes output/no-output/unknown exactly once; capacity releases only after fsync; restart/double/conflict/crash tests. |
| R5-I6 bounded demotion | Reviews A/B/C deduplicated | election.ts single-flight prepare/finalize, 5,000 ms absolute/1,000 ms drain, durability-before-port-release and retained-port failure. |
| R5-I7 opaque Task6 transport | Reviews A/B/C deduplicated | Frozen opaque FollowerAuthenticatedTransport; Task7 inner plaintext only, no auth-key imports, full frozen security suite every slice. |
| R5-I8 real plugin consumer | Reviews A/B/C deduplicated | Task7 daemon/fake only; exact Task9A bridge/code/panel/UI consumer/tests; Task15 packed parity. |
| R5-I9 service operation seam | Reviews A/B/C deduplicated | Task7 registry0, Task11 snapshot.capture registry1 outside116, kind/name journal and tool/service/admin route separation. |
| R5-I10 downstream authority | Reviews A/B/C deduplicated | Section6.2 applies authority trio and same-tree reviews to every Tasks8–16 subcommit. |
| R5-I11 wire/admission bounds | Reviews A/B/C deduplicated | Opaque outer vs exact inner/control/MCP/response/plugin caps; pre-allocation rejection, active/raw/subscriber caps and exact-one terminal admission model. |
| R5-I12 inclusive fixtures | Review C value audit; A/B comparison confirmed | Section3.12 is the single table-driven below/exact/above authority for every supplied numeric value and declared/chunked/runtime-zero path. |
| R5-M1 exact rerun | Review A/B quality finding; C confirmed | 7B_GREEN_COMMANDS lists exact paths and full security/typecheck/authority commands and is rerun verbatim on the reviewed tree. |
| R5-M1 canonical hashes | Review A/B/C minor comparison | Auth session is HMAC not credential; manifest/record self-hash fields omitted; path action hash uses exact resolved bytes with no Unicode normalization alias. |

No Round 1–4 Critical/Important finding is rejected. The only alternative scope resolution remains the explicit exact-FQDN/no-suffix v0.1 policy; no new rate or feature scope was added.

---

## 11. Execution Handoff

This final plan/checksum is committed against frozen Task6. Do not execute Task7 until three fresh scoped plan rereviews return READY; then discard/regenerate Task7 brief from the committed checksum and use subagent-driven development with per-slice staged-tree reviews. Tasks1–16 may reach only source-complete/release-blocked status; Tasks17/18/release remain externally gated.
