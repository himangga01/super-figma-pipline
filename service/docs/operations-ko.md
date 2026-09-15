# 실행과 검증

## 로컬 설치

Node 24와 저장소에 고정된 pnpm을 사용합니다. `service`에서 `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`를 실행합니다. MCP는 `node packages/mcp/dist/index.mjs`, 상시 실행 서비스는 `node packages/mcp/dist/daemon-entry.mjs`입니다. daemon은 전경에서 실행하며 Ctrl+C로 종료합니다. 두 진입점은 같은 인증·큐·저널을 사용합니다.

배포용 파일은 `artifacts/mcp.tgz`, `cli.tgz`, `plugin.zip`입니다. 빈 폴더에서 `npm install /절대경로/mcp.tgz /절대경로/cli.tgz`로 두 Node 패키지를 함께 설치합니다. `npx sfp help`, `npx sfp-daemon`을 사용할 수 있습니다. 플러그인은 MCP 패키지에도 포함되어 Desktop 연결용 번들을 준비할 수 있습니다.

## 디자인 읽기

- 기존 Chrome: `node packages/cli/dist/index.mjs chrome-inspect --url <URL> --workspace <서비스경로>`.
- Desktop: `node packages/cli/dist/index.mjs connect --url <URL> --workspace <서비스경로> --allow-model-data`.
- Desktop 영구 식별: 위 명령에 `--persistent` 추가. 문서 메타데이터 쓰기 승인이 필요합니다. 기본 연결은 원본을 변경하지 않는 세션 한정 URL 확인입니다.
- Desktop 최초 실행: 출력된 개발 플러그인 manifest를 Figma에 한 번 등록하고 요청한 파일에서 실행합니다. 페어링 코드 입력은 자동 처리하며 이후 파일 URL 확인과 쓰기 승인은 플러그인 화면에서 처리합니다. Figma의 Dev Mode나 자체 MCP는 요구하지 않습니다.

Chrome은 기존 프로세스와 기존 탭에만 연결합니다. `chrome://inspect/#remote-debugging` 설정과 Chrome이 표시하는 연결 허용은 브라우저에서 처리해야 합니다. Scripter가 없는 경우 해당 플러그인을 사용할 권한이 필요합니다. `--ui-only` 결과에는 측정값이 없습니다. `--wait`는 연결·수집의 전체 예산이며 개별 실행 중인 읽기는 최대 60초 이내에 종료됩니다. Ctrl+C는 다음 읽기를 시작하지 않고 연결을 정리합니다.

`inspection.json`은 공통 결과 목차이며 각 원본 파일의 크기·SHA-256·수집 상태를 기록합니다. Chrome은 `design.json`, `viewport.png`, `assets.json`, `assets/`를 만들고, workspace를 지정하면 `project.json`도 만듭니다. Desktop은 `desktop.json`을 만듭니다. Desktop의 section 완전성은 `snapshot capture`, 이미지 자산은 export 도구로 별도 확인합니다.

노드 깊이·페이지·필드·배열·자산 한도 때문에 일부 값이 생략되면 partial/미처리 목록을 확인합니다. 자산은 최대 64개·총 64MB·개별 5MB이며 원본 이미지, SVG, 최상위 프레임 PNG를 연결합니다. 여러 번 읽은 결과는 원자적 Figma 버전이라고 주장하지 않습니다.

## 운영 명령

`node packages/cli/dist/index.mjs` 뒤에 다음 명령을 붙입니다. 로컬 관리 명령은 실행 중인 서비스가 필요합니다.

| 명령                                                       | 용도                                          |
| ---------------------------------------------------------- | --------------------------------------------- |
| `status`                                                   | 서비스와 연결된 플러그인 확인                 |
| `tools list`                                               | 등록된 도구와 입력 스키마 확인                |
| `tools call <이름> --args-file <JSON파일>`                 | 임의 등록 도구 실행                           |
| `workspace list/add/remove/default`                        | 읽기·쓰기 허용 저장소 관리                    |
| `egress status/allow/reset/audit`                          | 모델 전달 범위 및 감사 기록                   |
| `network list/add/remove`                                  | 이미지 원격 도메인 허용 목록                  |
| `approval list/decide`                                     | 본인 승인 목록과 결정                         |
| `operations list/show/evidence/cancel/resolve`             | 작업 기록·증거·취소·불확실 결과 처리          |
| `pair`                                                     | 일회용 연결 코드 발급                         |
| `snapshot capture --args-file <파일> --workspace <경로>`   | 안정적 파일 식별로 section 스냅샷·그래프 저장 |
| `grounding refresh --args-file <파일> --workspace-id <ID>` | 저장된 코드 근거를 다시 확인해 stale 표시     |

`--yes`는 해당 CLI가 생성한 작업의 승인만 처리합니다. 다른 작업의 승인에는 적용하지 않습니다. `--session` 또는 `--target active/none`으로 대상을 지정합니다. 시간 초과와 취소 시 기록된 operation ID로 결과를 다시 확인합니다.

추가 도구: `export_tokens`는 모드·별칭을 유지하는 JSON 또는 선택 모드 CSS를 내보냅니다. FLOAT는 단위를 추정하지 않습니다. `export_frames_to_pdf`는 지정 순서로 프레임을 하나의 PDF로 만듭니다. `doctor`는 서비스·플러그인 왕복 상태를 확인합니다. `import_library_variable`은 계정에 공개된 팀 라이브러리 변수를 가져오며 노드 바인딩은 별도입니다.

## 릴리스 검증

`corepack pnpm verify` 후 `corepack pnpm verify:release`는 소스 검사부터 패키지 파일·체크섬 확인까지 실행합니다. `node scripts/smoke-packed-mcp.mjs`는 별도 임시 폴더에 패키지를 설치합니다. `node scripts/verify-graph-memory.mjs`는 1만 노드·2만 edge를 새 프로세스 3개에서 검사합니다. 동일한 입력 빌드로 아카이브를 반복 생성하면 파일 목록·타임스탬프·해시가 같습니다. 재빌드까지 비교하려면 `SOURCE_DATE_EPOCH`를 같은 값으로 지정합니다.

`corepack pnpm verify:source`는 전체 검사·출처·메모리·패키징·격리된 실제 MCP/daemon 실행을 순서대로 수행하고, 모든 단계가 통과하며 검사 전후 소스 해시가 같을 때만 `artifacts/source-checks-report.json`을 만듭니다. 보고서에는 실제 Figma·대상 서비스·원격 CI 미검증 상태도 명시합니다. 패키지 검증에는 Git, tar와 Linux/macOS의 unzip이 필요합니다.

CI는 Windows와 Ubuntu에 같은 검증을 구성했습니다. 원격 CI 실행 결과, 실제 Figma 계정 연결, 대상 서비스의 반응형·상호작용·화면 일치 결과는 각각 따로 기록합니다. 코드 검사 통과가 해당 실검증을 대신하지 않습니다.
