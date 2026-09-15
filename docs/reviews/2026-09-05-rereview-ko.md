# 2026-09-05 전체 코드 재리뷰와 남은 작업

## 판단

현재 서비스는 **Dev Mode와 Figma 공식 MCP 없이 디자인을 읽는 기반**을 갖췄다. 기존 Chrome 탭을 외부 Playwright로 찾아 Scripter/Plugin API로 읽는 경로와 Desktop 개발 플러그인 경로가 있다. 그러나 **디자인의 누락 없는 수집 → 대상 서비스 코드 관례 분석 → 동일한 화면·동작 구현 → 검증**을 하나의 완성된 흐름으로 제공하는 상태는 아니다.

이번 재리뷰에서 우선 수정할 결함 6개를 확인했다. 특히 수집 누락을 완료로 표시하는 문제, Desktop의 요청 파일 미검증, Git worktree 분석 실패, batch의 부분 변경 잔류가 중요하다. 이번 작업에서는 제품 코드를 수정하지 않았으며 리뷰·재현·검증 자료만 추가했다. 기존 staging 변경을 보존했다. Superpowers 스킬과 내장 브라우저 도구를 사용하지 않았고 Chrome을 실행하거나 탭을 만들지 않았다.

## 검토 범위와 기준

- 기준 커밋: `f1bba1a530012dd45d0265073c72c25bbb53987d`와 현재 staging 변경 전체.
- 검증한 service index tree: `d0aff7d0c2d322f6a94d13d688edea9a639ec879`.
- 제품 소스 **415개 파일 / 63,719행**, 테스트 영역 289개 파일(실제 테스트 파일 286개와 보조 파일 3개), 설정 12개, 실행·유지보수 스크립트 8개. 합계 **724개 코드 관련 파일**을 분류하고 SHA-256을 기록했다.
- 범위: shared 계약, MCP 등록·정책·인증·control·relay·실행·저널·파일/네트워크 경계, plugin UI·sandbox·직렬화·읽기/쓰기 핸들러, 저장소 분석·매핑·토큰·diff, CLI 두 연결 경로, IR, 빌드·출처·릴리스 진입점.
- 전체 목록과 정적 검사·테스트를 바탕으로, 수동 추적은 실제 사용자 흐름과 데이터·대상·변경·권한 경계를 중심으로 진행했다. `node_modules`, `dist`, 원본 참고 저장소 `code-kb`, 원본 디자인 캡처는 제품 소스 집계에서 제외했다.
- 이번 실제 Figma UI 검증은 추가 실행하지 않았다. 이전 Chrome 실검증 자료와 이번 코드·격리 재현 결과를 구분한다.

[파일별 범위·해시](2026-09-05-rereview-inventory.csv), [검증 기록](2026-09-05-rereview-validation.json), [재현 프로그램](2026-09-05-rereview-reproduce.mjs).

## 우선 수정할 결함

P1은 핵심 동작의 정확성 또는 쓰기 기능 공개 전에 해결할 문제다. 아래의 재현은 실제 제품 함수와 가짜 Figma 객체/임시 저장소를 사용하며 사용자 문서를 수정하지 않는다.

### R01 · P1 · Chrome 수집이 누락을 완료로 표시한다

근거: [scripter-reader.ts](../../service/packages/cli/src/scripter-reader.ts) 36, 68, 86, 129행.

`readScripterSnapshot`은 최종 `truncated`를 개별 section과 `pendingRootIds`에서만 계산한다. 루트 목록을 얻는 overview/container 단계에서 이미 잘린 루트는 목록과 최종 상태에서 사라진다. 변수 256개 제한과 객체 속성 128개 제한도 누락을 표시하지 않는다.

재현 결과:

| 입력                      | 실제 출력  | 현재 표시                              |
| ------------------------- | ---------- | -------------------------------------- |
| 루트 3개, `maxNodes:1`    | 루트 1개   | `truncated:false`, `pendingRootIds:[]` |
| 지역 변수 257개           | 변수 256개 | `truncated:false`                      |
| componentProperties 129개 | 속성 128개 | `truncated:false`                      |

수정 작업: 루트 열거를 본문 노드 예산과 분리하고, 값·변수·속성·깊이·바이트 한도별 누락 정보를 끝까지 전달한다. overview를 깊이 0으로 읽어서 생기는 정상적인 자식 생략과 실제 루트 손실도 구분해야 한다. 한 구역이 2,000개를 넘으면 하위 구역으로 이어 읽거나 명시적으로 미완료를 기록한다.

완료 기준: 제한을 의도적으로 초과한 모든 fixture에서 누락 위치와 재개 대상이 남고, 완전한 결과만 완료로 판정한다.

### R02 · P1 · Desktop이 요청한 Figma 파일·노드와 실제 읽기 대상을 대조하지 않는다

근거: [commands.ts](../../service/packages/cli/src/commands.ts) 79–112행, [desktop-reader.ts](../../service/packages/cli/src/desktop-reader.ts) 11행 이후.

`connect --url A`는 연결된 plugin이 하나면 해당 세션을 그대로 읽는다. 실제 파일이 A인지 비교하지 않으며, URL의 node-id도 읽기 범위에 사용하지 않는다. 결과 폴더는 요청한 A의 fileKey로 만들고 `fileUrlIdentityVerified:false`를 기록하지만 최종 상태는 `connected`다. 따라서 B 파일이 연결되어 있어도 A에 대한 결과처럼 저장될 수 있다.

세션 고정은 구현되어 있으나 여러 호출 사이의 페이지 고정은 없다. metadata가 페이지 `0:1`, document가 페이지 `0:2`인 fixture도 그대로 반환됐다.

수정 작업: 요청 URL/노드와 검증된 파일 식별자를 연결하고, 페이지·노드 범위를 고정한다. 검증 불가능하거나 읽기 중 대상이 바뀌면 명확한 별도 상태로 종료하거나 다시 읽는다. 단순히 `fileUrlIdentityVerified`를 true로 바꾸는 수정은 해결이 아니다.

완료 기준: 다른 파일의 plugin, 다른 페이지, 읽기 도중 페이지 변경, URL node-id 지정에 대한 실패·정상 경로 테스트.

### R03 · P1 · Chrome 직렬화가 화면 구현에 필요한 속성을 누락한다

근거: [scripter-reader.ts](../../service/packages/cli/src/scripter-reader.ts) 39행. 비교: [serializer.ts](../../service/packages/plugin/src/serializer.ts) 194, 462, 618, 744행.

Chrome 경로의 별도 속성 목록에 `isMask`, `maskType`, Grid 행·열/트랙 정보, `numberOfFixedChildren`, instance의 main component 정보 등이 없다. 기존 Desktop 직렬화에는 해당 정보의 상당 부분이 구현되어 있다. 마스크와 Grid fixture에서 네 가지 입력 필드가 모두 사라졌고 별도 경고가 없었다.

`exactDesignValues:true`는 API 값을 읽었다는 근거로 사용할 수 있지만 모든 디자인 속성의 보존을 보증하지 않는다. 현재 결과만으로 마스크·Grid·고정 요소·컴포넌트 관계를 정확히 재현하기 어렵다.

수정 작업: 두 경로의 공통 직렬화 계약과 기능별 보존 표를 만든다. 지원하지 않는 속성은 명시하고, mask/Grid/텍스트 혼합 스타일/instance/변수 모드를 같은 fixture로 비교한다. 이미지 hash만 저장하는 단계와 실제 이미지·SVG 자산 확보 단계도 구분한다.

### R04 · P1 · Chrome 명령의 `--workspace`가 조용히 무시된다

근거: [commands.ts](../../service/packages/cli/src/commands.ts) 21, 79–80, 138행 이후.

옵션 파서는 `--workspace`를 허용하지만 사용 지점은 Desktop `connect` 분기뿐이다. Chrome 경로는 대상 저장소 등록, `analyze_project`, `scan_components`, 매핑을 실행하지 않는다. `chrome-inspect --workspace <서비스>`를 실행해도 디자인 캡처만 얻는다.

수정 작업: Chrome과 Desktop 수집 이후에 동일한 저장소 분석·매핑 단계를 연결하고 결과에 실제 분석 범위와 근거를 남긴다. 명령별 지원하지 않는 옵션을 조용히 받아들이는 동작도 없앤다.

완료 기준: Chrome 명령에 전달한 저장소의 실제 컴포넌트·토큰·코드 관례가 결과에 포함되고, 다른 저장소의 데이터가 섞이지 않는다.

### R05 · P1 · Git worktree와 submodule 형태의 저장소를 스캔하지 못한다

근거: [repo-walk.ts](../../service/packages/mcp/src/fs/repo-walk.ts) 248, 336–347행.

ignore 정보를 읽을 때 `.git/info/exclude`를 항상 파일 경로로 탐색한다. `.git`이 디렉터리가 아닌 파일인 worktree/submodule에서는 중간 경로가 디렉터리가 아니라는 이유로 `PATH_OUTSIDE_WORKSPACE`를 던진다. `ignoreMatcher`는 이 오류를 처리하지 않아 전체 walk가 중단된다.

같은 임시 저장소는 `.git` 파일이 없을 때 `Button.tsx`를 찾았지만, gitdir 파일을 추가하자 `repo path parent is not a directory`로 실패했다. `analyze_project`와 컴포넌트·토큰 분석이 사용하는 공통 읽기 경로의 문제다.

수정 작업: Git 메타데이터 형태를 구분하고 읽을 수 있는 ignore 정보로 스캔을 지속한다. gitdir 포인터를 무조건 따라가 workspace 밖 읽기를 허용하는 수정은 피한다.

완료 기준: 일반 clone, gitfile 기반 worktree/submodule, Git 없는 폴더, 심볼릭 링크 경계 fixture가 모두 의도한 정책으로 처리된다.

### R06 · P1 · batch에서 실패한 하위 작업의 부분 변경이 남는다

근거: [batch.ts](../../service/packages/plugin/src/handlers/batch.ts) 467–485행, [move-nodes.ts](../../service/packages/plugin/src/handlers/move-nodes.ts) 22–23행.

batch는 실패한 작업의 이전 작업만 역순으로 되돌린다(`j = i - 1`). 실패한 작업이 이미 일부 속성을 바꾼 경우 그 변경은 복구 대상에서 빠진다.

실제 `move_nodes` 핸들러에서 x 변경 후 y setter가 한 번 실패하도록 주입했다. 좌표는 `(10,20)`에서 `(99,20)`으로 남았고 오류는 `rolled back 0 applied op(s)`였다. 실제 Figma에 오류를 발생시킨 결과가 아니라, host setter 실패를 주입해 복구 로직을 확인한 결과다.

수정 작업: 하위 작업의 부분 변경 여부와 복구 정보를 보존한다. 실패한 작업의 변경까지 복구하거나, 복구 불가능한 경우 부분 변경/결과 불확실 상태를 명시한다. 새 노드 생성 중 실패처럼 정상 결과가 아직 없는 경우도 포함한다.

완료 기준: 속성 적용 중 실패, 다중 노드 중간 실패, 생성 직후 실패, 복구 중 실패에서 실제 문서 상태와 결과가 일치한다. **Figma 쓰기 기능을 사용자 흐름에 연결하기 전에 해결해야 한다.**

## 구현되어 있는 기반과 남은 기능

| 영역             | 현재 상태                                                                                   | 남은 기능·검증                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 기존 Chrome 접근 | Playwright CDP attach, 기존 탭 선택, Scripter 실행·정밀 읽기, 로컬 결과 저장                | R01/R03/R04, 큰 구역 재개, 여러 페이지 범위, 공통 결과 계약                                 |
| Desktop 접근     | 서버 시작/재사용, 개발 plugin bundle, 일회용 코드 자동 제출, 세션 고정 읽기                 | R02, 최초 등록·실행 완료 확인, 코드 만료 후 재시도, 실제 일반 계정 연결 검증                |
| 대상 서비스 분석 | framework/styling/SVG/class naming 탐지, 컴포넌트 AST·props 스캔, component/token/icon 매핑 | R04/R05, 라우팅·상태·데이터 접근·alias·테마·접근성·테스트 관례를 실제 파일 근거와 함께 분석 |
| 디자인·UX 이해   | 구조·레이아웃·텍스트·paint·변수·component 기반, reaction 읽기 도구                          | transition easing, overlay 설정, 조건 분기, 변수 변경 등 프로토타입 세부 값·지원 여부 보존  |
| 인증·실행 기반   | pairing, 인증된 control, target scope, 정책·큐·저널·재시작 복구, 파일/네트워크 경계         | 사용자에게 연결된 승인 흐름, 안정적인 파일 UUID 초기화·재인증                               |
| Figma 쓰기       | 핸들러와 idempotency, batch inverse 기반                                                    | R06, 명시적 변경 여부 계약, 최상위 작업당 Undo 한 번, 취소·실패 처리                        |
| 구현 검증        | agent용 코드 생성 지침·매핑 도구, design_diff 기반                                          | 실제 대상 서비스에 구현한 결과의 빌드·동작·여러 viewport 화면 비교 증거                     |
| IR·배포          | 일부 계약·개발 빌드·출처 검증                                                               | 영구 section snapshot/grounding graph, 완성된 CLI, 추가 도구, 배포 산출물·CI                |

승인 broker 자체와 control 승인 endpoint는 존재한다. 다만 생산 연결의 `deliverPluginPrompt`는 [index.ts](../../service/packages/mcp/src/index.ts) 652행에서 `APPROVAL_CHANNEL_UNAVAILABLE`를 던지고 plugin UI에는 승인 화면이 없다. 이를 단순히 “승인 기능 구현 완료”로 처리할 수 없다. 현재 대화에서 받은 사용자의 일괄 승인은 제품 내부 승인 UI 구현 여부와 별개다.

[file-identity.ts](../../service/packages/plugin/src/file-identity.ts)는 기존 fileKey/문서 UUID를 읽고 없으면 세션 한정 identity로 내려간다. UUID 생성·승인·재인증 전체 흐름은 없다. 이는 모든 디자인 읽기를 막는 조건은 아니지만 영구 식별과 diff 등의 사용 범위를 제한한다.

[get-reactions.ts](../../service/packages/plugin/src/handlers/get-reactions.ts) 18행과 [queries.ts](../../service/packages/shared/src/queries.ts) 253행의 현재 계약은 일부 action을 type만 보존한다. Chrome의 reactions 원시 복사와도 계약이 다르다. 관측되지 않은 비즈니스 로직을 디자인에서 읽었다고 간주해서는 안 된다.

[IR 진입점](../../service/packages/ir/src/index.ts)은 여전히 `export {}`이고, [service-operation-registry.ts](../../service/packages/mcp/src/execution/service-operation-registry.ts) 26행의 registry는 비어 있다. CLI의 `design.json` 캡처는 정식 `snapshot.capture`/`grounding.refresh` 구현 완료와 다르다.

## 남은 작업 순서와 완료 기준

| 순서             | 작업                                                    | 완료 기준                                                                                                                                      | 기존 계획과 연결           |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1 · 즉시         | R01/R02/R03: 수집 완전성·대상 일치·속성 보존 수정       | 한도 초과/파일·페이지 전환/마스크·Grid fixture에서 누락과 대상이 정확하게 표시되고 재개 가능                                                   | Chrome 추가 경로 + 9A/10   |
| 2 · 즉시         | R04/R05: Chrome의 workspace 분석 연결과 gitfile 지원    | 같은 Chrome 디자인으로 서로 다른 대상 저장소를 분석해 해당 저장소 근거·매핑을 반환                                                             | 사용자 핵심 컨셉 + 13 일부 |
| 3 · 병행         | 실패한 Windows 검증 정리, CLI 통합 회귀 보강            | 권한 전제와 실행 시간을 명시하고 동일 환경 전체 verify 통과; read-command 전체 흐름·다중 구역·파일 변경 테스트                                 | 검증 기반                  |
| 4 · 핵심         | Chrome/Desktop 공통 inspection 결과와 자산·UX 정보 연결 | 파일·페이지·노드·시각 근거·이미지/SVG·변수 collection/mode·reaction 지원 상태가 하나의 작업 결과로 연결                                        | 10/11 일부                 |
| 5 · 핵심         | 코드 관례 분석 보강                                     | 라우팅, 상태, API 호출, alias, 공용 component API, 테마, 접근성, 테스트별 실제 파일/근거를 제시하고 불명확한 항목 표시                         | 컨셉 보강                  |
| 6 · 핵심         | 일반 계정 Desktop 첫 연결과 안정적 파일 식별 완성       | 최초 import/run 안내 또는 자동화, pair 코드 만료·재시작 복구, 대상 검증, UUID 초기화·재인증을 실제 계정에서 확인                               | 9A/9C, 13 일부             |
| 7 · 쓰기 제공 전 | 승인 UI/전송 연결 + R06 + mutation/Undo 계약            | 승인·거절·만료·재연결, no-op, 부분 실패, 취소에서 중복 변경 없음; 변경한 최상위 작업당 Undo 한 번                                              | 9B/9C                      |
| 8 · 핵심 검증    | 제공 eCommerce 디자인을 실제 대상 서비스에 구현         | 기존 component/token/pattern 재사용, 대표 화면·반응형·상호작용 구현, 대상 빌드/테스트/시각 비교 결과 저장                                      | 제품 목표 검증             |
| 9                | 영구 snapshot과 grounding graph                         | section별 성공/누락/실패·hash·출처·refresh가 공통 execution/evidence 경로로 연결                                                               | 10 잔여/11                 |
| 10               | 추가 4개 도구                                           | `export_tokens`, `export_frames_to_pdf`, `doctor`, `import_library_variable` 구현 후 registry/policy/result/handler를 함께 전환                | 12A/12B                    |
| 11               | CLI 완성 및 운영성                                      | workspace/egress/approval/target/operation/snapshot/export/일반 tool call, 명령별 옵션·오류·취소·timeout, 서버 build 검증·진단, 독립 설치 경계 | 13                         |
| 12               | 문서·배포 산출물·검증                                   | 현재 CLI와 기능에 맞는 설치 문서, package 내용 제한, SBOM/notices/checksum/패키징/CI/daemon 및 source-complete 검증                            | 14–16                      |

초기 설계의 Task 13과 비교해 CLI가 서버를 시작하는 동작, MCP 내부 모듈 재사용, 별도 Chrome 읽기 경로는 후속 자동화 요구를 반영한 변경이다. 이전 계획의 문구만으로 이를 무단 변경으로 판단하지 않는다. 대신 최종 실행·권한·패키징 계약을 구현 상태에 맞게 정리해야 한다.

현재 레지스트리는 112 tools이며 추가 4개 도구는 미등록이다. [package.json](../../service/package.json)에는 아직 존재하지 않는 `desktop-acceptance.mjs`, `generate-sbom.mjs`, `generate-notices.mjs`, `package-artifacts.mjs`, `generate-checksums.mjs`, `verify-artifacts.mjs`, `test/artifact-contents.test.ts`를 참조하는 진입점이 있다. 개발 build 성공은 릴리스 검증 성공을 뜻하지 않는다. 외부 플랫폼 검증(Task 17/18)은 별도 단계로 유지한다.

## 이번 검증 결과

| 검사                                           | 결과                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| `corepack pnpm verify`                         | **실패**, exit 1                                       |
| typecheck / lint / format:check / knip / build | 모두 통과                                              |
| 전체 Vitest, MCP E2E 포함                      | **286개 파일: 284 통과, 2 실패**                       |
| 전체 테스트                                    | **3,297개: 3,279 통과, 2 실패, 16 건너뜀**, 643.80초   |
| offline upstream lock                          | 통과: upstream 3개, vendor row 364개                   |
| staged change manifest                         | 통과: review slice, changes 93, authority 4            |
| runtime specifiers                             | 통과: codeFiles 705, manifests 6, allowedStrings 13    |
| staged/unstaged diff whitespace 검사           | 통과                                                   |
| 격리 재현 프로그램                             | 실행 성공; R01/R03/R05/R06 및 Desktop 페이지 혼합 확인 |

전체 테스트 실패는 다음 두 가지다.

1. [remote-domain-config.test.ts](../../service/packages/mcp/test/network/remote-domain-config.test.ts) 413행: Windows에서 테스트용 파일 symlink 생성이 `EPERM`으로 실패했다. 대상 store 검증에 진입하기 전의 fixture 실패이며, 보안 검증을 통과한 것으로 계산하지 않는다. 단독 재실행에서도 동일하게 실패했다. 지원 환경의 권한 전제를 명확히 하고, symlink 지원 환경에서 실제 거부 동작을 검증해야 한다.
2. [operation-evidence-artifact-store.test.ts](../../service/packages/mcp/test/fs/operation-evidence-artifact-store.test.ts) 1008행: retained-marker row cap 테스트가 5,000ms를 초과했다. 같은 테스트를 worker 1개로 다시 실행했을 때 **4,550ms에 통과**했다. 부하·fixture 비용·timeout 여유를 확인할 작업이며 이번 결과만으로 제품의 row cap 오류라고 단정하지 않는다.

재실행은 실패한 두 테스트만 대상으로 했다. 1개 통과/1개 실패/선택에서 제외된 94개라는 별도 결과를 전체 실행의 통과 수와 합산하지 않는다. 따라서 현재 상태는 **전체 verify 미통과**다. 원본 실행 기록은 [verify 로그](2026-09-05-rereview-verify.txt)에 보존했다.

## 이전 보고에서 유지·보완할 내용

- 이전의 “CLI가 비어 있다”는 초기 상태와 달리 현재 `connect`, `status`, `chrome-tabs`, `chrome-inspect`는 구현되어 있다.
- 기존 Chrome에서 제공한 파일의 11개 최상위 항목/3,198개 노드를 읽었던 실검증은 유지한다. 다만 이번 R01 때문에 `truncated:false` 하나만으로 모든 일반 입력의 완전성을 보증할 수는 없다. 그 실검증은 해당 페이지와 지원 속성의 관찰 기록이다.
- Desktop의 최초 plugin 등록·실연결은 이전 환경 도구 오류로 완료하지 못했고 이번에도 실제 연결을 재검증하지 않았다.
- 이제 전체 테스트를 최신 기능 포함 상태로 실행했으므로, 이전 118개 관련 테스트 통과 기록보다 이번 전체 검증 결과를 우선한다.
- 다음 구현은 도구 개수를 먼저 늘리기보다 **대상 일치·데이터 완전성·기존 코드 분석·대표 UI 구현 검증**부터 마무리하는 순서가 적절하다.
