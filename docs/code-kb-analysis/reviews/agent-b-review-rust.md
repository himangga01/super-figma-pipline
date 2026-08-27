# Agent B 교차 리뷰 — figma-mcp-rust 분석 보고서

> 리뷰 대상: `docs/code-kb-analysis/01-figma-mcp-rust-analysis.md` 및 `inventories/figma-mcp-rust-file-inventory.md`  
> 원본 기준점: `code-kb/figma-mcp-rust` @ `6094566436577b29d04393c774d51492c12671e1` (`v0.2.0`)  
> 리뷰 시점: 2026-08-27 (Asia/Seoul)  
> 리뷰 원칙: 원 보고서는 수정하지 않고, 원본 93개를 다시 읽어 주장·수치·집합·실행 의미를 독립 대조

## 1. 총평

Agent A 보고서는 전반적으로 강하다. 파일 인벤토리, 73개 tool 표면, 12 prompt/13 skill, stdio→leader/follower→WebSocket→plugin 흐름, `dedupe_components` 결함, unauthenticated transport, stale WebSocket, schema drift, 부분 serializer, code generator 부재, 테스트 공백을 정확하게 잡았다. 특히 “MIT 소스 라이선스와 Figma platform 권한은 별개”이고 “Plugin API adapter일 뿐 design↔code 완성품은 아니다”라는 결론은 유지해야 한다.

다만 **중앙 비용 주장과 plugin 동시성에는 반드시 보강할 high finding 두 건**이 있다. 또한 election peer 신뢰, follower payload limit, typography blind spot, ungroup 순서, 배포 정책 표현에서 medium 수정이 필요하다. 인벤토리의 93개 개별 수치에는 오류를 찾지 못했다.

## 2. Finding 요약

| ID | Severity | 영역 | 결론 |
|---|---|---|---|
| H-1 | HIGH | 비용·호출 제약 | README가 REST 설명과 공식 MCP의 월간·일간 tool-call limit를 한 표처럼 섞어 제시하는데 보고서가 두 체계를 분리하지 않았다. |
| H-2 | HIGH | plugin 동시성 | 전역 `skipInvisibleInstanceChildren`의 save/set/restore는 동시 fast request에서 원래 값과 다르게 남을 수 있고 write를 실패시킬 수 있다. 단순 queue 부재보다 구체적인 correctness bug다. |
| M-1 | MEDIUM | election/보안 | follower는 `/ping` body/version을 읽지 않고 임의 2xx를 leader로 신뢰하며 `Role::Unknown`도 같은 `/rpc`로 forwarding한다. |
| M-2 | MEDIUM | transport/확장성 | Axum `Json<RpcRequest>` 기본 body limit를 올리지 않아 follower의 큰 `import_image`/text 요청은 약 2 MiB에서 막힐 수 있다. 100 MiB WS limit와 별개다. |
| M-3 | MEDIUM | read/schema/prompt | `get_fonts`가 mixed-font TEXT를 통째로 빼고, compact context는 fontSize/textStyle을 반환하지 않아 두 typography workflow prompt가 그대로 수행되지 않는다. |
| M-4 | MEDIUM | write fidelity/test | `ungroup_nodes`가 모든 child를 같은 index에 삽입해 실제 sibling order를 뒤집는다. mock test는 index를 무시해 결함을 가린다. |
| M-5 | MEDIUM | 정책·배포·재사용 | policy 절의 방향은 맞지만 current `can edit`/seat/one-plugin 조건과 Community의 official-MCP-external AI access 문구를 정확히 쓰고, “very high reuse”를 internal/private에 한정해야 한다. |
| L-1 | LOW | 재현성 | tool parity “재현 명령”이 실행 code가 아니라 주석뿐이고 strict UTF-8 claim도 제시 command로는 엄격 decode를 재현하지 않는다. |
| L-2 | LOW | 정량 표현 | “`any` token 168회”는 Svelte 주석의 영어 단어 `any`까지 포함한 lexical count다. type-safety 지표로 쓰려면 AST/type-position count가 필요하다. |
| L-3 | LOW | prompt 정합성 | color palette prompt가 “9-step”이라면서 50, 100…900의 10개 step을 열거한다. |

## 3. 상세 Finding

### H-1. REST API와 공식 MCP rate limit를 분리하지 않아 핵심 비용 설명이 불완전하다

**문제**

README는 “Most Figma MCP servers rely on the Figma REST API” 다음에 `Starter / View / Collab = 6 tool calls/month`, `Pro / Org = 200/day`, `Enterprise = 600/day`를 한 표에 둔다 (`code-kb/figma-mcp-rust/README.md:28-43`). 그런데 이 수치는 한 종류의 REST rate-limit 표가 아니다.

- 현재 공식 REST API limit는 endpoint tier·seat·resource plan의 조합으로 정의된다. [Figma REST API rate limits](https://developers.figma.com/docs/rest-api/rate-limits/).
- 공식 Figma MCP는 별도의 plan/seat별 월간·일간·분당 tool-call 표를 사용한다. 수치는 변경될 수 있으므로 출시 시점의 표를 직접 인용해야 한다. [Figma MCP rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/).

Agent A는 “이 구현은 REST도 공식 MCP도 호출하지 않는다”는 올바른 결론을 냈지만 (`docs/code-kb-analysis/01-figma-mcp-rust-analysis.md:60-91`), README 표의 **서로 다른 limit 체계 혼합**을 명시하지 않았다. 사용자 요청에서 비용·호출 제약 대체가 최우선이므로 이 누락은 high다.

**정확한 수정 방향**

1. REST API rate limits, official Figma MCP tool limits, Figma AI credits를 서로 다른 비용 표면으로 분리한다.
2. figma-mcp-rust가 code상 호출하는 공식 REST/MCP endpoint 수는 0이라고만 확정한다 (`src/leader.rs:55-59`, `plugin/src/ui/App.svelte:27-72`).
3. “no rate limits/free”가 local CPU·memory·WebSocket payload·Figma Plugin API·seat·file permission·LLM token 비용까지 없다는 의미는 아니라고 명시한다.
4. 외부 수치에는 확인일 2026-08-27과 “Figma가 변경할 수 있음”을 붙인다.

### H-2. `skipInvisibleInstanceChildren` 복원은 동시 요청에서 안전하지 않다

**보고서의 현재 표현**

보고서는 FAST traversal에서 flag를 “일시 활성화하고 원래 값으로 복원”한다고 읽기 강점으로 적고, 뒤에서 plugin queue 부재를 일반적인 write interleaving 위험으로만 언급한다 (`01-figma-mcp-rust-analysis.md:322-325,501-505`).

**실제 race**

`handleRequest`는 global Figma flag를 읽고, fast tool이면 true로 바꾸고, async handler를 await한 뒤 이전 값으로 돌린다 (`code-kb/figma-mcp-rust/plugin/src/main.ts:35-55`). `figma.ui.onmessage`는 incoming request마다 이 async 함수를 시작하며 serial queue가 없다 (`plugin/src/main.ts:69-101`).

초기 값이 false일 때 다음 interleaving이 가능하다.

1. Request A: `prevSkip=false`, flag=true.
2. Request B: `prevSkip=true`, flag=true.
3. A 완료: flag=false.
4. B 완료: flag=true.

최종 값은 원래 false가 아니라 true다. 또 fast read가 await 중일 때 write가 hidden instance child를 `getNodeByIdAsync`로 찾으면 comment가 경고한 대로 null/접근 실패가 날 수 있다 (`plugin/src/main.ts:7-12`). `get_local_components`처럼 page를 순회하고 yield하는 작업은 race window도 길다 (`plugin/src/read-styles.ts:89-126`).

**정확한 수정 방향**

- 이 항목을 high correctness defect로 승격한다.
- plugin main에 FIFO/single-writer queue를 두거나 최소한 이 global flag를 reference-count/generation-aware scope로 관리한다.
- 동시 fast+fast 및 fast+write test에서 최종 flag와 hidden-node write를 검증한다.
- `clearStyleCache()`도 global이지만 주된 영향은 duplicate lookup/성능이고, flag race와 구분한다 (`plugin/src/serializers.ts:5-23`).

### M-1. leader election은 peer identity와 version을 검증하지 않는다

**문제**

leader는 `/ping`에서 `{status:"ok", version}`을 반환한다 (`code-kb/figma-mcp-rust/src/leader.rs:88-99`). 그러나 follower의 `ping()`은 body를 전혀 읽지 않고 HTTP status가 success인지 만 본다 (`src/follower.rs:93-111`). 따라서 다음이 가능하다.

- 같은 port에서 `/ping`에 임의 2xx를 주는 unrelated/malicious process를 leader로 오인.
- 서로 다른 figma-mcp-rust version 사이 schema/protocol mismatch를 감지하지 못함.
- 초기 bind 실패 후 role이 `Unknown`이어도 `Node::send`는 explicit error가 아니라 follower `/rpc`로 fall through (`src/election.rs:52-65`, `src/node.rs:67-82`). 건강성도 확인되지 않은 port occupant에 text/image/tool params를 보낼 수 있음.

보고서는 port 점유 시 Unknown과 unauthenticated endpoints를 각각 지적했지만 (`01-figma-mcp-rust-analysis.md:161-165,423-447`), 이 client-side trust 연결을 빠뜨렸다.

**수정 제안**

- ping JSON의 service name, protocol version, build version을 검증한다.
- ephemeral local secret 또는 OS IPC peer credential을 요청마다 확인한다.
- `Role::Unknown`은 proxy하지 말고 명시적인 unavailable error를 반환한다.
- incompatible version leader를 발견하면 사용자에게 port/version 충돌을 보고한다.

### M-2. follower `/rpc`에는 약 2 MiB JSON body ceiling이 남는다

**문제**

`/ws`에는 100 MiB message/frame limit를 명시했지만 (`code-kb/figma-mcp-rust/src/leader.rs:101-113`), `/rpc`는 `Json<RpcRequest>` extractor만 쓰고 `DefaultBodyLimit` override가 없다 (`src/leader.rs:55-59,116-119`). Axum의 `Json`/`Bytes` 계열 기본 request-body limit는 2 MiB다. [Axum DefaultBodyLimit documentation](https://docs.rs/axum/0.7.9/axum/extract/struct.DefaultBodyLimit.html).

그 결과 leader process의 MCP client가 직접 WS를 쓰면 큰 `import_image.imageData`를 보낼 수 있지만, follower process는 동일한 call을 JSON `POST /rpc`로 보내므로 base64 payload가 약 2 MiB를 넘으면 413/rejection될 수 있다 (`src/follower.rs:45-66`; `plugin/src/write-create.ts:85-103`). 보고서의 “multiple MCP clients support” 및 100 MiB 설명에는 이 role-dependent 비대칭이 없다.

**수정 제안**

- 성능/transport 절에 이 ceiling과 영향 tool을 기록한다.
- 인증·quota를 먼저 추가한 뒤 bounded limit를 의도적으로 설정한다. 무조건 100 MiB로 올리는 것은 unauthenticated memory DoS를 키운다.
- 장기적으로 image/binary는 local file capability 또는 streaming channel로 분리한다.

### M-3. typography reader와 compact prompt 사이에 보고되지 않은 두 blind spot이 있다

**(a) mixed-font 누락**

`get_fonts`는 TEXT node의 `fontName`이 symbol/`figma.mixed`이면 그 node를 통째로 건너뛴다 (`code-kb/figma-mcp-rust/plugin/src/read-document.ts:273-286`). 따라서 README의 “All fonts used”와 보고서 도구 표의 “현재 page fonts”는 mixed-range typography를 포함하지 않는다 (`README.md:225`; `01-figma-mcp-rust-analysis.md:220`). `getRangeAllFontNames` 같은 range-aware 수집이 필요하다.

**(b) compact에는 fontSize/textStyle이 없음**

compact path는 `serializeStyles(n)` 후 바로 반환한다 (`plugin/src/read-document.ts:61-70`). `serializeStyles`는 fills/strokes/corner/padding/effects만 다루고, textStyle/fontSize/fontFamily는 `serializeText`에서만 추가된다 (`plugin/src/serializers.ts:120-165,184-220`).

따라서 다음 prompt 주장은 그대로 수행되지 않는다.

- `design_token_generation_strategy`는 compact scan에서 fontSize를 모으라고 함 (`prompts/design_token_generation_strategy.md:10-17`).
- `style_audit_strategy`는 compact에서 raw font와 textStyle linkage를 검사하라고 함 (`prompts/style_audit_strategy.md:12-17`).

Agent A가 prompt의 depth·spacing·raw fill 문제는 잡았지만 (`01-figma-mcp-rust-analysis.md:301-316`), typography field 자체가 없는 점은 누락했다.

**수정 제안**

- tool/read limitation과 두 prompt row에 이 결함을 추가한다.
- compact TEXT에 textStyle/fontSize/fontFamily 최소 필드를 넣거나 별도 typography scan tool을 만든다.
- prompt는 수정 전까지 `detail="full"` 또는 dedicated tool을 사용하도록 바꾼다.

### M-4. `ungroup_nodes`가 child 순서를 뒤집고 unit test가 이를 검출하지 못한다

**문제**

plugin은 group의 원래 parent index를 한 번 계산한 뒤 모든 child를 그 **같은 index**에 차례로 insert한다 (`code-kb/figma-mcp-rust/plugin/src/write-components.ts:97-115`). 실제 insert semantics에서는 다음 child가 앞 child보다 앞에 들어가므로 `[A,B,C]`가 `[C,B,A]`로 뒤집힌다.

테스트 mock의 `insertChild`는 index를 무시하고 단순 `push`하므로 결과 order를 검증하지 않는다 (`plugin/src/write-components.test.ts:119-140`). 보고서는 이 test군을 검증된 영역으로 분류하고 tool 표에는 단순 “children 이동”으로만 적었다 (`01-figma-mcp-rust-analysis.md:291,463-468`).

**수정 제안**

- insertion index를 child마다 증가시키거나 안전한 역순 insertion을 사용한다.
- mock이 실제 index semantics를 구현하게 하고 parent.children 최종 순서를 assert한다.
- code↔design fidelity 관점의 known defect로 medium 표시한다.

### M-5. policy/access 절과 integration reuse 등급을 배포 형태별로 더 정확히 나눠야 한다

Agent A는 MIT와 platform policy를 구분하고 “license bypass” marketing을 경계했다. 방향은 옳다. 다만 `심사할 수 있다`라는 표현은 현재 공개 Community 배포 위험을 다소 약하게 전달하고, exact seat/edit 조건도 본문에 없다 (`01-figma-mcp-rust-analysis.md:87-91`).

2026-08-27 기준 공식 문서상:

- Community guideline은 paid offering workaround를 승인하지 않을 수 있고, official MCP 밖의 programmatic AI access를 일반적으로 승인하지 않는다고 밝히며 Figma API sublicensing/distribution도 제한한다. [Plugin and widget review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines).
- plugin 가능 product는 seat별로 다르며 Figma Design에서 plugin을 쓰는 seat가 제한된다. [Use plugins in files](https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files).
- design file에서 plugin 사용에는 `can edit`가 필요하다고 공식 inspection guide가 명시한다. [Guide to inspecting](https://help.figma.com/hc/en-us/articles/22012921621015-Guide-to-inspecting).
- plugin은 manual run, one-at-a-time 제약이 있다. 이 저장소는 `figma.closePlugin()` 없이 UI를 계속 열어 bridge를 유지한다 (`plugin/src/main.ts:58-102`).

따라서 “Figma plugin main↔UI↔local WS pattern — 재사용 가치 매우 높음”은 **internal development/sideloaded 또는 적법하게 승인된 private deployment**에 한정해야 한다 (`01-figma-mcp-rust-analysis.md:563-578`). Community/public SaaS 경로는 기술 가치와 별개로 high policy risk이며 Figma 확인 전 채택 대상으로 표현하면 안 된다.

### L-1. 핵심 set 정합성 명령이 실제로 재실행 가능하지 않다

보고서 20절은 registry/plugin/README/Glama 집합을 비교하라고 주석으로만 적고 실제 extraction code를 제공하지 않는다 (`01-figma-mcp-rust-analysis.md:609-640`). inventory의 마지막 절도 같은 개념 주석뿐이다. 73/72/58은 중요한 release invariant이므로 실제 PowerShell 또는 repository script를 남겨야 한다.

또 inventory는 엄격 UTF-8 decode를 주장하지만 제시한 `[IO.File]::ReadLines(path)`는 replacement fallback 없는 strict decoder를 명시하지 않는다. `UTF8Encoding(false, true)`를 사용한 command를 제시하면 된다.

### L-2. `any` 168회는 type-position count가 아니다

`rg -o '\bany\b' plugin/src -g '!*.test.ts'` 방식의 168에는 `App.svelte:124`의 “Cancel any pending reconnect”처럼 자연어 comment도 포함된다. `strict:false` 자체와 광범위한 `request:any` 사용은 유효한 기술부채지만 (`plugin/tsconfig.json:2-10`), 숫자는 AST/type-position 기준으로 다시 세거나 삭제하는 편이 정확하다 (`01-figma-mcp-rust-analysis.md:114-118`).

### L-3. palette prompt의 step 수가 내부 모순이다

`generate_color_palette.md`는 9-step scale이라고 한 뒤 50, 100, 200, 300, 400, 500, 600, 700, 800, 900의 **10개** 값을 열거한다 (`code-kb/figma-mcp-rust/prompts/generate_color_palette.md:1-27`). prompt/skill을 integration recipe로 재사용하기 전에 이름과 산출 개수를 맞춰야 한다.

## 4. 독립 재검증 결과 — 수정 불필요

| 검증 항목 | 결과 | 근거/방법 |
|---|---|---|
| 기준점 | `6094566436577b29d04393c774d51492c12671e1`, `v0.2.0`, `main` | local Git |
| 파일 수/총계 | 93 files, 598,008 bytes, 15,986 physical, 14,200 nonblank | `git ls-files` + strict UTF-8 per-file recount |
| 인벤토리 93행 | 경로·개별 physical/nonblank/bytes 불일치 0 | Markdown table parse 후 원본과 row compare |
| 해시 | 서로 다른 SHA-256 93개 | local `Get-FileHash` |
| tool registry | unique 73 | `src/tools/definitions.rs:11-542` |
| README tool set | registry 73과 일치 | README Available Tools set compare |
| plugin direct cases | registry tool 중 72; `save_screenshots`만 plugin direct case 없음 | plugin non-test handler case set compare |
| special handlers | 2: `save_screenshots`, `export_frames_to_pdf` | `src/tools/definitions.rs:150-163` |
| Glama | 58, report의 누락 15개 목록 정확 | `glama.json:7-65` set difference |
| prompt/skill | MCP prompt 12, skill 13; 대응 12개 body normalize 후 차이 0 | `src/prompts.rs:18-78`, `prompts/*`, `skills/*` |
| dedupe bug | snake `dedupe_components` vs camel `dedupeComponents` 확인 | `definitions.rs:592-600`, `read-document.ts:52-59` |
| transport | stdio, leader/follower `/ping`/`/rpc`, active WS sink 하나 | `src/main.rs`, `election.rs`, `leader.rs`, `bridge.rs` |
| stale WS | old sink에 Close를 보내지 않고 pointer만 replace | `src/bridge.rs:70-118` |
| special validator bypass | special branch가 `validate_rpc`보다 먼저 return | `src/handler.rs:74-101` |
| test function count | Rust 32 + Bun 248 = 280 | `#[test]`/`#[tokio::test]` 및 `it/test(` recount |
| executable environment | Node만 있음; Cargo/Rustc/Bun 없음 | `Get-Command` 확인 |
| 원본 무변경 | `code-kb/figma-mcp-rust` status clean | `git status --short` |

## 5. 권장 반영 순서

1. H-1의 REST/MCP limit 표를 분리하고 exact plugin seat/edit 조건을 정책 절에 넣는다.
2. H-2 global flag race를 security/concurrency/strength 표 세 곳에서 일관되게 수정한다.
3. M-1 election peer verification과 M-2 follower payload ceiling을 architecture/transport/security에 추가한다.
4. M-3 typography blind spot을 tool 표, read limitation, prompt review에 반영한다.
5. M-4 ungroup order defect를 write limitation/test gap에 추가한다.
6. integration reuse table을 internal/private와 Community/public으로 분리한다.
7. low 정량·prompt 표현을 정리하고 실제 set-diff command를 남긴다.

## 6. 최종 판정

Agent A 보고서의 큰 구조와 대부분의 수치는 승인 가능하다. **인벤토리는 수정 불필요**하다. 본문은 H-1/H-2를 반드시 반영한 뒤 최종본으로 승격하는 것이 타당하다. M-1~M-5는 통합 서비스의 안전성·정확도·배포 가능성에 직접 영향을 주므로 함께 반영을 권고한다.
