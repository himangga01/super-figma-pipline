# Agent C 독립 리뷰 — Super Figma Pipeline v0.1 구현 계획

> 리뷰 대상: `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md` 최신본 1,423줄  
> Binding spec: `docs/code-kb-analysis/05-unified-service-proposal.md`  
> 교차 근거: `04-detailed-comparison.md`, `reviews/agent-a-capability-union-input.md`, `reviews/agent-c-implementation-plan-input.md`, `code-kb/figwright` @ `a835e81b575eab2c9265a67f9353c89b848f81ca`  
> 원칙: 계획과 원본 저장소는 수정하지 않고, 실행 가능성·contract·dependency·TDD·release gate만 심사

## 1. 종합 판정

**116 tools/106 plugin handlers로 확장하는 제품 결정과 산술은 타당하지만, 최신 계획은 아직 그대로 실행하면 안 된다.** 방향은 binding spec과 잘 맞는다. Figwright 112/105를 버리지 않고 Motion 7개, `export_video`, URL 기반 `import_image`를 capability/policy 아래 보존하며 Rust 고유 export 2개와 figmosha 고유 기능 2개를 추가한 것은 “세 OSS 기능 최대 활용” 요구를 이전 113-tool 입력안보다 더 충실히 반영한다.

그러나 다음 다섯 항목은 구현 시작 전 반드시 고쳐야 하는 실행 차단점이다.

1. Task 6이 `import_library_variable` handler 106을 먼저 추가하고 Task 9가 나중에 ToolSpec을 추가하므로, Task 6 GREEN의 원본 exact parity test는 반드시 실패한다.
2. `export_frames_to_pdf`는 PDF merge가 필요한데 계획은 PDF dependency를 금지하면서 “기존 PDF engine에 delegate”한다고만 적었다. Figwright의 기존 engine은 명시적으로 single-page이며 merge할 수 없다.
3. source ledger의 114행, canonical registry 116행, artifact의 “116-tool union manifest”가 서로 다른 cardinality를 같은 manifest 이름으로 사용한다. 입력 ledger의 Motion/video `deferred`와 최신 계획의 `experimental but registered`도 충돌한다.
4. binding spec은 per-file queue를 요구하지만 계획의 key와 executor input은 session만 가진다. 같은 fileKey를 연 두 session의 write가 병렬 실행될 수 있다.
5. URL import를 보존한다고 했지만 SSRF/redirect/DNS/size를 실제로 강제할 server-side network adapter가 파일 구조와 task에 없다. 기존 plugin `createImageAsync(url)`와 wildcard manifest를 그대로 두면 “HTTPS/domain/size policy”는 검증 가능한 보안 통제가 아니다.

또한 12개 Task 모두 4개 checkbox는 갖췄지만, 구현 step 12개가 모두 동일한 “Implement only the files and interfaces required” 한 줄이고 Task별 `Interfaces: Consumes/Produces`가 0개다. 선언한 `superpowers:writing-plans` 실행 형식의 완결된 plan이라기보다 강한 설계 초안에 가깝다. 아래 Critical과 Important를 수정한 뒤에만 Task 1 실행을 권고한다.

## 2. 먼저 확인된 수량과 변경의 타당성

### 2.1 116/106 산술

원본 authority는 `code-kb/figwright/packages/mcp/src/tools/registry.ts:120-239`, `packages/plugin/src/handlers/registry.ts:116-240`, `test/tool-registry.test.ts:14-68`이다.

| 구성 | MCP tool 증가 | plugin handler 증가 | server-only 증가 |
|---|---:|---:|---:|
| Figwright baseline | 112 | 105 | 7 |
| `export_tokens` — 기존 `get_variable_defs/get_styles`를 조합하는 server adapter | +1 | +0 | +1 |
| `export_frames_to_pdf` — 기존 `export_pdf` handler를 반복 호출하고 server에서 merge | +1 | +0 | +1 |
| `doctor` — daemon/session/workspace 진단 orchestration | +1 | +0 | +1 |
| `import_library_variable` — 새 Plugin API write | +1 | +1 | +0 |
| **최종** | **116** | **106** | **10** |

따라서 116/106은 맞다. 이 구조를 지키려면 새 server-only exact set은 기존 7개에 `export_tokens`, `export_frames_to_pdf`, `doctor`를 더한 **10개**여야 한다. `import_library_variable`만 같은 이름의 plugin handler를 가져야 한다. 예상 kind 합계도 `read 23 / local 13 / write 80`으로 명시해 registry/policy/docs gate에서 고정하는 편이 좋다.

### 2.2 보존 확대 결정

- Motion 7개는 원본 registry `packages/mcp/src/tools/registry.ts:141-142,232-237`와 plugin handler `packages/plugin/src/handlers/registry.ts:198-203,225-226`에 실제 존재한다.
- `export_video`는 같은 이름의 plugin handler를 갖는 local filesystem tool이다(`packages/plugin/src/handlers/registry.ts:231-232`). 삭제하지 않고 experimental/capability-gated로 두는 결정은 binding spec `05-unified-service-proposal.md:202-205,653-668`과 일치한다.
- URL import도 원본 ToolSpec과 handler에 실제 존재한다(`packages/mcp/src/tools/import-image.ts:7-25`, `packages/plugin/src/handlers/import-image.ts:9-54`). “기능은 유지하되 unrestricted fetch를 금지”하는 제품 결정은 합리적이다. 문제는 결정이 아니라 현재 계획에 enforceable 구현이 없다는 점이다.

## 3. Critical findings

### C-01. Task 6→Task 9 순서가 106 handler parity를 깨뜨린다

**근거**

- Task 6은 handler 106을 추가하고 즉시 `test/tool-registry.test.ts`를 GREEN으로 만들라고 한다(`plan:953-1004`).
- 새 ToolSpec 네 개는 Task 9에서야 생성된다(`plan:1110-1158`).
- 원본 parity test는 plugin handler가 server registry에 없으면 `onlyPlugin`으로 실패한다(`code-kb/figwright/test/tool-registry.test.ts:61-64`).

**영향**

Task 6 종료 상태는 server 112 / plugin 106이므로 계획이 요구한 GREEN이 구조적으로 불가능하다. Task 9 RED의 “registry 112, handlers 105” 전제(`plan:1127-1134`)도 동시에 깨진다.

**정확한 수정안**

1. Task 6은 **105 handlers 유지**와 generic capability/pairing/approval UI까지만 구현한다.
2. 다음 파일과 `teamlibrary` manifest 변경을 Task 9로 이동한다.
   - `service/packages/plugin/src/handlers/import-library-variable.ts`
   - `service/packages/plugin/src/handlers/registry.ts`
   - `service/packages/plugin/manifest.json`
   - `service/packages/plugin/test/handlers/import-library-variable.test.ts`
3. Task 9 한 commit에서 4 ToolSpecs, 4 operation policies, `import_library_variable` handler 1개, server-only exception 3개를 원자적으로 추가한다.
4. Task 6 GREEN은 112/105/7, Task 9 GREEN은 116/106/10을 assert한다.
5. Task 9 GREEN 명령에 `pnpm -C service exec vitest run packages/plugin/test test/tool-registry.test.ts`와 plugin build를 추가한다.

### C-02. `export_frames_to_pdf`는 현재 dependency 계약으로 구현할 수 없다

**근거**

- 계획은 “PDF dependency를 추가하지 않는다”고 한다(`plan:622`).
- 동시에 새 tool이 기존 PDF engine에 delegate해 multi-page output을 만든다고 한다(`plan:1114,1143`).
- Figwright `export_pdf`는 한 node를 한 page PDF로 내보내며 여러 node merge를 할 수 없다고 명시한다(`code-kb/figwright/packages/mcp/src/tools/export-pdf.ts:12-30`, `packages/plugin/src/handlers/export-pdf.ts:7-11`).
- Rust 구현은 각 node PDF를 받은 뒤 `pdf::merge_pdfs`를 호출하고, 그 함수는 `lopdf`를 사용한다(`code-kb/figma-mcp-rust/src/tools/special.rs:293-375`, `src/pdf.rs:1-112`). 즉 merge engine은 필수다.

**영향**

기존 Figwright engine만 반복 호출하면 여러 개의 single-page byte array만 얻는다. 이를 그대로 write하면 올바른 multi-page PDF가 아니다. Task 9와 Task 12의 page-order GREEN이 거짓이 된다.

**정확한 수정안**

116-tool 약속을 유지하려면 다음 중 하나를 plan에 결정해야 한다.

- **권장:** Node MCP package에 검토·고정한 PDF merge dependency를 추가하고 `service/packages/mcp/src/execution/pdf-merge.ts`를 만든다. Task 11 license/SBOM에 그 dependency를 포함한다.
- 또는 Rust PDF worker를 v0.1로 당기고 process/packaging/security task를 추가한다. 현재 Node-only v0.1 범위에는 더 비싸다.
- “PDF dependency 없음”을 유지하려면 `export_frames_to_pdf`를 v0.1에서 빼고 수량을 되돌려야 하므로 현재 binding 116 계약과 충돌한다.

권장 Node 흐름은 다음으로 고정한다.

1. 한 routed dispatcher로 session을 한 번 pin한다.
2. 입력 `nodeIds`를 bounded concurrency로 기존 plugin `export_pdf({nodeId,binary:true})`에 전달한다.
3. 결과는 완료 순서가 아니라 원래 `nodeIds` 순서로 merge한다.
4. corrupt/empty/non-exportable page가 하나라도 있으면 output을 만들지 않는다.
5. merge 결과는 `AtomicFileStore.createNew`로 no-overwrite write한다.
6. tests는 empty list, duplicate IDs, mixed page size, corrupt page, order, cancellation, existing output, outside-root를 포함한다.

### C-03. Union Manifest의 authority와 Motion/video disposition이 서로 모순된다

**근거**

- global constraint는 `union-manifest.json`이 lexical 114 + helper20 + CLI12를 추적한다고 한다(`plan:22`).
- Task 1은 manifest의 lexical row를 114/114로 검사한다(`plan:681,705-706`).
- Task 11은 artifact 안에 “116-tool union manifest”가 있다고 한다(`plan:1249,1255`).
- DoD는 같은 manifest가 lexical114+helper20+CLI12를 덮는다고 한다(`plan:1338-1340`).
- capability-union 입력은 Motion 7개와 video 1개를 `deferred`로 분류한다(`agent-a-capability-union-input.md:54-62,142-149,164-168,243`). 최신 plan과 binding spec은 이 8개를 registered experimental로 보존한다.

**영향**

한 JSON array를 114로 검사하면서 artifact에서는 116이라고 부르면 docs/artifact exact gate를 정의할 수 없다. 입력 ledger를 그대로 materialize하면 Motion/video는 registry에 있으면서 manifest상 shipping surface에서 비활성이라는 모순이 생긴다.

**정확한 수정안**

Manifest schema를 두 층으로 분리한다.

~~~ts
interface UnionManifestV1 {
  schemaVersion: 1;
  canonicalTools: CanonicalToolRow[]; // exactly 116
  sourceSurfaces: {
    lexicalTools: SourceToolRow[];       // exactly 114
    figmoshaHelpers: SourceFeatureRow[]; // exactly 20
    figmoshaCliParsers: SourceFeatureRow[]; // exactly 12, unique behaviors 11
  };
}

interface CanonicalToolRow {
  name: string;
  sourceRefs: string[];
  sourceSchemaHashes: Record<string, string>;
  canonicalSchemaHash: string;
  disposition: 'native' | 'adapter';
  maturity: 'stable' | 'experimental';
  availability: string[];
  implementation: string;
  test: string;
  policyId: string;
}
~~~

- Motion 7 + `export_video`는 `disposition:native`, `maturity:experimental`, Design capability-gated로 기록한다. `deferred`가 아니다.
- raw exec만 normal v0.1 source surface에서 `rejected`; expert 연구는 별도 non-shipping ledger다.
- Task 1에는 새 네 canonical row를 `implementationStatus:'planned'`로 넣고, Task 9가 `implemented`로 전환한다.
- Task 11 hard gate는 `canonicalTools=116`, source 114/20/12, `unclassified|planned=0`을 각각 검사한다.
- artifact 문구는 “116 canonical tool rows와 114/20/12 source ledgers를 포함”으로 고친다.

### C-04. `session-write` queue는 binding spec의 per-file single writer가 아니다

**근거**

- binding spec은 relay와 security에서 per-file queue를 요구한다(`05-unified-service-proposal.md:155,232-235,435-447,653-665`).
- 최신 plan은 global/Task 4/DoD를 계속 session별 FIFO로 정의한다(`plan:26,61,452,511-513,872-878,1354-1356`).
- `OperationExecutor` input에는 sessionId와 pluginGeneration만 있고 fileKey/file execution key가 없다(`plan:505-517`).

**영향**

같은 Figma file을 두 plugin panel/session으로 열면 두 queue가 생겨 같은 document에 write가 겹친다. “different sessions may progress independently” test는 이 위험을 오히려 허용한다.

**정확한 수정안**

~~~ts
type FileExecutionKey =
  | `figma:${string}` // stable non-null fileKey
  | `ephemeral:${string}:${string}`; // sessionId:pluginGeneration fallback

interface InvocationTarget {
  sessionId: string;
  pluginGeneration: string;
  fileKey: string | null;
  fileExecutionKey: FileExecutionKey;
}
~~~

- queue map은 sessionId가 아니라 `fileExecutionKey`로 key한다.
- fileKey가 같은 두 session의 writes와 reads-vs-write는 serialize한다.
- fileKey가 null이면 authenticated session+generation을 ephemeral boundary로 쓰고 cross-session safety를 주장하지 않는다.
- Task 4 tests를 “same fileKey/different session serial”, “different fileKey parallel”, “null fileKey same generation serial”로 바꾼다.
- OperationRecord/Snapshot/approval summary에도 fileExecutionKey를 남긴다.

### C-05. URL import 보안은 현재 계획의 파일과 interface로 강제할 수 없다

**근거**

- 계획은 URL import를 HTTPS/domain/size policy+approval 아래 보존한다(`plan:82,426,456,754,987,1308,1357`).
- 파일 구조에는 URL validator/fetcher/DNS/redirect module이 없고 Task 6의 plugin 변경 한 줄만 있다.
- 원본 plugin은 URL을 직접 `figma.createImageAsync(url)`에 넘기며 manifest는 wildcard domain이다(`code-kb/figwright/packages/plugin/src/handlers/import-image.ts:9-38`, `packages/plugin/manifest.json:9-12`).
- binding spec은 HTTPS뿐 아니라 private/local IP, MIME, size, domain을 요구한다(`05-unified-service-proposal.md:431-434`).

**영향**

URL string의 scheme/hostname 검사만으로 redirect, DNS rebinding, private IP, response size를 통제할 수 없다. plugin이 직접 fetch하면 server가 response bytes/MIME/redirect chain을 검사할 수 없고 wildcard permission도 남는다.

**정확한 수정안**

URL 입력 shape는 보존하되 실제 fetch 위치를 server로 옮긴다.

1. Task 4 또는 별도 Task 5 산출물에 `service/packages/mcp/src/network/remote-image-fetcher.ts`와 tests를 추가한다.
2. approval 뒤 Node fetcher가 HTTPS, configured domain allowlist, userinfo 금지, redirect 횟수, 각 hop DNS의 public IP, MIME, declared+streamed byte cap을 검증한다.
3. 허용 byte를 base64/data 형태로 기존 plugin handler에 보내고 plugin에는 URL이 도달하지 않게 한다.
4. plugin handler는 relay를 우회한 `url` payload를 fail-closed하고 `createImageAsync(url)` branch를 제거한다.
5. manifest는 wildcard를 제거하고 loopback relay에 필요한 domain만 둔다.
6. tests는 IPv4/IPv6 private ranges, localhost names, redirect-to-private, DNS answer change, oversize chunked response, bad MIME, approval-before-fetch, redacted audit를 포함한다.

이 방식은 사용자의 `import_image(url)` 기능을 보존하면서 실제 network side effect를 중앙 PolicyEngine에 귀속시킨다.

## 4. Important findings

### I-01. Pairing ticket 이후 reconnect와 CLI control-token 획득 contract가 없다

Pairing core interface는 challenge와 hello capabilities만 정의한다(`plan:458-480`). 30초 one-use ticket이 첫 socket에 소비된 뒤 socket flap에서 무엇으로 reconnect하는지, CLI가 `/control/*` token을 어디서 얻는지 명시하지 않았다. Task 4/7은 authenticated reconnect를 전제로 한다.

**수정안:** 다음 wire types와 test를 Task 3 `Interfaces`에 추가한다.

~~~ts
interface PairExchangeResult { wsTicket: string; expiresAt: number }
type HelloCredential =
  | { kind: 'ticket'; value: string }
  | { kind: 'resume'; value: string };
interface AuthenticatedHello extends HelloCapabilities {
  credential: HelloCredential;
  nonce: string;
}
interface AuthenticatedHelloResult {
  sessionId: string;
  pluginGeneration: string;
  rotatedResumeToken: string;
}
~~~

- ticket/resume token은 query string이 아니라 first MessagePack hello에서 보내고 logs/diagnostics에서 redact한다.
- resume token은 session+generation에 bind하고 성공 때 rotate한다.
- plugin restart는 generation을 바꾸고 old token/cache를 invalidate한다.
- leader lock/control credential의 exact OS path, file schema, Windows ACL fallback, CLI read flow를 명시한다. RPC, control, plugin token은 분리한다.
- tests에 first pair, same-panel flap resume, stolen/old resume rejection, rotation, plugin restart re-pair를 추가한다.

### I-02. Task dependency graph가 실제 interface 의존성과 충돌한다

현재 Task 3/4/5는 Task 2 뒤 병렬이고(`plan:654-668`), Task 4는 authenticated control endpoints를 만들면서 Task 3의 control auth에 의존한다. Journal의 workspace path는 Task 5 adapter에 의존한다. 세 task가 index/dispatch/endpoints/local tools를 함께 바꿔 merge conflict도 크다.

**권장 graph**

~~~text
T1 → T2
T2 → {T3 auth, T5 filesystem}
{T3,T5} → T4 executor/control/journal/egress
{T3,T4} → T6 plugin pairing/capabilities (105 handlers)
{T4,T5,T6} → T7 grounding fixes
T7 → T8 snapshot/graph
{T4,T5,T6,T7} → T9 four safe-union tools + handler 106
{T3,T4,T8,T9} → T10 CLI
T1..T10 → T11 → T12
~~~

T3는 authenticated control router/context를 **produce**, T4는 approval/tool-call endpoint를 그 router에 mount하는 **consume** 관계로 명시한다.

### I-03. Static `OperationPolicy.effects`는 argument-dependent side effect를 표현하지 못한다

`import_image`는 URL일 때만 network이고, `export_tokens`는 outPath가 있을 때만 filesystem write이며, 기존 output tool은 기존 file을 덮을 때 destructive가 된다. 그런데 interface는 static effects array뿐이다(`plan:437-456,587-604`).

**수정안**

~~~ts
interface OperationPolicy<I> {
  toolName: string;
  resolveEffects(args: I, ctx: InvocationContext): readonly Effect[];
  idempotency: 'safe-retry' | 'operation-id' | 'never-auto-retry';
  approvalFor(effects: readonly Effect[], ctx: InvocationContext): 'none' | 'client' | 'explicit-user';
  concurrency: 'parallel-read' | 'file-write' | 'exclusive-heavy';
}
~~~

MCP annotations는 worst-case static summary로 만들고, runtime approval은 parsed args와 resolved target/output existence로 계산한다. 같은 tool의 data-vs-URL, content-vs-outPath tests를 반드시 분리한다.

### I-04. Journal/idempotency contract가 args conflict·recovery·audit 요구를 덜 담는다

`OperationRecord`에는 actor/workspace/file/generation/approval/result hash가 없고(`plan:494-503`), 같은 operationId에 다른 tool/args가 들어오는 conflict test도 없다. Restart 때 `dispatched`를 어떤 transition으로 복구하는지도 불명확하다. Binding spec은 actor,target,args hash,approval,result,diff audit와 durable saga를 요구한다(`05-unified-service-proposal.md:437-440,481`).

**수정안:** record에 `source`, `actorId`, `workspaceId`, `fileExecutionKey`, `pluginGeneration`, `effectSummary`, `approvalId`, `sequence`, `resultHash`, `previousStatus`를 추가한다. 같은 ID+다른 tool/args/file은 `OPERATION_ID_CONFLICT`; daemon startup은 persisted dispatched record를 `outcome-unknown`으로 append-transition한다. 10,000 cap 도달 시 unsettled를 버리지 말고 새 mutation을 fail-closed한다. Compaction crash recovery와 truncated JSONL tail test도 추가한다.

### I-05. 116개 result의 runtime validation이 plan gate에 없다

원본 ToolSpec은 input schema만 가진다(`code-kb/figwright/packages/mcp/src/tools/spec.ts:14-60`). Binding spec은 runtime result validation을 요구하지만(`05-unified-service-proposal.md:146-159,542-545`), 최신 plan은 Task 8에서 “schemas to shared result validation”이라고만 적고 snapshot scope인지 전체 tool scope인지 불명확하다(`plan:1064-1067`).

**수정안:** Task 2/4에 `resultSchema` 또는 `resultCodec`을 ToolSpec contract로 추가하고 116/116 coverage test를 둔다. Plugin raw result → canonical result parse → journal → egress broker → CallToolResult 순서를 고정한다. binary/screenshot/special adapters도 unknown cast로 우회하지 못하게 한다. Skewed plugin의 invalid result가 typed `PLUGIN_RESULT_INVALID`로 실패하는 E2E를 추가한다.

### I-06. Tool runtime map과 새 네 tool의 args/results가 불완전하다

핵심 interface에는 `export_tokens`만 있고(`plan:587-604`), 나머지 3개는 Task 9의 bullet뿐이다. `index.ts`의 special branch를 없앤다고 했지만 116 ToolSpecs가 어떤 runtime adapter에 연결되는지 authority가 없다(`plan:415-420`).

**수정안:** `TOOL_RUNTIMES` exact map과 다음 최소 types를 section 5/Task 9에 추가한다.

~~~ts
interface ExportFramesToPdfArgs { nodeIds: [string, ...string[]]; outPath: string }
interface ExportFramesToPdfResult { path: string; nodeIds: string[]; pageCount: number; bytesWritten: number; warnings: string[] }

interface DoctorArgs { roundTrip?: boolean }
interface DoctorCheck { id: string; status: 'pass'|'warn'|'fail'; code: string; message: string }
interface DoctorResult { overall: 'healthy'|'degraded'|'unavailable'; checks: DoctorCheck[] }

interface ImportLibraryVariableArgs { key: string }
interface ImportLibraryVariableResult {
  ok: true; id: string; key: string; name: string; resolvedType: string; collectionId: string;
}
~~~

- `TOOL_RUNTIMES` size 116, plugin-dispatch runtimes 106, server adapters 10을 exact test한다.
- `snapshot`/graph capture는 registry 수를 늘리지 않도록 **authenticated control endpoint only**로 고정한다. 현재 “control/MCP handlers or CLI” 표현(`plan:1066`)은 117번째 MCP tool을 만들 여지가 있다.
- `import_library_variable`은 `figma-write`와 `figma-library-import` effect, Design/teamlibrary capability, explicit approval를 가진다.

### I-07. Motion/video를 보존했지만 heavy budget·progress·payload 통합이 없다

Task 6/9/11/12는 Motion/video registration과 smoke를 요구한다(`plan:989,1146,1255,1309`). 그러나 원본의 알려진 결함인 `export_video` 기본 timeout, whole-buffer payload를 어떤 task가 고치는지 없다. Progress primitive도 safe-union unit test만 있고 실제 export/scan integration이 없다.

**수정안:** Task 2에서 `export_video`와 `export_frames_to_pdf`를 `exclusive-heavy`로 분류하고, Task 4/9에서 absolute deadline+cancellation+progress를 실제 adapter에 연결한다. `tool-budgets.ts`에 video/duration-based budget test를 추가하고 WS `maxPayload`, per-operation byte cap, output size policy의 관계를 명시한다. Task 12는 등록 여부뿐 아니라 small fixture success 또는 typed capability error, timeout budget, partial file 부재를 검증한다.

### I-08. Standalone vendoring과 provenance verification이 exact하지 않다

“all vendored files”, “existing components/tests”, “Create all root files” 같은 placeholder가 남아 있다(`plan:305,326,350,356,360,679-685`). `upstream-lock`은 copied source hash와 이후 수정된 vendored file을 어떻게 검증하는지, 원본 checkout 없는 artifact에서 무엇을 검증하는지 구분하지 않는다(`plan:101-105`).

**수정안:** `service/vendor-map.json`에 source/destination/baseSha256/currentSha256/origin/license를 파일별로 기록하고 exact include/exclude 목록을 Task 1에 둔다. Verification을 둘로 나눈다.

- `verify-upstream-lock --offline`: service 내부 current hash, license/provenance/schema만 검증; `code-kb` 불필요.
- `verify-upstream-lock --with-upstreams ../code-kb`: source commit/base hash와 원본 clean 상태를 parent workspace에서만 검증.

Production import뿐 아니라 package scripts, skills, configs의 runtime `code-kb` read도 0인지 scan한다. Task 1 RED 전에 최소 `service/package.json`, workspace config, test runner를 bootstrap하는 step을 먼저 넣어 “service directory 자체가 없음” 실패와 의도한 parity 실패를 구분한다.

### I-09. CLI command mapping과 daemon prerequisite가 충분히 고정되지 않았다

파일 목록과 test bullet은 많지만 option/argument/target/result/exit-code mapping table이 없다(`plan:364-395,1164-1216`). `sfp pair`와 mutation CLI는 daemon이 있어야 하는데 CLI는 daemon을 시작하지 않는다고만 하고, 사용자가 daemon을 어떻게 명시적으로 시작하는지는 없다(`plan:1171`). DoD도 새 PDF/library-variable CLI를 빠뜨린다(`plan:1341-1343`).

**수정안:** Task 10에 command contract table을 추가한다. 최소 `command → canonical tool/control endpoint → positional/options → approval → output/exit`를 고정한다. `icomp` alias, rejected `exec`, helper20의 recipe-only 항목도 명시한다. `sfp serve` foreground command를 추가하거나 “CLI는 active MCP daemon의 companion”을 제품 제약으로 명시하고 README/doctor error에 start 방법을 넣는다. DoD에 `pdf export`, `import-variable`, clone/rm/import-component wrappers를 추가한다.

### I-10. Artifact gate에 SBOM·checksum·artifact별 contents authority가 빠졌다

Task 11은 notices/provenance를 검사하지만 binding spec의 dependency SBOM과 supply-chain checksum 요구를 완전히 담지 않는다(`05-unified-service-proposal.md:444,529-531,674-679`). 어떤 npm package를 pack하는지도 불명확하다.

**수정안:** artifact matrix를 `@sfp/mcp.tgz`, `@sfp/cli.tgz`, plugin ZIP 각각에 대해 정의하고 `SBOM.spdx.json`, SHA-256 manifest, service/upstream licenses, THIRD_PARTY_NOTICES, PROVENANCE, canonical 116/source ledgers를 검사한다. PDF dependency를 추가하면 license가 자동 포함되는지 test한다. `verify:release` script에 build→pack→zip→contents→checksum 순서를 넣고 DoD가 그 command를 요구하게 한다.

### I-11. Acceptance evidence와 live fixture의 재현 계약이 부족하다

Task 12의 sequence는 폭넓지만 script가 없는 상태에서 RED가 `PLUGIN_NOT_CONNECTED`여야 한다는 순서가 맞지 않고(`plan:1275-1291`), live PASS record의 schema가 없다. URL policy가 private/local IP를 막는다면 “approved HTTPS fixture”도 소유·고정된 public fixture가 필요하다.

**수정안:** 먼저 acceptance runner skeleton과 fake control tests를 만든 뒤 live RED를 실행한다. Evidence JSON에 OS, Figma version, plugin/MCP build hash, file identity redaction, capability set, timestamp, 각 check code를 기록한다. Windows/macOS 각각 별도 artifact를 요구한다. URL positive fixture는 release team이 소유한 HTTPS domain/content hash로 고정하거나 live positive를 non-blocking으로 두고 automated mocked DNS/redirect tests를 hard gate로 둔다.

## 5. Minor findings

### M-01. fileKey null fallback 명칭이 충돌 안전성을 과장한다

“session-bound fileName hash”(`plan:1038`)가 fileName만 hash하는지 session/generation을 포함하는지 불명확하다. fileName은 stable identity가 아니다. `ephemeral:{sessionId}:{generation}`으로 명시하고 fileName은 display metadata로만 둔다. Plugin restart 뒤 기존 baseline 자동 연결은 금지한다.

### M-02. `export_tokens` CSS의 multi-mode semantics가 없다

Args는 format/outPath뿐이다(`plan:589-601`). Rust 원본 CSS는 첫 mode만 사용한다(`code-kb/figma-mcp-rust/plugin/src/read-styles.ts:181-223`). CSS가 default mode만 emit하는지 mode selector를 생성하는지 정하고 `mode?: string` 또는 명시적 warning contract를 추가한다. JSON all-mode 보존과 CSS lossy projection을 혼동하지 않는다.

### M-03. Rust compat 출력 category가 unique 2개를 잃는다

Task 10은 73 Rust names를 same/adapter/incompatible로만 출력한다(`plan:1188`). `export_tokens`, `export_frames_to_pdf`는 source ledger상 unique다. `unique-adapter` category를 추가하거나 adapter 안에서 `sourceCompatibility:'unique'`를 별도 표시한다.

### M-04. DoD의 approval 문구가 filesystem read까지 모두 승인 대상으로 읽힌다

DoD의 “Destructive/filesystem/network actions require explicit approval”(`plan:1352`)은 `analyze_project` 같은 inside-root filesystem-read와 충돌한다. “destructive, filesystem-write/overwrite, network actions”로 고치고 filesystem-read는 configured root와 sensitivity policy를 통과한다고 분리한다.

### M-05. Task file path가 중간부터 workspace-relative shorthand로 바뀐다

Task 3 이후 `shared/src`, `mcp/src` 등은 실행자가 자신의 package cwd를 추측해야 한다(`plan:779-784,838-849`). 모든 Create/Modify/Test path를 `service/packages/...` 절대 workspace-relative 표기로 통일한다. `.github/workflows/service-ci.yml`만 workspace root임을 명시한다.

## 6. 12개 Task별 판정표

| Task | 판정 | 핵심 문제 | 필수 수정 |
|---:|---|---|---|
| 1 | Important | runner bootstrap 전 RED, vendoring placeholder, 114/116 manifest 혼용 | bootstrap microstep, file-level vendor map, two-layer manifest, offline/upstream verify 분리 |
| 2 | Important | 112 baseline policy만 있고 dynamic effects/result schema 없음 | worst-case annotation + runtime effect resolver + result codec authority 생산 |
| 3 | Important | pair exchange/resume/control-token wire 미정 | exact auth schemas, rotating resume, control credential discovery, negative/reconnect tests |
| 4 | Critical | Task 3/5와 실제 의존, session queue, journal fields/args conflict 미흡 | graph 재배치, fileExecutionKey, recovery/audit/id-conflict, egress context |
| 5 | Important | sandbox 자체는 좋으나 journal/output overwrite와 injection port 미정 | WorkspacePolicy를 Task 4가 consume, dynamic overwrite effect, adapter-only fs mutation |
| 6 | Critical | handler 106 조기 추가로 parity 실패; URL policy가 plugin에 잘못 귀속 | 105 유지, handler를 T9로 이동, external URL branch 제거/server fetcher 사용 |
| 7 | Important | Task 4와 relay flap 책임 중복, fallback identity 불명확 | T4는 operation state, T7은 grounding pin/file namespace로 책임 분리 |
| 8 | Important | capture가 MCP tool인지 control endpoint인지 모호해 116 count 위협 | control-only endpoint 고정, hash input/identity schema 명시 |
| 9 | Critical | 4-tool/1-handler atomicity와 PDF merge engine 부재 | 116/106/10 원자적 추가, PDF merger, exact types/policies/results/plugin build |
| 10 | Important | CLI option mapping/daemon prerequisite/approval waiter test 부족 | command contract table, daemon decision, helper/parser exhaustive golden tests |
| 11 | Important | artifact authority·SBOM·checksum·release command 부족 | artifact matrix, generated SBOM/checksums, 116+114/20/12 exact contents |
| 12 | Important | RED bootstrap, evidence schema, controlled URL fixture 부족 | runner unit test 먼저, OS별 evidence JSON, stable fixture/automated network hard gate |

## 7. TDD/plan 형식 수정안

현재 12 tasks, Step 1~4는 각각 12개로 정렬됐지만, Task별 interface block은 0개이고 모든 Step 2가 generic 한 줄이다. 각 Task를 reviewer gate로 유지하더라도 내부를 2~5분 단위 action으로 쪼개야 한다.

각 Task에 최소 다음 구조를 반복한다.

1. **Interfaces — Consumes/Produces**: 이전 Task의 exact type/function/file을 적는다.
2. RED test 파일 하나와 실제 test code를 작성한다.
3. exact command와 expected error를 실행한다.
4. production file 하나의 최소 implementation code를 작성한다.
5. focused GREEN을 실행한다.
6. 다음 behavior에 대해 RED→GREEN을 반복한다.
7. package gate, broader gate, diff self-review, commit을 분리한다.

특히 Task 1의 “all root files”, Task 6의 “modify plugin manifest, relay client, App…”, Task 8의 “all IR source”, Task 10의 “all CLI files”는 실행자가 내용을 발명해야 하는 placeholder다. Section 4 tree가 파일 이름을 나열하는 것만으로 각 파일의 exported symbol과 call direction을 정의하지 못한다.

## 8. 수정 후 권장 hard gates

1. Baseline gate: 112 tools / 105 handlers / server-only 7.
2. Final registry gate: 116 / 106 / server-only 10; kind 23/13/80.
3. Manifest gate: canonical116, lexical114, helper20, parser12/unique11, unclassified/planned 0.
4. Experimental preservation gate: Motion7+video1 registry/runtime/policy/artifact present and capability-gated.
5. Runtime contract gate: input+result+policy+runtime map 116/116.
6. Security gate: pairing/resume, authenticated RPC/control, null-Origin negative, body/WS cap, server-fetched URL SSRF suite.
7. Concurrency gate: same-file cross-session FIFO, same-ID/same-args once, same-ID/different-args conflict, post-dispatch flap unknown.
8. Filesystem gate: all local read/write through WorkspacePolicy/AtomicFileStore; symlink/junction/new-parent/overwrite tests.
9. Export gate: token modes/aliases, PDF page order/corrupt/no-overwrite, video heavy budget/progress/cancel.
10. Artifact gate: MCP/CLI tarballs+plugin ZIP, licenses/notices/SBOM/provenance/checksums/capability ledgers.
11. Live gate: Windows and macOS evidence artifacts, secure Design round trip, policy negatives.

## 9. 최종 결론

메인의 확장 결정은 기능 보존 관점에서 개선이다. **116/106은 맞고, Motion/video/URL import를 제거하지 않은 것도 binding spec에 부합한다.** 그러나 지금 계획에서 그 수량은 Task 경계와 manifest authority에 완전히 연결되지 않았고, PDF와 URL 두 기능은 구현 메커니즘이 빠져 있다.

우선 수정 순서는 다음이 안전하다.

1. C-01과 C-03으로 registry/handler/manifest authority를 고정한다.
2. C-02와 C-05로 PDF/URL의 실제 engine과 security boundary를 결정한다.
3. C-04와 I-01~I-05로 per-file executor, auth, dynamic policy, journal, result validation interface를 고정한다.
4. dependency graph와 Task별 Interfaces/RED-GREEN microsteps를 다시 쓴다.
5. CLI/artifact/acceptance DoD를 네 새 도구와 116 manifest에 맞춰 닫는다.

이 다섯 묶음이 반영되면 최신 계획은 “풍부한 설계 문서”에서 “서브에이전트가 task 단위로 실행해도 contract가 흔들리지 않는 구현 계획”으로 승격될 수 있다.
