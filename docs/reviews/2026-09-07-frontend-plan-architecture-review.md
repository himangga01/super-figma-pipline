# 프론트엔드 확장 계획 — 아키텍처·실행 경계 독립 리뷰

작성일: 2026-09-07. 검토 대상: `docs/plans/2026-09-07-frontend-four-cases-plan-ko.md` v0.1.

검토자는 초안을 수정하지 않고 현재 작업 트리의 실행·정책·파일 IO·CLI 코드와 대조했다. 생산 코드, 기존 staging, 브라우저 상태는 변경하지 않았다. 이 문서는 구현 전 설계 리뷰이며 테스트 통과 보고가 아니다. Superpowers와 추가 에이전트는 사용하지 않았다.

판정: **방향은 타당하지만, v0.1만으로 실제 생성·적용을 구현할 수 있는 실행 계약이 완결되지는 않았다.** 수집/분석과 생성의 차이, scaffold와 Figma 구현의 차이, reference 읽기 전용, 전용 patch store, 검증 증거를 구별한 것은 유지해야 한다. 아래 P0는 실행 가능한 계획 확정 전, P1은 해당 쓰기/프로세스 기능 활성화 전에 해소해야 한다. P2는 인터페이스와 문서 정합성 보강이다. 우선순위는 현재 코드의 발견된 보안 사고가 아니라, 제안 기능을 이 설계대로 확장할 때의 차단 조건을 의미한다.

## P0-01. `FrontendAgentPort`의 실제 transport·호출 주체·후속 제출 계약이 없다

**초안 위치:** §7의 “현재 연결된 코딩 에이전트를 실행자로 사용”, §8의 service operation, §11 P4.

**코드 근거:**

- `service/packages/shared/src/service-operations.ts:18`의 폐쇄 enum은 `snapshot.capture`, `grounding.refresh`뿐이다. `ServiceOperationRequestV1Schema`는 호출 요청이지 에이전트 작업 채널이 아니다.
- `service/packages/mcp/src/execution/service-operation-registry.ts:30`은 snapshot 정의만 등록하고, registry의 `execute`는 `OPERATION_EXECUTOR_REQUIRED`를 던진다. 실제 구현은 `ExecutableOperation.execute`로 별도 주입된다(`execution/executable-operation.ts:35`).
- `service/packages/mcp/src/execution/execution-plane.ts:670` 및 `execution/operation-executor.ts:1172`는 service의 origin을 `control`로 제한한다. MCP에 접속한 클라이언트가 있다는 사실만으로 서버가 그 코딩 에이전트에게 생성 작업을 역호출할 수 없다.
- `service/packages/cli/src/control-client.ts:132`의 `invoke`는 하나의 HTTP 실행 결과를 기다리는 경로다. 소스 검색에서 코딩 에이전트 task claim/submit 구현은 확인되지 않았다.

**영향:** 포트와 `waiting-agent` 상태만 추가하면 실행자 부재를 정확히 표시할 수는 있어도 실제 화면을 생성하지 못한다. CLI 단독 실행은 계속 대기할 수 있고, 임의 callback 또는 handler 직호출로 메우면 기존 admission/egress/receipt 경계를 우회한다.

**보강안:** 초기 adapter를 하나 확정하고 실제 인터페이스·배포 위치·지원 클라이언트를 명시한다. 메인이 검토 중인 **MCP client-driven pull/submit**은 적절한 대안이다. 최종 제안 후보인 `frontend_plan/start/next/submit/apply/validate/status/resume/cancel` 9개를 각각 canonical ToolSpec/server-adapter로 등록하고 CLI도 `invokeTool`로 호출하는 방식이 현재 코드와 가장 작은 변경으로 맞는다. 별도 `frontend.*` service operation을 중복 추가하지 않고 run coordinator를 도메인 모듈로 둔다. 기존 service 두 개의 control-only와 identity private 경계를 보존한다. 다음 조건을 계획에 함께 넣어야 한다.

1. MCP와 CLI가 동일 canonical tool admission에 도달하게 하고 실제 origin을 보존한다. MCP actor를 control actor로 위조하거나 `execute`를 직접 호출하지 않는다. step당 operation ID·fingerprint·receipt를 하나만 남긴다. `tools/runtime-registry.ts:58` 이하의 server-adapter/server-only 분류에 등록하면 plugin handler를 추가할 필요가 없다.
2. claim ticket은 `actorId`, `runId`, `contextHash`, `blueprintHash`, `leaseEpoch`, `expiresAt`, adapter capability, evidence manifest와 변경량 한도를 묶는다. `next`/heartbeat/submit/lease 회수 규칙과 작업 종료 상태를 정의한다.
3. submit은 내용과 hash를 가진 candidate artifact를 제출한다. 에이전트가 실제 target에 직접 쓰는 것을 정식 실행 경로로 삼지 않는다. 서버가 ticket, 경로, content hash, base hash, frontend 범위를 검증하고 patch port가 적용한다.
4. daemon은 에이전트 생성 능력을 갖췄다고 선언하지 않는다. bridge가 없는 CLI는 `waiting-agent`와 정확한 연결 절차를 반환한다. 등록되었다는 사실과 작업을 수행 가능한 활성 lease를 구별한다. MCP sampling이나 별도 API 키는 이 초기 adapter의 숨은 전제에 넣지 않는다.
5. “최대 3회 수정”은 최초 candidate 후 최대 3회 repair인지 총 3회 generation인지 정의하고, 재접속 시 예산을 초기화하지 않는다. adapter가 비용을 측정하지 못하면 비용 상한을 검증했다고 주장하지 않는다.

**확인 조건:** 지원하는 실제 클라이언트로 `plan/start → claim → evidence 수신 → 실제 candidate 제출 → validate → 필요 시 repair → apply`를 실행하고 결과 파일을 빌드한다. daemon만 실행/bridge 단절/lease 만료/다른 actor claim/구 lease 제출/동일 submit 재전송/동일 ID에 다른 내용 제출을 검사한다. 문자열 guidance나 dummy adapter만 통과하는 테스트는 이 항목의 완료 증거가 아니다.

## P1-01. 복수 저장소의 역할이 데이터 설명에만 있고 실행 authority·fingerprint에 연결되지 않았다

**초안 위치:** §5 `ResolvedFrontendContextV1`, §8 reference read-only와 target write, §2 신규 경로 기본값.

**코드 근거:**

- `service/packages/shared/src/operations.ts:54`의 `WorkspaceInvocationContext`와 `:137` 부근 `OperationFingerprintV1`는 단일 `workspaceId`를 가진다. `service/packages/shared/src/config.ts:10`의 workspace 등록과 `:24`의 `WorkspacePolicy`는 run별 target/reference 역할을 표현하지 않는다.
- `service/packages/mcp/src/execution/execution-plane.ts:735`는 요청의 workspace 하나를 resolve하고, `:756`은 그 workspace만 `resolveScope`로 넘긴다. 최종 runtime scope도 하나다(`:783`).
- `service/packages/mcp/src/fs/workspace-policy.ts`의 `prepare`와 `resolveWrite`는 지정된 등록 root 안의 경로를 확인한다. workspace를 reference로 사용 중인지 판단하는 run별 권한은 없다.
- `service/packages/mcp/src/execution/operation-executor.ts:1199`와 `:1221`은 단일 workspace를 operation 바인딩에 사용한다. `argsHash`에 raw path가 들어가는 것만으로 검증된 root identity와 역할이 바인딩되지는 않는다.

**영향:** `references[]`를 일반 인자로 추가한 뒤 전역 WorkspacePolicy를 그대로 넘기면 읽기 전용 reference를 쓰기 가능한 등록 workspace로도 접근할 수 있다. target이 아직 없는 신규 경우, target의 ID와 staging/결과 증거를 보관할 root도 현재 계약으로는 확정되지 않는다. sibling staging은 최종 target root 밖이므로 target-only authority로는 적법한 준비 작업을 표현할 수 없다.

**보강안:** `RunRepositoryAuthorityV1`에 verified root identity, 역할, 읽기 범위, 쓰기 범위, target package, 신규 parent identity, destination leaf, server staging/scratch authority를 구분해 고정한다. 포트에 전역 파일 정책을 그대로 넘기지 말고 이 grant로 제한한 reader/writer를 넘긴다. context hash/authority hash를 approval intent, operation fingerprint, run, claim ticket, evidence receipt에 바인딩한다. 역할을 바꾸거나 root identity가 달라지면 기존 grant를 재사용하지 않는다. 필요한 root 등록은 이미 주어진 사용자 승인을 사용해 구체적인 경로에 묶으며 매 단계 다시 승인받는 UX로 바꾸지 않는다.

canonical ToolSpec 방식을 선택해도 scope 확장은 필요하다. 현재 `tools/spec.ts:73` 이하의 ToolSpec에는 custom `resolveScope`가 없고 `execution-plane.ts:754`의 hook은 service extension용이다. 공통 admission resolver registry 또는 ToolSpec hook을 정식 추가해 run ID에서 multi-root/lease/process authority를 **approval 전**에 복원한다. server-adapter 실행 함수 안에서 처음 권한을 resolve하는 방식으로 미루지 않는다.

기존 파일의 symlink/junction/대소문자 alias뿐 아니라 hard link identity, reference/target/staging 간 중첩도 검사한다. 지원하지 않는 별칭 구조는 처음에 명시적으로 거절한다. 참고 자료의 cache·profile도 reference 내부에 기록하지 않는다. 새 output을 publish한 뒤 parent authority에서 target workspace identity로 넘어가는 시점을 기록한다.

**확인 조건:** target·reference·scratch가 서로 다른 root인 C3, 새 destination 미존재, destination parent 교체, 대소문자 alias, junction, hard link, target/reference 중첩, reference 등록 권한 존재 상태에서 reference 쓰기 시도를 테스트한다. 악의적 candidate의 `workspaceId` 교체가 무시/거부되어야 하고 reference에 cache/lock/메타데이터를 포함한 쓰기가 없어야 한다.

## P1-02. 저장소별 egress를 기존 단일 class consent 재사용으로 구현할 수 없다

**초안 위치:** §7 제한된 file evidence, §8 저장소별 egress 권한.

**코드 근거:**

- `service/packages/shared/src/egress.ts:44`의 `ConsentContext`는 mode/consentId/allowedClasses이고, 이어지는 `EgressConfigV1`도 저장소나 recipient별 scope가 없다.
- `service/packages/mcp/src/index.ts:931`은 owner의 egress 설정 하나를 로드해 class 목록을 승인한다. `policy/policy-engine.ts:97`의 `authorizeEgress`는 그 단일 설정을 평가한다.
- `execution/execution-plane.ts:857`에서 invocation input/result class를 승인하고, `execution/operation-executor.ts:1554` 부근에서 runtime 결과를 redaction한다. 새 `FrontendAgentPort`가 runtime 내부에서 파일을 읽어 외부 에이전트에 보내는 것은 기존 최종 결과 redaction만으로 보호되지 않는다.

**영향:** target의 `project-code` 허용이 여러 reference의 원문 허용으로 확대될 수 있다. `frontend_next`가 해시나 artifact ID만 결과로 주고 별도 경로로 원문을 다운로드시키면 그 다운로드가 미분류 egress가 될 수 있다. validation log·screenshot·repair 요청도 소스/도메인/비밀 값을 포함할 수 있다.

**보강안:** 전달할 evidence마다 source authority, file/range/hash, data class, byte/token budget, recipient/adapter identity를 가진 manifest를 만든다. `frontend_next` 또는 다운로드 경로가 이 manifest와 저장소별 grant를 검증한 뒤 bytes를 반환하게 한다. agent-bound 입력을 실제 전송 전에 분류·축약·필터링하고 repair 로그에도 같은 정책을 적용한다. result artifact를 로컬에 저장할 권한과 외부 모델에 보내는 권한을 분리한다. reference grant 취소·만료 시 미완료 run이 과거 grant로 계속 원문을 보내지 않게 한다.

**확인 조건:** target 허용/reference 거부 조합, reference별 서로 다른 허용 범위, 허용된 evidence ID의 원문 교체, env 파일과 로그 속 secret, 너무 큰 source 묶음, lease 종료 뒤 다운로드, repair 요청에 포함된 원문을 검사한다. 모든 agent-bound bytes가 해당 manifest의 범위와 hash로 추적되어야 한다.

## P1-03. 장기 run과 짧은 operation을 분리하려면 큐 키·소유권·재개·취소 모델을 새로 정해야 한다

**초안 위치:** §5 `FrontendRunV1`, §8 단계 operation과 control endpoint, §10 status/resume/cancel.

**코드 근거:**

- `service/packages/mcp/src/execution/operation-executor.ts:1480`은 `scope.target.fileExecutionKey`로 큐를 잡고 `:1520`에서 `extension.execute`가 끝날 때까지 기다린다.
- `execution/file-queue.ts:20`의 키가 null이면 모두 `target:none`에 들어간다. 이는 target repository/package의 쓰기 충돌 범위가 아니다.
- `execution/operation-journal.ts:378`의 재시작 복구는 pending을 rejected, queued를 failed, dispatched를 outcome-unknown으로 전이한다(일부 보존/별도 복구 옵션 존재). 장기 run의 다음 단계 예약은 아니다.
- `execution/operation-executor.ts:899`의 cancel은 원 actor/authSessionId/requestId에 묶이며 active controller 기반이다. 종료된 CLI 대신 새 session으로 `cancel <run-id>`를 호출하는 UX는 자동 제공되지 않는다.
- `execution/operation-executor.ts:182`의 성공 결과 메모리 cache TTL은 60초이고, `:2050` 이하 재전송은 cache가 없으면 이미 정산된 operation으로 처리한다. CLI 응답을 잃은 뒤 동일 호출로 candidate bytes를 다시 얻는 것을 보장하지 않는다.

**영향:** 함수 이름만 generate/validate로 나눠도 장시간 generation/build를 await하면 같은 큐를 계속 잡는다. 서로 무관한 target이 `target:none`으로 직렬화되거나, 같은 repo에 서로 다른 Figma 파일로 들어온 쓰기가 다른 큐에서 경합할 수 있다. 원 CLI가 사라지면 누가 run을 이어가거나 취소할지 불명확하다.

**보강안:** run의 durable state machine과 `runVersion` CAS, owner/authorized-resumer, leader generation, lease epoch, cancel-requested 기록을 명시한다. 에이전트 대기는 짧은 claim/submit operation 사이에서 queue를 점유하지 않는다. generation·validation의 실행 시간은 별도 bounded job/resource scheduler가 관리하고, 그 job의 시작·종료·효과도 정식 executor/journal에 연결한다. job 등록 operation의 성공은 “등록됨”이며 파일 구현 성공이 아니다.

Figma capture lock과 repository/package write lock을 분리하고 여러 자원 lock의 획득 순서를 정한다. 취소는 앞으로의 claim/apply를 막고 활성 lease를 fence한 뒤 child process 종료와 partial application 확인을 수행한다. 재개는 operation 상태, patch journal, 검증 input hash를 조정한 뒤 가능한 다음 단계만 새 operation ID로 수행한다. `outcome-unknown` apply를 자동 재실행하지 않는다. 산출물 재조회는 단기 cache가 아닌 versioned artifact store에서 한다. 새 auth session의 run 취소/재개를 허용할 권한과 기존 operation 취소와의 연결도 명시한다.

**확인 조건:** 서로 다른 두 target 병렬 실행, 동일 target/다른 Figma 입력 쓰기 경합, CLI 종료 후 새 session status/resume/cancel, leader 교체, lease 만료 후 늦은 submit, 장시간 agent 대기 중 다른 작업 실행, cancel 뒤 새 apply 금지, 성공 응답 유실 후 artifact 재조회, unknown 상태에서 재개 거부/조정 경로를 검사한다.

## P1-04. 다중 파일 CAS는 단일 파일 원자성의 합이 아니며, crash 복구와 publish commit point가 미정이다

**초안 위치:** §5 changeset/run, §8 staging·CAS 복구, §12 부분 실패·재개.

**코드 근거:**

- `service/packages/mcp/src/fs/namespace-files.ts:13`은 snapshot/grounding JSON namespace만 허용한다. 초안이 이를 확장하지 않겠다고 한 것은 맞다.
- `fs/atomic-file.ts:2092`의 `WorkspaceAtomicFileStore`는 단일 workspace의 개별 파일 create/replace를 제공한다. `:2038`에서는 기존 파일을 retained 위치로 옮기고, `:2046`에서 새 파일을 exclusive link로 공개한다. 중간 실패는 이미 mutation이 있었음을 나타낼 수 있다.
- `fs/atomic-file.ts:990`의 committed mutation 오류와 `execution/operation-executor.ts:1634`의 `committed` 처리는 중요하다. executor가 부분 변경 뒤 일반 오류를 받으면 runtime-failed로 정산할 수 있다(`:1654`).
- `service/packages/mcp/test/fs/atomic-file.test.ts:227` 및 `:283` 부근에는 단일 replace의 commit 이후 오류와 실제 child crash 복구 테스트가 있다. 이것이 여러 frontend 파일의 rollback 증거는 아니다.

**영향:** 첫 파일 교체 직후 프로세스가 죽으면 메모리의 “실제로 바꾼 파일 목록”을 잃을 수 있다. 파일별 base hash만으로 staging 검증과 실제 적용이 같은 소스였다고 증명할 수 없다. 예를 들어 변경 대상이 아닌 공용 component·config·lockfile이 검증 후 바뀌면 검증 근거가 stale이다. 새 directory publish도 destination이 비어 있는 디렉터리로 먼저 생기는 경합에서 기존 target 보존을 보장해야 한다.

**보강안:** 전체 changeset을 사전 검증하고 다음을 durable patch journal로 고정한다: transaction ID/epoch, target authority, 검증에 영향을 준 input closure manifest, 변경별 old/new hash와 파일 identity/mode, 백업 locator, write intent, applied 관측, rollback intent/outcome, publish commit point. 각 외부 mutation 전에 intent를 내구성 있게 기록하고 mutation 뒤 관측을 기록한다. crash가 그 사이 발생하면 old/new/foreign 상태를 판독하여 재조정한다. create/replace/delete/rename 및 directory 생성/정리 규칙을 각각 정한다.

롤백은 현재 파일이 **이 run의 적용 결과**와 identity/hash로 일치하는 경우에만 복구한다. 사용자가 바꾼 파일은 보존하고 conflict/unknown으로 남긴다. 부분 적용이 남은 오류는 `committed:true` 또는 동등한 명시적 side-effect outcome으로 executor에 전파한다. 일반 사용자 편집까지 다중 파일이 한순간에 보이는 원자성을 제공한다고 주장하지 말고, 보장 범위를 “사전 CAS 검사 + 파일별 적용 + crash 조정 + 조건부 복구”로 명시한다.

레거시 staging은 현재 dirty·untracked 내용을 포함한 입력 스냅샷으로 만든다. Git HEAD 복제만으로 대체하지 않는다. staging 검증 직전/적용 직전 input closure hash를 확인하고 바뀌면 재계획/재검증한다. 신규 directory publish는 OS별 no-replace 보장과 같은 volume 조건, destination 충돌, commit 뒤 receipt 저장 실패를 처리한다. 완료 보고는 publish/적용 뒤 실제 파일 hash 재검증 후에만 한다.

**확인 조건:** 3개 이상의 create/replace/delete를 섞고 첫/중간/마지막 파일 변경 직전·직후, journal fsync 직전·직후, publish 직후에 실제 프로세스 종료를 주입한다. 재시작 후 사용자 동시 편집, 생성 파일의 외부 교체, rollback 중 실패, 입력 공용 파일 변경, 기존 empty destination 생성 경합, 부모 junction 교체, Windows retained directory 동작을 검사한다. 재전송/재개가 사용자 파일을 덮거나 두 번 적용하지 않아야 한다.

## P1-05. 검증 프로세스 effect와 frontend-only 제약의 실제 강제 지점이 빠져 있다

**초안 위치:** §7 ValidationPort, §8 effect/network profile/allowlist, §9 preview.

**코드 근거:**

- `service/packages/shared/src/operations.ts:28`의 `Effect`는 Figma read/write/UI/library, filesystem read/write, URL 인자 network뿐이다. 프로세스 spawn, child tree, 실행 argv/env/cwd/network authority를 표현하지 않는다.
- 같은 파일 `:37`의 `ServerEvidenceWriteEffectV1`는 result-capture/native-manifest/snapshot/grounding-graph다. 새 frontend source 쓰기나 dependency install은 증거 파일 쓰기의 다른 이름이 아니다.
- `execution/executable-operation.ts:26`의 `resolveScope` 결과도 resolvedPaths와 evidenceWrites다. 프로세스와 candidate/source write authority 전달 구조는 아직 없다.
- `policy/approval-prompt.ts:18`의 effect summary 및 `execution/execution-plane.ts:805`의 approval 전달도 새 effect를 함께 확장해야 한다. `fs/workspace-policy.ts:37`의 `execFile`은 Windows 경계 검사 전용이며 제한된 frontend 검증 runner가 아니다.

**영향:** `npm run build` 같은 허용 명령도 repository의 임의 script·plugin·install lifecycle 코드를 실행한다. raw shell 도구를 MCP에 노출하지 않는 것만으로 target/reference/호스트 파일 쓰기나 운영 API 접근이 차단되지 않는다. 경로 allowlist만으로 Next server actions, Nuxt server route, 인증 서버 변경, frontend 파일에서 새 backend 의존을 끌어오는 행위를 충분히 구분하지 못한다.

**보강안:** repository source write와 process execution을 별도 versioned effect로 정의하고 scope resolution→policy→approval grant→executor→receipt까지 연결한다. ServerEvidenceWriteEffect는 보고서/증거 저장에만 쓴다. 프로세스 profile에는 executable/argv, cwd authority, script와 lockfile hash, 최소 환경 변수, scratch/cache/temp writable roots, install lifecycle 허용 규칙, network 목적지, timeout/output cap, child tree ownership, process 종료/정리 결과를 포함한다. 일반 명령 allowlist와 OS 수준 파일/네트워크 격리 중 무엇으로 어떤 보장을 하는지 명시하고, 해당 플랫폼에서 강제할 수 없으면 그 profile을 지원으로 표시하지 않는다.

install은 패키지 취득 profile, build/type/test는 제한된 staging profile, preview는 loopback과 fixture/read adapter 중심 profile로 나눈다. 생산 원격 API의 상태 변경을 HTTP 메서드 선언에만 맡기지 말고 검증용 adapter/네트워크 경계에서 막는다. 패키지 script나 lockfile이 승인 이후 바뀌면 기존 실행 intent를 재사용하지 않는다.

frontend-only 검사는 adapter별 경로 + AST/import/dependency/config diff를 함께 검사한다. Next/Nuxt의 기존 UI SSR 소비와 신규 API route/server action/인증·DB 기능 생성을 예제로 구분한다. monorepo의 root package/lockfile 변경은 필요한 frontend dependency 범위만 허용하고 backend script·package의 변경은 거부한다. 로컬 preview는 초안대로 외부 headless Firefox/WebKit을 쓰며 기존 Figma Chrome의 프로세스/프로필/탭/URL을 건드리지 않는 계약을 유지한다.

**확인 조건:** build script가 reference/target/호스트 밖 파일 쓰기, env 읽기, 원격 요청, detached grandchild 생성을 시도하는 fixture를 테스트한다. timeout/cancel/leader 종료 후 모든 owned child가 종료되어야 한다. 신규 backend route/server action/DB dependency를 frontend 경로로 위장한 candidate, 허용된 SSR UI 수정, root lockfile의 무관한 backend 변경을 각각 검사한다. 검증 실행으로 생긴 파일이 최종 changeset에 몰래 포함되지 않아야 한다.

## P1-06. P3의 독립 build 조건이 뒤 단계의 쓰기·프로세스 경계에 선행한다

**초안 위치:** §11 P3/P4/P5/P6 및 “P5 전에는 운영 target에 적용하지 않음”.

**코드 근거:** 앞 항목들의 근거처럼 현재 workspace writer는 단일 파일 create/replace이고, 일반 frontend process effect/runner와 agent adapter가 없다. `execution/execution-plane.ts:735` 이후 admission은 실행 전에 권한을 확정하는 구조다.

**영향:** P3에서 독립 build까지 요구하면서 P5에서 프로세스/쓰기 경계를 만들면 초기 scaffold를 검증하는 구현이 직접 filesystem/shell을 호출하는 임시 우회 경로가 되기 쉽다. staging도 쓰기와 코드 실행 효과가 있으므로 “운영 target에만 적용 금지”로는 순서가 충분히 정리되지 않는다.

**보강안:** 단계 번호와 별개로 의존성을 고정한다. 초기 계약 단계에서 repo authority, effect/schema, run/claim state와 admission을 정의한다. P3는 순수 scaffold candidate bytes/manifest 생성까지 먼저 가능하게 한다. 해당 경계를 갖춘 scratch writer와 process runner가 준비된 후 독립 build 검증을 수행한다. 실제 target apply는 multi-file recovery 완료 뒤에만 활성화한다. 각 adapter의 profile 가능/생성 가능/검증 가능/적용 가능 capability를 구분한다.

**확인 조건:** 초기 scaffold fixture도 정식 scoped IO/process 경로를 사용한다. 테스트용 직접 `execute` 호출이나 temp directory 빌드가 통과했다는 이유로 실제 CLI 권한·egress·receipt 통합이 완료됐다고 표시하지 않는다. 제한된 실제 adapter 하나가 생성→검증→적용까지 통과한 뒤 나머지 stack 지원을 넓힌다.

## P2-01. CLI·registry·Figma target과 frontend target의 의미를 명시적으로 분리해야 한다

**코드 근거:** `service/packages/cli/src/admin-commands.ts:260`의 기존 `--target`은 Figma의 active/none selector이며 `:266`에서 다른 값을 거절한다. `control-client.ts:156`은 service 호출 중 snapshot이 아니면 grounding endpoint로 보내는 이분 분기다. `shared/src/invocation.ts:279`의 `PluginTarget`도 repository와 무관하다. 초안 §3 이후 여러 코드 경로에서 실제 상위 `service/` 접두사가 빠졌다.

**보강안:** `frontend` 전용 parser에서 repository `--target`을 처리하고 내부 계약에는 `repositoryTarget`/`designTarget`처럼 별도 필드를 쓴다. canonical tool 9개 방식을 채택하면 CLI frontend 명령은 모두 `kind:'tool'`로 호출하여 기존 service 분기에 넣지 않는다. 공개 registry/ToolName enum/result schemas/policy/egress/runtime/target requirement 및 count/client availability 테스트를 함께 갱신한다. 실제 도구가 광고되기 전에는 문서에만 존재하는 이름을 실행 가능한 것으로 표시하지 않는다. 각 도구의 Figma target requirement를 표로 명시한다. 저장된 디자인 binding과 검증된 snapshot으로 하는 생성/적용과 run 상태조회에는 활성 Figma가 필요 없으며 target forbidden을 기본으로 둔다. capture가 필요한 별도 작업만 검증된 design target을 요구한다.

**확인 조건:** frontend의 repo 경로가 Figma selector로 파싱되지 않음, frontend CLI→tool endpoint→동일 canonical admission 추적, 미등록 도구 거절, 기존 service origin 제한 유지, 연결이 없는 상태의 캐시 기반 계획/생성, 공유 URL 재질문 없음, 기존 Chrome attach-only 불변을 검증한다. 9개를 모두 server-only adapter로 추가하면 총 125개, server-only 19개, adapter 26개이며 plugin handler 106개와 plugin-direct 99개는 유지될 것으로 예상된다. 실제 값은 registry에서 도출한 테스트로 확인한다. 문서의 코드 경로가 실제 `service/packages/...`를 가리키는지도 확인한다.

## 메인 판단에 넘길 최소 수정 묶음

1. P0-01의 pull/submit adapter와 인증 경로를 확정하고, 실제 adapter E2E를 P4 완료 조건으로 넣는다.
2. P1-01/02의 repo authority와 agent-bound egress manifest를 request/blueprint보다 먼저 실행 계약의 일부로 고정한다.
3. P1-03/04의 run state·resource lock·crash journal·cancel/resume 조정을 구체화한다. 사용자 동시 변경과 이미 발생한 효과를 끝까지 보존하는 것이 완료 기준이다.
4. P1-05의 process/source-write effect 및 frontend 검사 지점을 명시하고 P1-06 순서로 재배치한다.

네 사용 경우가 모두 frontend-only라는 범위와 현재 생성 executor가 없다는 사실을 유지해야 한다. 위 계약과 테스트가 추가되면 초안의 확장 방향은 구현 가능한 계획으로 발전할 수 있다. 이 리뷰만으로 어떤 frontend 생성 기능이 이미 제공되거나 검증됐다고 판단하지 않는다.

## v0.9 재확인

2026-09-07, 메인의 v0.9 수정본을 문서 수준으로 재확인했다. **실제 executor 공백을 포함한 주요 설계 지적은 해소되었으며, 아래 두 문구를 최종안에 명시하면 아키텍처 관점에서 계획 확정이 가능하다.** 현재 기능이 구현되거나 테스트됐다는 판정은 아니다.

| 기존 지적                      | v0.9 판정                                                                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-01 실제 agent transport     | 해소. pull/submit adapter, 9 canonical ToolSpec과 CLI 단일 invokeTool, 실제 client E2E, lease/repair/영구 candidate 계약이 연결됐다. 기존 service/control-only 경계를 유지하는 선택이 적절하다. |
| P1-01 multi-root authority     | 해소. 역할별 제한 포트, 신규 parent/publish identity, approval 전 공통 admission resolver, fingerprint/receipt 바인딩이 명시됐다.                                                               |
| P1-02 repository별 egress      | 해소. source/recipient/path/range/hash/expiry grant와 evidence download·repair·log 검사가 포함됐다.                                                                                             |
| P1-03 run/큐/재개/취소         | 대부분 해소. durable state/lease/repo lock/job scheduler, same-owner 전용 RunOwnerAuthority, unknown 조정이 명시됐다. **아래 1번 queue 선택 계약은 추가해야 한다.**                             |
| P1-04 multi-file CAS/crash     | 해소. durable intent/관측, old/new/foreign, conditional rollback, committed outcome, dirty/index 보존, no-replace 및 crash 인수 조건이 구체화됐다.                                              |
| P1-05 process/frontend-only    | 대부분 해소. 별도 effect, container 실증, 외부 network 차단, AST/dependency 검사와 실패 상태가 있다. **아래 2번 provider/mount 계약을 최종 고정해야 한다.**                                     |
| P1-06 구현 단계 순서           | 해소. authority/runner 실증이 agent/build보다 앞서고 target apply는 patch 복구 완료 뒤로 분리됐다.                                                                                              |
| P2-01 CLI/registry/target 의미 | 해소. 전용 parser, tool 경로, target forbidden 표, count 도출 검사, 디자인 선행 수집과 provenance 분리가 추가됐다.                                                                              |

남는 필수 수정은 다음 둘이다.

1. **executor의 바깥 queue 선택을 명시한다.** 현재 `service/packages/mcp/src/execution/operation-executor.ts:1480`은 모든 runtime을 `scope.target.fileExecutionKey`의 FileExecutionQueue에 넣고, `execution/file-queue.ts:25`는 null을 `target:none`으로 묶는다. 모든 frontend 도구가 target forbidden이므로 내부 validation scheduler만 추가하면 바깥 exclusive queue가 여전히 전체 frontend를 직렬화할 수 있다. 공통 admission에서 검증한 execution resource scope에 따라 executor가 기존 Figma queue와 frontend run/repository/job/control lane을 선택하도록 명시한다. status/cancel은 장시간 validate/apply의 exclusive queue 뒤에 막히지 않아야 하며, cancel은 durable intent/fencing 후 진행 중 mutation과 patch journal을 조정한다. **필수 확인:** 서로 다른 target validate 2개가 허용 동시성으로 실행되는 중 status/cancel이 즉시 admission되고, 동일 target apply만 직렬화되는 실제 통합 테스트.
2. **실행 provider와 mount 금지를 최종 고정한다.** 메인이 예정한 `Docker CLI + Linux container`를 v1 provider로 확정하고 Podman은 후속으로 둔다. 필요한 Docker daemon/container 모드와 사전 확인 실패 시 `PROCESS_ISOLATION_REQUIRED`를 명시한다. v0.9의 “실제 target/reference/private state·HOME·secret은 writable mount하지 않는다”는 표현은 read-only 접근을 열어 둘 수 있다. “승인된 복사 input만 제공하며 실제 target/reference/private state·HOME·secret과 Docker socket은 read-only를 포함해 검증 container에 mount하지 않는다”로 명확히 한다. **필수 확인:** provider별 계획된 격리 fixture와 Firefox가 같은 지원 profile에서 통과하고, provider가 없을 때 host npm 실행으로 우회하지 않음.

그 외 새로운 범위나 추가 framework를 요구하지 않는다. 위 두 보강 후에는 구현 단계에서 각 지적의 인수 조건으로 실제 지원을 검증하면 된다.
