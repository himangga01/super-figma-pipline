# Desktop / 기존 Chrome 자동화

## 확정한 동작

사용자가 이미 열고 로그인한 Chrome의 Figma 탭에 외부 오픈소스 Playwright 1.63.0으로 연결한다. GPT 내장 브라우저 제어 도구와 공식 Figma MCP는 이 경로에 사용하지 않는다. 런타임 코드는 Chrome 실행, 프로필 생성·복사, 새 탭 생성, 기존 탭의 URL 변경을 하지 않는다. 대상이 없거나 여러 개이면 명확한 오류로 종료한다.

Chrome의 원격 디버깅 허용은 사용자가 켠다. Chrome 144 이상은 실행 중인 기본 브라우저에 이 방식으로 연결할 수 있다. 이전의 별도 프로필 접근은 사용자 지시에 따라 런타임에서 제거했다. [Chrome 공식 설명](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session), [Playwright CDP 연결](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)

## 연구 결과와 구현 선택

Figma 웹 화면은 캔버스 중심이므로 DOM/CSS만으로 디자인 노드의 실제 값을 복원할 수 없다. UI 관찰은 스크린샷과 레이어 이름을 제공하고, 정밀 값은 Plugin API로 읽는다. [Figma 실행 환경](https://developers.figma.com/docs/plugins/how-plugins-run/)

제공된 figmosha2의 `2035300` 이전 버전에는 Playwright로 Scripter를 실행하는 접근이 있었다. 원본은 수정하지 않았고 그 접근과 공개 인터페이스를 참고했다. 현재 구현은 최근 항목/Community 검색 두 UI를 처리하고 플러그인 ID `757836922707087381` 및 `scripter.rsms.me` 프레임을 검증한다. Scripter의 공개 `eval`/`eval-response` 메시지 계약을 통해 서비스가 생성한 고정 읽기 프로그램만 실행한다. 외부에서 JavaScript 본문을 입력하는 CLI 명령은 없다. [Scripter MIT 저장소](https://github.com/rsms/scripter), [메시지 계약](https://github.com/rsms/scripter/blob/master/src/common/messages.ts)

읽기 프로그램은 Figma 문서에 노드를 만들거나 수정하지 않는다. 노드 ID·깊이·개수는 스키마로 검증하고, 결과를 최상위 노드별로 나눠 수집한다. 구역별 최대 2,000개, 최대 깊이 40, 전체 결과 한도와 미처리 구역 표시가 있다. 스크린샷의 픽셀을 측정한 값을 API 값으로 표시하지 않는다.

Chrome 수집은 로컬 CLI의 읽기 경로이며 기존 MCP 쓰기 실행·승인·저널 경로와는 별개다. 이 경로를 통해 Figma 쓰기나 임의 JavaScript 실행 기능을 공개하지 않는다. Scripter 자체의 기능 전체를 우리 서비스의 지원 기능으로 광고하지 않는다.

## 실행 방법

`service/`에서 사전 설치와 빌드:

```powershell
corepack pnpm install --frozen-lockfile
corepack enable --install-directory node_modules/.bin pnpm
corepack pnpm -r build
```

기존 Chrome의 유일한 Figma 탭을 자동 탐색하여 정밀 검사:

```powershell
.\inspect-chrome.cmd
```

대상 명시 / UI만 관찰 / 연결된 탭 확인:

```powershell
node packages/cli/dist/index.mjs chrome-inspect --url "https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1"
node packages/cli/dist/index.mjs chrome-inspect --ui-only
node packages/cli/dist/index.mjs chrome-tabs
```

Chrome 자체의 연결 대화상자가 나타나면 사용자가 허용해야 한다. 종료 시 CDP 연결만 끊고 기존 Chrome과 탭은 닫지 않는다. 디자인 값은 로컬 파일로 저장하며 로그인 입력이나 쿠키 추출을 수행하지 않는다.

Desktop 연결 준비:

```powershell
.\connect-desktop.ps1 -FigmaUrl "https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1" -AllowModelData
```

이 명령은 기존 로컬 서버를 재사용하거나 시작하고, 인증된 control API로 설정 및 일회용 코드를 발급한다. 코드가 삽입된 사용자 전용 개발 플러그인을 준비한다. 플러그인은 시작 후 코드를 즉시 소비·제거하고 자동 페어링한다. 파일을 읽을 때는 같은 세션을 고정해 metadata, selection, document, styles, variables를 수집한다. 선택이 비어도 페이지 읽기를 수행한다. `-Workspace`를 지정하면 등록된 저장소의 profile/컴포넌트 분석도 수행한다.

최초 개발 플러그인 등록과 실행은 필요하다. 이번 실제 Desktop 등록은 Computer Use의 `native pipe is unavailable` 오류가 재시도와 커널 재초기화 후에도 발생하여 완료하지 못했다. 자동 페어링 코드와 입력 제거는 테스트했지만 실제 Desktop 연결 성공으로 기록하지 않는다.

## 실제 Chrome 검증

- 사용자가 원래 열어 둔 Chrome 152의 지정 파일에 연결했다. 새 브라우저·새 탭은 사용하지 않았다.
- 파일: `4IBhv1d8hEclifZQrOYxHS`, 페이지: `Visual Design🖌`.
- 최상위 11개 항목, 총 3,198개 노드를 수집했다. 구역 분할 수집 결과 `truncated:false`, 미처리 구역 없음.
- Home `1440×4835`, Shop `1440×3474`, Cart `1440×1796`, Checkout `1440×3070` 등 실제 API 값을 확인했다.
- 플러그인을 닫은 상태에서 서비스의 자동 실행 경로로 다시 Scripter를 열고 Home 읽기에 성공했다.
- 파일은 `validation/existing-chrome/all-sections.json`, `overview.json`, `existing-tab.png`, `validation.json`에 저장했다. 원본 디자인 데이터와 이미지는 Git에 넣지 않는다.

이 결과는 지정 페이지와 수집기가 지원하는 속성의 읽기 검증이다. 다른 페이지, 관측되지 않은 비즈니스 로직, 서버 API, 모든 Figma 특성의 완전 복원이나 대상 서비스의 UI 구현 완료를 의미하지 않는다. 실제 동작 구현은 이 디자인 근거와 대상 코드 저장소 분석을 함께 사용하고 화면·동작 테스트로 검증해야 한다.

## 자동화 테스트

기존 Chrome 연결에서 새 창·탭·URL 변경이 발생하지 않는지, 대상 없음/중복과 원격 CDP 거부, 읽기 프로그램의 값 보존·예산·쓰기 차단, 일회용 bootstrap 제거·자동 제출, Desktop 전체 페이지 읽기 및 코드 분석 호출을 테스트한다. 이번 변경은 기존 112개 MCP 도구 레지스트리를 바꾸지 않는다.

최종 확인: 관련 테스트 11개 파일의 **118개 테스트 통과**, 전체 패키지 타입 검사·빌드, 린트·포맷·knip, offline 출처 검사·runtime specifier 검사·staging 명세 검증 통과. 이번 기능 변경 후 저장소 전체 `verify`/모든 E2E를 다시 실행하지는 않았다. 실제 Chrome 검증 결과와 실제 Desktop 등록 미완료를 구분한다.
