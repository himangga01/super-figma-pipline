# Agent A 구현 계획 Fix Round 1 재검토

> 대상: [`2026-08-27-super-figma-pipeline-v0.1.md`](../../superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md) 최신 전체본 2,127행  
> 이전 finding: [`agent-a-review-implementation-plan.md`](agent-a-review-implementation-plan.md)의 Critical 4건 + Important 13건  
> 판정일: 2026-08-27 (Asia/Seoul)  
> 원칙: fix diff가 아니라 최신 계획 전체와 §10 resolution ledger를 authority로 삼되, `accepted` 표기를 구현 가능한 계약·Task·RED/GREEN이 실제 뒷받침하는지 독립 재검증했다. 원본 OSS는 아래 named risk만 spot-check했고 수정하지 않았다.

## 1. 최종 판정

| 구분 | ADDRESSED | NOT ADDRESSED | 합계 |
|---|---:|---:|---:|
| 이전 Critical | 4 | 0 | 4 |
| 이전 Important | 10 | 3 | 13 |
| **전체** | **14** | **3** | **17** |

이전 Critical 4건은 모두 해결됐다. 특히 ToolSpec/handler 원자 등록, control endpoint의 executor 이후 배치, `pdf-lib` ordered merge, `InvocationContext`는 더 이상 구현 차단점이 아니다.

그러나 다음 세 이전 Important finding은 resolution ledger의 `accepted` 선언과 달리 아직 닫히지 않았다.

1. **A-IP-I04:** workspace store와 CLI 명령 사이의 authenticated control endpoint가 없다.
2. **A-IP-I09:** result schema와 progress wire는 생겼지만, 116개 result를 `DataClass`로 분류하는 실행 authority가 없고 egress consent가 runtime 뒤에 평가된다.
3. **A-IP-I10:** 공통 top-level undo wrapper와 새 library handler의 undo 책임이 중복되고, `navigate_to_page` effect와 “navigation은 undo 0” 규칙이 충돌한다.

따라서 fix round 1은 **대폭 개선됐지만 그대로 구현에 넘길 최종 승인 상태는 아니다**. 아래 Critical 1건과 Important 4건을 계획에 반영한 뒤 한 번 더 scoped re-review가 필요하다.

## 2. 이전 Critical 4건 재판정

| ID | 판정 | 최신 계획 근거 | 재검토 결론 |
|---|---|---|---|
| A-IP-C01 — handler/ToolSpec 등록 순서 | **ADDRESSED** | Global exact transition `112/105/7 → 116/106/10`(`plan:20`), Task 9가 105 handler를 유지하고 새 handler를 금지(`plan:1361-1369`), Task 12가 four specs/results/runtimes/policies와 library handler/permission/manifest를 한 번에 등록(`plan:1523-1593`) | Task 9 GREEN과 Task 12 RED/GREEN이 중간 parity 파손을 허용하지 않는다. server-only exact set 10도 RED에 명시됐다. |
| A-IP-C02 — control endpoint 역의존 | **ADDRESSED** | Task 6은 control-auth middleware만 만들고 `/control/tools/call`을 명시적으로 만들지 않는다(`plan:1098-1102,1133-1135`). Task 7이 `ToolInvocationService`, executor와 endpoint를 함께 생성하고 동일 pipeline을 검사한다(`plan:1155-1170,1204-1216`). DAG도 auth→executor 순서다(`plan:731-754`). | 존재하지 않는 executor를 Task 6이 선행 호출하던 역의존이 제거됐다. |
| A-IP-C03 — ordered PDF engine 부재 | **ADDRESSED** | Tech Stack과 package dependency에 `pdf-lib 1.17.1`(`plan:9,700-705`), Rust merge semantics source attribution(`plan:126-133`), ordered one-page copy algorithm과 corrupt/encrypted/non-single-page rejection(`plan:492-511`), Task 12 dependency/files/fixtures/order GREEN(`plan:1523-1601`), SBOM/license artifact gate(`plan:1765-1811`) | Figwright의 single-page `export_pdf` 위에 Node merger를 두는 구현 경로가 완결됐다. |
| A-IP-C04 — 중앙 interface security context | **ADDRESSED** | `ActorContext`, `ConsentContext`, `WorkspaceContext`, `PluginTarget`, `InvocationContext`(`plan:238-273`), approval/operation records와 tuple conflict(`plan:275-320`), Task 7이 MCP/follower/control을 같은 service로 통과시킨다(`plan:1167-1224`). | actor/auth/workspace/consent/file target을 중앙 호출에 전달할 수 있다. Approval/Egress를 별도 record로 정규화한 선택은 수용 가능하다. 단, persisted linkage와 auth-session audit는 N-04의 보강 대상이다. |

## 3. 이전 Important 13건 재판정

| ID | 판정 | 최신 계획 근거 | 재검토 결론 |
|---|---|---|---|
| A-IP-I01 — bootstrap RED | **ADDRESSED** | Task 1이 root runner/install을 먼저 만들고 Vitest가 실제 기동한 상태에서 missing package manifest로 RED를 고정한다(`plan:760-824`). Task 2의 registry RED는 그 다음이다(`plan:826-865`). | command-not-found가 아닌 의도한 domain absence를 검증한다. |
| A-IP-I02 — DAG 누락 | **ADDRESSED** | T1→T10 binding chain, 이후 T11/T12만 조건부 병렬, T13이 둘을 소비한다(`plan:731-754`). Task 12 consumes 목록에 Task 3/5/7/8/9/10이 명시된다(`plan:1534-1537`). | 이전 Task 9의 숨은 auth/executor/plugin dependency가 새 Task 12에 명시적으로 연결됐다. |
| A-IP-I03 — URL/static manifest 충돌 | **ADDRESSED** | URL argument는 유지하되 daemon `RemoteImageFetcher`로 이동하고 plugin은 bytes만 받는다(`plan:32,513-530`). Task 8이 server wrapper와 SSRF/size/MIME tests를 만들며(`plan:1230-1305`), Task 9가 `createImageAsync(url)`와 wildcard를 제거한다(`plan:1307-1369`). | 원래 topology 모순은 해결됐다. 실제 socket pinning과 allowed-domain config lifecycle은 별도 새 finding N-05다. |
| A-IP-I04 — workspace config authority | **NOT ADDRESSED** | Task 4에 `WorkspaceConfigStore.add/list/remove`는 생겼고(`plan:964-1025`), Task 13 표는 `workspace config API`를 호출한다고 한다(`plan:1624-1631`). 그러나 exact file map/Task 7 control files에는 approval, snapshot, tool-call endpoint만 있고 `workspace-endpoints.ts` 또는 `/control/workspaces/*` producer/test가 없다(`plan:628-653,1157-1170`). | CLI companion은 active daemon을 통해야 하는데 호출할 server API가 없다. Store와 명령 양 끝만 있고 transport가 비어 있어 원 finding은 아직 닫히지 않았다. |
| A-IP-I05 — IR dependency/large snapshot | **ADDRESSED** | `@sfp/ir → @sfp/shared` dependency(`plan:464,700-704,1453-1458`), pinned session section plan, concurrency 2, deterministic merge, partial fidelity, cancel/progress와 10k-node memory ceiling(`plan:426-465,1465-1517`) | package dependency와 bounded assembly algorithm이 모두 생겼다. |
| A-IP-I06 — stable file identity | **ADDRESSED** | fileKey 우선, approved document plugin-data UUID, unstable read-only negative capability와 FileExecutionKey derivation(`plan:413-424`), Task 9 identity implementation과 Task 10 cross-file namespace/restart review(`plan:1353-1369,1383-1445`) | session/fileName hash fallback을 폐기했고 restart·동명이름 충돌 경계를 해결했다. |
| A-IP-I07 — pairing/Windows secret | **ADDRESSED** | 8-digit human code→128-bit one-use ticket, challenge/exchange, expiry/attempt/rate, first MessagePack hello, resume/follower/control rotation(`plan:359-411`), owner-only Windows DACL(`plan:349-357`), Task 6 RED/GREEN과 stale-token review(`plan:1088-1153`) | human UX와 credential entropy를 분리했고 endpoint/rotation/storage 계약이 실행 가능해졌다. |
| A-IP-I08 — journal 위치·record·conflict | **ADDRESSED** | journal을 `stateRoot/journal/{actor-hash}.operations.v1.jsonl`에 두고 fsync/checksum/compaction/truncated tail/cap/recovered-dispatched→unknown을 정의한다(`plan:283-320,1200-1216`). `(actorId,operationId)` mismatch rule과 same-file target도 있다(`plan:27-29,320`). | 원 finding의 위치·필드·conflict·crash 요구는 반영됐다. 다만 daemon restart 후 이미 `succeeded`인 exact key의 result/재호출 처리는 N-04로 남는다. |
| A-IP-I09 — egress/progress/result schemas | **NOT ADDRESSED** | Strict result authority와 112→116 coverage는 Task 3/12에 있다(`plan:189-234,899-962,1585-1593`). `DataClass`, `ProgressEvent`, `EgressManifest`와 snapshot/PDF/video→relay/MCP/CLI progress도 있다(`plan:238-257,532-560,1208-1216`). 하지만 `ToolSpec`, `OperationPolicy`, registry 어디에도 result field→DataClass classifier/possible-class authority가 없고, 명시된 실행 순서는 runtime mutation 뒤에 consent/fail-closed를 평가한다(`plan:191-234,1208-1210`). | progress와 runtime result validation은 해결됐지만 egress enforcement는 구현자가 추측해야 한다. Unknown/disallowed egress에서 runtime이 이미 실행될 수 있어 전체 finding은 닫히지 않았다. |
| A-IP-I10 — approval CLI/undo | **NOT ADDRESSED** | Approval list/approve/reject는 Task 13에 명시됐다(`plan:1624-1633,1665-1685`). Task 9는 dispatcher가 성공한 top-level write/batch마다 정확히 한 번 commit하고 navigation/no-op/failure는 0회라고 한다(`plan:1321-1359`). 그런데 Task 12는 library handler 자체도 “commits one undo boundary”라고 한다(`plan:1581-1587`). 또한 Task 5는 79 baseline write 전부를 `figma-write`로 분류하지만(`plan:1062-1065`) 원본의 `navigate_to_page`는 UI current-page 변경일 뿐이고 계획은 navigation undo 0이라고 한다(`plan:1359,2006`). | 승인 CLI는 해결됐다. 그러나 undo owner와 non-document write effect가 모순되어 exactly-once/zero 규칙을 그대로 구현할 수 없으므로 finding 전체는 미종결이다. |
| A-IP-I11 — Motion/video disposition | **ADDRESSED** | `CanonicalToolRow`가 disposition/registration/availability/investment를 분리하고 Motion7+video를 advertised/implemented `experimental-native`, 신규 투자 deferred로 둔다(`plan:141-187`). Task 9/12와 DoD가 registry/policy/artifact/live capability를 일치시킨다(`plan:1361-1369,1585-1593,1982-1987`). | 기존 ledger의 `deferred`와 shipping surface 충돌이 해소됐다. |
| A-IP-I12 — macOS live evidence owner | **ADDRESSED** | Task 16이 evidence schema/harness를 만들고(`plan:1829-1884`), Task 17/18이 Windows/macOS owner, fixture, pre-pair RED, exact artifacts, blocking evidence와 commit을 각각 소유한다(`plan:1886-1972`). DoD는 어느 하나가 없으면 incomplete다(`plan:2026-2030`). | 자동화와 외부 human-run evidence가 분리됐고 block 상태가 명확하다. |
| A-IP-I13 — independent review checkpoints | **ADDRESSED** | 총 18개 Task 모두 `Request independent spec review`, `Request independent quality review`, exact commit step을 포함한다. Header와 execution handoff도 fresh implementer→두 reviewer 순서를 고정한다(`plan:3,2054-2127`). | 단순 self-review가 아닌 두 독립 checkpoint가 모든 Task에 실제로 존재한다. |

## 4. Open finding과 새 breakage

### AR-IP-N01 — Egress는 runtime 실행 전에 fail-closed할 수 없다

**Severity: Critical**  
**연결:** A-IP-I09 NOT ADDRESSED

현재 계약에는 `DataClass` enum과 `EgressManifest` 모양만 있고, 116개 tool result의 어느 field가 `project-code`, `design-text`, `design-image`, `secret`인지 판정하는 registry가 없다. 더 큰 문제는 Task 7 순서가 다음과 같다는 점이다.

~~~text
approval → queue/journal → runtime → result parse → egress classification/consent
~~~

`unknown-fail-closed` 또는 consent 부족이어도 Figma mutation, filesystem write, URL fetch가 먼저 일어날 수 있다. 이후 response만 차단하면 client는 실패로 보고 새 operation ID로 재시도할 수 있어 “fail closed”가 mutation correctness까지 악화시킨다. `EgressManifest.consentId`는 필수 string인데 `ConsentContext.consentId`는 nullable인 schema 모순도 있다(`plan:250-254,549-557`).

**정확한 수정안**

1. `RESULT_EGRESS_POLICIES`를 exact `112→116` authority로 추가한다. 각 row는 `possibleClasses`, strict result classifier/redactor, output byte/token estimator를 가진다.
2. runtime 전에 `possibleClasses`와 connector mode/consent로 preflight한다. Unknown mode 또는 class 미승인은 runtime mock 호출 0회로 RED를 고정한다.
3. result parse 뒤 실제 field classification/redaction/budget을 다시 적용하고, preflight upper bound 밖 class가 나오면 internal contract error로 fail한다.
4. local-trusted의 consent ID 정책을 명시해 `EgressManifest` nullable 여부를 일치시키고, manifest record를 journal과 원자적으로 persist/link한다.
5. destructive write, design image, project code 각 1건과 116/116 coverage test를 Task 5/7/12에 넣는다.

### AR-IP-N02 — Workspace CLI가 호출할 authenticated endpoint가 없다

**Severity: Important**  
**연결:** A-IP-I04 NOT ADDRESSED

Task 4의 store는 daemon 내부 객체이고 Task 13 CLI는 별도 process다. 그런데 `/control/workspaces` route, schema, middleware mount, test, producing Task가 없다. `workspace config API`라는 표의 이름만으로는 executable dependency가 아니다.

**정확한 수정안**

- Task 7 Files에 `service/packages/mcp/src/control/workspace-endpoints.ts`와 `workspace-endpoints.test.ts`를 추가한다.
- `GET /control/workspaces`, `POST /control/workspaces`, `DELETE /control/workspaces/:id` 또는 동등한 typed RPC를 control auth 뒤에 mount한다.
- actor는 body가 아니라 authenticated context에서 가져오고, add는 explicit-action nonce/realpath, remove는 unsettled operation conflict를 검증한다.
- Task 13 consumes와 fake control server에 이 exact API를 추가한다.

### AR-IP-N03 — Undo owner와 navigation effect가 서로 모순된다

**Severity: Important**  
**연결:** A-IP-I10 NOT ADDRESSED

Task 9는 top-level dispatcher가 undo boundary를 소유하도록 읽히지만 Task 12는 `import_library_variable` handler가 직접 commit하도록 지시한다. 둘을 그대로 구현하면 새 handler는 두 번 commit할 수 있다. 반대로 handler에서만 commit하면 generic invariant가 깨진다.

또한 원본 `navigate_to_page`는 ToolSpec상 `kind:'write'`이지만 실제 handler는 `figma.setCurrentPageAsync`만 호출한다(`code-kb/figwright/packages/mcp/src/tools/navigate-to-page.ts:7-15`, `packages/plugin/src/handlers/navigate-to-page.ts:5-20`). Task 5의 “79 write 전부 figma-write”와 Task 9/DoD의 “navigation undo 0”은 동시에 참일 수 없다.

**정확한 수정안**

- `figma.commitUndo()` owner를 plugin top-level dispatcher 하나로 고정하고 모든 handler 직접 commit을 금지한다. UUID initialization은 별도 audited system operation으로 명시한다.
- Task 12 Step 6을 “handler는 commit하지 않으며 dispatcher가 정확히 한 번 commit”으로 고친다.
- tool `kind`와 document effect를 분리한다. `navigate_to_page`에는 `figma-ui` effect를 신설하거나 non-document state effect를 부여하고 `figma-write`/approval/undo에서 제외한다.
- `navigate_to_page=0`, `import_library_variable=1`, nested batch=1, failure=0을 dispatcher integration test로 고정한다.

### AR-IP-N04 — 재시작 후 succeeded operation ID의 동작이 정의되지 않았다

**Severity: Important**  
**연결:** A-IP-I08은 원 요구 기준 ADDRESSED이나 새 durable-semantics 공백

Task 7은 completed result를 **in-memory**에서만, 같은 plugin generation일 때 replay한다고 한다(`plan:1196-1198`). Journal은 `succeeded` row에 result hash/size만 저장하고 실제 result나 재호출 응답 규칙은 없다. Daemon 재시작 후 같은 `(actorId,operationId)`가 오면 다음 중 어느 것도 binding되어 있지 않다.

- 성공을 알고 mutation을 재실행하지 않는가.
- result를 어떻게 반환하는가.
- result가 없는 성공을 어떤 typed code/status로 표현하는가.

이 상태에서는 DoD의 “same contract applies once”를 restart 경계에서 증명할 수 없다.

**정확한 수정안**

- settled success를 발견하면 절대 runtime을 재실행하지 않는다.
- 민감 result를 durable 저장하지 않을 정책이면 `OPERATION_ALREADY_SUCCEEDED`와 sanitized `OperationRecord`를 반환하도록 contract/status schema를 추가한다. 저장한다면 size/class/retention 제한과 암호화/삭제 정책을 먼저 정의한다.
- daemon restart 후 exact success, different args conflict, dispatched→unknown 세 RED를 별도로 둔다.

### AR-IP-N05 — RemoteImageFetcher의 실제 connect address와 domain config authority가 비어 있다

**Severity: Important**  
**연결:** A-IP-I03은 topology 기준 ADDRESSED이나 새 SSRF/config 공백

계획은 DNS answers를 검증하고 DNS-change test를 요구하지만, 검증한 public IP로 실제 TLS socket을 pin하거나 connected socket의 `remoteAddress`를 재검증한다는 binding contract가 없다(`plan:513-530,1285-1301`). 검증 lookup 뒤 일반 `fetch(hostname)`가 다시 DNS lookup하면 DNS rebinding TOCTOU가 남는다.

또한 `RemoteImagePolicy.allowedDomains`는 “configured domains”라고만 되어 있고 state config schema, authenticated add/list/remove, config file 예시가 없다. 기본 domain set이 비면 URL 기능은 사실상 unusable이고, wildcard/hardcode면 최소권한 원칙을 깬다.

**정확한 수정안**

- vetted address를 custom dispatcher/lookup으로 실제 connection에 pin하고 Host/SNI는 원 hostname을 유지하거나, socket `remoteAddress`가 vetted set에 속하는지 검증한다.
- redirect마다 새 vetted connection을 만든다. public-first/private-second DNS와 redirect rebinding integration test를 둔다.
- owner-only config에 remote image domain policy lifecycle을 정의하고 authenticated CLI/control command를 추가한다. Approval은 allowlist를 확장하지 않는다.

## 5. 핵심 불변식 재검증

| 항목 | 판정 | 근거 |
|---|---|---|
| Baseline `112 tools / 105 handlers / 7 server-only` | **PASS** | Global line 20, Task 2 parity RED/GREEN, Task 9 preservation |
| Atomic final `116 / 106 / 10` | **PASS** | Task 12 single atomic RED/GREEN; exact ten-name set (`plan:1541-1550`) |
| Final kinds `read23/local13/write80` | **PASS** | Global line 22, Task 12 RED/GREEN, DoD; 단 kind와 dynamic document effect는 N-03처럼 분리 필요 |
| Source invariant `114 + helper20 + parser12/unique11` | **PASS** | Global line 23, Task 3 manifest RED/GREEN, Task 13 compat, DoD |
| Tool input/result/runtime/policy final coverage | **PASS with egress exception** | result/runtime/policy 116/116은 명시됨. result→egress classifier authority만 N-01로 미충족 |
| ToolSpec/handler atomic registration | **PASS** | Task 9 112/105/7, Task 12 116/106/10 |
| Control dependency | **PASS for tool/approval; FAIL for workspace** | tool/approval endpoint는 Task 7, workspace endpoint는 N-02 |
| `pdf-lib` ordered merge | **PASS** | dependency, algorithm, fixtures, artifact notice 모두 있음 |
| FileExecutionKey | **PASS** | stable FileIdentity에서만 derive, same-file cross-session test |
| Pairing/follower/control auth | **PASS** | 8-digit→128-bit, PNA, rotation, DACL, Unknown fail-before-forward |
| Journal | **PASS for location/recovery/conflict; OPEN for succeeded restart** | N-04 |
| Egress/progress/result schemas | **PARTIAL** | progress/result validation은 PASS; egress preflight/classifier는 N-01 |
| Live Windows/macOS evidence | **PASS as a blocking plan gate** | Task 16 harness + Task 17/18 separate owners/evidence; 실제 evidence는 구현 후 필요 |
| Independent reviews | **PASS** | 18/18 Task가 spec review + quality review + commit 포함 |

## 6. Named source risk spot-check

계획 전체를 원본과 다시 전수 비교하지 않고, rewrite가 직접 해결한다고 이름 붙인 위험만 확인했다.

| Risk | 원본 확인 | 계획 판정 |
|---|---|---|
| Figwright server-only baseline | `code-kb/figwright/test/tool-registry.test.ts:19-27`의 exact 7 | Task 2의 7과 Task 12 final 10 산식 일치 |
| Figwright PDF는 single-page | `packages/mcp/src/tools/export-pdf.ts:16-30`, `packages/plugin/src/handlers/export-pdf.ts:9-34` | `pdf-lib` multi-page adapter가 실제로 필요하며 계획에 추가됨 |
| Rust ordered merge source | `code-kb/figma-mcp-rust/src/pdf.rs:10-110` | source attribution과 behavior test로만 흡수, Rust runtime은 미도입 |
| Plugin URL fetch/wildcard | `packages/plugin/src/handlers/import-image.ts:11-38`, `packages/plugin/manifest.json:10` | Task 8/9 daemon bytes path로 제거 계획 있음 |
| Navigation is UI state | `packages/mcp/src/tools/navigate-to-page.ts:7-15`, `packages/plugin/src/handlers/navigate-to-page.ts:5-20` | 현재 effect/undo 문구 모순 N-03 확인 |

## 7. 최종 verdict와 다음 gate

**Verdict: FIX ROUND 2 REQUIRED — 구현 handoff 보류.**

이전 Critical 4건은 모두 닫혔고, `116/106/10`, ordered PDF, central invocation, bootstrap, DAG, stable identity, pairing, snapshot, live evidence 구조는 실행 가능한 수준이다. 다만 다음 네 수정은 handoff 전 hard gate다.

1. Egress classifier exact authority와 pre-runtime fail-closed를 추가한다.
2. Authenticated workspace control endpoint를 Task 7/13 사이에 추가한다.
3. Undo owner를 dispatcher 하나로 고정하고 navigation의 non-document effect를 분리한다.
4. Restarted succeeded journal key가 재실행되지 않는 contract/test를 추가한다.

Remote image DNS connection pinning과 domain config lifecycle도 URL capability를 v0.1에 유지하려면 같은 round에서 닫아야 한다. 이 finding들을 반영한 뒤 §10 resolution ledger의 A-IP-I04/I09/I10을 `accepted`로 유지할지 다시 판정해야 한다.

