# SFP v0.1 Implementation Plan Input

> **For agentic workers:** 구현 전 이 문서를 최종 spec과 task plan으로 승격하고, <code>superpowers:subagent-driven-development</code> 또는 <code>superpowers:executing-plans</code>로 task별 RED/GREEN checkpoint를 지킨다. 이 문서는 구현 승인이 아니라 메인 계획의 사전 입력이다.

**Goal:** 원본 세 OSS를 변경하지 않고 새 <code>service/</code>에 Figwright의 전체 tool/handler 기능을 보존하면서 secure Desktop local connector, grounding snapshot, export/doctor CLI를 갖춘 v0.1을 만든다.

**Architecture:** Figwright의 TypeScript monorepo를 standalone service baseline으로 vendor하고, 모든 tool 실행을 하나의 policy/execution pipeline으로 통과시킨다. Rust와 figmosha2에서는 중복 server를 가져오지 않고 deterministic token export, progress 개념, doctor/error-hint/target UX만 source attribution과 함께 흡수한다.

**Tech Stack:** Node 24, pnpm 11.24, TypeScript 6 strict, MCP server v2, Zod 4, MessagePack, ws, Vue 3/Vite, Vitest, oxlint/oxfmt/knip.

**Spec:** <code>docs/code-kb-analysis/05-unified-service-proposal.md</code>와 검증된 01~04 분석 및 reviews.

## Global Constraints

- <code>code-kb/figma-mcp-rust</code>, <code>code-kb/figmosha2</code>, <code>code-kb/figwright</code>는 read-only reference다.
- Production source는 <code>service/</code> 밖의 상대경로를 import하거나 runtime에 읽지 않는다.
- v0.1 runtime baseline은 Node 24 하나로 고정한다. Node 20/22 지원은 별도 compatibility phase 전까지 주장하지 않는다.
- v0.1 connector는 Figma Desktop development plugin, single user, user-authorized editable Figma Design file이다.
- non-loopback bind, raw JavaScript evaluator, Web/public distribution, view-only bypass는 v0.1에서 제공하지 않는다.
- Figwright 112 MCP tool name과 105 plugin handler를 보존한다. Rust 고유 이름 중 <code>export_tokens</code> 하나를 추가해 v0.1 registry는 113 tools다.
- Rust legacy schema를 같은 tool name에 섞지 않는다. 71개 lexical overlap은 compatibility report로만 제공한다.
- 모든 filesystem access는 configured workspace roots 안에서만 수행한다.
- 모든 tool에는 side-effect metadata가 있어야 하며, destructive/network/filesystem write는 policy와 approval을 거친다.
- Figma write는 session별 single-writer queue를 통과한다.
- 같은 operation ID의 concurrent replay는 같은 in-flight Promise를 공유한다.
- plugin restart나 timeout 뒤 write 결과를 알 수 없으면 자동 재실행하지 않고 <code>outcome-unknown</code>으로 기록한다.
- v0.1 canonical snapshot은 Figwright가 지원하는 field를 빠짐없이 보존하고 손실을 명시하는 loss-aware observed store다. Figma API 전체의 lossless IR이라는 주장은 후속 schema 확장 전까지 하지 않는다. LLM용 design context는 그 projection이다.
- Cloud model egress는 service core 밖의 명시적 boundary이며 local-only라고 마케팅하지 않는다.
- 세 MIT notices를 보존한다. figmosha Solar CC BY asset은 v0.1 UI에 복사하지 않고 provenance에 제외 사실을 기록한다.
- v0.1 완료 주장은 automated full gate와 실제 Figma Design acceptance 둘 다 통과해야 한다.

---

## 1. Full Vision과 v0.1 경계

### 1.1 Full Vision

Full product는 다음을 포함한다.

1. Figma→legacy source AST patch, build/test/render/visual diff.
2. code→Figma deterministic token/component/layout adapters.
3. Figma/code/base 3-way sync와 conflict UI.
4. React 이후 Vue/Svelte, 그 뒤 Angular/Solid/Next/Nuxt.
5. explicit artifact exchange, private/Web connector, official connector fallback.
6. optional Rust native packaging/export worker.
7. signed release/update channel과 organization deployment.
8. local/cloud model connector를 선택하는 egress policy.

### 1.2 v0.1에서 구현하는 것

- Standalone <code>service/</code> monorepo.
- Figwright 112 tools와 105 handlers parity.
- <code>export_tokens</code> 추가.
- Secure loopback Host/Origin gate, one-time pairing, follower RPC authentication.
- Protocol/product/capability/editor compatibility handshake.
- Tool side-effect metadata와 MCP annotations.
- Destructive/filesystem/network approval gate.
- Session별 write FIFO와 bounded read lane.
- In-flight+completed idempotency, operation journal, outcome-unknown.
- Workspace path sandbox와 atomic snapshot/export write.
- Figma Design Desktop plugin panel pairing/approval/context.
- Session-pinned component/token/icon grounding.
- File identity가 포함된 design diff namespace.
- <code>SnapshotV1</code>과 <code>GroundingGraphV1</code> local store.
- CLI <code>doctor</code>, <code>pair</code>, <code>status</code>, <code>compat</code>, <code>snapshot</code>, <code>tokens export</code>, 그리고 typed wrappers인 <code>sel/tree/find/text/variant</code>.
- Updated figma-codegen/figma-build skills.
- Package artifact license/provenance checks.
- Windows/macOS Figma Design live acceptance 1회 이상.

### 1.3 v0.1에서 명시적으로 미루는 것

- Source code 자동 patch.
- deterministic code→Figma compiler.
- 3-way automatic merge.
- Rust native launcher.
- multi-page PDF merge.
- Web/private/Community plugin.
- FigJam write support guarantee.
- Dev Mode write.
- remote image URL fetch.
- raw Plugin API script execution.
- SQLite; v0.1 store는 versioned canonical JSON + atomic rename이다.

v0.1에서도 기존 Figwright write tool로 agent가 code/spec→Figma를 수동 오케스트레이션할 수 있다. 다만 이를 deterministic compiler라고 부르지 않는다.

### 1.4 현실적 delivery 단위

- Milestone A, baseline parity: Task 1~2.
- Milestone B, secure execution plane: Task 3~6.
- Milestone C, grounding artifact와 CLI: Task 7~10.
- Milestone D, release gate: Task 11~12.

경험 있는 TypeScript/plugin 개발자 2명이 병렬 작업할 때 8~12주를 초기 추정 범위로 둔다. 실제 일정은 Task 1 parity와 Task 3 live pairing spike가 끝난 뒤 다시 산정한다. 한 명이 모든 task를 직렬 수행하는 일정은 이 범위보다 길며, Phase 2 기능을 v0.1에 당겨 넣지 않는다.

---

## 2. 고려한 접근과 선택

### Approach A — standalone Figwright vendor fork, 권장

Production package trees를 <code>service/</code>에 복제하고 package namespace를 <code>@sfp/*</code>로 바꾼다. 원본 commit과 copied path/hash를 <code>upstream-lock.json</code>에 기록한다.

<code>upstream-lock.json</code>은 <code>{schemaVersion:1, upstreams:{name:{commit, licenseFile, copied:[{source,destination,sha256}]}}}</code> 형태다. Hash는 copied 시점 upstream file bytes를 기록하며, service에서 수정된 file은 provenance 문서가 변경 목적을 별도로 적는다. Release artifact는 원본 checkout 없이도 lock과 vendored files를 검증할 수 있어야 한다.

- 장점: 112/105 기능과 tests를 최대 활용, standalone package, 한 protocol.
- 단점: 초기 vendoring diff가 크고 upstream sync 책임이 생김.
- 선택 이유: 사용자 요구인 세 OSS 기능 최대 활용과 현실적 v0.1 속도를 동시에 만족.

### Approach B — service가 code-kb/figwright source를 직접 import

- 장점: 초기 copy가 작음.
- 단점: 배포가 workspace layout에 묶이고 original reference와 production source 경계가 무너짐.
- 판정: 폐기.

### Approach C — Rust daemon + Node grounding sidecar

- 장점: native control plane.
- 단점: 두 runtime/schema/lifecycle, security를 두 번 구현, v0.1 범위 폭증.
- 판정: 후속 packaging ADR 뒤 재검토.

---

## 3. OSS 재사용 지도

### 3.1 Figwright: production baseline

| 원본 source | service destination | 사용 |
|---|---|---|
| <code>code-kb/figwright/packages/shared/src/*</code> | <code>service/packages/shared/src/*</code> | envelope, codec, heartbeat, budgets, version, design context schemas |
| <code>code-kb/figwright/packages/shared/test/*</code> | <code>service/packages/shared/test/*</code> | protocol/schema regression |
| <code>code-kb/figwright/packages/mcp/src/tools/*</code> | <code>service/packages/mcp/src/tools/*</code> | 112 ToolSpecs와 special handlers |
| <code>code-kb/figwright/packages/mcp/src/relay/*</code> | <code>service/packages/mcp/src/relay/*</code> | session routing/queue 기반 |
| <code>code-kb/figwright/packages/mcp/src/election/*</code> | <code>service/packages/mcp/src/election/*</code> | leader/follower/lifecycle |
| <code>code-kb/figwright/packages/mcp/src/join/*</code> | <code>service/packages/mcp/src/join/*</code> | component/token/icon matching |
| <code>code-kb/figwright/packages/mcp/src/profile/*</code> | <code>service/packages/mcp/src/profile/*</code> | project profile |
| <code>code-kb/figwright/packages/mcp/src/scan/*</code> | <code>service/packages/mcp/src/scan/*</code> | code component scan |
| <code>code-kb/figwright/packages/mcp/src/tokens/*</code> | <code>service/packages/mcp/src/tokens/*</code> | CSS/SCSS/Tailwind/Uno token loading |
| <code>code-kb/figwright/packages/mcp/src/icons/*</code> | <code>service/packages/mcp/src/icons/*</code> | repo SVG/icon library detection |
| <code>code-kb/figwright/packages/mcp/src/diff/*</code> | <code>service/packages/mcp/src/diff/*</code> | pure design diff |
| <code>code-kb/figwright/packages/mcp/src/prompts/*</code> | <code>service/packages/mcp/src/prompts/*</code> | MCP prompts |
| <code>code-kb/figwright/packages/mcp/src/index.ts</code> | <code>service/packages/mcp/src/index.ts</code> | MCP boot/registration, 중앙 executor로 수정 |
| <code>code-kb/figwright/packages/mcp/src/dispatch.ts</code> | <code>service/packages/mcp/src/dispatch.ts</code> | dispatch, 중앙 executor로 수정 |
| <code>code-kb/figwright/packages/mcp/src/local-access.ts</code> | <code>service/packages/mcp/src/security/local-access.ts</code> | Host/Origin defense, pairing과 결합 |
| <code>code-kb/figwright/packages/mcp/src/repo-walk.ts</code> | <code>service/packages/mcp/src/fs/repo-walk.ts</code> | sandbox-aware traversal로 수정 |
| <code>code-kb/figwright/packages/plugin/protocol/*</code> | <code>service/packages/plugin/protocol/*</code> | UI/sandbox contract |
| <code>code-kb/figwright/packages/plugin/src/*</code> | <code>service/packages/plugin/src/*</code> | sandbox, serializer, 105 handlers |
| <code>code-kb/figwright/packages/plugin/ui/*</code> | <code>service/packages/plugin/ui/*</code> | panel/activity/context/debug |
| <code>code-kb/figwright/packages/*/test/*</code> | 같은 package <code>test/*</code> | baseline regression |
| <code>code-kb/figwright/test/tool-registry.test.ts</code> | <code>service/test/tool-registry.test.ts</code> | cross-package parity |
| <code>code-kb/figwright/skills/figma-codegen/*</code> | <code>service/skills/figma-codegen/*</code> | design→code workflow |
| <code>code-kb/figwright/skills/figma-build/*</code> | <code>service/skills/figma-build/*</code> | code/spec→Figma workflow |

### 3.2 figma-mcp-rust: selected behavior, no server copy

| 원본 source | service destination | 사용 |
|---|---|---|
| <code>code-kb/figma-mcp-rust/plugin/src/read-styles.ts:181-267</code> | <code>service/packages/mcp/src/tools/export-tokens.ts</code> | deterministic JSON/CSS token export semantics |
| <code>code-kb/figma-mcp-rust/src/bridge.rs:27-29,280-301</code> | <code>service/packages/shared/src/progress.ts</code> | progress extends idle deadline, absolute cap 필수 |
| <code>code-kb/figma-mcp-rust/src/tools/special.rs:15-18,61-125</code> | <code>service/packages/mcp/src/execution/export-pool.ts</code> | bounded export concurrency concept |
| <code>code-kb/figma-mcp-rust/src/tools/definitions.rs</code> | <code>service/packages/cli/src/compat/rust-tool-map.ts</code> | lexical tool catalog/compat report fixture |
| <code>code-kb/figma-mcp-rust/prompts/*</code> | <code>service/skills/compat-rust-recipes/*</code> | schema 검증을 통과한 recipe만 선별 |

Rust bridge/election, partial serializer, unauthenticated endpoints, lexical path check는 copy하지 않는다.

### 3.3 figmosha2: UX behavior, no raw evaluator

| 원본 source | service destination | 사용 |
|---|---|---|
| <code>code-kb/figmosha2/figmosha.py:137-179</code> | <code>service/packages/cli/src/commands/doctor.ts</code> | 단계별 doctor UX |
| <code>code-kb/figmosha2/bridge.py:72-109</code> | <code>service/packages/shared/src/error-guidance.ts</code> | structured error→recovery catalog |
| <code>code-kb/figmosha2/plugin/code.js:52-79,96-200,233-315</code> | Figwright handler/CLI alias tests | hex/target/font/frame behavior test ideas |
| <code>code-kb/figmosha2/tests/helpers.test.js</code> | <code>service/packages/plugin/test/compat/figmosha-helper-behavior.test.ts</code> | 20 behavior assertions를 Vitest로 포팅 |
| <code>code-kb/figmosha2/bridge.py:119-174</code> | doctor liveness tests | incumbent ping concept, global implementation은 미사용 |

<code>new Function</code>, globals, Solar SVG는 copy하지 않는다.

---

## 4. 새 service 파일 구조

~~~text
service/
  .node-version
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
  vitest.config.ts
  knip.json
  .oxlintrc.json
  .oxfmtrc.json
  upstream-lock.json
  LICENSE
  THIRD_PARTY_NOTICES.md
  PROVENANCE.md
  README.md
  SECURITY.md
  docs/
    architecture.md
    capability-matrix.md
    pairing.md
    operation-policy.md
    snapshot-format.md
    desktop-acceptance.md
    compatibility.md
  licenses/
    figwright-LICENSE
    figma-mcp-rust-LICENSE
    figmosha2-LICENSE
  scripts/
    verify-upstream-lock.mjs
    verify-artifacts.mjs
    package-plugin.mjs
  packages/
    shared/
      package.json
      tsconfig.json
      vitest.config.ts
      src/
        index.ts
        auth.ts
        codec.ts
        compatibility.ts
        components.ts
        design-context.ts
        design-context-dedupe.ts
        envelope.ts
        error-guidance.ts
        heartbeat.ts
        operations.ts
        progress.ts
        protocol.ts
        queries.ts
        rpc.ts
        serialized-node.ts
        styles.ts
        tool-budgets.ts
        variables.ts
        version.ts
        writes.ts
      test/
    ir/
      package.json
      tsconfig.json
      vitest.config.ts
      src/
        index.ts
        canonical-json.ts
        fidelity.ts
        grounding-graph-v1.ts
        snapshot-v1.ts
        store.ts
      test/
        canonical-json.test.ts
        grounding-graph-v1.test.ts
        snapshot-v1.test.ts
        store.test.ts
    mcp/
      package.json
      tsconfig.json
      tsdown.config.ts
      vitest.config.ts
      src/
        index.ts
        dispatch.ts
        tool-invocation-service.ts
        lifecycle.ts
        node-id.ts
        ignored-dirs.ts
        build-id.ts
        instructions.ts
        security/
          local-access.ts
          pairing-manager.ts
          follower-auth.ts
          request-limits.ts
        policy/
          approval-gate.ts
          operation-policy.ts
          policy-engine.ts
        execution/
          operation-executor.ts
          operation-journal.ts
          session-queue.ts
          export-pool.ts
        fs/
          atomic-file.ts
          repo-walk.ts
          workspace-policy.ts
        control/
          diagnostics-endpoints.ts
          approval-endpoints.ts
          tool-call-endpoint.ts
        snapshot/
          capture-snapshot.ts
          build-grounding-graph.ts
        tools/
          all vendored Figwright tool files
          export-tokens.ts
        relay/
        election/
        join/
        profile/
        scan/
        tokens/
        icons/
        diff/
        prompts/
      test/
        security/
        policy/
        execution/
        fs/
        snapshot/
        tools/
        plus vendored Figwright tests
    plugin/
      package.json
      manifest.json
      tsconfig.json
      vite.config.ts
      vite.config.main.ts
      vitest.config.ts
      protocol/
      src/
        code.ts
        dispatcher.ts
        idempotency.ts
        panel.ts
        reveal.ts
        serializer.ts
        traverse.ts
        handlers/
      ui/
        App.vue
        main.ts
        style.css
        components/
          existing Figwright components
          TabApproval.vue
          TabPairing.vue
        composables/
          useApprovalQueue.ts
          usePairing.ts
          existing Figwright composables
        relay/
        sandbox/
      test/
        existing Figwright tests
        auth/
        approval/
        compat/
    cli/
      package.json
      tsconfig.json
      tsdown.config.ts
      vitest.config.ts
      src/
        index.ts
        client.ts
        output.ts
        commands/
          approve.ts
          compat.ts
          doctor.ts
          find.ts
          pair.ts
          sel.ts
          snapshot.ts
          status.ts
          text.ts
          tokens.ts
          tree.ts
          variant.ts
        compat/
          rust-tool-map.ts
      test/
        commands/
        fixtures/
  skills/
    figma-codegen/
    figma-build/
    compat-rust-recipes/
  test/
    artifact-contents.test.ts
    docs-sync.test.ts
    upstream-parity.test.ts
    tool-registry.test.ts
~~~

Workspace root에는 <code>.github/workflows/service-ci.yml</code>을 추가하고 모든 command의 working directory를 <code>service</code>로 고정한다.

### 4.1 Vendored 뒤 반드시 수정할 파일

| file | 변경 |
|---|---|
| <code>service/package.json</code> | @sfp workspace scripts, Node24/pnpm pin |
| 각 package <code>package.json</code> | <code>@figwright/*</code>→<code>@sfp/*</code>, publish/private 설정 |
| <code>service/packages/mcp/src/index.ts</code> | special handler 분기 대신 OperationExecutor 단일 pipeline |
| <code>service/packages/mcp/src/dispatch.ts</code> | session pin, authenticated follower, outcome unknown |
| <code>service/packages/mcp/src/tools/spec.ts</code> | operation policy reference |
| <code>service/packages/mcp/src/tools/registry.ts</code> | 112 parity + export_tokens |
| <code>service/packages/mcp/src/tools/annotations.ts</code> | effects 기반 MCP annotations |
| <code>service/packages/mcp/src/relay/relay.ts</code> | pairing ticket, queue ownership, flap unknown outcome |
| <code>service/packages/mcp/src/relay/session.ts</code> | authenticated capability/file/editor identity |
| <code>service/packages/mcp/src/election/leader-endpoints.ts</code> | body cap, follower token, control endpoints |
| <code>service/packages/mcp/src/election/leader-lock.ts</code> | rpc token, file mode, identity |
| <code>service/packages/mcp/src/tools/token-map.ts</code> | variable/style dispatch 같은 session pin |
| <code>service/packages/mcp/src/tools/design-diff.ts</code> | file identity namespace + atomic store |
| <code>service/packages/plugin/manifest.json</code> | local domains only, remote image URL disabled |
| <code>service/packages/plugin/ui/relay/client.ts</code> | pairing ticket/capability handshake |
| <code>service/packages/plugin/src/idempotency.ts</code> | in-flight Promise dedupe |
| <code>service/packages/plugin/src/dispatcher.ts</code> | editor capability/preflight/error codes |
| <code>service/skills/figma-build/SKILL.md</code> | scan_components는 code AST, Figma reuse는 get_local_components로 수정 |
| <code>service/skills/figma-codegen/SKILL.md</code> | new snapshot/compat/export_tokens workflow |

---

## 5. 핵심 interface

### 5.1 Side-effect metadata

~~~ts
export type Effect =
  | { type: 'figma-read' }
  | { type: 'figma-write'; destructive: boolean }
  | { type: 'filesystem-read'; pathArgs: readonly string[] }
  | { type: 'filesystem-write'; pathArgs: readonly string[]; destructive: boolean }
  | { type: 'network'; urlArg: string };

export interface OperationPolicy {
  toolName: string;
  effects: readonly Effect[];
  idempotency: 'safe-retry' | 'operation-id' | 'never-auto-retry';
  approval: 'none' | 'client' | 'explicit-user';
  concurrency: 'parallel-read' | 'session-write' | 'exclusive-heavy';
}
~~~

113 tool names 모두 <code>OPERATION_POLICIES</code>에 정확히 한 entry를 가져야 한다. Existing filesystem writers와 <code>design_diff</code>는 read-only로 광고하지 않는다. <code>import_image.url</code>은 v0.1에서 policy rejection이고 data input만 허용한다.

### 5.2 Pairing과 compatibility

~~~ts
export interface PairingChallenge {
  challengeId: string;
  codeHash: string;
  expiresAt: number;
  attemptsRemaining: number;
}

export interface HelloCapabilities {
  protocolVersion: string;
  productVersion: string;
  pluginVersion: string;
  editorType: 'figma' | 'figjam' | 'dev';
  mode: string;
  fileKey: string | null;
  fileName: string;
  capabilities: readonly string[];
}
~~~

Pair code는 128-bit random base32, one-time, 5분 expiry다. Pair success는 30초 one-use WebSocket ticket을 반환한다. Ticket은 URL/log에서 redact하고 live session token으로 교환한다. Follower RPC token과 plugin token은 별도다.

### 5.3 Operation executor

~~~ts
export type OperationStatus =
  | 'pending-approval'
  | 'queued'
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'outcome-unknown';

export interface OperationRecord {
  operationId: string;
  toolName: string;
  sessionId: string | null;
  status: OperationStatus;
  argsHash: string;
  createdAt: string;
  settledAt?: string;
  errorCode?: string;
}

export interface OperationExecutor {
  execute(
    input: {
      operationId: string;
      toolName: string;
      args: Record<string, unknown>;
      sessionId: string | null;
      pluginGeneration: string | null;
    },
    run: () => Promise<unknown>
  ): Promise<unknown>;
  status(operationId: string): OperationRecord | undefined;
}

export interface ToolInvocationService {
  invoke(
    source: 'mcp' | 'cli-control' | 'follower',
    toolName: string,
    rawArgs: unknown,
    operationId?: string
  ): Promise<unknown>;
}
~~~

MCP handler와 authenticated CLI control endpoint는 모두 <code>ToolInvocationService</code> 하나를 사용한다. 같은 operationId가 in-flight면 동일 Promise를 반환한다. Plugin session이 바뀌거나 dispatched write가 disconnect되면 자동 replay하지 않고 <code>outcome-unknown</code>이다.

Daemon journal은 <code>{workspace}/.sfp/journal/operations.v1.jsonl</code>에 status transition을 append하고 각 append를 fsync한다. 완료 record는 주기적으로 checksum이 있는 compact snapshot으로 줄이되, v0.1은 10,000 records를 hard cap으로 두고 오래된 settled record만 compact한다. Pending/dispatched/unknown record는 자동 삭제하지 않는다.

### 5.4 Workspace sandbox

~~~ts
export interface WorkspacePolicy {
  roots: readonly string[];
  resolveRead(input: string): Promise<string>;
  resolveWrite(input: string): Promise<string>;
  assertWithinRoot(path: string): Promise<void>;
}
~~~

Existing path는 realpath를 검사한다. New output은 nearest existing parent를 realpath하고 symlink/reparse segment를 거부한다. Default export/snapshot 위치는 <code>{root}/.sfp</code>다.

### 5.5 Snapshot과 grounding graph

~~~ts
export interface SnapshotV1 {
  schemaVersion: 1;
  snapshotId: string;
  connector: {
    protocolVersion: string;
    productVersion: string;
    sessionId: string;
    fileKey: string | null;
    fileName: string;
    editorType: string;
  };
  target: { nodeIds: string[] };
  observed: GetDesignContextResult;
  fidelity: {
    detail: 'full';
    truncated: boolean;
    omitted: string[];
    unsupported: string[];
  };
  capturedAt: string;
  contentHash: string;
  extensions: Record<string, unknown>;
}

export interface GroundingEdgeV1 {
  edgeId: string;
  kind: 'component' | 'token' | 'icon';
  figmaRef: string;
  codeRef: string;
  confidence: number;
  evidence: readonly string[];
  verified: boolean;
  snapshotId: string;
}
~~~

Canonical JSON은 key sort, stable number encoding, UTF-8 SHA-256을 사용한다. Inference는 observed payload 안에 섞지 않고 edge evidence로 저장한다. Store path는 file identity hash로 namespace한다.

### 5.6 export_tokens

~~~ts
export interface ExportTokensArgs {
  format: 'json' | 'css';
  outPath?: string;
}

export interface ExportTokensResult {
  format: 'json' | 'css';
  content?: string;
  path?: string;
  tokenCount: number;
  warnings: string[];
}
~~~

No outPath는 runtime policy상 read-only text result다. outPath가 있으면 filesystem-write approval와 sandbox를 통과한다. MCP annotation은 argument에 따라 바뀔 수 없으므로 이 tool을 보수적으로 <code>readOnlyHint:false</code>로 광고하고, 실제 approval 여부만 runtime policy가 결정한다. Variables와 styles는 같은 pinned Figma session에서 읽는다.

---

## 6. Dependency·build·test 기준

### 6.1 Runtime/dependencies

| package | dependency |
|---|---|
| root | Node v24.17.0, pnpm 11.24.0, TypeScript ^6.0.3, Vitest ^4.1.11, oxlint ^1.80, oxfmt ^0.65, knip ^6.32 |
| shared | Zod ^4.4.3, @msgpack/msgpack ^3.1.3 |
| ir | Zod ^4.4.3; Node crypto/fs만 사용 |
| mcp | @modelcontextprotocol/server ^2.0.0, ws ^8.21.3, fdir ^6.5.0, ignore ^7.0.6, oxc-parser ^0.147.0, shared/ir workspace |
| plugin runtime | Vue ^3.5.41, @vueuse/core ^14.4.0, @lucide/vue ^1.34.0, Zod ^4.4.3 |
| plugin build/test | Vite ^8.2.2, Tailwind ^4.3.3, Vue Test Utils ^2.4.11, happy-dom ^20.11.6 |
| cli | shared workspace와 Node stdlib만 사용; command parser는 <code>node:util.parseArgs</code> |

v0.1에는 SQLite/PDF/Rust dependency를 추가하지 않는다.

### 6.2 Root scripts

~~~json
{
  "build": "pnpm -r run build",
  "typecheck": "pnpm -r run typecheck",
  "lint": "oxlint --deny-warnings .",
  "format:check": "oxfmt --check .",
  "knip": "knip",
  "test": "vitest run",
  "test:unit": "vitest run --exclude '**/test/e2e/**'",
  "test:e2e": "vitest run packages/mcp/test/e2e",
  "test:artifacts": "vitest run test/artifact-contents.test.ts",
  "desktop:acceptance": "node scripts/desktop-acceptance.mjs",
  "verify": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test"
}
~~~

### 6.3 개발 시작

~~~powershell
corepack enable
pnpm -C service install
pnpm -C service verify
~~~

Lockfile 생성 뒤 CI와 release는 <code>pnpm install --frozen-lockfile</code>만 사용한다.

---

## 7. Task dependency graph

~~~text
Task 1 baseline
  └─ Task 2 policy metadata
       ├─ Task 3 pairing/follower auth
       ├─ Task 4 operation executor
       └─ Task 5 workspace sandbox
Task 3 + 4 ── Task 6 Desktop plugin
Task 4 + 5 + 6 ── Task 7 grounding fixes
Task 7 ── Task 8 snapshot/graph
Task 5 + 7 ── Task 9 export_tokens
Task 3 + 8 + 9 ── Task 10 CLI doctor/compat
Task 1..10 ── Task 11 packaging/docs/license
Task 11 ── Task 12 live acceptance
~~~

---

## 8. Task별 TDD plan

### Task 1 — Standalone workspace와 upstream parity

**Files**

- Create all root/package files in section 4.
- Create <code>service/upstream-lock.json</code>.
- Create <code>service/test/upstream-parity.test.ts</code>.
- Materialize the Figwright source/test trees listed in section 3.1.
- Modify all package names/imports from <code>@figwright/*</code> to <code>@sfp/*</code>.
- Do not create imports containing <code>code-kb/</code>.

**RED**

~~~powershell
pnpm -C service exec vitest run test/upstream-parity.test.ts
~~~

Expected failure before vendoring: <code>Cannot resolve @sfp/mcp tool registry</code>.

Test cases:

- upstream lock has exact commits <code>6094566436577b29d04393c774d51492c12671e1</code>, <code>547cefb4c90abaa1da68db5455b921cbf3f8a5b9</code>, <code>a835e81b575eab2c9265a67f9353c89b848f81ca</code>.
- baseline registry has 112 unique Figwright names.
- plugin registry has 105 unique handlers and expected 7 no-same-name exceptions.
- every production import resolves under <code>service/</code>.
- text scan finds zero <code>code-kb/</code> imports.
- original repo Git status remains clean.

**GREEN**

~~~powershell
pnpm -C service exec vitest run test/upstream-parity.test.ts
pnpm -C service typecheck
~~~

Expected: all parity cases pass; typecheck exit 0.

**Commit:** <code>chore(service): vendor standalone figwright baseline with provenance</code>.

### Task 2 — Side-effect metadata와 approval classification

**Files**

- Create <code>service/packages/shared/src/operations.ts</code>.
- Create <code>service/packages/mcp/src/policy/operation-policy.ts</code>.
- Create <code>service/packages/mcp/src/policy/policy-engine.ts</code>.
- Modify <code>service/packages/mcp/src/tools/spec.ts</code>.
- Modify <code>service/packages/mcp/src/tools/annotations.ts</code>.
- Modify <code>service/packages/mcp/src/tools/registry.ts</code>.
- Create <code>service/packages/mcp/test/policy/operation-policy.test.ts</code>.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/policy/operation-policy.test.ts
~~~

Expected failure: <code>operation policy missing for ping</code> 또는 첫 registry name.

Required cases:

- exactly 112 baseline names have one policy.
- 79 Figwright write tools include <code>figma-write</code>.
- 11 destructive names set destructive true and explicit-user approval.
- save_screenshots, save_image_fills, export_pdf, export_video, design_diff are filesystem-write and not readOnly.
- analyze_project, scan_components, component_map, token_map, icon_map are filesystem-read.
- import_image is conditional network when url exists.
- MCP annotations match policy.
- no policy defaults silently from tool kind.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/policy/operation-policy.test.ts
pnpm -C service exec vitest run test/tool-registry.test.ts
~~~

Expected: exact policy coverage and registry tests pass.

**Commit:** <code>feat(policy): classify every tool side effect and approval requirement</code>.

### Task 3 — Secure pairing, strict local access, authenticated follower RPC

**Files**

- Create <code>shared/src/auth.ts</code>, <code>shared/src/compatibility.ts</code>.
- Create <code>mcp/src/security/pairing-manager.ts</code>, <code>follower-auth.ts</code>, <code>request-limits.ts</code>.
- Move/modify <code>mcp/src/security/local-access.ts</code>.
- Modify <code>mcp/src/election/leader-endpoints.ts</code>, <code>leader-lock.ts</code>, <code>follower.ts</code>.
- Modify <code>mcp/src/relay/relay.ts</code>.
- Create tests under <code>mcp/test/security/</code>.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/security
~~~

Expected failures before implementation:

- WebSocket without ticket is accepted.
- Origin null with no pairing can create a session.
- follower RPC without bearer token is accepted.
- oversized body has no deterministic 413.
- any WebSocket path upgrades.

Required cases:

- Host mismatch 403.
- hostile browser Origin 403.
- null Origin alone is insufficient.
- 128-bit one-time code exchanges once, expires at 5 minutes, attempt limit enforced.
- wrong/used code rejected.
- one-use 30-second ticket opens only <code>/ws</code>.
- session hello validates protocol/product/plugin/editor capabilities.
- follower token required on <code>/rpc</code> and <code>/abdicate</code>.
- control token required on every <code>/control/*</code> endpoint; <code>/control/tools/call</code> proves it invokes the same schema/policy/executor pipeline as MCP.
- <code>/ping</code> body has product magic and strict version; foreign 2xx is not leader.
- Unknown role fails fast and never POSTs tool args.
- JSON/MessagePack body cap returns 413 before allocation exceeds configured limit.
- MCP import_image data는 decoded 6 MiB/base64 8 MiB를 넘으면 plugin dispatch 전에 거부한다.
- logs redact code/ticket/token.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/security
pnpm -C service exec vitest run packages/mcp/test/election packages/mcp/test/relay
~~~

Expected: security and adapted election/relay suites pass.

**Commit:** <code>feat(security): require local pairing and authenticated leader traffic</code>.

### Task 4 — Operation executor, write queue, approval, idempotency

**Files**

- Create <code>mcp/src/execution/session-queue.ts</code>.
- Create <code>mcp/src/execution/operation-journal.ts</code>.
- Create <code>mcp/src/execution/operation-executor.ts</code>.
- Create <code>mcp/src/tool-invocation-service.ts</code>.
- Create <code>mcp/src/policy/approval-gate.ts</code>.
- Create control approval endpoints.
- Modify <code>mcp/src/index.ts</code>, <code>dispatch.ts</code>.
- Modify <code>plugin/src/idempotency.ts</code>.
- Add tests under <code>mcp/test/execution</code> and <code>plugin/test/idempotency.test.ts</code>.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/execution packages/plugin/test/idempotency.test.ts
~~~

Expected failures:

- two concurrent same operation IDs call handler twice.
- two writes on one session overlap.
- dispatched write reconnect is retried or only times out without unknown status.
- destructive call executes without approval.

Required cases:

- same in-flight ID returns identical Promise/result and applies once.
- completed same ID replays cached result.
- different IDs execute separately.
- one session writes FIFO; different sessions may progress independently.
- reads run up to configured four only when no write is active; a write is exclusive against reads and writes on that session; exclusive-heavy runs alone.
- approval rejection never dispatches.
- approval timeout returns typed error.
- explicit-user approval with neither paired plugin UI nor authenticated CLI waiter returns <code>APPROVAL_CHANNEL_UNAVAILABLE</code>; it never falls back to allow.
- socket flap before dispatch requeues; after dispatch marks outcome-unknown and never auto-replays.
- journal records queued/dispatched/settled and survives daemon restart for status reads.
- plugin restart invalidates completed cache generation.
- undo failure/partial result stays explicit.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/execution packages/plugin/test/idempotency.test.ts
pnpm -C service exec vitest run packages/mcp/test/dispatch.test.ts
~~~

Expected: exactly-once-within-session cases and unknown-outcome cases pass.

**Commit:** <code>feat(execution): serialize writes and journal idempotent operations</code>.

### Task 5 — Workspace path sandbox와 atomic file adapter

**Files**

- Create <code>mcp/src/fs/workspace-policy.ts</code>, <code>atomic-file.ts</code>.
- Modify <code>mcp/src/fs/repo-walk.ts</code>.
- Modify analyze/scan/map/diff/save/export local tools to depend on injected <code>WorkspacePolicy</code> and <code>AtomicFileStore</code>.
- Create <code>mcp/test/fs/workspace-policy.test.ts</code>, <code>local-tool-boundary.test.ts</code>.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/fs
~~~

Expected failures:

- absolute outside root resolves.
- symlink under root escapes.
- non-existing output with escaped parent succeeds.
- local tool directly writes without adapter.

Required cases:

- inside-root read/write accepted.
- <code>..</code>, alternate separators, case-folded Windows escape rejected.
- existing symlink/junction escape rejected.
- nearest existing parent check protects new files.
- default writes land under <code>.sfp/exports</code> or <code>.sfp/snapshots</code>.
- atomic temp+fsync+rename leaves old file on failure.
- structural source scan finds no direct filesystem mutation in local tools outside adapters.
- repo walk returns scanned/skipped/truncated counts.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/fs
pnpm -C service exec vitest run packages/mcp/test/tools
~~~

Expected: filesystem boundary and local tool suites pass on Windows and Linux CI.

**Commit:** <code>feat(fs): confine all local reads and writes to approved workspaces</code>.

### Task 6 — Desktop plugin pairing, approvals, capabilities, full handler parity

**Files**

- Modify plugin manifest, relay client, App, dispatcher, code entry.
- Create TabPairing/TabApproval, composables, auth tests.
- Preserve all 105 handler keys.
- Add editor capability table.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/plugin/test/auth packages/plugin/test/approval packages/plugin/test/protocol
~~~

Expected failures:

- plugin connects without code.
- pairing state not rendered.
- approval event cannot settle gate.
- Dev Mode write reaches handler.
- import_image URL proceeds.

Required cases:

- unpaired/wrong/expired/pairing/connected UI states.
- secret/ticket never appears in diagnostic bundle.
- approval summary redacts text/base64 and shows tool/effects/target count.
- approve/reject settles exact approval ID once.
- editor capability preflight rejects Dev write with actionable message.
- FigJam unsupported component/style/variable/Motion calls report capability error.
- Figma Design read/write capability advertised.
- remote image URL disabled; base64 data retained.
- handler registry remains 105 and server-dispatched parity passes.
- plugin in-flight idempotency shares Promise.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/plugin/test
pnpm -C service exec vitest run test/tool-registry.test.ts
pnpm -C service build
~~~

Expected: plugin tests, parity and Vite builds pass.

**Commit:** <code>feat(plugin): add paired Desktop session and approval panel</code>.

### Task 7 — Grounding/session correctness fixes

**Files**

- Modify <code>mcp/src/tools/token-map.ts</code> to use one routed dispatcher for variables and styles.
- Modify component/icon map to use common session resolver.
- Modify <code>mcp/src/tools/design-diff.ts</code> with file identity.
- Modify relay flap handling.
- Add grounding routing and collision tests.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/tools/grounding-session.test.ts packages/mcp/test/tools/design-diff-file-identity.test.ts
~~~

Expected failures:

- token_map variables/styles can originate from two fake sessions.
- same nodeId in two file identities shares snapshot path.
- dispatched request survives reconnect as unreachable timeout instead of unknown outcome.

Required cases:

- token/component/icon multi-call operations pin one session.
- session disappearance fails rather than reroutes.
- file identity namespace includes fileKey when available, otherwise session-bound fileName hash.
- same nodeId across files has different snapshot path.
- old baseline with no file identity migrates only by explicit CLI command.
- relay flap settles operation outcome correctly.
- component discovery result says remoteLibraryDiscovery false when unavailable.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/tools/grounding-session.test.ts packages/mcp/test/tools/design-diff-file-identity.test.ts packages/mcp/test/relay
~~~

Expected: session mixing/collision regression tests pass.

**Commit:** <code>fix(grounding): pin multi-call reads and namespace design baselines</code>.

### Task 8 — SnapshotV1와 GroundingGraphV1

**Files**

- Create all <code>packages/ir</code> source/tests.
- Create MCP snapshot capture/graph builder.
- Add control/MCP handlers or CLI client functions for capture and graph.
- Add schemas to shared result validation.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/ir/test packages/mcp/test/snapshot
~~~

Expected failures: SnapshotV1/GroundingGraph schemas and store are missing.

Required cases:

- canonical JSON hash is independent of object key order.
- changed observed value changes hash.
- mixed/unset/unsupported/omitted are distinguishable.
- snapshot validates session/file/editor identity.
- store path cannot collide across files.
- atomic write and checksum corruption detection.
- graph has component/token/icon edges with evidence/confidence/snapshotId.
- verified edge outranks fuzzy edge.
- stale code path/token ref is reported, not silently retained.
- budgeted MCP projection does not mutate persisted full observed snapshot.
- no inference is written inside observed payload.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/ir/test packages/mcp/test/snapshot
pnpm -C service typecheck
~~~

Expected: IR schemas/store/graph pass.

**Commit:** <code>feat(ir): persist versioned design snapshots and grounding graph</code>.

### Task 9 — export_tokens와 progress contract

**Files**

- Create <code>mcp/src/tools/export-tokens.ts</code>.
- Create <code>shared/src/progress.ts</code>.
- Modify registry, special handlers, operation policies.
- Add golden tests.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/tools/export-tokens.test.ts packages/shared/test/progress.test.ts test/tool-registry.test.ts
~~~

Expected failures:

- export_tokens absent; registry remains 112.
- progress has no absolute deadline.

Required cases:

- registry is 113 unique tools.
- JSON preserves collection/mode/value/alias information.
- CSS emits deterministic sanitized names and collision warnings.
- variables/styles come from one pinned session.
- no outPath returns content without runtime approval; static MCP annotation remains conservatively readOnly=false.
- outPath requires sandbox+approval and returns path without duplicating content.
- write is atomic.
- progress extends idle deadline but cannot exceed absolute max/cancel.
- old Rust prompt call shape gets explicit compatibility guidance.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/mcp/test/tools/export-tokens.test.ts packages/shared/test/progress.test.ts test/tool-registry.test.ts
~~~

Expected: 113 tool registry and golden exports pass.

**Commit:** <code>feat(tokens): add deterministic compatible token export</code>.

### Task 10 — CLI doctor, pair, compat, snapshot, token export, target wrappers

**Files**

- Create all <code>packages/cli</code> files.
- Create fake control server fixtures and command tests.
- Add root bin packaging.
- Implement an authenticated local control client. <code>/control/tools/call</code>은 MCP handler와 동일한 ToolSpec parse, PolicyEngine, OperationExecutor를 호출한다. CLI가 follower <code>/rpc</code>를 직접 호출하거나 별도 mutation implementation을 갖는 경로는 만들지 않는다. Daemon/MCP가 실행 중이 아니면 CLI는 새 ephemeral leader를 숨겨 시작하지 않고 명시적으로 unavailable을 반환한다.

**RED**

~~~powershell
pnpm -C service exec vitest run packages/cli/test
~~~

Expected failure: CLI modules/commands missing.

Required cases:

- doctor reports daemon absent, foreign service, pairing required, plugin absent, version skew, editor read-only, no workspace, healthy roundtrip in order.
- status validates product magic/protocol, not mere HTTP 200.
- pair prints code only to terminal, JSON mode redacts secret after exchange.
- compat reports daemon/plugin/protocol/capabilities and 73 Rust names as same/adapter/incompatible.
- compat states official limit docs are external/current, with no baked stale numeric constant.
- snapshot capture returns snapshot ID/path/hash.
- tokens export prints content or approved path.
- sel/tree/find use get_selection/get_design_context/search_nodes and never raw JavaScript.
- text/variant resolve <code>sel</code>/<code>page</code> aliases through typed reads, then call set_text/set_instance_properties through the same OperationExecutor and approval policy.
- CLI exit codes: healthy 0, degraded 1, unreachable/config 2.
- Unicode/CJK output and Windows paths.
- no raw exec command exists.

**GREEN**

~~~powershell
pnpm -C service exec vitest run packages/cli/test
pnpm -C service --filter @sfp/cli build
node service/packages/cli/dist/index.mjs --help
~~~

Expected: CLI tests/build/help pass with documented commands.

**Commit:** <code>feat(cli): add doctor compatibility snapshots and token export</code>.

### Task 11 — Skills, docs, CI, artifacts, license/provenance

**Files**

- Create docs/licenses/provenance/security files from section 4.
- Modify copied skills.
- Create scripts and root artifact/docs tests.
- Create workspace-root <code>.github/workflows/service-ci.yml</code> with <code>working-directory: service</code>. If <code>service/</code> is later extracted, move the same workflow to its repository root without changing commands.

**RED**

~~~powershell
pnpm -C service exec vitest run test/docs-sync.test.ts test/artifact-contents.test.ts test/upstream-parity.test.ts
~~~

Expected failures:

- plugin zip/npm pack omit licenses/notices.
- skill still calls scan_components as Figma component discovery.
- docs claim Web/public or local-only AI.
- upstream provenance file absent/incomplete.

Required cases:

- package/zip includes service LICENSE, three upstream MIT files, THIRD_PARTY_NOTICES, PROVENANCE.
- Solar CC BY code/assets are absent; if later included, attribution entry becomes mandatory.
- all actions in workflow template use immutable SHA.
- frozen install, type/lint/format/knip/build/test on Ubuntu+Windows.
- built-dist E2E never silently skips in CI.
- tool count 113/docs sync.
- capability matrix says Desktop Design v0.1; Dev read-only; FigJam partial/uncommitted; Web deferred.
- model egress wording is accurate.
- cost appendix states the 2026-08-27 official MCP Starter baseline as 6 calls/month, marks some official write tools exempt, and links a separate REST tier table; source scan rejects stale <code>20/month</code> wording and no rate value is compiled into runtime policy.
- skills use get_local_components for Figma reuse and scan_components for code AST.
- upstream-lock hashes and original repo clean states verify.

**GREEN**

~~~powershell
pnpm -C service verify
pnpm -C service test:artifacts
node service/scripts/verify-upstream-lock.mjs
~~~

Expected: full automated gate and artifact inspection pass.

**Commit:** <code>docs(release): add verified capabilities provenance and license artifacts</code>.

### Task 12 — Desktop live acceptance

**Files**

- Create <code>service/docs/desktop-acceptance.md</code>.
- Create <code>service/scripts/desktop-acceptance.mjs</code>.
- Add a non-secret local fixture description; do not commit Figma file data.

**RED**

~~~powershell
pnpm -C service desktop:acceptance -- --require-live
~~~

Expected failure before a paired plugin: <code>PLUGIN_NOT_CONNECTED</code> with pairing/run instructions.

Live GREEN sequence:

1. Start daemon/MCP and run <code>sfp doctor</code>.
2. Enter pairing code in Desktop plugin.
3. Select acceptance frame.
4. Verify ping, get_selection, get_design_context full, component/token/icon grounding.
5. Capture SnapshotV1 and GroundingGraphV1.
6. Run export_tokens JSON and CSS inside sandbox root.
7. Issue two concurrent same-ID create_text requests; only one node is created.
8. Issue ordered create_frame→set_auto_layout→create_text writes and verify order/post-state.
9. Reject one destructive operation and verify no mutation.
10. Approve a disposable-node delete and verify audit/undo boundary.
11. Restart socket during a dispatched disposable write; result must be outcome-unknown and not auto-replayed.
12. Attempt outside-root write and remote image URL; both rejected.
13. Run doctor again and export redacted diagnostic bundle.

**GREEN**

~~~powershell
pnpm -C service desktop:acceptance -- --require-live
pnpm -C service verify
~~~

Expected: live acceptance reports all checks PASS and full automated gate remains green.

Run once on Windows Desktop and once on macOS Desktop before v0.1 release. Dev Mode negative write and FigJam capability checks may be recorded as manual non-blocking evidence; Figma Design is the release gate.

**Commit:** <code>test(acceptance): prove secure Desktop round trip</code>.

---

## 9. v0.1 Definition of Done

### Functional

- Standalone <code>service/</code> builds without <code>code-kb</code> imports.
- 113 tools advertised: Figwright 112 + export_tokens.
- 105 plugin handlers remain exactly synchronized with same-name dispatch exceptions.
- Figma Design selection/context/screenshot/grounding and typed writes work live.
- doctor, compat, snapshot, token export CLI work.
- SnapshotV1/GroundingGraphV1 persist under workspace <code>.sfp</code>.
- Existing figma-codegen/figma-build workflows reference correct discovery tools.

### Security

- No non-loopback bind.
- Host/Origin gate and pairing required; null Origin alone is insufficient.
- Follower RPC authenticated and foreign 2xx is not leader.
- Every tool has explicit side-effect metadata.
- Destructive/filesystem/network actions require explicit approval.
- All filesystem paths are workspace confined with symlink/reparse checks.
- Per-session writes are FIFO.
- Concurrent same-ID applies once.
- Post-dispatch flap yields outcome-unknown, never blind replay.
- No raw JS and remote image URL disabled.

### Quality

- typecheck, lint, format check, knip, build, unit/integration/E2E all pass.
- CI Windows+Ubuntu passes.
- Actual Windows and macOS Figma Design acceptance recorded.
- No built-dist E2E skip in release gate.
- Tool/docs/handler/policy contract exact tests pass.
- Original three repos remain clean and hash-verified.

### Legal/docs

- Service and three upstream MIT notices are in source/npm/plugin zip.
- THIRD_PARTY_NOTICES and PROVENANCE are present.
- Solar CC BY asset is not copied in v0.1.
- Capability/policy docs do not claim Web/public approval, view-only bypass, or local-only AI.
- README states REST/official MCP endpoints are not used, while Figma account/edit/plugin/policy and model-provider costs remain.

---

## 10. Post-v0.1 Phases

### v0.2 — Figma→React legacy code MVP

- React + Tailwind/CSS Modules only.
- AST-aware source diff in isolated worktree.
- build/test/render/visual diff.
- quantitative component/token/icon mapping metrics.
- no automatic merge without approval.

### v0.3 — Code→Figma semantic foundation

- code tokens/styles/assets→Figma first.
- React component instance/property mapping second.
- staging page + durable saga + post-read.
- layout/screens after token/component round-trip stabilizes.

### v0.4 — 3-way sync

- Git tree + Figma snapshot dual baseline.
- text/token/rename high-confidence merge.
- structure/layout/interaction manual conflicts.
- mapping store team export/import and migration.

### v0.5 — Distribution and optional native components

- Explicit artifact exchange.
- Official connector fallback.
- Private/Web only after policy and browser acceptance.
- Rust packaging ADR; launcher/export worker only if measured need.
- multi-page PDF merge after real fixture tests.

---

## 11. Main plan에 넘길 핵심 결정

1. **Fork strategy:** standalone vendor under <code>service/</code>, no runtime import of code-kb.
2. **v0.1 breadth:** Figwright full 112/105 parity를 보존하고 export_tokens를 추가.
3. **v0.1 product:** secure Desktop execution/grounding service, compiler가 아님.
4. **Security first:** pairing, Host/Origin, authenticated follower, policy, approval, queue, idempotency, sandbox가 tool feature보다 먼저.
5. **State model:** loss-aware SnapshotV1 + evidence-based GroundingGraphV1; MCP context는 projection.
6. **OSS use:** Figwright code authority, Rust export/progress concepts, figmosha doctor/helper UX.
7. **Compatibility:** canonical Figwright schemas 유지; Rust same-name calls는 adapter report이지 implicit compatibility가 아님.
8. **Distribution:** Node24/pnpm v0.1; Rust launcher deferred until packaging ADR.
9. **Policy:** Desktop internal first; public live bridge는 explicit approval 전 비목표.
10. **Completion:** automated gates만으로 끝내지 않고 actual Figma Design acceptance 필수.
