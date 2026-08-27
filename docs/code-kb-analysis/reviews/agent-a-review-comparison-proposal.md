# Agent A 리뷰 — 상세 비교 및 통합 서비스 제안

## 1. 리뷰 범위와 종합 판정

- 대상: `docs/code-kb-analysis/04-detailed-comparison.md`, `docs/code-kb-analysis/05-unified-service-proposal.md` 최신본
- 대조 근거: 수정된 `01`~`03` 개별 보고서, 세 inventory, Agent A/B/C 교차 리뷰, 세 원본 repository
- 사용자 추가 요구: **세 OSS 기능을 가능한 한 합집합으로 보존하고 실제 서비스를 구현**

두 문서는 아키텍처 선택과 정책 경계를 매우 잘 잡았다. Figwright fork를 중심으로 잡고 Rust/figmosha의 중복 server는 버리되 기능 아이디어를 흡수하는 결정, Desktop internal을 먼저 열고 Web/public을 hard gate로 분리하는 결정, raw JavaScript와 unauthenticated LAN endpoint를 기본 폐기하는 결정은 타당하다.

그러나 현재 산출물은 여전히 **분석·제안 문서**다. workspace root에는 `code-kb/`와 `docs/`만 있고 통합 서비스 source, package manifest, executable, test가 없다. 또한 lexical tool 합집합과 helper/CLI 기능을 실제 구현 상태로 추적하는 complete ledger가 없어 “최대한 합집합”을 검증할 수 없다. Figwright 교차 리뷰에서 확인한 multi-file grounding 결함도 core fork hard gate에 아직 들어가지 않았다.

## 2. 독립 재검증

| 항목 | 결과 |
|---|---:|
| Rust tool | 73 |
| Figwright tool | 112 |
| 동일 이름 교집합 | 71 |
| Rust+Figwright lexical union | **114** |
| Rust-only name | `export_frames_to_pdf`, `export_tokens` |
| Figwright-only name | 41 |
| figmosha public helper | 20 |
| figmosha parser 이름/고유 CLI 동작 | 12 / 11 |
| 통합 구현 source | **0** — root에는 `code-kb`, `docs`만 존재 |

`04`의 71개 lexical overlap과 41개 Figwright-only 계산은 정확하다. 다만 문서도 인정하듯 동일 이름은 schema/result/side effect 호환을 의미하지 않는다(`04-detailed-comparison.md:135-155`).

## 3. Finding 요약

| ID | 심각도 | 영역 | 요약 |
|---|---|---|---|
| A-CP-01 | **High** | 실제 구현 | 새 요구가 “실제 구현”인데 service scaffold/source/test가 전혀 없음 |
| A-CP-02 | **High** | 합집합 | 114 tool name + figmosha helper/CLI의 complete capability ledger와 adapter disposition 부재 |
| A-CP-03 | **High** | core correctness | Figwright `token_map` session 혼합과 `design_diff` file collision을 fork hard gate에 반영하지 않음 |
| A-CP-04 | **High** | Model egress | 외부 MCP client 자체가 cloud model이면 Egress Broker를 우회해 tool result가 이미 provider로 나감 |
| A-CP-05 | **High** | v0.1/scope | roadmap은 있으나 v0.1 Done 정의가 없고 Must가 세 framework·양방향·compiler·sync까지 과대함 |
| A-CP-06 | **Medium** | 누락 기능 | Rust multi-page PDF·deterministic token export, figmosha library variable import/compatibility UX가 확정 backlog가 아님 |
| A-CP-07 | **Medium** | hard gate | multi-file isolation, egress, runtime result validation, release artifact notice가 출시 gate에서 누락 |
| A-CP-08 | **Medium** | Desktop/Web | v0.1은 Desktop-only인데 사용자 Web 목표를 충족하지 않는다는 version boundary가 불명확 |
| A-CP-09 | **Medium** | license/fork | 고지 원칙은 있으나 fork migration과 npm/plugin ZIP의 구체적 notice 생성·검증 task가 없음 |
| A-CP-10 | **Low** | 비용 숫자 | 합의상 특정 Starter 숫자를 제거해야 하는데 두 문서가 6/20 충돌 숫자를 다시 노출 |

## 4. 상세 Finding

### A-CP-01 — 제안만 있고 실제 서비스 구현은 0

**심각도: High**

`05`는 Figwright fork를 Phase 1 deliverable로 미래형으로 적는다(`05-unified-service-proposal.md:491-503`). 현재 workspace root에는 `.git`, `code-kb`, `docs`만 있고, original knowledge base 밖의 package/source/test가 없다. 따라서 새 사용자 요구의 “실제 구현”은 아직 시작되지 않았다.

문서가 훌륭하더라도 executable command, build, test, live plugin artifact가 없으면 구현 완료로 보고할 수 없다.

**수정안**

1. 원본 `code-kb`는 read-only로 두고 `service/` 또는 명시한 product directory에 Figwright baseline을 fork한다.
2. upstream commit, copied files, license provenance를 기록한 `FORK_BASELINE.md`를 만든다.
3. 최소 `package.json`, workspace, build/typecheck/test, plugin build, MCP entrypoint를 실제 생성한다.
4. Phase 0/1의 첫 vertical slice를 구현·실행한 뒤에만 “service implementation started/complete”라고 보고한다.

### A-CP-02 — “최대 합집합”을 검증할 complete capability ledger가 없음

**심각도: High**

`04`는 lexical overlap 71이 API 호환이 아니므로 `same / adapter / incompatible` 재분류가 필요하다고 정확히 적지만 실제 표를 만들지 않는다(`04-detailed-comparison.md:135-155`). `05`는 프로젝트별로 일부 기능만 선택한다(`05-unified-service-proposal.md:140-193`). 따라서 누락이 의도된 것인지 우연인지 검증할 authority가 없다.

“최대한 합집합”은 세 server를 동시에 유지한다는 뜻이 아니라 **안전한 capability union을 한 contract로 보존**한다는 뜻이어야 한다.

**수정안**

machine-readable `capability-union.yaml` 또는 TypeScript registry를 만든다.

필수 필드:

```text
canonicalCapability
sources: [{ project, tool/helper/cli, originalName, schemaHash }]
disposition: native | alias | adapter | expert-only | deferred | rejected
rejectionReason
inputAdapter / resultAdapter
sideEffects / editorSupport / policyMode
tests / implementationStatus
```

- Rust+Figwright 114 names를 모두 한 행씩 처리한다.
- figmosha 20 helper, 11 CLI 동작, raw expert surface도 capability 행으로 넣는다.
- 동일 이름 71개는 schema/result golden adapter test 전까지 compatible로 표시하지 않는다.
- release gate가 `unclassified=0`, accidental removal=0을 강제한다.

### A-CP-03 — Figwright fork의 multi-file correctness blocker 누락

**심각도: High**

두 문서는 Figwright의 grounding/session routing/design diff를 거의 그대로 채택한다(`04-detailed-comparison.md:12-16,388-409`; `05-unified-service-proposal.md:142-161`). 그러나 최신 교차 리뷰의 두 결함은 필수 수정 표와 roadmap에 없다.

1. `token_map`은 `get_variable_defs`와 `get_styles`를 별도 dispatch하면서 `routedDispatch()`로 session pin하지 않는다. Follower/multi-file에서 서로 다른 파일의 variables/styles를 합칠 수 있다(`code-kb/figwright/packages/mcp/src/tools/token-map.ts:131-151`, `packages/mcp/src/index.ts:87-94,139-143`).
2. `design_diff`는 snapshot을 sanitized nodeId만으로 key하고 file identity를 저장하지 않는다. 다른 Figma 파일의 동일 nodeId baseline과 충돌할 수 있다(`packages/mcp/src/tools/design-diff.ts:61-70,87,157-171`).

`05`의 token map 수정 목록은 color/unit/truncation만, design diff 수정 목록은 atomic/schema/code-side diff만 적는다(`05-unified-service-proposal.md:151-155`).

**수정안**

- Figwright fork 전제 조건 P0로 `token_map` pinned session과 file provenance를 넣는다.
- Design IR identity에 stable connector file identity를 요구하고 snapshot path를 file namespace 아래 둔다.
- multi-file routing fixture에서 foreground 전환 중 cross-file mixing/collision 0을 hard gate로 만든다.
- unbounded `/rpc` body/pending queue와 `Date.now()` build-order 한계도 secure execution backlog에 추가한다.

### A-CP-04 — Egress Broker가 외부 MCP client의 model egress를 통제하지 못함

**심각도: High**

`04`는 cloud model 사용 시 design/code context가 provider로 나갈 수 있음을 명시하고(`04-detailed-comparison.md:82-102`), `05`는 Context/Egress Broker와 local/cloud model을 둔다(`05-unified-service-proposal.md:196-243`). 방향은 맞다.

하지만 Claude Code/Codex/Cursor 같은 **외부 MCP client 자체가 cloud model**이면 흐름이 다르다. Client가 tool을 호출하고 MCP `CallToolResult`를 받는 순간 그 payload는 client/model context로 들어간다. Diagram의 Orchestrator→Egress→Model path를 거치지 않는다. `05:243`은 이 차이를 문서화한다고만 하고 enforcement 위치를 정하지 않는다.

**수정안**

두 mode를 분리한다.

1. **Controlled-agent mode**: 서비스가 model client를 소유하고 Egress Broker를 반드시 통과시킨다.
2. **External-MCP mode**: Egress policy를 tool handler가 `CallToolResult`를 만들기 **전** 적용한다. 민감 field/image/text의 redaction, byte/token budget, per-call consent token이 필요하다.

Raw local result와 model-safe result를 별도 type으로 만들고, 외부 client에는 model-safe result만 반환한다. Provider·retention·전송 field를 승인하지 않으면 high-sensitivity tool은 fail closed해야 한다. 이 gate 없이는 “local-first”가 사용자에게 data-locality로 오인될 수 있다.

### A-CP-05 — v0.1 Done 정의 부재와 Must 과대 범위

**심각도: High**

`05`는 Phase 0~5와 Must/Should/Could를 제시하지만 release version과 연결하지 않는다(`05-unified-service-proposal.md:475-591`). Must에는 React/Vue/Svelte legacy patch, broad typed writes, mapping store, visual verify, security plane가 동시에 들어가고 Phase 3에는 reverse adapter와 3-way sync까지 있다. 팀·기간·dependency 순서 없이 이를 “MVP”로 묶으면 실제 구현이 끝나지 않는다.

**권장 v0.1 완료 범위**

| 범위 | v0.1 Done |
|---|---|
| 배포 | Desktop development plugin, single user/internal, Figma Design edit file만 |
| baseline | Figwright fork가 build/typecheck/test/plugin package 성공 |
| security | pairing secret, product/protocol handshake, workspace sandbox, side-effect metadata, per-file write queue |
| correctness | token_map pin, design_diff file identity, runtime result parse, in-flight idempotency |
| egress | external MCP response 전 model-safe redaction/approval gate |
| Figma→code vertical | **한 framework 우선**(예: React+CSS/Tailwind), 한 fixture를 existing component/token reuse로 patch·build·visual verify |
| code→Figma vertical | 같은 fixture를 staging section에 typed plan으로 생성, post-read 비교, rollback/partial report |
| union proof | Figwright 112 registry 보존 + Rust unique 2 + 선택 figmosha utilities의 status가 ledger에 표시 |
| diagnostics | product identity/version을 검사하는 `doctor` |
| release | LICENSE/THIRD_PARTY_NOTICES/SBOM 포함 artifact 검사 |

Vue/Svelte, Web/private, Motion, 3-way auto merge, native launcher는 v0.2+로 둘 수 있지만 capability ledger에는 deferred 이유를 남긴다.

### A-CP-06 — unique 기능의 확정 backlog 누락

**심각도: Medium**

`05`가 후보라고만 두어 합집합에서 쉽게 빠질 기능이 있다.

| 원천 | unique/의미가 다른 capability | 현재 제안 | 수정안 |
|---|---|---|---|
| Rust | `export_frames_to_pdf`: ordered multi-node multi-page PDF + server merge | “pure-Rust PDF merge 선택 후보” | `export_pdf` single-page와 별도 canonical multi-page tool로 확정 |
| Rust | `export_tokens`: deterministic JSON/CSS artifact | 후보/Should | grounding `token_map`과 분리해 deterministic export contract 확정 |
| Rust | 71 same-name tool의 legacy schema | 비교만 함 | versioned input/result adapters 또는 migration diagnostics 제공 |
| figmosha | `h.var_`/`importVar`: library variable key import fallback | 채택표에 없음 | typed `import_library_variable`/resolve capability로 추가; manifest permission·policy test |
| figmosha | `cloneNext`, `variantsOf`, hex/solid convenience | 일부 기능이 typed tool로 존재 | CLI/SDK convenience alias로 mapping하고 중복 구현은 하지 않음 |
| figmosha | raw Plugin API escape hatch | expert-only 유지 | compile-time public 제거와 audited local capability로 ledger에 보존 |

Figwright는 component key import를 `create_instance`/`swap_component`에 이미 제공하므로 figmosha `importComp`를 다시 만들 필요는 없다. 최대 합집합은 중복 code가 아니라 unique semantics 보존이다.

### A-CP-07 — Hard gate가 정책·보안 중심이고 correctness/egress가 빠짐

**심각도: Medium**

`04`의 hard gate는 권한, endpoint, license, Desktop acceptance, public policy를 둔다(`04-detailed-comparison.md:338-350`). 필요하지만 다음을 추가해야 한다.

- multi-file isolation: token/style/context/snapshot이 한 explicit session/file에서 왔다는 provenance test.
- model egress: external MCP client에 raw sensitive result가 반환되지 않는 negative test.
- runtime result validation: plugin skew/오염 결과가 typed boundary를 통과하지 않음.
- bidirectional vertical acceptance: code patch와 staging Figma plan이 post-verify까지 완료.
- artifact compliance: Rust/figmosha/Figwright 고지와 bundled dependency notices가 실제 archive에 존재.
- union completeness: capability ledger의 unclassified/accidental-drop 0.

### A-CP-08 — Web은 사용자 목표지만 v0.1 밖이라는 경계가 불명확

**심각도: Medium**

두 문서는 Desktop 우선과 Web hard gate를 정확히 분리한다(`04-detailed-comparison.md:67-102,323-350`; `05-unified-service-proposal.md:51-66,347-382,534-546`). 이는 정책상 올바르다. 다만 최종 문구는 전체 서비스가 Desktop/Web을 지원하는 듯 읽힐 수 있고 v0.1 version boundary가 없다.

**수정안**

- v0.1 명칭을 “Desktop Internal Preview”로 고정하고 Web unsupported를 UI/README/capability response에 표시한다.
- Web은 v0.2+ hard gate로 두되, private/published plugin live acceptance 또는 explicit artifact exchange 중 어느 경로인지 ADR로 결정한다.
- browser matrix 통과 전 “Web 지원” 마케팅을 금지한다.
- 사용자의 최종 Web 요구를 충족하는 target version과 exit criteria를 roadmap에 명시한다.

### A-CP-09 — 라이선스 원칙은 있으나 fork/artifact 구현 task가 부족

**심각도: Medium**

`04`와 `05`는 세 MIT, Rust 원작/port, figmosha CC BY 4.0, SBOM을 잘 적는다(`04-detailed-comparison.md:18-33,310-321`; `05-unified-service-proposal.md:593-601`). 그러나 실제 fork/release task가 없다.

최신 교차 검증상:

- Rust npm package와 plugin ZIP에 LICENSE copy 경로가 없다.
- Figwright npm package-local LICENSE가 없고 plugin ZIP은 manifest+dist만 넣는다.
- Figwright plugin UI는 Vue/Lucide 등 dependencies를 bundle한다.
- figmosha Solar SVG를 복사하면 CC BY attribution/변경 표시가 필요하다.

**수정안**

- fork day 1에 `LICENSES/`, `THIRD_PARTY_NOTICES`, SBOM generator를 생성한다.
- 원천 파일마다 provenance header/map을 둔다.
- `npm pack --dry-run`, plugin ZIP listing, native artifact notice를 automated release test로 만든다.
- Solar UI asset은 직접 복사할지 자체 icon으로 교체할지 즉시 결정한다.

### A-CP-10 — rate-limit 숫자 충돌 자체도 제거하는 편이 안전

**심각도: Low**

두 문서는 특정 숫자를 제품 상수로 채택하지 않는다고 정확히 결론 내지만, “Starter 6과 20 충돌”이라는 숫자를 본문에 다시 노출한다(`04-detailed-comparison.md:94-102`, `05-unified-service-proposal.md:68-76`). 교차 리뷰 최종 합의는 official live/crawler 표현이 충돌하므로 현재 Starter 숫자 단정을 모두 제거하는 것이다.

**수정안**: 숫자 쌍도 삭제하고 “공식 페이지의 수집 경로/시점 간 표현이 일치하지 않아 release 시 직접 확인”이라고만 쓴다. Stable fact는 세 connector가 REST와 official MCP endpoint를 0회 호출한다는 것이다.

## 5. 적절한 폐기 결정

다음은 “최대 합집합”과 충돌하지 않으며 유지해야 한다.

1. **세 server를 병렬 유지하는 microkernel 폐기**: 기능은 canonical registry/adapters로 흡수하고 중복 port/session은 제거하는 것이 맞다.
2. **public raw `new Function` 폐기**: expert-only audited local capability로만 보존한다.
3. **인증 없는 non-loopback bind 폐기**: remote capability가 필요하면 별도 authenticated connector로 재설계한다.
4. **Rust partial serializer 폐기**: 기능 손실이 아니라 Figwright canonical IR로 대체한다.
5. **prompt-only reverse compiler 보완**: prompt를 버리는 것이 아니라 eval recipe로 유지하고 deterministic adapter를 추가한다.

따라서 목표는 code union이 아니라 **safe capability union**이다.

## 6. 문서에서 이미 잘 처리한 사항

- Figwright core + Rust/figmosha selective absorption은 가장 낮은 재구현 비용의 선택이다.
- REST와 official MCP limit authority를 분리하고 endpoint 호출 0을 stable fact로 둔다.
- Model egress, local-first/local-only 차이를 인식한다.
- Desktop internal, private plugin, artifact exchange, official fallback을 별도 connector mode로 둔다.
- permission/seat/can-edit와 Figma policy를 기술 가능성과 분리한다.
- canonical IR, provenance graph, staging, 3-way diff, visual/build verification 방향이 타당하다.
- raw execution, LAN exposure, path escape를 기본 product surface에서 제거한다.
- weighted score를 출시 준비도가 아니라 reuse utility라고 한정한다.

## 7. 권고 반영 순서

1. `05`에 v0.1 Done 표와 실제 implementation directory/command를 추가하고 fork scaffold를 생성한다.
2. capability union ledger를 source-of-truth로 만들고 114 tool names + figmosha surface를 전부 분류한다.
3. Figwright multi-file correctness 두 건과 Egress enforcement를 Phase 1 hard gate로 올린다.
4. unique Rust/figmosha capability를 확정 backlog로 이동한다.
5. Web target version과 connector ADR을 명시한다.
6. release notice/SBOM archive test를 구현한다.
7. unstable Starter 숫자 쌍을 문서에서 제거한다.

이 조치와 실제 vertical-slice 구현이 완료되기 전에는 “세 OSS를 합친 서비스 구현 완료”라고 보고하면 안 된다.
