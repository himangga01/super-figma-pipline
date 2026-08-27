# 세 오픈소스 상세 비교 보고서

> 기준일: 2026-08-27 (Asia/Seoul)  
> 비교 대상: `figma-mcp-rust`, `figmosha2`, `figwright`  
> 범위: 로컬 snapshot의 추적 파일 전체와 구현·테스트·설정·문서  
> 개별 근거: [figma-mcp-rust](01-figma-mcp-rust-analysis.md), [figmosha2](02-figmosha2-analysis.md), [figwright](03-figwright-analysis.md)

## 1. 비교 결론

세 프로젝트는 모두 Figma REST API나 공식 Dev Mode MCP 대신, 사용자가 열어 둔 파일에서 실행되는 Figma Plugin API를 로컬 프로세스에 연결한다. 따라서 REST token·REST quota·공식 MCP 호출 경로를 기술적으로 사용하지 않는다는 공통점이 있다. 그러나 세 프로젝트의 완성도와 제품 지향은 크게 다르다.

- **Figwright**는 통합 서비스의 기본 코드베이스로 가장 적합하다. 112개 도구보다 더 중요한 장점은 충실한 design context, 코드베이스 component/token/icon grounding, 다중 plugin session routing, version skew·idempotency·contract test다.
- **figma-mcp-rust**는 작은 native MCP 실행기, 선언형 도구 카탈로그, Rust 요청 상관관계, 병렬 screenshot/PDF 처리, 6개 OS/architecture npm 배포에서 가치가 있다. 다만 serializer·보안·세션·schema drift를 먼저 고쳐야 한다.
- **figmosha2**는 가장 단순한 transport, `doctor`, 20개 실용 helper, raw Plugin API 실험에서 가치가 있다. 임의 JavaScript 실행은 내부 expert mode에는 강하지만 공개 서비스 경계에는 부적합하다.

추천 조합은 **Figwright를 코어로 삼고, figma-mcp-rust의 배포·progress/export 아이디어와 figmosha2의 진단·helper UX를 선택적으로 이식하는 방식**이다. 세 서버를 그대로 동시에 묶는 방식은 protocol·tool·session 중복과 보안 표면만 늘리므로 권하지 않는다.

## 2. 조사량과 기준점

| 항목 | figma-mcp-rust | figmosha2 | figwright |
|---|---:|---:|---:|
| 기준 commit | `6094566` | `547cefb` | `a835e81` |
| 표시 버전 | 0.2.0 | tag 2.1.0, runtime 2.0 | package 0.4.0, tag 이후 33 commits |
| 추적 파일 | 93 | 15 | 612 |
| 전체 bytes | 598,008 | 109,430 | 7,010,446 |
| 텍스트 물리 라인 | 15,986 | 2,518 | 69,469 |
| 비공백 라인 | 14,200 | 2,082 | 62,275 |
| 바이너리 자산 | 0 | PNG 1 | PNG 5, GIF 2 |
| 로컬 Git history commits | 21 | 20 | 328 |
| 코드 라이선스 | MIT, Go 원작+Rust port 고지 | MIT | MIT |
| bundled third-party | 별도 확인 필요 | Solar/480 Design SVG 3개: CC BY 4.0; PNG provenance 미확정 | npm/plugin artifact notice 포함 여부 확인 필요 |

파일 수는 `.git/**`, 미추적 설치·빌드 산출물을 제외한 `git ls-files` 기준이다. 세 프로젝트의 코드는 MIT로 조합할 수 있지만 각 저작권·허가 고지를 보존해야 한다. figmosha2 UI에 직접 포함된 Solar SVG는 별도의 CC BY 4.0 attribution이 필요하다(`plugin/ui.html:38-44`, `CHANGELOG.md:72-75`). Figma 서비스 약관과 디자인·폰트·이미지 권리도 별도다.

## 3. 제품 성격 비교

| 축 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| 주된 성격 | native MCP↔Figma typed tool bridge | HTTP/CLI↔Figma arbitrary script bridge | grounded bidirectional Figma agent platform |
| 핵심 사용자 | MCP client 사용자 | 터미널·curl·agent를 쓰는 개인 개발자 | MCP agent와 기존 codebase를 함께 쓰는 개발팀 |
| 추상화 수준 | 73개 고정 MCP 도구 | raw JS + 11개 CLI 동작 + 20 helper | 112개 typed 도구 + 2 prompt + 2 skill |
| Figma→code | 부분 JSON/token/screenshot 재료 | caller가 직접 script 작성 | design context + codebase joins + agent workflow |
| code→Figma | primitive write 도구를 LLM이 조합 | arbitrary Plugin API script | 79 write 도구를 LLM이 조합 |
| deterministic compiler | 없음 | 없음 | 없음 |
| legacy code 분석 | 없음 | 없음 | JS/TS 계열 profile·AST·token·SVG scan |
| 제품 규모 | 중소형 | 매우 작음 | 대형 monorepo |

세 프로젝트 모두 “양방향”을 제공하지만 어느 것도 코드와 디자인 사이의 완전한 역컴파일러는 아니다. Figwright만 코드베이스 grounding을 구현했으며, 그마저도 code→Figma는 prompt가 typed write 도구를 오케스트레이션하는 구조다.

## 4. 비용·호출 제약 대체 경로 비교

### 4.1 공통 메커니즘

```text
MCP/CLI/HTTP client
        │ local process
        ▼
local relay/bridge
        │ WebSocket
        ▼
user-run Figma plugin
        │ public Plugin API
        ▼
user-authorized open file
```

| 질문 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| Figma REST token 사용 | 없음 | 없음 | 없음 |
| Figma REST endpoint 사용 | 없음 | 없음 | 없음 |
| 공식 Dev Mode MCP 사용 | 없음 | 없음 | 없음 |
| 자체 cloud 호출 | 없음 | 없음 | telemetry 없음; URL image fetch 예외 |
| 열린 파일 직접 접근 | 예 | 예 | 예 |
| 개발용 plugin side-load | Desktop 안내 | Desktop 전용 안내 | Desktop import 안내 |
| Starter/edit 가능한 Design file | 기술적으로 가능한 경로 | 기술적으로 가능한 경로 | 기술적으로 가능한 경로 |
| view-only 파일 자동 분석 | 불가 | 불가 | 불가 |
| headless 임의 fileKey 처리 | 불가 | 불가 | 불가 |
| native plan 제한 제거 | 불가 | 불가 | 불가 |
| Community 공개 적합성 | 고위험/미확정 | 매우 고위험 | 고위험/미확정 |
| web 지원 근거 | 저장소에 없음 | 미지원 명시 | README 주장, live E2E 없음 |

### 4.2 실제로 피할 수 있는 것과 남는 것

| 구분 | 기술적으로 줄이거나 제거 | 그대로 남음 |
|---|---|---|
| 인증 | REST token/OAuth 보관 | Figma account login, file ACL, plugin 실행 자격 |
| 호출량 | REST/API/MCP 호출 quota 경로 | local CPU·memory·payload·Plugin API runtime 한계 |
| 좌석 | 공식 Dev Mode MCP/Dev Mode workflow 의존 | Figma Design plugin을 실행할 수 있는 plan/seat와 `can edit` |
| 배포 | 개인 Desktop dev plugin | web/public 배포 심사, private org plugin plan, 관리자 통제 |
| 기능 | 공개 Plugin API가 제공하는 read/write | comments, account/org data, unopened file, REST-only surface |

즉 세 프로젝트가 제공하는 가장 현실적인 우회는 **개인 또는 소규모 내부 사용자가 편집권한이 있는 Figma Design 파일에서 development plugin을 직접 실행하고, bridge·code scan·mutation·audit을 로컬로 유지하는 Desktop 우선 경로**다. Claude/Codex/Cursor 같은 cloud model을 쓰면 선택된 design/code context가 model provider로 나갈 수 있으므로 “local bridge”와 “local-only AI”는 구분해야 한다. Web과 대규모 공개 배포는 별도 승인·배포 모델 없이는 같은 수준으로 보장되지 않는다.

### 4.3 공식 MCP와 REST는 서로 다른 limit 체계다

| 경로 | 인증·authority | limit의 축 | 이 local bridge가 대체하는 호출 |
|---|---|---|---|
| Official Figma MCP | Figma MCP access | plan·seat, read tool의 monthly/daily/per-minute limit; 일부 write tool 면제 | 반복 design grounding/read 호출 |
| Figma REST API | OAuth/PAT/plan token | endpoint tier·seat·요청 resource의 plan | file/node/image/variable REST read/write |
| Local Plugin API | logged-in user와 열린 파일 | editor/plugin runtime, payload, CPU, file permission | 위 cloud endpoint 대신 local execution |

공식 limit 숫자는 변경 가능하고, 본 리뷰 중 동일 공식 MCP URL의 수집 결과도 서로 충돌했다. 따라서 이 snapshot은 특정 숫자를 제품 상수로 고정하지 않는다. 확정 사실은 세 프로젝트의 구현이 official MCP와 REST endpoint를 모두 **0회 호출**한다는 것이다. 출시·ROI 계산 때 [MCP access/limits](https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions/)와 [REST rate limits](https://developers.figma.com/docs/rest-api/rate-limits/)를 같은 시점에 직접 재확인해야 한다.

## 5. 런타임과 protocol

| 항목 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| 서버 runtime | Rust/Tokio | Python/aiohttp | Node/TypeScript |
| client protocol | MCP stdio | HTTP JSON + CLI | MCP stdio |
| bridge port | 1994 | 8787 | 3055 |
| server↔plugin | JSON WebSocket | JSON WebSocket | MessagePack WebSocket |
| follower RPC | JSON HTTP `/rpc` | 없음 | MessagePack HTTP `/rpc` |
| UI↔sandbox | Figma postMessage | Figma postMessage | Zod-tagged bridge protocol |
| protocol version | 없음 | hello 2.0, 검증 없음 | wire 0.1.0 hard gate + product skew warning |
| payload model | loose JSON map | arbitrary code/result | shared Zod envelope, tool result는 일부 runtime 미검증 |
| 기본 bind | loopback, non-loopback 허용 | loopback, non-loopback 허용 | loopback 고정 |
| plugin UI | Svelte 5 | plain HTML | Vue 3/Tailwind |

Figmosha2는 MCP server가 아니므로 agent가 shell/HTTP를 통해 호출해야 한다. Figwright와 Rust는 MCP client에 native tool schema를 광고한다. Figwright의 MessagePack과 shared schema가 가장 구조적이며, Rust의 JSON은 디버깅이 쉽고 Figmosha2의 raw code는 유연하지만 contract가 가장 약하다.

## 6. 도구 표면과 겹침

### 6.1 수량

| 분류 | figma-mcp-rust | figmosha2 | figwright |
|---|---:|---:|---:|
| MCP tools | 73 | 0 | 112 |
| read/export/local | 21 | raw API + 11 CLI 중 읽기 동작 | read 23 + local 10 |
| write | 52 | raw API + CLI write | 79 |
| prompt | 12 | 0 | 2 |
| distributed skills | 13 | 0 | 2 |
| convenience helpers | 없음 | 20 | handler/helper가 내부 모듈로 분산 |
| plugin same-name handlers | 72 | 해당 없음 | 105 |

### 6.2 Rust와 Figwright의 lexical name 겹침

- Rust 73개 중 71개는 Figwright에도 같은 tool name으로 존재한다.
- Rust에만 같은 이름으로 있는 것은 `export_frames_to_pdf`, `export_tokens` 두 개다. Figwright에는 각각 유사한 `export_pdf`, `token_map`/token grounding이 있으나 의미가 완전히 같지는 않다.
- Figwright에만 있는 41개는 다음 기능을 추가한다.

여기서 71은 **문자열 이름의 교집합**일 뿐 API 호환 수가 아니다. 예를 들어 `set_fills`, `create_component`, `get_design_context`, `delete_variable`은 같은 이름이어도 input schema, result, side effect가 다르다. 통합 시 각 항목을 `same / adapter / incompatible`로 다시 분류하고 Rust prompt를 Figwright에 연결하기 전에 schema 기반 eval을 통과시켜야 한다.

| Figwright 추가 영역 | 추가 tool |
|---|---|
| 연결·프로젝트 | `ping`, `list_files`, `analyze_project`, `scan_components` |
| codebase grounding | `component_map`, `token_map`, `icon_map`, `design_diff` |
| component authoring | `create_instance`, `combine_as_variants`, `get_component_api`, `set_instance_properties`, `add_component_property`, `bind_component_property`, `edit_component_property`, `delete_component_property` |
| 세밀한 layout/shape | `set_position`, `set_layout_props`, `set_layout_grids`, `set_mask`, `set_arc` |
| 세밀한 text | `set_text_properties`, `set_text_range` |
| style/variable 확장 | `update_text_style`, `update_effect_style`, `bind_variable_to_paint`, `rename_variable`, `set_variable_code_syntax`, `delete_variable_collection` |
| asset/export | `import_svg`, `save_image_fills`, `export_pdf`, `export_video` |
| Motion | `get_motion_styles`, `get_node_motion`, `apply_animation_style`, `remove_animation_style`, `apply_manual_keyframe_track`, `remove_manual_keyframe_track`, `set_timeline_duration` |
| transaction | `batch` |

Figmosha2는 수량으로 직접 비교하기 어렵다. `new Function`에 `figma`를 전달하므로 Plugin API 전체를 이론적으로 호출할 수 있지만, schema·capability·validation·contract test·안전한 승인 단위가 없다. **표면의 이론적 폭은 가장 넓고 제품 계약의 신뢰도는 가장 낮다.**

### 6.3 Safe capability union 목표

| 원천 | 보존/추가 | v0.1 결정 |
|---|---|---|
| Figwright | 112 tools, 105 handlers | 전부 보존; Motion/video는 experimental label과 capability preflight 하에 유지 |
| Rust lexical unique | `export_tokens`, `export_frames_to_pdf` | deterministic exporter와 ordered multi-page compatibility adapter로 추가 |
| figmosha CLI | `doctor` | typed local diagnostic tool+CLI로 추가 |
| figmosha helper | `importVar`/`var_`의 library import | `import_library_variable` typed tool로 추가 |
| figmosha 나머지 helper/CLI | selection/tree/find/text/variant/clone/frame/binding | Figwright canonical handler를 호출하는 CLI alias·recipe·regression test로 보존 |
| figmosha raw evaluator | arbitrary `new Function` | public/service build에서 제외; 후속 local expert 연구만 허용 |

따라서 v0.1의 canonical MCP 목표 surface는 **116개**다: Figwright 112 + Rust 2 + `doctor` + `import_library_variable`. 별도 machine-readable Union Feature Manifest가 114 lexical tool과 helper20/CLI12를 `native/adapter/alias/deferred/rejected`로 추적하고, registry·docs·tests가 이를 검증해야 한다. “최대한 사용”은 세 서버를 병렬 실행하는 것이 아니라 안전한 하나의 contract에서 capability를 잃지 않는다는 의미다.

## 7. Figma 읽기 충실도

| 능력 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| current page tree | 예 | 직접 script/helper | 예 |
| depth/detail 수준 | minimal/compact/full | caller 구현 | full/compact + section plan |
| component dedupe | 구현됐으나 snake/camel 버그 | 없음 | component/style dedupe |
| rich text range | 제한적 | 직접 API 가능 | 보존 |
| gradient/image/video/pattern | 대부분 누락 | 직접 API 가능 | read 보존 |
| layout/constraints/grid/aspect | 일부 누락 | helper는 일부, raw 가능 | 광범위 보존 |
| variables/styles/bindings | 별도 도구, 일부 직렬화 | raw/helper | design context와 전용 도구 |
| reactions/annotations | 별도 read | raw | 별도 read + context projection |
| Motion | 없음 | raw API 가능하나 helper 없음 | read summary/full track |
| payload guard | depth 선택 | 16 MiB inbound/frame | 1,500 node bail, 24k token degradation, section plan |
| 구조화 IR 적합성 | 낮음~중간 | 없음 | 높음, 다만 canonical round-trip IR은 아님 |

Figwright가 명확히 우세하다. figma-mcp-rust의 `full` serializer는 이름과 달리 일반 layoutMode·constraints·gradient·component override 등 핵심 dimension을 잃는다. figmosha2는 raw API로 무엇이든 읽을 수 있지만 호출마다 caller가 schema와 traversal을 다시 설계해야 한다.

## 8. Figma→코드와 legacy code grounding

| 능력 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| framework detection | 없음 | 없음 | Next/Nuxt/React/Vue/Svelte/Solid/Angular |
| styling detection | 없음 | 없음 | Tailwind/Uno/SCSS 중심, 일부 enum 미도달 |
| component AST scan | 없음 | 없음 | OXC + Vue/Svelte block extraction |
| component matching | 없음 | 없음 | fuzzy name + props + override file |
| token matching | CSS export만 | raw script | CSS/SCSS/Tailwind/Uno/static JS + ambiguity |
| icon matching | 없음 | 없음 | repo SVG + icon library detection |
| incremental design diff | 없음 | 없음 | Figma baseline diff |
| code patch 실행 | 없음 | 없음 | agent/MCP client 책임 |
| build/test/render | 없음 | 없음 | skill이 client toolchain 사용을 지시 |

Figwright만 기존 codebase를 실제 조사한다. 다만 JS/TS web stack 중심이며 PHP/Ruby/.NET/native mobile과 복잡한 monorepo는 별도 adapter가 필요하다. 세 프로젝트 어느 것도 자체적으로 code patch를 적용·빌드·테스트하는 완결된 pipeline은 아니다.

Figma 쪽 component discovery도 과장하면 안 된다. 현재 Figwright `get_local_components`는 선택/subtree 중심이며 remote team-library 전체 catalog discovery가 아니다. `scan_components`는 Figma component가 아니라 code AST를 찾는다. Code→Figma reuse는 현재 file/context에서 확인된 component와 명시적으로 import 가능한 key에 한정하고, remote library browser는 별도 capability로 추적해야 한다.

## 9. 코드→Figma 쓰기 비교

| 능력 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| primitive create/edit | 넓음 | raw API로 가능 | 가장 넓고 typed |
| layout | basic auto-layout | `h.frame` + raw | grid/wrap/sizing/position/constraints |
| rich text | node text 중심 | single-font helper + raw | node/range typography |
| styles | create/update paint/delete/apply | raw | paint/text/effect update 포함 |
| variables | basic CRUD/bind | helper/raw | CRUD/mode/bind/code syntax 확장 |
| components/variants | create/swap/detach | import/variant/raw | properties/instance/variant authoring |
| prototype | reactions | raw | reactions |
| Motion | 없음 | raw 가능성만 있음 | beta Motion 도구 7개 read/write |
| batch/rollback | 없음 | 없음 | 30개 invertible operation batch |
| deterministic code parser | 없음 | 없음 | 없음 |
| write queue | 없음 | 없음 | 없음 |
| idempotency | 없음 | 없음 | requestId cache, concurrent gap 있음 |

Figwright가 typed 쓰기 범위와 rollback에서 앞선다. Figmosha2는 expert가 직접 Plugin API 코드를 작성할 때 가장 빠른 escape hatch지만 공개 endpoint에 노출하면 문서 내부 임의 code execution이 된다. Rust는 52개 도구로 충분한 기본 surface를 가지나 component property·rich text·batch가 부족하다.

## 10. 연결 안정성·동시성·복구

| 항목 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| 여러 MCP process | 단순 leader/follower | 해당 없음 | leader/follower/conflicted |
| 여러 Figma plugin/file | 1 sink, 불안정 | 1 live slot | session registry + activity routing |
| newest build handoff | 없음 | 없음 | quiet-window abdication |
| plugin liveness | socket 상태 | active ping + 20s heartbeat | 15s heartbeat + busy defer |
| reconnect grace | 없음 | UI 2s reconnect | 30s session resume |
| version skew | 없음 | hello 무시 | protocol hard gate + feature warning |
| timeout | 30/60s + progress extension | caller 지정, cancel 없음 | 30/120s layered budgets |
| retry | 없음 | 없음 | follower transport만 3회 |
| cancellation | MCP cancellation 미연결 | HTTP timeout 후 실행 계속 | conflict abort 일부, tool cancel 제한 |
| write ordering | 없음 | 없음 | per-session queue 없음 |
| idempotency | 없음 | 없음 | 60s completed-result cache |
| transaction | 없음 | 없음 | 제한된 atomic batch |

Figwright가 가장 성숙하다. Rust의 leader/follower는 한 plugin을 여러 client가 공유하는 최소 구현이지만 이전 WebSocket을 실제로 닫지 않는 결함이 있다. Figmosha2는 stale incumbent를 ping해 교체하는 점은 좋지만 single-user 도구이고, global `CURRENT_PRINT`와 mutation 동시 실행이 충돌할 수 있다.

추가 교차 리뷰에서 Rust는 `/ping`의 product/version body를 확인하지 않고 2xx만 신뢰하며, role이 `Unknown`이어도 같은 port의 `/rpc`로 민감한 tool params를 보낼 수 있음이 확인됐다. 또한 request queue 없이 process-global `skipInvisibleInstanceChildren`를 save/set/restore하므로 동시 fast read끼리 최종 flag가 원래 값과 달라질 수 있고 hidden-node write와 충돌한다. Figmosha2는 두 challenger가 동시에 silent incumbent를 교체할 때 generation/lock이 없어 stale socket을 만들 수 있다.

## 11. 보안 비교

| 통제 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| loopback 기본 | 예 | 예 | 강제 |
| non-loopback | 인증 없이 허용+경고 | 인증 없이 허용+경고 | 미지원 |
| Host/DNS rebinding gate | 없음 | 예 | 예 |
| Origin gate | 없음 | HTTP 거부, plugin null 허용 | WS/HTTP 역할별 allowlist |
| same-user auth/token | 없음 | 없음 | 없음 |
| raw arbitrary JS | 없음 | **예** | 없음 |
| manifest network | `*` | localhost:8787 | `*` |
| filesystem read/write sandbox | lexical CWD guard, symlink 위험 | built-in 없음, raw Figma only | arbitrary rootDir/outPath 가능 |
| payload redaction | debug에 params 노출 | log/result cap 없음 | UI elide/cap, design data retention |
| destructive annotation | 없음 | 없음 | 11개 표시, local FS write 오분류 |
| approval/dry-run | client 의존 | 없음 | client annotation+batch, 불완전 |

보안 기본값은 Figwright가 가장 낫고, figmosha2가 Host/Origin 방어에서는 Rust보다 낫다. 그러나 어느 프로젝트도 동일 사용자 계정으로 실행되는 악성 로컬 프로세스를 인증으로 구분하지 않는다. 통합 서비스는 pairing secret, workspace sandbox, per-file queue, destructive confirmation, audit/redaction을 새로 넣어야 한다.

### 11.1 프로젝트별 가장 큰 위험

| 프로젝트 | P0/P1 위험 |
|---|---|
| figma-mcp-rust | foreign-port `/rpc` forwarding, 인증·Origin 없는 `/rpc`/`ws`, stale socket, global traversal flag race, debug payload, lexical path confinement, Dev Mode write preflight 부재, schema drift |
| figmosha2 | unauthenticated raw `/exec`, `build_app()` reuse 시 Host gate 비활성, concurrent handover race, LAN exposure, timeout 후 mutation 지속, global execution state, broad permissions |
| figwright | null-Origin만으로 fake plugin session 가능, dispatched request가 reconnect에서 outcome-unknown으로 정리되지 않음, `/rpc`·`/abdicate` body 무제한, local filesystem tool의 readOnly annotation, arbitrary root/output path, runtime result 미검증, concurrent idempotency gap, URL wildcard fetch |

## 12. 테스트·CI·품질 gate

| 항목 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| test 파일 | Rust external 3 + plugin 9 + internal tests | 2 | `*.test.ts` 196 |
| 정적 test/check 수 | Rust 32 + TS 248 | pytest 16 cases + JS 20 checks | 약 1,770 declaration sites |
| 이번 조사 실제 실행 | npm launcher syntax만; Cargo/Bun 없음 | Node 20/20 통과; pytest deps 없음 | dependency/dist 부재로 미실행 |
| CI | Rust fmt/clippy/test/build + Bun test/build | 없음 | type/lint/format/knip + Linux/Windows build/test |
| registry contract | 73 unique/schema basics | 없음 | server/plugin/docs/prompt/argument snapshot |
| transport E2E | 없음 | fake plugin HTTP/WS 정의 | raw MCP/dist/process lifecycle 정의 |
| live Figma gate | 없음 | 없음 | 없음 |
| coverage threshold | 없음 | 없음 | 0 |
| minimum runtime matrix | MSRV 미검증 | dependency pin 없음 | Node 20/22 claim, Node24 CI만 |

Figwright의 contract test와 실제 process E2E 설계가 가장 강하다. 그러나 세 프로젝트 모두 이번 환경에서 전체 build/test를 실행하지 못했고, 실제 Figma Design/Dev Mode/FigJam/Web release gate는 없다. 정적 테스트 수는 품질의 직접 점수가 아니며 중요한 boundary를 어떤 test가 고정하는지가 더 중요하다.

## 13. 빌드·배포·운영성

| 항목 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| 사용자 서버 설치 | npm wrapper 단일 native binary | Python+aiohttp 수동 | npx npm package |
| plugin 배포 | GitHub Release zip | source manifest 직접 | GitHub Release zip |
| supported host | 6 OS/arch binary 조합 | Python 가능 환경, Figma Desktop 별도 | Node 20.19/22.12 claim, Node24 build |
| lockfile | Cargo+Bun | 없음 | pnpm |
| release automation | multi-platform build/npm/MCP Registry | 없음 | changelogen/npm provenance/plugin zip |
| config | CLI IP/port + plugin storage | port가 server/CLI/UI/manifest에 drift | fixed loopback port |
| 진단 UX | troubleshooting skill | `doctor`+status | `ping`+Context/Debug panel |
| 운영 복잡도 | 중간 | 낮음 | 높음 |

Rust는 설치 footprint와 native 배포에 유리하고, figmosha2는 소스가 가장 작아 이해·수정이 쉽다. Figwright는 복잡하지만 운영·release·diagnostic이 제품 수준에 가장 가깝다.

## 14. 유지보수성과 확장성

| 기준 | figma-mcp-rust | figmosha2 | figwright |
|---|---|---|---|
| single source of truth | Rust ToolDef 중심, TS/schema/prompt drift | 없음, raw API로 회피 | ToolSpec/handler contract 강함 |
| 타입 엄격성 | Rust 강함, plugin strict false/`any` | Python/JS 동적 | TS strict + Zod, result runtime 공백 |
| 모듈 경계 | 비교적 명확 | 파일 4개 중심 | 세 package와 runtime 경계 명확 |
| 신규 도구 추가 비용 | Rust schema+validator+TS handler | script만 쓰면 낮음 | tool+handler+schema+tests, 높지만 안전 |
| 코드베이스 adapter 확장 | 새로 필요 | 새로 필요 | 기존 JS/TS adapters 확장 |
| 대형 파일 처리 | base64/whole tree risk | whole string/raw script | dedupe/budget/section plan |
| multi-user/cloud 확장 | 새 설계 필요 | 부적합 | local multi-session까지, cloud tenancy는 새 설계 |

Figwright는 코드량이 많지만 contract ratchet이 변경 비용을 정당화한다. Rust는 단순한 도구 catalog를 유지하기 좋지만 plugin contract 자동 생성이 필요하다. Figmosha2는 prototype 속도는 빠르나 service contract를 추가하는 순간 현재의 단순함을 잃는다.

## 15. README/문서 신뢰성 비교

| 프로젝트 | 확인된 정확한 주장 | 중요한 과장·drift |
|---|---|---|
| figma-mcp-rust | 73 tools, REST token 없음, Rust/native bridge, 12 prompt+13 skills | dedupe 옵션 불작동, full serializer 과장, Glama 58/73, annotation conversion 불완전, previous socket close 주석 불일치 |
| figmosha2 | HTTP→WS→plugin 흐름, 20 helper, 11 동작, Host/Origin guard | 실제 라인 수 과소, runtime 2.0 drift, dynamic-page 누락, custom port 단절, performance/minimized/log UI 주장 미검증 |
| figwright | 112 tools, bidirectional surface, grounding, leader/follower | exact payload/every call 표현, scan_components 역방향 용도 혼동, nothing leaves 예외, Node 지원 미검증, free 표현의 정책 범위 |

## 16. 라이선스·정책·배포 위험

### 16.1 오픈소스 라이선스

세 프로젝트의 코드 라이선스는 모두 MIT라 결합할 수 있다. 다만 repository root의 단일 LICENSE만 보면 안 된다. 다음은 별도로 해야 한다.

1. 세 LICENSE와 원 저작권 고지를 배포물에 포함한다.
2. figma-mcp-rust는 Go 원작자와 Rust port 저작권을 모두 보존한다.
3. figmosha2의 Solar SVG 3개는 480 Design과 CC BY 4.0 링크·변경 여부를 `THIRD_PARTY_NOTICES`에 남기거나 자체 아이콘으로 교체한다.
4. npm/plugin zip/native binary에 notice가 실제 포함되는지 artifact를 검사한다. Rust npm/plugin ZIP과 Figwright npm tarball은 현 source 설정상 LICENSE 포함을 별도 확인해야 한다.
5. third-party dependency SBOM과 각 license를 검토한다.
6. 프로젝트 이름·Figma 상표 사용은 MIT와 별개로 검토한다.

### 16.2 Figma 경계

현행 공식 문서상 Community 심사는 paid offering workaround, 공식 MCP 밖 programmatic AI access, Figma API 재배포 성격을 문제 삼을 수 있다. private organization plugin은 Organization/Enterprise 기능이고, development plugin은 Desktop 개발 흐름에 적합하다. 플러그인 사용은 product/seat와 `can edit`의 영향을 받는다.

| 배포 모델 | 기술성 | 비용 우회 정도 | 정책/운영 평가 |
|---|---|---|---|
| 개인 Desktop dev plugin | 가장 현실적 | REST/공식 MCP 경로 제거 | 수동 import/run, 내부 사용에 적합 |
| 소규모 team 개별 side-load | 가능 | 높음 | 업데이트·보안·지원 부담, 조직 정책 확인 |
| Organization private plugin | 가능 | 공식 MCP 의존 제거 | Organization/Enterprise 비용과 관리자 정책 필요 |
| Community public live MCP bridge | runtime prototype은 가능 | 높음 | 공식 guideline상 일반적으로 승인하지 않는 유형이며 별도 local package 요구도 문제; 서면 예외/승인 전 비목표 |
| 공식 MCP/REST connector | 가능 | 낮음 | 공개 제품의 가장 안정적인 정책 경로 |
| web DOM injection/browser extension | 이 세 저장소에 없음 | 잠재적 | 제안 대상에서 제외: 공식 API 경계를 벗어남 |

공식 참고 자료: [Developer Terms](https://www.figma.com/legal/developer-terms/), [Community review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines), [plugin plan/seat matrix](https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files), [inspection/can-edit](https://help.figma.com/hc/en-us/articles/22012921621015-Guide-to-inspecting), [plugin execution](https://developers.figma.com/docs/plugins/how-plugins-run/), [private plugins](https://help.figma.com/hc/en-us/articles/4404228629655-Create-private-plugins-for-an-organization). 확인일은 2026-08-27이다.

### 16.3 현행 공식 MCP와 build-vs-buy

현행 공식 Figma MCP는 더 이상 단순 read-only 비교 대상이 아니다. design context와 assets 외에도 `use_figma` 계열 write-to-canvas, `generate_figma_design`을 통한 live UI/code-to-canvas, design-system search를 제공한다. 일부 write 도구는 표준 read limit에서 면제될 수 있다. 따라서 자체 서비스의 차별점은 “쓰기 가능” 자체가 아니라 다음이어야 한다.

- 사용자가 권한을 가진 Desktop file의 local-first 실행과 반복 read 비용 대체.
- 기존 legacy repository component/token/icon grounding과 mapping provenance.
- workspace sandbox, approval, audit, durable saga.
- official connector와 local connector를 같은 IR/CLI에서 교체하는 hybrid mode.

공식 connector는 view-only/unopened/public SaaS와 vendor-supported flow에서 buy/fallback 후보이고, local connector는 내부 Desktop·반복 grounding·custom workflow에서 build 후보다. [Official MCP overview](https://developers.figma.com/docs/figma-mcp-server/), [write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/), [tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)를 출시 시점에 다시 대조한다.

## 17. Hard gate와 재사용 효율 점수

다음 항목은 점수로 상쇄할 수 없는 출시 gate다.

| Hard gate | 현재 상태 | 통과 조건 |
|---|---|---|
| 권한·접근통제 | 세 프로젝트 모두 권한 상승 없음 | user-authorized file만 처리하고 negative permission test 통과 |
| local endpoint security | 셋 모두 same-user auth 부족 | pairing, Host/Origin, path sandbox, approval E2E |
| 라이선스 notice | MIT/CC BY artifact 확인 미완료 | package/zip/SBOM 검증 |
| Desktop live acceptance | 이번 조사 미실행 | 지원 OS·editor·plan matrix 통과 |
| public/Web policy mode | live bridge는 일반적으로 미승인 유형 | 서면 예외/승인 또는 artifact/official connector |

Hard gate를 통과하지 못한 후보는 weighted score와 무관하게 해당 배포 모드로 출시하지 않는다.

아래 점수는 현재 snapshot의 정적 증거를 0~5로 평가한 **fork/reuse utility** 도구다. 제품 준비도, 실제 Figma benchmark, 법률 판정이 아니다. 이번 조사의 evidence는 대부분 source/test 정적 검토(C), 일부 로컬 자동 실행(B), live Figma·공개 배포(A)는 없음이다. 0.1점 단위 합계는 산술 결과일 뿐 측정 정밀도를 뜻하지 않는다.

| 평가 축 | 가중치 | Rust | figmosha2 | Figwright |
|---|---:|---:|---:|---:|
| Figma read fidelity | 15 | 2.5 | 1.5 | 4.5 |
| design→code grounding | 15 | 0.5 | 0.0 | 5.0 |
| code→Figma/write surface | 12 | 3.5 | 3.5 | 4.5 |
| transport·multi-client reliability | 10 | 2.5 | 1.5 | 4.5 |
| security default | 10 | 1.5 | 2.0 | 3.5 |
| tests·contract confidence | 10 | 2.5 | 1.5 | 4.5 |
| maintainability·extensibility | 8 | 3.0 | 2.5 | 4.0 |
| install·release·operations | 7 | 4.0 | 2.5 | 3.5 |
| performance·payload control | 5 | 3.5 | 2.0 | 3.5 |
| editor/web reach evidence | 4 | 2.0 | 1.0 | 2.5 |
| public policy fit | 4 | 1.5 | 0.5 | 1.5 |
| **가중 합계 / 100** | **100** | **47.1** | **33.6** | **82.3** |

해석은 다음과 같다.

- Figwright의 높은 점수는 이미 존재하는 grounding·contract·relay를 새로 만드는 비용을 크게 줄인다는 뜻이지 출시 준비도가 82.3%라는 뜻이 아니다.
- Rust는 native 배포와 typed server에는 강하지만, 통합 목적의 핵심인 codebase grounding 부재가 큰 감점이다.
- figmosha2의 낮은 점수는 내부 도구 가치가 낮다는 뜻이 아니다. 공개·구조화 서비스의 기반으로 평가했기 때문이다.
- public policy fit은 세 프로젝트 모두 낮다. 이 축은 “기술이 동작하는가”가 아니라 “사용자가 요구한 형태로 공개 배포할 수 있는가”를 본다.

## 18. 시나리오별 선택

| 시나리오 | 1순위 | 2순위 | 이유 |
|---|---|---|---|
| 개인 Desktop에서 즉시 실험 | figmosha2 | Rust | raw exec와 doctor가 빠름; 신뢰 환경 전제 |
| 작은 native MCP | Rust | Figwright | 단일 binary·73 typed tools |
| legacy React/Vue/Svelte 구현 | Figwright | Rust | project profile + component/token/icon grounding |
| 대형 Figma UX 구조 분석 | Figwright | Rust | full projection + dedupe + section plan |
| 코드에서 Figma 화면 제작 | Figwright | figmosha2 | typed write/batch; raw expert escape hatch |
| 여러 agent·여러 열린 파일 | Figwright | Rust | session routing/election이 성숙 |
| 공개/상용 서비스 | 세 프로젝트 단독 부적합 | Figwright를 harden | 정책 승인, auth, workspace sandbox가 선행 |

## 19. 기능별 채택·폐기 표

| 기능 | 원천 | 결정 | 이유/수정 조건 |
|---|---|---|---|
| design serializer/context | Figwright | 채택 | fidelity와 projection tests가 가장 강함 |
| component/token/icon grounding | Figwright | 채택 | legacy code reuse 핵심 |
| ToolSpec/shared protocol | Figwright | 채택 | registry/handler/argument contract gate |
| session routing/election | Figwright | 채택 | multi-file/multi-agent 운영 기반 |
| batch/idempotency | Figwright | 수정 채택 | in-flight dedupe·durable journal·write queue 추가 |
| plugin panel | Figwright | 수정 채택 | final MCP payload·retention·redaction 추가 |
| native 6-platform launcher | Rust | ADR 후 선택 채택 | 원 launcher는 Rust binary용이다. Node embed/worker/installer 중 packaging 방식을 먼저 결정 |
| progress deadline extension | Rust | 개념 채택 | absolute deadline/cancel과 함께 사용 |
| direct token CSS export | Rust | 채택 후보 | Figwright token map과 별도 export 기능으로 보완 |
| screenshot concurrency/PDF merge | Rust | 개념 채택 | streaming·output sandbox·quota 필요 |
| 12 workflow prompt catalog | Rust | 선별 채택 | drift와 잘못된 tool 예시 수정 후 eval recipe화 |
| `doctor`와 error hints | figmosha2 | 채택 | structured diagnostic code로 변환 |
| paint/font/frame helper UX | figmosha2 | 개념 채택 | 구현 authority는 더 강한 Figwright binding/range-font handler로 유지, alias만 제공 |
| Host/Origin guard | figmosha2/Figwright | Figwright 우선 | figmosha `build_app()`은 main 밖 reuse 시 Host gate가 꺼지므로 그대로 이식 금지 |
| raw `new Function` | figmosha2 | 공개 제품 폐기 | local expert mode만 feature flag+승인+감사로 제한 |
| configurable non-loopback bind | Rust/figmosha2 | 폐기 | 인증 없는 LAN exposure 방지 |
| partial serializer | Rust | 폐기 | Figwright IR로 통일 |
| prompt-only reverse compiler | 모두 | 보완 | code AST/runtime adapter와 provenance graph 신설 |

## 20. 최종 판단

기술적으로 가장 빠른 비용 제약 대체 경로는 세 프로젝트가 공통으로 증명한 **Desktop development plugin + local relay + 사용자가 권한을 가진 열린 Figma Design 파일**이다. 그 위에 제품을 만들 때는 Figwright의 grounding과 contract를 중심으로 통합하고, Rust와 figmosha2에서는 중복 서버가 아니라 검증된 아이디어만 가져오는 것이 합리적이다.

성공을 가르는 것은 도구 수가 아니라 다음 네 가지다.

1. Figma와 code를 함께 표현하는 provenance-aware canonical IR.
2. 기존 component/token/icon을 우선 재사용하는 codebase grounding.
3. preview·approval·transaction·visual diff가 있는 안전한 왕복 동기화.
4. Desktop internal, web/private, public official connector를 구분하는 배포·정책 전략.

다음 문서인 [통합 서비스 제안서](05-unified-service-proposal.md)는 이 결론을 실제 기능·모듈·데이터 흐름·로드맵으로 구체화한다.
