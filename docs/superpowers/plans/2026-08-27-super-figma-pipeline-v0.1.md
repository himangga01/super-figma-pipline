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
- Baseline parity is exactly 112 MCP tools, 105 plugin handlers, and 7 server-only names. Safe-union registration is atomic and ends at exactly 116 tools, 106 handlers, and 10 server-only names.
- Motion 7 tools and `export_video` remain advertised as `experimental-native`; unsupported editor/capability calls fail with typed guidance instead of disappearing.
- Canonical tool kinds end at read 23, local 13, write 80. Every tool has input schema, runtime result schema, runtime binding, dynamic effects policy, and artifact manifest row.
- Source ledgers are distinct from the canonical registry: lexical tools 114, figmosha helpers 20, figmosha CLI parser entries 12 with 11 unique behaviors, canonical tools 116.
- `stateRoot` stores owner-only auth, leader identity, config, and operation journal. `workspaceRoots` store user-approved code reads, snapshots, mappings, and exports. Neither is silently inferred from a tool argument.
- Figma-only operations may run with `workspaceId:null` only when dynamic effects contain no filesystem access. Project scan/map/export/snapshot operations require a configured workspace. Approved URL-to-Figma import is network+Figma write and may run without a code workspace; its audit stays under `stateRoot`.
- Every call is evaluated from parsed args by `effectsFor(args, context)`. Destructive, filesystem-write/overwrite, network, library import, and broad mutation effects require the policy-selected approval. Egress input/result-class preflight runs after effects/approval but before queue dispatch or any Figma/filesystem/network runtime; disallowed or unknown classes produce runtime call count zero.
- Figma writes are serialized by stable file identity, not by socket session. Reads are bounded and cannot overlap a write on the same `FileExecutionKey`.
- Exactly one `ExecutionPlane` exists for one elected leader generation. Followers construct only `FollowerInvocationClient`; `unknown` and `conflicted` election roles reject locally and forward neither tool arguments nor invocation context. Demotion closes admission before abort/drain/durable recovery and destroys the old plane.
- MCP, follower, and control requests carry only strict `InvocationRequestV1` selectors. Actor, auth session, consent, workspace root, plugin target, file identity/execution key, generation, editor, and capabilities are always server-derived; request-body copies are rejected as unknown fields.
- A 256-bit owner-principal key under secured `stateRoot` derives stable direct-MCP, follower-MCP, and control actors. Target resolution is a leader-side lookup against authenticated Relay sessions; the resulting target and `FileExecutionKey` are immutable for the invocation.
- Idempotency key is `(actorId, operationId)`, where operationId is a server-issued timestamped/HMAC token with a 30-day exactly-once horizon. A forged/future/expired ID fails before runtime. Reuse with different tool, argsHash, workspace, or file target fails `OPERATION_ID_CONFLICT`. Terminal records compact to horizon tombstones; persisted success is never re-executed and returns `OPERATION_ALREADY_SETTLED` when its bounded in-memory result is unavailable.
- A dispatched write whose result is lost becomes `outcome-unknown` and is never blindly replayed. Daemon recovery converts persisted dispatched records to that state.
- Persisted snapshots are loss-aware observed records. Section assembly records partial/omitted/failed sections; no “Figma API 전체 lossless IR” claim is made.
- Model egress mode is explicit configuration, never inferred from `source:'mcp'`. Unknown mode fails closed. Audit records hashes/classes/byte counts, not raw design text, image bytes, source code, or secrets.
- Pre-execution and output egress manifests are durable, hash-chained, fsynced owner-state records. Capacity for both is reserved before runtime; a missing durable post-runtime output manifest makes the real outcome unknown rather than retryable.
- One-use action nonces are server-issued 256-bit capabilities bound to actor, leader generation, exact action, and request hash for 120 seconds. Semantic validation precedes an atomic consume immediately before the side effect; restart/generation invalidates all outstanding nonces.
- Progress/cancel/result/error semantics are one shared protocol projected to MCP progress tokens, framed follower RPC, control NDJSON, and plugin `$progress`/`$cancel`; transport disconnect alone is neither cancel nor retry.
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

export interface OperationPolicy<I> {
  toolName: string;
  effectsFor(args: Readonly<I>, context: InvocationContext): readonly Effect[];
  idempotencyFor(args: Readonly<I>): 'safe-retry' | 'operation-id' | 'never-auto-retry';
  approvalFor(effects: readonly Effect[], context: InvocationContext): 'none' | 'client' | 'explicit-user';
  concurrency: 'parallel-read' | 'file-write' | 'exclusive-heavy';
}

export interface ToolRuntime<I, O> {
  execute(context: InvocationContext, args: I, signal: AbortSignal): Promise<O>;
}

export interface RuntimeBinding<I, O> {
  authority: 'plugin' | 'server';
  runtime: ToolRuntime<I, O>;
}

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

MCP annotations use the union of possible effects and are conservative. Runtime approval uses parsed args. `import_image(data)` has no network effect; `import_image(url)` does. `export_tokens` without outPath has no filesystem write; with outPath it does. Existing output overwrite makes the filesystem effect destructive. Tool kind is registration metadata, not document mutation truth: `navigate_to_page` remains kind write for compatibility but resolves only `figma-ui`, receives no document-write approval, and has no undo boundary.

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

export interface OutputEgressManifest extends PreExecutionConsentManifest {
  resultClasses: readonly DataClass[];
  outputBytes: number;
  outputTokens: number;
  redactedFieldCount: number;
  payloadHash: string;
}

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
  requestId: string;
  operationId: string;
  sequence: number;
  kind: 'pre-execution' | 'output';
  createdAt: string;
  previousRecordHash: string | null;
  manifestHash: string;
  recordHash: string;
  manifest: PreExecutionConsentManifest | OutputEgressManifest;
}

export interface EgressReservation {
  actorId: string;
  requestId: string;
  operationId: string;
  preManifestHash: string;
  reservedOutputBytes: 65536;
}

export interface EgressManifestPort {
  reservePre(actorId: string, requestId: string, operationId: string, manifest: PreExecutionConsentManifest): Promise<EgressReservation>;
  commitOutput(reservation: EgressReservation, manifest: OutputEgressManifest): Promise<{ outputManifestHash: string }>;
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
  actorId: string;
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
  requestId: string;
  toolName: string;
  rawArgs?: unknown;
  operationId?: string;
  workspaceId?: string | null;
  targetSelector: InvocationTargetSelector;
}

export interface InvocationCancelV1 {
  version: 1;
  requestId: string;
  operationId: string;
}

export interface ActorContext {
  actorId: string;
  authSessionId: string;
  source: 'mcp' | 'cli-control' | 'follower';
}

export interface ConsentContext {
  mode: EgressMode;
  consentId: string | null;
  allowedClasses: readonly DataClass[];
}

export interface WorkspaceContext {
  workspaceId: string | null;
  workspaceRoot: string | null;
}

export interface PluginTarget {
  readonly sessionId: string | null;
  readonly pluginGeneration: string | null;
  readonly fileIdentity: Readonly<FileIdentity> | null;
  readonly fileExecutionKey: FileExecutionKey | null;
}

export interface InvocationContext {
  readonly actor: Readonly<ActorContext>;
  readonly consent: Readonly<ConsentContext>;
  readonly workspace: Readonly<WorkspaceContext>;
  readonly target: Readonly<PluginTarget>;
}

export interface RuntimeExecutionScope extends InvocationContext {
  readonly requestId: string;
  readonly leaderGeneration: string;
}

export interface ExecutionPlane {
  readonly leaderGeneration: string;
  invoke(principal: Readonly<ActorContext>, request: InvocationRequestV1): AsyncIterable<InvocationFrameV1>;
  cancel(principal: Readonly<ActorContext>, request: InvocationCancelV1): Promise<void>;
  demote(reason: 'abdicated' | 'lease-lost' | 'shutdown'): Promise<void>;
}

export interface ApprovalRecord {
  approvalId: string;
  actorId: string;
  operationId: string;
  decision: 'approved' | 'rejected' | 'expired';
  decidedAt: string;
}

export interface ApprovalDecisionPort {
  decide(scope: RuntimeExecutionScope, toolName: string, effects: readonly Effect[], operationId: string): Promise<ApprovalRecord | null>;
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

export interface OperationIdClaims {
  version: 1;
  keyId: string;
  issuedAt: number;
  nonce: string;
  actorHash: string;
}

export interface OperationIdIssuer {
  issue(actorId: string, now?: number): string;
  verify(actorId: string, operationId: string, now?: number): OperationIdClaims;
}

export interface OperationRecord {
  actorId: string;
  authSessionId: string;
  operationId: string;
  issuedAt: number;
  toolName: string;
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
  outputEgressManifestHash: string | null;
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
  actorId: string;
  operationId: string;
  resultHash: string | null;
  resultBytes: number;
  settledAt: string;
}

export interface OperationTombstone {
  actorId: string;
  operationId: string;
  issuedAt: number;
  expiresAt: number;
  toolName: string;
  argsHash: string;
  workspaceId: string | null;
  fileExecutionKey: FileExecutionKey | null;
  resultHash: string | null;
  status: 'succeeded' | 'failed' | 'rejected' | 'resolved-applied' | 'resolved-not-applied' | 'abandoned';
}

export interface OperationResolutionRecord {
  actorId: string;
  authSessionId: string;
  operationId: string;
  issuedAt: number;
  toolName: string;
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

export interface ToolInvocationService {
  invoke(scope: RuntimeExecutionScope, toolName: string, rawArgs: unknown, operationId?: string): Promise<unknown>;
  status(actorId: string, operationId: string): OperationRecord | undefined;
}
~~~

`InvocationRequestV1` is a strict-versioned wire schema. Its only accepted keys are `version`, `requestId`, `toolName`, optional `rawArgs`, optional `operationId`, optional `workspaceId`, and `targetSelector`; cancellation accepts only `version`, `requestId`, and `operationId`. Every entry point rejects unknown keys, including body-supplied `actor`, `actorId`, `authSessionId`, `principal`, `consent`, `mode`, `allowedClasses`, `workspaceRoot`, `target`, `FileIdentity`, `fileExecutionKey`, `pluginGeneration`, `editorType`, and `capabilities`. `workspaceId` is only an approved-store lookup key, never a root path. `active`, `session`, and `stable-file` selectors are lookup hints; `stable-file.fileIdentityHash` matches `^sha256:[0-9a-f]{64}$`, carries no body `FileIdentity`, and is only an authenticated-session-index lookup. `none` is valid only for server runtimes whose effects require no Figma target. After tool parse/policy lookup, the leader resolves one authenticated Relay session, derives `PluginTarget` and `FileExecutionKey` from that session's registered `FileIdentity`, freezes one `RuntimeExecutionScope`, and never re-resolves it during that invocation. An unstable key includes the registered session and generation. File name is never an identity fallback. Loss of a selected/pinned session returns `PINNED_SESSION_LOST`; it never switches to the active session.

The direct leader MCP adapter synthesizes a server-side requestId and uses selector `active`. A follower's MCP adapter synthesizes the same shape with selector `active`, then adds its authenticated session/proof before forwarding. Only authenticated control/CLI may choose `session`, `stable-file`, or `none` explicitly in v0.1. Tool-specific node/page/component IDs remain parsed ToolSpec args; they never become session/file identity.

One `ExecutionPlane` singleton is constructed only while the node owns one leader generation. Direct leader MCP creates a server-side random 128-bit `authSessionId`; followers create `x-sfp-mcp-session: mcp1_<22-char-base64url>` and `x-sfp-mcp-proof: sfp_fp1_<43-char-base64url>`. The proof is HMAC-SHA-256 under the authenticated follower token over the UTF-8 bytes of `sfp-follower-mcp-v1\0<leaderGeneration>\0<mcpSession>`; control principal/context comes only from Task 6 control middleware. A persisted owner-principal key is exactly 32 random bytes created once at `stateRoot/auth/owner-principal-key.v1`, protected by Task 4 `StatePermissions`, read only by the leader, and never logged/exported. Actor IDs are `actor1_` plus base64url HMAC-SHA-256 of, respectively, `sfp-actor-v1\0direct-mcp\0<serverSession>`, `sfp-actor-v1\0follower-mcp\0<followerMcpSession>`, or the constant `sfp-actor-v1\0control\0owner`; the control `authSessionId` is the current credential fingerprint, not part of its stable actor ID. Thus follower reconnection with the same MCP session and control credential rotation keep the intended actor while direct MCP connections remain isolated. The owner key never leaves the leader and is independent of rotating follower/control credentials. `/ping` exposes product/role/version/build only and never an `activeSessionId` or another target-selection oracle.

Followers construct only `FollowerInvocationClient`, which can send strict request/cancel frames and consume response frames; they do not construct ToolInvocationService, an executor, a queue, a journal, an approval gate, or a Relay dispatcher. `unknown` and `conflicted` roles reject before serialization and forward no args. Leader demotion first closes admission, then aborts pending/queued work, marks every dispatched operation whose terminal state is not already durable as `outcome-unknown`, fsyncs operation and egress stores, drains bounded transport writes, destroys the plane, and only then releases leader ownership. No object from an old generation may accept or settle work.

Operation IDs are server-issued base64url tokens containing version, keyId, millisecond `issuedAt`, random 128-bit nonce, and actorHash, followed by HMAC-SHA-256 under a dedicated owner-state secret. That operation-ID signing key is created once per service stateRoot, is not leader-generation/follower/control credential material, and remains available for the stateRoot lifetime. Verification parses the strict envelope, validates keyId/HMAC/actor first, then returns `OPERATION_ID_EXPIRED` for a valid signed issuedAt older than 30 days with runtime zero even after tombstone purge; bad MAC/key/actor or future skew returns `OPERATION_ID_INVALID`. Clients may replay only a previously issued token. Input parses before `argsHash`. The key `(actorId, operationId)` returns the same in-flight Promise only when toolName, argsHash, workspaceId, and fileExecutionKey match; otherwise it rejects with `OPERATION_ID_CONFLICT`. No raw result is persisted. An exact succeeded record whose in-memory bounded result is unavailable throws typed non-retryable `OperationAlreadySettled` and runtime zero, regardless of plugin generation. Terminal rows compact to `OperationTombstone` and remain until signed-token expiry; purge after expiry is safe because the signed token age still rejects that ID. On generation change, queued/pending operations fail `PLUGIN_GENERATION_CHANGED`, dispatched transitions to `outcome-unknown`, succeeded remains settled, and mismatches remain conflicts. Manual resolution is a separate owner-local administrative path: authenticated control plus one-use actionNonce and exact confirmation string `${operationId}/${resultHash ?? 'unknown'}` replace normal tool approval. The service hashes that confirmation, appends and fsyncs `OperationResolutionRecord` into a dedicated 1 MiB resolution-intent reserve, then immediately compacts the active unknown row. The resolution record itself is an authoritative no-replay tombstone until it can merge into the normal tombstone index; it never authorizes replay. A full reserve returns `RESOLUTION_RESERVE_FULL` plus typed manual-export guidance without changing state. Result parses and hashes before post-classification/redaction and `CallToolResult` construction.

The full-reserve payload is exactly `{ code:'RESOLUTION_RESERVE_FULL', manualExportCommand:'sfp operations unresolved --json' }`; it contains no raw operation data.

Every reserved resolution record copies `issuedAt`, `toolName`, `argsHash`, `workspaceId`, `fileExecutionKey`, and `resultHash` from the active unknown row before fsync. That complete fingerprint preserves the normal rule after active-row compaction: an exact same-ID call is settled, while any different tool/args/workspace/file target is `OPERATION_ID_CONFLICT`.

Authenticated `POST /control/action-nonces` accepts strict `{action,requestHash}`, where requestHash matches `^sha256:[0-9a-f]{64}$`, and issues exactly `sfp_an1_` followed by random 256-bit base64url (43 characters), bound to authenticated actor, current leader generation, action, and canonical semantic request hash. TTL is exactly 120,000 ms. The owner-state store permits at most 1,024 rows or 512 KiB per actor; it never evicts an unexpired issued or consumed row to admit another. Semantic request validation occurs first, then `consumeCas` runs atomically immediately before the protected side effect. A mismatch, reuse, concurrent loser, expiry, daemon restart, or generation change fails before the side effect. Consumed rows remain until expiry so replay is distinguishable. Restart and generation recovery invalidate every outstanding row rather than restoring bearer capability.

`hashActionRequest(action,payload)` is owned by `shared/action-nonce.ts`: strict-parse the action-specific payload, omit auth and `actionNonce`, normalize string values to Unicode NFC, sort object keys recursively, preserve array order, encode UTF-8 JSON, and hash `sfp-action-request-v1\0<action>\0<canonical-json>` with SHA-256. Exact payload fields are `{path}` for `workspace.add`, `{workspaceId}` for `workspace.remove`, `{operationId,decision,reasonHash,evidenceHash,confirm}` for `operation.resolve`, `{fqdn}` for `network-domain.add`, and `{fqdnAscii}` for `network-domain.remove`. The server recomputes this hash after semantic validation; the client-supplied hash is never accepted as the side-effect request authority by itself.

The durable egress authority is `stateRoot/journal/{actor-hash}.egress-manifests.v1.jsonl`. `EgressManifestRecordV1` rows are canonical JSON, maximum 64 KiB each, checksum-protected and previous-hash chained. Per actor it compacts at 160,000 rows or 192 MiB, refuses admission at 200,000 rows or 256 MiB, and retains the 30-day operation horizon. Before queue/runtime, the service appends and fsyncs the complete raw-free `PreExecutionConsentManifest` and atomically accounts for one additional row plus 64 KiB within both caps; failure is runtime zero. An unmatched durable pre-record reconstructs that output reservation after restart until recovery settles the operation. After runtime/result classification it appends and fsyncs `OutputEgressManifest` into the reservation before any terminal operation transition, then releases unused reserved bytes. Both manifests contain only IDs, classes, counts, hashes, and redaction metadata—never raw args, source/design text, image/video bytes, results, credentials, URLs, or paths. Recovery may discard only one checksum-valid-prefix final truncated tail; checksum/hash-chain failure in the middle fails startup closed. If runtime may have acted but output append/fsync or terminal persistence fails, recovery records `outcome-unknown`; it never reports a safe retry.

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
~~~

- Control-authenticated `POST /control/pair/challenge` creates a public ten-character base32 `challengeId`, a cryptographically random eight-digit code, five-minute expiry, five attempts, and per-stateRoot rate limit. CLI displays two values and one paste form, for example `Pair ID: ABCDEFGHJK`, `Code: 12345678`, `SFP-ABCDEFGHJK-12345678`. The identifier is public; the code is the short-lived secret. Plugin UI accepts the paste form or two fields and sends both values.
- Plugin UI sends `POST /pair/exchange` with exact `PairExchangeRequest`, `Content-Type: application/json`, and 16 KiB cap. Success consumes the code and returns a random 128-bit one-use ticket valid for 30 seconds.
- WebSocket uses only `/ws`. Ticket/resume credential is sent in the first MessagePack hello, never URL/query/log. Ticket success returns a rotating resume token bound to session and plugin generation.
- A socket flap uses the resume token; plugin restart changes generation and requires re-pair unless a still-valid generation-bound credential exists. Every successful resume rotates the token and rejects the previous value.
- Follower and control tokens are distinct random credentials stored under owner-only stateRoot and rotated on leader generation. `/rpc` and `/abdicate` require follower auth; `/control/*` requires control auth. Each follower MCP connection adds exact `x-sfp-mcp-session: mcp1_<22-char-base64url>` and `x-sfp-mcp-proof: sfp_fp1_<43-char-base64url>` headers using the section 3.3 HMAC input. The leader verifies follower token, current generation, session syntax, and constant-time proof before deriving the follower principal. A direct leader MCP session is instead generated server-side from 128 random bits. `/ping` never exposes an active MCP or Relay session ID.
- PNA contract is literal. A plugin preflight is `OPTIONS /pair/exchange` with loopback Host, allowed Origin (`null`, `https://www.figma.com`, or `https://figma.com`), `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: content-type`, and `Access-Control-Request-Private-Network: true`. Success is 204 with the validated Origin echoed in `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: POST`, `Access-Control-Allow-Headers: content-type`, `Access-Control-Allow-Private-Network: true`, `Access-Control-Max-Age: 0`, and `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network`. No credentials header or wildcard is returned. Wrong path/Host/Origin/method/header/private-network value is 403 with no CORS/PNA allow headers. `POST /pair/exchange` requires the same Host/Origin allowlist. Null Origin is not identity; the one-time code/ticket is the credential. Logs and diagnostic bundles redact code/token fields but may retain the public challengeId.
- Actual pair POST CORS is equally binding. For an allowed Origin, success 200 and every typed 4xx/5xx response (`PAIR_CODE_WRONG`, `PAIR_CODE_EXPIRED`, `PAIR_CODE_USED`, `PAIR_RATE_LIMITED`, invalid JSON/body, internal safe error) echo that validated Origin value in `Access-Control-Allow-Origin`, plus `Access-Control-Allow-Private-Network: true` and `Vary: Origin`; they never use `*` or credentials. This lets the Figma UI read both ticket and actionable error JSON. Hostile Origin or absent Origin receives 403, `Vary: Origin`, no ACAO, no ACAPN, and no challenge/ticket oracle body. OPTIONS and POST tests cover all three allowed Origins plus hostile and absent Origin.

Ingress limits are explicit: pair/abdicate metadata JSON 16 KiB, MessagePack `/rpc` and `/control/tools/call` request 9 MiB, HTTP response 64 MiB, WebSocket frame 64 MiB, decoded image 6 MiB/base64 image 8 MiB, and experimental video result 48 MiB. Streaming counters reject before buffer concatenation; over-limit exports return typed `PAYLOAD_TOO_LARGE`/`EXPORT_TOO_LARGE` without partial output.

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
  captureFull(context: InvocationContext, targetNodeIds: string[], signal: AbortSignal): Promise<SnapshotV1>;
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

`export_tokens`, `export_frames_to_pdf`, and `doctor` are server-only runtime adapters. `import_library_variable` alone adds plugin handler 106 and `teamlibrary` permission. CSS exports the requested mode; omitted mode uses the collection default and warns for other modes. JSON preserves all modes/aliases.

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
  | { version: 1; type: 'accepted'; requestId: string; operationId: string }
  | { version: 1; type: 'progress'; requestId: string; operationId: string; progress: ProgressEvent }
  | { version: 1; type: 'result'; requestId: string; operationId: string; result: unknown }
  | { version: 1; type: 'error'; requestId: string; operationId: string; error: { code: string; message: string; retryable: boolean } };

export interface InvocationFrameSink {
  emit(frame: InvocationFrameV1, signal: AbortSignal): Promise<void>;
  close(reason: 'terminal' | 'disconnect' | 'deadline' | 'demotion'): Promise<void>;
}

export interface ProgressTransportLimits {
  maxPhaseCharacters: 64;
  maxMessageUtf8Bytes: 1024;
  maxProgressFrameBytes: 16384;
  maxSubscriberFrames: 64;
  maxSubscriberBytes: 262144;
  maxProgressFramesPerSecond: 20;
}
~~~

Every request produces exactly one `accepted` frame before queue/runtime, zero or more `progress` frames, and exactly one terminal `result` or `error` frame. All schemas are strict and versioned. `phase` matches `^[a-z][a-z0-9.-]{0,63}$`; `message` is at most 1,024 UTF-8 bytes; the encoded progress frame is at most 16 KiB. One buffered subscriber queue holds at most 64 nonterminal frames and 256 KiB. At most 20 progress frames per operation per second pass downstream; only a nonterminal pending frame for the same operation and phase may be coalesced. `accepted`, `result`, `error`, and cross-phase progress are never dropped. The terminal frame takes an exclusive direct write/drain slot outside the 256 KiB buffered queue, obeys the existing 64 MiB response/frame cap, and blocks later progress. If direct terminal drain misses the absolute deadline, the transport closes while the durable operation remains queryable. Backpressure awaits drain and never grows an unbounded buffer.

Follower `POST /rpc` uses `Content-Type: application/x-sfp-msgpack-stream` in both directions; every request/cancel/response MessagePack frame is preceded by one unsigned four-byte big-endian length. One request body contains exactly one strict `InvocationRequestV1` or `InvocationCancelV1` frame within 9 MiB; an invocation response streams `InvocationFrameV1` frames within the existing 64 MiB response cap, while a successfully authenticated cancel submission returns 202 and the original invocation stream later emits its one terminal error. Control `POST /control/tools/call` returns `Content-Type: application/x-ndjson; charset=utf-8`—one strict frame per line—and authenticated `POST /control/tools/cancel` accepts exact `InvocationCancelV1`, returns 202, and leaves terminal delivery on the original stream. Direct MCP maps progress/cancel to the standard request progress token/cancellation notification and maps only the terminal frame to its response. Plugin RPC uses `$progress` and `$cancel` carrying the same request/operation identity; adapters may change framing, never semantics. A transport disconnect does not implicitly cancel, retry, or issue a new operation ID.

Progress extends only the idle deadline; it never extends the absolute deadline. The absolute deadline, explicit `InvocationCancelV1`, plane demotion, and the runtime `AbortSignal` are authoritative. Cancellation is idempotent, targets the exact request plus operation, and cannot cancel another principal's work. Snapshot, ordered PDF, and video export emit through the same reporter; Relay forwards plugin progress without bypassing bounds. Pre-execution and output egress manifests from section 3.3 contain only classes/counts/hash.

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
  packages/mcp/test/execution/egress-manifest-store.test.ts
  packages/mcp/test/execution/execution-plane-lifecycle.test.ts
  packages/mcp/test/execution/follower-stream.test.ts
  packages/mcp/test/execution/invocation-boundary.test.ts
  packages/mcp/test/execution/no-direct-relay.test.ts
  packages/mcp/test/execution/progress-framing.test.ts
  packages/mcp/test/execution/target-resolution.test.ts
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
                    ├→ T11 section snapshot + graph ─┐
                    └→ T12 atomic safe union (116/106/10) ─┤
                                                           └→ T13 CLI
                        → T14 skills/docs/build-vs-buy
                          → T15 hygiene/CI/release/SBOM/artifacts
                            → T16 automated acceptance harness
                              ├→ T17 Windows live evidence
                              └→ T18 macOS live evidence
~~~

T11 and T12 may run in parallel only after T10; T13 consumes both. Every other edge is binding because the downstream Task names exact interfaces from the upstream Task.

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
- Produces: `UnionManifestV1`; `RawToolSpec`→`ToolSpec<I,O>` finalization; `RESULT_SCHEMAS` exact 112 and `TOOL_RUNTIMES: Record<string,RuntimeBinding>` exact 112 baseline maps; derived/exported `SERVER_ONLY_TOOLS`; invalid plugin result error `PLUGIN_RESULT_INVALID`.

- [ ] **Step 1: Write contract coverage RED**

~~~ts
it('has one result schema and runtime for every baseline tool', () => {
  const names = ALL_TOOL_SPECS.map(x => x.name).toSorted();
  expect(Object.keys(RESULT_SCHEMAS).toSorted()).toEqual(names);
  expect(Object.keys(TOOL_RUNTIMES).toSorted()).toEqual(names);
  expect(Object.values(TOOL_RUNTIMES).filter(x => x.authority === 'server')).toHaveLength(7);
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

Keep vendored declarations as `RawToolSpec`; registry finalization joins each raw spec to `RESULT_SCHEMAS[name]`, runtime binding ID `runtime:${name}`, and policy ID `tool:${name}:v1`. Task 5 fills policies under those exact IDs. Derive `SERVER_ONLY_TOOLS` from `RuntimeBinding.authority === 'server'` rather than a hand-maintained exception mirror. Missing or duplicate entries throw during module initialization. Result schemas reuse strict shared schemas and add explicit Zod objects for uncovered server-local results; `z.unknown()` is not accepted by coverage tests.

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
- Produces: `OPERATION_POLICIES` exact 112 baseline map; `RESULT_EGRESS_POLICIES: Record<string,ResultEgressPolicy>` exact 112 map; `effectsFor`, `approvalFor`, `classifyInput`, `classifyResult`, conservative MCP annotation builder; persisted explicit egress/consent config.

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
- Produces: contracts in section 3.5; authenticated control middleware but **not** `/control/tools/call`; follower/control token rotation; strict `/ping`, `/pair/exchange`, `/ws`.

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
~~~

- [ ] **Step 2: Run auth RED**

Run: `pnpm -C service exec vitest run packages/mcp/test/security`.

Expected: current null-Origin socket is accepted, RPC lacks bearer auth, paths/body are unbounded, and pairing modules are missing.

- [ ] **Step 3: Implement challenge/exchange/resume**

Create exact endpoints and schemas from section 3.5. Treat challengeId as a public identifier, return `PairChallengeIssued` to the control caller, hash only the eight-digit code with daemon-keyed HMAC, and compare constant-time. Enforce expiry, five attempts, challenge creation/exchange rate limits, one-use ticket, first-message credential, resume rotation, plugin-generation binding, and secret redaction.

- [ ] **Step 4: Implement local request gates and PNA**

Keep loopback Host validation. Implement the literal OPTIONS and actual POST success/error CORS/PNA/Vary contracts and allowed/hostile/absent-Origin matrix from section 3.5, require JSON content type/body cap on exchange, require `/ws` path, and configure WS maxPayload. A single response helper applies allowed-Origin headers before every safe typed POST success/error/500 write; rejected Origin uses a separate no-oracle helper. `/control/pair/challenge` is control-authenticated Node traffic and never receives CORS/PNA headers. `/ping` returns product magic/protocol/build identity; foreign 2xx is not a leader.

- [ ] **Step 5: Implement follower/control credentials**

Generate distinct credentials per leader generation under stateRoot. Require follower token on `/rpc`/`/abdicate`, control token on `/control/*`, rotate on handoff, reject old tokens, and make Unknown role fail before sending args. Do not add `/control/tools/call` in this Task.

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

- Create/modify shared wire authority: `service/packages/shared/src/invocation.ts`, `action-nonce.ts`, `progress.ts`, `rpc.ts`, `envelope.ts`, `protocol.ts`, `operations.ts`, `index.ts`.
- Create operation/identity/target core: `service/packages/mcp/src/execution/execution-plane.ts`, `target-resolver.ts`, `file-queue.ts`, `operation-id.ts`, `operation-journal.ts`, `operation-resolution-intent.ts`, `operation-executor.ts`; create `service/packages/mcp/src/security/principal-derivation.ts` and `service/packages/mcp/src/tool-invocation-service.ts`.
- Create approval/control/action-nonce authority: `service/packages/mcp/src/policy/approval-gate.ts`; `service/packages/mcp/src/control/action-nonce-store.ts`, `action-nonce-endpoints.ts`, `approval-endpoints.ts`, `tool-call-endpoint.ts`, `workspace-endpoints.ts`, `operation-endpoints.ts`.
- Create durable egress/progress authority: `service/packages/mcp/src/policy/egress-policy.ts`, `service/packages/mcp/src/execution/egress-manifest-store.ts`.
- Modify all production entries that must converge on the plane: `service/packages/mcp/src/index.ts`, `dispatch.ts`, `tools/runtime-registry.ts`, `relay/relay.ts`, `relay/session.ts`, `election/follower.ts`, `election/leader-endpoints.ts`, `election/node.ts`.
- Create/modify tests: `service/packages/mcp/test/execution/{operation-id,file-queue,operation-journal,operation-executor,execution-plane-lifecycle,invocation-boundary,target-resolution,no-direct-relay,action-nonce,operation-resolution,egress-policy,egress-manifest-store,progress-transport,progress-framing,follower-stream,control-tool-call,workspace-endpoints}.test.ts`; modify matching `dispatch`, election, relay, security, and E2E process/wire suites.
- Modify closed-world authorities in every slice: `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. Task 7 uses the existing Task 2 authority schema/verifier and does not weaken or redesign it.

**Interfaces**

- Consumes: Task 3 ToolSpec/result/runtime authority, Task 4 state/workspace contexts, Task 5 dynamic policies/egress config, Task 6 authenticated control middleware, leader generation, follower credential, and authenticated Relay session identity.
- Produces: leader-generation singleton `ExecutionPlane`; follower-only `FollowerInvocationClient`; strict `InvocationRequestV1`/`InvocationCancelV1`/`InvocationFrameV1`; owner-key principal derivation; immutable `RuntimeExecutionScope`; `ToolInvocationService`; `OperationIdIssuer`; `OperationRecord/Tombstone/ResolutionRecord`; 1 MiB `ResolutionIntentStore`; durable `EgressManifestStore`; `(actorId,operationId)` idempotency; `FileExecutionKey` queue; `ApprovalGate`; `ActionNonceStore`; `ProgressReporter` and bounded transport adapters; `JournalWorkspaceUsageGuard`; authenticated `/control/action-nonces`, `/control/tools/call`, `/control/tools/cancel`, `/control/approvals/*`, `/control/workspaces*`, and `/control/operations*`.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 7A — operation, principal, and immutable target core | owner-principal key/derivation, strict request selector boundary, leader-only plane lifecycle, target resolver, issuer, queue, journal/tombstones/generation/caps, follower-only client | invocation-boundary/target/ownership/demotion plus operation-id, queue, journal, restart/cap suites | `feat(execution): add issued idempotent journaled file queue`; exports `RuntimeExecutionScope`, operation/journal/usage interfaces to 7B |
| 7B — approval, authenticated control, and action nonce | approval gate, nonce issue/CAS/caps, tool/approval/workspace/operation endpoints, resolution audit | control auth, rejected body context, nonce format/binding/TTL/restart/generation/CAS, resolve/workspace-unblock suites | `feat(control): add approved workspace and operation control`; exports authenticated routes and nonce router to Tasks 8/13 |
| 7C — durable egress, progress/framing, and production integration | pre/output manifest store, runtime-zero enforcement, shared frames, follower length framing, control NDJSON, MCP/plugin progress/cancel, every production entry and demotion drain | egress durability/recovery/caps, progress bounds/backpressure/cancel, cross-entry parity, no-direct-relay structural suites | `feat(egress): gate runtime and stream bounded progress`; Task 8 consumes only after all reviewed 7A–7C tree/commit hashes are frozen |

Each subtask receives RED→GREEN, closed-world authority regeneration, and two independent reviews of one exact staged tree before its exact commit. Reviewers inspect `git diff --cached` plus the recorded `git write-tree` hash and do not edit. After either finding, the implementer fixes, restages, recomputes the tree, and repeats both reviews. Immediately before commit, rerun the slice GREEN, prove no unstaged tracked change, prove `git write-tree` still equals the reviewed hash, and after commit prove `HEAD^{tree}` equals it. The three already-reviewed subjects above remain binding; the amendment strengthens their contents and does not silently rename or add a fourth aggregate commit. Task 7 final review checks cross-slice execution order and authority closure without reopening an accepted tree absent a concrete finding.

For every slice, `git status --short -- service` must show only first-column staged entries from that slice's exact allowlist: no unstaged or untracked service path. `git diff --cached --name-only` must equal the allowlist subset actually changed by the slice, and the offline closed-world verifier must account for every managed path. Test output and ignored build artifacts are never staged.

7A defines the plane with injected `ApprovalDecisionPort` and `EgressManifestPort` contracts and tests ownership/lifecycle with explicit fakes; it does not claim final production entry convergence while 7B/7C implementations are absent. 7B binds the real approval/control/action-nonce port. 7C binds durable egress and `InvocationFrameSink` adapters and atomically switches every direct MCP/follower/control production entry to the plane; only 7C's structural gate requires zero legacy Relay/runtime bypass. Intermediate slice commits are review checkpoints, not releasable product states.

Closed-world regeneration order is binding in every slice: add every new service-owned managed path to `vendor-rules.json.exclude` and `upstream-lock.json.destinationClosure.serviceOwnedFiles`; update hashes for already-owned modified paths; run `node service/scripts/vendor-upstreams.mjs --copy-only`; then update the resulting `vendorMap.sha256`/counts and final current SHA-256 values in `upstream-lock.json`; finally run the offline verifier and exact vendor test command. Do not weaken managed roots, delete another service-owned row, or reclassify Task 1–6 service authority as upstream copy to make verification pass.

**Exact staged path allowlists**

- 7A: `service/packages/shared/src/invocation.ts`, `service/packages/shared/src/operations.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/security/principal-derivation.ts`, `service/packages/mcp/src/execution/execution-plane.ts`, `service/packages/mcp/src/execution/target-resolver.ts`, `service/packages/mcp/src/execution/file-queue.ts`, `service/packages/mcp/src/execution/operation-id.ts`, `service/packages/mcp/src/execution/operation-journal.ts`, `service/packages/mcp/src/execution/operation-resolution-intent.ts`, `service/packages/mcp/src/execution/operation-executor.ts`, `service/packages/mcp/src/tool-invocation-service.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/src/election/follower.ts`, `service/packages/mcp/src/election/node.ts`, `service/packages/mcp/src/relay/session.ts`, `service/packages/mcp/src/tools/ping.ts`, `service/packages/mcp/test/execution/invocation-boundary.test.ts`, `service/packages/mcp/test/execution/target-resolution.test.ts`, `service/packages/mcp/test/execution/execution-plane-lifecycle.test.ts`, `service/packages/mcp/test/execution/operation-id.test.ts`, `service/packages/mcp/test/execution/file-queue.test.ts`, `service/packages/mcp/test/execution/operation-journal.test.ts`, `service/packages/mcp/test/execution/operation-executor.test.ts`, `service/packages/mcp/test/election/follower.test.ts`, `service/packages/mcp/test/election/node.test.ts`, `service/packages/mcp/test/relay/session.test.ts`, `service/packages/mcp/test/tools/ping.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7A.
- 7B: `service/packages/shared/src/action-nonce.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/policy/approval-gate.ts`, `service/packages/mcp/src/control/action-nonce-store.ts`, `service/packages/mcp/src/control/action-nonce-endpoints.ts`, `service/packages/mcp/src/control/approval-endpoints.ts`, `service/packages/mcp/src/control/tool-call-endpoint.ts`, `service/packages/mcp/src/control/workspace-endpoints.ts`, `service/packages/mcp/src/control/operation-endpoints.ts`, `service/packages/mcp/src/election/leader-endpoints.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/test/execution/action-nonce.test.ts`, `service/packages/mcp/test/execution/control-tool-call.test.ts`, `service/packages/mcp/test/execution/operation-resolution.test.ts`, `service/packages/mcp/test/execution/workspace-endpoints.test.ts`, `service/packages/mcp/test/election/leader-endpoints.test.ts`, `service/packages/mcp/test/security/control-auth.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7B.
- 7C: `service/packages/shared/src/progress.ts`, `service/packages/shared/src/rpc.ts`, `service/packages/shared/src/envelope.ts`, `service/packages/shared/src/protocol.ts`, `service/packages/shared/src/operations.ts`, `service/packages/shared/src/index.ts`, `service/packages/mcp/src/policy/egress-policy.ts`, `service/packages/mcp/src/execution/egress-manifest-store.ts`, `service/packages/mcp/src/execution/execution-plane.ts`, `service/packages/mcp/src/tool-invocation-service.ts`, `service/packages/mcp/src/tools/runtime-registry.ts`, `service/packages/mcp/src/relay/relay.ts`, `service/packages/mcp/src/relay/session.ts`, `service/packages/mcp/src/dispatch.ts`, `service/packages/mcp/src/index.ts`, `service/packages/mcp/src/election/follower.ts`, `service/packages/mcp/src/election/leader-endpoints.ts`, `service/packages/mcp/src/election/node.ts`, `service/packages/mcp/test/execution/egress-policy.test.ts`, `service/packages/mcp/test/execution/egress-manifest-store.test.ts`, `service/packages/mcp/test/execution/progress-transport.test.ts`, `service/packages/mcp/test/execution/progress-framing.test.ts`, `service/packages/mcp/test/execution/follower-stream.test.ts`, `service/packages/mcp/test/execution/no-direct-relay.test.ts`, `service/packages/mcp/test/execution/execution-plane-lifecycle.test.ts`, `service/packages/mcp/test/dispatch.test.ts`, `service/packages/mcp/test/election/election.test.ts`, `service/packages/mcp/test/election/follower.test.ts`, `service/packages/mcp/test/election/leader-endpoints.test.ts`, `service/packages/mcp/test/election/leader-lock.test.ts`, `service/packages/mcp/test/election/node.test.ts`, `service/packages/mcp/test/relay/relay.test.ts`, `service/packages/mcp/test/relay/session.test.ts`, `service/packages/mcp/test/e2e/mcp-wire.test.ts`, `service/packages/mcp/test/e2e/process-lifecycle.test.ts`, `service/vendor-rules.json`, `service/vendor-map.json`, `service/upstream-lock.json`. No other path may be staged in 7C.

**Binding subtask execution**

- [ ] **7A RED:** Add strict tests first, then run `pnpm -C service exec vitest run packages/mcp/test/execution/invocation-boundary.test.ts packages/mcp/test/execution/target-resolution.test.ts packages/mcp/test/execution/execution-plane-lifecycle.test.ts packages/mcp/test/execution/operation-id.test.ts packages/mcp/test/execution/file-queue.test.ts packages/mcp/test/execution/operation-journal.test.ts packages/mcp/test/execution/operation-executor.test.ts`; expect absent strict request/principal/target/leader-plane modules plus absent issuer/queue/journal/executor. Task 6 auth stays green.
- [ ] **7A GREEN:** Implement only operation/principal/target core, follower client, and leader lifecycle with injected fake later-slice ports. Run the exact 7A RED command, `pnpm -C service exec vitest run packages/mcp/test/election packages/mcp/test/relay`, and `pnpm -C service typecheck`; expect the role-factory harness to own one plane per generation, no plane in follower/unknown/conflicted roles, no args forwarded from unknown/conflicted, server-derived principals/immutable target, demotion recovery, signed-ID exact replay/conflict, queue, generation, tombstone, 31 MiB+1 MiB reserve, and cap tests green. Final entry cutover is deliberately 7C.
- [ ] **7A authority, staged review, and exact commit:** Register every added/changed managed file in `vendor-rules.json` exclusion authority and sorted `upstream-lock.json.destinationClosure.serviceOwnedFiles`, run `node service/scripts/vendor-upstreams.mjs --copy-only` to regenerate `vendor-map.json`, and run `node service/scripts/verify-upstream-lock.mjs --offline` plus `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`. Stage only the exact 7A shared invocation/operations/index, execution/security/principal/target/follower/lifecycle files and tests, and the three authority files; reject any staged path outside that reviewed allowlist with `git diff --cached --name-only`. Run `git diff --cached --check`; run `git write-tree` and record its stdout as `TREE_7A`; obtain independent spec and quality PASS decisions naming `TREE_7A`; rerun the exact 7A GREEN and authority commands; require `git diff --name-only` empty and a second `git write-tree` equal to `TREE_7A`; then run `git commit -m "feat(execution): add issued idempotent journaled file queue"`. Require `git rev-parse "HEAD^{tree}"` equals `TREE_7A` and record tree+commit hashes.
- [ ] **7B RED:** Add tests first, then run `pnpm -C service exec vitest run packages/mcp/test/execution/action-nonce.test.ts packages/mcp/test/execution/control-tool-call.test.ts packages/mcp/test/execution/operation-resolution.test.ts packages/mcp/test/execution/workspace-endpoints.test.ts`; expect missing strict authenticated control/resolution/nonce routes while all 7A gates stay green.
- [ ] **7B GREEN:** Implement approval/tool/workspace/operation/action-nonce endpoints and run the exact 7B RED command plus all 7A execution tests and `pnpm -C service typecheck`; expect `sfp_an1_`+256-bit format, actor/generation/action/requestHash binding, 120,000 ms TTL, 1,024-row/512 KiB caps, no live eviction, semantic-validation-before-CAS, one concurrent winner, consumed retention, restart/generation invalidation, rejected body identity/context, exact confirm strings, resolution reserve, and workspace unblock green.
- [ ] **7B authority, staged review, and exact commit:** Update the same closed-world authorities, run `node service/scripts/vendor-upstreams.mjs --copy-only`, then run `node service/scripts/verify-upstream-lock.mjs --offline` plus `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`. Stage only the exact 7B allowlist above; check `git diff --cached --name-only` and `git diff --cached --check`; run `git write-tree` and record stdout as `TREE_7B`; obtain independent spec+quality PASS on that tree; rerun the exact 7B GREEN and authority commands; require `git diff --name-only` empty and a second `git write-tree` equal to `TREE_7B`; then run `git commit -m "feat(control): add approved workspace and operation control"`. Require `git rev-parse "HEAD^{tree}"` equals `TREE_7B` and record tree+commit hashes.
- [ ] **7C RED:** Add tests first, then run `pnpm -C service exec vitest run packages/mcp/test/execution/egress-policy.test.ts packages/mcp/test/execution/egress-manifest-store.test.ts packages/mcp/test/execution/progress-transport.test.ts packages/mcp/test/execution/progress-framing.test.ts packages/mcp/test/execution/follower-stream.test.ts packages/mcp/test/execution/no-direct-relay.test.ts`; expect missing durable pre/output egress and shared framing/backpressure/progress/cancel production integration while 7A/7B stay green.
- [ ] **7C GREEN:** Implement manifest durability, strict frames, all transport adapters, and production entry convergence. Run `pnpm -C service exec vitest run packages/mcp/test/execution packages/mcp/test/policy packages/mcp/test/election packages/mcp/test/relay packages/mcp/test/dispatch.test.ts packages/mcp/test/security/control-auth.test.ts packages/mcp/test/e2e/mcp-wire.test.ts packages/mcp/test/e2e/process-lifecycle.test.ts`, then `pnpm -C service typecheck`; expect runtime-zero preflight, pre/output fsync/recovery/caps, 4-byte follower framing, control NDJSON, MCP/plugin progress/cancel, bounded drain/coalescing/terminal delivery, demotion cleanup, and full cross-entry parity.
- [ ] **7C authority, staged review, and exact commit:** Update closed-world authorities, run `node service/scripts/vendor-upstreams.mjs --copy-only`, then run `node service/scripts/verify-upstream-lock.mjs --offline` plus `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`. Stage only the exact 7C allowlist above; check `git diff --cached --name-only` and `git diff --cached --check`; run `git write-tree` and record stdout as `TREE_7C`; obtain independent spec+quality PASS on that tree; rerun the exact 7C GREEN and authority commands; require `git diff --name-only` empty and a second `git write-tree` equal to `TREE_7C`; then run `git commit -m "feat(egress): gate runtime and stream bounded progress"`. Require `git rev-parse "HEAD^{tree}"` equals `TREE_7C` and record tree+commit hashes.

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

it('constructs one execution plane only for the current leader generation', async () => {
  expect(nodeFor('leader').executionPlane?.leaderGeneration).toBe('generation-2');
  expect(nodeFor('follower').executionPlane).toBeUndefined();
  expect(nodeFor('unknown').forwardedPayloads).toEqual([]);
  expect(nodeFor('conflicted').forwardedPayloads).toEqual([]);
});

it('derives stable domain-separated principals without trusting body identity', async () => {
  expect(deriveControlActor(ownerKey, controlTokenG1)).toBe(deriveControlActor(ownerKey, controlTokenG2));
  expect(deriveFollowerActor(ownerKey, 'mcp1_session-a', 'generation-1'))
    .toBe(deriveFollowerActor(ownerKey, 'mcp1_session-a', 'generation-2'));
  expect(deriveDirectActor(ownerKey, directSessionA)).not.toBe(deriveDirectActor(ownerKey, directSessionB));
  expect(deriveControlActor(ownerKey, controlTokenG1)).not.toBe(deriveFollowerActor(ownerKey, 'mcp1_session-a', 'generation-1'));
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
  const running = plane.invoke(principal, request({ targetSelector: { kind: 'stable-file', fileIdentityHash } }));
  relay.disconnect('relay-a');
  await expect(terminal(running)).resolves.toMatchObject({ type: 'error', error: { code: 'PINNED_SESSION_LOST' } });
  expect(relay.dispatchesFor('relay-b')).toHaveLength(0);
});

it('demotes in close-admission, recover, fsync, drain, destroy order', async () => {
  journal.seed([record('pending-approval', pendingId), record('queued', queuedId), record('dispatched', dispatchedId)]);
  await plane.demote('lease-lost');
  expect(lifecycleEvents).toEqual([
    'admission-closed', 'pending-aborted', 'queued-aborted', 'dispatched-outcome-unknown',
    'operation-journal-fsynced', 'egress-store-fsynced', 'transport-drained', 'plane-destroyed',
  ]);
  await expect(terminal(plane.invoke(principal, nextRequest)))
    .resolves.toMatchObject({ type: 'error', error: { code: 'LEADER_GENERATION_CLOSED' } });
});

it('rejects the same actor operation ID with different args', async () => {
  const opId = issuer.issue(ctx.actor.actorId, fixedNow);
  const first = service.invoke(ctx, 'create_text', { text: 'A' }, opId);
  await expect(service.invoke(ctx, 'create_text', { text: 'B' }, opId))
    .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  await first;
});

it('serializes two sessions that resolve to the same file identity', async () => {
  const a = plane.invoke(principalA, requestForSession('relay-a'));
  const b = plane.invoke(principalB, requestForSession('relay-b'));
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
  await expect(restarted.invoke(ctxWithGeneration('g2'), 'create_text', args, opId))
    .rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED', resultHash: 'sha256:r' });
  await expect(restarted.invoke(ctxWithGeneration('g2'), 'create_text', { text: 'different' }, opId))
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
  await expect(service.invoke(ctx, 'get_selection', {}, newOpId))
    .rejects.toMatchObject({ code: 'JOURNAL_CAPACITY_EXCEEDED' });
  expect(service.status('a', existingUnknownId)).toBeDefined();
});

it('fails new operations when the in-horizon tombstone index is full', async () => {
  journal.seedTombstones(1000000, { bytes: 268435456, unexpired: true });
  await expect(service.invoke(ctx, 'get_selection', {}, issuer.issue('a')))
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
  await expect(service.invoke(ctx, 'create_text', args, issued))
    .rejects.toMatchObject({ code: 'OPERATION_ID_EXPIRED' });
  await expect(service.invoke(ctx, 'create_text', args, tamper(issued)))
    .rejects.toMatchObject({ code: 'OPERATION_ID_INVALID' });
  expect(runtime).not.toHaveBeenCalled();
});

it('resolves unknown work without permitting same-ID replay', async () => {
  const unknownId = issuer.issue('a', now);
  journal.seed(record('outcome-unknown', unknownId, {
    toolName: 'create_text', argsHash: hash(args), workspaceId: ctx.workspace.workspaceId,
    fileExecutionKey: ctx.target.fileExecutionKey,
  }));
  await control.post(`/control/operations/${encodeURIComponent(unknownId)}/resolve`, {
    decision: 'resolved-applied', reasonHash, evidenceHash,
    confirm: `${unknownId}/unknown`, actionNonce,
  }, actorToken);
  expect(await control.get(`/control/operations/${encodeURIComponent(unknownId)}`, actorToken))
    .toMatchObject({
      status: 'resolved-applied', toolName: 'create_text', argsHash: hash(args),
      workspaceId: ctx.workspace.workspaceId, fileExecutionKey: ctx.target.fileExecutionKey,
    });
  await expect(service.invoke(ctx, 'create_text', args, unknownId))
    .rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED' });
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
  await expect(service.invoke(ctx, 'get_selection', {}, issuer.issue(ctx.actor.actorId))).resolves.toBeDefined();
});

it('keeps resolution authoritative when the normal tombstone index is full', async () => {
  const unknownId = issuer.issue(ctx.actor.actorId, fixedNow);
  journal.seedTombstones(1000000, { bytes: 268435456, unexpired: true });
  journal.seed(record('outcome-unknown', unknownId, {
    toolName: 'create_text', argsHash: hash(args), workspaceId: ctx.workspace.workspaceId,
    fileExecutionKey: ctx.target.fileExecutionKey,
  }));
  await control.post(`/control/operations/${encodeURIComponent(unknownId)}/resolve`, {
    decision: 'resolved-not-applied', reasonHash, evidenceHash,
    confirm: `${unknownId}/unknown`, actionNonce,
  }, actorToken);
  expect(journal.resolutionIntents.get(unknownId)?.status).toBe('resolved-not-applied');
  await expect(service.invoke(ctx, 'create_text', args, unknownId))
    .rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED' });
  await expect(service.invoke(ctx, 'create_text', { ...args, text: 'different' }, unknownId))
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

it('fsyncs preflight and reserves output capacity before runtime, then fsyncs output before terminal', async () => {
  await collect(plane.invoke(principal, requestFor('get_screenshot')));
  expect(events).toEqual([
    'pre-manifest-append', 'pre-manifest-fsync', 'output-row-reserved',
    'runtime-dispatch', 'output-manifest-append', 'output-manifest-fsync', 'terminal-operation-fsync',
  ]);
  expect(readDurableManifest(operationId)).not.toHaveProperty('rawArgs');
  expect(readDurableManifest(operationId)).not.toHaveProperty('result');
});

it('fails pre-runtime at manifest capacity and marks a post-runtime durability loss unknown', async () => {
  egressStore.seed({ rows: 200000, bytes: 268435456 });
  await expect(terminal(plane.invoke(principal, requestFor('create_text'))))
    .resolves.toMatchObject({ type: 'error', error: { code: 'EGRESS_MANIFEST_CAPACITY_EXCEEDED' } });
  expect(runtime).not.toHaveBeenCalled();
  egressStore.resetBelowCap().failOutputFsync();
  await plane.invoke(principal, requestFor('create_text'));
  expect(statusOf(operationId)).toEqual(['outcome-unknown', 'EGRESS_MANIFEST_DURABILITY_FAILED']);
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
  const running = plane.invoke(principal, requestFor('export_video'));
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

Construct `ExecutionPlane` only from the elected leader-generation factory. It owns principal derivation, strict `InvocationRequestV1` parse, selector lookup, immutable `RuntimeExecutionScope`, queue/executor/journal/approval/egress dependencies, and terminal cleanup. Follower nodes construct only `FollowerInvocationClient`; unknown/conflicted nodes reject before serializing `rawArgs`. Persist one owner-principal 256-bit key under secure stateRoot. Direct MCP session IDs are server-generated 128-bit values; follower session header/proof and control middleware derive the three domain-separated actor forms in section 3.3. Remove `activeSessionId` from `/ping`. Resolve the target from the authenticated Relay registry, never from body context or file name; freeze the target/key and return `PINNED_SESSION_LOST` if it disappears.

Issue and verify operation IDs exactly as section 3.3 before idempotency lookup. A first call without an ID receives a newly issued ID in the `accepted` frame before dispatch and in terminal metadata; authenticated control/CLI calls `POST /control/operations/issue` before every mutation. Share one in-flight Promise for exact matches. The same-generation in-memory completed-result cache is limited to 128 entries, 8 MiB total, and 60 seconds; LRU/TTL eviction or daemon restart leaves only the durable tombstone and therefore returns `OPERATION_ALREADY_SETTLED`. A persisted succeeded exact key has runtime zero and never re-executes on a new generation. Mismatches always conflict. On generation change/demotion, close admission, abort pending/queued, change non-durable dispatched work to unknown, preserve succeeded, fsync/drain/destroy, and prevent old-generation settlement. Allow four reads only when no same-file write is active, make writes exclusive, and run `exclusive-heavy` alone. Before-dispatch socket flap may resume the same queued record; post-dispatch flap immediately appends `outcome-unknown` and never auto-replays. A structural test rejects supplied literal operation IDs outside dedicated forged/invalid fixtures and rejects any production Relay/runtime call not dominated by `ExecutionPlane`; conflict, settled, generation, and cap fixtures must call `OperationIdIssuer.issue(actorId, issuedAt)`.

- [ ] **Step 4: Implement owner-state operation journal and recovery**

Append transitions under `stateRoot/journal/{actor-hash}.operations.v1.jsonl`, fsync each append, checksum compacted snapshots, retain unsettled/unknown records, mark recovered dispatched records unknown, and tolerate one truncated tail after crash. Apply `JournalLimits`: compact active transitions at 8,000 rows or 24 MiB; stop normal operation appends at 10,000 rows or 31 MiB of the 32 MiB active-state allocation; reserve the final exact 1 MiB exclusively for `resolution-intents.v1.jsonl`; keep the separate normal tombstone index through the signed horizon with a 1,000,000-entry/256 MiB cap. If unresolved transitions prevent active compaction, allow status/doctor/operation list-status-resolve only. Resolve appends and fsyncs one confirmation record to the reserve before changing state, immediately compacts the matching unknown row, and treats the resolution record itself as the no-replay tombstone when the normal tombstone index is full. Reserve records merge into the normal tombstone index only when capacity exists and purge after signed expiry. A full reserve fails `RESOLUTION_RESERVE_FULL` with a sanitized manual-export path and leaves the unknown record unchanged. Every other operation at normal cap fails `JOURNAL_CAPACITY_EXCEEDED`. Persist no raw result. Export `JournalWorkspaceUsageGuard.hasUnsettled(workspaceId)` for Task 4 store wiring.

The manual-export guidance in that error is the literal command `sfp operations unresolved --json`; operators choose the output destination in their shell, so the daemon never writes an emergency export outside configured policy.

Before fsync, resolution-intent construction copies the active record’s signed issuedAt and complete tool/args/workspace/file/result fingerprint. Compaction may remove the active row only after that durable fingerprint exists, so reserved resolutions preserve settled-versus-conflict behavior without the normal tombstone index.

- [ ] **Step 5: Implement approvals and central control call**

`/control/tools/call` accepts only strict `InvocationRequestV1`, returns the Task 7 NDJSON stream, and `/control/tools/cancel` accepts only `InvocationCancelV1` with the same authenticated principal. Control middleware supplies the principal and configured consent; workspaceId/selector are lookup inputs, while the immutable target/key/context come from leader stores and authenticated Relay state. MCP and follower use the identical plane rather than a separate `ToolInvocationService` entry. Approval endpoints list pending summaries and settle exact approvalId once.

Mount authenticated `POST /control/action-nonces` with strict `{action,requestHash}` and section 3.3 format/TTL/caps. Every nonce-protected route performs auth and full semantic validation, canonicalizes the action-specific request hash, then atomically consumes the bound nonce immediately before its side effect. Mount `GET /control/workspaces`, `POST /control/workspaces` with `{path,actionNonce}`, and `DELETE /control/workspaces/:workspaceId` with `x-sfp-action-nonce`; actor comes only from control auth, add realpaths the directory, and remove uses JournalWorkspaceUsageGuard. Mount `POST /control/operations/issue`, `GET /control/operations?status=outcome-unknown`, `GET /control/operations/:id`, and single-ID `POST /control/operations/:id/resolve`. Resolution is deliberately outside the normal OperationRecord/approval pipeline so it remains available at cap: it requires owner-local control auth, matching actor, bound one-use actionNonce, decision/reasonHash/evidenceHash, and exact `confirm: "<operationId>/<resultHash-or-unknown>"`. It appends `OperationResolutionRecord` through the reserve and never changes replay eligibility. There is no bulk resolution endpoint in v0.1. Tests prove unauthenticated/body-supplied identity/context, wrong actor/generation/action/request hash, reused/concurrent/expired/restarted nonce, invalid confirmation, missing evidence, reserve-full behavior, and same-ID resolution replay fail. With no paired UI or authenticated CLI waiter, ordinary explicit approval returns `APPROVAL_CHANNEL_UNAVAILABLE`.

- [ ] **Step 6: Implement result validation, egress ordering, and progress transport**

Execute in this order: strict request/input parse and argsHash → server principal/workspace/target resolution and immutable `RuntimeExecutionScope` → `effectsFor`/policy → approval → `classifyInput` plus `possibleResultClasses` → construct canonical raw-free `PreExecutionConsentManifest` → verify mode/consent/classes/budget → append+fsync pre-manifest and reserve one output row → queue/journal/dispatch runtime → strict result parse → `classifyResult` → assert actual classes are a subset of preflight possible classes → resultHash → redaction/output budget → append+fsync `OutputEgressManifest` → fsync terminal operation → terminal `InvocationFrameV1`. Unknown mode, disallowed class, 64 KiB row overflow, or inability to reserve within 200,000 rows/256 MiB fails before queue/runtime with call count zero. Compact at 160,000 rows/192 MiB, retain 30 days, and verify canonical row checksum plus previous-hash chain. Recover only one final truncated tail; fail closed on any middle corruption. A post-runtime class breach or output/terminal durability failure records the operation's real mutation status as `outcome-unknown` and cannot be represented as a safe retry.

Use the exact section 3.11 frames and limits for every adapter. Follower `/rpc` is four-byte big-endian length-prefixed strict MessagePack with `application/x-sfp-msgpack-stream`; control tool call is NDJSON; direct MCP uses its standard progress token; plugin dispatch accepts/produces `$progress` and `$cancel`. Enforce phase/message/frame/rate/subscriber bounds, coalesce only a pending nonterminal same-operation/same-phase event, never drop accepted/terminal frames, and await backpressure drain within absolute deadline. Explicit request+operation cancel, demotion, and absolute deadline abort runtime; idle progress extends only idle. Disconnect is never implicit retry or cancel.

- [ ] **Step 7: Run execution GREEN and cross-entry parity**

Run: `pnpm -C service exec vitest run packages/mcp/test/execution packages/mcp/test/policy packages/mcp/test/election packages/mcp/test/relay packages/mcp/test/dispatch.test.ts packages/mcp/test/security/control-auth.test.ts packages/mcp/test/e2e/mcp-wire.test.ts packages/mcp/test/e2e/process-lifecycle.test.ts`, then `node service/scripts/verify-upstream-lock.mjs --offline`, `pnpm -C service exec vitest run test/vendor-upstreams.test.ts`, and `pnpm -C service typecheck`.

Expected: leader-only ownership/direct-follower-control principal derivation and selector boundaries pass; issued IDs validate; forged/expired IDs run zero times; exact same-ID applies once; tombstoned success/resolution never re-executes; generation/demotion transitions are durable; mismatches conflict; same-file cross-session writes serialize; different files progress independently; action-nonce and workspace/operation routes authenticate; one reserved resolution unblocks normal cap without ID reuse; operation/egress numeric limits and crash recovery pass; framed progress/cancel/backpressure is identical across transports; direct Relay bypass and unregistered service-owned files are zero; disallowed egress produces runtime count zero.

- [ ] **Step 8: Request independent spec review**

For each 7A/7B/7C staged tree, the spec reviewer traces direct MCP, follower, and control calls through the one leader plane, confirms request bodies cannot supply identity/context, compares operation/nonce/egress/frame records with sections 3.3/3.11, and verifies pre-manifest fsync plus output reservation precede every side-effecting runtime. The verdict names the `git write-tree` hash.

- [ ] **Step 9: Request independent quality review**

For the same staged tree hash, the quality reviewer checks ownership/demotion races, target immutability, concurrency starvation, promise cleanup, operation and egress crash behavior, nonce/approval CAS races, result validation, bounded framing/backpressure/cancellation, sensitive audit fixtures, and closed-world authority completeness.

- [ ] **Step 10: Verify the three-commit execution-plane handoff**

Run: `git diff --check`, `git log -3 --format="%H %T %s"`, full Task 7 GREEN/authority verification, then `git diff --exit-code`. Expected: the three recorded 7A/7B/7C subjects exist in order; every commit tree equals its independently reviewed staged-tree hash; the worktree/index are clean; Task 6 auth and 112/105/7 registry remain green. Do not squash, rename the reviewed subjects, or create a fourth aggregate Task 7 commit.

### Task 8 — Confine filesystem access and move URL fetching into the daemon

**Files**

- Create: `service/packages/mcp/src/fs/atomic-file.ts`, `service/packages/mcp/src/network/remote-image-fetcher.ts`, `remote-domain-config-store.ts`.
- Create: `service/packages/mcp/src/control/network-domain-endpoints.ts`.
- Move/modify: `service/packages/mcp/src/repo-walk.ts` → `service/packages/mcp/src/fs/repo-walk.ts`; modify `service/packages/mcp/src/fs/workspace-policy.ts`.
- Modify: local tool modules `analyze-project.ts`, `scan-components.ts`, `component-map.ts`, `token-map.ts`, `icon-map.ts`, `design-diff.ts`, `save-screenshots.ts`, `save-image-fills.ts`, `export-pdf.ts`, `export-video.ts`.
- Modify: `service/packages/mcp/src/tools/runtime-registry.ts` so `import_image(url)` becomes a server wrapper that fetches bytes and dispatches `data`.
- Create: `service/packages/mcp/test/fs/local-tool-boundary.test.ts`, `atomic-file.test.ts`; `service/packages/mcp/test/network/remote-image-fetcher.test.ts`, `dns-pinning.test.ts`, `remote-domain-config.test.ts`, `import-image-runtime.test.ts`.

**Interfaces**

- Consumes: Task 4 WorkspacePolicy, Task 5 dynamic network/filesystem effects, Task 7 immutable `RuntimeExecutionScope`, leader `ExecutionPlane`, and shared action-nonce issue/validation router.
- Produces: `AtomicFileStore.createNew/replace`, sandboxed `RepoReader`, DNS-pinned `RemoteImageFetcher`, `RemoteDomainConfigStore`, authenticated `/control/network/domains*`, safe `import_image` server runtime; no direct local tool fs access outside approved adapters. Task 11 consumes `WorkspacePolicy` and `AtomicFileStore` to build snapshot storage after IR owns the port.

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

Apply every rule in section 3.10 inside the Task 7 `RuntimeExecutionScope`. Build requests with a custom lookup pinned to one vetted address, original Host/SNI, default certificate hostname check, and secureConnect remoteAddress membership check; never call ordinary fetch after validation. Re-resolve and create a new pinned connector for every redirect. The server runtime replaces `url` with validated bytes/base64 before dispatch through the same `ExecutionPlane` target; it neither re-resolves a target nor calls Relay directly, and records only finalUrlHash/MIME/byte count. Approval and durable pre-egress admission precede DNS/fetch.

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

Run: `git diff --check`, then `git add service/packages/mcp/src/fs service/packages/mcp/src/network service/packages/mcp/src/control/network-domain-endpoints.ts service/packages/mcp/src/tools service/packages/mcp/src/tools/runtime-registry.ts service/packages/mcp/test/fs service/packages/mcp/test/network`, then `git commit -m "feat(io): sandbox files and pin approved remote image domains"`.

### Task 9 — Pair the Desktop plugin, expose approvals, remove URL fetch, and set undo boundaries

**Files**

- Modify: `service/packages/plugin/manifest.json`, `src/code.ts`, `src/dispatcher.ts`, `src/idempotency.ts`, `src/panel.ts`.
- Create: `service/packages/plugin/src/file-identity.ts`.
- Modify glob: every `service/packages/plugin/src/handlers/*.ts` module whose registry key is in baseline `WRITE_TOOL_NAMES` (78 non-batch modules), plus `batch.ts`, `import-image.ts`, and `registry.ts`; the generated exact set is stored in `service/packages/plugin/src/mutation-handler-contract.ts` and must equal all 79 baseline write-kind names.
- Modify: `service/packages/plugin/ui/relay/client.ts`, `ui/App.vue`, `ui/main.ts`, `ui/style.css`.
- Create: `service/packages/plugin/ui/components/TabPairing.vue`, `TabApproval.vue`, `ui/composables/usePairing.ts`, `useApprovalQueue.ts`.
- Create: tests under `service/packages/plugin/test/auth`, `approval`, `protocol`, `handlers/import-image-policy.test.ts`, `file-identity.test.ts`, `mutation-handler-contract.test.ts`, `wire-result.test.ts`, `undo-boundary.test.ts`; create hand-derived changed/no-op fixture rows for every baseline write name under `service/packages/plugin/test/fixtures/mutation-outcomes.ts`.

**Interfaces**

- Consumes: Task 6 pairing/resume wire; Task 7 strict plugin `$progress`/`$cancel`, approval events, accepted/terminal envelopes, operation IDs, and immutable resolved target; Task 8 byte-only image dispatch. Task 9 adapts the existing plugin bridge but does not redefine invocation, progress, cancel, or terminal semantics.
- Produces: paired plugin hello/capability/file identity, 105-handler baseline parity, approval UI, in-flight Promise dedupe, `PluginHandlerOutcome<T>{value,mutated}` and `MUTATION_HANDLER_CONTRACTS` for exact 79 baseline write-kind handlers including batch/navigation, `UNDO_BOUNDARY_POLICIES` exact 79 rows, plugin top-level dispatcher as the sole `figma.commitUndo()` owner, and wire responses containing only `outcome.value`.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 9A — pair/resume/file identity | relay client, pairing UI/composable, capability hello, plugin-data UUID | auth/protocol/file-identity suites and real UI fetch CORS fixture | `feat(plugin): pair sessions and persist stable file identity`; produces authenticated identity for 9B |
| 9B — mutation outcome and undo | 78 non-batch write modules, batch, mutation contract/fixtures, dispatcher/idempotency | exact79 outcome rows, changed/no-op fixtures, wire-value-only, sole commit call | `refactor(plugin): report mutation outcomes and centralize undo`; produces handler contract for Task 12 |
| 9C — approvals, URL removal, capability UI | approval UI/control bridge, import-image data-only, manifest domains, editor capability display | approval/protocol/URL/manifest/Motion-video preservation suites | `feat(plugin): approve capability-gated byte-only operations`; final 112/105/7 handoff |

9B’s generated handler-name set and fixture ledger are reviewed independently from UI work. Task 10 starts only after all three subtask commits pass baseline parity.

**Binding subtask execution**

- [ ] **9A RED:** Run `pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/protocol packages/plugin/test/file-identity.test.ts`; expect unpaired relay and missing stable UUID path.
- [ ] **9A GREEN:** Implement pair/resume/file identity only and run `pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/protocol packages/plugin/test/file-identity.test.ts packages/mcp/test/security/pna.test.ts`; expect authenticated hello, rotation, real UI fetch, and system UUID outcome green.
- [ ] **9A review and commit:** Complete independent spec/quality reviews, then run `git add service/packages/plugin/ui/relay service/packages/plugin/ui/components/TabPairing.vue service/packages/plugin/ui/composables/usePairing.ts service/packages/plugin/src/file-identity.ts service/packages/plugin/src/code.ts service/packages/plugin/test/auth service/packages/plugin/test/protocol service/packages/plugin/test/file-identity.test.ts && git commit -m "feat(plugin): pair sessions and persist stable file identity"`.
- [ ] **9B RED:** Run `pnpm -C service exec vitest run packages/plugin/test/mutation-handler-contract.test.ts packages/plugin/test/wire-result.test.ts packages/plugin/test/undo-boundary.test.ts`; expect raw handler results, missing exact79 contracts, and no dispatcher-owned boundary.
- [ ] **9B GREEN:** Migrate the generated 78 non-batch set plus batch, then run `pnpm -C service exec vitest run packages/plugin/test/mutation-handler-contract.test.ts packages/plugin/test/wire-result.test.ts packages/plugin/test/undo-boundary.test.ts test/tool-registry.test.ts`; expect exact baseline79, every changed/no-op fixture, wire-value-only output, and one production commitUndo call site.
- [ ] **9B review and commit:** Complete independent spec/quality reviews of the generated name set and hand-derived fixture ledger, then run `git add service/packages/plugin/src/handlers service/packages/plugin/src/dispatcher.ts service/packages/plugin/src/idempotency.ts service/packages/plugin/src/mutation-handler-contract.ts service/packages/plugin/test/fixtures/mutation-outcomes.ts service/packages/plugin/test/mutation-handler-contract.test.ts service/packages/plugin/test/wire-result.test.ts service/packages/plugin/test/undo-boundary.test.ts && git commit -m "refactor(plugin): report mutation outcomes and centralize undo"`.
- [ ] **9C RED:** Run `pnpm -C service exec vitest run packages/plugin/test/approval packages/plugin/test/handlers/import-image-policy.test.ts packages/plugin/test/protocol`; expect missing approval UI and remaining direct URL/wildcard behavior while 9A/9B stay green.
- [ ] **9C GREEN:** Implement approvals, byte-only import, manifest/editor capability UI and run `pnpm -C service exec vitest run packages/plugin/test test/tool-registry.test.ts`, then `pnpm -C service build`; expect final baseline112/105/7 and Motion/video preservation.
- [ ] **9C review and commit:** Complete independent spec/quality reviews, then run `git add service/packages/plugin/manifest.json service/packages/plugin/ui/components/TabApproval.vue service/packages/plugin/ui/composables/useApprovalQueue.ts service/packages/plugin/ui/App.vue service/packages/plugin/ui/main.ts service/packages/plugin/ui/style.css service/packages/plugin/src/handlers/import-image.ts service/packages/plugin/src/panel.ts service/packages/plugin/test/approval service/packages/plugin/test/handlers/import-image-policy.test.ts && git commit -m "feat(plugin): approve capability-gated byte-only operations"`.

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

Render unpaired/pairing/wrong/expired/connected/reconnecting states. Exchange the eight-digit code, hold ticket/resume only in redacted state, send first-message credentials, rotate resume on every successful reconnect, and remove all secrets from diagnostics. Once paired, validate and relay Task 7 strict accepted/progress/result/error envelopes and `$cancel`; no plugin/UI field can supply actor, consent, workspace root, target identity/key, generation, editor, or capability context to the daemon invocation boundary.

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

Run: `git diff --check`, then `git add service/packages/mcp/src/index.ts service/packages/mcp/src/dispatch.ts service/packages/mcp/src/relay service/packages/mcp/src/tools service/packages/mcp/test/tools service/packages/mcp/test/relay`, then `git commit -m "fix(grounding): pin files and namespace durable design state"`.

### Task 11 — Assemble sectioned snapshots and grounding graphs

**Files**

- Modify: `service/packages/ir/package.json` to depend on `@sfp/shared`.
- Create: `service/packages/ir/src/canonical-json.ts`, `fidelity.ts`, `snapshot-v1.ts`, `snapshot-storage.ts`, `grounding-graph-v1.ts`, `store.ts`, `index.ts` and matching pure tests; IR owns `SnapshotV1` and `SnapshotStoragePort` together and imports no filesystem module.
- Create: `service/packages/mcp/src/snapshot/workspace-snapshot-storage.ts`, `capture-snapshot.ts`, `build-grounding-graph.ts`, `control/snapshot-endpoints.ts`.
- Create: `service/packages/mcp/test/snapshot/section-assembly.test.ts`, `snapshot-storage-adapter.test.ts`, `snapshot-store.test.ts`, `grounding-graph.test.ts`, `progress-integration.test.ts`.

**Interfaces**

- Consumes: Task 7 control middleware, immutable `RuntimeExecutionScope`, one executor, and shared progress/cancel/terminal transport; Task 8 `WorkspacePolicy` and `AtomicFileStore`; Task 10 stable file identity and pinned routing. Task 4/shared contributes no snapshot type and has a structural no-IR-import gate. Task 11 is a producer on the Task 7 reporter and does not define another context, frame, stream, or cancel contract.
- Produces: co-owned `SnapshotV1`/`SnapshotStoragePort` IR authority; MCP `WorkspaceSnapshotStorage` adapter using Task 8 primitives; `SnapshotReader.captureFull`, `GroundingGraphV1`, authenticated `/control/snapshots/capture`; no MCP registry addition.

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

Mount `POST /control/snapshots/capture` behind Task 6 control auth and the Task 7 plane. The request supplies workspace lookup and target selector only; the server-resolved scope must contain a stable file identity. Return snapshot ID/path/hash/fidelity through Task 7 NDJSON progress/terminal semantics; do not register a new MCP tool or define a second wire contract.

- [ ] **Step 7: Run snapshot GREEN**

Run: `pnpm -C service exec vitest run packages/ir/test packages/mcp/test/snapshot`, then `pnpm -C service typecheck`.

Expected: full/partial section assembly, progress/cancel, store corruption, graph priority/staleness, and control auth cases pass.

- [ ] **Step 8: Request independent spec review**

Reviewer verifies the observed/inferred boundary, shared dependency direction, section fidelity semantics, and canonical registry remains unchanged.

- [ ] **Step 9: Request independent quality review**

Reviewer checks recursive work-queue bounds/order/cycles, deterministic merge/hash, memory bounds, duplicate IDs, cancellation cleanup, injected workspace storage only, and Zod migration hooks.

- [ ] **Step 10: Commit snapshots**

Run: `git diff --check`, then `git add service/packages/ir service/packages/mcp/src/snapshot service/packages/mcp/src/control/snapshot-endpoints.ts service/packages/mcp/test/snapshot`, then `git commit -m "feat(snapshot): assemble loss-aware design state and grounding graph"`.

### Task 12 — Atomically add four safe-union tools and reach 116/106/10

**Files**

- Modify: `service/packages/mcp/package.json`, `service/pnpm-lock.yaml` to add `pdf-lib` 1.17.1.
- Create: `service/packages/mcp/src/execution/pdf-merge.ts`, `export-pool.ts`.
- Create: `service/packages/mcp/src/tools/export-tokens.ts`, `export-frames-to-pdf.ts`, `doctor.ts`, `import-library-variable.ts`.
- Create: `service/packages/plugin/src/handlers/import-library-variable.ts`.
- Modify atomically: MCP tool/result/runtime/policy registries, plugin handler registry, `service/packages/plugin/manifest.json`, union manifest.
- Create: `service/packages/mcp/test/tools/safe-union.test.ts`, `export-tokens.test.ts`, `export-frames-to-pdf.test.ts`, `doctor.test.ts`; `service/packages/plugin/test/handlers/import-library-variable.test.ts`; modify `service/packages/plugin/test/mutation-handler-contract.test.ts` and `service/packages/plugin/test/fixtures/mutation-outcomes.ts` for the exact final80 set; PDF fixtures under `service/packages/mcp/test/fixtures/pdf`.

**Interfaces**

- Consumes: Task 3 planned canonical rows/result/runtime authority, Task 5 policy, Task 7 immutable `RuntimeExecutionScope` plus the sole executor/progress/cancel/terminal envelope, Task 8 AtomicFileStore, Task 9 plugin capabilities/undo, Task 10 pinned dispatch. New runtimes cannot accept body-derived context, re-resolve a target, call Relay directly, or redefine the wire.
- Produces: contracts in section 3.8; PDF merge function in section 3.9; exact final registry 116, handlers 106, RuntimeBinding server authority 10, kinds 23/13/80; result/runtime/operation-policy/result-egress-policy maps 116; undo policy rows 80; all canonical rows implemented.

**Binding subtask/commit boundaries**

| Subtask | Review surface | RED/GREEN gate | Commit and handoff |
|---|---|---|---|
| 12A — hidden adapters | unregistered token/PDF/doctor runtimes, pdf-lib merger/fixtures, unregistered library handler and tests | focused adapter tests pass while parity remains exactly112/105/7 and four manifest rows stay planned | `feat(union): implement hidden safe-union adapters`; no registry/manifest/permission switch allowed |
| 12B — atomic authority switch | four specs/results/RuntimeBindings/effects/egress, one handler+undo row, teamlibrary permission, manifest transition | one RED→GREEN changes exact counts to116/106/server10/kinds23-13-80/maps116/undo80 | `feat(union): atomically advertise four safe-union tools`; Task 13 consumes this exact commit |

12A can be rejected without changing advertised surface. 12B is one atomic diff and cannot merge with a partial count/permission/manifest transition.

**Binding subtask execution**

- [ ] **12A RED:** Run `pnpm -C service exec vitest run packages/mcp/test/tools/export-tokens.test.ts packages/mcp/test/tools/export-frames-to-pdf.test.ts packages/mcp/test/tools/doctor.test.ts packages/plugin/test/handlers/import-library-variable.test.ts test/upstream-parity.test.ts`; expect missing adapter modules/fixtures while parity remains112/105/7 and four manifest rows remain planned.
- [ ] **12A GREEN:** Implement only unregistered token/PDF/doctor runtimes, pdf-lib merger/fixtures, and the unregistered library handler; run `pnpm -C service exec vitest run packages/mcp/test/tools/export-tokens.test.ts packages/mcp/test/tools/export-frames-to-pdf.test.ts packages/mcp/test/tools/doctor.test.ts packages/plugin/test/handlers/import-library-variable.test.ts test/upstream-parity.test.ts`, then `pnpm -C service build`. Expected: adapter tests green with advertised surface still112/105/7.
- [ ] **12A review and commit:** Complete independent spec/quality reviews, then run `git add service/packages/mcp/package.json service/pnpm-lock.yaml service/packages/mcp/src/execution/pdf-merge.ts service/packages/mcp/src/execution/export-pool.ts service/packages/mcp/src/tools/export-tokens.ts service/packages/mcp/src/tools/export-frames-to-pdf.ts service/packages/mcp/src/tools/doctor.ts service/packages/mcp/src/tools/import-library-variable.ts service/packages/mcp/test/tools/export-tokens.test.ts service/packages/mcp/test/tools/export-frames-to-pdf.test.ts service/packages/mcp/test/tools/doctor.test.ts service/packages/mcp/test/fixtures/pdf service/packages/plugin/src/handlers/import-library-variable.ts service/packages/plugin/test/handlers/import-library-variable.test.ts && git commit -m "feat(union): implement hidden safe-union adapters"`. The pdf-lib dependency/lock belongs to this independently buildable hidden adapter commit; do not stage any registry, permission, manifest, or capability row.
- [ ] **12B RED:** Run `pnpm -C service exec vitest run packages/mcp/test/tools/safe-union.test.ts test/tool-contract.test.ts` before registration; expect exact112/105/7 and four planned rows, proving the switch has not partially happened.
- [ ] **12B GREEN:** Apply specs/results/RuntimeBindings/effects/egress, one handler plus mutation/undo row, `teamlibrary`, and four manifest transitions in one diff; run `pnpm -C service exec vitest run packages/mcp/test/tools packages/mcp/test/policy packages/shared/test packages/plugin/test test/tool-contract.test.ts test/tool-registry.test.ts`, then `pnpm -C service build`. Expected: exact116/106/server10/kinds23-13-80/maps116/mutation80/undo80/planned0.
- [ ] **12B review and commit:** Complete independent spec/quality reviews, then run `git add service/package.json service/packages/mcp/src/tools/registry.ts service/packages/mcp/src/tools/runtime-registry.ts service/packages/mcp/src/policy service/packages/shared/src/result-schemas.ts service/packages/plugin/src/handlers/registry.ts service/packages/plugin/src/mutation-handler-contract.ts service/packages/plugin/test/mutation-handler-contract.test.ts service/packages/plugin/test/fixtures/mutation-outcomes.ts service/packages/plugin/manifest.json service/capabilities service/test/tool-contract.test.ts service/packages/mcp/test/tools/safe-union.test.ts && git commit -m "feat(union): atomically advertise four safe-union tools"`.

- [ ] **Step 1: Write atomic-count and new-tool RED**

~~~ts
it('reaches the exact safe-union invariant in one change', () => {
  expect(ALL_TOOL_SPECS).toHaveLength(116);
  expect(Object.keys(createSandboxHandlers({} as never))).toHaveLength(106);
  expect(SERVER_ONLY_TOOLS).toEqual(new Set([
    'save_screenshots', 'analyze_project', 'scan_components', 'component_map', 'token_map',
    'icon_map', 'design_diff', 'export_tokens', 'export_frames_to_pdf', 'doctor',
  ]));
  expect(Object.values(TOOL_RUNTIMES).filter(x => x.authority === 'server')).toHaveLength(10);
  expect(groupKinds(ALL_TOOL_SPECS)).toEqual({ read: 23, local: 13, write: 80 });
  expect(Object.keys(RESULT_SCHEMAS)).toHaveLength(116);
  expect(Object.keys(RESULT_EGRESS_POLICIES)).toHaveLength(116);
  expect(Object.keys(UNDO_BOUNDARY_POLICIES)).toHaveLength(80);
  expect(Object.keys(MUTATION_HANDLER_CONTRACTS)).toHaveLength(80);
  expect(new Set(Object.keys(MUTATION_HANDLER_CONTRACTS))).toEqual(
    new Set([...BASELINE_WRITE_TOOL_NAMES, 'import_library_variable']),
  );
  expect(MUTATION_FIXTURES.map(x => x.tool).toSorted()).toEqual(
    [...BASELINE_WRITE_TOOL_NAMES, 'import_library_variable'].toSorted(),
  );
  expect(types(policy('export_tokens').effectsFor({ format: 'json' }, ctx))).toEqual(['figma-read']);
  expect(types(policy('export_tokens').effectsFor({ format: 'json', outPath: 'tokens.json' }, workspaceCtx)))
    .toEqual(['figma-read', 'filesystem-write']);
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

Add four specs/results/RuntimeBindings/operation policies/result egress policies; add only the library handler plus its `MUTATION_HANDLER_CONTRACTS` row and undo-policy row so baseline79 becomes final80 in both authorities; add `teamlibrary` permission; transition four manifest rows planned→implemented. Every adapter executes inside the supplied immutable `RuntimeExecutionScope`. Mark `export_frames_to_pdf` and `export_video` as `exclusive-heavy`, keep Motion writes under `file-write`, add duration-aware video budget, and emit PDF/video progress through the Task 7 relay/MCP/control transport with its exact cancel/framing/backpressure/absolute-max behavior. Snapshot progress remains wholly owned and tested by Task 11 so Tasks 11/12 stay parallel-safe.

- [ ] **Step 8: Run final registry/policy/runtime GREEN**

Run: `pnpm -C service exec vitest run packages/mcp/test/tools packages/mcp/test/policy packages/shared/test packages/plugin/test test/tool-contract.test.ts test/tool-registry.test.ts`, then `pnpm -C service build`.

Expected: tools116, handlers106, server-authority/server-only10, kind23/13/80, result/runtime/operation/egress maps116, mutation contracts80, undo policies80, manifest planned0, Motion7+video present, no handler commitUndo call, and plugin build passes.

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

- Consumes: Task 6 owner-only control token discovery; Task 7 strict selector-only `InvocationRequestV1`, action-nonce issue route, tool/approval/workspace APIs, NDJSON accepted/progress/terminal frames, and explicit cancel; Task 8 remote-domain control API; Task 11 snapshot endpoint; Task 12 final tools/progress. The CLI never sends actor/auth/consent/mode/allowed classes/workspace root/target identity or execution key and never redefines wire semantics.
- Produces: authenticated `ControlClient`; workspace and remote-domain config commands; CLI exit codes 0 healthy, 1 degraded/rejected operation, 2 unavailable/config; command mappings below. CLI is a companion to an active MCP/daemon and never starts a hidden leader.

**Command contract**

| Command | Canonical call | Required args/options | Approval/output |
|---|---|---|---|
| `sfp status` | unauth strict `/ping` then authenticated status | `--json` | product/role/version; unavailable 2 |
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

Read control token only from secured stateRoot and validate strict product magic/protocol. For `/control/tools/call`, send only strict `InvocationRequestV1` with workspace lookup ID and `active`/`session`/`stable-file`/`none` selector; the snapshot endpoint likewise sends only its typed node IDs, workspace lookup, and selector. Authenticated middleware/config/Relay state derives principal, consent, root, target, file key, generation, editor, and capabilities. Parse NDJSON `accepted`/`progress`/terminal frames with the Task 7 limits, surface the server-issued operation ID, and post exact `InvocationCancelV1` to `/control/tools/cancel` on explicit user cancel. Redact secrets in JSON and never call follower `/rpc` directly. Doctor/status can report absence; other commands return exact start instructions and exit 2.

- [ ] **Step 4: Implement workspace, pairing, and approval commands**

Implement all table rows, terminal-only public Pair ID+code/paste-form display, pending approval list, exact approve/reject, operation issue/list/status/resolve, workspace realpath lifecycle, and exact-host allowlist lifecycle. Before each nonce-protected route, canonicalize the exact semantic request, call `POST /control/action-nonces` with action+requestHash, and use the returned nonce once; do not generate/cache/reuse nonces locally. Mutation wrappers request a server-issued operation ID before dispatch and surface it in accepted/progress/error/output. Operation resolve is an owner-local administrative call that requires the operator to type/paste exact `--confirm <operationId/resultHash-or-unknown>`, hashes the user-provided reason/evidence files locally, requests a bound `operation.resolve` nonce, and never requests ordinary approval or resubmits the original tool. JSON pair output includes challengeId/expiry but redacts code after exchange; control token supplies actor identity and bodies cannot override it.

- [ ] **Step 5: Implement snapshot/export/read/write wrappers**

Use only control tool-call/snapshot endpoints. Encode user target choice as a Task 7 selector, not `PluginTarget`/`FileIdentity`/`FileExecutionKey`; resolve `sel`, `page`, and node URL/ID through typed reads inside the server-resolved immutable scope, and reject target type incompatible with text/variant. Preserve ordered PDF IDs and clone frame recipe. No wrapper owns a second mutation implementation, progress stream, or cancellation state machine.

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

Run: `git diff --check`, then `git add service/packages/cli service/package.json service/pnpm-lock.yaml`, then `git commit -m "feat(cli): add authenticated diagnostics approvals and typed wrappers"`.

### Task 14 — Correct skills and write capability, security, and official build-vs-buy docs

**Files**

- Modify: `service/skills/figma-codegen/**`, `service/skills/figma-build/**`.
- Create: `service/skills/compat-rust-recipes/` with only schema-validated recipes.
- Create/modify: `service/README.md`, `SECURITY.md`, `docs/architecture.md`, `build-vs-buy.md`, `capability-matrix.md`, `compatibility.md`, `operation-policy.md`, `pairing.md`, `snapshot-format.md`, `desktop-acceptance.md`.
- Create: `service/test/docs-sync.test.ts`.

**Interfaces**

- Consumes: Task 12 final manifest/policies and Task 13 exact CLI/help output.
- Produces: user/operator docs synchronized with 116/106/10, corrected discovery skills, current official build-vs-buy explanation with checked URLs/date and no fixed rate number.

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

Document Desktop Design v0.1; Dev read-only/negative writes; FigJam partial/uncommitted; Web/public deferred. Document literal pairing OPTIONS/POST CORS/PNA headers, stateRoot, authenticated workspace/exact-FQDN config and owner-local confirm-string operation resolution with its 1 MiB reserve, DNS-pinned URL fetch with no suffix/PSL feature, egress preflight/output classification, signed operation-ID horizon/tombstone/settled response, generation transitions, dispatcher-only undo and handler outcome migration, IR-owned recursive snapshot fidelity/storage namespace, isolated bundle closure and umbrella release producer, source-complete versus GA status, CLI active-daemon prerequisite, and Motion/video experimental status.

- [ ] **Step 6: Run docs GREEN**

Run: `pnpm -C service exec vitest run test/docs-sync.test.ts test/tool-contract.test.ts`, then `pnpm -C service format:check`.

Expected: docs counts/commands/URLs/skills/policies match generated authorities and no fixed official rate text exists.

- [ ] **Step 7: Request independent spec review**

Reviewer compares docs against binding 04/05, official-current feature claims, product boundary, and all manifest dispositions.

- [ ] **Step 8: Request independent quality review**

Reviewer checks clarity, links, command examples, policy non-overclaim, no secrets, and no unsupported Web/public/local-only marketing.

- [ ] **Step 9: Commit docs and skills**

Run: `git diff --check`, then `git add service/README.md service/SECURITY.md service/docs service/skills service/test/docs-sync.test.ts`, then `git commit -m "docs(service): align skills capabilities and build-versus-buy"`.

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

Set MCP tsdown `deps.alwaysBundle` to `['@sfp/shared','@sfp/ir']` and CLI to `['@sfp/shared']`; assert built files contain those modules and packed package.json has neither private package nor `workspace:*` runtime dependency. `package-artifacts.mjs` starts from clean `service/artifacts/.staging`, creates separate staged MCP and CLI package roots, copies each built dist plus its sanitized package.json, copies `service/README.md` into each root as `README.md`, and copies `LICENSE`, `THIRD_PARTY_NOTICES.md`, `PROVENANCE.md`, `SBOM.spdx.json`, all three upstream license files, and the capability ledgers into each staged root. Each staged package.json rewrites `files` to the exact in-root list `['dist','README.md','LICENSE','THIRD_PARTY_NOTICES.md','PROVENANCE.md','SBOM.spdx.json','licenses','capabilities']`. It runs `npm pack service/artifacts/.staging/mcp-package --pack-destination service/artifacts/.staging` and the equivalent CLI command with argv arrays, then normalizes their generated names to `service/artifacts/mcp.tgz` and `cli.tgz`. For plugin ZIP it creates an isolated staged Git repository containing the same authorities plus manifest/dist, commits with fixed author and `SOURCE_DATE_EPOCH`, and invokes `git archive --format=zip` by argv; no platform-specific zip command or new archive dependency is used. It removes staged `.git` data and atomically writes an artifact manifest before checksums. No npm pack may rely on `files` paths outside its staged package root. Generate SPDX entries from frozen lock including pdf-lib and generate notices before packaging. Generate sorted SHA-256 checksums only after all three artifacts are final; record each package version/bin path and expected `/ping` build identity. Verify Solar assets, raw exec symbols, the RED-only harness, and development-only vendor scripts are absent. Runtime JS/bin/config contains no `code-kb` path; source references are allowed only inside PROVENANCE/capability metadata.

- [ ] **Step 4: Implement CI and release workflows**

Reuse immutable action digests already pinned in the vendored Figwright workflow authority. CI uses frozen install, type/lint/format/knip/build/test on Ubuntu and Windows and fails if built-dist E2E skips. Release-candidate job triggers only version tags, reruns `verify:release`, and uploads checksummed draft artifacts. GA publish is a separate protected-environment job that verifies both OS evidence schemas, detached signatures, public-key fingerprints against the pre-registered owner fingerprints, matching candidate artifact hashes, and `waived:false`; absent or untrusted evidence leaves a draft/source-complete preview and cannot publish npm/plugin assets.

- [ ] **Step 5: Verify upstream and package contents offline**

Run: remove only the generated `service/artifacts` directory, then `node service/scripts/verify-upstream-lock.mjs --offline` and `pnpm -C service verify:release`. The exact internal order is verify/build → generate SBOM → generate notices → package all three artifacts → generate checksums → artifact tests → artifact verifier. The verifier creates independent `mkdtemp` prefixes/caches, installs exactly one tarball per prefix, runs `npm ls --all`, calls `smoke-installed-mcp.mjs --expect-tools 116` on the installed MCP bin, requires installed CLI `--help` exit 0 and `status` exit 2 with `DAEMON_UNAVAILABLE`, scans for workspace paths, and removes temporary roots.

Expected: artifacts contain canonical116/source114/helper20/parser12, Motion7+video, three upstream notices, pdf-lib notice, SBOM, provenance, and matching checksums; both isolated installs resolve without private workspace packages or workspace paths and installed bins run.

- [ ] **Step 6: Run workflow hygiene checks**

Run the repository actionlint/zizmor workflow checks if available; otherwise run the pinned workflow validation commands documented by the parent repository. Structural tests reject floating `uses:` refs and non-frozen installs.

- [ ] **Step 7: Request independent spec review**

Reviewer opens every actual artifact and compares legal/capability/runtime contents with DoD; source-tree presence alone is insufficient.

- [ ] **Step 8: Request independent quality review**

Reviewer checks reproducibility, package surface, workflow permissions, provenance/checksum order, SBOM completeness, and release failure handling.

- [ ] **Step 9: Commit release machinery**

Run: `git diff --check`, then `git add .github/workflows/service-ci.yml .github/workflows/service-release.yml service/package.json service/packages/*/package.json service/pnpm-lock.yaml service/scripts service/licenses service/LICENSE service/THIRD_PARTY_NOTICES.md service/PROVENANCE.md service/SBOM.spdx.json service/test/artifact-contents.test.ts service/test/fixtures/assemble-baseline-artifacts.mjs`, then `git commit -m "build(release): verify standalone licensed service artifacts"`.

### Task 16 — Build the automated Desktop acceptance harness and evidence schema

**Files**

- Create: `service/docs/evidence-schema.json`, `service/scripts/desktop-acceptance.mjs`, `install-release-artifacts.mjs`, `sign-evidence.mjs`, `verify-evidence-signature.mjs`, `service/test/acceptance-harness.test.ts`; generate `service/artifacts/source-complete-preview.json`.
- Modify: `service/docs/desktop-acceptance.md`, `service/package.json` acceptance script.

**Interfaces**

- Consumes: Task 13 CLI/control API and Task 15 build/artifact hashes.
- Produces: `AcceptanceEvidenceV1` and `AcceptanceAttestationV1`, checksum-verified temporary packed-artifact installer/launcher, fake-control harness tests, live runner that returns typed `PLUGIN_NOT_CONNECTED`, detached Ed25519 evidence signatures, source-complete preview marker `releaseStatus:'blocked-external-evidence'`, and nonzero exit on any GA-blocking live check.

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

Require OS/arch, OS acceptance owner, operator, timestamp, Figma Desktop version, plugin/MCP/CLI packed artifact SHA-256 values, `/ping` build identity, capability set, redacted file identity kind, check IDs/status/code/duration, and `waived:false` for every blocking check. `AcceptanceAttestationV1` requires `attestedBy`, `attestedAt`, `method:'ed25519-local-owner'`, public-key fingerprint/keyId, evidence SHA-256, and detached signature filename. Owner private key is generated/stored only under owner-secured stateRoot; public PEM and `.sig` may be committed. Screenshots are not committed; only optional SHA-256 references are stored.

- [ ] **Step 4: Implement fake-control acceptance flow**

Exercise doctor, pair, selection/context/grounding, snapshot/graph, token/PDF exports, library import result, same-ID once/conflict, ordered writes, approval reject/approve, undo marker, post-dispatch flap unknown, path/URL negatives, Motion/video capability, diagnostic redaction. Assert evidence never contains raw design/file data.

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

Run: `git diff --check`, then `git add service/docs/evidence-schema.json service/docs/desktop-acceptance.md service/scripts/desktop-acceptance.mjs service/scripts/install-release-artifacts.mjs service/scripts/sign-evidence.mjs service/scripts/verify-evidence-signature.mjs service/test/acceptance-harness.test.ts service/package.json`, then `git commit -m "test(acceptance): verify packed artifacts and signed evidence"`.

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
- Baseline audit proves 112 tools/105 handlers/server-only7 before safe union.
- Final audit proves 116 advertised tools, 106 plugin handlers, server-only10, kind read23/local13/write80.
- Runtime result schemas, runtime bindings, and dynamic policies cover 116/116 with no unknown fallback.
- Result egress policies cover 116/116 with exact input/result classifiers and pre-runtime consent upper bounds; runtime authorities derive plugin106/server10.
- Canonical manifest has 116 implemented rows; source ledgers have lexical114/helper20/parser12 with 11 unique parser behaviors and no unclassified row.
- Motion7 and video1 are present as experimental-native in registry, runtime, policies, docs, and artifacts.
- Selection/context/screenshot/component-token-icon grounding and typed writes pass unit/process/fake-control acceptance; Tasks 17/18 separately prove live editable Design.
- `export_tokens`, ordered `export_frames_to_pdf`, `doctor`, and `import_library_variable` pass focused/process/harness capability tests; GA evidence records live positive or typed capability-negative outcomes.
- CLI doctor/status/pair/workspace/approvals/compat/snapshot/token/PDF/read/write/import wrappers use authenticated control and the same executor.
- Direct MCP, follower, and control all enter exactly one leader-generation `ExecutionPlane`; followers own only `FollowerInvocationClient`, and unknown/conflicted roles serialize/forward zero invocation arguments.
- All entry points accept the same strict selector-only `InvocationRequestV1`, produce the same accepted/progress/terminal semantics, and expose no second Relay/runtime dispatch path.
- SnapshotV1/GroundingGraphV1 persist under an approved workspace with stable file identity, section fidelity, checksum, and atomic writes.
- Snapshot storage uses only the injected port and `.sfp/snapshots/v1/{fileIdentityHash}/{snapshotId}.json`; recursive fidelity distinguishes expanded plans, complete leaves, failed/cycle/depth/cap issues with stable path/order.
- Skills distinguish code AST scan from Figma component discovery and do not claim deterministic reverse compilation.

### Security and Reliability

- Bind is loopback only; strict Host/Origin/PNA/path/body/WS-frame gates pass.
- Allowed pair POST success and every typed error carry exact ACAO/ACAPN/Vary headers readable by plugin UI; hostile/absent Origin receives no allow headers or oracle body.
- Eight-digit one-time code, 128-bit one-use ticket, rotating resume, follower, and control tokens pass expiry/attempt/rate/rotation/replay tests.
- The 256-bit owner-principal key remains owner-only and derives domain-separated direct-MCP, follower-MCP, and control actor IDs; direct MCP uses a server-generated 128-bit session, follower proofs bind `mcp1_<22-base64url>` session+generation, and `/ping` exposes no active session ID.
- Unix owner modes and Windows current-user DACL are verified; insecure stateRoot startup fails closed.
- `stateRoot` and `workspaceRoots` are distinct; workspace add/list/remove is authenticated and every project read/write is sandboxed per path.
- Workspace, remote-domain, and operation-resolution control routes derive actor from control auth and use server-issued `sfp_an1_`+256-bit nonces bound to actor/generation/action/requestHash for exactly 120,000 ms. The store enforces 1,024 rows/512 KiB per actor, never evicts live rows, consumes atomically after semantic validation and immediately before side effect, retains consumed rows to expiry, and invalidates outstanding rows on restart/generation. CLI issues rather than invents each nonce; workspace removal consults the journal guard. Approval IDs remain their own exact-once settlement authority rather than a second nonce action.
- Null Origin alone never authenticates a plugin. Foreign product/2xx never becomes leader. Unknown role never forwards args.
- Body-supplied actor/auth session/principal/consent/mode/allowed classes/workspace root/target/FileIdentity/fileExecutionKey/plugin generation/editor/capabilities are rejected. Target selectors are lookup-only; immutable target/key derive from authenticated Relay FileIdentity, unstable keys include registered session+generation, file name is never identity, and lost pin returns `PINNED_SESSION_LOST`.
- Dynamic effects distinguish data/URL, content/outPath, overwrite/create-new, read/write, library import, and experimental heavy operations.
- Destructive, filesystem-write/overwrite, network, library-import, and broad-write actions receive the required explicit approval. Inside-root filesystem reads follow workspace/sensitivity policy without being mislabeled as writes.
- Per-file queue serializes same file across sessions; different file identities can progress independently within read/heavy limits.
- Same `(actorId,operationId)`+same contract applies once; mismatched reuse conflicts. Persisted succeeded exact calls return `OPERATION_ALREADY_SETTLED` with hash/status and runtime zero; generation change fails queued/pending, changes dispatched to unknown, and never re-executes succeeded work.
- Operation IDs are server-issued/HMAC-bound to actor and issuedAt. In-horizon tombstones prevent reuse; valid signed IDs older than 30 days always return `OPERATION_ID_EXPIRED` with runtime zero after tombstone purge.
- Post-dispatch disconnect becomes durable outcome-unknown and is never blindly replayed. Recovery, compaction, truncated tail, and cap fail-closed tests pass.
- Journal compacts active transitions at 8,000 rows/24 MiB, stops normal operation appends at 10,000 rows or 31 MiB, reserves the final exact 1 MiB of its 32 MiB active allocation for fsynced resolution intents, moves ordinary terminal records to a separate 1,000,000-entry/256 MiB tombstone index through each signed 30-day horizon, rejects older IDs from signed issuedAt after purge, and keeps status/resolution/purge routes available to unblock capacity/workspaces.
- Authenticated owner-local operation issue/list/status/resolve and CLI commands record actor/auth/confirmation/reason/evidence hashes without normal approval. A confirmed resolution is an authoritative reserved no-replay tombstone even when the ordinary tombstone index is full; resolved-applied/resolved-not-applied/abandoned release unresolved workspace/cap accounting, while reserve-full fails typed and leaves state unchanged.
- Effects/approval and exact `classifyInput`/possible-result preflight occur before queue/runtime; disallowed external/unknown classes yield runtime zero. Strict result validation and `classifyResult` occur afterward, actual classes must fit the preflight upper bound, and audit contains no raw code/design/image/secret payload.
- Egress manifests live only at `stateRoot/journal/{actor-hash}.egress-manifests.v1.jsonl`, maximum 64 KiB/row, compact160k/192MiB, hard200k/256MiB, retention30d, with checksums/hash chain. Pre-manifest fsync and output reservation precede runtime; output fsync precedes terminal state; only a final truncated tail recovers, middle corruption fails closed, and a post-runtime durability failure becomes outcome-unknown. Raw args/results never persist there.
- Accepted/progress/result/error frames are strict across MCP, 4-byte big-endian length-prefixed MessagePack follower RPC, control NDJSON, and plugin `$progress`/`$cancel`. Phase/message/frame/subscriber/rate limits are 64 chars, 1,024 UTF-8 bytes, 16 KiB, 64 frames/256 KiB, and 20/s; only same-operation/same-phase nonterminal progress coalesces, terminal frames never drop, backpressure drains, explicit cancel/absolute deadline win, and disconnect is not retry/cancel.
- URL import validates approval, HTTPS, every DNS/redirect hop, address ranges, domain, MIME/signature, and streamed size in the daemon. Plugin external URL fetch and wildcard permission are absent.
- URL connections are pinned to the vetted IP with original Host/SNI/certificate verification and secureConnect remoteAddress check; every redirect re-resolves. The default allowlist is empty and v0.1 accepts exact three-or-more-label ASCII FQDN equality only—no wildcard, suffix/subdomain rule, apex two-label host, or PSL dependency.
- The plugin top-level dispatcher is the sole `commitUndo` caller. A changed document write/batch/library import/system UUID creates one boundary; handlers, read, navigation/figma-ui, no-op, and failure create none.
- Exact mutation contracts cover baseline 79 and final 80 write-kind handlers; every mutation handler returns `{value,mutated}`, wire output exposes only value, and production handler files contain zero commitUndo calls.
- Raw evaluator and non-loopback code paths are absent from source and release bundles.

### Quality and Release

- Frozen install, typecheck, lint, format check, knip, build, unit, integration, process E2E, artifact, and docs-sync tests pass on Ubuntu and Windows CI.
- Built-dist E2E cannot silently skip in CI/release.
- `verify:release` runs verify/build → SBOM → notices → umbrella `package-artifacts.mjs` → checksums → artifact tests/verifier, producing and inspecting MCP/CLI tarballs and plugin ZIP from a clean artifact directory.
- MCP bundle contains shared+IR and CLI bundle contains shared; packed manifests have no workspace/private runtime dependency, and each tarball installs alone in an empty prefix/cache and runs its installed bin/tool smoke.
- GA evidence launches checksum-verified installed tarball bins plus the exact plugin ZIP, binds `/ping` build identity to artifact hashes, and verifies detached owner Ed25519 signatures.
- Three upstream MIT notices, service license, pdf-lib notice, THIRD_PARTY_NOTICES, PROVENANCE, SBOM, and capability ledgers are present in every applicable artifact.
- Solar CC BY assets and raw exec symbols are absent.
- Offline upstream verification passes without original checkouts; parent-workspace verification confirms all three original repos remain clean at pinned commits.
- Service CI/release workflows use frozen install, least permissions, immutable action digests, and protected release approval.

### Documentation and Policy

- README/capability matrix state Desktop editable Design v0.1, Dev read-only, FigJam partial, Web/public deferred, and no view-only bypass.
- Build-vs-buy documents official `use_figma`, `generate_figma_design`, design-system search/assets, permissions/current limitations, checked URLs/date, and separate MCP/REST limit authorities without fixed rate numbers.
- Docs say REST/official MCP endpoints are not used by the local path while Figma account/edit/plugin/policy and model-provider costs remain.
- Egress, retention, delete/export, operation states, pairing, workspace roots, URL policy, stable identity, snapshot loss, Motion/video experimental status, and CLI active-daemon prerequisite are documented.

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
| A-IP-C02 | accepted | Task 6 produces control-auth middleware only; `/control/tools/call` is created in Task 7 with ToolInvocationService. |
| A-IP-C03 | accepted | pdf-lib 1.17.1, `pdf-merge.ts`, ordered copy algorithm, corrupt/encrypted/mixed/order/no-overwrite tests are binding. |
| A-IP-C04 | accepted | Section 3.3 defines InvocationContext, actor/auth/workspace/consent/target, expanded journal hashes/approval, and tuple idempotency conflict. |
| A-IP-I01 | accepted | Former first task is split into runnable Task 1 harness and Task 2 vendor/parity; RED reaches intended missing registry. |
| A-IP-I02 | accepted | DAG makes safe union Task 12 consume auth/executor/fs/plugin/grounding contracts; Task 11 may only parallel after Task 10. |
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
| I-02 | accepted | Revised DAG removes auth/control/journal/path reverse dependencies and states Task 11/12 parallel condition. |
| I-03 | accepted | Dynamic effects/approval and overwrite resolution distinguish conditional side effects while MCP annotations remain conservative. |
| I-04 | accepted | Journal records full audit context; same-ID mismatch, startup unknown transition, hard cap, truncated-tail and compaction tests are included. |
| I-05 | accepted | Task 3 establishes strict result schemas and Task 7 fixes execution order before result hashes/egress. |
| I-06 | accepted | Result/runtime maps cover baseline112 then final116; plugin authorities106/server-only10; snapshot is control-only. |
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
| B-I-08 | accepted | figmosha field typo is fixed; TOOL_RUNTIMES values are RuntimeBinding with authority; common rows require exactly two source contracts plus one target hash; final maps are116/server10. |
| B-I-10 | partially accepted | One parent plan remains per instruction. Section 6.1 now gives every Task a maximum semantic review surface and makes large Tasks 2/7/8/9/12 separately rejectable slices without changing the required Tasks17/18 evidence numbering. |
| N-C-01 | accepted | Vendor rules copy only source/test/skills/build files; root/package/lock/config are merge/reference authorities, Task 1 files are hash-protected, upstream postinstall is dropped, and service lock is regenerated/frozen. |
| N-C-02 | accepted | Runtime import/dependency specifiers are AST-checked; raw @figwright protocol/comment/user/provenance strings use an exact allowlist; production code-kb search remains zero. |
| N-C-03 | accepted | Succeeded old-generation records never execute; queued/pending fail, dispatched becomes unknown, in-memory exact replay is bounded, persisted exact success returns settled status, mismatch remains conflict. |
| N-I-01 | accepted | JournalLimits fixes 8k/24MiB compaction, 10k rows or 31MiB normal hard cap plus a dedicated 1MiB resolution reserve, horizon tombstones, signed-ID expiry, unresolved retention, manual resolution, and exact fail-closed/unblock behavior. |
| N-I-02 | accepted | Task 7 owns progress transport, Task 11 owns snapshot producer/wiring, Task 12 wires PDF/video only, and Task 13 consumes both parallel outputs. |
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

The completed Tasks 1–6 commits, tests, reviews, and report evidence remain valid. The former full-plan SHA-256 `5EAFC23397F4A7DD147263ABAB6AF258AABB4207FCE5ED33EE428C13D15B826A` is superseded for Task 7 and every downstream task because Task 7 preflight found an ambiguous ownership/identity/wire/durability boundary before any Task 7 implementation commit. Executors must use the amended full-file SHA recorded in `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.sha256`; old generated Task 7 briefs are invalid and must be regenerated from that exact file. This is a forward plan correction, not a retroactive change to accepted Task 1–6 scope or evidence.

| Finding | Decision | Amendment resolution |
|---|---|---|
| T7-PF-C01 | accepted | One leader-generation `ExecutionPlane` owns invocation lifecycle. Followers construct only `FollowerInvocationClient`; unknown/conflicted roles forward no args; demotion closes admission, aborts queued/pending, durably marks nonterminal dispatched unknown, fsyncs/drains/destroys. |
| T7-PF-C02 | accepted | Strict `InvocationRequestV1`/cancel schemas carry request/tool/args/operation/workspace lookup/selector only and reject body identity/context. A secured 256-bit owner key plus direct 128-bit MCP session, follower session+generation proof, or control middleware derives principals. |
| T7-PF-C03 | accepted | Active/session/stable-file/none are lookup selectors only. Final target and `FileExecutionKey` derive from authenticated Relay `FileIdentity`, freeze for the invocation, never use fileName, and fail `PINNED_SESSION_LOST` instead of rerouting. |
| T7-PF-C04 | accepted | Action nonce is `sfp_an1_`+256-bit base64url, actor/generation/action/requestHash-bound, 120-second, CAS one-use after semantic validation, capped at 1,024 rows/512 KiB per actor with no live eviction, and invalidated by restart/generation. |
| T7-PF-C05 | accepted | Durable pre/output egress manifests have exact owner-state namespace, 64 KiB row, 160k/192 MiB compaction, 200k/256 MiB hard cap, 30-day retention, checksum/hash chain, pre-fsync+output reservation before runtime, output fsync before terminal, tail-only recovery, and post-runtime durability→unknown. |
| T7-PF-C06 | accepted | Accepted/progress/result/error and cancel semantics are shared across MCP, follower framed MessagePack, control NDJSON, and plugin adapters with exact phase/message/frame/subscriber/rate/backpressure limits; disconnect is neither cancel nor retry. |
| T7-PF-I01 | accepted | Task 7 owns shared invocation/action-nonce/progress/rpc/envelope/protocol/operations/index plus runtime/election/follower/relay/dispatch integration and structural no-direct-relay gates. Tasks 8–13 consume these contracts and do not redefine them. |
| T7-PF-I02 | accepted | 7A/7B/7C retain the already reviewed exact commit subjects while strengthening boundaries. Each slice is RED→GREEN→closed-world authority→exact staged tree→independent spec+quality reviews→same-tree rerun→exact commit; there is no six-module cap or aggregate fourth commit. |
| T7-PF-I03 | accepted | `vendor-rules.json`, `vendor-map.json`, and `upstream-lock.json` are updated and verified in every slice so new/modified managed files cannot escape the Task 2 closed-world authority. |

No Round 1–4 Critical/Important finding is rejected. The only alternative scope resolution remains the explicit exact-FQDN/no-suffix v0.1 policy; no new rate or feature scope was added.

---

## 11. Execution Handoff

After this plan passes review resolution and the author-side verification reported with the plan, execute with `superpowers:subagent-driven-development`: one fresh implementation subagent per Task, then the independent spec and quality reviewers named in that Task. Before Task 7 dispatch, verify the full-file checksum against `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.sha256`, discard the obsolete pre-amendment Task 7 brief, and regenerate it. Tasks 1–16 may finish the implementation goal with the exact source-complete/release-blocked status above. Do not start Tasks 17/18 until the release manager assigns the external acceptance owner and machine, and do not claim GA/release until both signed evidence sets and `pnpm -C service verify:release` pass.
