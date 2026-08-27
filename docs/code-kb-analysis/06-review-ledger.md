# 세 OSS 분석·비교·제안 Review Ledger

> 기준일: 2026-08-27 (Asia/Seoul)  
> 범위: 최종 `01`~`05` 보고서와 구현계획의 4회 review/fix cycle  
> 목적: 리뷰 내용을 복제하지 않고 **누가 어떤 finding을 냈고, 무엇이 수용·부분수용·기각됐으며, 최종 문서 어디에 반영됐는지** 추적한다.

## 1. 역할과 문서 authority

| 역할 | 원 담당/저자 | 교차 리뷰 역할 |
|---|---|---|
| Agent A | `figma-mcp-rust` 전수 분석·inventory | figmosha2, Figwright, 비교/제안 리뷰; safe-union input 작성 |
| Agent B | `figmosha2` 전수 분석·inventory | Rust, Figwright, 비교/제안 리뷰 |
| Agent C | Figwright 전수 분석·inventory | Rust/figmosha2, 비교/제안 리뷰 |
| Main agent | 조사 orchestration, `04` 비교와 `05` 통합 제안 synthesis | A/B/C finding 토론·최종 반영 |

Authority 순서는 다음과 같다.

1. 고정 commit의 원본 source/test/config.
2. 수정된 개별 보고서 `01`~`03`의 자체 반영 ledger.
3. `04` 비교와 `05` binding proposal의 최신 synthesis.
4. [Safe capability-union input](reviews/agent-a-capability-union-input.md)은 구현 registry 설계 입력이며 원본 source를 대체하지 않는다.

## 2. 보고서별 review 현황

> finding 수는 reviewer가 제출한 row 기준이다. 중복 원인을 각 reviewer가 독립 발견한 경우도 traceability를 위해 각각 센다.

| 최종 보고서 | 저자 | Reviewer·입력 | Finding 수 | 최종 결정 | 주요 이견/증거 경계 | 최종 반영 위치 |
|---|---|---|---:|---|---|---|
| [01 figma-mcp-rust](01-figma-mcp-rust-analysis.md) | Agent A | Agent B [Rust review](reviews/agent-b-review-rust.md), Agent C [Rust 절](reviews/agent-c-review-rust-figmosha.md) | 17 | 수용 15, 부분수용 2, 기각 0 | official MCP 숫자 고정 여부; Dev Mode 52개 전체 실패 단정 범위 | `01` §3, §5~7, §9~10, §13~19, **§22 ledger** |
| [02 figmosha2](02-figmosha2-analysis.md) | Agent B | Agent A [figmosha review](reviews/agent-a-review-figmosha.md), Agent C [figmosha 절](reviews/agent-c-review-rust-figmosha.md) | 14 | 수용 13, 부분수용 1, 기각 0 | aiohttp client disconnect가 실제 handler cancellation을 일으키는지는 runtime 의존 | `02` license/launcher/concurrency/security/reuse 절, **§26 ledger** |
| [03 Figwright](03-figwright-analysis.md) | Agent C | Agent A [Figwright review](reviews/agent-a-review-figwright.md), Agent B [Figwright review](reviews/agent-b-review-figwright.md) | 16 | 수용 16, 부분수용 0, 기각 0 | null-Origin exploit의 browser 도달성은 미검증; reconnect 후 write blind replay는 해결책에서 배제 | `03` §5, §8.4, §10, §13~15, §19, §21~25, **§26 ledger** |
| [04 상세 비교](04-detailed-comparison.md) | Main | Agent A/B/C 공동 comparison/proposal reviews | 공동 34¹ | 전면 기각 0; evidence-bound 부분수용·후속 이관 있음 | 실제 구현은 비교 문서 범위 밖; official 숫자 고정 거부; weighted score는 reuse utility로만 사용 | `04` §4.3, §6.3, §10~11, §16.3, §17, §19 |
| [05 통합 제안](05-unified-service-proposal.md) | Main | Agent A [review](reviews/agent-a-review-comparison-proposal.md), Agent B [review](reviews/agent-b-review-comparison-proposal.md), Agent C [review](reviews/agent-c-review-comparison-proposal.md) | 공동 34¹ | A: 수용 9·후속이관 1; B: 수용 7·기수용 확인 2; C: 수용 14·부분수용 1; 기각 0 | 실제 source 구현은 계획으로 이관; official rate 숫자는 미고정; Web/public은 non-go; compiler 범위 단계화 | `05` §3.1, §5.1/5.4, §6, §7, §10~11, §14~18 |

¹ `04`와 `05`를 함께 대상으로 한 동일 review set이다. A 10 + B 9 + C 15 = 34이며 두 보고서 행에서 중복 합산하지 않는다.

## 3. 01 — figma-mcp-rust finding trace

### 3.1 수용

| Finding group | Reviewer IDs | 최종 반영 |
|---|---|---|
| global fast traversal race | B H-2, C R-C-02 | Summary, read/performance/security; queue·generation scope 요구 |
| foreign port/Unknown forwarding | B M-1, C R-C-01 | Election flow, `/ping` identity, security High, reuse 금지 조건 |
| follower 약 2 MiB body ceiling | B M-2 | Protocol/security/performance role asymmetry |
| mixed-font·compact typography | B M-3 | Tool row, read limitations, token/style prompt 정합성 |
| `ungroup_nodes` order reversal | B M-4 | Write limitation과 mock test gap |
| policy/reuse deployment scope | B M-5 | internal/private 한정, `can edit`/editor/seat, public 별도 검토 |
| executable parity/UTF-8 commands | B L-1 | §20 실제 PowerShell extraction/set-diff |
| lexical `any=168` 과장 | B L-2 | 숫자 삭제, `strict:false`와 구조적 risk만 유지 |
| palette 9/10-step 모순 | B L-3 | Prompt table/priority |
| MCP side-effect annotations | C R-C-04 | ToolDef metadata/readOnly/destructive/idempotent gap |
| release supply chain | C R-C-05 | mutable actions, latest publisher, direct tag, npm provenance |
| artifact LICENSE | C R-C-06 | npm/plugin ZIP notice와 pack/zip gate |
| LLM/local 비용 | C R-C-07 | Figma endpoint 비용과 model/local/support 비용 분리 |

### 3.2 부분수용

| Finding | 수용한 부분 | 유보한 부분·이유 |
|---|---|---|
| B H-1 REST/official MCP limit | 서로 다른 체계로 분리, 이 code path의 두 endpoint 호출 0 확정 | Starter 특정 숫자는 공식 수집 경로/시점 표현이 충돌해 고정하지 않음 |
| C R-C-03 Dev Mode write | document mutation read-only와 preflight 부재 반영 | `navigate_to_page` 같은 UI-state까지 52개 전부 실패한다는 tool별 matrix는 live evidence 없음 |

전면 기각은 없다. 상세 결정은 [`01` §22](01-figma-mcp-rust-analysis.md)에 있다.

## 4. 02 — figmosha2 finding trace

### 4.1 수용

| Finding group | Reviewer IDs | 최종 반영 |
|---|---|---|
| Solar SVG CC BY 4.0 | A-FIG-01, F-C-02 | License/strength/risk/reuse; attribution 또는 자체 asset 교체 |
| Unix readiness deadline | A-FIG-02 | nominal sleep와 unbounded `curl` wall time 분리 |
| concurrent challenger race | A-FIG-03 | WS generation lock/recheck/loser close |
| Figma endpoint vs LLM 비용 | A-FIG-05, F-C-04 | Cloud model token·seat·local compute·support 잔존 |
| fixed localhost topology | A-FIG-06 | bind/connect address와 port configuration 분리 |
| “승인된 API” 문구 | A-FIG-07 | API availability와 integration approval 분리 |
| Community icon 판단 | A-FIG-08 | “manifest 미연결” 철회, publishing/provenance 미검증으로 변경 |
| per-command undo boundary | A-FIG-09, F-C-03 | `commitUndo()` 0건, host undo granularity 미검증 |
| imported `build_app()` Host gate | F-C-01 | `main()` global 초기화 전제와 immutable config 요구 |
| health product identity | F-C-05 | Port/2xx가 아닌 service/protocol/instance magic 요구 |

### 4.2 부분수용

| Finding | 결정 |
|---|---|
| A-FIG-04 cancellation cleanup | `finally` 부재와 task/server cancellation 누수 가능성은 수용. aiohttp client disconnect가 실제 handler cancellation을 일으키는지는 환경별 실험 전까지 단정 유보 |

전면 기각은 없다. 상세 결정은 [`02` §26](02-figmosha2-analysis.md)에 있다.

## 5. 03 — Figwright finding trace

16개 finding은 전부 수용됐다. 중복 발견도 독립 검증 증거로 남겼다.

| Finding group | Reviewer IDs | 최종 반영 |
|---|---|---|
| `token_map` session mixing | A-FW-01 | Multi-file correctness P0, same-session pin/provenance/test |
| `design_diff` file identity collision | A-FW-02 | Snapshot `{file identity,nodeId}` namespace |
| plugin ZIP notice | A-FW-03, F-W-06 | LICENSE/third-party notice release gate |
| unbounded HTTP body/pending | A-FW-04, F-W-04 | Ingress/pending byte·count cap과 backpressure |
| build timestamp ordering | A-FW-05 | Build time와 semantic source freshness 구분 |
| WS root/`/ws` path drift | A-FW-06 | Canonical path 강제 필요 |
| icon library 11→12 | A-FW-07 | 숫자 정정 |
| README single connection drift | A-FW-08 | Multi-session wording 정정 |
| live 미실행인데 “동작” 단정 | A-FW-09 | Source/test 구현 확인으로 범위 축소 |
| null-Origin fake plugin | F-W-01 | Pairing auth P0; browser exploit 도달성은 미검증으로 제한 |
| reconnect in-flight loss | F-W-02 | Journal/same-ID resume 또는 outcome-unknown; blind replay 금지 |
| official MCP를 read-only로 본 과장 | F-W-03 | `use_figma`, `generate_figma_design` write/code-to-canvas를 build-vs-buy에 반영 |
| component discovery scope | F-W-05 | `get_local_components` selection/subtree, remote library discovery 부재 |
| kind 집계 재현성 | F-W-07 | Registry membership+ToolSpec kind 결합 명령으로 교체 |

처방 관련 핵심 결정: F-W-02는 결함을 수용했지만 이미 적용됐을 수 있는 write를 journal 없이 자동 replay하는 방안은 중복 mutation 때문에 채택하지 않았다. 상세는 [`03` §26](03-figwright-analysis.md)에 있다.

## 6. 04/05 공동 review trace

### 6.1 Reviewer별 finding 수와 처리

| Reviewer | Review | 제출 | 처리 요약 |
|---|---|---:|---|
| A | [comparison/proposal review](reviews/agent-a-review-comparison-proposal.md) | 10 | 9개 문서 반영, “실제 구현 0”은 v0.1 계약·별도 구현계획으로 이관 |
| B | [comparison/proposal review](reviews/agent-b-review-comparison-proposal.md) | 9 | 7개 반영, license/fork 2개는 review 시점 최신본에서 이미 해결됨을 확인 |
| C | [comparison/proposal review](reviews/agent-c-review-comparison-proposal.md) | 15 | 14개 반영, current rate 숫자 정량 고정 요구는 source 충돌 때문에 부분수용 |

전면 기각은 없다. “부분수용”은 요구를 무시한 것이 아니라 외부 숫자·live 정책·실제 code가 없는 상태에서 증거보다 강한 완료 주장을 피한 결정이다.

### 6.2 반영된 주요 synthesis

| Topic | 주요 source finding | `04` 최종 위치 | `05` 최종 위치 |
|---|---|---|---|
| Safe capability union | A-CP-02, C-P-01, CP-05 | §6.3: lexical union 114와 semantic adapter 경계 | §5.4: canonical 116, manifest 114+20+12 |
| Figwright core blockers | A-CP-03, C-P-03/C-P-09 | §10~11 project risk | §5.1, §11.2 release blockers |
| Model egress | A-CP-04, CP-01 | §4.2 local bridge≠local AI | §2.1, §6.1, external MCP pre-return fail-closed |
| v0.1 범위 | A-CP-05, C-P-02, CP-11 | Hard gate와 scenario | §14 phased roadmap, §15 Desktop Internal Preview 계약 |
| Rust/figmosha unique 기능 | A-CP-06, C-P-06 | §19 adoption table | §5.2/5.3, canonical added functions |
| Desktop/Web modes | A-CP-08, C-P-07, CP-07 | §16.2 deployment matrix | §10 Mode A/B/C/D, Web deferred |
| License/fork | A-CP-09, C-P-05, CP-04/13 | §16.1 notices/SBOM | §5.1 fork blockers, §16 artifact gate |
| Official MCP build-vs-buy | C-P-04, CP-02, F-W-03 | §4.3 + §16.3 current official write/code-to-canvas | §10.4 official fallback, Phase 0 measurement |
| Saga/IR precision | CP-09/10 | Canonical IR caveat | §7 loss states/observed-vs-inferred, §11.2 durable saga |

## 7. 토론 Decision Records

### DR-01 — Official MCP rate 숫자는 고정하지 않는다

**문제:** Reviewer/도구별 수집 결과가 같은 official MCP 문서의 Starter 표시를 **6회/월 대 20회/월**로 서로 다르게 읽었다. 이 `6/20`은 live page·crawler·수집 시점 간 충돌이므로 어느 한쪽도 현재 truth로 고정하지 않는다. 한쪽 숫자를 제품 상수처럼 채택하면 보고서 자체가 즉시 stale하거나 잘못될 수 있다.

**합의:**

1. Figma REST API와 official Figma MCP는 서로 다른 limit authority다.
2. 세 OSS code path가 두 cloud endpoint를 호출하는 횟수는 모두 **0**이다.
3. 특정 monthly/daily/minute 숫자는 product constant와 runtime policy에 넣지 않는다.
4. 출시·ROI 평가 시 [official MCP plans/access](https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions/)와 [REST limits](https://developers.figma.com/docs/rest-api/rate-limits/)를 같은 확인일에 다시 읽고 evidence를 보존한다.
5. Figma seat/plan, LLM inference, local compute, support/distribution 비용은 남는다.

**반영:** [`01` §3/§22](01-figma-mcp-rust-analysis.md), [`04` §4.3](04-detailed-comparison.md), [`05` §3.1](05-unified-service-proposal.md).

### DR-02 — Code license와 bundled asset/artifact license를 분리한다

- 세 codebase는 MIT지만 각 copyright/permission notice를 보존한다.
- Rust는 Go 원작자와 Rust port 고지를 모두 보존한다.
- figmosha Solar/480 Design SVG는 CC BY 4.0이다. 사용 시 creator/source/license/change attribution, 미사용 시 자체 asset 교체 기록이 필요하다.
- Rust/Figwright npm·plugin ZIP은 LICENSE/third-party notice 포함을 실제 archive contents로 검증한다.

**반영:** `02` §26, `03` license/release, `04` §16.1, `05` §16.1.

### DR-03 — Rust bridge는 hardening 전 재사용하지 않는다

핵심 근거는 두 가지다.

1. `skipInvisibleInstanceChildren`는 global인데 queue가 없어 concurrent fast read/write에서 잘못 복원된다.
2. `/ping`은 body identity를 검증하지 않고 `Unknown`도 foreign port `/rpc`로 payload를 보낸다.

따라서 Rust의 가치는 native packaging/export/progress 아이디어이며 현재 election/plugin global-state 구현 자체는 core로 채택하지 않는다.

### DR-04 — Figwright multi-file grounding은 session/file identity fix가 선행한다

- `token_map` variables/styles read를 한 session에 pin한다.
- `design_diff` baseline을 `{stable file identity,nodeId}`로 namespace한다.
- Reconnect 후 dispatched write는 blind replay하지 않고 journal 기반 resume 또는 `outcome-unknown`으로 처리한다.

**반영:** `03` §26, `04` §10~11, `05` §5.1/§11.2.

### DR-05 — Model egress는 MCP response 이전에 통제한다

Local relay가 곧 local-only AI는 아니다. Claude/Codex/Cursor가 외부 MCP client이면 `CallToolResult`를 받는 순간 provider egress가 일어날 수 있다. 따라서 external-MCP mode는 handler가 response를 만들기 전에 sensitivity classification, redaction, byte/token budget, consent를 fail-closed 적용한다. Service가 provider의 이후 사용을 통제할 수 없다는 한계도 문서화한다.

**반영:** `04` §4.2, `05` §2.1/§6.1/§11.

### DR-06 — Lexical union 114를 canonical MCP 116으로 보존한다

- Rust 73 + Figwright 112의 name intersection은 71, lexical union은 114다.
- Same-name은 wire compatibility를 뜻하지 않는다.
- Canonical target은 Figwright 112 + Rust-only `export_tokens`, `export_frames_to_pdf` + figmosha `doctor`, `import_library_variable` = **116 MCP tools**다.
- figmosha helper20/CLI parser12(unique11)는 native/adapter/alias/rejected ledger로 별도 추적한다.
- Public raw exec는 rejected, audited local expert exec는 deferred다.

상세 114행 분류는 [capability union input](reviews/agent-a-capability-union-input.md)에 있다.

### DR-07 — Public live bridge는 non-go다

Desktop internal/sideloaded editable Design file을 첫 제품 mode로 둔다. Community public live MCP bridge는 official-MCP-external programmatic AI access와 별도 local package 성격 때문에 명시적 서면 예외 또는 실제 review 승인 전 출시하지 않는다. Web은 private/published acceptance, explicit artifact exchange, official connector fallback으로 분리한다.

**반영:** `04` §16.2/§17, `05` §10/§16/§17.

## 8. Safe capability-union artifact

[Agent A capability-union input](reviews/agent-a-capability-union-input.md)은 다음 수량을 검증했다.

| 항목 | 수 |
|---|---:|
| Union tool rows | 114 |
| Source | common 71 / Figwright-only 41 / Rust-only 2 |
| Compatibility | same 17 / adapter 43 / incompatible 11 / unique 43 |
| v0.1 draft disposition | native 50 / adapter 56 / deferred 8 |
| figmosha helper mapping | 20/20 |
| figmosha parser mapping | 12/12, unique behavior 11 |

이 수치는 구현 registry의 최종 상태가 아니라 계획 입력이다. `05`의 binding target은 Motion/video를 experimental capability로 보존하고 added doctor/library import를 포함한 canonical 116이다. 구현 단계에서 machine-readable manifest와 registry/docs/tests가 exact sync해야 한다.

## 9. Implementation plan review — READY

구현 계획은 별도 review cycle로 관리했으며 보고서 finding 수·수용률에는 포함하지 않는다.

- [Implementation plan](../superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md)
- [Agent A plan review](reviews/agent-a-review-implementation-plan.md)
- [Agent B plan review](reviews/agent-b-review-implementation-plan.md)
- [Agent C plan review](reviews/agent-c-review-implementation-plan.md)
- [Agent C implementation-plan input](reviews/agent-c-implementation-plan-input.md)
- [Agent A round 1 re-review](reviews/agent-a-rereview-implementation-plan.md)
- [Agent B round 1 re-review](reviews/agent-b-rereview-implementation-plan.md)
- [Agent A round 2 re-review](reviews/agent-a-rereview2-implementation-plan.md)
- [Agent B round 2 re-review](reviews/agent-b-rereview2-implementation-plan.md)
- [Agent A round 3 re-review](reviews/agent-a-rereview3-implementation-plan.md)
- [Agent B round 3 re-review](reviews/agent-b-rereview3-implementation-plan.md)

상태: **READY**. 4회 fix/re-review를 거쳐 최종 SHA-256 `5EAFC23397F4A7DD147263ABAB6AF258AABB4207FCE5ED33EE428C13D15B826A`에서 독립 reviewer 2명이 `Critical 0 / Important 0`과 implementation handoff READY를 확인했다. 계획은 18 Tasks, 116 tools/106 handlers/10 server-only, source-complete Preview(Task 1–16)와 외부 GA evidence(Task 17–18)를 구분한다.

## 10. 최종 상태

| 문서군 | Review closure |
|---|---|
| `01`~`03` 개별 보고서 | 자체 ledger 반영 완료; 전면 기각 0 |
| `04` 비교 | A/B/C synthesis 반영 완료; score는 release readiness가 아닌 reuse utility |
| `05` 제안 | Safe union, security, egress, Desktop/Web modes, v0.1 contract 반영 완료 |
| 실제 service source | 아직 없음; implementation plan READY, Task 1 실행 대기 |

이 ledger는 “모든 reviewer가 동의했다”는 선언이 아니라, **이견을 어떤 증거 경계로 처리했는지**를 재현하는 index다. 새로운 source/live evidence가 생기면 해당 finding row와 최종 반영 위치를 함께 갱신해야 한다.
