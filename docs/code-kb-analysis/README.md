# Code-KB 오픈소스 전수 조사 인덱스

> 기준일: 2026-08-27 (Asia/Seoul)  
> 대상: `code-kb/`의 `figma-mcp-rust`, `figmosha2`, `figwright`  
> 현재 상태: **분석·비교·통합 설계 완료, v0.1 구현 계획 4차 검증 READY. 실제 `service/`는 Task 1 실행 전.**

## 조사 범위

| 프로젝트 | 기준 commit | 추적 파일 | bytes | 텍스트 물리/비공백 행 |
|---|---|---:|---:|---:|
| figma-mcp-rust | `6094566436577b29d04393c774d51492c12671e1` | 93 | 598,008 | 15,986 / 14,200 |
| figmosha2 | `547cefb4c90abaa1da68db5455b921cbf3f8a5b9` | 15 | 109,430 | 2,518 / 2,082 |
| figwright | `a835e81b575eab2c9265a67f9353c89b848f81ca` | 612 | 7,010,446 | 69,469 / 62,275 |
| **합계** |  | **720** | **7,717,884** | **87,973 / 78,557** |

`.git/**`와 미추적 설치·빌드 산출물은 제외했다. 세 원본 저장소는 조사 내내 read-only로 취급했으며 수정하지 않았다.

## 핵심 결론

- **Figwright를 standalone service의 fork baseline으로 사용**하는 것이 가장 현실적이다. 112개 typed tool, 105개 plugin handler, high-fidelity design context, component/token/icon grounding, multi-session relay와 contract test를 보존한다.
- **figma-mcp-rust는 중복 daemon으로 합치지 않는다.** 고유한 deterministic token export, ordered multi-page PDF, progress/export 아이디어와 compatibility recipe를 선택적으로 흡수한다.
- **figmosha2는 진단·CLI·helper UX를 흡수**한다. `doctor`, error guidance, target alias와 helper behavior는 typed Figwright handler 위에 매핑한다. raw `new Function` executor는 정상/public build에서 제외한다.
- 세 서버와 세 plugin을 병렬 운영하면 protocol·session·write race·지원 비용이 늘어난다. 목표 구조는 **하나의 ToolSpec/policy/execution pipeline과 하나의 authenticated local connector**다.

## Safe capability union 목표

| 불변식 | 목표 |
|---|---:|
| Rust/Figwright tool name lexical union | **114** = 73 + 112 − 71 |
| Canonical v0.1 MCP tools | **116** = Figwright 112 + `export_tokens` + `export_frames_to_pdf` + `doctor` + `import_library_variable` |
| Canonical v0.1 plugin handlers | **106** = 기존 105 + `import_library_variable` |
| figmosha helper ledger | **20** |
| figmosha CLI parser ledger | **12** parser / **11** 고유 동작 |

`service/capabilities/union-manifest.json`이 향후 이 집합의 source, compatibility, disposition, implementation, test, policy와 schema hash를 추적하는 authority가 된다. 이 파일과 `service/` 자체는 아직 구현되지 않았다.

## 비용 대체 경계

세 구현의 local plugin 경로는 Figma REST endpoint와 official Figma MCP endpoint를 호출하지 않으므로 해당 호출 경로와 quota에 직접 의존하지 않는다. 이것은 권한이나 결제를 깨는 우회가 아니다.

다음 조건은 그대로 남는다.

- Figma account login, plan/seat, file ACL과 Design file의 `can edit`.
- 사용자가 열 수 있는 파일과 Plugin API가 제공하는 범위.
- Desktop development plugin의 수동 import/run.
- Figma Developer Terms, Community/private/public 배포 정책.
- local CPU·memory·payload 한계와 Claude/Codex 등 model provider로 전송되는 context·inference 비용.

따라서 첫 제품 범위는 **Desktop, single user, internal/development plugin, 사용자가 편집 가능한 Figma Design 파일**이다. Web/private/public과 official connector fallback은 별도 정책·acceptance gate다.

## 추천 읽기 순서

1. 이 인덱스에서 범위와 현재 상태를 확인한다.
2. [조사 계획](00-research-plan.md)으로 기준점·방법·검토 절차를 확인한다.
3. 개별 보고서 [Rust](01-figma-mcp-rust-analysis.md) → [figmosha2](02-figmosha2-analysis.md) → [Figwright](03-figwright-analysis.md)을 읽는다.
4. [상세 비교](04-detailed-comparison.md)에서 기능·보안·정책·도구 겹침을 비교한다.
5. [통합 서비스 제안](05-unified-service-proposal.md)에서 fork 전략과 단계별 제품 경계를 읽는다.
6. [교차 리뷰 ledger](06-review-ledger.md)에서 Agent A/B/C finding과 반영 결정을 확인한다.
7. 실제 구현 전 [v0.1 구현 계획](../superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md)을 검토한다.

수치나 파일 coverage를 감사할 때는 각 inventory를 개별 보고서와 함께 본다.

## 산출물

| 번호 | 문서 | 목적 |
|---:|---|---|
| 00 | [전수 조사 계획](00-research-plan.md) | 범위, 기준 commit, 산출물, 다중 Agent 검토 절차 |
| 01 | [figma-mcp-rust 심층 분석](01-figma-mcp-rust-analysis.md) | Rust MCP, 73 tools, relay/election/schema/plugin 분석 |
| 02 | [figmosha2 심층 분석](02-figmosha2-analysis.md) | HTTP/CLI/raw executor, 20 helpers, 보안·동시성 분석 |
| 03 | [Figwright 심층 분석](03-figwright-analysis.md) | 112 tools, grounding, code→Figma, relay/election 분석 |
| 04 | [세 OSS 상세 비교](04-detailed-comparison.md) | 정량·기능·보안·정책·라이선스·tool overlap 비교 |
| 05 | [통합 서비스 제안](05-unified-service-proposal.md) | Figwright fork 중심 architecture, hard gate, roadmap |
| 06 | [교차 리뷰 및 반영 ledger](06-review-ledger.md) | Agent A/B/C finding, 토론, 수용·기각·수정 기록 |
| Plan | [Super Figma Pipeline v0.1 구현 계획](../superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md) | standalone `service/`의 116-tool secure Desktop 구현 계획 |

### 파일 인벤토리

| 프로젝트 | 전수 목록 |
|---|---|
| figma-mcp-rust | [93개 파일 inventory](inventories/figma-mcp-rust-file-inventory.md) |
| figmosha2 | [15개 파일 inventory](inventories/figmosha2-file-inventory.md) |
| figwright | [612개 파일 inventory](inventories/figwright-file-inventory.md) |

### 주요 검토 입력

| 문서 | 역할 |
|---|---|
| [Safe capability-union ledger](reviews/agent-a-capability-union-input.md) | lexical 114, helper 20, CLI 12의 semantic mapping |
| [구현 계획 리뷰 A](reviews/agent-a-review-implementation-plan.md) | 구현 계획의 spec·scope 검토 |
| [구현 계획 리뷰 B](reviews/agent-b-review-implementation-plan.md) | dependency/interface/RED/GREEN 실행 가능성 검토 |
| [구현 계획 입력 C](reviews/agent-c-implementation-plan-input.md) | security·grounding·artifact 구현 요구 |
| [구현 계획 리뷰 C](reviews/agent-c-review-implementation-plan.md) | 독립 quality·coverage 검토 |

나머지 프로젝트별·비교별 교차 리뷰는 [`reviews/`](reviews/)에 있다.

## 검증 상태와 남은 불확실성

확인된 사항:

- 세 inventory의 파일 경로·bytes·물리/비공백 행과 Git 기준점을 재계수했다.
- Rust 73, Figwright 112, exact-name overlap 71, lexical union 114를 source에서 재추출했다.
- figmosha Node helper check 20/20과 Python/JavaScript/manifest 구문 검사를 실행했다.
- 세 원본 저장소의 `git status --short`가 clean임을 확인했다.
- 구현 계획은 116 tools/106 handlers 및 114+20+12 invariant를 명시한다.

아직 확인하지 못한 사항:

- Rust와 Figwright 전체 build/test는 현재 환경의 dependency/toolchain 부재로 실행하지 못했다.
- figmosha Python pytest 16 case는 pytest/aiohttp 부재로 실행하지 못했다.
- 실제 Windows/macOS Figma Design read/write/export/reconnect acceptance는 아직 수행하지 않았다.
- Figma Web/private/public 배포 허용성과 browser 동작은 미검증이다.
- official MCP/REST limit와 Figma 정책은 변경될 수 있으므로 출시 시점에 다시 확인해야 한다.
- npm/plugin ZIP/native artifact의 최종 license·notice 포함은 구현 후 실제 package를 열어 검증해야 한다.

## 구현 상태

현재 workspace에는 아직 `service/`가 없다. 최종 계획 SHA-256은 `5EAFC23397F4A7DD147263ABAB6AF258AABB4207FCE5ED33EE428C13D15B826A`이고 implementation handoff READY다. 코드 구현·CI·배포 artifact·live Figma acceptance 상태는 Task 1에서 service를 생성한 뒤 service README와 SDD ledger에서 관리한다.
