# 프론트엔드 네 경우 계획: 검증·구현 현실성 독립 리뷰

작성일: 2026-09-07. 대상: `docs/plans/2026-09-07-frontend-four-cases-plan-ko.md` v0.1. 역할: 세 명 중 검증·구현 현실성 리뷰어.

판정: **수정 후 채택**. 네 사용자 경우와 세 실행 전략의 구분, frontend-only, reference 읽기 전용, 실제 파일 검증, Chrome attach-only 방향은 타당하다. 다만 지금 인수 표는 확인할 주제 목록에 가까우며, 어떤 조합이 어떤 증거로 통과해야 네 경우의 지원을 선언하는지 결정할 수 없다. 아래 P0는 지원 완료 선언을 막는 기준 누락, P1은 구현·검증 전에 구체화할 필수 보완, P2는 추적성과 유지보수 보완이다. 현재 제품의 장애 심각도를 뜻하지 않는다.

생산 코드·초안·기존 staging을 변경하지 않았다. 실브라우저/앱 조작, 설치, 빌드, 테스트 실행도 하지 않았다. 소스와 기존 검증 기록을 읽은 독립 계획 리뷰이며 기존 검증 성공을 재현했다고 주장하지 않는다. Superpowers나 추가 서브에이전트를 사용하지 않았다.

## V01 — P0: 네 경우의 성공 집계 규칙과 지원 단위가 없다

**대상:** 계획 §7, §11–12.

현재 표는 C1 두 분기와 C2/C3/C4의 확인 항목을 정하지만, adapter별 인수 범위와 `skipped`/`blocked`가 있는 run의 최종 판정은 정하지 않는다. 예를 들어 React/Vite C4만 성공하고 Nuxt C2·실제 Figma 비교가 미수행인 상태에서 어디까지 지원이라고 표시할지 모호하다. C1을 C4 테스트의 별명으로 구현하면 경로 생략과 reference 명시 흐름의 회귀도 놓칠 수 있다.

**근거:** `service/scripts/run-source-checks.mjs:35`는 서비스 소스·패키지·격리 MCP runtime을 검증한다. 같은 파일 `:77`–`:78`은 `realFigmaValidated:false`, `targetServiceValidated:false`를 명시한다. `service/packages/cli/test/project-inspector.test.ts:15`는 프로젝트 분석과 매핑 테스트이며 생성된 애플리케이션의 인수가 아니다. 계획도 이 차이는 인지하지만 지원 판정에 연결하지 않았다.

**수정 제안:** `SupportMatrix`와 `AcceptanceResult`를 별도 산출물로 정한다. 행의 최소 키는 `requestedCase + resolvedStrategy + adapter/presetVersion + routerMode + targetKind + designScopeHash`이다. 각 필수 검사는 `required`, `passed/failed/blocked/skipped/not-applicable`, 이유와 증거를 가진다. 필수 검사 중 실패·차단·생략이 있으면 전체 완료가 되지 않는다. `not-applicable`은 계획 단계에서 조건과 이유를 정한다. Chromium 미검증 등 선택 검사 누락은 제한으로 노출한다.

**완료 기준:**

- 기본 지원 범위에서 C1(reference 없음), C1(reference 명시), C2, C3, C4를 각각 제품 진입점으로 끝까지 실행한다. C1 두 분기는 distinct test ID를 갖고 `requestedCase=C1`을 보존한다.
- 지원으로 표시한 모든 adapter에는 최소 C2 통합과 C3 독립 생성 증거가 있다. C4는 기본 preset과 명시적으로 제공하는 추가 preset별로 검증한다. 지원하지 않는 조합은 분석 전용/미지원으로 표시한다.
- `verify:source` 성공, scaffold build 성공, 에이전트 응답 수신만으로 `frontend completed`를 만들 수 없다는 부정 테스트가 통과한다.
- 실제 공유 Figma에서 승인된 범위를 캡처하고 네 경우의 runtime과 비교한 별도 보고서를 남긴다. fixture만 통과하면 fixture 지원 결과라고 표시한다.

## V02 — P1: framework 감지 근거를 작성 adapter의 실증으로 확대하면 안 된다

**대상:** 계획 §3, §6–7, P2/P3/P7.

**근거:** `service/packages/mcp/src/profile/profile.ts:537`는 root의 `package.json`과 config 존재를 읽는다. `:581`은 선언된 dependency range를 반환하고 `:614`는 dependency 이름으로 Next/Nuxt/React/Vue 등을 감지한다. `ProjectProfile`(`:69`)은 정확한 설치 버전·bundler·라우터 모드·SSR/client 경계 capability를 표현하지 않는다. `service/packages/mcp/src/profile/conventions.ts:59`는 최대 512개 파일, 파일당 262,144바이트, 총 8MB와 category당 32개 근거를 사용한다. 경로와 import/call 신호는 실제 API 계약이나 alias 해석 결과가 아니다. `service/packages/mcp/src/scan/scan.ts:91`은 imported prop type을 파일 간 추적하지 않으며, `:893`–`:919`는 walk의 truncated 정보를 반환 배열에 싣지 않는다.

**수정 제안:** React/Vite, Next, Vue/Vite, Nuxt를 네 개의 넓은 이름으로만 약속하지 말고 검증한 버전·Node/package manager·라우터·스타일링·렌더 모드별 capability를 정한다. `detected`, `profile-complete`, `can-scaffold`, `can-transfer`, `can-patch`, `can-build`, `can-preview`를 분리한다. 설치가 없으면 선언 버전·lockfile 해석 버전·실제 설치 버전을 구분한다. 분석 누락을 컴포넌트/API 부재로 해석하지 않도록 누락·confidence를 blueprint까지 전파한다.

**완료 기준:** Next app/pages router, Vue SFC/auto-import, Nuxt 모듈/auto-import/SSR 등 **지원으로 선언한** 구성을 실제 fixture에 명시한다. imported props, tsconfig extends/paths, bundler alias, workspace package, conditional export, 동적 config, 분석 cap 초과에 대해 올바른 재사용 또는 명시적 미지원 판정이 나온다. 분석 전용 fixture와 install/build/runtime까지 통과한 fixture를 다른 결과로 기록한다. 미지원 레거시를 새 Vite로 바꾸는 fallback은 발생하지 않는다.

## V03 — P1: Figma 비교 원본과 비원자 캡처 일관성의 완료 조건이 빠졌다

**대상:** 계획 §5, §9, P1/P6.

`source/design/asset hash`만 기록해도 서로 다른 시점의 node 값과 이미지를 함께 묶을 수 있다. 또한 편집기 화면 캡처와 Figma node의 디자인 이미지는 비교 대상이 다르다.

**근거:** `service/packages/ir/src/inspection-v1.ts:28`은 `atomic:false`를 고정한다. `service/packages/cli/src/commands.ts:248`의 `viewport.png`는 Figma 편집기 화면이며 `:259` 이후의 node 값 수집과 순차적이다. `service/packages/cli/src/capture-assets.ts:32`는 root node PNG를 먼저 수집하고 `:60` 부근에서 64개/64MB와 deadline에 따라 자산을 `pending`으로 남긴다. `service/packages/cli/src/asset-program.ts:27`에는 scale 1의 node PNG export 경로가 있다. `service/packages/ir/src/fidelity.ts:33`은 누락/unsupported가 있는 캡처의 completeness를 금지한다.

**수정 제안:** 시각 기준은 같은 file/node/scope의 export PNG로 정하고 node 크기, crop, export scale, pixel 크기, asset hash, 수집 구간을 저장한다. 편집기 `viewport.png`는 접속 증거로 분류한다. 값·PNG·asset 캡처 도중 디자인이 바뀌었는지 전후 재확인하고 불일치하면 해당 scope를 재수집한다. 원자적 측정이라고 표현하지 않는다. 필수 이미지/폰트/section 누락이 있는 scope는 시각 일치 완료 대상에서 제외하거나 차단한다.

**완료 기준:** 동일 node의 Figma PNG, runtime PNG, diff, 측정 결과가 하나의 검증 케이스에 연결된다. 폰트 로딩 완료, 이미지 decode, viewport/DPR, 애니메이션·시계·locale·fixture 상태를 고정한다. 편집기 screenshot만 있거나 필수 asset이 pending인 경우 비교 성공을 거부한다. 캡처 중 디자인 수정, asset hash 불일치, stale cache의 부정 fixture를 포함한다. desktop/mobile에서 실제 원본이 없는 해상도는 반응형 동작 검증으로 표시한다.

## V04 — P1: Firefox/WebKit preview의 사전 실증과 기존 Chrome 보호 검사가 필요하다

**대상:** 계획 §1, §8–9, P3–P6.

별도 headless Firefox/WebKit은 Figma Chrome attach-only 요구를 만족시키는 제안이다. 하지만 현재 설치/검증 경로가 이 엔진을 준비하고 제어한다는 근거는 없다. P6까지 미루면 이미 생성한 결과를 render할 수 없는 상황을 늦게 발견한다.

**근거:** `service/packages/cli/src/browser-session.ts:13`–`:23`은 기존 Chrome CDP attach만 제공한다. `service/packages/cli/package.json:33`에 Playwright가 있어도 browser binary 설치 성공을 의미하지 않는다. `service/scripts/run-source-checks.mjs:57`은 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`을 설정한다. `docs/reviews/2026-09-05-browser-validation.json:15`–`:19`는 기존 Chrome 검증과 Desktop live 차단 기록이지 Firefox/WebKit preview 검증이 아니다. `service/skills/figma-codegen/references/verify.md`의 기존 예시는 새 Chrome headless와 CDP를 사용하므로 새 흐름에 그대로 연결하면 요구와 충돌한다.

**수정 제안:** 기본 preview 엔진을 headless Firefox로 정하고 설치도 `playwright install firefox`처럼 대상 엔진을 명시한다. WebKit은 해당 OS/Playwright/browser 버전의 사전 실증을 통과한 경우 선택 coverage로 둔다. 인자 없는 전체 browser 설치를 기본값으로 두지 않는다. 초기에 사용할 엔진의 설치·launch·로컬 route 렌더·종료 smoke를 계획한다. Figma 수집 세션과 preview 세션은 별도 ownership을 사용한다. preview 안내/자동화에서 기존 Chrome 생성·탭 생성·탭 navigation 경로를 제거한다. 이전 문서의 Chrome 예시에는 이 작업의 attach-only 제약에 맞는 경로를 연결한다. 필요한 binary가 없으면 preview만 blocked로 만들고 planning은 계속하되 필수 기능·접근성·시각 검증이 blocked인 run은 구현 완료로 표시하지 않는다.

**완료 기준:** 기본 Firefox에서 build된 로컬 화면 한 개의 screenshot 및 종료 실증을 남긴다. WebKit은 선택한 경우 동일 실증과 실제 인수 결과를 추가한다. Figma 세션 spy 테스트는 `launch/newPage/newContext/goto` 호출을 거부하고, live 검증은 Figma tab ID/URL 및 Chrome 프로세스·탭 집합의 전후 동일성을 기록한다. timeout/cancel 후 run 소유 preview/서버 자식만 종료되고 기존 Chrome이 살아 있다. Chrome/Chromium 미검증은 해당 엔진 coverage의 제한이며 Firefox의 필수 인수 성공을 대신하거나 무효화하는 항목으로 혼동하지 않는다. 반대로 Firefox의 필수 기능·접근성 검사 차단은 optional 엔진 미검증처럼 취급하지 않는다.

## V05 — P1: 독립 설치는 원본 reference가 안 보이는 새 환경에서 검증해야 한다

**대상:** 계획 §6–8, C3/C4 인수 기준.

reference 폴더가 없어도 기존 `node_modules`와 빌드 산출물만으로 실행될 수 있으므로 “폴더가 없어도 실행”만으로 재설치 독립성을 보장하지 않는다. 기본 output이 pipeline workspace 아래에 생기므로 부모 lockfile/workspace/상위 `node_modules`를 우연히 소비할 가능성도 검사해야 한다.

**근거:** 현재 `service/packages/cli/src/project-inspector.ts:99` 이후는 분석·매핑을 반환하며 dependency closure를 복제하지 않는다. `service/packages/mcp/src/profile/profile.ts:581`의 선언 dependency 읽기는 필요한 transitive source나 lockfile importer 검증이 아니다. 기존 `service/scripts/run-source-checks.mjs:43`의 isolated-runtime 검사는 MCP 패키지용이다.

**수정 제안:** 신규 결과만 외부 임시 root에 복제하고 reference·pipeline 부모 workspace·기존 node_modules·dist가 없는 환경에서 lockfile 고정 install → build → production preview → 직접 route 접근/상호작용을 수행한다. `workspace:`, `file:`, `link:`, 절대 경로, tsconfig extends, public asset URL, import.meta/glob/dynamic import, 환경 변수 의존을 검증한다. reference 삭제 실증은 fixture 복사본으로 하고 사용자 원본을 이동/삭제하지 않는다.

**완료 기준:** C3 단일/복수 reference와 C4에 대해 위 격리 설치 로그가 있다. frontend에 필요한 shared closure는 복사·대체·거절 중 하나로 설명되고 신규 앱이 reference 경로에 접근하지 않는다. sentinel backend 파일·원본 도메인·비밀 값을 넣은 fixture에서 출력 source, 환경 파일, dependency script, build bundle에 이전되지 않는다. reference 내용·경로 목록의 전후 manifest가 동일하다.

## V06 — P1: C2 dirty baseline과 frontend 경계는 파일명 검사보다 넓다

**대상:** 계획 §8–9, P5/P6, C2 인수 기준.

“기존 실패와 신규 실패를 구분”하려면 변경 전 어떤 파일 상태를 실행했는지와 어떤 실패가 동등한지 먼저 정의해야 한다. HEAD만 staging하면 사용자의 staged/unstaged/untracked frontend 변경을 빼고 검증하게 된다. Next/Nuxt에서 API 서버 파일을 생성하지 않아도 기존 UI에 `use server`, 서버 credential import, 운영 API mutation이 들어갈 수 있다.

**근거:** `service/packages/mcp/src/fs/repo-walk.ts:37`과 `:473`은 bounded read 결과이지 Git index/working tree 보존이나 baseline 실행기가 아니다. `service/packages/mcp/src/profile/conventions.ts:101`은 Next `route.*`를 route-file 신호로 인식하므로 라우팅 관측만으로 frontend 허용 여부를 판단할 수 없다. 현재 `service/packages/shared/src/operations.ts:26` 이후의 효과 계약에는 새 frontend 실행/검증 흐름을 추가해야 한다.

**수정 제안:** baseline은 사용자가 실제 편집한 filesystem 상태의 검증용 snapshot으로 정의하고 index 상태도 별도 보존 증거로 둔다. 동일 toolchain/환경/fixture/명령에서 baseline과 candidate를 실행한다. 알려진 실패의 test ID·원인·로그 signature와 적용 범위를 고정하고 새 실패를 이름만 같다는 이유로 허용하지 않는다. 선택 package 밖 backend/shared 파일은 기본 보존하되, 필요한 공용 frontend 의존/lockfile 변경만 계획에 포함한다. frontend-only 정책에는 server directive/import와 API mutation 관측도 포함한다.

**완료 기준:** 깨끗한 C2와 dirty monorepo C2를 각각 검증한다. staged+unstaged가 같은 파일에 공존하고 untracked component가 사용되는 fixture에서도 baseline이 실제 상태와 일치하며 index와 비대상 파일이 보존된다. baseline 실패, 새 실패, 기존 실패 악화, baseline 자체 실행 불가를 서로 다른 결과로 남긴다. API 어댑터는 contract fixture의 loading/error/empty/success, method/path/payload를 보존한다. 운영 통신은 test endpoint 또는 mock으로 대체하며 의도하지 않은 mutation이 발생하면 실패한다. Next/Nuxt는 허용한 SSR/client 경계에서 hydration/runtime까지 확인한다.

## V07 — P1: 실제 실행자와 프로세스 경계를 P3/P4 앞의 실증으로 분리해야 한다

**대상:** 계획 §7–8, §11의 P3–P6 순서.

P3의 독립 build와 P4의 repair loop는 설치·빌드·preview 프로세스를 필요로 하지만 그 경계는 P5, validation port는 P6에 있다. “운영 target에 적용하지 않음”만으로 staging에서 실행하는 package script가 안전한 검증 환경인지 결정되지 않는다. 연결된 코딩 에이전트가 candidate artifact를 반환하는 실제 transport도 아직 정해지지 않았다.

**근거:** `service/packages/cli/src/project-inspector.ts`의 끝은 `guidance` 반환이다. `service/packages/mcp/src`/`service/packages/cli/src`의 파일 목록에는 frontend runner/scaffold/validation 구현이 없다. 기존 `service/packages/mcp/src/execution/operation-executor.ts:882`의 취소는 operation 취소 근거이며 새 build process tree를 종료하는 실증이 아니다.

**수정 제안:** 초기에 하나의 수직 실증을 추가한다: 저장된 디자인 artifact → 실제 agent 연결/lease → 작은 typed candidate → disposable staging patch → 허용된 build/preview → hash-bound report. 그 전에 실행 profile, lifecycle script 정책, env 주입, cwd, network, 제한 시간, 자식 프로세스 ownership, 로그 한도를 정한다. 실증은 운영 target 없이 수행하고 이후 본 adapter와 P5 transaction을 확장한다.

**완료 기준:** mock agent 계약 테스트와 별도로 실제 연결 실행자 한 개가 실제 파일을 만들어 성공/실패 보고서를 반환한다. disconnect, 늦은 응답, duplicate 응답, 잘못된 candidate hash, repair 3회 소진을 주입한다. 기존 operation ID와 run ID가 연결되고 끊긴 에이전트의 응답은 새 run을 덮지 않는다. install script가 허용 root 밖 파일을 쓰거나 무관한 endpoint에 접근하려는 fixture에서 선언한 실행 경계가 실제로 강제된다. 검증용 staging이라는 이유만으로 script를 제한 없이 실행하지 않는다.

## V08 — P1: 취소·충돌·복구는 단계별 실패 주입표가 필요하다

**대상:** 계획 §8, P5/P7, §12 공통/경계 실패.

취소·실패·재개라는 한 행은 publish 직전과 다중 파일 적용 도중을 같은 것으로 취급한다. install/build가 만든 lockfile·cache·생성 파일과 patch가 만든 파일의 소유권도 구분해야 한다.

**근거:** `service/packages/mcp/src/execution/operation-executor.ts`에는 기존 operation journal/cancel/outcome-unknown 경로가 있으나 프론트엔드 multi-file transaction·preview 자식 process·publish의 복구 구현은 계획상의 추가 작업이다. `service/packages/cli/src/capture-assets.ts`도 capture budget/abort를 개별 단계에서 처리하므로 run 전체의 재개 규칙이 추가로 필요하다.

**수정 제안:** 최소 `planning`, `waiting-agent`, `install`, `build/preview`, `apply 전`, `N개 중 k개 적용 후`, `publish 직후 journal 확정 전`, `resume 중`에 timeout/cancel/crash를 주입한다. 각 행에 final status, 남아야 할 파일, 복구 대상, 소유 process, resume 출발점, 중복 side effect 허용 여부를 쓴다. apply 후 재검증에서 실제 파일 hash가 바뀌면 이전 검증을 무효화한다.

**완료 기준:** 중복 resume/retry가 파일을 두 번 생성·덮어쓰지 않는다. 부분 적용 후 사용자 동시 편집은 CAS 복구가 건드리지 않고 정확한 conflict 경로와 복구 안내를 남긴다. 취소 후 해당 run의 process/port가 남지 않고, 기존 사용자 서버/Chrome은 유지된다. 새 target 이름 선점, Windows 파일 lock/접근 거부, staging 검증 뒤 source 교체, publish 뒤 crash를 모두 구분해 수습하며 `outcome-unknown`을 성공으로 치환하지 않는다.

## V09 — P1: 화면·상호작용 목록을 관측 가능한 assert로 구체화해야 한다

**대상:** 계획 §9, §12.

UI 기능 이름만으로는 agent가 버튼을 그렸는지 실제 동작을 구현했는지 판정할 수 없다. eCommerce의 여러 페이지와 상호작용 중 무엇이 실측이고 무엇이 demo 가정인지도 케이스별 scope manifest에서 고정해야 한다.

**근거:** `service/packages/ir/src/inspection-v1.ts`는 관측 자료와 fidelity를 보관하지만 실행 가능한 UX 기대값은 없다. `service/skills/figma-codegen/references/verify.md`는 프로젝트 toolchain 렌더와 비교를 요구하는 기존 문서이지만 자동 runner/assert를 제공하지 않는다.

**수정 제안:** 모든 선택 node/route에 기본 state screenshot, 직접 URL/reload, 주요 상호작용의 `given/action/expected`, 키보드·focus, a11y 검사를 매핑한다. 실제 관측된 cart/quantity/filter 등이 scope에 있으면 숫자·목록·URL·drawer 상태의 변화까지 assertion으로 정한다. Checkout은 demo의 허용된 종료 지점과 실제 제출 없음이 함께 확인되어야 한다. visual 허용 오차뿐 아니라 필수 component 누락과 critical a11y 위반의 별도 실패 규칙을 정한다.

**완료 기준:** desktop/mobile에서 각 필수 route가 직접 열리고 새로고침된다. 버튼의 텍스트 존재만으로 통과하지 않는 상호작용 테스트, modal focus 이동/복귀, 키보드 순서, 가로 overflow 검사, console/page error와 필수 asset 요청 실패 검사를 수행한다. 실제 비교 보고서는 side-by-side/diff/차이 판정 및 미관측 가정을 보여 준다. 선정하지 않은 화면이 전체 완료 범위에 포함되어 보이지 않는다.

## V10 — P2: 경로 기준과 검증 명령·증거의 위치를 고정해야 한다

**대상:** 계획 §3, §5, §11–12.

계획의 현재 근거·예정 파일에는 `service/packages/...`와 `packages/...`가 섞여 있다. cwd가 repository root인 구현자에게 새 코드 위치와 검증 실행 위치를 오해하게 한다.

**근거:** 실제 `project-inspector.ts`, `profile.ts`, IR 파일은 모두 `service/packages/` 아래다. `verify:source`도 repository root가 아닌 `service/package.json:25`에 정의되어 있다.

**수정 제안 및 완료 기준:** 문서 맨 앞에 코드 경로 기준을 `service/`로 선언하거나 모든 경로를 repository 상대 경로로 통일한다. fixture/unit, generated app acceptance, live Figma capture, browser preview, 전체 service source 검증을 각각 실행 cwd·명령·출력 artifact·owner로 명시한다. 기존 staged source와 증거는 보존하고, 새로운 최종 보고서는 각 실행의 source hash와 결과가 검증하는 대상을 정확히 표시한다. 이 문서 리뷰만으로 긴 `verify:source`를 실행할 필요는 없다.

## 권장 인수 행렬의 최소 구체형

| ID   | 조건                                                                                                  | 판정 가능한 필수 결과                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| C1-A | 신규 의도, target/reference/stack 생략, 저장된 공유 디자인                                            | 추가 저장소 질문 없이 안전한 새 경로, C1→blank-new 기록, C4 기본 preset 생성·독립 install/build/runtime·동일 디자인 시각/UX 검증 |
| C1-B | 신규 의도, 명시적 reference                                                                           | C1→reference-new 기록, C3와 같은 독립성 검증, 사용한 디자인 binding·reference 채택 근거 유지                                     |
| C2-A | 지원 adapter의 깨끗한 frontend package                                                                | 기존 component/token/API 통합, baseline→candidate 비교, 허용 frontend 변경만 적용, 적용된 hash로 재검증                          |
| C2-B | dirty monorepo, 다중 후보, staged/unstaged/untracked 포함                                             | 필요한 package 선택만 요청, 실제 편집 상태 baseline, index/다른 package·backend 보존, 회귀·충돌·복구 결과                        |
| C3-A | 단일 reference, shared frontend closure 포함                                                          | reference manifest 불변, 외부 임시 root의 clean install/build/runtime, 원본 경로/환경/도메인 독립                                |
| C3-B | 복수 reference와 충돌 dependency/관례                                                                 | 주·보조 역할 및 채택/거절 근거, 호환된 결과 또는 명시적 미지원, C3-A와 같은 독립 검증                                            |
| C4-A | 명시적 무참조, 주변에 사용 가능한 다른 repo 존재                                                      | 주변 repo 미사용, 검증된 기본 preset, Figma 기반 구조·상태, frontend-only, 독립 설치·시각/UX 검증                                |
| NEG  | C3 reference 없음, 동일/중첩/alias root, unsupported, partial capture, missing font/asset, agent 부재 | 정해진 오류/부분 상태, 조용한 분기 변경·성공 표시·의도 밖 쓰기 없음                                                              |
| REC  | 각 실행 단계의 취소/timeout/crash·동시 수정                                                           | V08의 단계별 잔존 파일/프로세스·status·재개 assertion 충족                                                                       |

같은 고정 디자인 scope를 핵심 행에 적용해 target 조건 차이를 비교한다. adapter 확대는 선언한 조합마다 이 행렬의 적용 항목을 채우는 방식으로 진행한다. 결과를 확인하기 어려운 전 조합의 무차별 곱집합보다 필수 기본 행과 adapter 고유 fixture를 분리하는 편이 현실적이다. 네 경우 지원 완료는 V01 집계 규칙과 해당 지원 조합의 필수 결과가 모두 충족된 시점에만 선언한다.

## v0.9 재확인

2026-09-07, 변경된 계획을 다시 읽어 최종 정합성을 확인했다. 계획·생산 코드를 수정하거나 실행 검증을 수행하지 않았다.

V01–V10의 계획상 보완이 반영되었다. 지원 tuple과 필수 검사 집계, C1 두 분기 및 clean/dirty C2·단일/복수 C3·C4·부정/실패 단계 행렬이 연결된다. React/Vite·Vue/Vite를 v1 필수 범위로, Next/Nuxt를 고유 실증 후 승격하는 후속 범위로 구분했다. node PNG 원본·비원자 캡처 재확인, Firefox 필수/WebKit 선택 검증, 격리 clean install, dirty baseline, 실제 agent·runner 선행 실증, 적용 후 hash 재검증, 실패 주입과 실행 cwd도 구체화되었다. 이는 **계획의 보완 확인**이며 기능 구현·테스트 통과 판정은 아니다.

최종 편집에 남은 필수 정합성 수정은 §8.3의 `Docker/Podman 등 ... P1 실증에서 고정`을 메인이 결정한 **Docker CLI의 Linux container를 v1 provider로 사용**한다는 계약으로 바꾸는 것이다. 지원 host OS와 실제 검증 runtime OS/image digest·Firefox 버전은 구분해 기록하고, 상세 OS 지원은 P1의 실제 실증을 통과한 조합만 표시하면 된다. provider 부재 시 실행 검증을 차단하는 현재 규칙은 유지한다. 이 예정 수정이 반영되면 본 리뷰 범위에 추가 필수 계획 수정은 없다.
