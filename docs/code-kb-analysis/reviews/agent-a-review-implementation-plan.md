# Agent A 독립 리뷰 — Super Figma Pipeline v0.1 구현 계획

## 1. 범위와 종합 판정

- 대상: `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md` 전체 1,423행
- Binding 근거: `05-unified-service-proposal.md`, `04-detailed-comparison.md`, `agent-a-capability-union-input.md`
- Source 대조: Figwright/Rust/figmosha2 고정 commit의 실제 registry, handler, relay, export, helper 구현

계획의 큰 방향은 승인 가능하다.

- 원본 세 OSS를 read-only로 두고 `service/`에 standalone Figwright vendor baseline을 만드는 선택이 정확하다.
- Node 24 하나, Desktop internal editable Figma Design, no Web/public/raw/non-loopback이라는 v0.1 경계가 명확하다.
- Figwright 112/105를 보존하고 safe-union 4 tool을 더해 116/106으로 만드는 수량은 산술·source상 맞다.
- 114 lexical tool + helper20 + parser12/unique11 manifest invariant도 맞다.
- 12개 Task, RED 12, GREEN 12, commit 12가 모두 존재한다.
- pairing, follower auth, Host/Origin, queue, idempotency, outcome-unknown, egress, filesystem, license, actual Desktop acceptance가 hard gate에 들어갔다.

그러나 현재 상태로 실행하면 세 곳에서 task dependency/implementation이 막힌다. 또 중앙 executor interface가 actor/workspace/consent를 표현하지 않아 global security constraint를 구현할 수 없다. 아래 Critical을 먼저 고쳐야 “written plan을 그대로 실행”할 수 있다.

## 2. Finding 요약

| ID | 등급 | 영역 | 요약 |
|---|---|---|---|
| A-IP-C01 | **Critical** | Task 6/9 parity | plugin handler 106을 ToolSpec보다 먼저 추가해 registry exact parity가 Task 6 GREEN에서 깨짐 |
| A-IP-C02 | **Critical** | Task 3/4 dependency | Task 3이 아직 존재하지 않는 ToolInvocationService/OperationExecutor를 `/control/tools/call`에서 요구 |
| A-IP-C03 | **Critical** | PDF | multi-page PDF tool을 요구하면서 PDF/Rust dependency를 금지하고 merge engine/source task가 없음 |
| A-IP-C04 | **Critical** | central interface | ToolInvocationService/OperationRecord에 actor·workspace·policy·approval·consent context가 없어 gate/audit/idempotency를 안전하게 구현 불가 |
| A-IP-I01 | **Important** | Task 1 RED | service/test runner가 없는 상태에서 `pnpm -C service vitest` RED는 실행조차 안 되며 Task 1이 과대함 |
| A-IP-I02 | **Important** | dependency graph | Task 9가 실제로 Task 3/4/6/7에 의존하지만 graph는 Task 5+7만 표시 |
| A-IP-I03 | **Important** | URL/network | 동적 승인 domain과 static Figma manifest 최소 allowlist를 동시에 만족시키는 fetch topology가 없음 |
| A-IP-I04 | **Important** | workspace | configured roots가 global constraint인데 config authority와 CLI add/list/remove가 없음 |
| A-IP-I05 | **Important** | IR/snapshot | `ir` dependency 선언과 SnapshotV1 type이 모순이고 큰 tree full snapshot capture algorithm이 빠짐 |
| A-IP-I06 | **Important** | file identity | fileKey null fallback이 session/fileName hash라 restart 안정성·동명이름 분리가 안 됨 |
| A-IP-I07 | **Important** | pairing/auth | 128-bit manual code UX, Windows follower token ACL/rotation, pairing endpoint contract가 불명확 |
| A-IP-I08 | **Important** | journal/idempotency | journal 위치·record fields·same ID different args/actor conflict가 정의되지 않음 |
| A-IP-I09 | **Important** | egress/progress | Egress sensitivity type과 progress producer→wire→client wiring이 없음 |
| A-IP-I10 | **Important** | approvals/undo | CLI approve command test와 per-operation `figma.commitUndo()` implementation task가 없음 |
| A-IP-I11 | **Important** | disposition | ledger의 Motion/video deferred와 계획의 v0.1 experimental registration이 충돌 |
| A-IP-I12 | **Important** | acceptance | macOS live acceptance가 release hard gate지만 현재 실행/증거 확보 책임과 artifact 형식이 없음 |
| A-IP-I13 | **Important** | review workflow | header의 independent spec/quality review가 각 Task Step에 실제 checkpoint로 없음 |
| A-IP-M01 | **Minor** | effect policy | multi-effect local tools와 final 116 policy coverage를 focused GREEN이 명시적으로 재실행하지 않음 |
| A-IP-M02 | **Minor** | registry exception | final no-same-name plugin exception 수 10과 exact set이 명시되지 않음 |
| A-IP-M03 | **Minor** | Task 11 RED | upstream provenance는 Task 1에서 이미 GREEN이므로 Task 11 expected failure 목록과 불일치 |
| A-IP-M04 | **Minor** | paths | Task 3~10 Files가 `service/packages/...` prefix를 생략해 subagent 간 cwd 해석이 달라질 수 있음 |

## 3. Critical Finding

### A-IP-C01 — Task 6에서 handler 106을 먼저 추가하면 parity가 깨진다

**근거**

- Task 6은 기존 105 handler에 `import_library_variable`를 추가해 106으로 만들고 `test/tool-registry.test.ts` parity 통과를 요구한다(`plan:953-1004`).
- 해당 MCP ToolSpec은 Task 9에서야 생성·registry 등록된다(`plan:1110-1158`).
- 원본 parity는 server tool set과 plugin handler set에서 documented server-only exceptions를 뺀 exact equality다.

Task 6 시점에는 server registry 112, plugin handlers 106이다. `import_library_variable`는 server-dispatched name이 아니므로 “106 handler parity”가 성립하지 않는다.

**Exact 수정안**

권장안:

1. Task 6은 pairing/editor UI만 구현하고 handler count를 105로 유지한다.
2. `import_library_variable` ToolSpec과 plugin handler를 Task 9에서 같은 RED/GREEN으로 동시에 추가한다.
3. Task 9 최종 불변식은 tools 116, handlers 106, no-same-name exceptions **10개**로 고정한다.

대안은 Task 6에서 ToolSpec까지 함께 추가해 중간 113/106으로 만드는 것이나, global “Task 9 safe-union 4개” 경계가 흐려지므로 권장하지 않는다.

### A-IP-C02 — Task 3이 Task 4의 중앙 pipeline을 미리 요구한다

Task 3 Required case는 `/control/tools/call`이 MCP와 같은 schema/policy/executor pipeline을 호출함을 증명하라고 한다(`plan:802-817`). 그러나 `ToolInvocationService`, `OperationExecutor`, approval/control endpoints는 Task 4에서 생성된다(`plan:836-899`). Dependency graph도 Task 3과 Task 4를 형제로 둔다(`plan:654-669`).

Task 3은 존재하지 않는 interface를 호출할 수 없고, 임시 별도 dispatch를 만들면 “모든 tool 실행은 하나의 pipeline” global constraint를 어긴다.

**Exact 수정안**

- Task 3에는 `/pair`, strict `/ping`, authenticated `/rpc`·`/abdicate`, control-auth middleware만 둔다.
- `/control/tools/call`과 “MCP와 동일 pipeline” test는 Task 4로 이동한다.
- Dependency graph를 `Task 2 → Task 3 → Task 4` 또는 `Task 2 → Task 3; Task 3 + 4 → Task 6`으로 명확히 한다.
- Task 4 Files에 `mcp/src/control/tool-call-endpoint.ts`, approval endpoints를 정확히 나열한다.

### A-IP-C03 — ordered multi-page PDF를 merge할 엔진이 없다

Task 9는 `export_frames_to_pdf`가 ordered node PDF를 기존 engine을 통해 병합하도록 요구하고 Task 12 live acceptance도 page order를 검사한다(`plan:1110-1158,1293-1310`). 그러나 plan은 v0.1에 “SQLite/PDF/Rust dependency를 추가하지 않는다”고 명시한다(`plan:622`).

Figwright의 기존 `export_pdf`는 **한 node당 single-page bytes**를 만들고 파일 하나를 쓸 뿐 merge하지 않는다(`code-kb/figwright/packages/mcp/src/tools/export-pdf.ts`, `packages/plugin/src/handlers/export-pdf.ts`). 실제 multi-page merge 구현은 Rust `lopdf` 기반 `code-kb/figma-mcp-rust/src/pdf.rs`와 special handler에 있다. Section 3.2 reuse map에는 이 source도 없다(`plan:155-165`). Node stdlib만으로 PDF object graph를 안전하게 merge할 수 없다.

**Exact 수정안 — 셋 중 하나를 binding 결정으로 선택**

1. **권장:** `pdf-lib` 같은 audited Node PDF dependency를 v0.1에 추가하고, 각 `export_pdf(binary)`를 같은 pinned session에서 받은 뒤 page order대로 merge한다.
2. Rust/`lopdf` worker를 v0.1에 넣고 native worker deferral을 철회한다.
3. Tool을 v0.2로 defer하고 v0.1 count/DoD를 115로 바꾼다.

최대 합집합과 116 invariant를 유지하려면 1번이 가장 단순하다. Task 9 Files에 merge adapter와 fixture PDFs를 추가하고 corrupt/encrypted/resource/font page test를 둬야 한다.

### A-IP-C04 — central invocation interface가 security context를 표현하지 못한다

Global constraint는 actor/approval/workspace/egress/audit를 한 pipeline에서 강제한다. 그러나 `ToolInvocationService.invoke`는 `source`, toolName, rawArgs, operationId만 받고, `OperationRecord`는 actor/workspace/policy/approval/pluginGeneration/resultHash를 저장하지 않는다(`plan:482-531`).

이 interface로는 다음을 증명할 수 없다.

- 어떤 paired user/control client가 호출했는지.
- 어느 configured workspace policy가 적용됐는지.
- 어떤 session/file capability를 승인했는지.
- model egress consent가 누구에게서 왔는지.
- 같은 operationId를 다른 actor 또는 다른 args/tool이 재사용했을 때 conflict인지.

**Exact 수정안**

~~~ts
export interface InvocationContext {
  source: 'mcp' | 'cli-control' | 'follower';
  actorId: string;
  authSessionId: string;
  workspaceId: string | null;
  requestedSessionId: string | null;
  consentId?: string;
}

invoke(
  context: InvocationContext,
  toolName: string,
  rawArgs: unknown,
  operationId?: string,
): Promise<unknown>;
~~~

`OperationRecord`에는 actorId, authSessionId, workspaceId, policyId/version, effect summary, approvalId/decision, pluginGeneration, resultHash/size, egress manifest hash를 추가한다. Idempotency key는 `(actorId, operationId)`이며 기존 record와 tool/argsHash/workspace/session이 다르면 `OPERATION_ID_CONFLICT`로 거부한다. Task 4 RED에 같은 ID·다른 args/tool/actor negative case를 반드시 추가한다.

## 4. Important Finding

### A-IP-I01 — Task 1 RED가 runnable하지 않고 한 Task가 지나치게 크다

현재 `service/`가 전혀 없는데 첫 RED command는 `pnpm -C service exec vitest ...`다(`plan:675-717`). Test runner/package/lock/node_modules가 없으므로 예상한 “Cannot resolve @sfp/mcp registry”가 아니라 cwd/package/command-not-found로 끝난다. 이는 behavior RED가 아니다.

**수정안**

- Task 0 또는 Task 1 Step 0으로 최소 root package, workspace, Vitest config, lock install을 bootstrap한다.
- bootstrap smoke가 GREEN인 뒤 `upstream-parity.test.ts`를 작성하고 missing registry로 RED를 확인한다.
- Task 1을 `1A bootstrap`, `1B vendor+namespace`, `1C provenance+parity`로 나눠 review 가능한 commit 크기로 만든다.

### A-IP-I02 — Task 9 dependency graph가 실제 dependency를 숨긴다

Graph는 Task 9를 Task 5+7 뒤에만 둔다(`plan:654-669`). 하지만 Task 9의 doctor는 Task 3 identity/pairing, 네 tool policy/journal은 Task 4, import variable handler는 Task 6, pinned session은 Task 7에 의존한다.

**수정안:** `Task 3 + 4 + 5 + 6 + 7 → Task 9`로 고친다. Task 8(snapshot)은 Task 9의 필수 dependency가 아니면 병렬 가능하게 유지한다.

### A-IP-I03 — 승인된 임의 URL과 static manifest allowlist가 양립하지 않는다

Plan은 plugin manifest를 “local relay + 승인된 HTTPS import에 필요한 최소 network policy”로 바꾸면서 user-approved URL import를 보존한다(`plan:409-430,953-990`). Figma manifest allowedDomains는 build-time static이다. Runtime에 사용자가 승인한 임의 domain을 최소 allowlist에 동적으로 추가할 수 없다. `*`를 유지하면 최소 network policy가 아니다.

**수정안:** URL fetch를 daemon의 network adapter로 옮긴다. Policy가 HTTPS/domain/DNS/private-IP/redirect/MIME/size를 검증하고 bytes를 MessagePack binary로 plugin에 보내 `createImage`를 호출한다. Plugin manifest는 loopback만 허용한다. `import_image.url`은 server special handler가 되고 original plugin URL fetch path는 제거한다.

### A-IP-I04 — configured workspace root를 설정하는 authority가 없다

Global constraint와 WorkspacePolicy는 configured roots를 요구하지만, config file/schema, startup arg, control endpoint, CLI command가 없다(`plan:24,533-545`). `doctor`는 no workspace를 진단하지만 사용자가 해결할 방법이 정의되지 않았다.

**수정안**

- `service/packages/shared/src/config.ts`와 daemon config store를 추가한다.
- v0.1은 startup `--workspace <path>` 반복 또는 authenticated CLI `workspace add/list/remove` 중 하나를 binding interface로 선택한다.
- Root 등록 자체는 explicit user approval과 realpath를 요구하고 operation 중 raw `rootDir`가 새 root를 만들지 못하게 한다.
- Task 3/5/10와 DoD에 config lifecycle test를 추가한다.

### A-IP-I05 — IR package dependency와 large full snapshot algorithm이 빠졌다

Section 6은 `ir`가 Zod와 Node crypto/fs만 사용한다고 적지만 `SnapshotV1.observed`는 shared의 `GetDesignContextResult`다(`plan:546-585,610-622`). 따라서 `@sfp/shared` dependency가 필요하거나 observed schema를 IR package로 옮겨야 한다.

또한 public full context는 1,500 node bail/section plan으로 degrade한다. Task 8은 “persisted full observed snapshot”을 요구하지만 section을 순회·merge하는 algorithm, memory limit, partial failure semantics가 없다(`plan:1060-1108`). Internal raw full을 한 번에 읽으면 Figwright가 피하려던 timeout/memory risk가 돌아온다.

**수정안**

- `@sfp/ir`에 `@sfp/shared` workspace dependency를 명시하거나 canonical observed schema의 ownership을 재배치한다.
- Snapshot capture는 sectionPlan iterator로 각 section을 같은 session에 pin해 읽고 deterministic hierarchy로 merge한다.
- fidelity에 `completeSections`, `failedSections`, `sectionsOmitted`를 기록한다.
- 10k-node fixture에서 bounded memory/progress/cancel test를 추가한다.

### A-IP-I06 — fileKey null fallback이 stable file identity가 아니다

Task 7은 fileKey가 없으면 “session-bound fileName hash”를 사용한다(`plan:1034-1041`). Session은 plugin restart/grace 이후 바뀌고 서로 다른 파일의 같은 이름은 충돌한다. design_diff cross-file bug를 완전히 해결하지 못한다.

**수정안:** editable Figma Design v0.1에서는 document root pluginData에 generated UUID를 저장하거나, user-confirmed local file identity registry를 사용한다. fileKey가 있으면 authority로 쓰고, 없으면 stable UUID를 사용한다. fileName/sessionId는 display/provenance일 뿐 identity key가 아니다. UUID 생성 mutation은 1회 명시·audit하고 Dev read-only에서는 snapshot feature를 capability-negative로 처리한다.

### A-IP-I07 — pairing UX·endpoint·Windows token storage가 불명확하다

- 사용자가 직접 입력할 code를 128-bit base32로 만들면 약 26자로 UX가 비현실적이다(`plan:458-480`).
- Pair challenge 생성/교환 endpoint와 Origin/content-type/rate policy가 없다.
- follower token을 leader-lock에 넣을 경우 Windows의 POSIX mode 0600은 ACL 보장을 하지 않는다.
- leader handoff 시 token rotation/old token rejection test가 없다.

**수정안:** 128-bit secret은 내부/QR payload로 두고 manual code는 짧은 human code + 5분/attempt/rate limit로 보호하거나 QR/deep link를 제공한다. `/pair/challenge`, `/pair/exchange` contract를 명시한다. Windows는 current-user ACL/DPAPI 또는 named pipe를 사용한다. leader generation마다 follower token을 회전하고 old token을 거부하는 test를 추가한다.

### A-IP-I08 — journal 위치·record·idempotency conflict 규칙이 부족하다

Journal을 `{workspace}/.sfp`에 둔다고 했지만 Figma-only write, 여러 workspace, workspace 미설정 호출의 위치가 정의되지 않았다(`plan:494-531`). Record도 approval/audit 요구에 부족하다.

**수정안:** daemon state journal과 project snapshot store를 분리한다. Operation journal은 user-local service state dir에 두고 workspaceId를 record한다. Project `.sfp`에는 snapshot/mapping만 둔다. Same ID with mismatched argsHash/tool/actor/workspace/session을 conflict로 거부한다. Compaction crash/partial-line/fsync recovery와 10k cap behavior test를 추가한다.

### A-IP-I09 — Egress type과 progress end-to-end wiring이 없음

Task 4는 egress test를 잘 요구하지만 sensitivity taxonomy/manifest interface가 없다. Task 9의 progress는 pure timeout helper test뿐이고 어느 plugin handler가 progress event를 보내며 relay/MCP/CLI가 어떻게 소비하는지 없다(`plan:836-899,1110-1158`). Dead utility가 될 수 있다.

**수정안**

- `DataClass = public | project-code | design-text | design-image | secret`와 `EgressManifest` schema를 shared에 추가한다.
- Tool policy/result schema가 field classifier를 제공하고 CallToolResult 전에 sanitize한다.
- Progress envelope, plugin/UI producer API, relay idle extension, MCP progress notification/CLI rendering을 end-to-end test한다.
- 실제로 progress를 내는 export/snapshot/scan 최소 2개 handler를 Task 9 Files에 지정한다.

### A-IP-I10 — approve CLI와 explicit undo boundary 구현이 빠졌다

Structure에는 `approve.ts`가 있으나 Task 10 Required cases에 pending approval list/approve/reject command가 없다(`plan:364-395,1164-1216`). Task 12는 승인·거절과 undo boundary를 검사하지만 어느 task가 `figma.commitUndo()`를 write/batch 경계에 추가하는지 명시하지 않는다.

**수정안:** Task 10에 `approvals list`, `approve <id>`, `reject <id>` test를 추가한다. Task 4/6에서 successful top-level write 또는 approved batch당 explicit `figma.commitUndo()` policy를 구현하고 중첩 batch가 이중 commit하지 않게 한다. Real Figma acceptance는 “Ctrl/Cmd+Z 한 번의 영향 범위”를 증거로 기록한다.

### A-IP-I11 — Motion/video disposition과 ledger가 충돌한다

Capability ledger는 Motion 7+video 1을 v0.1 `deferred`/shipping inactive로 분류했다. Plan은 112 tool을 모두 광고하고 Motion/video를 experimental capability로 유지하며 live smoke까지 요구한다(`plan:20,73-86,953-990,1293-1310`). 둘 다 가능한 정책이지만 manifest/disposition source가 둘로 갈린다.

**수정안:** binding 결정을 하나로 고정한다. 최대 기능 보존 관점에서는 `experimental-native` 상태를 union manifest에 새로 추가하고, tool은 광고하되 editor/capability preflight로 실행을 제한하는 현재 plan이 낫다. Ledger의 `deferred 8`과 v0.1 count 50/56/8을 갱신하고 docs-sync test가 같은 의미를 강제해야 한다.

### A-IP-I12 — macOS acceptance hard gate의 실행 책임이 없음

DoD는 Windows와 macOS actual Figma acceptance를 모두 요구한다(`plan:1275-1329,1359-1366`). 현재 환경 하나에서 task-by-task agent가 macOS Figma를 실행할 수 없다. 이 gate 자체는 타당하지만 evidence owner, manual checklist signer, artifact format, block 처리 규칙이 없다.

**수정안:** Task 12를 automated harness 구현과 human-run acceptance evidence 두 deliverable로 나눈다. JSON result schema, app/Figma/plugin/service versions, timestamp, operator, screenshots/hash, failed/waived fields를 정의한다. 두 OS evidence 없으면 Task 12를 “blocked awaiting external acceptance”로 남기고 v0.1 complete를 선언하지 않는다.

### A-IP-I13 — independent spec/quality review checkpoint가 task body에 없음

Header는 모든 task에 independent spec/quality review를 요구하지만 각 Step 4는 generic self-review뿐이다(`plan:3`, 각 Task Step 4). Subagent-driven implementation에서 self-review는 independent review가 아니다.

**수정안:** 각 Task에 다음 두 checkpoint를 명시한다.

1. Spec reviewer: RED/GREEN이 task 요구·binding spec을 충족하는지 확인.
2. Quality reviewer: diff, security, tests, maintainability 검토.

Finding이 있으면 implementer가 수정하고 focused+broader verification을 재실행한 뒤 commit한다. Step 4의 “broader verification” command도 package별로 구체화한다.

## 5. Minor Finding

### A-IP-M01 — policy는 복합 effects와 final 116을 focused gate로 재검증해야 한다

Task 2는 local tool을 filesystem effect로만 예시하지만 component/token/icon map은 `filesystem-read + figma-read`, save/export는 `figma-read + filesystem-write`, design_diff는 두 effect를 함께 가진다. Task 9가 4 tool을 추가한 뒤 focused GREEN에 operation-policy test가 없다.

**수정안:** 복합 effect exact set을 assert하고 Task 9 GREEN에 `operation-policy.test.ts`를 추가해 116/116 coverage를 확인한다.

### A-IP-M02 — final server-only exception exact set은 10개다

Final tools 116, plugin handlers 106이므로 no-same-name exception은 10개다. Original 7에 `doctor`, `export_tokens`, `export_frames_to_pdf`가 추가되고 `import_library_variable`는 handler가 있다. Task 9/DoD에 count와 exact set을 명시한다.

### A-IP-M03 — Task 11 RED의 provenance 부재는 이미 Task 1에서 해결된다

Task 1이 complete upstream-lock/provenance를 GREEN으로 만든다. Task 11 expected failures에 “upstream provenance absent/incomplete”를 고정하면 정상 dependency 상태와 맞지 않는다(`plan:687-723,1227-1255`). Task 11 RED는 artifact packaging/docs/skills에만 한정한다.

### A-IP-M04 — Files path는 항상 workspace-root 상대경로로 쓴다

Task 3~10은 `shared/src/...`, `mcp/src/...`처럼 `service/packages/` prefix를 생략한다. 병렬 subagent가 repository root와 package cwd를 다르게 해석할 수 있다. 모든 Files 항목을 `service/...` 또는 명시적 “paths below are relative to service/packages/X”로 통일한다.

## 6. RED/GREEN별 판정

| Task | RED가 현재 missing behavior를 겨냥하는가 | 판정/수정 |
|---:|---|---|
| 1 | parity behavior는 missing | **수정 필요:** runner bootstrap 전에는 behavior RED가 아님; Task 분할 |
| 2 | side-effect policy missing | 적절; 복합 effects와 final 116 재검증 추가 |
| 3 | pairing/auth/body/path missing | 대체로 적절; `/control/tools/call`은 Task 4로 이동 |
| 4 | queue/approval/idempotency/egress missing | 적절; InvocationContext와 mismatch ID cases 추가 |
| 5 | path sandbox/atomic adapter missing | 적절; workspace config lifecycle 추가 |
| 6 | plugin pairing/editor/approval missing | 적절; import-variable handler는 Task 9로 이동, URL fetch topology 수정 |
| 7 | token cross-session/design diff collision missing | 적절; stable file UUID로 수정 |
| 8 | IR/store missing | 적절; shared dependency와 section capture 추가 |
| 9 | safe-union tools/progress missing | **PDF engine 결정 전 GREEN 불가**; progress E2E 추가 |
| 10 | CLI missing | 적절; approve/reject/workspace commands 추가 |
| 11 | artifact/docs 일부 missing | provenance RED 항목만 제거 |
| 12 | live plugin absent | 적절; external OS evidence workflow 명시 |

## 7. Header·Global Constraint 판정

| 확인 항목 | 판정 |
|---|---|
| 원본 read-only, standalone vendor | PASS |
| Node24/pnpm/TS strict baseline | PASS |
| v0.1 Desktop editable Design scope | PASS |
| non-loopback/raw/Web/view-only 제외 | PASS |
| 116 tools / 106 handlers 산술 | PASS, Task 6/9 intermediate ordering 수정 필요 |
| 114+20+12 union invariant | PASS |
| filesystem/side effects/queue/idempotency/outcome unknown | PASS, interface context 보강 필요 |
| loss-aware observed snapshot | PASS, section capture algorithm 필요 |
| model egress | PASS 방향, shared classifier schema 필요 |
| MIT/CC BY exclusion/artifact test | PASS |
| automated+live completion | PASS, macOS evidence owner 필요 |
| Motion/video/URL 최대 기능 보존 | PASS 의도, disposition 및 URL topology 수정 필요 |

## 8. 최종 수정 우선순위

1. Task 6/9 handler-tool ordering, Task 3/4 control dependency, PDF engine 결정을 먼저 고친다.
2. InvocationContext/OperationRecord/idempotency conflict를 binding interface로 확정한다.
3. Task 1 bootstrap과 Task graph를 수정한다.
4. URL fetch를 daemon으로 이동하고 workspace config authority를 추가한다.
5. Stable file identity와 section-based snapshot capture를 설계한다.
6. pairing UX/Windows secrets, approve CLI/undo boundary, egress/progress interfaces를 보강한다.
7. Motion/video disposition, final policy116/exception10, external acceptance evidence를 sync한다.
8. 모든 Task에 independent spec/quality review와 구체적 broader command를 추가한다.

Critical 네 건을 해결하기 전에는 이 plan을 subagent-driven implementation에 그대로 넘기면 안 된다. 수정 후에는 v0.1 경계, safe union 보존, security-first 순서가 충분히 구체적이어서 실행 계획으로 사용할 수 있다.
