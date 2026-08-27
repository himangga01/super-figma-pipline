# Agent B 독립 리뷰 — Super Figma Pipeline v0.1 구현 계획

> 대상: `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md`  
> 대조: binding `05-unified-service-proposal.md`, `04-detailed-comparison.md`, `agent-a-capability-union-input.md`, 세 원본 source  
> 기준일: 2026-08-27 (Asia/Seoul)  
> 원칙: plan 본문과 원본 OSS는 수정하지 않고 실행 가능성만 검토

## 1. 총평

계획은 program architecture로서는 강하다.

- 요구된 header와 Global Constraints를 갖췄다.
- Figwright 112 tools/105 handlers를 retain하고 Rust unique 2, `doctor`, `import_library_variable`를 더한 116/106 invariant가 산술·구현 위치상 맞다.
- lexical union 114 + figmosha helper 20 + parser 12를 별도 manifest로 고정한다.
- standalone `service/` vendoring, upstream provenance, Desktop-only v0.1, raw/non-loopback/Web defer가 명확하다.
- pairing, body cap, side-effect policy, per-session queue, in-flight idempotency, outcome-unknown, path sandbox, artifact license gate를 source defect와 연결했다.
- full vision을 v0.2 이후로 분리해 binding 05보다 현실적이다.

그러나 현재 문서는 `superpowers:writing-plans`가 요구하는 **task-by-task executable implementation plan**이 아니라 상세 program plan에 가깝다. 12개 task 모두 task-specific interface와 실제 implementation content 없이 같은 placeholder를 반복하며, 일부 RED는 예상한 behavior failure까지 도달하지 못한다. 조건부 side effect type과 PDF dependency에는 GREEN 자체가 불가능한 모순도 있다.

판정은 **수정 후 실행 가능**이다. 아래 Critical을 고치기 전에는 `subagent-driven-development`로 넘기지 않는 것이 안전하다.

## 2. Finding 요약

### Critical

| ID | 요약 |
|---|---|
| B-C-01 | 12 task 모두 `Interfaces` block이 0개이고, implementation step이 placeholder라 fresh subagent가 독립 실행할 계약이 없다. |
| B-C-02 | 다수 RED가 실제 behavior failure가 아니라 missing workspace/module/script에서 먼저 실패하며 Task 3은 Task 4 interface를 선행 요구한다. |
| B-C-03 | `OperationPolicy.effects`가 정적 배열이라 `import_image(url)`와 `export_tokens(outPath)`의 조건부 effect/approval을 표현할 수 없다. |
| B-C-04 | `export_frames_to_pdf` multi-page merge를 Must로 두면서 v0.1 PDF dependency/Rust worker를 금지한다. Figwright에는 single-page export만 있어 GREEN 불가다. |
| B-C-05 | “모든 filesystem access는 workspace root”와 temp leader lock·pairing/state·workspace 미지정 Figma operation journal이 충돌한다. |

### Important

| ID | 요약 |
|---|---|
| B-I-01 | Task dependency graph가 Task 3의 control pipeline→Task 4, Task 4 journal→Task 5 state/path를 역참조한다. |
| B-I-02 | standalone root 구조에 `.gitignore`/`.gitattributes`/`.editorconfig`와 release workflow가 없어 Windows fidelity와 실제 배포가 plan에 없다. |
| B-I-03 | pairing exchange endpoint·PNA·Windows token ACL과 128-bit “code”의 사용자 전달 방식이 interface로 정의되지 않았다. |
| B-I-04 | Workspace sandbox test가 write mutation만 structural scan하고 profile/token/icon/scan의 direct read·symlink escape를 빠뜨릴 수 있다. |
| B-I-05 | SnapshotV1의 `observed`를 public budget-degraded context가 아닌 complete section-assembled snapshot으로 얻는 알고리즘이 없다. |
| B-I-06 | official MCP build-vs-buy가 DoD에만 있고 생성 file/task/test에는 `use_figma`/`generate_figma_design`가 없다. |
| B-I-07 | live acceptance가 요구하는 per-command `commitUndo` implementation과 macOS/team-library fixture owner가 없다. |
| B-I-08 | capability ledger의 Motion/video `deferred`와 plan의 116 advertised experimental retention 표현, common tool의 source schema hash 모델이 충돌한다. |
| B-I-09 | external model egress 여부를 stdio MCP source만으로는 알 수 없는데 policy가 `external-MCP mode`를 전제한다. |
| B-I-10 | 8~12주/2명 program을 12개의 거대 task로 둬 review gate가 너무 크다. milestone별 별도 plan으로 분리해야 한다. |

### Minor

| ID | 요약 |
|---|---|
| B-M-01 | Task 3 이후 file path가 `service/packages/...`가 아닌 `shared/src`, `mcp/src` 등으로 축약되어 exact path 규칙과 어긋난다. |
| B-M-02 | 모든 Task Step 4가 “broader verification/self-review/commit”만 쓰고 실제 command·git add 대상이 없다. |
| B-M-03 | progress contract는 timer unit test만 있고 실제 scan/export producer→relay→CLI integration test가 없다. |
| B-M-04 | 새 server-only tool 3개를 반영한 no-same-name handler exception count 10이 exact invariant로 고정되지 않았다. |
| B-M-05 | fallback file identity가 “session-bound fileName hash”로만 표현돼 reconnect/restart 후 baseline continuity 규칙이 모호하다. |

## 3. Critical 상세

### B-C-01. 이 문서는 executable task plan 형식을 충족하지 않는다

계획은 12개 `### Task N`을 갖고 있지만:

- `**Interfaces:**` block은 **0개**다.
- `Implement only the files and interfaces required by the RED cases`가 **12회** 반복된다.
- `Run the broader task verification, self-review the diff, and commit`도 **12회** 반복된다.
- Task 1은 약 600개 Figwright source/test vendoring, package namespace rewrite, root scaffold, lock/manifest 생성까지 한 review unit이다.
- Task 3/4/5/6은 각각 security/executor/filesystem/plugin subsystem 전체다.

근거: plan `675-1329`. `superpowers:writing-plans`는 각 task에 exact Files, Consumes/Produces interface, 실제 implementation code, focused command, commit command를 요구하고 placeholder implementation을 금지한다.

**정확한 수정안**

현재 문서를 “Program Plan”으로 유지하고 다음 milestone plan으로 쪼갠다.

1. `v0.1a-vendor-parity.md`: scaffold→vendor→namespace→lock→112/105 parity.
2. `v0.1b-security-control-plane.md`: effect resolver→state roots→pairing/auth/body limits.
3. `v0.1c-execution-filesystem.md`: queue/journal/approval→workspace adapter.
4. `v0.1d-plugin-grounding.md`: plugin auth/capabilities→session/diff fixes→snapshot.
5. `v0.1e-union-cli-release.md`: tools/PDF/token/doctor→CLI→artifact→live acceptance.

각 하위 task에는 다음 block이 필요하다.

```markdown
**Interfaces**
- Consumes: exact exported type/function and prior task
- Produces: exact signature and invariant

- [ ] Write this exact test body
- [ ] Run exact command; expect exact assertion failure
- [ ] Add this concrete implementation/schema
- [ ] Run focused + named regression suites
- [ ] git add exact files && git commit -m "..."
```

Task 1은 최소 `scaffold harness`, `vendor copy/hash`, `namespace/config`, `baseline parity` 네 review unit으로 분리한다.

### B-C-02. RED command와 expected failure가 여러 task에서 일치하지 않는다

현재 workspace에는 `service/`가 없다. 따라서 Task 1의 첫 command:

```powershell
pnpm -C service exec vitest run test/upstream-parity.test.ts
```

는 `Cannot resolve @sfp/mcp tool registry`가 아니라 먼저 “service directory/package manifest/test runner 없음”으로 실패한다 (`plan:687-706`). 같은 문제가 새 module을 import하는 Task 2/4/5/6에 반복된다.

| Task | 현재 RED의 실제 첫 실패 | plan expected와의 차이 | 수정 |
|---:|---|---|---|
| 1 | `service`/package/test file 없음 | registry resolve까지 도달 못함 | Task 0 scaffold 또는 Task 1A에서 minimal package+Vitest 먼저 GREEN |
| 2 | `operations.ts`/policy module 없음 | “policy missing for ping” assertion 전 module resolution fail | interface stub을 먼저 만들고 empty map을 domain RED로 사용 |
| 3 | pairing/auth module 없음; 기존 Host/Origin test는 behavior RED 가능 | `/control/tools/call` same pipeline은 Task 4 ToolInvocationService가 없음 | Task 3은 auth/body만; control invocation proof는 Task 4로 이동 |
| 4 | executor/journal/policy modules 없음 | concurrent behavior test 실행 전 import fail | interfaces+in-memory fake scaffold를 prior task에서 생산 |
| 5 | WorkspacePolicy/AtomicFileStore 없음 | path assertion 전 import fail | interface stub+unsafe passthrough fake를 RED fixture로 제공 |
| 6 | TabPairing/composable/auth protocol 없음 | existing plugin behavior와 new UI import failure 혼합 | sandbox auth protocol과 UI rendering을 별도 tasks로 분리 |
| 7 | 실제 source bug가 존재 | token session mix, snapshot collision, flap timeout은 genuine RED | 유지 |
| 8 | schema/store 없음 | plan도 missing schema RED로 명시 | 허용하되 expected를 module-not-found로 정확히 쓰거나 stub |
| 9 | registry112/tools/progress 없음 | genuine absence RED | 유지; PDF dependency C-04 해결 필요 |
| 10 | CLI package 없음 | plan이 missing modules RED로 명시 | 허용; minimal CLI scaffold를 Step 1에 포함 |
| 11 | earlier packaging/skills가 불완전 | genuine artifact/docs RED 가능 | exact built artifact fixture 경로 추가 |
| 12 | `desktop-acceptance.mjs` 없음 | `PLUGIN_NOT_CONNECTED`까지 도달 못함 | script harness test를 Task 11에서 만들고, Task 12 RED는 paired plugin absence |

RED가 compile/module failure여도 TDD상 가능하지만, plan이 domain failure를 기대한다면 그 domain까지 도달하는 harness는 선행 task의 Produced interface여야 한다.

### B-C-03. 정적 `effects` type으로 조건부 policy를 구현할 수 없다

계획의 `OperationPolicy`는:

```ts
effects: readonly Effect[];
```

인 정적 metadata다 (`plan:439-453`). 그런데 required behavior는:

- `import_image`가 `url`일 때만 network effect/approval;
- base64 `data`일 때는 network effect 없음 (`plan:747-756`);
- `export_tokens`가 `outPath`일 때만 filesystem-write;
- content-only 호출은 runtime read-only (`plan:587-604,1134-1140`).

정적 array로는 둘을 구분할 수 없다. 항상 network/write로 표시하면 기능은 되지만 최소 권한·approval UX requirement를 위반하고, 항상 read로 두면 security를 위반한다.

**정확한 수정안**

```ts
export interface OperationPolicy {
  toolName: string;
  effectsFor(args: Readonly<Record<string, unknown>>): readonly Effect[];
  idempotencyFor(args: Readonly<Record<string, unknown>>): IdempotencyClass;
  approvalFor(effects: readonly Effect[]): ApprovalClass;
  concurrency: ConcurrencyClass;
}
```

MCP annotation은 모든 가능한 args의 effect union으로 보수적으로 생성하고, runtime policy/approval은 parsed args에 `effectsFor`를 실행한다. Task 2 test에 data-vs-url, content-vs-outPath, design_diff baseline/update를 넣는다.

### B-C-04. multi-page PDF GREEN에 필요한 engine이 없다

Plan은 `export_frames_to_pdf`가 ordered node PDFs를 merge하도록 요구한다 (`plan:1110-1158,1299-1302`). 그러나 dependency 표는 “v0.1에는 SQLite/PDF/Rust dependency를 추가하지 않는다”고 명시한다 (`plan:608-623`).

Figwright source의 `export_pdf`는 한 node를 **single-page PDF**로 export/write할 뿐 merge engine이 없다 (`code-kb/figwright/packages/mcp/src/tools/export-pdf.ts:10-68`; `packages/plugin/src/handlers/export-pdf.ts:5-40`). Rust의 merge는 `lopdf` code이며 plan은 Rust worker를 defer한다.

따라서 “existing PDF engine through same policy/path sandbox”는 존재하지 않고 Task 9 GREEN이 불가능하다.

**선택지**

1. v0.1에 MIT-compatible Node PDF dependency(예: `pdf-lib`)를 명시하고 `pdf-merge.ts`를 구현한다. valid two-page, mixed size, corrupt input, metadata/resource preservation fixture와 SBOM/license를 추가한다.
2. Rust `lopdf` worker를 v0.1 dependency로 당기고 packaging scope를 수정한다.
3. `export_frames_to_pdf`를 registry compatibility stub로 두고 `CAPABILITY_DEFERRED`를 반환하며 tool count 116은 유지한다. 그러면 live DoD의 positive multi-page export는 후속으로 옮긴다.

“최대한 합집합 + 실제 동작” 요구에는 1번이 가장 일관적이다.

### B-C-05. service state와 workspace filesystem 경계가 모순된다

Global Constraint는 “모든 filesystem access는 configured workspace roots 안”이라고 한다 (`plan:24`). 동시에:

- pairing/follower credentials와 leader lock이 필요하다;
- 기존 leader lock은 OS temp에 있다;
- operation journal은 `{workspace}/.sfp`에 둔다 (`plan:529-531`);
- Figma-only call은 code workspace 없이도 실행 가능해야 한다;
- user source tree에 operational auth/journal state를 넣는 것은 backup/commit/privacy 문제를 만든다.

Task 4가 restart-persistent journal을 요구하지만 WorkspacePolicy는 Task 5에 생겨 dependency도 역전된다.

**정확한 수정안**

두 capability root를 분리한다.

```ts
interface RuntimePaths {
  stateRoot: string;      // OS app-data, owner-only ACL; auth, leader, journal index
  workspaceRoots: string[]; // user-approved source/export/snapshot roots
}
```

- auth secret/leader lock/operation journal은 `stateRoot` 아래에 owner-only ACL로 둔다.
- workspace별 record는 root hash로 namespace하고 raw args/content는 저장하지 않는다.
- export/snapshot/code scan만 WorkspacePolicy를 통과한다.
- Windows ACL과 Unix 0700/0600을 별도 test한다.
- Task 5의 RuntimePaths/StateStore를 Task 3/4 전에 생산하도록 graph를 바꾼다.

## 4. Important 상세

### B-I-01. dependency graph를 재배열해야 한다

현재 graph는 Task 2에서 Task 3/4/5를 병렬 분기한다 (`plan:654-669`). 하지만:

- Task 3 test의 `/control/tools/call` same pipeline은 Task 4 `ToolInvocationService`를 필요로 한다.
- Task 4 persistent journal은 Task 5 path/state adapter를 필요로 한다.
- Task 6 approval UI는 Task 4 control approval endpoint를 소비한다.
- Task 7 flap state는 Task 4 operation outcome model을 소비한다.

권장 순서:

```text
1A scaffold → 1B vendor parity
→ 2 policy types + conditional resolver
→ 3 runtime paths/workspace primitives
→ 4 pairing/follower auth/body cap
→ 5 operation executor/control/queue/journal
→ 6 plugin pairing+approval+undo boundary
→ 7 grounding/reconnect correctness
→ 8 snapshot
→ 9 union tools
→ 10 CLI
→ 11 artifacts/docs
→ 12 live
```

각 task의 Interfaces/Consumes/Produces에 이 dependency를 명시한다.

### B-I-02. standalone root hygiene와 release path가 빠졌다

`service/` tree에는 `.gitignore`, `.gitattributes`, `.editorconfig`가 없다 (`plan:181-405`). 원 Figwright AGENTS는 `.gitattributes` LF 고정이 Windows `format:check` 회귀를 막는 핵심이라고 명시한다. `node_modules`, `dist`, `coverage`, `.sfp`도 ignore가 필요하다.

또 Task 11은 CI workflow만 만들고 npm/plugin GitHub release workflow, package version/tag/release command를 만들지 않는다. Artifact content test와 실제 distributable publish path는 다르다.

**추가 파일**

- `service/.gitignore`, `.gitattributes`, `.editorconfig`, 선택 `.npmrc`.
- root `.github/workflows/service-release.yml` 또는 standalone extraction 이후 사용할 exact template.
- package name/version/bin/files/export map과 `pnpm pack`/plugin ZIP 생성 command.
- lockfile은 namespace/dependency 변경 후 생성하고 frozen CI에서 검증.

### B-I-03. pairing protocol의 bootstrap과 OS storage가 불명확하다

128-bit base32 값은 약 26자다. 사람이 타이핑하는 “code”라기보다 copy/paste secret이다 (`plan:458-480`). 다음이 없다.

- plugin이 ticket을 받는 exact HTTP path/method/schema;
- pairing endpoint의 Host/Origin/PNA/content-type/body cap;
- code를 daemon/CLI가 생성·표시하고 plugin panel이 제출하는 sequence;
- Windows에서 follower/session token을 owner-only로 보관하는 ACL;
- daemon restart 후 re-pair/rotation UX.

`POST /control/pair/exchange` 같은 explicit contract와 sequence diagram을 Task 3에 추가한다. 수동 입력을 원하면 짧은 code+attempt/rate limit을 쓰고, 128-bit 값은 “pairing secret”으로 copy/paste하게 명명한다.

### B-I-04. filesystem read 경로도 sandbox adapter로 강제해야 한다

Task 5는 local tools의 direct filesystem **mutation** structural scan을 요구한다 (`plan:901-947`). 그러나 Figwright profile/token/icon/component scan 내부에는 `readFile(join(root,...))`가 여러 모듈에 분산돼 있고 symlink file이 approved root 밖을 가리킬 수 있다.

`analyze_project` entry에서 root만 한 번 validate하는 것으로는 모든 descendant realpath를 보장하지 않는다. `repo-walk`가 반환하는 각 path의 read를 `WorkspacePolicy.resolveRead`로 통과시키고, structural test는 `node:fs`/`node:fs/promises` direct read/write import를 approved adapter file 밖에서 모두 금지해야 한다. dependency lock/package reads처럼 service-owned file은 State/Install capability로 별도 분류한다.

### B-I-05. persisted “full observed snapshot” 획득 방법이 없다

`SnapshotV1.observed`는 `GetDesignContextResult`이고 “budgeted projection은 persisted full observed를 mutate하지 않는다”고 test한다 (`plan:546-585,1080-1091`). 그러나 public Figwright path는 1,500-node pre-bail, 24k token degradation, 최대 60 section plan을 쓴다.

`capture-snapshot.ts`가 무엇을 호출하고 section을 어떻게 merge하는지 없으면:

- degraded layout-only를 full로 저장;
- omitted section을 `truncated:false`로 기록;
- raw unbounded tree를 한 번에 받아 memory 폭증;

중 하나가 된다.

Task 8 interface에 `SnapshotReader.captureFull(sessionId,target,budget)`를 정의하고 section plan→pinned section fetch→stable ordered merge→fidelity flags 알고리즘을 넣는다. >1,500 nodes, >60 sections, disconnect mid-section test가 필요하다.

### B-I-06. official MCP build-vs-buy DoD를 생산하는 task/file이 없다

Legal/docs DoD는 official current write/code-to-canvas가 build-vs-buy docs에 있어야 한다고 한다 (`plan:1368-1374`). 하지만 file tree에 `build-vs-buy.md`가 없고 Task 11 required test는 limit URLs만 검사하며 `use_figma`/`generate_figma_design`를 명시하지 않는다 (`plan:1218-1269`).

`service/docs/build-vs-buy.md`를 Task 11에 추가하고 다음을 docs-sync test에 고정한다.

- official `use_figma` write-to-canvas;
- `generate_figma_design` live UI capture;
- design-system search/assets;
- checked URLs/date;
- seat/permission/current limitations;
- no runtime numeric constants.

### B-I-07. undo boundary와 live acceptance 외부 전제가 구현 task에 없다

Task 12는 delete의 audit/undo boundary를 검증한다 (`plan:1293-1325`). 현재 Figwright plugin에는 `figma.commitUndo()` 호출이 0개이고 Task 6 files/required cases에도 구현 rule이 없다.

Task 6에:

- standalone write 성공 후 one boundary;
- batch는 전체 apply/compensation 뒤 one boundary;
- navigation/read는 boundary 없음;
- failed/no-op/rollback case;

를 dispatcher/registry policy와 real Figma test로 추가한다.

또 release gate는 Windows와 macOS live acceptance를 모두 요구하지만 execution environment/owner가 지정되지 않았다. Positive `import_library_variable`는 accessible published library key와 teamlibrary permission/plan이 필요하다. 다음을 구분한다.

- blocking Windows/macOS owner+machine evidence;
- conditional paid/team-library fixture;
- permission-denied negative test;
- secret fixture provisioning procedure.

환경이 없으면 Task 12는 code task가 아니라 external release checklist로 남아 완료를 block한다는 점을 명시한다.

### B-I-08. union ledger의 deferred와 advertised 상태를 분리해야 한다

Capability input은 Motion 7+video 1을 v0.1 `deferred`로 분류하지만 plan은 112 전부를 registry에 남겨 experimental/capability-gated 상태로 광고한다 (`plan:20-22,54-55,988-990`). 둘 다 가능하지만 manifest field 하나의 `disposition`으로는 모순처럼 보인다.

다음처럼 분리한다.

```json
{
  "registration": "advertised",
  "availability": "experimental-capability-gated",
  "investment": "deferred"
}
```

또 71 common name은 Rust schema hash와 Figwright schema hash, canonical target hash가 각각 필요하다. singular `schema hash` 대신 `sourceContracts[]`와 `targetContractHash`를 둔다. Handler exception도 old 7 + new server-only 3 = exact 10으로 Task 9/11에서 고정한다.

### B-I-09. model egress mode는 stdio source에서 자동 판별할 수 없다

Task 4는 “local-only deterministic calls do not egress; external-MCP mode는 redaction/consent”를 요구한다 (`plan:845,881-882`). 하지만 service는 stdio MCP client가 결과를 local model에 쓰는지 cloud provider로 보내는지 알 수 없다.

`ToolInvocationService.source='mcp'`만으로 egress mode를 추론하지 말고 explicit connector config를 둔다.

```ts
type EgressMode = 'local-trusted' | 'external-model' | 'unknown-fail-closed';
```

Default는 `unknown-fail-closed` 또는 external-model이어야 하고, client/user가 pairing/config에서 선택하며 audit에 기록한다.

### B-I-10. 8~12주 program은 milestone별 실행 계획이어야 한다

계획 자체도 2명 8~12주라고 적는다 (`plan:88-95`). 이는 한 agent session의 12-task plan이 아니라 multi-milestone product program이다. 각 Milestone A~D를 독립 plan/branch/release candidate로 만들고, 이전 milestone artifact를 다음 plan의 immutable input으로 삼아야 한다. 특히 Task 1·3·4는 한 reviewer가 reject/approve할 수 있는 크기로 더 나눈다.

## 5. Minor

### B-M-01. exact path 표기

Task 3 이후 `shared/src/auth.ts`, `mcp/src/...`, “modify plugin manifest”처럼 `service/packages/...` prefix가 생략된다. 모든 task Files를 absolute workspace-relative path로 통일하고 modify line은 vendoring 후 symbol 기준을 함께 쓴다.

### B-M-02. broader verification/commit command

각 Step 4에 focused suite 외 어떤 broader command를 실행할지, `git diff --check`/status, `git add` 대상, commit command를 적는다. Task 1/3/4/11은 최소 `pnpm -C service verify` 전부를 돌리기 비싸므로 milestone-specific aggregate script도 정의한다.

### B-M-03. progress end-to-end

Task 9의 progress test는 idle/absolute timer만 고정한다. 실제 `export_frames_to_pdf` 또는 scan이 progress event를 emit하고 relay/control/CLI가 전달하며 cancel/absolute timeout이 작동하는 integration test를 추가한다.

### B-M-04. handler exception invariant

116 tools, 106 handlers이면 same-name handler가 없는 tool은 정확히 10개다: 기존 7 + `export_tokens`, `export_frames_to_pdf`, `doctor`. `import_library_variable`만 handler를 추가한다. exception set을 exact test와 capability manifest에 고정한다.

### B-M-05. fallback file identity continuity

`fileKey`가 없을 때 `session-bound fileName hash`는 same-name collision은 줄여도 plugin/daemon restart 후 identity가 바뀐다. v0.1은 safe non-collision을 우선하되 “restart 후 baseline 자동 연결 안 함”을 명시하고, user-confirmed migration command만 제공한다.

## 6. 12개 Task RED 판정

| Task | RED 판정 | GREEN 가능성 | 결론 |
|---:|---|---|---|
| 1 | harness 미존재로 expected mismatch | scaffold 후 가능 | 분할 필수 |
| 2 | 새 module import에서 먼저 실패 | stub 후 가능 | interface producer 필요 |
| 3 | core auth/body bugs는 genuine; control pipeline은 Task4 dependency | 일부 가능 | auth/control 분리 |
| 4 | module missing RED | conditional policy/state root 고친 뒤 가능 | 선행 interface 필요 |
| 5 | module missing RED | read/write 전 경로 adapter화 후 가능 | 범위 확대 |
| 6 | existing unpaired behavior는 genuine; 새 UI import mixed | auth protocol/UI 분리 후 가능 | undo rule 추가 |
| 7 | session mix/collision/flap 모두 genuine | 가능 | 좋은 regression task |
| 8 | missing schema/store expected | full capture algorithm 추가 후 가능 | reader interface 필요 |
| 9 | missing tools/count/progress genuine | PDF engine 없이는 불가 | C-04 blocker |
| 10 | missing CLI expected | control API 이후 가능 | path/scaffold 명시 |
| 11 | artifact/docs RED genuine | release workflow 추가 후 가능 | package fixture 필요 |
| 12 | script missing이 먼저 발생 | Task11 harness+external env 후 가능 | external gate로 분리 |

## 7. 확인된 강점

다음은 수정 없이 유지해도 된다.

- required header, Goal/Architecture/Tech Stack/Spec/Global Constraints.
- 원본 3개 read-only와 standalone runtime import 금지.
- Figwright 112 + four additions = 116 tools.
- existing 105 + library-variable handler = 106.
- lexical union 114 + helper20 + parser12 invariant.
- Rust 71 overlap은 implicit schema compatibility로 취급하지 않는 결정.
- non-loopback/raw/Web/view-only bypass 제외.
- Desktop Figma Design/editable file v0.1.
- per-session write queue, in-flight Promise, outcome-unknown.
- path sandbox의 realpath/nearest-parent/reparse 기본 방향.
- token_map pin과 design_diff file identity fix.
- Figwright handler authority를 유지하고 figmosha behavior만 흡수.
- Node24/Rust packaging defer.
- Solar asset 미복사와 three MIT notice/artifact inspection.
- actual Figma acceptance를 automated test와 별도 gate로 둔 점.
- source patch/compiler/3-way/Web을 post-v0.1로 미룬 범위.

## 8. 수정 우선순위

1. B-C-03 conditional policy와 B-C-04 PDF engine 결정을 spec/header dependency에 먼저 반영.
2. B-C-05 RuntimePaths/StateStore를 추가하고 dependency graph 재배열.
3. current plan을 program plan으로 이름 바꾸고 Milestone A~D 하위 implementation plans 생성.
4. 각 task에 exact Interfaces, test body, implementation content, commands, commit paths 추가.
5. RED harness/scaffold 순서를 B-C-02 표대로 수정.
6. standalone hygiene/release, pairing endpoint, FS read coverage, snapshot capture, official build-vs-buy, undo/live fixture를 보강.
7. union manifest의 registration/availability/investment와 three contract hashes를 분리.

## 9. 최종 판정

기능 선택·보안 방향·수치 invariant는 강하고 v0.1 product boundary도 binding spec보다 현실적이다. 그러나 현재 상태로 subagent 실행을 시작하면 첫 Task부터 harness failure가 예상과 다르고, conditional policy와 PDF merge는 구현자가 임의 설계 결정을 내려야 하며, task 사이 interface가 없어 parallel agents가 서로 다른 contract를 만들 가능성이 높다.

Critical 다섯 건을 해결하고 Milestone별 executable plans로 분리한 뒤 실행해야 한다. 그렇게 수정하면 “standalone secure Desktop fork + 116/106 safe union”은 현실적인 program이지만, 현재 1,423-line 문서는 직접 실행 plan이 아니라 설계/프로그램 명세로 취급하는 것이 정확하다.

