# Agent B 리뷰 — 상세 비교 및 통합 서비스 제안

> 대상: `docs/code-kb-analysis/04-detailed-comparison.md`, `05-unified-service-proposal.md`  
> 대조: 수정된 01/02/03 개별 보고서, 세 inventory, Agent A/B/C 교차리뷰, 세 원본 저장소  
> 관점: “세 OSS 기능을 가능한 한 합집합으로 보존한 뒤 실제 구현 가능한 v0.1을 만든다”  
> 기준일: 2026-08-27 (Asia/Seoul)

## 1. 총평

두 문서의 큰 방향은 유지할 가치가 있다.

- Figwright를 fork base로 선택한 판단은 타당하다.
- 세 daemon/plugin을 병렬 유지하지 않고 한 protocol/tool registry로 합치는 판단도 타당하다.
- Desktop/internal mode를 첫 배포로 두고 Web/public을 policy gate 뒤에 둔 판단은 현실적이다.
- Figma→code grounding을 먼저 활용하고 code→Figma deterministic compiler를 완성품으로 과장하지 않은 점도 정확하다.

그러나 새 사용자 요구에는 세 가지 큰 공백이 있다.

1. “최대한 합집합”을 검증할 **feature preservation contract**가 없다. 채택·선택·Should·Could가 섞여 있어 fork 후 기존 기능이 조용히 빠져도 완료로 판단할 수 있다.
2. 05의 Must/Phase 1~3은 secure relay, canonical IR, 세 framework AST patcher, renderer, visual diff, mapping store, staging, 3-way sync를 한 MVP에 겹쳐 실제 v0.1 범위로는 너무 크다.
3. 교차리뷰에서 확인된 Figwright의 concrete security/reconnect 결함과 현행 공식 MCP의 write/code-to-canvas 기능이 비교·gate에 아직 반영되지 않았다.

따라서 **방향은 승인, 현재 상태의 구현 handoff는 보류**가 적절하다. 아래 high finding과 v0.1 재범위를 먼저 반영해야 한다.

## 2. Finding 요약

| ID | Severity | 영역 | 요약 |
|---|---|---|---|
| C-P-01 | HIGH | 최대 합집합 | 112/73의 name union 114와 figmosha CLI/helper/raw expert surface를 보존하는 target manifest가 없다. 최신 문서가 Motion 보존 등 일부 경계를 고쳤지만 전체 retain/add/defer invariant는 없다. |
| C-P-02 | HIGH | v0.1·실제 구현 | 현재 Must는 여러 후속 제품을 한 release에 묶고 file/module-level backlog·완료 명령이 없어 바로 구현할 수 있는 v0.1 spec이 아니다. |
| C-P-03 | HIGH | 보안 hard gate | pairing/queue를 일반론으로만 적고 null-Origin impersonation, reconnect outcome-unknown, HTTP body cap, Host factory coupling 등 확인된 concrete defect를 release blocker로 연결하지 않았다. |
| C-P-04 | HIGH | 공식 대안·비용 | “공식 MCP의 read-oriented 흐름” 전제가 오래됐다. 공식 MCP는 현재 `use_figma` write와 `generate_figma_design` code-to-canvas/live UI capture를 제공한다. |
| C-P-05 | RESOLVED | 라이선스 | 최신 04/05가 Solar CC BY 4.0, PNG provenance, artifact notice/SBOM gate를 반영했다. 유지·검증만 필요하다. |
| C-P-06 | RESOLVED | fork·흡수 방식 | 최신 04/05가 Rust launcher를 ADR 뒤로 미루고 figmosha helper는 Figwright authority+alias/test로 흡수하도록 수정했다. |
| C-P-07 | MEDIUM | Desktop/Web | Web mode의 기술 topology와 capability가 미정이다. local WS, private/published plugin, artifact, official connector를 서로 다른 제품 mode로 표준화해야 한다. |
| C-P-08 | MEDIUM | code→Figma | existing component discovery를 과대평가한다. `get_local_components`는 selection/subtree 전용이고 remote library 검색이 없으며 canonical IR/AST compiler는 신규 대형 범위다. |
| C-P-09 | LOW | 비교표 최신성 | Rust/figmosha finding은 반영됐지만 Figwright null-Origin, in-flight reconnect loss, unbounded HTTP body가 04의 보안 표·점수에 아직 없다. |

## 3. 상세 Finding

### C-P-01. “최대한 합집합”을 증명할 target feature manifest가 없다

04는 Rust 73개 중 Figwright와 exact-name overlap 71, Rust-only 2개를 정확히 계산했다 (`docs/code-kb-analysis/04-detailed-comparison.md:110-142`). 원본 집합을 다시 추출해도 다음과 같다.

```text
figma-mcp-rust tools = 73
Figwright tools       = 112
exact-name overlap    = 71
name union            = 114
Rust-only             = export_frames_to_pdf, export_tokens
```

하지만 05에는 target product가 몇 개 tool/command/recipe를 보존하는지 authority가 없다. 특히:

- 최신 05는 Motion에 “원 기능은 보존”이라고 명시하고 Rust launcher도 ADR 뒤로 옮겼다. 다만 export/design_diff/multi-session을 포함한 기존 112개 surface 전체에 대해 “retain”을 고정하는 authority는 여전히 없다 (`05-unified-service-proposal.md:591-619`). “추가 품질 투자를 미룬다”와 “fork에서 기능을 제거한다”를 manifest로 구분해야 한다.
- Rust-only `export_frames_to_pdf`와 `export_tokens`는 후보로만 남아 합집합 보존이 보장되지 않는다 (`04:370-374`; `05:153-166`).
- Rust 12 prompt/13 skill은 “선별”한다고만 하고 어떤 recipe를 merge/repair/drop하는지 없다.
- figmosha 11 CLI 동작, 20 helper, raw expert mode는 이름·semantic equivalence·target command가 한 표에 없다.
- `doctor`를 채택한다고 하지만 MCP tool인지 CLI command인지 panel action인지 정의되지 않았다.

**구체 수정안**

`docs/code-kb-analysis/05-unified-service-proposal.md`에 machine-readable source가 될 “Union Feature Manifest”를 추가한다.

| 필드 | 의미 |
|---|---|
| featureId | source-independent semantic ID |
| source | Figwright/Rust/figmosha path+symbol |
| sourceSurface | tool/prompt/skill/CLI/helper |
| targetSurface | retained tool, compatibility alias, CLI, internal utility, expert-only |
| disposition | retain-as-is / harden / merge / add / policy-disabled / post-v0.1 |
| targetModule | 실제 구현 파일 |
| acceptance | test/fixture/manual gate |
| license | MIT/CC BY/other notice |

최소 invariant는 다음이어야 한다.

1. Figwright 112 tools/105 handlers/2 prompts/2 skills는 **retain baseline**으로 명시한다. v0.1에서 새로 개발하지 않더라도 삭제하면 안 된다.
2. Rust-only 두 semantic 기능은 v0.1 compatibility tool 또는 명시적 post-v0.1 item으로 결정한다. 합집합을 우선한다면 `export_frames_to_pdf`와 `export_tokens`를 추가해 tool name surface는 114가 된다.
3. `doctor`를 추가 tool로 노출하면 target count는 최소 115다.
4. figmosha CLI는 existing typed tools의 local CLI alias로 매핑하고, raw executor만 policy-disabled expert feature로 분리한다.
5. Rust prompt/skill은 broken argument를 수정한 recipe pack manifest로 전환한다.

보안·정책상 disabled는 “폐기”가 아니라 build mode와 이유가 명시된 보존 상태로 관리해야 한다.

### C-P-02. 현재 Must는 구현 가능한 v0.1 범위가 아니다

최신 05는 React를 Phase 2A로 먼저 두고 Vue/Svelte를 2B로 분리해 이전보다 현실적이다. 그래도 Must에는 secure execution plane, canonical IR adapter, React AST patch, screenshot+build/test, mapping store, design baseline, typed write가 함께 들어 있다 (`05-unified-service-proposal.md:514-568,591-603`).

이는 다음 서로 다른 제품을 한 “MVP”로 묶는다.

- authenticated local Figma executor;
- high-fidelity design reader/grounding;
- repository-aware code modification engine;
- render/visual-diff harness;
- reverse code→design compiler;
- durable bidirectional sync/conflict engine.

또한 target repository 경로/package 이름, source file 목록, interface signature, migration order, 첫 failing test, 실행 command가 없다. “실제 구현”으로 넘기기에는 architecture vision이고 implementation spec은 아니다.

**권장 v0.1 완료 범위**

| 범주 | v0.1 포함 | v0.1 제외 |
|---|---|---|
| base | Figwright commit `a835e81` fork, existing 112 surface 그대로 | canonical IR 전면 재작성 |
| connector | Desktop development plugin, Figma Design, user-editable file | Web/private/public, official connector |
| security | pairing, null-Origin-safe auth, body limits, side-effect metadata, workspace output sandbox | cloud tenancy/SSO |
| reliability | per-session write queue, in-flight+completed idempotency, disconnect outcome state | durable distributed transaction |
| union additions | `doctor`, structured hints, Rust token/PDF compatibility, CLI aliases | native Rust launcher |
| Figma→code | existing Figwright grounding + skill; MCP host의 file tools로 code edit | 새 standalone AST patch compiler(React first 포함) |
| code→Figma | existing 79 typed writes + existing skill, staging page convention | AST→canonical IR deterministic compiler |
| verification | existing CI, new security/reconnect/license tests, manual Desktop Design round-trip | full 3-way sync/visual benchmark farm |

이 v0.1은 “세 OSS 기능을 보존한 secure Desktop internal fork”로 완료 가능하다. Phase 2 이후에 canonical IR adapter와 language-specific compiler를 별도 version으로 추가한다.

**구체 implementation handoff 예**

1. `packages/shared`: pairing envelope/capability/side-effect schema.
2. `packages/mcp/src/relay`와 `election/leader-endpoints.ts`: authenticated hello, HTTP body cap, disconnect outcome journal.
3. `packages/mcp/src/dispatch.ts`: per-session single-writer scheduler.
4. `packages/plugin/ui`: pairing code UI와 current capability.
5. `packages/mcp/src/tools`: `doctor`, `export_tokens`, multi-page `export_frames_to_pdf`.
6. `packages/plugin/src/handlers`: 기존 handler를 유지하고 helper behavior regression tests 추가.
7. release workflow: all notices/artifact content gate.

Definition of Done은 `pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test`, 새 security E2E, manual Figma Design read/write/export/undo/reconnect acceptance를 모두 요구해야 한다.

### C-P-03. security 표가 concrete source defects와 연결되지 않았다

최신 05의 security/reliability/test table은 pairing, secret lifecycle, queue, journal, reconnect E2E를 추가해 방향은 좋다 (`05-unified-service-proposal.md:398-469`). 하지만 아래 concrete source failure를 이름 붙인 release blocker와 fixture로 직접 연결하지는 않았다.

| 확인된 defect | 근거 | v0.1 hard gate |
|---|---|---|
| Figwright가 `Origin:null`을 Figma identity로 허용 | `code-kb/figwright/packages/mcp/src/local-access.ts:18-25,60-67`; `reviews/agent-b-review-figwright.md:F-W-01` | pairing secret 없이는 hello/session 등록 불가 |
| dispatched request가 reconnect queue에서 skip | `packages/mcp/src/relay/relay.ts:300-313`; `F-W-02` | write outcome-unknown state와 same-ID resume/reject test |
| `/rpc`/`/abdicate` body unbounded | `packages/mcp/src/election/leader-endpoints.ts:38-44`; `F-W-04` | streaming byte cap+413+slow body test |
| local filesystem tool이 `readOnlyHint:true` | `packages/mcp/src/tools/annotations.ts:14-17` | explicit sideEffect kind와 approval E2E |
| arbitrary root/output path | Figwright local tools | canonical workspace capability와 overwrite/symlink test |
| figmosha `build_app()` reuse 시 Host check off | `code-kb/figmosha2/bridge.py:29-32,51-56,321-343` | 해당 Python server를 이식하지 않거나 immutable config test |
| figmosha concurrent handover/cancellation cleanup | `bridge.py:144-174,249-290` | transport code를 이식하지 않고 behavior requirement만 반영 |
| Rust Unknown forwarding/stale socket/fast flag | Rust 교차리뷰 | Rust core/plugin을 v0.1 runtime으로 병합하지 않는다는 exclusion test/ADR |

“pairing을 넣는다”만으로는 완료 기준이 아니다. hostile null-origin iframe, same-user process, concurrent reconnect, in-flight write, oversized msgpack, symlink/reparse point fixture가 모두 통과해야 Phase 1 Go 조건이 만족된다.

### C-P-04. 현행 official MCP 비교가 오래됐다

04/05는 세 OSS가 official MCP를 쓰지 않는다는 점은 정확히 설명한다. 그러나 03과 05 비용표는 official MCP를 사실상 read-oriented 대안으로 취급한다 (`03-figwright-analysis.md:115-120`; `05:53-64,359-365`).

현행 official Figma MCP에는:

- Plugin API JavaScript로 native Figma structure를 create/edit하는 `use_figma`가 있다. [Write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/).
- live browser UI를 editable layers로 capture하는 `generate_figma_design`이 있다. [Code to canvas](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/).
- design-system search와 asset upload/download를 포함한 broader tool catalog가 있다. [Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/).

따라서 Mode D는 단순 view-only/unopened-file fallback이 아니라 다음 capability를 가진다.

| 공식 capability | 통합 서비스의 선택 |
|---|---|
| `use_figma` | public/policy-safe write connector |
| `generate_figma_design` | Figwright에 없는 live DOM→editable layer 경로 |
| design-system search | remote library component discovery 보완 |
| asset upload/download | local plugin wildcard fetch 대체 |

Figwright의 차별점은 write의 존재가 아니라 local quota path, 112 typed primitives, codebase grounding, multi-session relay다. Build-vs-buy 표와 비용 설명을 이 기준으로 다시 써야 한다.

### C-P-05. [해결됨] license/notice gate

최신 04는 code license와 bundled third-party를 분리하고 Solar/480 Design CC BY 4.0, PNG provenance, artifact notice 검사를 명시했다 (`04-detailed-comparison.md:20-33,310-321`). 최신 05도 세 MIT notice, Solar attribution/교체, SBOM, actual package/ZIP 검사를 release gate로 넣었다 (`05-unified-service-proposal.md:498-507,629-638`). 이 항목은 더 이상 미해결 finding이 아니다. 구현 단계에서 CI가 실제 tgz/ZIP을 열어 검증하는지만 확인하면 된다.

### C-P-06. [해결됨] Rust/figmosha 흡수 경계

최신 문서는 Rust launcher가 Rust server 전용이라는 점을 인정하고 Node embed/worker/installer ADR 뒤로 미뤘다 (`05:165-179`). figmosha의 `bF/bS/bN`, mixed font, frame helper도 code를 중복 port하지 않고 Figwright의 type-aware binding/range-font/placement handler를 authority로 유지하며 UX·alias·test만 흡수하도록 수정했다 (`04:398-405`; `05:181-194`). 이 방향을 유지한다.

### C-P-07. Web은 한 mode가 아니라 세 mode다

05는 Web을 Phase 4로 미루고 private plugin/artifact/official fallback을 제시한다. 방향은 맞지만 capability와 technical topology가 섞여 있다 (`05:330-365,515-527`).

| Web mode | local daemon | write | 자동성 | hard gate |
|---|---|---|---|---|
| private/published live plugin | browser가 same-machine authenticated local relay에 연결 | permission/editor에 따라 | 높음 | Figma 배포 허용, mixed-content/local WS, pairing, browser matrix |
| explicit artifact exchange | 불필요하거나 import/export 시만 | user preview/apply | 중간 | signed IR package, user gesture, schema migration |
| official MCP connector | remote official service | official `use_figma`/capture 범위 | 높음 | seat/OAuth/quota/policy |

“Web 지원” claim은 mode 이름, plan/seat, file permission, read/write/export capability, local daemon 요구를 함께 표시해야 한다. v0.1은 Desktop-only로 명시해도 되지만 original user requirement의 Web은 Phase 4 acceptance에서 명확한 deliverable owner를 가져야 한다.

### C-P-08. code→Figma 범위를 discovery와 compiler로 나눠야 한다

05는 code graph→Design IR→staging→3-way sync를 단계적 가능으로 둔다. 기술적으로 가능한 vision이지만 현재 fork baseline과의 거리가 크다.

- `scan_components`는 local source AST scanner이지 Figma component discovery가 아니다. 문서도 이를 이미 찾았다.
- `get_local_components`는 file-wide가 아니라 current selection/node subtree 전용이다 (`code-kb/figwright/packages/mcp/src/tools/get-local-components.ts:7-20`; `packages/plugin/src/handlers/get-local-components.ts:14-28`).
- published componentKey로 `create_instance`할 수 있지만 available remote library key 검색 tool은 없다.
- canonical IR, code AST→IR, persistent node↔symbol graph, 3-way merge는 세 OSS 어디에도 완성 구현이 없다.

따라서 v0.1 code→Figma는 “existing typed writes/skill을 보존하고 staging convention을 추가”하는 수준으로 닫는다. 다음 release에서:

1. page별 local component index;
2. policy-allowed library search;
3. one framework adapter;
4. provenance store;
5. supported-field round-trip corpus;

순으로 확장해야 한다. 최신 roadmap이 React 2A 뒤 Vue/Svelte 2B로 나눈 결정은 유지하되, secure execution v0.1과 React AST compiler release도 분리하는 편이 완료 가능성이 높다.

### C-P-09. 비교 보안/점수 표에 Figwright 최신 finding이 남아 있다

최신 04는 Rust Unknown/peer/traversal race, figmosha Host factory/handover, Solar CC BY를 반영했다 (`04-detailed-comparison.md:229-255,310-321`). 남은 누락은 Figwright null-Origin impersonation, in-flight reconnect loss, unbounded HTTP body다. security 표는 Origin allowlist를 방어로만 표시하고 P0/P1 row에도 이 세 가지가 없다 (`04:231-255`).

숫자 score는 의사결정 보조이므로 유지할 수 있지만 hardening 전 Figwright security 3.5/5와 reuse boundary를 재평가하거나 “보안 수정 후 목표 점수”와 “현재 점수”를 분리해야 한다.

## 4. 제안하는 v0.1 Union Contract

### 4.1 Surface

| Surface | v0.1 계약 |
|---|---|
| MCP tools | 기존 Figwright 112 전부 retain; Rust-only 2개 add/compat; `doctor` add 시 최소 115 |
| Plugin handlers | existing 105 유지; 새 tool은 existing handler composition 우선 |
| MCP prompts/skills | Figwright 2+2 유지; Rust recipe는 argument를 고친 뒤 별도 pack |
| CLI | `doctor/status/sel/tree/find/text/variant/clone/rm/import`를 typed tool alias로 제공 |
| Helpers | public raw `h.*`가 아니라 typed handler utility/test recipe로 merge |
| Expert raw | local development build에서만 compile, default off, per-session enable+mutation approval+audit |
| Existing Motion/export/diff/session | “Could”가 아니라 retained baseline; 추가 품질 투자는 defer 가능 |

### 4.2 Hard gates

v0.1 release는 다음 중 하나라도 실패하면 중단한다.

1. unauthenticated/null-origin peer가 session이 될 수 없음.
2. oversized/slow HTTP와 WS frame이 bounded failure.
3. socket flap 중 write가 duplicate 없이 completed 또는 explicit outcome-unknown.
4. all filesystem/network/destructive effects가 정확한 annotation과 approval.
5. workspace 밖/symlink/reparse write 불가.
6. existing 112 tool/plugin/docs/contract tests regression 없음.
7. runtime output validation이 새/critical write·export에 적용.
8. npm/plugin artifact에 모든 license/notice 포함.
9. actual Desktop Figma Design에서 read/write/export/undo/reconnect smoke 통과.
10. public/Web build artifact에 raw expert mode 없음.

### 4.3 v0.1에서 의도적으로 미루는 것

- Web/private/public connector.
- official connector implementation.
- Node-free native packaging.
- standalone AST patch engine.
- canonical IR 전면 교체.
- SQLite grounding graph와 3-way sync.
- 새 Motion 기능 개발.
- React/Vue/Svelte 세 adapter 동시 구현.

기존 fork에 들어 있는 해당 기능은 삭제하지 않고, **새로 만들 범위만** 미룬다.

## 5. 수정 우선순위

1. 04의 Figwright security/official MCP 표를 최신 evidence로 수정.
2. 05에 Union Feature Manifest와 retain/harden/add/defer 상태를 추가.
3. Phase 1을 v0.1로 재정의하고 C-P-02의 file-level backlog/DoD를 넣기.
4. concrete security hard gates를 source defect와 regression test에 연결.
5. official `use_figma`/`generate_figma_design`을 Mode D와 build-vs-buy에 반영하고 Desktop/Web capability matrix를 완성.

## 6. 검증된 기존 결론

다음 내용은 유지해도 된다.

- 세 canonical file/byte/line 수치.
- Rust 73, Figwright 112, exact overlap 71, union 114.
- figmosha parser 12/unique operation 11/helper 20.
- Figwright가 fork base로 가장 적합하다는 판단.
- 세 daemon/plugin을 병렬 운영하지 않는 결정.
- Desktop internal mode 우선.
- public raw executor와 unauthenticated non-loopback 폐기.
- Figwright grounding/serializer/contract/session, Rust export/progress recipe, figmosha doctor/error UX의 상대적 가치.
- code→Figma가 현재 deterministic compiler가 아니라 agent orchestration이라는 평가.
- public distribution은 Figma review/법률 gate 전 출시 금지.

## 7. 최종 판정

04는 비교 자료로 사용할 수 있지만 Figwright 보안 교차리뷰와 현행 official MCP surface를 더 갱신해야 한다. CC BY와 Rust/figmosha absorption 경계는 최신 문서에서 해결됐다. 05는 제품 vision으로는 타당하나 현재 Must/roadmap만으로 바로 구현을 시작하면 범위가 폭증하고 “최대 합집합” 보존 여부를 검증할 수 없다.

Union Feature Manifest, concrete hard gates, 축소된 v0.1 contract를 먼저 반영하면 다음 구현 단계는 명확해진다: **Figwright 기능을 모두 보존한 secure Desktop fork를 만든 뒤 Rust의 두 고유 export semantics와 figmosha doctor/CLI ergonomics를 한 ToolSpec/protocol 안에 흡수한다.** 그 다음 release에서 canonical IR·AST adapters·Web connector를 확장하는 것이 실제 완료 가능성과 합집합 요구를 함께 만족한다.
