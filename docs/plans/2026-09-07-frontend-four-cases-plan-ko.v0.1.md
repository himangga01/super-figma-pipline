# Figma 기반 프론트엔드 구현 — 네 가지 사용 사례 확장 계획

작성일: 2026-09-07. 상태: 초안 v0.1, 서브에이전트 3개 검토 전.

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

| 사용자 경우 | 입력과 판정 | 동작 | 완료 결과 |
|---|---|---|---|
| C1 신규 서비스 | Figma와 신규 서비스 의도, reference는 선택 | 신규 생성 진입점. reference가 명시되면 C3, 없으면 C4로 계획을 확정한다 | 신규 프론트엔드, 실행법, 검증 결과 |
| C2 레거시 서비스 | 존재하는 target 저장소/프론트엔드 package | 기존 구조·버전·공용 API·컴포넌트·토큰·테스트를 분석한 후 해당 frontend만 변경 | 기존 서비스에 통합된 UI와 변경 전후 회귀 근거 |
| C3 레퍼런스 기반 신규 | 신규 target와 하나 이상의 명시적 reference 저장소 | reference를 읽기 전용으로 분석하여 구조·라이브러리·코딩 관례를 선택적으로 이전 | 독립 설치·빌드 가능한 신규 frontend, 패턴 채택/거절 근거 |
| C4 레퍼런스 없는 신규 | 신규 target, reference 없음 또는 명시적 미사용 | 검증된 기본 frontend 구성을 선택하고 Figma 중심으로 새 구조·토큰·컴포넌트 생성 | 독립 frontend, 기본 선택 이유, 가정과 구현 범위 |

사용자 경우는 4개로 문서화하고 테스트한다. 실행 전략은 `legacy`, `reference-new`, `blank-new` 3개를 공유한다. C1은 C3/C4를 선택하는 정상적인 제품 흐름이다. C1에 사용자가 스택을 미리 지정해야 한다는 조건을 추가하지 않는다. 명시적으로 C3를 선택했는데 reference가 없으면 C4로 조용히 바꾸지 않는다. 명시적 C4에서는 주변 저장소를 몰래 reference로 사용하지 않는다.

신규 target 경로를 생략하면 현재 workspace가 쓰기 가능하고 목적이 신규임이 명확할 때 `<workspace>/generated-frontends/<design-slug>-<run-short-id>`를 제안값으로 자동 할당한다. 해당 위치는 계획에 드러내고 기존 디렉터리를 덮어쓰지 않는다. 현재 개발 환경에서는 이 규칙을 적용하면 pipeline 소스와 별도 하위 폴더가 된다. C2 target이 불명확하거나 monorepo frontend 후보가 여러 개면 그 선택만 요청하고 디자인 분석 등 독립 작업은 계속한다.

## 3. 현재 코드에서 재사용할 기반과 실제 공백

| 현재 근거 | 재사용 | 추가할 내용 |
|---|---|---|
| `service/packages/cli/src/commands.ts`, `snapshot-reader.ts`, `capture-assets.ts` | Chrome/Desktop 수집, scope·잘림·자산 상태 | 프로젝트 단위 디자인 연결 저장, 범위 계획과 재개 연결 |
| `packages/cli/src/project-inspector.ts` | 기존 profile·component/token/icon 매핑 | CLI 내부 조합을 서버의 공통 코드 분석 모듈로 이동, target/reference 역할 분리 |
| `packages/mcp/src/profile/profile.ts`, `profile/conventions.ts` | framework/styling/AST 근거 | workspace package 선택, alias 실제 해석, import graph, route/API/state/test/asset 관례와 신뢰도 |
| `packages/ir/src/inspection-v1.ts`, `snapshot-v1.ts`, `grounding-graph-v1.ts` | 관측 파일 hash와 fidelity, 디자인↔코드 근거 | frontend 실행 요청·blueprint·변경 계획·검증 보고서 |
| `packages/mcp/src/execution/execution-plane.ts`, `operation-executor.ts` | 인증·정책·승인·큐·저널·취소·재전송 | 복수 저장소 역할, 장기 frontend run과 짧은 단계 operation 연결 |
| `packages/mcp/src/fs/atomic-file.ts`, `namespace-files.ts` | retained path·create/CAS | 임의 frontend 파일용 다중 파일 patch transaction; snapshot 전용 namespace는 무리하게 확대하지 않음 |
| `packages/shared/src/operations.ts` | effects와 결과 전달 정책 | repo source write·검증 프로세스·참조 코드 전달 계약 |
| `packages/cli/src/admin-commands.ts` | 인증된 control CLI | frontend plan/run/status/resume/validate, agent 실행 계약 |

현재 코드는 디자인 및 코드 분석 연결 서비스다. 결과가 나왔다는 이유만으로 새 프로젝트가 생성되거나 실제 파일이 구현되는 것은 아니다. 이번 확장은 **실행자 연결, scaffold, patch 적용, 검증**까지 넣어 이 공백을 메운다.

## 4. 제품 흐름과 산출물

`요청 → 디자인/경로 확인 → 저장소 관례 분석 → blueprint → 변경 계획 → 격리된 생성·수정 → frontend 검증 → 적용 → 재검증 → 결과`

- 입력: 공유 Figma 연결, 사용자 경우, target 또는 신규 출력 부모, reference 목록, 화면 범위, 선택적 framework 제약.
- 계획 결과: 해석된 경우, 읽기/쓰기 저장소 목록, frontend 경계, 화면·route·상호작용 목록, 구조, 라이브러리 선택, 재사용/신규 항목, 가정, 필요 자산, 검증 항목.
- 실행 결과: 실제 생성/변경된 파일, 실행 명령, 자산·토큰·컴포넌트 provenance, 검증 로그/스크린샷, 미완료 항목과 재개 방법.
- Figma가 일시적으로 연결되지 않아도 저장소 분석과 계획은 진행한다. 캐시 사용 시 file/node/hash/time/partial을 노출하며 현재 파일 실측 완료로 표시하지 않는다.

## 5. 데이터 계약

새 `packages/shared/src/frontend-build.ts`와 IR 모델은 strict Zod schema로 정의한다. versioned artifact를 사용하고 사용자 입력을 filesystem authority로 곧바로 사용하지 않는다.

1. `FrontendBuildRequestV1`: `requestedCase`, `designRef`, `target`(new/existing tagged union), `references[]`, `pageScope`, `constraints`, `frontendOnly:true`. case와 target/reference의 불일치를 거부한다.
2. `ResolvedFrontendContextV1`: `resolvedStrategy`, 각 저장소의 canonical root·workspace ID·역할·read snapshot hash, target frontend package, 생성 시 없는 디렉터리의 parent identity, 변경 전 파일 manifest.
3. `PatternProfileV1`: 프레임워크/정확한 설치 버전, bundler/package manager, directory/route/import alias, component API, styling/tokens/theme, state/data boundary, a11y/test, source file/range/hash, confidence, missing/unsupported.
4. `FrontendBlueprintV1`: design scope/hash/fidelity, routes·화면, 컴포넌트와 variant, tokens/assets, interaction/state, target APIs 또는 fixture 어댑터, responsive 규칙, 채택/거절한 reference 패턴과 이유.
5. `FrontendChangeSetV1`: run ID, blueprint hash, relative path, create/replace/delete, base hash, proposed content hash, 근거 IDs, frontend 범위, dependencies/lockfile 변경. 삭제와 overwrite는 명시적 변경 계획에 포함한다.
6. `FrontendValidationReportV1`: check ID, tool/version, input source hash, command/argv, exit code, logs/artifact hashes, viewport/route/state, visual/interaction/a11y, baseline 비교, skipped/blocked와 이유.
7. `FrontendRunV1`: immutable request/context/blueprint references, stage, step operation IDs, outcome, created file manifest, locks, partial applications, retry history. 성공은 검증된 실제 파일 hash와 연결한다.

`requestedCase`와 `resolvedStrategy`를 둘 다 기록하여 C1의 C3/C4 선택 이유를 추적한다. reference provenance는 target import 경로와 구분하고 원본 reference 경로를 신규 코드의 runtime dependency로 남기지 않는다.

## 6. 저장소 분석·패턴 선택

- `RepoReader`로 읽고 root/package/파일/행/hash를 기록한다. worktree, Git 없는 폴더, monorepo를 지원한다.
- tsconfig/jsconfig extends·paths, package exports, bundler alias와 내부 workspace dependency를 분석한다. 코드 실행으로 config를 평가하지 않고 정적 분석 불가 항목은 명시한다.
- C2 우선순위: 사용자의 frontend 제약 → 대상 서비스의 실제 API/구조 → 해당 package의 관례 → Figma 시각·상호작용 요구. 충돌 시 해당 UI 범위에 필요한 최소 변경을 계획에 드러낸다. 레거시 framework를 임의 교체하지 않는다.
- C3 우선순위: 사용자 제약 → Figma UX → 선택한 reference의 frontend 관례. 기존 브랜드·도메인·API 주소·인증/결제/DB·비밀 값·불필요한 backend dependency는 이전하지 않는다.
- 여러 reference가 있으면 주 reference 1개와 보조 목적(예: 토큰/라우팅/컴포넌트)을 기록한다. 충돌을 평균내지 않고 근거·호환성을 비교해 채택한다.
- reference 사용은 단순 파일 전체 복사가 아니다. 패턴은 구조화된 규칙으로 추출하고 코드 재사용은 필요한 frontend 파일/의존 closure 단위로 검토한다. 제3자 코드 복사 시 라이선스/고지를 유지하고 확인 불가 코드는 패턴 참고로 제한한다.
- C4 기본 후보: React + TypeScript + Vite + CSS Modules/디자인 토큰, 여러 route가 필요하면 frontend router. UI kit·전역 state·API 라이브러리는 필요가 입증될 때 추가한다. 버전은 구현 시 공식 문서 및 lockfile로 검증·고정한다.
- 분석할 수 있음과 자동 변경·검증이 가능한 stack을 구분한다. 초기 지원 목록과 adapter별 capability를 명시하고 미지원 stack을 C4로 몰래 변환하지 않는다.

## 7. 프론트엔드 실행 엔진

`packages/mcp/src/frontend/`에 planning/orchestration을 만들고 repository IO·executor를 port로 분리한다.

- `FrontendAgentPort`: blueprint와 제한된 file evidence를 받아 candidate change set을 작성하고 검증 실패에 대한 수정안을 만든다. 현재 연결된 코딩 에이전트를 실행자로 사용하며 단순 guidance 문자열 반환을 구현 완료로 취급하지 않는다.
- daemon만 켜져 있고 에이전트가 없으면 `waiting-agent`로 기록한다. CLI의 `frontend run`은 활성 실행자 연결을 확인하고 준비/분석까지 진행한다. API 키를 artifact에 넣지 않는다.
- baseline 템플릿과 `FrontendScaffoldPort`가 신규 project의 package/config/entry를 재현 가능하게 만들고, 에이전트는 Figma에 맞는 페이지·컴포넌트·상태를 채운다.
- `ReferenceTransferPlan`은 구조/선택 dependency/필요 frontend 재사용을 계획하고 신규 root로 import를 재작성한다.
- `FrontendPatchPort`는 생성/변경 계획만 받아 base hash와 경계를 확인해 적용한다. 임의 shell이나 raw exec 기능을 새 MCP tool로 노출하지 않는다.
- `FrontendValidationPort`는 제한된 실행 프로파일에서 dependency install/build/typecheck/test/render를 수행한다. 레거시의 package script도 실행 가능한 코드이므로 계획에서 명시한 작업만 실행한다.
- 자동 수정은 최대 3회/전체 시간·비용·변경량 예산 안에서 실행한다. 해결되지 않은 오류는 실패 로그와 남은 파일을 남기며 완료로 표시하지 않는다.

초기 코드 작성 adapter는 기존 분석 기반이 있는 React/Vite·Next frontend, Vue/Vite·Nuxt frontend를 목표로 한다. 각각 fixtures와 적용 검증을 갖춘 후 지원으로 표시한다. 다른 framework는 profile/blueprint까지만 가능한 상태를 구분한다.

## 8. 기존 실행 체계와 IO 확장

장기 run을 operation queue에 계속 잡아두지 않는다. 단계별 service operation을 만들고 이미 있는 journal/approval/egress/evidence 경로를 사용한다. 내부 handler의 직접 우회 실행은 금지한다.

제안 service operations: `frontend.plan`, `frontend.generate`, `frontend.apply`, `frontend.validate`. 상태/재개/취소는 전용 control endpoint로 run과 하위 operation에 연결한다. 기존 service name enum, registry, control routing, origin 제한, policy, result schemas, receipt/evidence projector, CLI와 테스트를 함께 바꾼다. 기존 116 도구에 공개 wrapper를 추가할지는 리뷰 후 확정하며 숨은 capability를 만들지 않는다.

- reference workspace는 읽기 전용, target만 쓰기 가능하다. root alias/symlink/junction/중첩·동일 저장소 문제를 canonical path와 file identity로 확인한다.
- target 아래 여러 frontend package가 있으면 명확한 package만 선택한다. reference==target을 C3로 실행하지 않는다.
- 신규 생성은 sibling staging에서 install/build/검증한 뒤 새 destination을 publish한다. 이름 충돌은 재계획하며 기존 target을 덮어쓰지 않는다.
- 레거시는 dirty worktree를 초기화하지 않는다. 파일별 base hash를 고정하고 staging에서 검증한다. 다중 파일 적용 중 실패하면 이 run이 실제 바꾼 파일만 CAS로 복구하고 사용자 동시 변경이 있으면 `outcome-unknown`/conflict로 남긴다.
- read/profile evidence와 실행 결과를 모델에 전달하는 egress 권한은 저장소별로 구분한다. reference 코드나 환경 파일을 무제한 prompt로 보내지 않는다.
- 검증 프로세스/생성 코드 preview는 별도 effect·scope·network profile·timeout·child ownership을 정의한다. 원격 운영 API에 상태 변경 요청을 하지 않는다.
- frontend 전용 allowlist를 framework adapter로 정의하고 backend 파일/DB migration/server API/인증 서버 설정 변경을 차단한다. Next/Nuxt의 frontend SSR 페이지는 API 서버 생성과 구분한다.

## 9. 화면·상호작용 검증

- Figma node↔route↔component↔asset↔검증 케이스를 trace ID로 연결한다. 빠진 section/asset/상태는 scope에 남긴다.
- Figma에 존재하는 desktop/mobile/tablet 디자인을 우선한다. 없는 breakpoint는 예를 들어 1440/768/390에서 동작을 검증하되 관측된 원본 디자인이라고 주장하지 않는다.
- static pixel 비교만으로 UX 완료를 판단하지 않는다. routing, filter/sort, quantity/cart, drawer/modal, comparison, form validation, focus/keyboard를 별도로 검사한다.
- 신규 backend가 없는 C1/C3/C4는 typed fixture와 frontend adapter로 상태를 구현하고 README에 demo 범위를 표시한다. 실제 payment/order 제출을 만들지 않는다.
- C2는 기존 프론트엔드 데이터 계약을 보존하고 fake data가 운영 코드 기본값으로 섞이지 않도록 한다. 기존 실패 baseline과 이번 변경으로 생긴 실패를 구분한다.
- Figma의 기존 Chrome은 수집 전용으로 유지한다. 로컬 preview 검증은 외부 Playwright의 별도 headless Firefox/WebKit을 사용한다. Chrome을 새로 열지 않는 기존 요구를 지킨다. Chromium 전용 검증 endpoint가 없으면 해당 엔진의 실검증을 미수행으로 표시한다.
- 검증은 source/design/asset hash·viewport·브라우저/폰트 조건을 기록한다. 허용 오차와 동적 영역 mask는 계획에서 정하며 실패를 통과시키기 위해 나중에 넓히지 않는다.

## 10. CLI와 사용자 진입점

제안 명령(아직 구현되지 않음):

```text
sfp frontend plan --case new --design <saved-design-id-or-url> [--out <new-path>]
sfp frontend plan --case legacy --target <repo> [--package <frontend-package>]
sfp frontend plan --case new-reference --reference <repo> [--reference <repo2>] [--out <new-path>]
sfp frontend plan --case new-blank [--out <new-path>] [--stack <supported-preset>]
sfp frontend run --plan <id>
sfp frontend status|resume|cancel <run-id>
sfp frontend validate <run-id>
```

새 design 입력을 생략하면 현재 프로젝트에 명시적으로 저장된 design binding을 사용한다. 이번 프로젝트 초기 binding에는 이미 공유된 URL을 사용한다. 현재 활성 Figma 탭을 이유 없이 다른 프로젝트의 기본 디자인으로 삼지 않는다. UI/CLI에는 신규·기존·레퍼런스 활용 여부와 프론트엔드만 구현한다는 범위를 먼저 표시한다.

## 11. 구현 순서와 완료 기준

| 단계 | 구현·주요 파일(예정) | 단계 완료 조건 |
|---|---|---|
| P0 계약/분기 | shared/frontend-build.ts, ir/frontend-*.ts, frontend/resolve-context.ts | C1→C3/C4와 C2/C3/C4 입력·경로·부족 정보 단위 테스트 |
| P1 공통 디자인 입력 | frontend/design-source.ts, CLI commands/artifacts | 저장된 URL 재사용, Chrome/Desktop/cached inspection를 scope·fidelity 포함해 연결 |
| P2 target/reference 분석 | frontend/repo-analysis.ts, profile 모듈 | 실제 alias/import/dependency closure·monorepo package·복수 reference 근거, 코드 실행 없는 분석 |
| P3 blueprint/scaffold | frontend/blueprint.ts, scaffolds, stack adapters | reference가 없는 신규도 즉시 계획·독립 build 가능한 frontend 생성 |
| P4 실행자 연결 | frontend/agent-port.ts, run-coordinator.ts, agent/client integration | 실제 candidate 파일이 만들어짐, waiting-agent·budget·repair loop·resume 검증 |
| P5 적용/권한/저널 | shared effect schemas, execution, frontend/patch-store.ts, control | 다중 repo read/write, CAS, 사용자 변경 보존, 부분 실패·취소·재전송 검증 |
| P6 기능과 화면 검증 | frontend/validation.ts, preview runner, fixtures | build·type·interaction·a11y·visual 결과가 동일 source/디자인 hash에 연결 |
| P7 네 경우 통합 | CLI, service operations, end-to-end fixtures | 아래 케이스별 인수 기준, 독립 패키지 실행·문서·provenance·전체 검증 |

P3의 scaffold와 P4의 실제 화면 생성은 별도다. 템플릿만 만든 상태를 Figma 구현 완료로 표시하지 않는다. P5의 쓰기·프로세스 경계가 완성되기 전에는 운영 target에 적용하지 않는다.

## 12. 인수 테스트 행렬

| 테스트 | 필수 증거 |
|---|---|
| C1 신규, 경로와 reference 생략 | 저장소를 다시 요구하지 않고 안전한 새 output·C4 분기·route 화면·실행 결과 생성 |
| C1 신규, reference 제공 | C3 분기 이유, 기존 파일 변경 없음, 지정된 디자인 유지 |
| C2 dirty legacy/monorepo | 기존 component/token/API 재사용, 올바른 frontend package, 사용자 변경 보존, baseline 대비 회귀 |
| C3 reference 기반 신규 | target 독립 install/build, reference 쓰기 0, reference 폴더가 없어도 실행, frontend 외 파일/비밀 값/도메인 미이전 |
| C4 무참조 신규 | 기본 stack 선택 이유, 디자인 기반 tokens/components/routes/state, 불필요한 backend 없음 |
| 네 경우 공통 | Figma 계정 Dev Mode 불필요, 실제 관측/가정 분리, source/asset/hash, 취소·실패·재개·동시 변경, 최소 desktop/mobile 상호작용 검증 |
| 경계 실패 | target/reference 동일·중첩·symlink, stale base hash, missing asset/font, partial capture, 미지원 stack, agent 부재, install 실패, 프로세스 timeout |

대표 eCommerce는 공유된 파일의 Home/Shop/Single Product/Cart/Checkout 등 실제 확인된 scope를 사용한다. 네 경우 모두 같은 Figma 관측으로 서로 다른 target 조건의 결과를 비교한다. fixture 테스트와 실제 Figma 연결 검증은 별도 결과로 남긴다.

최종 개발 검사는 기존 `verify:source`, 추가 frontend 인수 테스트, 독립 artifact 설치와 runtime 확인을 포함한다. 긴 전체 검증은 기능·관련 테스트를 먼저 끝내고 한 번에 수행하며 코드가 바뀐 경우 해당 근거를 갱신한다.

## 13. 독립 리뷰 요청 사항

1. 제품/요구 리뷰: 네 경우의 의미, 신규 경로 기본값, frontend-only, 관측/가정/완료 기준의 누락.
2. 아키텍처/실행 리뷰: 현재 single-workspace/target/operation 계약과 실제 생성 실행자의 공백, 복수 root·원자적 적용·프로세스 경계.
3. 검증/개발 현실성 리뷰: adapter 지원 범위, reference 이전, 브라우저 제한, UX 검증, 단계 의존성과 실패/복구 테스트.

각 리뷰는 독립 문서에 P0/P1/P2 의견, 근거 코드 경로, 수정 제안과 확인 조건을 남긴다. 메인 에이전트가 의견을 채택·수정·기각하고 이유와 구현 단계에 반영한 뒤 v1.0을 확정한다. 이 계획 작성만으로 네 가지 기능이 이미 구현되었다고 보고하지 않는다.
