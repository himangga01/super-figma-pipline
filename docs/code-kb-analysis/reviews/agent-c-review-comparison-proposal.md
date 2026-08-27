# Agent C 독립 심사 — 상세 비교 / 통합 서비스 제안

> 심사 대상:
>
> - <code>docs/code-kb-analysis/04-detailed-comparison.md</code>
> - <code>docs/code-kb-analysis/05-unified-service-proposal.md</code>
>
> 대조 기준: 세 원본 저장소, 01~03 개별 분석, 전수 inventories, 1차 교차 리뷰, 2026-08-27 Figma 공식 문서  
> 심사자: Agent C (원 Figwright 담당)

## 1. 최종 판정

**Figwright를 구현 출발점으로 선택하는 결론은 조건부 승인할 수 있다.** 세 프로젝트 중 이미 존재하는 design context, component/token/icon grounding, tool/handler contract, session routing을 재구현하지 않는 편이 가장 빠르기 때문이다. Rust와 figmosha2를 별도 server로 병합하지 않고 native packaging/export와 doctor/helper UX만 선별하는 방향도 타당하다.

다만 현재 두 문서는 다음을 수정해야 최종 설계 근거로 쓸 수 있다.

1. “AI 연결까지 로컬”이라는 표현을 model-provider egress 현실에 맞게 고친다.
2. 사용자 최우선 요구인 비용/호출 제약 대체 효과를 현행 공식 MCP와 REST의 **서로 다른** 한도표로 정량화한다.
3. 1차 교차 리뷰에서 드러난 Rust foreign-port forwarding, fast-traversal race, Dev Mode 제약과 figmosha Host factory coupling을 비교표·점수에 반영한다.
4. figmosha UI의 CC BY 4.0 Solar icon을 세 MIT license와 별도로 처리한다.
5. 71개 exact tool-name overlap을 API/schema 호환성으로 오해하지 않게 한다.
6. 가중 점수에서 security/policy를 보상 가능한 소점수로 두지 말고 hard gate로 분리한다.
7. canonical IR, distributed change plan, model trust boundary, fork governance, roadmap success metric을 구체화한다.
8. Community live bridge는 단순 “고위험”보다 공식 review guideline상 **일반적으로 승인하지 않는 유형**임을 더 직접적으로 표시한다.

수치·tool set·가중 합계 산술 자체는 정확했다.

## 2. 독립 재검증

### 2.1 수치와 tool overlap

| 항목 | 문서 값 | 독립 검증 | 판정 |
|---|---:|---:|---|
| Rust commits | 21 | 21 | PASS |
| figmosha commits | 20 | 20 | PASS |
| Figwright commits | 328 | 328 | PASS |
| 추적 파일 | 93 / 15 / 612 | 동일 | PASS |
| bytes | 598,008 / 109,430 / 7,010,446 | 동일 | PASS |
| 물리 라인 | 15,986 / 2,518 / 69,469 | 동일 | PASS |
| Rust tools | 73 | unique 73 | PASS |
| Figwright tools | 112 | unique 112 | PASS |
| exact-name overlap | 71 | 71 | PASS |
| Rust-only | export_tokens, export_frames_to_pdf | 동일 | PASS |
| Figwright-only | 41 | 41 | PASS |

Rust/ Figwright set을 원본 registry에서 다시 추출해 비교했으며 missing/duplicate는 없었다.

### 2.2 가중 점수 산술

가중치는 100으로 합산되고 <code>sum(weight × score / 5)</code>로 계산하면 Rust 47.1, figmosha2 33.6, Figwright 82.3이 정확히 재현된다.

참고로 동일 가중치로 단순 평균을 100점 환산해도 Rust 49.1, figmosha2 40.9, Figwright 75.5여서 core 선택 순서는 유지된다. 따라서 선택 결론은 특정 가중치 하나 때문에 뒤집힌 것은 아니다. 문제는 산술이 아니라 rubric, evidence confidence, hard gate 처리다.

### 2.3 정책 원문

다음 두 주장은 공식 원문으로 확인된다.

- Developer Terms는 API, SDK, MCP server를 Developer Resources로 묶고, integration이 양방향 data flow를 허용해야 한다고 명시한다. Proposal이 이를 “승인 보장 아님”으로 제한한 표현은 정확하다. [Figma Developer Terms](https://www.figma.com/legal/developer-terms/)
- Community guideline은 paid offering workaround 및 plugin을 통한 외부 MCP/programmatic AI access를 일반적으로 승인하지 않는다고 명시한다. 또한 Community plugin이 Figma Web/Desktop을 조작하는 별도 package 설치를 요구할 수 없다고 적는다. [Plugin and widget review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines)

법률 위반을 단정할 수는 없지만 공개 live local-daemon plugin의 review 가능성이 낮다는 제품 판단에는 충분한 공식 근거다.

---

## 3. Finding 요약

| ID | Severity | 대상 | 요약 |
|---|---|---|---|
| CP-01 | High | 비교+제안 | cloud LLM/model provider 경계가 architecture에서 빠져 “AI 연결도 로컬”로 과장 |
| CP-02 | High | 비교+제안 | 우회 우선 요구에 비해 현행 MCP/REST 한도·면제 체계를 정량 기준으로 제시하지 않음 |
| CP-03 | High | 비교 | 1차 교차 리뷰의 Rust/figmosha source-level 위험이 security/reliability 점수에 미반영 |
| CP-04 | Medium | 비교+제안 | figmosha Solar icon CC BY 4.0을 누락하고 “세 프로젝트 모두 MIT”로 단순화 |
| CP-05 | Medium | 비교 | exact-name 71개가 schema/behavior compatible하다는 인상을 줄 수 있음 |
| CP-06 | Medium | 비교 | 점수 rubric·confidence·상관 축이 없고 policy/security veto를 4/10점 축으로 보상 가능하게 처리 |
| CP-07 | High | 비교+제안 | Community public live bridge와 Web feasibility 표현이 공식 guideline보다 낙관적 |
| CP-08 | Medium | 제안 | pairing 외 Host/Origin 기본, secret lifecycle, audit privacy, supply-chain 통제가 모듈 설계에 부족 |
| CP-09 | Medium | 제안 | canonical IR의 version/unknown/mixed/unit/identity/observed-vs-inferred 계약이 부족 |
| CP-10 | Medium | 제안 | Figma+Git 변경을 “transaction”으로 부르지만 cross-system ACID는 불가능; saga 경계 필요 |
| CP-11 | Medium | 제안 | Phase 2/3 범위가 세 framework+양방향 sync로 너무 넓고 Go metric이 비정량 |
| CP-12 | Medium | 제안 | Rust native launcher가 Node core의 Node 설치를 어떻게 제거하는지 packaging 결정이 없음 |
| CP-13 | Medium | 제안 | Figwright fork의 upstream sync/version/runtime ownership 계획 누락 |
| CP-14 | Low | 제안 | figmosha helper 코드를 이식하면 Figwright의 더 강한 binding 구현을 퇴행시킬 위험 |
| CP-15 | Low | 비교 | “typed tools”가 MCP input schema와 end-to-end runtime type safety를 혼동 |

---

## 4. CP-01 — “로컬 AI 연결”은 cloud model 사용 시 성립하지 않는다

**Severity: High / trust-boundary 사실 오류**

Comparison은 가장 현실적인 경로를 “모든 처리와 AI 연결을 로컬로 유지”한다고 쓴다(<code>04-detailed-comparison.md:91</code>). Proposal도 “design data와 source code는 기본적으로 로컬에서 처리”를 목표로 둔다(<code>05-unified-service-proposal.md:40</code>).

세 bridge와 filesystem scan이 local이라는 것은 맞다. 그러나 Claude Code, Codex, Cursor 등 cloud-backed MCP client가 tool result와 source context를 model provider로 보내면 design text, component names, screenshots, code가 machine 밖으로 나간다. Figwright UI가 plugin boundary payload를 보여 주는 것과 model provider에 실제 전달된 final context도 다르다.

Proposal security 표가 <code>data egress</code>를 한 줄 언급하지만(<code>387</code>), architecture diagram에는 Model Provider, context broker, redaction boundary가 없다. “local-first”와 “local-only”도 구분하지 않는다.

**수정안**

Architecture에 다음 경계를 추가한다.

~~~text
Local Orchestrator
   ├─ local-only deterministic analyzers
   ├─ Context/Egress Broker ── approval/redaction/budget ── Cloud Model Provider
   └─ optional Local Model
~~~

제품 mode를 다음처럼 분리한다.

- Local-only: deterministic scan/IR/diff, local model 또는 model 없음.
- Cloud-assisted: 어떤 design/code field가 어느 provider로 전송되는지 preview·consent.
- Enterprise: provider allowlist, zero-retention 계약, payload logging 금지.

Goal 8은 “bridge, source mutation, audit store는 local; model egress는 선택·명시적”으로 고쳐야 한다.

## 5. CP-02 — 비용 우회 효과를 MCP와 REST로 나눠 정량화해야 한다

**Severity: High / 사용자 최우선 요구 반영 부족**

두 문서는 비용 대체 경로를 가장 앞에서 설명하고 stale 숫자를 쓰지 않았다는 점은 좋다. 그러나 “무엇을 얼마나 피하는가”가 정량 기준 없이 quota path 제거로만 남는다. 사용자의 우회 우선 요구를 의사결정·Go metric으로 연결하려면 현재 공식 baseline이 필요하다.

2026-08-27 공식 문서 기준:

- Figma MCP Starter는 6 tool calls/month이며, paid plan의 Dev/Full에는 daily/per-minute limit가 따로 있다. rate limit는 Figma data를 읽는 tool에 적용되고 일부 write tool은 면제다. [MCP rate limits & access](https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions/)
- REST는 MCP와 다른 체계다. endpoint tier, seat, 요청 resource의 plan을 함께 보고, Tier 1의 일부 seat/resource 조합은 up to 6/month이며 다른 조합은 per-minute다. [REST API rate limits](https://developers.figma.com/docs/rest-api/rate-limits/)

따라서 “MCP=20/month” 같은 과거 숫자를 쓰면 안 되고, REST와 MCP를 한 표의 단일 quota처럼 합쳐서도 안 된다.

**수정안**

Comparison section 4와 Proposal Phase 0에 dated baseline table을 추가한다.

| 경로 | 인증 | limit authority | 현재 핵심 제약 | local bridge가 대체 |
|---|---|---|---|---|
| Official MCP | Figma MCP access | plan/seat, read tool calls | Starter 6/month; paid daily/minute; 일부 write exempt | read-heavy grounding 호출 |
| REST | OAuth/PAT/plan token | endpoint tier+seat+resource plan | tier별 monthly/minute | file/node/image/variable REST reads |
| Local Plugin | logged-in user/open file | editor/plugin runtime | edit 권한, open app, payload/CPU | cloud quota 대신 local execution |

Phase 0 benchmark에는 다음을 넣는다.

- 한 화면 grounding에 필요한 official read calls와 local calls.
- calls avoided, wall time, payload bytes, model token, failure rate.
- Starter/paid별 break-even.
- official write 면제를 고려한 read-heavy ROI.
- 공식 limit 변경일과 재확인 일자.

## 6. CP-03 — 1차 교차 리뷰 finding을 비교표와 점수에 반영해야 한다

**Severity: High / source-level 누락**

Comparison security와 reliability 표는 개별 보고서 초안을 기반으로 했고 다음 검증 finding이 아직 반영되지 않았다.

### Rust

1. foreign owner가 <code>/ping</code>에 2xx를 주면 genuine leader로 오인한다. ping이 실패해 role이 Unknown이어도 <code>Node::send</code>는 foreign port에 <code>POST /rpc</code>로 tool params를 보낸다.  
   근거: <code>code-kb/figma-mcp-rust/src/follower.rs:93-111</code>, <code>src/election.rs:52-64</code>, <code>src/node.rs:67-82</code>.
2. <code>skipInvisibleInstanceChildren</code>의 prev/restore는 request queue가 없는 async plugin에서 race한다.  
   근거: <code>plugin/src/main.ts:7-22,35-55,69-101</code>.
3. manifest는 <code>figma</code>와 <code>dev</code>를 허용하지만 editor preflight가 없어 Dev Mode에서 52개 write가 read-only error로 실패한다.  
   근거: <code>plugin/manifest.json:12-14</code>, <code>figma.editorType</code> check 0개.

현재 Comparison의 Rust P0/P1 목록(<code>238</code>)과 editor/reliability 점수에는 이들이 없다.

### figmosha2

<code>ALLOWED_HOSTS</code>는 default empty일 때 Host check를 끄고, <code>build_app()</code>은 값을 설정하지 않으며 CLI <code>main()</code>만 채운다. Proposal이 Origin/Host guard를 재사용할 때 factory를 그대로 가져오면 DNS-rebinding gate가 꺼진다.  
근거: <code>code-kb/figmosha2/bridge.py:29-32,51-56,321-348</code>.

세부 review: <code>docs/code-kb-analysis/reviews/agent-c-review-rust-figmosha.md</code>.

**수정안**

- Comparison security/reliability/editor 표와 score evidence를 갱신한다.
- Rust bridge/election은 “아이디어만 채택, 구현 재사용 금지”로 격상한다.
- figmosha guard는 safe factory로 다시 작성하는 조건을 채택 표에 추가한다.

## 7. CP-04 — figmosha2에는 CC BY 4.0 자산이 포함된다

**Severity: Medium / 라이선스 사실 누락**

Comparison은 세 프로젝트 license를 모두 MIT로 표시하고(<code>30,299</code>), Proposal Phase 0/License gate는 “세 MIT notice”만 요구한다(<code>465,578</code>).

그러나 figmosha plugin UI에는 Solar icon SVG path가 source로 embedded되어 있으며 code comment와 CHANGELOG가 480 Design, CC BY 4.0이라고 명시한다.

- <code>code-kb/figmosha2/plugin/ui.html:38-44</code>.
- <code>code-kb/figmosha2/CHANGELOG.md:72-75</code>.

**수정안**

- License 표를 “code license MIT + bundled third-party assets”로 분리한다.
- <code>THIRD_PARTY_NOTICES</code>에 creator, source, CC BY 4.0 link, modification 여부를 남긴다.
- source comment가 minification/package에서 사라져도 npm/plugin UI/docs artifact에 attribution이 남는지 test한다.
- Phase 0 deliverable을 “3 MIT notices + CC BY notice + dependency SBOM”으로 고친다.

## 8. CP-05 — exact-name overlap은 API compatibility가 아니다

**Severity: Medium / tool overlap 해석 위험**

71/73 exact-name 수치는 정확하다(<code>04-detailed-comparison.md:124-140</code>). 하지만 이름이 같아도 input, output, validation, semantics가 다르다.

예:

| name | Rust | Figwright |
|---|---|---|
| set_fills | <code>nodeId+color+opacity+mode</code> | <code>nodeId+fills[]</code>, gradient/binding schema |
| create_component | existing FRAME <code>nodeId</code> 변환 | empty create 또는 <code>fromNodeId</code>, parent/position/size |
| get_design_context | <code>dedupe_components</code> snake_case, plugin bug | <code>dedupeComponents</code>, full guard/section plan |
| delete_variable | variableId 또는 collectionId | variableId만; collection은 별도 tool |

근거:

- <code>code-kb/figma-mcp-rust/src/tools/definitions.rs:592-600,774-817,1159-1166</code>.
- <code>code-kb/figwright/packages/mcp/src/tools/get-design-context.ts:46-64</code>, <code>set-fills.ts:16-20</code>, <code>create-component.ts:15-32</code>, <code>delete-variable.ts:13-15</code>.

Rust prompt catalog를 Figwright recipe로 가져올 때 exact name만 보고 재사용하면 schema-invalid call이나 다른 결과 해석이 생긴다.

**수정안**

- “exact name overlap”을 “lexical overlap”으로 명명한다.
- overlap마다 input/output/side-effect semantic compatibility를 <code>same / adapter / incompatible</code>로 분류한다.
- Prompt import에는 tool-schema compile/eval test를 둔다.

## 9. CP-06 — 점수는 정확하지만 gate와 evidence rubric이 없다

**Severity: Medium / 의사결정 방법론**

82.3 계산은 정확하고 equal-weight에서도 Figwright가 1위라 core 선택은 robust하다. 그러나 현재 표는 다음 이유로 정밀도가 과장된다.

1. 0~5 anchor가 없다. “5=source가 있음”, “5=CI test”, “5=live production acceptance” 중 무엇인지 알 수 없다.
2. 세 프로젝트 모두 full build/live Figma test를 이번 조사에서 실행하지 못했는데 0.1점 단위 결과가 나온다.
3. read fidelity, grounding, test confidence, maintainability가 상관돼 Figwright의 같은 자산을 여러 축에서 중복 보상한다.
4. public policy fit은 4%, security는 10%라 다른 장점으로 상쇄된다. 하지만 public release rejection과 P0 security failure는 compensable preference가 아니라 gate다.
5. score는 “어떤 codebase를 fork할지”와 “어떤 배포 mode가 출시 가능한지”를 한 표에서 섞는다.

**수정안**

- 먼저 hard gate: license notices, no unauthorized access, secure local pairing, live Desktop acceptance, policy mode.
- 통과한 후보에만 weighted utility score.
- 0~5 rubric과 evidence grade <code>A=live, B=automated, C=static, D=claim</code>를 각 cell에 붙인다.
- score range/sensitivity를 제시하고 82.3을 “reuse utility estimate”로 명명한다.
- fork choice score와 connector deployment score를 분리한다.

## 10. CP-07 — Community live bridge는 “일반적으로 미승인”을 기본 가정으로 둬야 한다

**Severity: High / 정책·Web feasibility**

Comparison과 Proposal은 Community public live MCP bridge를 “기술적으로 가능, 출시 위험 매우 높음”으로 표현한다(<code>04:316</code>, <code>05:61</code>). 신중한 문장이지만 현행 official guideline은 더 직접적이다.

- official MCP 밖 programmatic AI access 또는 plugin을 통한 MCP server 노출은 일반적으로 승인하지 않는다.
- plugin/widget은 Figma Web/Desktop을 조작하는 별도 package 설치를 요구할 수 없다.
- paid offering workaround도 승인하지 않을 수 있다.
- file read/write는 explicit awareness/consent가 필요하다.

[Plugin and widget review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines)

Local daemon을 요구하는 public live bridge는 위 두 조건에 동시에 걸릴 가능성이 높다. 이는 불법 단정이 아니라 공개 review product-fit 판단이다.

**수정안**

- Community live mode를 roadmap option이 아니라 “explicit written exception/review 승인 없이는 비목표”로 표시한다.
- Mode C artifact exchange와 Mode D official connector를 실제 public default로 둔다.
- Mode B private plugin은 Community review와 분리하되 Developer Terms, org plan/admin policy를 적용한다.
- Web feasibility spike에 HTTPS page→localhost <code>ws://</code>, mixed content, browser private-network rules, manifest network policy를 포함한다.
- “technically possible”은 runtime prototype에만 쓰고 distribution viability와 분리한다.

Proposal의 bidirectional Developer Terms 해석은 원문과 일치하며, 이 제한을 상쇄하는 승인 근거로 쓰지 않은 점은 유지해야 한다.

## 11. CP-08 — security 설계에 trust-store와 supply chain을 추가해야 한다

**Severity: Medium / 설계 누락**

Proposal security controls는 강하지만 다음이 빠지거나 test 항목에만 있다.

1. Host/Origin/DNS-rebinding gate가 mandatory control table에는 없고 test list에만 있다(<code>05:374-387,427</code>). Pairing secret과 별개로 defense-in-depth 구현 항목이어야 한다.
2. pairing secret 생성은 있으나 storage, display, rotation, expiry, reconnect/session binding, file identity binding이 없다.
3. same-user malware/privileged process는 pairing으로 방어할 수 없다는 threat-model 경계가 없다.
4. SQLite/JSON mapping과 audit에는 design/code metadata가 들어가는데 encryption, retention, delete/export, backup privacy가 없다.
5. “append-only local log”는 tamper-evident가 아니다. hash chain/signature 또는 단순 operational audit인지 명명해야 한다.
6. plugin zip/native launcher/npm artifact의 signing, checksum, update channel, pinned CI action이 없다.
7. least-privilege manifest profile과 Dev Mode read-only preflight가 없다.

**수정안**

Security module 표에 다음을 추가한다.

- Host/Origin/PNA gate.
- Secret vault/clientStorage policy와 short expiry.
- session ID + file/page/editor/capability binding.
- local store encryption/retention.
- artifact signing/SBOM/provenance.
- read-only/write manifest capability matrix.
- explicit out-of-scope: compromised same-user account.

## 12. CP-09 — canonical IR는 loss semantics와 identity contract가 더 필요하다

**Severity: Medium / core architecture**

IR 필드 목록은 포괄적이지만(<code>05:228-259</code>) stable canonical contract에 필요한 다음 항목이 없다.

- schema version과 migration policy.
- <code>unset</code>, <code>mixed</code>, <code>unsupported</code>, <code>not-loaded</code>, <code>omitted-by-budget</code>의 구분.
- source-observed 값과 model-inferred semantic 값의 분리.
- connector-specific unknown/raw extension 보존.
- coordinate space, transform matrix, precision, px/rem/percent와 color-space normalization.
- Figma copied/recreated node, library component key, code rename/move에 대한 stable identity.
- binary asset을 inline하지 않는 content-addressed external reference.
- dual baseline: Git commit/tree hash + Figma snapshot/session/version.
- deduped LLM view와 lossless persisted snapshot의 분리.

Figwright <code>get_design_context</code>는 LLM context를 위한 lossy/deduped view이지 그 자체가 canonical round-trip IR이 아니다. Proposal은 adapter를 신설한다고 했으므로 이 차이를 schema 원칙으로 고정해야 한다.

**수정안**

IR envelope 예:

~~~text
schemaVersion
connector + capabilityVersion
observedGraph
inferences[] {value, evidence, confidence}
extensions {figmaRaw...}
fidelity {omitted, unsupported, truncated}
snapshotIdentity {figmaHash, gitTree, capturedAt}
~~~

Canonical store에서 full snapshot을 유지하고 MCP에는 budgeted view를 projection한다.

## 13. CP-10 — cross-system “transaction” 대신 durable saga로 정의해야 한다

**Severity: Medium / 신뢰성 tradeoff**

Proposal은 Change Planner와 transaction을 precondition/capture/apply/inverse/post-verify로 설명하고 partial 상태도 명시한다(<code>149,295,382</code>). 방향은 좋다. 그러나 Figma document와 Git working tree 사이에 공통 ACID transaction은 없다.

- Figwright batch가 지원하는 inverse는 30개 operation뿐이다.
- delete/detach/variable/style/component operations 일부는 faithful inverse가 없다.
- plugin disconnect/timeout 뒤 mutation이 늦게 끝날 수 있다.
- source patch는 Git/worktree로 rollback 가능하지만 Figma API commit과 원자적으로 묶을 수 없다.
- Figma long-running plugin의 <code>commitUndo</code> boundary도 별도로 관리해야 한다.

**수정안**

“transaction”을 durable saga/change set으로 정의한다.

1. optimistic precondition hashes.
2. source worktree patch.
3. Figma operation journal with idempotency keys.
4. supported inverse/compensation class.
5. per-plan <code>figma.commitUndo()</code>.
6. post-read reconciliation.
7. partial/unknown state와 resume/repair command.

UI도 “atomic”과 “compensatable”을 구분해야 한다.

## 14. CP-11 — Phase 2/3 범위와 Go metric을 줄여야 한다

**Severity: Medium / roadmap risk**

Phase 2는 React/Vue/Svelte grounding+AST patch+build/test/render를, Phase 3은 세 framework의 code→Figma adapter+staging+semantic preservation+3-way sync를 한 phase에 둔다(<code>05:486-513</code>). 이는 각각 독립 제품 수준 작업이다.

Go condition도 “재사용률과 fidelity 목표 충족”처럼 목표값이 없다(<code>498</code>).

**수정안**

- Phase 2A: React + Tailwind/CSS Modules, Figma→existing code only.
- Phase 2B: Vue, 이후 Svelte.
- Phase 3A: code tokens/styles/assets→Figma.
- Phase 3B: one framework component instance/property mapping.
- Phase 3C: layout/screens and 3-way conflict.

각 phase metric:

- component mapping top-1 precision/coverage.
- token mapping false-positive rate.
- existing asset reuse rate.
- pixel/layout/text discrepancy.
- manual corrections per screen.
- source diff size and test pass rate.
- Figma partial-write/unknown-state rate.
- official calls avoided and local latency/payload.
- security approval bypass count=0.

## 15. CP-12 — Rust launcher가 Node 설치를 줄이는 방식이 정의되지 않았다

**Severity: Medium / packaging tradeoff**

Proposal은 Rust의 6-platform launcher를 “Node 설치 문제를 줄이는 bootstrapper”로 채택 후보에 둔다(<code>157</code>). 원본 Rust launcher는 Rust server binary를 선택해 실행한다. TypeScript Figwright core를 실행하는 generic native bootstrapper가 아니다.

Node requirement를 실제 제거하려면 다음 중 하나를 선택해야 한다.

1. Node runtime과 JS bundle을 native package에 embed.
2. Rust daemon이 core 기능을 담당하고 Node grounding worker를 bundle.
3. Bun/single executable 계열로 package.
4. Node는 유지하고 Rust는 installer/updater만 담당.

1~3은 binary size, CVE patch, code signing/notarization, auto-update, cross-platform testing 부담을 만든다. 4는 Node 설치 문제를 제거하지 않는다.

**수정안**

Phase 0/1에서 packaging ADR을 작성하고 startup/install telemetry로 Rust 필요성을 측정한다. Windows/macOS code signing과 plugin/server version lockstep도 포함한다.

## 16. CP-13 — Figwright fork governance와 runtime baseline이 필요하다

**Severity: Medium / 유지보수 누락**

Core 선택은 합리적이지만 fork 운영 계획이 없다.

현재 분석 snapshot은 package 0.4.0이면서 tag 이후 33 commits이고, compatibility floor는 0.5.0을 향한다. Node public engine은 20/22를 주장하지만 build/CI target은 Node24다. Plugin typings과 MCP SDK는 계속 변한다.

**수정안**

- upstream remote와 patch queue/rebase cadence.
- fork version namespace와 plugin/server compatibility policy.
- Node runtime support ADR와 CI matrix.
- Figma typings/MCP SDK audit ownership.
- upstream security patch intake SLA.
- forked MIT/third-party notice automation.
- plugin manual update/migration UX.

Phase 1 deliverable에 “reproducible upstream baseline + fork governance”를 추가한다.

## 17. CP-14 — figmosha helper는 UX만 흡수하고 구현은 Figwright를 우선해야 한다

**Severity: Low / 중복·퇴행 위험**

Proposal은 <code>bF/bS/bN</code>, fonts, frame helper를 handler utility로 이식한다(<code>05:174-180</code>). 그러나 Figwright에는 이미 다음이 있다.

- variable existence/type을 확인하는 paint/effect/grid/text binding.
- mixed/range font 처리.
- placement, auto-layout, style/variable write handlers.
- projection/variable-binding coverage tests.

figmosha helper는 간결하지만 type validation과 mixed-font 지원이 더 약하다.

**수정안**

figmosha에서는 names, doctor UX, concise error messages, test cases만 가져오고 implementation authority는 Figwright handler로 둔다. 별도 helper duplicate를 만들지 말고 MCP/CLI alias가 동일 ToolSpec/handler를 호출하게 한다.

## 18. CP-15 — “typed”의 범위를 input schema로 제한해야 한다

**Severity: Low / 용어 과장**

Comparison은 Rust를 typed bridge, Figwright를 112 typed tools/typed write라고 반복한다(<code>04:38-47,182-195</code>).

- Rust server 내부는 강타입이지만 tool params는 loose JSON map이고 plugin은 <code>strict:false</code>/<code>any</code>다.
- Figwright input은 Zod/MCP schema지만 plugin handler params와 많은 result는 cast/unknown이며 runtime result validation 공백이 있다.

**수정안**

“schema-advertised MCP inputs”, “typed ToolSpec inputs”, “end-to-end result type는 미완성”으로 구분한다.

---

## 19. 잘된 부분 — 유지할 것

다음 판단은 사실·tradeoff와 잘 맞으므로 유지해야 한다.

1. 세 server를 동시에 묶지 않고 Figwright fork 하나로 시작한다.
2. Desktop internal single-user/editable Design file을 첫 mode로 둔다.
3. Figma→legacy code를 code→Figma보다 먼저 production화한다.
4. raw JavaScript는 public build에서 제거한다.
5. Web/public을 separate gate로 두고 artifact/official connector fallback을 둔다.
6. per-file queue, in-flight idempotency, workspace sandbox, approval, post-read verification을 Phase 1에 둔다.
7. section plan, mapping ambiguity, staging, 3-way conflict를 명시한다.
8. live Figma acceptance matrix를 Windows/macOS와 editor/access별로 둔다.
9. Developer Terms의 bidirectional clause를 승인 보장으로 오해하지 않는다.
10. 정책 변경 가능성을 인정하고 release 전 재확인을 요구한다.

## 20. 수정 우선순위

### Must fix before finalization

1. CP-01 model egress/local claim.
2. CP-02 current MCP vs REST baseline and ROI metrics.
3. CP-03 cross-review source risks.
4. CP-04 CC BY third-party notice.
5. CP-05 lexical overlap vs semantic compatibility.
6. CP-06 hard gates vs weighted score.
7. CP-07 public live bridge wording.

### Must fix before implementation

8. CP-08 security trust-store/supply chain.
9. CP-09 IR loss/identity contract.
10. CP-10 saga semantics.
11. CP-11 narrower phase metrics.
12. CP-12 packaging ADR.
13. CP-13 fork governance.

## 21. 최종 권고

**Core choice: 승인. 현재 점수표를 product readiness로 사용하는 것: 불승인. Desktop internal Phase 0/1로 진행: 승인. Public/Community live bridge를 예상 출시 경로로 두는 것: 명시적 Figma 예외/승인 전에는 불승인.**

문서가 위 finding을 반영하면 다음과 같은 더 정확한 한 줄 제안이 된다.

> Figwright의 grounding/contract 자산을 fork해 secure local Desktop connector와 Figma→code MVP를 만들고, cloud model egress를 명시적으로 통제하며, Rust에서는 packaging/export 개념을, figmosha에서는 doctor/helper UX와 attribution을 선택적으로 흡수한다. Public/Web은 official policy와 browser acceptance를 통과한 connector 또는 explicit artifact exchange로만 확장한다.

