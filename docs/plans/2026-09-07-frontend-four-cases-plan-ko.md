# Figma 기반 프론트엔드 구현 — 네 가지 사용 사례 확장 계획

작성일: 2026-09-07. 상태: **v1.0 — 독립 리뷰 3개와 재확인 반영, 메인 에이전트 최종 확정**. 코드 경로는 별도 표시가 없으면 `service/`를 기준으로 한다. CLI 예시와 새 파일명은 구현 예정 계약이다.

리뷰 원본은 [v0.1 보존본](2026-09-07-frontend-four-cases-plan-ko.v0.1.md)이다. 리뷰의 v0.1 행 번호는 보존본에 대응한다.

이번 산출물은 구현 계획, 독립 리뷰 3개, 메인 에이전트의 최종 판단이다. 아래 기능은 앞으로 구현할 내용이며 현재 제공되는 기능과 구분한다. 기존 staged 변경과 검증 기록을 보존한다. Superpowers는 사용하지 않는다.

## 1. 확정된 요구사항

- Dev Mode와 Figma 자체 MCP를 사용하지 못하는 계정도 지원한다. 자체 Desktop 플러그인과 외부 Playwright/Scripter 경로를 유지한다.
- 공유된 디자인은 이미 알고 있다. URL을 다시 요구하지 않는다: `https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS/eCommerce-Website-%7C-Web-Page-Design-%7C-UI-KIT-%7C-Interior-Landing-Page--Community-?node-id=0-1&p=f&t=fAmIbT2LnhPEYvg2-0`.
- 파일 식별자는 `4IBhv1d8hEclifZQrOYxHS`, 초기 node는 `0:1`이다. 기존 11개 최상위 항목·3,198개 노드 캡처는 과거 관측이며 최신 디자인으로 단정하지 않는다.
- 구현 범위는 프론트엔드다. 화면, 라우팅, 반응형, 접근성, 상태, 상호작용, 기존 API를 소비하는 UI 어댑터까지 포함한다. 서버 API·DB·인증 서버·실제 결제·배포 인프라를 새로 구현하지 않는다.
- Figma에서 관측되지 않은 업무 규칙은 관측값과 분리하여 가정으로 기록한다. 실제 결제/로그인 성공처럼 보이는 가짜 완료 상태를 만들지 않는다.
- Figma 접근은 기존 Chrome attach-only다. 새 Chrome 프로세스·프로필·탭을 만들거나 기존 Figma 탭을 다른 URL로 이동하지 않는다. GPT 내장 브라우저와 공식 Figma MCP에 의존하지 않는다.
- 사용자 일괄 승인은 유지한다. 저장 경로·서로 모순되는 요구 등 실제로 필요한 정보만 요청한다. 새 서비스인데 기존 저장소 경로가 없다는 이유로 전체 작업을 막지 않는다.

## 2. 네 가지 경우와 분기 규칙

| 사용자 경우           | 입력과 판정                                       | 동작                                                                           | 완료 결과                                                |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| C1 신규 서비스        | Figma와 신규 서비스 의도, reference는 선택        | 신규 생성 진입점. reference가 명시되면 C3, 없으면 C4로 계획을 확정한다         | 신규 프론트엔드, 실행법, 검증 결과                       |
| C2 레거시 서비스      | 존재하는 target 저장소/프론트엔드 package         | 기존 구조·버전·공용 API·컴포넌트·토큰·테스트를 분석한 후 해당 frontend만 변경  | 기존 서비스에 통합된 UI와 변경 전후 회귀 근거            |
| C3 레퍼런스 기반 신규 | 신규 target와 하나 이상의 명시적 reference 저장소 | reference를 읽기 전용으로 분석하여 구조·라이브러리·코딩 관례를 선택적으로 이전 | 독립 설치·빌드 가능한 신규 frontend, 패턴 채택/거절 근거 |
| C4 레퍼런스 없는 신규 | 신규 target, reference 없음 또는 명시적 미사용    | 검증된 기본 frontend 구성을 선택하고 Figma 중심으로 새 구조·토큰·컴포넌트 생성 | 독립 frontend, 기본 선택 이유, 가정과 구현 범위          |

사용자 경우는 4개로 문서화하고 테스트한다. 실행 전략은 `legacy`, `reference-new`, `blank-new` 3개를 공유한다. C1은 C3/C4를 선택하는 정상적인 제품 흐름이다. C1에 사용자가 스택을 미리 지정해야 한다는 조건을 추가하지 않는다. 명시적으로 C3를 선택했는데 reference가 없으면 C4로 조용히 바꾸지 않는다. 명시적 C4에서는 주변 저장소를 몰래 reference로 사용하지 않는다.

신규 출력은 `--out` → 프로젝트에 설정한 frontend output root → 현재 workspace의 `generated-frontends/<design-slug>-<run-short-id>` 순서로 결정한다. 현재 workspace가 reference와 겹치면 reference 내부에 출력하지 않고 사용자별 기본 frontend output root(예: `~/Projects/SuperFigmaFrontends`)를 사용한다. 실제 선택한 parent를 쓰기 가능한 workspace로 등록·검증하고 source/reference/private-state와의 중첩을 검사한다. 기존 디렉터리는 덮어쓰지 않는다. 이미 승인된 신규 생성의 구체적 출력 위치를 계획에 표시하며 일반적인 경로 선택마다 승인을 다시 요구하지 않는다. 어느 후보도 쓸 수 없을 때만 출력 위치를 요청한다.

원시 요청은 신규의 target/reference/stack/pageScope 생략을 허용하고, 저장 binding·기본값을 해석한 **뒤** strict 실행 요청을 만든다. 존재하지 않는 새 target을 `realpath()` 기반 기존 저장소 inspector로 보내지 않는다. C2 target이 불명확하거나 monorepo 후보가 여러 개면 그 package 선택만 요청하고 독립 분석을 계속한다.

## 3. 현재 코드에서 재사용할 기반과 실제 공백

| 현재 근거                                                                         | 재사용                                      | 추가할 내용                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `service/packages/cli/src/commands.ts`, `snapshot-reader.ts`, `capture-assets.ts` | Chrome/Desktop 수집, scope·잘림·자산 상태   | 프로젝트 단위 디자인 연결 저장, 범위 계획과 재개 연결                                              |
| `packages/cli/src/project-inspector.ts`                                           | 기존 profile·component/token/icon 매핑      | CLI 내부 조합을 서버의 공통 코드 분석 모듈로 이동, target/reference 역할 분리                      |
| `packages/mcp/src/profile/profile.ts`, `profile/conventions.ts`                   | framework/styling/AST 근거                  | workspace package 선택, alias 실제 해석, import graph, route/API/state/test/asset 관례와 신뢰도    |
| `packages/ir/src/inspection-v1.ts`, `snapshot-v1.ts`, `grounding-graph-v1.ts`     | 관측 파일 hash와 fidelity, 디자인↔코드 근거 | frontend 실행 요청·blueprint·변경 계획·검증 보고서                                                 |
| `packages/mcp/src/execution/execution-plane.ts`, `operation-executor.ts`          | 인증·정책·승인·큐·저널·취소·재전송          | 복수 저장소 역할, 장기 frontend run과 짧은 단계 operation 연결                                     |
| `packages/mcp/src/fs/atomic-file.ts`, `namespace-files.ts`                        | retained path·create/CAS                    | 임의 frontend 파일용 다중 파일 patch transaction; snapshot 전용 namespace는 무리하게 확대하지 않음 |
| `packages/shared/src/operations.ts`                                               | effects와 결과 전달 정책                    | repo source write·검증 프로세스·참조 코드 전달 계약                                                |
| `packages/cli/src/admin-commands.ts`                                              | 인증된 control CLI                          | frontend plan/run/status/resume/validate, agent 실행 계약                                          |

현재 코드는 디자인 및 코드 분석 연결 서비스다. 결과가 나왔다는 이유만으로 새 프로젝트가 생성되거나 실제 파일이 구현되는 것은 아니다. 이번 확장은 **실행자 연결, scaffold, patch 적용, 검증**까지 넣어 이 공백을 메운다.

## 4. 제품 흐름과 산출물

`요청 → 디자인/경로 확인 → 저장소 관례 분석 → blueprint → 변경 계획 → 격리된 생성·수정 → frontend 검증 → 적용 → 재검증 → 결과`

- 입력: 공유 Figma 연결, 사용자 경우, target 또는 신규 출력 부모, reference 목록, 화면 범위, 선택적 framework 제약.
- 계획 결과: 해석된 경우, 읽기/쓰기 저장소 목록, frontend 경계, 화면·route·상호작용 목록, 구조, 라이브러리 선택, 재사용/신규 항목, 가정, 필요 자산, 검증 항목.
- 실행 결과: 실제 생성/변경된 파일, 실행 명령, 자산·토큰·컴포넌트 provenance, 검증 로그/스크린샷, 미완료 항목과 재개 방법.
- Figma가 일시적으로 연결되지 않아도 저장소 분석과 계획은 진행한다. 캐시 사용 시 file/node/hash/time/partial을 노출하며 현재 파일 실측 완료로 표시하지 않는다.

화면 범위를 생략하면 저장 binding의 node부터 화면 후보를 열거하고 `included`, `excluded(reason)`, `unresolved(reason)`로 분류한다. responsive 변형은 같은 화면의 변형으로 묶고 UI kit/설명판은 참조 자료로 분리한다. 미처리 scope를 목록에서 지워 완료 범위를 줄이지 않는다. 일반적인 분류는 근거·가정을 기록하고 진행하며 심각한 충돌만 질문한다. 네 경우 비교 fixture는 동일 `DesignScopeManifestV1`을 사용한다.

## 5. 데이터 계약

새 `packages/shared/src/frontend-build.ts`와 IR 모델은 strict Zod schema로 정의한다. versioned artifact를 사용하고 사용자 입력을 filesystem authority로 곧바로 사용하지 않는다.

1. `FrontendBuildRequestV1`: `requestedCase`, `designRef`, `target`(new/existing tagged union), `references[]`, `pageScope`, `constraints`, `frontendOnly:true`. case와 target/reference의 불일치를 거부한다.
2. `ResolvedFrontendContextV1`: `resolvedStrategy`, 각 저장소의 canonical root·workspace ID·역할·read snapshot hash, target frontend package, 생성 시 없는 디렉터리의 parent identity, 변경 전 파일 manifest.
3. `PatternProfileV1`: 프레임워크/정확한 설치 버전, bundler/package manager, directory/route/import alias, component API, styling/tokens/theme, state/data boundary, a11y/test, source file/range/hash, confidence, missing/unsupported.
4. `FrontendBlueprintV1`: design scope/hash/fidelity, routes·화면, 컴포넌트와 variant, tokens/assets, interaction/state, target APIs 또는 fixture 어댑터, responsive 규칙, 채택/거절한 reference 패턴과 이유.
5. `FrontendChangeSetV1`: run ID, blueprint hash, relative path, create/replace/delete, base hash, proposed content hash, 근거 IDs, frontend 범위, dependencies/lockfile 변경. 삭제와 overwrite는 명시적 변경 계획에 포함한다.
6. `FrontendValidationReportV1`: check ID, tool/version, input source hash, command/argv, exit code, logs/artifact hashes, viewport/route/state, visual/interaction/a11y, baseline 비교, skipped/blocked와 이유.
7. `FrontendRunV1`: immutable request/context/blueprint references, stage, step operation IDs, outcome, created file manifest, locks, partial applications, retry history. 성공은 검증된 실제 파일 hash와 연결한다.
8. `RunRepositoryAuthorityV1`: target/reference/scratch의 canonical root·file identity·read/write grant·frontend package·신규 parent/destination·authority hash. AgentWorkItem과 operation fingerprint/approval/receipt에 묶는다.
9. `AgentWorkLeaseV1`: owner actor, MCP executor session, run/version, work item, context/blueprint hash, lease epoch/expiry, 허용 evidence·candidate 경로·파일/바이트 한도. 원문 조회도 동일 grant를 검사한다.
10. `DesignScopeManifestV1`/`SupportMatrixV1`/`AcceptanceResultV1`: 요청/해석 범위, adapter·preset/router/runtime 조합, 필수 검사와 판정, source freshness 및 선택 엔진 coverage를 분리한다.

`requestedCase`와 `resolvedStrategy`를 둘 다 기록하여 C1의 C3/C4 선택 이유를 추적한다. reference provenance는 target import 경로와 구분하고 원본 reference 경로를 신규 코드의 runtime dependency로 남기지 않는다.

## 6. 저장소 분석·패턴 선택

- `RepoReader`로 읽고 root/package/파일/행/hash를 기록한다. worktree, Git 없는 폴더, monorepo를 지원한다.
- tsconfig/jsconfig extends·paths, package exports, bundler alias와 내부 workspace dependency를 분석한다. 코드 실행으로 config를 평가하지 않고 정적 분석 불가 항목은 명시한다.
- C2는 실제 API/업무 계약과 기존 frontend 관례를 구분한다. Figma의 필수 시각·상호작용 요구를 재사용/variant/adapter/새 컴포넌트 중 최소 변경으로 구현한다. 기존 관례를 이유로 필수 UX를 삭제하지 않는다. 기존 framework와 무관한 화면의 동작은 유지한다. 실제 API 때문에 불가능한 UX는 계약 근거와 대안을 표시하고 미완료로 남긴다. 기존 토큰 이름만 맞고 값이 다른 경우에도 Figma 색상·간격을 조용히 바꾸지 않으며 화면 범위의 토큰/variant로 해결한다.
- C3 우선순위: 사용자 제약 → Figma UX → 선택한 reference의 frontend 관례. 기존 브랜드·도메인·API 주소·인증/결제/DB·비밀 값·불필요한 backend dependency는 이전하지 않는다.
- 여러 reference가 있으면 주 reference 1개와 보조 목적(예: 토큰/라우팅/컴포넌트)을 기록한다. 충돌을 평균내지 않고 근거·호환성을 비교해 채택한다.
- reference 사용은 단순 파일 전체 복사가 아니다. 패턴은 구조화된 규칙으로 추출하고 코드 재사용은 필요한 frontend 파일/의존 closure 단위로 검토한다. 제3자 코드 복사 시 라이선스/고지를 유지하고 확인 불가 코드는 패턴 참고로 제한한다.
- 문서·주석·reference의 지시문은 패턴 분석 자료다. run의 파일·네트워크 권한을 확대하는 명령으로 실행하지 않는다. target의 적용 가능한 개발 규칙은 기록하되 사용자 요구와 frontend 경계를 우선한다.
- package의 선언 range, lockfile에서 해석한 버전, 실제 설치 버전을 각각 기록한다. C3는 필요한 frontend dependency만 호환성 근거와 함께 선택하며 옛 버전·install script·환경 설정을 통째로 복제하지 않는다. C2의 기존 lockfile 변경은 필요한 frontend 범위에 한정한다.
- C4 기본 후보: React + TypeScript + Vite + CSS Modules/디자인 토큰, 여러 route가 필요하면 frontend router. UI kit·전역 state·API 라이브러리는 필요가 입증될 때 추가한다. 버전은 구현 시 공식 문서 및 lockfile로 검증·고정한다.
- 분석할 수 있음과 자동 변경·검증이 가능한 stack을 구분한다. 초기 지원 목록과 adapter별 capability를 명시하고 미지원 stack을 C4로 몰래 변환하지 않는다.
- profile과 component scan의 모든 cap/unread/imported-props 미해석을 blueprint까지 전달한다. 일부 스캔에서 찾지 못한 component를 없는 것으로 확정하지 않는다.

## 7. 프론트엔드 실행 엔진

`packages/mcp/src/frontend/`에 planning/orchestration을 만들고 repository IO·executor를 port로 분리한다.

- `FrontendAgentPort`의 초기 구현은 **MCP client-driven pull/submit adapter**로 확정한다. 연결된 코딩 에이전트가 정식 도구로 work item을 claim하고 schema에 맞는 candidate 내용을 제출한다. daemon이 모델을 역호출하는 방식, 미검증 MCP sampling, 별도 API 키를 숨은 전제로 두지 않는다. 제품에 맞는 agent driver/skill을 함께 배포하고 실제 지원 클라이언트 한 개 이상으로 끝까지 실증한다.
- daemon만 켜져 있고 에이전트가 없으면 `waiting-agent`로 기록한다. CLI의 `frontend run`은 활성 실행자 연결을 확인하고 준비/분석까지 진행한다. API 키를 artifact에 넣지 않는다.
- baseline 템플릿과 `FrontendScaffoldPort`가 신규 project의 package/config/entry를 재현 가능하게 만들고, 에이전트는 Figma에 맞는 페이지·컴포넌트·상태를 채운다.
- `ReferenceTransferPlan`은 구조/선택 dependency/필요 frontend 재사용을 계획하고 신규 root로 import를 재작성한다.
- `FrontendPatchPort`는 생성/변경 계획만 받아 base hash와 경계를 확인해 적용한다. 임의 shell이나 raw exec 기능을 새 MCP tool로 노출하지 않는다.
- `FrontendValidationPort`는 제한된 실행 프로파일에서 dependency install/build/typecheck/test/render를 수행한다. 레거시의 package script도 실행 가능한 코드이므로 계획에서 명시한 작업만 실행한다.
- 최초 candidate 1회 후 **최대 3회 repair**를 허용한다. 기본 run 시간 예산은 60분, work lease는 10분, submit은 work item당 최대 10개 파일/본문 1MiB, 합성 changeset은 최대 300개 파일/32MiB로 시작한다. 값은 versioned 실행 profile에 기록하고 더 큰 요청은 명시적으로 분할한다. 재연결/재개로 횟수·시간 예산을 초기화하지 않는다. 현재 adapter가 모델 비용을 측정할 수 없으면 시간·횟수·파일/바이트 제한만 보증하고 비용 상한을 검증했다고 보고하지 않는다.

실제 작업 사이클은 `plan → start → next(lease/evidence) → submit(candidate chunk) → validate → next(repair 필요 시) → submit → validate → apply → validate(applied) → status`다. target 직접 편집은 이 adapter의 정식 경로가 아니다. 제출 원문은 제한된 candidate store에만 저장하고 target 변경은 apply만 수행한다. evidence 전달은 필요한 파일/범위만 lease와 저장소별 egress grant로 검사한다. 페이지별 work item은 tokens/common components → routes → interactions 순서로 dependency를 고정한다.

`next`의 명시적 renewal, expiry 후 fencing/epoch 증가, disconnect 후 재할당, 구 lease의 submit 거절을 정의한다. 동일 submit 재전송은 영구 candidate hash로 같은 결과를 반환하고 같은 ID의 다른 내용은 거절한다. 에이전트가 작업 가능한 활성 lease와 단순 MCP 연결 상태를 구분한다. CLI 단독은 bridge가 없을 때 정확한 `waiting-agent` 상태/연결 절차를 반환한다.

v1의 필수 작성·통합 adapter는 React/Vite와 Vue/Vite다. Next(App/Pages 각각)·Nuxt는 후속 adapter 단계에 포함하되 router/SSR/auto-import 실증이 끝난 조합부터 지원으로 전환한다. profile 감지만 되는 stack에 자동 생성·적용 가능 표시를 붙이지 않는다. 네 경우의 지원 범위와 framework 확장 범위를 혼동하지 않는다.

## 8. 기존 실행 체계와 IO 확장

장기 run을 Figma file queue나 repository write lock에 계속 잡아두지 않는다. **새 canonical ToolSpec/server-adapter 9개**를 추가하고 CLI도 동일 `invokeTool` 경로로 실행한다. 별도 `frontend.*` service operation을 중복 만들지 않는다. 기존 `snapshot.capture`/`grounding.refresh`의 control-only와 `identity.bootstrap`의 private origin 제한은 유지한다. actor를 control로 위조하거나 handler의 execute를 직접 호출하지 않는다. 단계당 operation ID·fingerprint·journal·receipt는 하나다.

| 새 도구             | 역할·주요 효과                                                       | PluginTarget 요구                      |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| `frontend_plan`     | 정규화된 디자인 자료·repo 분석, immutable blueprint/plan 저장        | forbidden: 검증된 디자인 artifact 사용 |
| `frontend_start`    | plan hash로 owner-bound run 생성                                     | forbidden                              |
| `frontend_next`     | work item claim/renew, grant로 제한한 evidence 반환                  | forbidden                              |
| `frontend_submit`   | lease를 확인하고 candidate chunk/manifest 저장                       | forbidden                              |
| `frontend_validate` | 후보 또는 적용 결과의 제한된 install/build/test/preview, 보고서 저장 | forbidden                              |
| `frontend_apply`    | 사전 검증된 candidate를 target에 CAS 적용 또는 신규 publish          | forbidden                              |
| `frontend_status`   | owner의 영구 run/artifact 상태 조회                                  | forbidden                              |
| `frontend_resume`   | owner 확인, journal/lease/input 재조정 후 다음 단계 재개             | forbidden                              |
| `frontend_cancel`   | cancel 의도 기록·lease fencing·활성 frontend operation 중지          | forbidden                              |

Figma 라이브 수집은 frontend orchestration의 선행 단계로서 기존 Desktop 도구/외부 Playwright 수집기를 사용하고 각자의 인증 경로를 지킨다. frontend CLI/agent driver가 저장 binding을 해석하여 수집을 먼저 시도하고, 성공한 수집의 file/node/hash/collector receipt를 frontend_plan에 연결한다. 원문 JSON의 `source` 문자열만 보고 검증된 라이브 관측이라고 인정하지 않는다. 캐시/사용자 제공 자료는 별도 provenance로 허용한다. 활성 PluginTarget이 없어도 확보된 자료에 대한 생성·적용·상태 조회는 가능하다. 최신 라이브 자료가 없으면 계획에 freshness를 표시한다.

ToolSpec에는 현재 service 전용으로 존재하는 custom scope resolution에 대응하는 **공통 admission resolver registry**를 추가한다. run/plan ID의 저장된 authority를 **승인 전에** 복원해 path·lease·process grant·egress를 고정한다. 그 뒤 server-adapter에 제한된 포트만 주입한다. runtime 함수 안에서 처음 root를 resolve하는 구현은 금지한다.

9개를 모두 등록했을 때 예상 값은 125 tools / 106 plugin handlers / 19 server-only / 99 plugin-direct / 26 server-adapter이며 기존 service operations는 2개다. registry와 테스트에서 도출하여 검증한다. capability manifest에는 새 도구를 `service-native` provenance로 표현하며 존재하지 않는 upstream 계약을 만들어 넣지 않는다. 새 native row가 허용되도록 manifest schema를 확장하되 기존 116개 출처 계약은 보존한다.

- reference workspace는 읽기 전용, target만 쓰기 가능하다. root alias/symlink/junction/중첩·동일 저장소 문제를 canonical path와 file identity로 확인한다.
- 같은 file identity의 hard link도 검사한다. reference의 cache/profile/lockfile을 reference 안에 쓰지 않는다. 전역 WorkspacePolicy 대신 target/reference/scratch 역할별로 제한한 reader/writer를 주입한다. 새 output의 parent grant에서 publish 후 실제 target identity로 전환하는 commit point를 기록한다.
- target 아래 여러 frontend package가 있으면 명확한 package만 선택한다. reference==target을 C3로 실행하지 않는다.
- 신규 생성은 sibling staging에서 install/build/검증한 뒤 새 destination을 publish한다. 이름 충돌은 재계획하며 기존 target을 덮어쓰지 않는다.
- 레거시는 dirty worktree를 초기화하지 않는다. 파일별 base hash를 고정하고 staging에서 검증한다. 다중 파일 적용 중 실패하면 이 run이 실제 바꾼 파일만 CAS로 복구하고 사용자 동시 변경이 있으면 `outcome-unknown`/conflict로 남긴다.
- read/profile evidence와 실행 결과를 모델에 전달하는 egress 권한은 저장소별로 구분한다. reference 코드나 환경 파일을 무제한 prompt로 보내지 않는다.
- 현재 class-only consent에 `sourceAuthority + recipient/adapter + path/range/hash + classes + budget + expiry`의 grant를 합성한다. target의 project-code 허용을 reference 원문 허용으로 확대하지 않는다. evidence download, screenshot, validation log, repair 입력도 같은 manifest로 검사한다. 원문이 바뀌거나 grant가 철회되면 과거 evidence ID로 전달하지 않는다.
- 검증 프로세스/생성 코드 preview는 별도 effect·scope·network profile·timeout·child ownership을 정의한다. 원격 운영 API에 상태 변경 요청을 하지 않는다.
- frontend 전용 allowlist를 framework adapter로 정의하고 backend 파일/DB migration/server API/인증 서버 설정 변경을 차단한다. Next/Nuxt의 frontend SSR 페이지는 API 서버 생성과 구분한다.

### 8.1 Run 상태, 잠금, 재개

상태는 `planned → waiting-agent → generating → candidate-ready → validating-candidate → ready-to-apply → applying → validating-applied → completed`로 구분한다. 별도 상태는 `needs-input`, `blocked`, `failed`, `cancel-requested`, `cancelled`, `conflict`, `outcome-unknown`이다. source freshness·partial implementation·optional coverage는 별도 필드이며 `completed`라는 말로 가리지 않는다.

모든 전이는 runVersion CAS와 owner actor, plan/context/blueprint hash, leader generation, lease epoch, 하위 operation IDs에 묶는다. agent 대기는 lock을 점유하지 않는다. Figma capture lock은 기존 방식, repo apply lock은 verified repository identity 기준으로 둔다. 서로 다른 target은 병렬 처리하고 같은 target의 다른 Figma 입력은 쓰기를 직렬화한다. 복수 자원은 정렬된 authority ID 순서로 획득한다. validation은 별도 제한된 resource scheduler(초기 동시 2개)에서 실행하고 repo write lock을 잡지 않는다.

공통 admission에서 `ExecutionResourceScopeV1`과 resource hash를 고정하고 **OperationExecutor의 바깥 queue selector 자체**를 확장한다. 기존 Figma 작업은 기존 file queue, frontend metadata는 짧은 run-CAS lane, apply는 repo-write lane, validate는 process-job lane, status/cancel은 독립 control lane으로 보낸다. frontend 도구가 `PluginTarget=null`이라는 이유로 `target:none` 공통 exclusive queue에 들어가서는 안 된다. adapter 안의 scheduler만 추가하는 것으로 끝내지 않는다. 실행 중인 validate에 status/cancel이 막히지 않는 실제 통합 검사를 필수로 둔다.

validation operation은 해당 실행의 최종 종료·보고서까지 journal에 연결하며 시간 제한과 progress를 제공한다. 단순 job 등록을 검증 성공으로 표시하지 않는다. 연결 응답이 사라져도 영구 artifact에서 결과를 조회한다. 상태 조회를 60초 메모리 cache에 의존하지 않는다.

새 auth session의 동일 owner는 run 상태를 읽고 resume/cancel할 수 있다. 새 `RunOwnerAuthority`가 frontend run의 하위 operation만 취소하도록 executor에 정식 확장하며 기존 일반 operation의 authSession/requestId 제한을 전역 완화하지 않는다. cancel은 먼저 durable intent 기록과 lease fencing을 수행해 새 submit/apply를 막고, 소유 process를 종료한 뒤 부분 적용을 확인한다. resume은 기존 operation 결과와 patch journal을 조정한 후 새 step ID로 가능한 단계만 진행한다. unknown apply를 곧바로 재실행하지 않는다.

### 8.2 다중 파일 적용과 crash 복구

다중 파일을 모든 외부 편집자에게 한순간에 바뀌는 원자적 변경이라고 주장하지 않는다. 보장은 사전 input closure CAS + 파일별 적용 + crash 조정 + 조건부 복구다.

durable patch journal에 transaction/epoch, target authority, validation input closure, old/new hash·identity·mode, backup locator, write intent, applied 관측, rollback intent/result, publish commit point를 기록한다. 외부 mutation 전에 intent를 fsync하고 변경 후 실제 파일을 관측한다. crash 후 old/new/foreign 상태를 구분한다. rollback은 현재 파일이 이 run의 적용 결과와 일치할 때만 수행한다. 사용자 변경은 남기고 conflict 경로를 보고한다. 이미 효과가 남은 오류는 `committed:true` 또는 동등한 outcome으로 executor의 outcome-unknown과 연결한다.

legacy baseline은 HEAD가 아니라 실제 staged/unstaged/untracked frontend 파일을 포함한 filesystem snapshot이다. index 상태는 별도 fingerprint로 보존하고 자동 add/reset/stash하지 않는다. 읽기 전후 manifest로 동시 변경을 감지한다. 공용 frontend 코드·config·lockfile까지 포함한 검증 input closure를 적용 직전에 다시 확인한다. 바뀌면 재계획/재검증한다.

신규 publish는 같은 volume의 staging과 OS별 no-replace primitive를 사용한다. 미존재 확인만 하고 덮어쓰는 rename을 하지 않는다. 이미 있는 빈 디렉터리도 충돌이다. delete/rename은 v1에서 기본 생성하지 않으며 꼭 필요한 경우 별도 effect와 복구 테스트를 갖춘 후 사용한다. 검증 과정의 cache/dist/node_modules는 소스 changeset에 섞이지 않는다.

### 8.3 프로세스·frontend-only의 실제 강제

`frontend-source-write`와 `frontend-process`를 versioned effect로 추가하고 scope→policy→approval→executor→receipt에 연결한다. evidence-write를 임의 소스 변경 권한으로 사용하지 않는다. 실행 profile에는 executable/argv, cwd/scratch/cache 권한, script/lockfile hash, env allowlist, dependency 목적지, 시간/로그 한도, child/container ownership, 종료 결과가 포함된다.

명령 allowlist나 env 정리만으로 filesystem/network 격리를 보증하지 않는다. v1 실행 provider는 **Docker CLI + Linux container**로 고정한다. Podman/native 실행은 후속 별도 adapter다. toolchain image/digest를 고정하고 복사한 candidate·필요 frontend 입력만 제공한다. 실제 target/reference/private state·사용자 HOME·운영 secret·Docker socket은 **read-only를 포함하여 검증 container에 mount하지 않는다**. trusted broker만 Docker를 제어하며 candidate는 그 socket에 접근할 수 없다. non-root user, capability 제한, 읽기 전용 runtime과 소유 scratch/tmp, 실제 network 격리를 실행 profile로 강제한다.

dependency 취득은 별도 제한된 registry/proxy profile로 수행하고 build/test/preview는 외부 네트워크를 차단한다. preview는 소유한 loopback endpoint와 fixture adapter만 연결한다. host OS와 실제 validation OS/image digest/Node/Firefox 버전을 구분한다. Windows host는 Docker Linux-container 연결이 실제로 검증된 조합만 지원으로 표시한다. provider가 없으면 generation/계획은 지속하되 실행 검증을 `PROCESS_ISOLATION_REQUIRED`로 막고 host의 무제한 npm 실행으로 대체하지 않는다. 준비 여부를 P1에서 먼저 확인하여 생성 완료 후에야 실행 불가를 발견하지 않게 한다.

초기 runner 실증에서 외부 파일 쓰기·reference 변경·secret 읽기·운영 요청·detached grandchild fixture를 실제로 차단해야 한다. process tree/container를 run에 묶고 timeout/cancel/leader 종료 후 소유 자원만 정리한다. 기존 Chrome·사용자 서버는 정리 대상이 아니다.

frontend-only는 경로 + AST/directive + import/dependency/config diff로 검사한다. `app/api/**/route.ts`, `pages/api/**`, Nuxt `server/api/**`, 새 `use server` action, DB/인증·결제 server dependency 등은 거부한다. 기존 SSR UI 렌더·기존 API 소비는 허용한 adapter 범위에서 별도로 검사한다. root lockfile은 필요한 frontend importer 변경만 허용하고 무관한 backend script/package 변경은 거부한다.

## 9. 화면·상호작용 검증

- Figma node↔route↔component↔asset↔검증 케이스를 trace ID로 연결한다. 빠진 section/asset/상태는 scope에 남긴다.
- Figma에 존재하는 desktop/mobile/tablet 디자인을 우선한다. 없는 breakpoint는 예를 들어 1440/768/390에서 동작을 검증하되 관측된 원본 디자인이라고 주장하지 않는다.
- static pixel 비교만으로 UX 완료를 판단하지 않는다. routing, filter/sort, quantity/cart, drawer/modal, comparison, form validation, focus/keyboard를 별도로 검사한다.
- 신규 backend가 없는 C1/C3/C4는 typed fixture와 frontend adapter로 상태를 구현한다. interaction을 `local`, `fixture`, `existing-api`, `unavailable`로 분류하고 loading/error/empty/success 및 최종 표시를 정한다. cart/filter/quantity는 실제 로컬 상태가 바뀌며 Checkout은 입력 검증 후 “데모이며 주문이 접수되지 않음”을 관련 화면에도 표시한다. 무응답 버튼·무한 loading·가짜 인증/결제 완료를 허용하지 않는다.
- C2는 기존 프론트엔드 데이터 계약을 보존하고 fake data가 운영 코드 기본값으로 섞이지 않도록 한다. 같은 toolchain/명령/환경/fixture로 실제 dirty baseline과 candidate를 검사한다. 의도한 UI 차이와 유지해야 할 동작을 분리한다. 기존 실패는 test ID·원인·로그 signature·영향 범위를 고정하며 같은 이름의 새 실패/악화를 면제하지 않는다. baseline 자체가 실행 불가하면 회귀 검증은 blocked다.
- Figma의 기존 Chrome은 수집 전용으로 유지한다. 기본 preview는 외부 Playwright의 별도 headless Firefox이며 설치도 `playwright install firefox`처럼 해당 엔진만 지정한다. WebKit은 OS/browser 사전 실증을 통과한 조합의 선택 검사다. Chrome을 새로 열지 않는다. 필요한 Chromium 전용 endpoint가 없으면 해당 엔진 coverage를 미수행으로 표시한다. 기존 `service/skills/figma-codegen/references/verify.md`의 새 Chrome 실행 예시도 새 실행 규칙에 맞게 변경한다.
- 검증은 source/design/asset hash·viewport·브라우저/폰트 조건을 기록한다. 허용 오차와 동적 영역 mask는 계획에서 정하며 실패를 통과시키기 위해 나중에 넓히지 않는다.

시각 원본은 Figma **node export PNG**다. 편집기의 `viewport.png`는 연결 증거로만 사용한다. file/node/scope, node 크기, crop/export scale/pixel 크기, asset hash, 수집 시작/종료 시점을 연결하고 값·PNG 전후 주요 속성을 재확인한다. 변화가 있으면 해당 scope를 재수집한다. 원자적 캡처라고 표시하지 않는다. 이미지 decode·폰트 loading·viewport/DPR·locale·시계·애니메이션·fixture 상태를 고정하고 runtime PNG/diff/차이 판정을 저장한다.

각 필수 route에 직접 URL/reload, 기본 상태, `given/action/expected` interaction, focus/keyboard, 가로 overflow, console/page error, 필수 asset 요청 실패 검사를 둔다. 버튼이 존재하는지만 확인하지 않는다. 디자인에 없는 viewport는 원본 시각 일치 대신 responsive 동작 검사로 구분한다.

C3/C4의 설치 독립성은 output 소스와 lockfile만 외부 임시 root에 복제하고 parent workspace·reference·기존 node_modules/dist·NODE_PATH가 보이지 않는 환경에서 frozen install → build → production preview → route/interaction으로 검사한다. workspace/file/link/absolute import, config extends, dynamic import/glob, asset URL, 환경 변수 의존을 확인한다. 원본 reference를 삭제/이동해서 테스트하지 않고 fixture 복제본을 격리한다. reference의 파일 목록·내용 manifest는 실행 전후 동일해야 한다.

### 9.1 지원 행렬과 완료 판정

지원 행 키는 `requestedCase + resolvedStrategy + adapter/presetVersion + routerMode + renderMode + targetKind + designScopeHash`다. dependency 선언/lock 해석/실설치 버전과 Node/package manager/browser를 별도 기록한다. capability는 `detected`, `profile-complete`, `can-scaffold`, `can-transfer`, `can-patch`, `can-build`, `can-preview`를 구분한다.

| 범위                                   | v1 판정 기준                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| React/Vite 기본 + Vue/Vite 선택 preset | 필수: 해당 preset의 C1 두 분기/C2/C3/C4 인수. router mode와 CSS 방식은 검증된 조합만 광고 |
| Next App Router / Pages Router         | 후속 단계에서 각 router·허용 SSR/client 경계·hydration·API fixture 검사 후 각각 지원 전환 |
| Nuxt                                   | 후속 단계에서 modules/auto-import/SSR 조합을 실증한 후 지원 전환                          |
| 기타/동적 config 미해석                | 분석/계획 가능 범위만 반환. legacy를 임의 새 Vite로 교체하지 않음                         |

검사는 `required` 및 `passed/failed/blocked/skipped/not-applicable`을 갖는다. not-applicable과 선택 검사는 계획 시 사유를 고정한다. **모든 필수 route/section/state, frontend-only 경계, build/typecheck, 핵심 interaction/a11y, 계획된 시각 비교가 충족되고 적용된 source hash에 연결될 때만 completed**다. 필요한 원본·자산·폰트가 없거나 baseline/필수 browser 검사가 blocked/skipped이면 draft/blocked/partial 결과로 남긴다. 실패 후 필수 항목을 삭제하거나 허용 오차를 넓혀 완료로 바꾸지 않는다.

캐시 기준으로 검증된 결과와 현재 라이브 Figma 일치는 별도 판정이다. `freshnessPolicy`를 계획에서 고정한다. 이번 공유 URL의 live 인수는 최신 재수집을 필수로 두며, 그 전에는 캐시로 계획·candidate를 만들 수 있다. 사용자가 고정 캡처 기준을 선택한 run은 `completedAgainst`에 capture/scope/source hash를 표시하고 “고정 캡처 기준 완료”로 표현한다. optional Chromium/WebKit 미검증은 해당 엔진 제한으로 표시하고 기본 Firefox 필수 검사를 대신하지 않는다. `verify:source` 통과·scaffold 생성·agent 응답만으로 frontend completed가 되는 부정 경로를 테스트한다.

## 10. CLI와 사용자 진입점

제안 명령(아직 구현되지 않음):

```text
sfp frontend plan --case new [--design <saved-design-id-or-url>] [--reference <repo>] [--out <new-path>]
sfp frontend plan --case legacy --target <repo> [--package <frontend-package>]
sfp frontend plan --case new-reference --reference <repo> [--reference <repo2>] [--out <new-path>]
sfp frontend plan --case new-blank [--out <new-path>] [--stack <supported-preset>]
sfp frontend run --plan <id>
sfp frontend status|resume|cancel <run-id>
sfp frontend validate <run-id>
```

모든 plan 명령은 `--scope auto|<scope-manifest>`, 선택적 `--design`, `--stack`, `--package`를 전용 parser로 검증한다. frontend의 `--target`은 repositoryTarget이며 기존 관리 CLI의 Figma `--target active|none`과 혼용하지 않는다. 내부 필드도 repositoryTarget/designTarget으로 구분한다. CLI는 frontend 전용 분기를 통해 위 canonical 도구를 `kind:'tool'`로 호출한다.

새 design 입력을 생략하면 현재 프로젝트에 명시적으로 저장된 design binding을 사용한다. 이번 프로젝트 초기 binding에는 이미 공유된 URL을 사용한다. 현재 활성 Figma 탭을 이유 없이 다른 프로젝트의 기본 디자인으로 삼지 않는다. UI/CLI에는 신규·기존·레퍼런스 활용 여부와 프론트엔드만 구현한다는 범위를 먼저 표시한다.

## 11. 구현 순서와 완료 기준

| 단계                            | 구현·주요 파일(예정)                                                                                         | 단계 완료 조건                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| P0 계약/분기/완료 기준          | shared/frontend-build.ts, ir/frontend-*.ts, frontend/resolve-context.ts                                      | C1→C3/C4, optional 원시 입력→strict 실행 요청, 화면 scope, support matrix, 상태/lease/default 예산                              |
| P1 authority와 runner 선행 실증 | shared effects/egress/invocation, execution admission resolver, frontend/repo-authority.ts·process-runner.ts | source-write/process grant, root별 read/write, 실제 container 격리·Firefox 사전 실증. 보호 전에는 저장소 script를 실행하지 않음 |
| P2 실제 agent 수직 연결         | frontend/agent-port.ts·run-coordinator.ts, MCP 9개 ToolSpec, frontend CLI parser, agent driver/skill         | 작은 디자인 fixture→실제 client claim/submit→scoped scratch→build/preview→hash report. dummy/guidance만으로 완료 불가           |
| P3 디자인/코드 분석 통합        | frontend/design-source.ts·repo-analysis.ts, profile/scan 보강                                                | 저장 URL 재사용, 캡처 receipt/fidelity/scope, alias/import/props/monorepo·복수 reference 근거                                   |
| P4 blueprint/scaffold/최초 생성 | frontend/blueprint.ts, scaffolds/react-vite·vue-vite, stack adapters                                         | 우선 C4 React 한 화면 수직 실증 후 routes/상태·Vue 확대. 순수 candidate 생성과 실행 검증을 구분                                 |
| P5 적용·복구                    | frontend/patch-store.ts·patch-journal.ts, repository lock, executor outcome 연동                             | 실제 프로세스 crash, multi-file CAS/rollback, no-replace publish, 사용자/index 보존. 이 단계 전 target 적용 비활성              |
| P6 C2/C3 확장                   | frontend/strategies/legacy.ts·reference-new.ts·blank-new.ts, reference-transfer.ts                           | dirty baseline, 기존 API/UX 보존, reference 불변·closure 이전·외부 clean install, 복수 reference 충돌                           |
| P7 기능/시각 인수               | frontend/validation.ts, runner assertions, generated-app fixtures                                            | route/state별 실제 assert, node PNG 비교, 필수 check 집계, apply 후 source hash 재검증                                          |
| P8 배포/문서/전체 검증          | CLI/MCP registry·capability schemas/manifest, skills, scripts, CI                                            | 125 도구 계약, 4개 사용자 경우 인수, 독립 설치/실제 agent, source/evidence provenance, 아래 검증 순서                           |
| P9 framework 확장               | adapters/next-app·next-pages·nuxt 및 고유 fixtures                                                           | router·SSR/hydration·auto-import 등 검증한 조합만 support matrix 승격                                                           |

의존성은 `P0 → P1 → P2 → P3/P4 → P5 → P6 → P7 → P8`, 이후 P9다. P3/P4의 순수 분석·candidate 생성은 독립 개발할 수 있지만 install/build는 P1 runner를 통하고 target apply는 P5 이후만 가능하다. 신규 scaffold build만 통과한 상태를 Figma 구현 완료로 표시하지 않는다.

P8에서는 `skills/figma-codegen`을 네 경우의 실제 도구 사이클로 갱신하고 오픈소스 참조의 기존 고지를 보존한다. source-native capability schema·result/policy/runtime·public count·CLI dispatch·package contents·source validation을 함께 갱신한다. 원본 `code-kb/`는 변경하지 않는다. 기존 staged 구현을 기준선으로 기록하고 새 변경만 별도 provenance slice로 관리한다.

## 12. 인수 테스트 행렬

| 테스트                                     | 필수 증거                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1-A 신규, 경로/reference/stack/scope 생략 | 저장 binding만으로 안전한 output·scope·C4 분기·실제 파일·독립 install/build/runtime. CLI와 MCP 양쪽 검사                                           |
| C1-B 신규, reference 제공                  | requestedCase=C1 유지, C3 분기 이유, 원본 변경 없음, 지정 디자인·독립 설치 검증                                                                    |
| C2-A 깨끗한 legacy                         | Figma 필수 UX와 기존 component/token/API 통합, 의도한 변경·유지할 회귀 분리                                                                        |
| C2-B dirty legacy/monorepo                 | staged+unstaged가 같은 파일에 공존·untracked import 포함, 올바른 package·index/사용자 변경 보존·baseline 비교                                      |
| C3-A 단일 reference                        | 외부 root clean install/build/preview, reference 쓰기 0, shared frontend closure 해결, source/env/원본 도메인 미이전                               |
| C3-B 복수 reference/충돌                   | 주·보조 역할, 의존/패턴 채택·거절 근거, 독립성과 호환성 또는 구체 미지원. cwd가 reference인 자동 output도 외부로 배치                              |
| C4-A 명시적 무참조                         | 주변에 다른 repo가 있어도 읽지 않음, 기본/선택 preset, Figma 기반 tokens/routes/state, backend 없음                                                |
| 네 경우 공통                               | Figma 계정 Dev Mode 불필요, 실제 관측/가정 분리, source/asset/hash, 취소·실패·재개·동시 변경, 최소 desktop/mobile 상호작용 검증                    |
| 경계 실패                                  | target/reference 동일·중첩·symlink, stale base hash, missing asset/font, partial capture, 미지원 stack, agent 부재, install 실패, 프로세스 timeout |

대표 eCommerce는 공유된 파일의 Home/Shop/Single Product/Cart/Checkout 등 실제 확인된 scope를 사용한다. 네 경우 모두 같은 Figma 관측으로 서로 다른 target 조건의 결과를 비교한다. fixture 테스트와 실제 Figma 연결 검증은 별도 결과로 남긴다.

위 화면명은 과거 캡처의 후보이며 최신 범위를 대신하지 않는다. 기본 전체 요청을 대표 화면 다섯 개로 조용히 축소하지 않는다. 실제 수집에서 Contact/Blog/Comparison/overlay 등도 화면·상태·자료로 분류하고 scope manifest에 유지한다. 초기 한 화면 수직 실증은 전체 케이스 완료와 구분한다.

### 12.1 실패 주입 및 재개 행렬

| 시점                             | 기대 상태와 남아야 할 것                                     | 재개/정리                                            |
| -------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| planning/수집 중 중단            | incomplete scope, source refs, target 변경 0                 | 미완료 범위만 재수집/재계획                          |
| waiting-agent/lease 만료         | work item과 예산 유지, epoch fencing                         | 새 lease, old submit 거절                            |
| install/build/preview timeout    | failed/blocked 보고서, 소유 scratch만 남음                   | 소유 child/container/port 종료; 정책 확인 후 새 step |
| apply 직전 입력 변경             | conflict, target 변경 0                                      | input closure 재분석·재검증                          |
| N개 중 k개 적용 후 crash         | applied intent/old/new/foreign 관측, 일반 failed로 축소 금지 | run이 쓴 상태만 CAS 복구; 사용자 편집은 보존         |
| publish 직후 receipt 전 crash    | commit point와 실제 destination hash                         | 결과 조정 후 receipt 복구; 중복 생성 금지            |
| rollback 중 실패/Windows lock    | conflict 또는 outcome-unknown, 정확한 파일·복구 상태         | 자동 덮어쓰기/전체 삭제 금지, 해소 후 조정           |
| leader/CLI 교체 또는 중복 resume | durable runVersion·owner·epoch·예산 유지                     | 동일 owner만 재개, 이미 완료된 step 재적용 금지      |

각 행은 혼합 create/replace(확장 시 delete/rename), 첫/중간/마지막 mutation 및 journal fsync 전후의 실제 자식 프로세스 종료를 포함한다. 사용자 reference를 옮기거나 삭제하지 않고 fixture에서 재현한다.

### 12.2 검증 실행과 산출물

| 검증                     | cwd/진입점(추가 예정 포함)                                                                                                                  | 증거                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 계약/전략/복구 단위·통합 | repository root: `corepack pnpm -C service exec vitest run packages/mcp/test/frontend packages/cli/test/frontend packages/ir/test/frontend` | case/lease/effect/CAS/부정 fixture 결과                      |
| 실제 agent 연결          | service: `sfp frontend run --plan <id>` + 지원 MCP client driver                                                                            | claim/submit/repair/apply operation IDs와 실제 생성 파일     |
| 생성 앱 인수             | 허용된 container scratch의 고정 install/build/test profile                                                                                  | toolchain/lock/source hash, exit/log, route·UX·a11y·PNG/diff |
| live Figma 네 경우       | 저장된 디자인 binding의 scope를 고정해 C1-A/C1-B/C2/C3/C4 실행                                                                              | 실수집 receipt와 동일 scope의 결과별 비교                    |
| 소스·패키지 회귀         | repository root: `corepack pnpm -C service verify:source` + 새 frontend acceptance gate                                                     | pipeline 검증과 generated-app 검증을 별도 집계               |

run artifact는 전용 frontend namespace의 immutable JSON/소스 manifest/patch journal/검증 산출물로 저장한다. source hash가 변하면 이전 성공 근거를 새 파일에 재사용하지 않는다. 이번 계획 문서 검토에는 이러한 구현 테스트를 실행한 것으로 표시하지 않는다.

최종 개발 검사는 기존 `verify:source`, 추가 frontend 인수 테스트, 독립 artifact 설치와 runtime 확인을 포함한다. 긴 전체 검증은 기능·관련 테스트를 먼저 끝내고 한 번에 수행하며 코드가 바뀐 경우 해당 근거를 갱신한다.

## 13. 독립 리뷰와 최종 판단

1. 제품/요구 리뷰: 네 경우의 의미, 신규 경로 기본값, frontend-only, 관측/가정/완료 기준의 누락.
2. 아키텍처/실행 리뷰: 현재 single-workspace/target/operation 계약과 실제 생성 실행자의 공백, 복수 root·원자적 적용·프로세스 경계.
3. 검증/개발 현실성 리뷰: adapter 지원 범위, reference 이전, 브라우저 제한, UX 검증, 단계 의존성과 실패/복구 테스트.

세 리뷰 문서와 v0.9 재확인을 받았다. 메인은 총 23개 지적(P0 2개, P1 17개, P2 4개)을 채택 또는 보강하여 반영했다. 최종 아키텍처 재확인에서 추가로 짚은 outer queue 선택과 container의 read-only host mount 금지도 §8.1/8.3에 명시했다. 이는 계획 수준의 해결이며 구현·실증 완료는 각 단계의 인수 기준을 충족해야 한다.

- [제품/요구 리뷰](../reviews/2026-09-07-frontend-plan-product-review.md)
- [아키텍처/실행 리뷰](../reviews/2026-09-07-frontend-plan-architecture-review.md)
- [검증/현실성 리뷰](../reviews/2026-09-07-frontend-plan-validation-review.md)
- [메인 최종 판단과 반영표](../reviews/2026-09-07-frontend-plan-final-decision.md)

메인 판단: **이 v1.0을 구현 기준으로 확정한다.** C1 상위 흐름과 3개 실행 전략, 실제 MCP pull/submit 실행자, canonical 도구 9개, frontend-only, reference 불변, 필수 검증 기반 완료 판정을 채택한다. 초기 service-operation 중복 추가안과 명령 allowlist만으로 격리를 보증하는 방식은 사용하지 않는다. 이번 요청의 계획·3인 리뷰·보강·최종 판단을 완료하며, 생산 코드 구현을 완료한 것으로 표시하지 않는다.

## 14. 공식 문서 확인과 선택 이유

- C4 기본 React/Vite는 frontend-only 신규 생성의 단순한 출발점으로 선택했다. React 공식 문서는 Vite 등 build tool로 직접 구성을 만드는 경로와 routing 등 추가 선택의 필요성을 설명한다. 기존 C2/C3 stack에 이 기본값을 강제하지 않는다. [React — Build from scratch](https://react.dev/learn/build-a-react-app-from-scratch), [Vite — Getting started](https://vite.dev/guide/) (확인 2026-09-07).
- Playwright는 Firefox/WebKit 및 엔진별 설치를 지원한다. 검증은 실제 browser binary 버전과 OS에 묶으며, 기존 Chrome 보호와 별개인 소유 preview 세션으로 구성한다. [Playwright — Browsers](https://playwright.dev/docs/browsers) (확인 2026-09-07).
- screenshot 비교는 환경에 영향을 받으므로 폰트·OS·엔진·viewport와 baseline을 고정한다. 네트워크 mocking은 UX fixture에 사용하되 OS 격리의 대체로 보지 않는다. [Visual comparisons](https://playwright.dev/docs/test-snapshots), [Network](https://playwright.dev/docs/network) (확인 2026-09-07).
- Docker 실행 옵션을 기반으로 권한·filesystem·network profile을 구성하되 이름만으로 안전을 주장하지 않고 P1의 실제 실패 주입으로 강제를 확인한다. [Docker — Running containers](https://docs.docker.com/engine/containers/run/) (확인 2026-09-07).
