# Figwright 심층 분석 보고서

> 조사 대상: <code>code-kb/figwright</code>  
> 기준 커밋: <code>a835e81b575eab2c9265a67f9353c89b848f81ca</code>  
> Git 설명: <code>v0.4.0-33-ga835e81</code>  
> 기준일: 2026-08-27 (Asia/Seoul)  
> 전체 인벤토리: <code>docs/code-kb-analysis/inventories/figwright-file-inventory.md</code>

## 1. 결론 요약

Figwright는 “Figma REST API나 공식 Figma MCP endpoint를 호출하는 서버”가 아니다. 사용자가 편집 가능한 Figma 파일에서 개발용 플러그인을 직접 실행하고, 로컬 MCP 서버가 <code>127.0.0.1:3055</code>의 WebSocket relay를 거쳐 Figma Plugin API를 호출하는 구조다. 따라서 Figma API 토큰, REST 호출량, 공식 MCP의 OAuth·지원 client·seat/plan·rate 경로를 기술적으로 경유하지 않는다. 이 점은 구현으로 확인된다. MCP는 stdio로 시작하고, relay는 loopback에만 bind하며, 플러그인 manifest는 Plugin API sandbox와 UI를 가리킨다. 근거는 <code>code-kb/figwright/packages/mcp/src/index.ts:43-51</code>, <code>code-kb/figwright/packages/mcp/src/election/node.ts:49-55</code>, <code>code-kb/figwright/packages/plugin/manifest.json:5-13</code>이다.

핵심 자산은 단순한 112개 API 수가 아니라 다음 네 가지다.

1. Figma 노드를 코드 생성에 적합한 구조·레이아웃·스타일·토큰 컨텍스트로 직렬화하고, 중복 컴포넌트와 스타일을 축약하는 grounding 계층.
2. Figma 컴포넌트·변수·아이콘을 레거시 코드베이스의 컴포넌트·토큰·SVG에 연결하는 project-aware join 계층.
3. 여러 MCP 프로세스와 여러 열린 Figma 파일을 한 로컬 relay에서 다루는 leader/follower 선출, 세션 라우팅, 재연결 계층.
4. 읽기뿐 아니라 노드·레이아웃·텍스트·스타일·변수·컴포넌트·Motion을 수정하는 넓은 Plugin API write surface.

그러나 “양방향”은 대칭적인 컴파일러를 뜻하지 않는다. Figma→코드는 구조화된 grounding과 코드베이스 조인이 강하지만, 코드→Figma는 LLM이 소스 코드를 읽고 79개 write 도구를 순서대로 호출하도록 prompt/skill이 지시하는 방식이다. 코드 AST나 실행 DOM을 Figma 노드 그래프로 변환하는 엔진, 코드 변경을 Figma에 incremental diff하는 엔진, 코드 요소와 Figma nodeId를 영속적으로 연결하는 graph는 없다. 역방향은 “도구가 충분한 에이전트 오케스트레이션”이지 deterministic reverse compiler가 아니다. 더구나 <code>get_local_components</code>는 선택 또는 지정 subtree만 검색하고 remote library component key를 찾는 도구가 없으므로, 기존 Figma component 재사용도 file/library-wide 자동 discovery라고 볼 수 없다. 근거는 <code>code-kb/figwright/packages/mcp/src/prompts/code-to-figma.ts</code>, <code>code-kb/figwright/skills/figma-build/SKILL.md</code>, <code>code-kb/figwright/packages/mcp/src/tools/get-local-components.ts:7-20</code>, <code>code-kb/figwright/packages/plugin/src/handlers/get-local-components.ts:9-43</code>, <code>code-kb/figwright/packages/plugin/src/handlers/registry.ts</code>이다.

통합 서비스에 채택할 때는 grounding/serializer, relay/election, shared protocol, tool registry/contract gate를 우선 재사용할 가치가 높다. 반대로 filesystem 경계, local 도구의 MCP read-only annotation, runtime 결과 검증, 역방향 component discovery, in-flight idempotency는 수정 없이 서비스 경계로 사용하면 안 된다. 특히 현재 구현에는 <code>token_map</code>의 sub-call session pin 부재, <code>design_diff</code> baseline의 file identity 부재, <code>Origin: null</code>을 plugin 신원으로 오인할 수 있는 unauthenticated relay, socket flap 뒤 write 결과가 불명확해지는 공백이 있다. 이 네 항목은 서비스화 전 correctness/security gate다.

## 2. 조사 범위와 방법

### 2.1 전수 조사 범위

- <code>git ls-files</code>로 얻은 추적 파일 612개 전부를 바이트 단위로 열었다.
- 전체 크기는 7,010,446 bytes다.
- 텍스트 605개, 바이너리 7개(PNG 5, GIF 2)다.
- 텍스트 물리 라인은 69,469줄, 비공백 라인은 62,275줄이다.
- <code>.git/**</code>, 미추적 파일, 설치·빌드 산출물은 canonical 범위에서 제외했다.
- 구현, 테스트, manifest, package 설정, CI, README, AGENTS, CHANGELOG, skills를 상호 대조했다.
- 파일별 경로·역할·라인·바이트는 별도 612행 인벤토리에 기록했다.

정량 근거는 <code>docs/code-kb-analysis/inventories/figwright-file-inventory.md</code>에 재실행 명령과 함께 있다.

### 2.2 실행 검증의 한계

현재 snapshot에는 <code>node_modules</code>와 <code>packages/*/dist</code>가 없고, 셸에서 <code>pnpm</code> 명령도 제공되지 않았다. Node 자체는 <code>v24.19.0</code>이지만, 의존성 설치나 저장소 변경을 승인 범위로 확대하지 않았다. 따라서 이 보고서에서 “테스트가 존재한다/CI가 실행한다”는 주장은 테스트 코드와 workflow의 정적 검증이고, 현재 워킹트리에서 test suite가 실제 통과했다는 주장은 아니다. 이 제한은 특히 built-dist E2E와 실제 Figma editor 동작에 중요하다.

원본 Figwright 저장소는 수정하지 않았다. 산출물은 상위 workspace의 지정된 두 Markdown 파일뿐이다.

## 3. 기준 커밋, 버전, 라이선스

| 항목 | 조사 결과 | 근거 |
|---|---|---|
| 기준 commit | <code>a835e81b575eab2c9265a67f9353c89b848f81ca</code>, 2026-08-27, tag 기준 33 commits 이후 | Git metadata |
| 공개 제품 버전 | <code>@figwright/mcp</code> 0.4.0 | <code>code-kb/figwright/packages/mcp/package.json:2-3</code> |
| workspace/plugin/shared 버전 | private <code>0.0.0</code> | 각 <code>package.json</code> |
| wire protocol | 0.1.0 | <code>code-kb/figwright/packages/shared/src/protocol.ts:1</code> |
| 다음 plugin compatibility floor | 0.5.0, 단 server 버전으로 cap | <code>code-kb/figwright/packages/shared/src/version.ts:56,155-179</code> |
| 라이선스 | MIT, 2026-present Roya | <code>code-kb/figwright/LICENSE:1-3</code> |
| 배포 단위 | MCP npm package + GitHub Release의 plugin zip | <code>code-kb/figwright/.github/workflows/release.yml</code> |

단일 제품 버전의 authority는 <code>packages/mcp/package.json</code>이다. plugin Vite build가 이 값을 <code>__APP_VERSION__</code>으로 bake한다. shared는 MCP 번들에 포함되며 별도 publish하지 않는다. 근거는 <code>code-kb/figwright/packages/plugin/vite.config.ts:6-14</code>, <code>code-kb/figwright/packages/mcp/tsdown.config.ts:22</code>이다.

현재 HEAD는 v0.4.0 이후 33개 commit과 158개 변경 파일을 포함하지만 package version은 아직 0.4.0이다. tool 수는 tag와 HEAD 모두 112개였으나, token loader·binding·election·grounding 등 의미 있는 동작은 대폭 변경됐다. 따라서 “v0.4.0” 문자열만으로 공개 release artifact와 이 분석 snapshot이 동일하다고 보면 안 된다.

라이선스 주의점은 배포 단위마다 다르다.

- MCP package의 <code>files</code> 목록은 <code>LICENSE</code>를 포함한다고 선언하지만 <code>packages/mcp/LICENSE</code>는 추적 파일에 없다. workspace root의 LICENSE를 pack 도구가 자동 포함하는지는 실제 tarball을 열어 확인해야 한다. 현재 환경에서는 pack을 실행하지 못했으므로 “npm tarball에 MIT 원문이 빠진다”고 단정할 수는 없다. 근거는 <code>code-kb/figwright/packages/mcp/package.json:32-35</code>와 전체 인벤토리다.
- GitHub Release의 plugin ZIP은 workflow상 <code>manifest.json</code>과 <code>dist/</code>만 담는다. root <code>LICENSE</code>를 포함하지 않으며, bundled Vue/Lucide 등 제3자 dependency notice를 생성·동봉하는 단계도 없다. 이는 정적 workflow로 확인되는 release artifact 공백이다. 근거는 <code>code-kb/figwright/.github/workflows/release.yml:57-63</code>, <code>code-kb/figwright/packages/plugin/package.json:15-19</code>다.

Release 전에는 npm tarball과 plugin ZIP 모두를 풀어 root MIT notice, 필요한 <code>THIRD_PARTY_NOTICES</code>, asset checksum/provenance를 검사하는 CI gate가 필요하다.

## 4. 목적과 사용자 흐름

### 4.1 제품 목적

README의 제품 정의는 “로컬 MCP server와 Figma plugin을 연결해 AI agent가 디자인을 읽고 canvas에 다시 쓰게 한다”다. 112개 registry에는 실제로 read 23, write 79, server-local 10개가 있으며, root 통합 테스트가 README의 숫자를 registry 길이에 고정한다. 이 주장은 코드로 검증된다. 근거는 <code>code-kb/figwright/README.md:18-41,186-190</code>, <code>code-kb/figwright/packages/mcp/src/tools/registry.ts:115-248</code>, <code>code-kb/figwright/test/docs-sync.test.ts</code>이다.

Provider-first란 고정 code generator가 아니라 다음 정보를 LLM에 제공하는 접근이다.

- 현재 Figma 구조와 visual dimensions.
- 현재 파일의 component, style, variable binding.
- 대상 코드베이스의 framework/styling/svg conventions.
- 재사용할 local component/token/icon 후보.
- prompt/skill에 담긴 변환 규칙.

즉, 결과 코드는 Figwright가 직접 emit하지 않고 MCP client의 모델이 생성한다. <code>code-kb/figwright/AGENTS.md</code>, <code>code-kb/figwright/packages/mcp/src/instructions.ts</code>, <code>code-kb/figwright/skills/figma-codegen/SKILL.md</code>가 이 설계를 명시한다.

### 4.2 설치·연결 흐름

1. MCP client가 <code>npx -y @figwright/mcp@latest</code> 또는 local dist를 stdio process로 실행한다.
2. 사용자는 GitHub Release의 plugin zip을 받고 Figma desktop에서 manifest를 development plugin으로 import한다.
3. plugin UI가 <code>ws://127.0.0.1:3055</code>에 연결해 <code>$hello</code> handshake를 수행한다.
4. 사용자가 파일과 selection을 바꾸면 sandbox가 context event를 UI로 보내고, UI가 foreground session의 <code>$activity</code>를 relay에 보낸다.
5. <code>ping</code>으로 server role, plugin session, version을 확인한다.

근거는 <code>code-kb/figwright/README.md:126-157</code>, <code>code-kb/figwright/packages/plugin/ui/composables/useRelaySession.ts:31-116</code>, <code>code-kb/figwright/packages/plugin/ui/relay/client.ts:245-347</code>이다.

### 4.3 Figma→코드 흐름

1. 사용자가 target frame/layer를 select하거나 같은 열린 파일의 node URL을 준다.
2. <code>get_design_context(full, dedupeComponents=true)</code>가 layout, appearance, text, tokens, component instances를 가져온다.
3. <code>component_map</code>, <code>token_map</code>, <code>icon_map</code>이 local codebase와 join한다.
4. agent가 detected stack에 맞춰 legacy code를 수정하거나 신규 코드를 쓴다.
5. project toolchain으로 render하고 Figma screenshot과 비교한다.
6. <code>design_diff</code> baseline을 남겨 후속 변경을 incremental update한다.

근거는 <code>code-kb/figwright/skills/figma-codegen/SKILL.md</code>와 여섯 reference 문서다.

### 4.4 코드→Figma 흐름

1. agent가 source code/spec와 연결된 Figma 파일의 variable/style/component를 읽는다.
2. 기존 Figma component는 <code>get_local_components</code>와 <code>get_component_api</code>로 찾는다. 단 전자는 지정 node subtree 또는 현재 selection만 검색하므로, file 전체는 <code>get_pages</code> 뒤 page별 bounded scan이 필요하다.
3. <code>create_*</code>, <code>set_*</code>, <code>bind_*</code>, <code>apply_*</code>, <code>batch</code>로 canvas를 구성한다.
4. <code>get_screenshot</code>으로 section 단위 검증을 반복한다.
5. source에 motion이 있으면 Motion API를 사용한다.

이 흐름은 prompt/skill 수준에서 구현돼 있다. 코드 parser가 자동으로 Figma tree를 만드는 단계는 없고, 현재 prompt/skill은 page별 component scan 절차나 available remote library key 검색 절차도 제공하지 않는다. <code>create_instance(componentKey)</code>는 이미 알고 있는 published key를 import할 수 있을 뿐 key discovery 도구가 아니다. 근거는 <code>code-kb/figwright/packages/mcp/src/prompts/code-to-figma.ts:14-29</code>, <code>code-kb/figwright/skills/figma-build/SKILL.md:29-36</code>, <code>code-kb/figwright/packages/mcp/src/tools/get-local-components.ts:7-20</code>, <code>code-kb/figwright/packages/mcp/src/tools/create-instance.ts:7-20</code>다.

## 5. 비용 제약 우회 메커니즘

### 5.1 무엇을 기술적으로 우회하는가

“우회”는 인증·권한을 깨는 의미가 아니라, 동일 목적을 다른 공식 실행 표면으로 수행한다는 의미로 한정해야 한다.

| 공식 비용/호출 제약 | Figwright의 대체 경로 | 구현 근거 |
|---|---|---|
| Figma REST API token과 REST endpoint별 quota | 사용자가 연 파일 안에서 Plugin API 호출 | <code>packages/plugin/src/code.ts</code>, <code>packages/plugin/src/handlers/*</code> |
| 공식 Figma MCP endpoint의 OAuth·지원 client·seat/plan·read-call rate 체계 | local MCP stdio + loopback relay + sideloaded plugin이므로 해당 endpoint를 호출하지 않음 | <code>packages/mcp/src/index.ts</code>, <code>packages/mcp/src/relay/relay.ts</code> |
| 공식 MCP의 canvas write/code-to-canvas 기능 | “write 유무”의 대체가 아님. Figwright는 local 79개 typed primitive와 자체 grounding/join을 제공하지만 공식 <code>use_figma</code>/<code>generate_figma_design</code>와 별도 구현 | <code>packages/mcp/src/tools/registry.ts</code>, Figma 공식 문서 |
| 원격 design export API | plugin의 <code>exportAsync</code>, image bytes, screenshot | <code>packages/plugin/src/handlers/get-screenshot.ts</code>, <code>export-pdf.ts</code>, <code>export-video.ts</code> |
| server-side fileKey fetch | 현재 열린 host document를 직접 읽음 | <code>packages/plugin/src/handlers/list-files.ts</code> |

이 구조에는 Figma personal access token 저장소가 없고, <code>list_files</code>도 현재 host file 하나만 반환한다. Figma URL 정규화는 URL에서 node-id만 꺼내며 fileKey로 원격 파일을 fetch하지 않는다. 근거는 <code>code-kb/figwright/packages/mcp/src/node-id.ts:1-9</code>, <code>code-kb/figwright/packages/plugin/src/handlers/list-files.ts</code>다.

현행 공식 MCP를 “read-oriented”라고 부르는 것은 2026-08-27 기준 부정확하다. 공식 remote MCP의 <code>use_figma</code>는 Plugin API context에서 native frame/component/variable/auto-layout을 생성·수정하고, <code>generate_figma_design</code>은 browser의 live UI를 editable Figma layer로 캡처한다. 공식 tool catalog에는 library search, asset upload/download 등 Figwright에 없는 기능도 있다. 반대로 Figwright에는 112개 세분화 tool, local codebase component/token/icon join, local endpoint라는 차별점이 있고 live DOM capture 및 remote library discovery는 없다. 따라서 기능 존재와 비용·접근 조건을 분리해야 한다.

- [Write to canvas — <code>use_figma</code>](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)
- [Code to canvas — <code>generate_figma_design</code>](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/)
- [Official MCP tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- [Official MCP rate limits & access](https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions/)
- [REST API rate limits](https://developers.figma.com/docs/rest-api/rate-limits/)

위 rate 문서는 2026-08-27에 확인했다. 공식 MCP와 REST API는 서로 다른 제한 체계이고, 공식 MCP에서도 read 계열과 rate-exempt 계열이 구분된다. 수치는 Figma가 변경할 수 있으므로 이 보고서에는 고정하지 않고 출시·운영 시 공식 페이지를 다시 조회해야 한다.

### 5.2 무엇을 우회하지 못하는가

- 사용자가 그 파일을 열고 plugin을 실행할 수 있어야 한다.
- write는 사용자의 file edit 권한과 editor mode 제약을 그대로 받는다.
- Dev Mode는 read-only라 모든 write가 실패한다.
- FigJam에는 components, variables, styles, Motion API가 없다.
- Starter/free 파일의 native variable mode 수 제한 같은 Figma plan gate는 Plugin API에서도 그대로 실패한다.
- 임의 file URL이나 fileKey를 headless하게 열어 처리할 수 없다.
- plugin panel, MCP client, local machine이 살아 있어야 한다.
- development plugin을 처음 import하는 흐름은 README 기준 desktop app을 요구한다.
- Community 공개, private organization 배포, commercial offering 승인은 별도 정책 문제다.
- 공식 Plugin API가 노출하지 않는 account/org data나 REST 전용 자원은 접근할 수 없다.

근거는 <code>code-kb/figwright/packages/plugin/protocol/editor-context.ts:37-58</code>, <code>code-kb/figwright/packages/plugin/manifest.json:7-13</code>, <code>code-kb/figwright/README.md:141,287-305</code>, <code>code-kb/figwright/skills/figma-build/references/author-design-system.md</code>다.

### 5.3 기술 가능성과 정책 적합성은 별개다

README는 “no Figma Dev Mode seat”, “no paid tier”, “free tier is enough”이라고 단정한다. Plugin API 경로가 API token/official MCP seat를 기술적으로 사용하지 않는다는 점은 맞다. 그러나 그 문장만으로 모든 사용자·배포 형태의 허용을 보장할 수 없다.

2026-08-27 기준 상위 조사에서 확인된 Figma 공식 문서는 Developer Resources에 MCP를 포함하고, Community review에서 paid offering workaround나 공식 MCP 외 programmatic AI access 성격을 문제 삼을 수 있음을 명시한다. 또한 plugin 사용은 file 권한과 seat/editor 조건을 받는다.

공식 plugin help의 현재 조건을 적용하면, 기술적으로 free/Starter 경로가 존재하더라도 사용자는 대상 Figma Design 파일에서 plugin을 실행할 수 있는 좌석 맥락과 <code>can edit</code> 권한을 갖춰야 한다. 즉 “API token이 필요 없다”와 “아무 계정·아무 파일에서 무료로 쓸 수 있다”는 같은 주장이 아니다.

- [Figma Developer Terms](https://www.figma.com/legal/developer-terms/)
- [Plugin and widget review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines)
- [Use plugins in files](https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files)
- [Guide to inspecting](https://help.figma.com/hc/en-us/articles/22012921621015-Guide-to-inspecting)
- [How plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/)
- [Create private plugins for an organization](https://help.figma.com/hc/en-us/articles/4404228629655-Create-private-plugins-for-an-organization)

따라서 통합 서비스는 다음 원칙이 필요하다.

1. 사용자가 합법적으로 접근·편집 가능한 열린 파일만 처리한다.
2. auth, seat, permission, billing control을 우회하거나 목적을 숨기는 기능을 설계하지 않는다.
3. local development/private use와 public Community/commercial distribution을 정책상 별도 product mode로 관리한다.
4. 공개 전에 Figma 정책·review와 법률 검토를 거친다.
5. “무료” 마케팅보다 “REST/official MCP를 사용하지 않는 local Plugin API architecture”라고 정확히 설명한다.

## 6. 워크스페이스와 기술 스택

### 6.1 monorepo 구조

| 영역 | 파일/라인 | 책임 |
|---|---:|---|
| MCP production source | 163 files / 14,303 lines | stdio server, tool registry, relay/election, joins, filesystem scanners |
| plugin sandbox source | 117 / 7,744 | Figma Plugin API handlers, serializer, dispatcher, panel control |
| plugin UI | 33 / 2,420 | Vue panel, WebSocket client, activity/context/debug |
| plugin protocol | 3 / 374 | UI↔sandbox bridge, editor limitations, panel control |
| shared source | 16 / 2,873 | Zod schemas, msgpack envelope, budgets, version |
| tests | 196 / 31,882 | unit/integration/E2E/contract gates |
| distributed skills | 13 / 1,379 | figma-codegen, figma-build workflows |

워크스페이스는 <code>packages/*</code> 세 패키지다. root와 plugin/shared는 private이고, <code>@figwright/mcp</code>만 publish한다. 근거는 <code>code-kb/figwright/pnpm-workspace.yaml</code>과 각 package manifest다.

### 6.2 핵심 런타임·도구

| 계층 | 기술 | 버전/설명 |
|---|---|---|
| 개발 runtime | Node | <code>.node-version</code> v24.17.0, root engine ≥24 |
| package manager | pnpm | 11.24.0 |
| language | TypeScript | 6.0.3, strict + exact optional + no unchecked index |
| MCP | <code>@modelcontextprotocol/server</code> | ^2.0.0 |
| validation | Zod | ^4.4.3 |
| wire | <code>@msgpack/msgpack</code> | ^3.1.3 |
| relay | <code>ws</code> | ^8.21.3 |
| repo traversal | fdir + ignore | gitignore-aware |
| source parse | oxc-parser | component/config AST |
| MCP build | tsdown | ESM, bin-only, shared bundled |
| plugin UI | Vue 3, Vite 8, Tailwind 4, VueUse | single-file HTML |
| plugin sandbox build | Vite IIFE | <code>dist/code.js</code> |
| tests | Vitest 4, happy-dom, Vue Test Utils | project aggregation |
| quality | oxlint, oxfmt, knip | CI gates |
| release | changelogen + GitHub Actions | npm OIDC/provenance |

직접 의존성은 <code>code-kb/figwright/package.json:34-47</code>, <code>packages/mcp/package.json:43-59</code>, <code>packages/plugin/package.json:15-35</code>, <code>packages/shared/package.json:17-21</code>에 있다.

### 6.3 runtime version 불일치

공개 MCP package engine은 Node <code>^20.19.0 || >=22.12.0</code>를 허용하지만 tsdown target은 <code>node24</code>이고 CI도 <code>.node-version</code>의 Node 24만 사용한다. README는 Node 20.19/22.12 지원을 주장한다. 코드가 우연히 그 runtime에서 동작할 수는 있지만 build target과 CI가 그 지원 범위를 보증하지 않는다. 최소한 Node 20.19와 22.12 matrix E2E가 필요하다. 근거는 <code>code-kb/figwright/packages/mcp/package.json:58-60</code>, <code>packages/mcp/tsdown.config.ts:7</code>, <code>.github/workflows/ci.yml:31-34,66-69</code>다.

### 6.4 project profile 탐지 범위

Profile이 선언하는 framework는 Next, Nuxt, React, Vue, Svelte, Solid, Angular, unknown이다. component extensions는 framework별로 TSX/JSX, Vue, Svelte, Angular TS를 선택한다. 근거는 <code>code-kb/figwright/packages/mcp/src/profile/profile.ts:14-35,586-620</code>다.

Styling enum은 tailwind, unocss, css-variables, scss, css-modules, plain-css, unknown을 선언하지만 현재 detector의 return path는 tailwind, unocss, scss, unknown뿐이다. css-variables/css-modules/plain-css는 enum에는 있으나 실제 detection 결과가 되지 않는다. CSS custom properties는 token loader fallback이 읽지만 profile label은 unknown으로 남는다. 근거는 <code>code-kb/figwright/packages/mcp/src/profile/profile.ts:26-35,639-728</code>다.

Profile은 root의 package.json과 config를 중심으로 JS/TS 생태계를 탐지한다. PHP, Ruby, .NET, native mobile, multi-language monorepo 전체를 자동 이해하지는 않는다. workspace package마다 적절한 <code>rootDir</code>를 줘야 한다.

## 7. 빌드·실행·개발·배포·릴리스

### 7.1 명령

| 명령 | 실제 동작 | 주의 |
|---|---|---|
| <code>pnpm install</code> | 의존성 설치 후 skills mirror | postinstall이 <code>skills/</code>를 <code>.claude/skills</code>로 복사 |
| <code>pnpm build</code> | recursive package build | MCP tsdown + plugin sandbox/UI Vite |
| <code>pnpm dev</code> | package dev 병렬 | plugin dev는 UI watch만 수행 |
| <code>pnpm typecheck</code> | package별 tsc/vue-tsc | shared도 typecheck |
| <code>pnpm test</code> | root Vitest projects | root cross-package 포함 |
| <code>pnpm release</code> | interactive changelogen release | clean tree/TTY 필요 |

근거는 <code>code-kb/figwright/package.json:17-32</code>다.

MCP는 source가 아니라 built <code>packages/mcp/dist/index.mjs</code>를 실행한다. local <code>.mcp.json</code>도 이 파일을 가리킨다. 변경 후 build와 MCP restart가 필수다. 근거는 <code>code-kb/figwright/.mcp.json</code>, <code>CLAUDE.md</code>다.

### 7.2 build 결과

- MCP: ESM executable, shebang 포함, d.ts 없음, shared alwaysBundle, build timestamp를 <code>BUILD_ID</code>로 주입.
- plugin sandbox: IIFE <code>dist/code.js</code>.
- plugin UI: Vue/Tailwind를 단일 <code>dist/index.html</code>로 묶음.
- 두 Vite build 모두 <code>emptyOutDir:false</code>라 순차 build가 서로의 결과를 보존한다.

근거는 <code>code-kb/figwright/packages/mcp/tsdown.config.ts</code>, <code>packages/plugin/vite.config.main.ts</code>, <code>packages/plugin/vite.config.ts</code>다.

개발 명령의 결함은 plugin <code>dev</code>가 UI config만 watch한다는 점이다. <code>packages/plugin/src/**</code> sandbox handler를 바꿔도 root <code>pnpm dev</code>만으로 <code>code.js</code>가 재생성되지 않는다. 근거는 <code>code-kb/figwright/packages/plugin/package.json:9-12</code>다. 또한 root <code>clean</code>은 <code>rm -rf</code>를 사용해 native Windows shell에서 이식성이 없다. Windows CI는 clean을 실행하지 않아 이 문제를 잡지 못한다.

### 7.3 release

Release script는 다음을 수행한다.

1. clean working tree와 semver를 검증한다.
2. Conventional Commit을 changelogen과 같은 범위로 분석한다.
3. pre-1.0 bump 왜곡을 보정해 interactive menu를 제공한다.
4. changelog/package version commit과 tag를 local로 만든다.
5. 별도 prompt에서만 <code>git push --follow-tags</code>를 실행한다.

Tag push workflow는 build/test 후 npm에 OIDC provenance로 publish하고, GitHub Release와 plugin zip을 만든다. 근거는 <code>code-kb/figwright/scripts/release.mjs</code>, <code>.github/workflows/release.yml</code>다.

Release workflow는 build/test만 실행하고 typecheck/lint/format/knip은 다시 실행하지 않는다. main CI를 통과한 tag만 만든다는 운영 규율에 의존한다. direct tag push를 기술적으로 막는 gate는 없다. 또한 plugin ZIP command는 <code>manifest.json dist</code>만 지정해 root MIT <code>LICENSE</code>와 bundled dependency notice를 제외한다. npm tarball과 plugin ZIP을 풀어 notice·파일 목록·checksum을 검사하는 artifact-level release test가 필요하다. 근거는 <code>code-kb/figwright/.github/workflows/release.yml:57-63</code>다.

## 8. 전체 아키텍처

### 8.1 구성요소

| 구성요소 | 실행 위치 | 핵심 책임 |
|---|---|---|
| MCP server | MCP client가 spawn한 Node process | MCP v2 등록, tool/prompt, local filesystem, dispatch |
| Election node | 각 MCP server process | leader/follower/conflicted state |
| Leader HTTP/WS | 단 하나의 process, 127.0.0.1:3055 | <code>/ping</code>, <code>/rpc</code>, <code>/abdicate</code>, WebSocket |
| Follower | 다른 MCP process | msgpack HTTP RPC로 leader에 forward |
| Relay | leader | plugin session, queue, routing, heartbeat, skew attribution |
| Plugin UI | Figma iframe | WebSocket client, activity/context/debug, sandbox bridge |
| Plugin sandbox | Figma Plugin API context | 실제 read/write handler 실행 |
| Plugin protocol | UI와 sandbox 양쪽 bundle | tool bridge, panel control, editor context |
| Shared | MCP/plugin bundle | envelope, codec, schemas, budgets, version |
| Skills/prompts | agent/MCP client | 순서·재사용·검증 워크플로 |

### 8.2 end-to-end 데이터 흐름

~~~text
MCP client
  │ JSON-RPC over stdio
  ▼
@figwright/mcp
  │ ToolSpec의 Zod input validation
  ├─ server-local scan/join/file write
  │
  └─ dispatchTool
       ├─ leader: Relay.sendRequest
       └─ follower: POST /rpc (MessagePack) ─► leader
                                             │
                                             ▼
                                  WebSocket / MessagePack envelope
                                             │
                                             ▼
                                  Plugin UI RelayClient
                                             │ @figwright/bridge postMessage
                                             ▼
                                  Figma sandbox dispatcher
                                             │ official Plugin API
                                             ▼
                                         open file
                                             │
                                  result/error 역방향 반환
~~~

핵심 파일은 <code>code-kb/figwright/packages/mcp/src/index.ts:79-205</code>, <code>packages/mcp/src/dispatch.ts</code>, <code>packages/mcp/src/relay/relay.ts</code>, <code>packages/plugin/ui/relay/client.ts</code>, <code>packages/plugin/ui/sandbox/tool-bridge.ts</code>, <code>packages/plugin/src/code.ts</code>다.

### 8.3 UI↔sandbox 경계

Figma plugin에는 서로 다른 두 runtime이 있다.

- sandbox는 <code>figma</code> API를 갖지만 DOM이 없다.
- UI iframe은 DOM/WebSocket을 갖지만 <code>figma</code> API가 없다.

Agent tool traffic은 Zod-tagged <code>@figwright/bridge</code> request/result/error로 왕복한다. Human window command는 별도 <code>@figwright/panel</code> one-way channel을 사용한다. 이 분리는 server↔plugin shared protocol과 panel 내부 protocol을 섞지 않는 좋은 경계다. 근거는 <code>code-kb/figwright/packages/plugin/protocol/bridge.ts:1-92</code>, <code>packages/plugin/protocol/panel-control.ts:1-31</code>다.

### 8.4 multi-plugin routing

여러 Figma 파일에서 plugin을 열 수 있다. 새 session은 현재 시각으로 active가 되고, 이후 selection/page 변화와 foreground visibility가 <code>$activity</code>를 보내 priority를 갱신한다. heartbeat와 tool reply는 activity로 세지 않는다. reconnect된 session은 이전 priority를 유지해 background file이 routing을 빼앗지 않게 한다. multi-call tool인 component/icon map은 active session을 한 번 resolve한 뒤 sub-call을 pin한다. 근거는 <code>code-kb/figwright/packages/mcp/src/relay/session.ts:53-78</code>, <code>packages/mcp/src/relay/relay.ts:266-295</code>, <code>packages/mcp/src/index.ts:86-93</code>다.

예외가 <code>token_map</code>이다. 이 handler만 일반 <code>dispatch</code>를 받고 <code>get_variable_defs</code>와 <code>get_styles</code>를 <code>Promise.all</code>로 별도 호출한다. 각 call이 그 순간의 active session을 다시 선택하므로 follower/multi-file 경로에서 activity가 두 <code>/rpc</code> 사이 바뀌면 file A의 variables와 file B의 styles를 합칠 수 있다. styles call 실패는 빈 styles로 degrade되어 일부 오류도 가려진다. <code>token_map</code>도 component/icon map처럼 한 번 resolve한 routed dispatcher를 받아야 하고, 결과에 serving session/file provenance를 남겨야 한다. 근거는 <code>code-kb/figwright/packages/mcp/src/index.ts:87-93,139-143</code>, <code>code-kb/figwright/packages/mcp/src/tools/token-map.ts:131-151</code>, <code>code-kb/figwright/packages/mcp/src/relay/relay.ts:162-189,279-297</code>다.

## 9. 등록 surface 전체 집계

### 9.1 tool 수와 handler 수

| 항목 | 수량 | 검증 |
|---|---:|---|
| MCP tools | 112 | <code>ALL_TOOL_SPECS</code> |
| read kind | 23 | static extraction |
| write kind | 79 | static extraction |
| local kind | 10 | static extraction |
| destructive tools | 11 | spec flag |
| plugin same-name handlers | 105 | registry factory map |
| same-name plugin handler가 없는 tools | 7 | cross-package test exception set |
| server special handlers | 13 | <code>SPECIAL_HANDLERS</code> |
| MCP prompts | 2 | prompt registry |
| distributed agent skills | 2 | skills manifests |
| batch allowlist operations | 30 | plugin <code>INVERSES</code> |

112개 중 plugin handler가 없는 7개는 <code>save_screenshots</code>, <code>analyze_project</code>, <code>scan_components</code>, <code>component_map</code>, <code>token_map</code>, <code>icon_map</code>, <code>design_diff</code>다. “server-only”라는 말은 같은 이름의 plugin handler가 없다는 뜻이다. map/diff는 다른 plugin read를 내부적으로 재사용한다. 근거는 <code>code-kb/figwright/test/tool-registry.test.ts:20-40</code>다.

### 9.2 112개 tool 기능 분류

| 분류 | 수 | 전체 tool |
|---|---:|---|
| 연결·문서·selection·viewport | 9 | ping, get_selection, get_document, get_node, get_nodes_info, get_metadata, get_pages, list_files, get_viewport |
| canvas 검색·scan | 3 | search_nodes, scan_text_nodes, scan_nodes_by_types |
| design system·개발 정보 read | 6 | get_styles, get_variable_defs, get_local_components, get_component_api, get_fonts, get_annotations |
| prototype·Motion read | 3 | get_reactions, get_motion_styles, get_node_motion |
| grounding·render read | 2 | get_design_context, get_screenshot |
| filesystem export local | 4 | save_screenshots, save_image_fills, export_pdf, export_video |
| project profile·AST scan local | 2 | analyze_project, scan_components |
| codebase grounding joins local | 3 | component_map, token_map, icon_map |
| incremental design diff local | 1 | design_diff |
| 기본 노드·visual·layout write | 28 | set_fills, set_text, set_text_properties, set_text_range, create_frame, set_opacity, set_visible, rename_node, delete_nodes, create_text, create_rectangle, set_corner_radius, set_strokes, move_nodes, set_position, resize_nodes, set_auto_layout, set_layout_props, set_layout_grids, set_blend_mode, set_mask, set_arc, set_constraints, rotate_nodes, lock_nodes, unlock_nodes, clone_node, set_effects |
| shared styles write | 9 | create_paint_style, create_text_style, create_effect_style, create_grid_style, update_paint_style, update_text_style, update_effect_style, apply_style_to_node, delete_style |
| variables write | 10 | create_variable_collection, add_variable_mode, create_variable, set_variable_value, bind_variable_to_node, bind_variable_to_paint, rename_variable, set_variable_code_syntax, delete_variable, delete_variable_collection |
| structure·bulk text write | 6 | group_nodes, ungroup_nodes, reparent_nodes, reorder_nodes, find_replace_text, batch_rename_nodes |
| pages write | 4 | add_page, delete_page, rename_page, navigate_to_page |
| prototype·components·assets write | 16 | set_reactions, remove_reactions, swap_component, set_instance_properties, add_component_property, bind_component_property, edit_component_property, delete_component_property, detach_instance, import_image, import_svg, create_ellipse, create_component, create_section, create_instance, combine_as_variants |
| Motion write | 5 | apply_animation_style, remove_animation_style, apply_manual_keyframe_track, remove_manual_keyframe_track, set_timeline_duration |
| atomic batch | 1 | batch |
| 합계 | 112 | read 23 + local 10 + write 79 |

### 9.3 prompt와 skill

| surface | 인자 | 역할 | 근거 |
|---|---|---|---|
| <code>figma_to_code</code> prompt | optional nodeId | full context + component/token reuse + responsive/render verify | <code>packages/mcp/src/prompts/figma-to-code.ts</code> |
| <code>code_to_figma</code> prompt | 없음 | design system discovery + create/bind/verify | <code>packages/mcp/src/prompts/code-to-figma.ts</code> |
| <code>figma-codegen</code> skill | agent-triggered | Figma→code router, 6 references | <code>skills/figma-codegen/SKILL.md</code> |
| <code>figma-build</code> skill | agent-triggered | code/spec→Figma router, 4 references | <code>skills/figma-build/SKILL.md</code> |

MCP initialize instructions도 항상 짧은 양방향 workflow를 전달한다. non-skill client를 위한 fallback이라는 설계는 좋다. 근거는 <code>code-kb/figwright/packages/mcp/src/instructions.ts</code>다.

## 10. Grounding 심층 분석

### 10.1 get_design_context

MCP public path의 default는 full + component dedupe다. plugin handler 자체의 default는 compact + dedupe false지만 server wrapper가 explicit 값을 주입한다. 이 차이는 내부 consumer와 public tool을 분리하려는 의도다. 근거는 <code>code-kb/figwright/packages/mcp/src/tools/design-context-guard.ts:246-269</code>, <code>packages/plugin/src/handlers/get-design-context.ts:625-655</code>다.

Full detail은 다음을 보존한다.

- identity, geometry, visibility, rotation, opacity.
- fills/strokes/gradient/image/video/pattern metadata.
- per-side stroke, align, dash, cap, join.
- per-corner radius, blend, mask, arc.
- H/V/GRID auto-layout, padding, gap, wrapping, alignment.
- HUG/FILL/FIXED, grow/align/absolute positioning, min/max, constraints.
- layout grid, scroll, fixed children, aspect ratio.
- text content, font, leading, tracking, case, decoration, alignment, truncation, paragraphs, wrap, rich segments, hyperlinks/lists.
- annotations.
- style IDs, variable bindings, component properties.
- component set identity and compact Motion summary.

Grounding projection의 recurring risk를 test가 ratchet한다. serializer schema의 새 field가 full projection, layout tier, 또는 이유 있는 drop allowlist 중 하나에 들어가지 않으면 실패한다. 근거는 <code>code-kb/figwright/packages/plugin/test/handlers/projection-coverage.test.ts</code>, <code>packages/mcp/test/tools/layout-tier-coverage.test.ts</code>다.

### 10.2 dedupe와 payload degradation

- 같은 main component의 첫 instance만 subtree를 확장한다.
- 이후 instance는 <code>deduped:true</code>와 main ID를 갖고 children을 생략한다.
- 실제 text는 <code>textOverrides</code>로, non-text visual 변경은 <code>propertyOverrides</code>로 남긴다.
- 반복 style bundle은 content hash key의 <code>globalVars.styles</code>에 한 번 저장한다.
- variable/style ID는 top-level name/type/codeSyntax map으로 resolve한다.

근거는 <code>code-kb/figwright/packages/plugin/src/handlers/get-design-context.ts:351-550,698-714</code>, <code>packages/shared/src/design-context-dedupe.ts</code>다.

Public payload guard는 다음 순서다.

1. full 결과가 24,000 estimated tokens 안이면 그대로 반환.
2. small overshoot면 layout+content를 남기고 appearance를 제거.
3. 그래도 크면 section plan을 우선 반환.
4. split 불가능한 tree만 layout-only, 그 다음 compact geometry로 내린다.
5. full serialization 전 1,500 nodes 초과면 plugin이 section plan으로 즉시 bail.
6. plan section은 최대 60개다.

근거는 <code>code-kb/figwright/packages/shared/src/design-context.ts:487-547</code>, <code>packages/mcp/src/tools/design-context-guard.ts</code>, <code>packages/plugin/src/handlers/get-design-context.ts:553-622</code>다.

장점은 over-limit 전체 실패 대신 section 단위 full fidelity를 보존한다는 점이다. 한계는 60개를 넘는 매우 넓은 tree에서 section이 생략되고, internal consumer(component/icon map, design_diff)는 public budget guard를 우회해 raw full tree를 받는다는 점이다.

### 10.3 component grounding

Pipeline은 다음과 같다.

1. project profile 탐지.
2. OXC로 React/Solid/Angular AST, Vue/Svelte SFC script를 scan.
3. design context의 instance를 main component/set별로 group.
4. Unicode-aware casefold + bigram Dice로 name join.
5. code props가 Figma axes와 맞으면 axis당 0.05, 최대 0.1 bonus.
6. confidence floor 0.5, caller threshold 기본 0.7, absolute high 0.85.
7. 0.05 이내 runner-up은 ambiguity로 표시하고 high를 medium으로 내림.
8. <code>docs/figma-component-map.md</code> override가 최고 authority.

근거는 <code>code-kb/figwright/packages/mcp/src/tools/component-map.ts</code>, <code>packages/mcp/src/join/component-map.ts:99-162,268-328</code>, <code>packages/mcp/src/scan/scan.ts</code>다.

좋은 점은 component folder convention을 가정하지 않고, incomplete prop extraction을 <code>propsExtracted:false</code>로 솔직하게 표시한다는 점이다. 한계는 imported prop type, deep HOC, parse failure가 partial/unknown으로 남고, file read/parse failure를 결과 note 없이 삼킨다는 점이다. 5,000 file cap에도 truncated flag가 없다.

### 10.4 token grounding

Token source는 다음을 지원한다.

- Tailwind v4 CSS <code>@theme</code> / custom properties.
- Tailwind v3 static JS/TS theme object.
- UnoCSS static theme object와 wind vocabulary.
- plain CSS custom properties fallback.
- SCSS <code>$variables</code>와 SCSS 안의 custom properties.
- single-solid shared paint style를 pseudo-token으로 변환.
- Style Dictionary 등 generated token build tool의 output 후보 안내.

근거는 <code>code-kb/figwright/packages/mcp/src/tokens/load.ts</code>, <code>tokens/js-config.ts</code>, <code>tokens/css-scan.ts</code>, <code>tokens/figma-tokens.ts</code>다.

Join은 scale step을 hard key로 사용하고 stem을 fuzzy match한다. exact hex value는 강한 확인 신호지만 같은 값을 가진 semantic sibling이 여러 개면 confidence 0.7로 cap하고 ambiguity를 노출한다. typography collection 안의 size↔text synonym만 contextually 연다. utility project에서 spacing, line-height, font-weight built-in scale을 project token 부재로 오판하지 않는다. multi-mode variable은 mode별 값을 보존한다. 근거는 <code>code-kb/figwright/packages/mcp/src/join/token-map.ts</code>다.

다중 파일 correctness 공백이 있다. <code>token_map</code>의 variable/style 두 read는 session-pinned dispatcher를 공유하지 않으므로 서로 다른 열린 Figma 파일의 결과가 한 map에 섞일 수 있다. 이는 matcher 자체 문제가 아니라 orchestration provenance 문제이며, 현재 token-map unit test는 주입된 한 dispatcher의 함수 결과만 검증해 follower activity flip을 다루지 않는다. 근거는 <code>code-kb/figwright/packages/mcp/src/index.ts:139-143</code>, <code>code-kb/figwright/packages/mcp/src/tools/token-map.ts:139-151</code>, <code>code-kb/figwright/packages/mcp/test/tools/token-map.test.ts</code>다.

한계는 다음과 같다.

- exact value matching은 hex color 중심이다. OKLCH↔hex color-space equivalence와 숫자 unit matching은 없다.
- computed/imported/spread config는 static AST가 완전히 평가하지 못한다.
- indented <code>.sass</code>는 지원하지 않는다.
- CSS aggregation 200 files, SCSS 300 files cap에 truncated signal이 없다.
- raw color annotation은 동일 값 candidate가 3개를 초과하면 그 색을 통째로 생략한다.
- styling profile의 css-variables/css-modules/plain-css label은 실제 detector가 만들지 않는다.

### 10.5 icon grounding

- name marker가 있는 instance/component 또는 의미 있는 이름의 VECTOR/BOOLEAN_OPERATION을 icon으로 모은다.
- repo SVG를 gitignore-aware scan하고 filename을 near-exact match한다.
- icon match floor는 0.85다.
- SVG markup에서 currentColor/fixed/multi-color/unknown contract를 추정한다.
- installed icon library 12종을 dependency로 탐지한다: Lucide·Tabler·Heroicons·Phosphor의 React/Vue 패키지 8개와 react-icons, react-feather, Radix Icons, unplugin-icons다.
- SVG import mode는 detected loader에 따라 component/url hint를 준다.

근거는 <code>code-kb/figwright/packages/mcp/src/tools/icon-map.ts</code>, <code>packages/mcp/src/join/icon-map.ts</code>, <code>packages/mcp/src/icons/repo-icons.ts</code>다.

정밀도 우선 정책은 잘 설계됐다. 다만 synonyms가 없고, 같은 이름의 SVG가 여러 경로에 있을 때 component/token join 같은 ambiguity surface가 없다. 또한 currentColor가 하나라도 있으면 fixed accent와 함께 있는 복합 SVG도 currentColor로 분류될 수 있어 recolor guidance가 과도할 가능성이 있다.

### 10.6 profile과 scan

Profile은 framework, language, styling, classNaming, SVG loader, component extensions와 evidence를 반환한다. SCSS/Less/Stylus/PostCSS SFC style을 읽어 BEM compound class가 ampersand인지 flat인지 tally한다. repository traversal은 baseline ignored dirs, dot path, <code>.gitignore</code>, <code>.git/info/exclude</code>, 5,000-file cap을 결합한다. 근거는 <code>code-kb/figwright/packages/mcp/src/profile/profile.ts</code>, <code>packages/mcp/src/repo-walk.ts:9-90</code>다.

한계는 root package 중심 JS/TS detector이고, scan failure/cap을 caller가 구별하기 어렵다는 점이다.

### 10.7 design_diff

첫 호출은 <code>.figwright/snapshots/{sanitized-node-id}.json</code>에 format version 2 baseline을 쓴다. 다음 호출은 node ID로 flatten하고, global style ref와 token ID를 readable value/name으로 resolve한 뒤 field, parent, sibling order 차이를 반환한다. <code>update:true</code>는 baseline을 현재 상태로 바꾼다. 근거는 <code>code-kb/figwright/packages/mcp/src/tools/design-diff.ts</code>, <code>packages/mcp/src/diff/design-diff.ts</code>다.

한계는 다음과 같다.

- Figma node ID가 유지되는 같은 파일 안의 변화에 가장 적합하다. copy/recreate는 add/remove로 보인다.
- snapshot 경로가 오직 sanitized nodeId이고 snapshot provenance에도 file key/name/session identity가 없다. 서로 다른 Figma 파일이 같은 nodeId를 사용하면 baseline이 충돌하며, root name/type까지 같으면 identity note도 나오지 않아 잘못된 cross-file diff를 정상 결과처럼 반환할 수 있다.
- corrupt/stale snapshot을 null로 취급해 다음 call에서 조용히 re-baseline한다.
- write가 temp+atomic rename이나 file lock을 사용하지 않는다.
- snapshot에는 design content가 포함된다.
- internal full context라 public 24k token/node bail을 쓰지 않는다.
- code-side diff나 code↔node mapping은 없다.

따라서 snapshot은 최소 <code>{fileIdentity}/{nodeId}.json</code>으로 namespace하고, file identity·serving session generation·captured root identity를 provenance에 저장해야 한다. file identity 불일치는 조용한 re-baseline보다 명시적 오류/승인을 요구하는 편이 안전하다. 현 snapshot schema와 key 생성 근거는 <code>code-kb/figwright/packages/mcp/src/tools/design-diff.ts:61-70,87-120,157-171</code>이고, name/type만 비교하는 보조 경고는 같은 파일 <code>:89-105</code>다.

## 11. 양방향 기능의 실제 대칭성

| 기능 축 | Figma→코드 | 코드→Figma | 평가 |
|---|---|---|---|
| 구조 | full hierarchy/layout grounding | create/reparent/reorder/auto-layout | 강함 |
| 스타일 | fill/stroke/effect/style/token read | solid+gradient, effects, styles, bindings | 대체로 강함 |
| 텍스트 | rich segments/list/link/paragraph read | node/range typography write | 강함 |
| 컴포넌트 | instance/set/property API + code join | create/instance/property/variants | 강함 |
| 변수 | values/modes/aliases/code syntax read | CRUD/mode/value/bind/code syntax | EASING/TIMING write 불가 |
| assets | image fill bytes, screenshot, PDF/video | import image/SVG | write path가 더 제한적 |
| motion | summary/full tracks/video export | preset/manual track/timeline | beta/editor 제한 |
| responsive | constraints/grid/layout/aspect grounding | layout bounds/constraints/grid write | 실제 breakpoint semantics는 LLM 책임 |
| sync | design baseline diff | code diff 없음 | 비대칭 |
| code semantics | component/token/icon join | deterministic code parser 없음 | 크게 비대칭 |

Read paint는 IMAGE, VIDEO, SHADER, PATTERN까지 보존하지만 write paint schema는 SOLID와 네 gradient만 허용한다. raster는 <code>import_image</code>가 새 rectangle을 만들 뿐 기존 임의 node의 image/video/pattern fill round-trip을 제공하지 않는다. Effect도 shadow와 layer/background blur 중심이다. 근거는 <code>code-kb/figwright/packages/shared/src/serialized-node.ts:37-114</code>, <code>packages/mcp/src/tools/paint-schema.ts</code>, <code>packages/plugin/src/handlers/set-fills.ts:6-43</code>다.

Style write에는 create_grid_style은 있으나 update_grid_style은 없다. Variable EASING/TIMING은 Figma Plugin API가 create/edit을 거부하므로 read-only다. 근거는 <code>code-kb/figwright/packages/plugin/src/handlers/create-variable.ts</code>다.

## 12. 주요 디렉터리·모듈 책임

| 경로 | 책임 |
|---|---|
| <code>packages/mcp/src/index.ts</code> | process boot, election, tool/prompt registration, special handlers, stdio lifecycle |
| <code>packages/mcp/src/tools/registry.ts</code> | 112개 tool single source of truth |
| <code>packages/mcp/src/tools/spec.ts</code> | kind, destructive, injected/server-only argument metadata |
| <code>packages/mcp/src/dispatch.ts</code> | leader/follower dispatch, retry, skew capture, session pin |
| <code>packages/mcp/src/election/*</code> | role state, health, abdication, lock, follower RPC |
| <code>packages/mcp/src/relay/*</code> | WS sessions, active routing, queue, heartbeat, skew |
| <code>packages/mcp/src/profile/*</code> | project stack and stylesheet convention detection |
| <code>packages/mcp/src/scan/*</code> | component AST/SFC extraction |
| <code>packages/mcp/src/join/*</code> | component/token/icon matching and status |
| <code>packages/mcp/src/tokens/*</code> | CSS/SCSS/JS config parsing, loading, value index |
| <code>packages/mcp/src/diff/*</code> | pure design-context diff |
| <code>packages/mcp/src/prompts/*</code> | cross-client workflows |
| <code>packages/plugin/src/code.ts</code> | sandbox entry, context events, dispatcher |
| <code>packages/plugin/src/serializer.ts</code> | Figma node→wire-safe projection |
| <code>packages/plugin/src/handlers/registry.ts</code> | 105 handler map + idempotency wrapping |
| <code>packages/plugin/src/handlers/*</code> | actual Plugin API calls |
| <code>packages/plugin/ui/relay/client.ts</code> | WS hello/reconnect/heartbeat/request logging |
| <code>packages/plugin/ui/sandbox/*</code> | iframe→sandbox RPC |
| <code>packages/plugin/ui/components/*</code> | Activity/Context/Debug panel |
| <code>packages/plugin/protocol/*</code> | panel bridge/control/editor limitation |
| <code>packages/shared/src/envelope.ts</code> | req/res/err/evt envelope |
| <code>packages/shared/src/codec.ts</code> | MessagePack encode/decode + envelope parse |
| <code>packages/shared/src/design-context.ts</code> | grounding schemas and budgets |
| <code>packages/shared/src/tool-budgets.ts</code> | nested timeout source of truth |
| <code>packages/shared/src/version.ts</code> | semantic feature skew policy |
| <code>skills/*</code> | agent orchestration and fidelity rules |
| <code>test/*</code> | package-crossing registry/docs consistency |

## 13. 스키마, codec, version skew, idempotency

### 13.1 schema와 codec

MCP input은 각 ToolSpec의 built Zod object를 MCP SDK v2에 직접 전달한다. SDK가 advertised JSON Schema를 만들고 runtime input을 검증한다. tool kind와 destructive flag가 MCP annotation을 생성한다. 근거는 <code>code-kb/figwright/packages/mcp/src/index.ts:161-191</code>, <code>packages/mcp/src/tools/spec.ts</code>, <code>packages/mcp/src/tools/annotations.ts</code>다.

Server↔plugin wire는 MessagePack이다. Envelope는 version, id, timestamp, sessionId와 req/res/err/evt discriminator를 갖는다. envelope 자체는 decode 시 Zod parse한다. follower RPC도 별도 Zod schema로 parse한다. 근거는 <code>code-kb/figwright/packages/shared/src/envelope.ts:5-51</code>, <code>packages/shared/src/codec.ts</code>, <code>packages/shared/src/rpc.ts</code>다.

중요한 한계는 shared에 112개 exported schema declaration이 있어도 production이 모든 tool result를 해당 ResultSchema로 parse하지는 않는다는 점이다. Envelope와 bridge의 <code>result</code>는 <code>unknown</code>이고, server special handler는 plugin result를 TypeScript cast로 신뢰한다. 대부분의 result schema는 type/test contract다. 따라서 current source끼리는 test가 drift를 잡지만, skewed/오염된 plugin result가 runtime end-to-end validation을 통과한다고 볼 수 없다.

### 13.2 protocol skew와 product skew

- wire <code>PROTOCOL_VERSION=0.1.0</code> 불일치는 hard reject다.
- product feature skew는 연결을 허용하고 모든 served result에 warning을 붙인다.
- first warning은 update 방법을 포함하고 이후에는 짧은 summary를 쓴다.
- threshold는 server own version을 넘지 않게 cap한다.
- unparseable plugin version은 incompatible로 간주한다.
- follower 호출에도 leader가 notice를 RPC response에 실어 보낸다.

근거는 <code>code-kb/figwright/packages/mcp/src/relay/relay.ts:350-448</code>, <code>packages/shared/src/version.ts</code>, <code>packages/mcp/src/tools/skew-notice.ts</code>다.

이 정책은 reconnect storm을 피하는 현실적 선택이지만 semantic correctness를 보장하지 않는다. 구 plugin은 새 argument를 조용히 버리고 <code>{ok:true}</code>를 반환할 수 있다. 경고는 오작동을 설명할 뿐 막지 않는다.

<code>plugin-contract.json</code> gate는 모든 plugin-facing argument path와 injected <code>budget</code>/<code>forVision</code>/<code>requestId</code>를 snapshot한다. 새 argument가 생기면 human이 compatibility를 판단하고 floor를 갱신해야 한다. 좋은 review ratchet이지만 result shape와 semantic behavior까지 자동 판정하지는 않는다. 근거는 <code>code-kb/figwright/packages/mcp/test/plugin-contract.test.ts</code>, <code>plugin-contract.ts</code>다.

### 13.3 idempotency와 batch

Server는 write call마다 stable <code>requestId</code>를 args에 주입한다. Plugin registry는 79개 write handler를 60초 in-memory cache로 감싼다. <code>batch</code>는 raw writes를 호출하고 batch 자체만 한 번 wrap한다. 근거는 <code>code-kb/figwright/packages/mcp/src/index.ts:161-168</code>, <code>packages/plugin/src/idempotency.ts</code>, <code>packages/plugin/src/handlers/registry.ts:110-226</code>다.

Batch는 30개 invertible operation만 허용한다. 모든 capture를 mutation 전에 수행하고, apply 실패 시 역순 undo한다. undo 실패는 숨기지 않고 “document may be partially changed”를 반환한다. <code>create_component(fromNodeId)</code>와 indexed Motion track 등 faithful inverse가 없는 variant는 거절한다. 근거는 <code>code-kb/figwright/packages/plugin/src/handlers/batch.ts</code>다.

Idempotency에는 세 가지 공백이 있다.

1. Cache는 completed result만 저장한다. 같은 requestId가 첫 실행 완료 전에 동시에 들어오면 둘 다 miss하고 side effect를 두 번 실행할 수 있다. 테스트도 5회 sequential retry만 검증한다. <code>code-kb/figwright/packages/plugin/test/idempotency.test.ts</code>.
2. Cache는 plugin process memory와 60초 TTL에 묶인다. plugin restart 후 replay나 장기 지연 replay는 dedupe되지 않는다.
3. 이미 dispatch된 write 처리 중 WebSocket이 끊기면 relay는 entry를 <code>dispatched=true</code>로 둔 채 timeout까지 유지하고, 같은 session reconnect의 <code>flushQueue</code>는 이를 건너뛴다. sandbox mutation은 끝났지만 old socket reply만 유실될 수 있어 caller는 성공/실패를 알 수 없다. 사용자가 새 MCP call을 하면 새 requestId이므로 기존 cache가 duplicate mutation을 막지 못한다.

통합 서비스에서는 requestId→in-flight Promise와 completed result를 함께 저장하고, write journal 또는 durable operation status를 도입해야 한다. 상태를 최소 <code>queued → dispatched → acknowledged → completed | outcome-unknown</code>으로 모델링하고, read만 안전하게 replay하며 write는 같은 requestId의 resume/조회 프로토콜 또는 명시적 사용자 확인 없이 새 ID로 재시도하지 않아야 한다. 근거는 <code>code-kb/figwright/packages/mcp/src/relay/relay.ts:38-54,289-313</code>, <code>packages/mcp/src/relay/session.ts:84-97</code>, <code>packages/plugin/ui/relay/client.ts:354-435</code>, <code>packages/plugin/src/idempotency.ts:21-45</code>다.

## 14. 오류, 재시도, timeout, leader/follower

### 14.1 timeout 계층

| 계층 | 기본 tool | heavy tool | 근거 |
|---|---:|---:|---|
| UI→sandbox bridge | 30s | 120s | <code>getToolBudget</code> |
| leader relay→plugin | 35s | 125s | base + 5s |
| follower→leader RPC | 40s | 130s | base + 10s |

Heavy set은 get_screenshot, save_screenshots, save_image_fills, export_pdf, get_document, get_design_context, get_node, get_nodes_info, scan_text_nodes, scan_nodes_by_types다. <code>export_video</code>는 description에서 heavy render라고 하지만 heavy set에는 없어 30/35/40초 기본을 받는다. 긴 animation export에는 잠재 timeout mismatch다. 근거는 <code>code-kb/figwright/packages/shared/src/tool-budgets.ts:18-53</code>, <code>packages/mcp/src/tools/export-video.ts</code>다.

### 14.2 dispatch retry

- direct leader path는 relay error 후 재시도하지 않는다.
- follower path는 transport/fetch/ECONNREFUSED/relay stopping 계열만 최대 3회, 1.5초 간격으로 재시도한다.
- semantic error, method not found, timeout은 재시도하지 않는다.
- conflicted role은 즉시 actionable NotLeader error를 낸다.
- election이 in-flight follower call 중 conflict를 선언하면 AbortSignal로 끊는다.

근거는 <code>code-kb/figwright/packages/mcp/src/dispatch.ts:7-138</code>다.

Plugin이 아직 연결되지 않았으면 leader relay는 request를 즉시 PluginDisconnected로 실패시키지 않고 queue에 넣고 timeout까지 기다린다. 따라서 <code>ping</code>을 먼저 하라는 workflow가 중요하다. <code>PLUGIN_DISCONNECTED</code> 매핑 코드는 있지만 unpinned no-plugin queue는 보통 timeout으로 끝난다. 근거는 <code>code-kb/figwright/packages/mcp/src/relay/relay.ts:162-190</code>, <code>packages/mcp/src/election/leader-endpoints.ts:225-238</code>다.

### 14.3 heartbeat와 reconnect

- 양쪽 heartbeat interval 15초, 2 misses 후 timeout.
- plugin이 in-flight request를 처리 중이면 leader는 heartbeat timeout을 defer한다.
- session disconnect grace는 30초다.
- hello timeout은 plugin 1초, server 5초다.
- cold start poll ceiling은 150ms, live reconnect는 250ms에서 최대 5초 exponential backoff다.
- foreground 복귀/context event가 backoff sleep을 깨운다.

근거는 <code>code-kb/figwright/packages/shared/src/heartbeat.ts</code>, <code>packages/mcp/src/relay/session.ts:29</code>, <code>packages/plugin/ui/relay/client.ts:48-68,447-500</code>다.

30초 reconnect grace는 session identity와 routing priority를 보존하지만 in-flight operation resume는 제공하지 않는다. socket close는 session의 socket만 null로 만들고 pending entry는 그대로 둔다. 같은 session이 돌아와도 <code>flushQueue</code>는 <code>dispatched=true</code>를 건너뛰며, plugin handler도 시작 당시 old <code>ws</code> closure로 결과를 보내므로 새 socket에 완료 결과를 전달하는 journal이 없다. 그 결과 caller는 tool timeout만 받고, write side effect는 적용 여부가 불명확한 <code>outcome-unknown</code> 상태가 된다. 근거는 <code>code-kb/figwright/packages/mcp/src/relay/session.ts:84-97</code>, <code>packages/mcp/src/relay/relay.ts:289-313,350-355,415-455</code>, <code>packages/plugin/ui/relay/client.ts:354-435</code>다.

여기서 이미 dispatch된 write를 reconnect 시 무조건 다시 보내는 것도 안전한 수정이 아니다. sandbox에서 mutation이 끝났다면 중복이 된다. read는 replay 가능하지만 write는 동일 requestId의 plugin-side in-flight/completed journal과 resume handshake가 있을 때만 재전송하고, 그렇지 않으면 즉시 outcome-unknown 오류와 복구 안내를 반환해야 한다. 현재 source에는 socket-flap delayed-write side-effect count를 검증하는 E2E가 없다.

### 14.4 election

State는 unknown, leader, follower, conflicted다.

1. process가 127.0.0.1:3055 bind를 시도한다.
2. 성공하면 leader와 relay가 된다.
3. EADDRINUSE면 <code>/ping</code>으로 genuine Figwright leader인지 확인한다.
4. port가 잡혔지만 ping이 안 되면 50ms 후 한 번 더 확인하고 conflicted가 된다.
5. follower는 1초 tick으로 leader health와 buildId를 본다.
6. 더 큰 build timestamp를 가진 process는 <code>/abdicate</code>를 요청한다.
7. leader는 pending call 또는 최근 10초 traffic이 있으면 busy로 거절한다.
8. accepted handoff 후 old leader는 5초 yield grace를 둔다.
9. refused/unsupported abdication은 60초 backoff한다.
10. 5번 연속 silent+port-held면 약 12초 후 wedge로 진단한다.

근거는 <code>code-kb/figwright/packages/mcp/src/election/election.ts:10-45,85-280</code>, <code>leader-endpoints.ts:9-19</code>다.

여기서 buildId는 semantic version, commit, source capability가 아니라 tsdown build 시 <code>Date.now()</code>로 bake한 epoch milliseconds다. 따라서 정확한 의미는 “가장 나중 wall-clock timestamp로 빌드된 bundle이 leader를 이긴다”이다. 오래된 source를 나중에 rebuild하거나 build host clock이 skew/rollback되면 source freshness 순서와 어긋날 수 있다. capability/semver/commit identity를 함께 비교하지 않으므로 “newest source wins”로 해석하면 안 된다. 근거는 <code>code-kb/figwright/packages/mcp/src/build-id.ts:1-16</code>, <code>code-kb/figwright/packages/mcp/tsdown.config.ts:15-19</code>, <code>code-kb/figwright/packages/mcp/src/election/election.ts:193</code>다.

Leader lock은 temp의 <code>figwright/leader-{port}.json</code>에 pid/build/version/process start를 mode 0600으로 쓴다. reader는 live process start time을 다시 확인해 recycled pid를 막고, stopped process에는 SIGCONT를 보낸다. Windows는 process identification/SIGCONT가 없어 anonymous conflict message만 제공한다. 근거는 <code>code-kb/figwright/packages/mcp/src/election/leader-lock.ts</code>다.

## 15. 보안과 신뢰 경계

### 15.1 구현된 방어

- HTTP/WS server는 127.0.0.1에만 bind한다.
- Host가 localhost, 127.0.0.1, [::1] 중 하나인지 검사해 DNS rebinding을 막는다.
- WS Origin은 absent/null/Figma origin만 허용한다. 이는 일반 cross-site 연결을 줄이는 defense-in-depth이지 plugin authentication은 아니다.
- follower HTTP endpoint는 Origin이 없어야 한다.
- POST <code>/rpc</code>는 non-simple <code>application/msgpack</code>, <code>/abdicate</code>는 JSON content type을 요구한다.
- <code>FIGWRIGHT_ALLOW_ANY_ORIGIN=1</code>은 origin만 완화하고 Host gate는 유지한다.
- GitHub workflow action은 digest pin이고 release는 OIDC/provenance를 쓴다.
- diagnostic bundle copy UI는 design content 포함 경고를 보여 준다.

근거는 <code>code-kb/figwright/packages/mcp/src/local-access.ts</code>, <code>packages/mcp/src/election/leader-endpoints.ts:65-167</code>, <code>packages/mcp/src/relay/relay.ts:74-97</code>, <code>packages/plugin/ui/components/TabDebug.vue:88-98</code>다.

### 15.2 남은 신뢰 경계

| 위험 | 현재 동작 | 서비스화 시 보강 |
|---|---|---|
| fake plugin session / local process impersonation | Host/Origin만 검사하고 pairing secret이 없다. 특히 sandboxed hostile iframe도 serialized <code>Origin: null</code>을 만들 수 있어, browser의 local-network 정책이 연결을 허용하는 환경에서는 valid <code>$hello</code>/<code>$activity</code>로 routing을 탈취할 수 있다 | per-launch pairing secret, challenge/response, authenticated session generation; Host/Origin은 보조 방어로만 사용 |
| arbitrary filesystem read | rootDir가 caller string, absolute path 가능 | workspace root allowlist와 canonical path check |
| arbitrary filesystem write | outDir/outPath/rootDir resolve 후 mkdir/write | explicit approval, output sandbox, overwrite policy |
| outbound network | import_image URL + allowedDomains <code>*</code> | URL allowlist, scheme/size limit, consent |
| design data in logs | Activity/diagnostic에 request/result 저장 | redaction, retention, user export warning |
| prompt injection | design annotations/text가 model context로 감 | untrusted-data labeling, tool policy, review gate |
| concurrent writes | relay가 같은 session에 여러 call 동시 전송 가능 | per-file write queue/transaction coordinator |
| destructive calls | 11개 destructive annotation | explicit confirmation, dry run, snapshot/undo |
| leader ingress memory | <code>/rpc</code>·<code>/abdicate</code> body를 byte cap 없이 <code>Buffer.concat</code>, follower response도 whole <code>arrayBuffer()</code> | Content-Length 선검사, streaming byte ceiling/413, response cap, slow-body timeout |
| relay queue pressure | plugin 부재 시 pending count/bytes cap 없이 timeout까지 entry+timer 유지 | global/per-session count·byte cap, backpressure, cancellation |
| WS path ambiguity | README는 <code>/ws</code>, client는 root URL, server는 path 제한 없이 upgrade | canonical <code>/ws</code>를 server/client에서 강제하고 negative-path test |

README와 SECURITY의 “nothing is sent anywhere else”는 telemetry/cloud upload가 없다는 의미로는 대체로 맞지만 문자 그대로는 예외가 있다. <code>import_image(url)</code>은 arbitrary URL을 Figma host가 fetch하고 manifest도 allowedDomains를 <code>*</code>로 연다. 또한 npm/GitHub 설치와 사용자가 복사한 diagnostic bundle은 외부 전송 경로다. 근거는 <code>code-kb/figwright/packages/plugin/manifest.json:9-12</code>, <code>packages/plugin/src/handlers/import-image.ts</code>, <code>README.md:203</code>다.

<code>Origin: null</code>은 Figma plugin만의 신원이 아니다. 일반 page가 sandboxed iframe/srcdoc을 만들면 같은 serialized origin을 낼 수 있고, relay <code>$hello</code>는 protocol/client version과 caller-chosen sessionId만 검증한다. 그러므로 정적 구조상 fake session이 가장 최근 activity를 주장해 request를 받고 fabricated result를 돌려줄 수 있다. 다만 본 조사에서는 실제 Chrome/Figma 환경의 Private Network Access 등 browser gate까지 포함한 exploit E2E를 수행하지 않았으므로, 환경별 도달성은 별도 검증 대상이다. Host gate가 DNS rebinding을 막는 가치는 유지되지만 peer identity를 증명하지는 않는다. 근거는 <code>code-kb/figwright/packages/mcp/src/local-access.ts:18-25,54-67</code>, <code>packages/mcp/src/relay/relay.ts:74-96,362-455</code>, <code>packages/shared/src/envelope.ts</code>다.

Leader HTTP의 <code>readBody</code>는 incoming chunk를 배열에 계속 넣은 뒤 제한 없이 <code>Buffer.concat</code>한다. <code>/abdicate</code>와 <code>/rpc</code>가 이를 공유하고 follower도 reply를 <code>arrayBuffer()</code>로 한 번에 읽는다. Host/Origin/content-type gate는 browser CSRF 방어이지 same-user process나 오작동 client의 memory exhaustion 방어가 아니다. 근거는 <code>code-kb/figwright/packages/mcp/src/election/leader-endpoints.ts:38-44,105-120,159-195</code>, <code>packages/mcp/src/election/follower.ts:174-205</code>다.

MCP local tools의 더 큰 문제는 annotation이다. <code>annotationsFor</code>는 kind가 write가 아니면 모두 <code>readOnlyHint:true</code>다. 그런데 local kind의 save_screenshots, save_image_fills, export_pdf, export_video, design_diff는 filesystem을 쓴다. MCP client가 read-only hint를 approval shortcut으로 사용하면 실제 write가 무승인 실행될 수 있다. 근거는 <code>code-kb/figwright/packages/mcp/src/tools/annotations.ts</code>, 각 local tool의 <code>writeFile</code> 호출이다. Tool 실행 위치와 side-effect classification을 분리해야 한다.

Base64 <code>import_image</code>는 MCP stdio SDK의 10MB read buffer를 넘겨 transport를 닫을 수 있다. SelfReportingStdioTransport가 zombie leader를 막지만 요청 자체의 크기 제한/streaming 문제는 남는다. 근거는 <code>code-kb/figwright/packages/mcp/src/index.ts:208-245</code>다.

## 16. 테스트와 CI gate

### 16.1 정량

- test files: 196.
- static <code>it/test</code> declaration sites: 1,770.
- package 분포: root 2, MCP 61, plugin 126, shared 7.
- test source: 31,882 lines, 1,224,308 bytes.
- production source 대비 test 비중이 높다.
- coverage command는 있으나 threshold는 line/function/branch/statement 모두 0이다.

근거는 전체 인벤토리, <code>code-kb/figwright/vitest.config.ts:26-37</code>다.

### 16.2 중요한 gate

- server tool registry와 plugin handler exact sync.
- README 112 count와 registry sync.
- 모든 input JSON Schema property type 확인.
- plugin-facing nested argument contract snapshot.
- destructive delete flag.
- prompt 안 snake_case tool name이 registry에 존재하는지 검사.
- serializer→design-context full projection coverage.
- layout-tier field classification coverage.
- Figma typings의 variable-bindable surface coverage.
- source raw control byte 방지.
- MCP raw stdio wire contract, schema dialect, old/new protocol era.
- real process leader/follower shutdown, wedge/SIGSTOP recovery.
- Windows build/test matrix.
- UI component/happy-dom tests와 relay state/client tests.

근거는 <code>code-kb/figwright/test/tool-registry.test.ts</code>, <code>test/docs-sync.test.ts</code>, <code>packages/mcp/test/plugin-contract.test.ts</code>, <code>packages/plugin/test/handlers/projection-coverage.test.ts</code>, <code>packages/mcp/test/e2e/*</code>다.

### 16.3 CI

Main CI는 Ubuntu에서 typecheck, lint, format check, knip을 실행하고 Ubuntu+Windows에서 build 후 test를 실행한다. Actionlint와 Zizmor workflow가 별도로 workflow 파일을 검사하고 Semantic PR이 제목을 검사한다. 근거는 <code>code-kb/figwright/.github/workflows/*.yml</code>다.

문서와 workflow 차이는 다음과 같다.

- AGENTS/CONTRIBUTING은 “every push and PR”이라고 하지만 CI push trigger는 main branch뿐이다. feature branch push는 PR이 없으면 CI가 실행되지 않는다. <code>.github/workflows/ci.yml:3-6</code>.
- built-dist E2E는 dist가 없으면 skip한다. CI는 build first라 안전하지만 local <code>pnpm test</code>만으로는 핵심 wire/process E2E가 빠진다.
- editor behavior는 fake/stub 테스트가 중심이며 실제 Figma Design/FigJam/Dev Mode live gate가 없다. AGENTS도 이를 명시한다.
- CI는 pinned Node 24만 사용하므로 공개 engine의 Node 20/22 호환성을 검증하지 않는다.
- coverage threshold가 0이고 CI에서 coverage command를 실행하지 않는다.
- Windows에서는 SIGSTOP/SIGCONT E2E를 skip하고 logic branch를 stub한다.
- <code>token_map</code> 두 read 사이 active session 전환, 서로 다른 file의 같은 nodeId baseline 충돌, null-Origin fake session pairing, delayed write 중 socket flap/outcome-unknown, HTTP body/queue cap, 잘못된 WS path 거부를 직접 검증하는 회귀 test가 없다.

## 17. 성능과 확장성

### 17.1 잘 설계된 부분

- MessagePack binary payload로 disk export의 base64 33% inflation을 피하고 old plugin에는 base64 fallback.
- repeated component subtree와 global style dedupe.
- 1,500-node pre-bail, 24k estimated-token guard, section plan.
- token value index의 60초 cache와 contributor file mtime invalidation.
- repo walk의 ignored directory pruning, gitignore, deterministic shallow-first ordering.
- component/icon map의 multi-call session pin.
- image fill hash dedupe.
- panel payload는 1,024자 이상 string을 elide하고 preview 100,000자로 cap.
- recent Activity는 30개, node ID extraction은 depth 6/50 IDs cap.

근거는 <code>packages/mcp/src/tools/binary-payload.ts</code>, <code>packages/shared/src/design-context.ts</code>, <code>packages/mcp/src/tokens/token-index.ts:120-188</code>, <code>packages/plugin/ui/relay/payload.ts</code>, <code>relay/state.ts</code>다.

### 17.2 병목과 scale risk

- component scan은 최대 5,000 path를 순차 read/parse하고 cap 여부를 보고하지 않는다.
- CSS 200, SCSS 300, generated output crawl 400 cap도 truncation을 보고하지 않는다.
- join은 대체로 usage×candidate full comparison이라 대형 design system에서 선형곱 비용이 든다.
- get_document/get_node는 dedupe/depth 제한이 없어 큰 tree에 비싸다.
- internal component/icon map과 design_diff는 public context payload guard를 우회한다.
- relay는 per-session write serialization/backpressure가 없다.
- plugin 부재 시 relay pending count/bytes cap이 없고, 이미 dispatch된 request도 socket flap 뒤 timeout까지 retained된다.
- leader <code>/rpc</code>·<code>/abdicate</code> ingress와 follower response는 streaming size limit 없이 whole-buffer 처리한다.
- full scan 결과와 diagnostic snapshot은 메모리에 한 번에 만든다.
- panel payload “bytes”는 JSON 기반 근사와 raw binary 합산이지 실제 MessagePack frame exact size는 아니다.
- export_video가 heavy timeout set에 없다.

통합 서비스에서는 scan progress/truncation metadata, indexed name lookup, per-file command queue, bounded ingress/pending queue, stream/export channel, cancellation, memory budget가 필요하다.

## 18. editor 제약

Manifest는 <code>figma</code>, <code>figjam</code>, <code>dev</code> 세 editor와 inspect capability를 선언한다. <code>documentAccess:dynamic-page</code>, network wildcard를 사용한다. 근거는 <code>code-kb/figwright/packages/plugin/manifest.json:7-13</code>다.

| editor | 가능한 범위 | 제한 |
|---|---|---|
| Figma Design | 전체 read/write, styles/variables/components/Motion | 사용자 edit 권한과 plan/API limits |
| Dev Mode | read/export/plugin data | nodes/pages/variables/styles 모든 write 거부 |
| FigJam | frames, sections, shapes, text | components/variables/styles/Motion 부재 |

Editor limitation은 sandbox error에 context suffix를 붙이고 Context tab에도 보여 준다. 그러나 tool별 capability matrix로 preflight하지는 않는다. 실제 API call이 실패한 뒤 설명을 붙이는 방식이다. 근거는 <code>code-kb/figwright/packages/plugin/protocol/editor-context.ts:18-73</code>, <code>packages/plugin/src/dispatcher.ts:46-66</code>다.

Dev Mode embedded inspect panel에서는 resize/background chrome을 숨긴다. Background button은 floating plugin에서 panel을 숨기되 iframe/socket은 살려 둔다. 근거는 <code>code-kb/figwright/packages/plugin/ui/App.vue:20-40</code>, <code>protocol/editor-context.ts:76-86</code>다.

Browser support는 README architecture가 주장하지만 initial development import는 desktop 안내다. 이 저장소에 실제 Figma web browser live E2E는 없다. 통합 서비스는 web/desktop을 별도 acceptance test해야 한다.

## 19. 문서 주장 교차 검증

| 문서 주장 | 코드/테스트 결과 | 판정 |
|---|---|---|
| 112 tools | registry 112, docs-sync test 고정 | 확인 |
| bidirectional | read 23, write 79, local 10 | 기능 surface 기준 확인 |
| provider-first | profile/joins/prompts/skills 존재, generator는 LLM | 확인하되 deterministic compiler 아님 |
| 여러 MCP client가 plugin 공유 | leader/follower, /rpc, election 구현·테스트 | 확인 |
| newest build wins | <code>Date.now()</code> build stamp + abdicate + quiet/yield/backoff | build artifact timestamp 기준 확인; semantic source/version freshness는 아님 |
| leader owns “single plugin connection” | <code>SessionManager</code>가 여러 session을 보존하고 most-recently-active로 route | README 내부 모순 |
| plugin endpoint <code>/ws</code> | production client는 path 없는 root URL, server도 모든 WS path upgrade 허용 | 문서/구현 drift |
| three editors | manifest와 error context 존재 | 선언 확인, live gate 없음 |
| no paid tier/Dev Mode seat | REST/official MCP를 안 씀 | 기술 경로 확인, 정책·권한 보장은 아님 |
| everything local/nothing leaves | relay/telemetry는 local | import URL wildcard와 user-export diagnostics 예외 |
| exact payload shown | preview elide/cap + server 후처리 전 plugin result | 부정확 |
| every call shown | recent Activity 30개 cap | lifetime total은 유지하지만 “every” 이력은 아님 |
| batch all-or-nothing | capture/rollback 구현 | undo failure 시 partial change 가능, 코드가 명시 |
| all pushes and PRs CI | push main + all PR | 문서 과장 |
| Node 20.19/22.12 supported | engine/README 주장 | build target/CI는 Node24뿐 |
| code→Figma reuses existing components via scan_components/get_local_components | scan_components는 local code AST, Figma IDs 없음; get_local_components도 selection/subtree 한정, remote library search 없음 | prompt/skill 오류 + discovery 범위 과장 |
| CHANGELOG v0.4.0의 Motion/UI/MCP v2/relay security·lifecycle 항목 | 대응 source와 test가 존재 | tag 시점 기능 주장은 확인 |
| CHANGELOG가 현재 HEAD를 설명 | HEAD는 v0.4.0 이후 33 commits, 158 files 변경 | 현재 snapshot의 대규모 후속 변경은 아직 release changelog 밖 |

“exact payload” 차이는 두 겹이다.

1. UI는 long string을 1,024자 이후 elide하고 전체 preview를 100,000자로 자른다. <code>packages/plugin/ui/relay/payload.ts:20-23,54-79</code>.
2. UI가 기록하는 것은 plugin result다. Server가 그 뒤에 get_design_context token annotation/degradation, screenshot content block 변환, filesystem path result, skew notice를 적용한다. 따라서 special/local tools에서 model이 실제 받은 최종 MCP CallToolResult와 다르다. <code>packages/mcp/src/index.ts:99-148</code>.

역방향 workflow의 <code>scan_components</code> 혼동은 더 중요하다. Skill, MCP prompt, initialize instructions는 이것을 “Figma file의 existing components to instance” 탐색에 <code>get_local_components</code>와 함께 놓는다. 그러나 tool 구현은 “server filesystem의 exported UI code component”를 AST scan하며 componentId/key를 반환하지 않는다. 근거는 <code>packages/mcp/src/tools/scan-components.ts:12-31</code>, <code>skills/figma-build/SKILL.md:29-36</code>, <code>packages/mcp/src/prompts/code-to-figma.ts:17</code>, <code>packages/mcp/src/instructions.ts</code>다. 역방향에서는 local code pattern 파악에만 쓰고, Figma instancing source는 <code>get_local_components</code>/<code>get_component_api</code>로 한정해야 한다.

그 대안도 완전하지 않다. <code>get_local_components</code>는 selection 또는 명시 node subtree만 검색하며 빈 selection+nodeId 없음은 오류다. file-wide discovery는 caller가 pages를 순회해야 하고, published remote library component key를 검색하는 tool은 없다. <code>create_instance(componentKey)</code>는 이미 아는 key만 import한다. 따라서 prompt의 “file existing components” 재사용 약속은 bounded page traversal/library-search를 추가하기 전에는 조건부다. 근거는 <code>packages/mcp/src/tools/get-local-components.ts:7-20</code>, <code>packages/plugin/src/handlers/get-local-components.ts:9-43</code>, <code>packages/mcp/src/tools/create-instance.ts:7-20</code>다.

## 20. 강점

1. Grounding fidelity가 매우 높다. 흔히 누락되는 per-side border, mixed text, variable binding, masks, gradients, grid, aspect ratio, annotations, Motion을 schema와 projection gate로 관리한다.
2. Tool registry와 plugin handler, docs 숫자, prompt tool name, plugin argument surface를 자동 동기화한다.
3. Relay lifecycle은 단순 “port 열기”보다 훨씬 성숙하다. zombie shutdown, newest-build handoff, wedge diagnosis, session grace, foreground routing을 다룬다.
4. Component/token/icon join이 legacy code reuse를 제품 핵심으로 삼는다.
5. Skew를 현실적으로 다룬다. hard refusal과 semantic warning을 분리하고 follower까지 attribution한다.
6. Binary export, section planning, dedupe, timeout layering 등 실제 LLM/MCP context 비용을 측정 기반으로 처리한다.
7. Plugin panel이 connection/activity/context/debug를 제공하고 design content copy 경고를 한다.
8. MIT license라 코드 재사용·수정 장벽이 낮다.
9. Write surface가 스타일·변수·컴포넌트 API와 Motion까지 넓다.
10. 테스트 코드 양과 contract-focused gate가 크고, 회귀 원인을 주석으로 설명한다.

## 21. 한계·리스크·기술부채 우선순위

| 우선순위 | 문제 | 영향 | 권고 |
|---|---|---|---|
| P0 | Figma 정책/Community/commercial distribution 불확실성 | 서비스 출시·승인·계약 위험 | 법률/정책 검토, local/private/public mode 분리 |
| P0 | relay에 peer authentication이 없고 <code>Origin: null</code>을 허용 | fake plugin session의 routing 탈취·입력 유출·결과 위조 가능 | short-lived pairing secret, challenge/response, authenticated session generation |
| P0 | local filesystem write tools가 readOnlyHint=true | client approval bypass 가능 | execution kind와 side-effect kind 분리 |
| P0 | rootDir/outPath가 workspace 밖 absolute path 허용 | agent/prompt injection의 파일 접근 범위 확대 | canonical path allowlist, approval, overwrite guard |
| P1 | <code>token_map</code>의 variable/style read가 session pin되지 않음 | 여러 열린 파일의 token source가 silent 혼합 | routed dispatcher 공유 + file/session provenance + follower activity-flip test |
| P1 | <code>design_diff</code> key/provenance에 file identity 없음 | 다른 파일의 같은 nodeId baseline과 silent 충돌 | file namespace, identity 검증, schema migration |
| P1 | socket flap 중 dispatched write 결과가 outcome-unknown | 새 requestId 수동 재시도 시 duplicate mutation | operation state/journal, same-ID resume, unknown-outcome UX |
| P1 | code→Figma prompt가 scan_components를 Figma component discovery처럼 설명하고 실제 get_local_components도 subtree 한정 | 잘못된 instance 계획·file/library component 누락 | 문서 수정, bounded page index, remote library matcher 별도 구현 |
| P1 | runtime plugin result schema 검증 부재 | skew/corruption이 server cast 통과 | tool별 output parse와 versioned result contract |
| P1 | concurrent same-request idempotency gap | write 중복 적용 | in-flight Promise dedupe + durable journal |
| P1 | 역방향 deterministic parser/mapping 부재 | “코드베이스로 Figma” 품질이 모델 편차에 의존 | framework adapters, computed-style/DOM graph, provenance map |
| P1 | per-session write queue 없음 | concurrent tool race·video failure | read concurrency/write serialization |
| P1 | plugin wildcard network + remote import exception | outbound fetch/SSRF-like risk | scheme/domain/size policy |
| P1 | leader body·follower response·relay pending queue에 명시적 byte/count cap 없음 | same-user DoS·대형 payload memory spike | streaming cap/413, response limit, queue backpressure |
| P1 | Node support claim과 build/CI mismatch | older supported runtime 실패 가능 | Node20/22 CI 또는 engine을 Node24로 정렬 |
| P2 | exact payload/every call 문서 과장 | audit 신뢰 저하 | “plugin boundary preview, elided/capped”로 수정 |
| P2 | scan/token caps가 silent | 대형 legacy repo false unmapped | truncated/count/progress metadata |
| P2 | public grounding guard를 internal join/diff가 우회 | 큰 파일 timeout/memory | shared section iterator와 streaming |
| P2 | export_video default timeout | 긴 animation export 실패 | heavy set 포함 또는 duration-based budget |
| P2 | no live Figma editor gate | API 변화/실제 editor 차이 | Design/FigJam/Dev manual/release acceptance |
| P2 | coverage threshold 0 | untested path 감소를 막지 못함 | meaningful threshold와 changed-file coverage |
| P2 | release workflow static gates 생략 | direct tag 품질 위험 | full gate 재실행 또는 protected release environment |
| P2 | npm tarball LICENSE 포함 불확실 + plugin ZIP은 LICENSE/third-party notice 미포함 | MIT·dependency notice compliance 위험 | 두 artifact inspection, package-local LICENSE, THIRD_PARTY_NOTICES |
| P2 | buildId가 semantic freshness가 아닌 wall-clock build stamp | stale source가 late rebuild/clock skew로 leader 승리 | semver/commit/capability identity 병행 |
| P2 | README <code>/ws</code>와 root/all-path WS 구현 불일치 | protocol 모호성·불필요한 upgrade surface | canonical path 강제와 negative test |
| P3 | plugin dev가 sandbox watch 안 함 | 개발 stale build | main+UI 병렬 watch |
| P3 | clean 명령 Windows 비이식 | contributor 불편 | cross-platform rimraf/node script |
| P3 | nested node IDs 정규화 안 함 | batch/reaction 내부 URL ID 실패 | schema-aware recursive normalization |
| P3 | icon duplicate ambiguity 없음 | 잘못된 SVG reuse | runner-up/path ambiguity surface |
| P3 | css style enum 일부 unreachable | profile 신뢰 저하 | detector 구현 또는 enum/문서 정리 |
| P3 | design diff snapshot write 비원자적 | concurrent/corrupt baseline | temp file + fsync/rename/lock |

## 22. 통합 서비스에서 재사용할 후보

### 22.1 거의 그대로 재사용할 가치가 높은 것

| 후보 | 이유 | 경계 |
|---|---|---|
| shared envelope/codec/error/budgets | server/plugin protocol 기반이 명확 | output schema validation 추가 |
| ToolSpec registry와 contract tests | 112 surface drift 방지 | sideEffect metadata 추가 |
| serializer + design-context schema | 핵심 Figma UX grounding moat | Figma typings update audit 유지 |
| design-context dedupe/section plan | LLM context 효율 | internal iterator로 일반화 |
| component/token/icon join core | legacy reuse에 직접 가치 | language/framework adapters 확장 |
| repo walker | gitignore/pruning/determinism | truncation metadata |
| relay session routing | 여러 열린 파일 UX | pairing auth, authenticated session generation, 모든 multi-call session pin, per-file queue |
| election/lifecycle | 여러 MCP client/local resilience | 서비스 topology에 맞게 분리 |
| local-access Host/Origin gate | DNS rebinding·일반 cross-site 연결 감소 | 단독 auth로 쓰지 말고 short-lived pairing secret/challenge 필수 |
| plugin UI↔sandbox protocol split | runtime 경계가 선명 | runtime output validation |
| projection/contract ratchet tests | 새 dimension 누락 방지 | live acceptance와 함께 사용 |

### 22.2 수정 후 재사용할 것

- Plugin panel: raw plugin boundary preview와 final MCP payload를 분리해 표시하고 retention/redaction을 제공한다.
- design_diff: stable file identity namespace, serving-session provenance, identity mismatch 거부, atomic file write, code-side mapping, schema migration을 추가한다.
- batch: write queue, durable operation log, preflight/dry-run, Figma undo checkpoint를 추가한다.
- token loaders: color-space conversion, numeric unit matching, monorepo source discovery, cap status를 추가한다.
- project profiler: CSS Modules/plain CSS detection과 non-JS adapters를 추가한다.
- version skew: tool/argument/result capability negotiation을 추가하고 incompatible write를 선택적으로 차단한다.
- filesystem export: workspace-bound output service로 바꾼다.

### 22.3 그대로 가져오면 안 되는 것

- <code>kind=local</code>을 read-only로 간주하는 annotation model.
- <code>scan_components</code>와 Figma component discovery의 혼합.
- selection/subtree <code>get_local_components</code>만으로 file/library-wide reuse가 된다고 간주하는 workflow.
- arbitrary absolute root/output paths.
- completed-result-only idempotency cache.
- Host/Origin allowlist만으로 plugin peer가 인증됐다고 간주하는 relay.
- reconnect 시 dispatched write의 outcome을 timeout으로만 숨기는 pending model 또는 journal 없이 이를 자동 replay하는 방식.
- “free/no paid tier”를 policy 적합성까지 보장하는 마케팅.
- result를 TypeScript cast만 하고 runtime parse하지 않는 server special handler.
- code→Figma를 prompt만으로 완전한 reverse pipeline이라 간주하는 설계.

### 22.4 통합 서비스 권장 경계

~~~text
Policy / Permission Gate
        │
Workspace Sandbox ── Code adapters / AST / runtime preview
        │                       │
        └──── Grounding Graph ──┘
                     │
          Plan + provenance + dry run
                     │
     Local authenticated relay / per-file queue
                     │
       Figma Plugin UI ── Figma sandbox
                     │
              user-owned open file
~~~

Grounding Graph에는 최소한 stable Figma file identity, nodeId, authenticated session generation, component key, code symbol/file, token ref, asset path, source evidence, confidence, last verified snapshot을 저장해야 한다. Figwright의 Markdown override와 design_diff를 구조화해 하나로 합친 형태다. file identity 없는 nodeId는 cross-file primary key로 사용하면 안 된다.

## 23. 최종 채택 판단

Figwright는 세 프로젝트를 합치는 서비스에서 “Figma Plugin API 기반 local execution plane”과 “Figma UX→codebase grounding engine”으로 가장 가치가 크다. 특히 공식 REST/Figma MCP endpoint를 사용하지 않고 사용자가 연 파일을 다루는 비용 대체 경로가 source와 정적 test에 구현돼 있다. 다만 이번 환경에서는 dependency build와 실제 Figma round-trip을 실행하지 못했으므로 runtime 성공까지 재검증했다는 뜻은 아니다. 또한 현행 공식 MCP도 write/code-to-canvas 기능을 제공하므로 Figwright의 차별점은 “write 최초 제공”이 아니라 local endpoint, 112개 typed surface, project-aware grounding/join에 있다.

다만 서비스 목적을 “Figma 라이선스 정책을 피한다”로 표현하면 제품·정책 리스크가 커진다. 정확한 제품 정의는 다음이 적합하다.

> 사용자가 접근·편집 권한을 가진 열린 Figma 파일에서 공식 Plugin API를 사용하고, local MCP/relay를 통해 design-to-code와 code-to-design을 지원하는 developer tool. REST API나 공식 Figma MCP endpoint에 의존하지 않지만, Figma의 권한·plan·Plugin API·배포 정책은 준수한다.

기술 채택 순서는 다음이 바람직하다.

1. serializer/shared/relay를 fork해 reproducible baseline을 만든다.
2. pairing auth, workspace filesystem 경계, side-effect metadata를 먼저 수정한다.
3. <code>token_map</code> session pin과 <code>design_diff</code> file identity를 고치고 cross-file regression gate를 둔다.
4. per-file write queue, in-flight/completed idempotency journal, reconnect outcome-unknown/resume protocol을 넣는다.
5. Figma→code grounding을 production path로 연다.
6. code→Figma component discovery 오류를 고치고 bounded page/library index와 dry-run을 넣는다.
7. code AST/runtime adapters와 provenance graph를 추가해 진짜 양방향 sync로 확장한다.
8. Figma 정책 review와 배포 모델을 확정한 뒤 public/commercial 기능을 연다.

## 24. 재실행 가능한 정량 명령

저장소 루트 <code>code-kb/figwright</code>에서 실행한다.

~~~powershell
$files = git ls-files
$files.Count
($files | ForEach-Object { (Get-Item -LiteralPath $_).Length } | Measure-Object -Sum).Sum

$text = $files | Where-Object {
  [IO.Path]::GetExtension($_).ToLowerInvariant() -notin '.png', '.gif'
}
($text | ForEach-Object {
  [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $_)).Count
} | Measure-Object -Sum).Sum

$tests = git ls-files '*test.ts'
$tests.Count
rg -n '\b(it|test)([.]each)?\(' test packages/mcp/test packages/plugin/test packages/shared/test -g '*.test.ts' |
  Measure-Object -Line

# Registry membership과 각 imported ToolSpec 파일의 kind를 결합한다.
# 단순 rg는 spec.ts 주석의 kind 예시까지 세어 113으로 오집계할 수 있다.
$toolRoot = Resolve-Path 'packages/mcp/src/tools'
$registry = Get-Content -LiteralPath (Join-Path $toolRoot 'registry.ts') -Raw -Encoding utf8
$imports = @{}
[regex]::Matches(
  $registry,
  "(?m)^import \{ (?<id>\w+) \} from './(?<file>[^']+)[.]js';$"
) | ForEach-Object {
  $imports[$_.Groups['id'].Value] = $_.Groups['file'].Value
}
$registryBody = [regex]::Match(
  $registry,
  'export const ALL_TOOL_SPECS:[^=]+=[ ]*\[(?<body>[\s\S]*?)\n\];'
).Groups['body'].Value
$members = [regex]::Matches(
  $registryBody,
  '(?m)^\s*(?<id>[A-Za-z]\w*),\s*$'
) | ForEach-Object { $_.Groups['id'].Value }
$toolRows = foreach ($id in $members) {
  $source = Get-Content -LiteralPath (
    Join-Path $toolRoot ($imports[$id] + '.ts')
  ) -Raw -Encoding utf8
  $kind = [regex]::Match(
    $source,
    "(?m)^\s*kind:\s*'(?<kind>read|write|local)',?\s*$"
  ).Groups['kind'].Value
  [pscustomobject]@{ Id = $id; Kind = $kind }
}
$toolRows.Count
$toolRows | Group-Object Kind | Sort-Object Name | Select-Object Name, Count

rg -n '^export const [A-Za-z0-9]+Schema' packages/shared/src
rg -n 'create[A-Za-z0-9]+Handler[(]figmaCtx' packages/plugin/src/handlers/registry.ts
git status --short
git rev-parse HEAD
git describe --tags --always
~~~

위 registry-aware 명령의 fresh 결과는 member 112개, blank kind 0개, <code>local 10 / read 23 / write 79</code>다. <code>ALL_TOOL_SPECS</code>에 실제 등록된 import만 따라가므로 <code>spec.ts</code> 주석 같은 비등록 occurrence를 제외한다. Plugin handler 수는 <code>createSandboxHandlers</code>가 반환하는 key 수가 authority이며, cross-package test가 server exception 7개를 뺀 exact equality를 검증한다.

## 25. 남은 불확실성

- 현재 환경에서 dependency install/build/test를 실행하지 못했다.
- 실제 Figma Design, FigJam, Dev Mode, Figma web/browser에서 live round-trip을 수행하지 않았다.
- null-Origin sandboxed iframe의 loopback 도달성은 browser의 Private Network Access 등 환경별 gate까지 포함해 live exploit 검증하지 않았다. 인증 부재 자체는 source로 확인된다.
- socket flap 중 실제 Figma mutation의 완료/응답 유실 조합은 live delayed-write E2E로 재현하지 않았다. relay/plugin state machine상 outcome-unknown 경로는 확인된다.
- npm pack tarball의 LICENSE 포함 여부를 직접 확인하지 못했다.
- plugin ZIP의 root LICENSE 부재는 workflow로 확정되지만, 각 bundled dependency에 필요한 notice의 정확한 범위는 dependency license audit가 필요하다.
- <code>design_diff</code> namespace에 쓸 stable file identity의 Plugin API 취득·draft fallback 방식은 별도 설계가 필요하다. 현재 snapshot에는 어떤 file identity도 없다.
- Figma 정책은 시점과 배포 형태에 따라 바뀔 수 있어 출시 직전 재검토가 필요하다.
- 공식 MCP/REST 제한 수치는 변경 가능해 의도적으로 고정하지 않았다. 2026-08-27 확인 링크를 authority로 삼아 운영 시 재조회해야 한다.
- Public Community 승인 가능성은 코드만으로 판단할 수 없다.
- README demo GIF/PNG는 binary asset으로 확인했지만 동작 증거로 간주하지 않았다.

## 26. 교차 리뷰 finding 처리 ledger

검토 입력은 <code>docs/code-kb-analysis/reviews/agent-a-review-figwright.md</code>와 <code>docs/code-kb-analysis/reviews/agent-b-review-figwright.md</code>다. 모든 finding을 원본 commit <code>a835e81b575eab2c9265a67f9353c89b848f81ca</code>와 다시 대조했다. 총 16건은 **수용 16, 부분 수용 0, 기각 0**이다. 같은 원인을 지적한 중복 finding도 추적성을 위해 각각 남겼다.

| Finding | 심각도 | 판단 | 재검증 근거와 반영 |
|---|---|---|---|
| A-FW-01 | High | 수용 | <code>token_map</code>만 일반 dispatch로 variable/style을 병렬 호출한다. <code>packages/mcp/src/index.ts:87-93,139-143</code>, <code>tools/token-map.ts:131-151</code>. 8.4, 10.4, 21, 23절에 session pin/provenance/test 요구 반영. |
| A-FW-02 | High | 수용 | snapshot schema/path에 file identity가 없고 name/type 동일 시 경고도 없다. <code>tools/design-diff.ts:61-70,87-120,157-171</code>. 10.7, 21, 22, 25절 반영. |
| A-FW-03 | High | 수용 | plugin ZIP command가 <code>manifest.json dist</code>만 포함한다. <code>.github/workflows/release.yml:57-63</code>. 3, 7.3, 21, 25절에 root LICENSE와 third-party notice audit/gate 반영. |
| A-FW-04 | Medium | 수용 | <code>readBody</code>, follower <code>arrayBuffer()</code>, pending map에 byte/count cap이 없다. <code>election/leader-endpoints.ts:38-44</code>, <code>election/follower.ts:192</code>, <code>relay/relay.ts:112-190</code>. 15, 16, 17, 21절 반영. |
| A-FW-05 | Medium | 수용 | buildId는 <code>Date.now()</code> build stamp다. <code>build-id.ts:1-16</code>, <code>tsdown.config.ts:15-19</code>. 14.4, 19, 21절에서 semantic freshness와 구분. |
| A-FW-06 | Medium | 수용 | README는 <code>/ws</code>, client는 root URL, WebSocketServer는 path를 제한하지 않는다. <code>README.md:57-68</code>, <code>plugin/ui/relay/client.ts:246-250</code>, <code>relay/relay.ts:74-96</code>. 15, 19, 21절 반영. |
| A-FW-07 | Low | 수용 | <code>ICON_LIBRARY_DEPS</code>는 12개다. <code>icons/repo-icons.ts:82-100</code>. 10.5의 11을 12로 정정. |
| A-FW-08 | Low | 수용 | README의 “single plugin connection”은 multi-session <code>SessionManager</code>와 모순된다. <code>README.md:60-63</code>, <code>relay/session.ts</code>. 19절 반영. |
| A-FW-09 | Low | 수용 | 현재 환경에서 build/live E2E를 실행하지 못했다. 2.2·25절 증거 한계와 맞춰 23절을 “source와 정적 test에 구현”으로 축소. |
| F-W-01 | High | 수용 | literal <code>null</code> Origin과 caller-chosen hello/sessionId를 secret 없이 허용한다. <code>local-access.ts:18-25,60-67</code>, <code>relay/relay.ts:74-96,362-455</code>. 15, 21, 22절에 pairing auth를 P0로 반영. 실제 browser exploit 도달성은 미검증이라고 15·25절에 한정. |
| F-W-02 | High | 수용 | disconnect가 pending을 바꾸지 않고 reconnect flush가 dispatched entry를 skip하며 UI completion도 old socket을 캡처한다. <code>relay/session.ts:84-97</code>, <code>relay/relay.ts:289-313</code>, <code>plugin/ui/relay/client.ts:354-435</code>. 13.3, 14.3, 21~23절 반영. 단 write의 **무조건 자동 재전송은 해결책으로 채택하지 않고**, same-ID resume/journal 또는 outcome-unknown 실패를 요구했다. |
| F-W-03 | High | 수용 | 공식 <code>use_figma</code> write와 <code>generate_figma_design</code> live UI capture를 공식 문서에서 2026-08-27 재확인했다. 5.1·23절의 “read-oriented” 비교를 삭제하고 local endpoint/112 tools/grounding 차별점으로 수정. 숫자 rate는 고정하지 않음. |
| F-W-04 | Medium | 수용(중복) | A-FW-04와 같은 unbounded <code>/rpc</code>·<code>/abdicate</code> ingress를 독립 확인해 15·17·21절 반영. |
| F-W-05 | Medium | 수용 | <code>get_local_components</code>는 selection/subtree 전용이고 <code>create_instance(componentKey)</code>는 known key import만 제공한다. <code>tools/get-local-components.ts:7-20</code>, <code>plugin/src/handlers/get-local-components.ts:9-43</code>, <code>tools/create-instance.ts:7-20</code>. 1, 4.4, 19, 21, 22절 반영. |
| F-W-06 | Medium | 수용(중복) | A-FW-03과 같은 plugin ZIP notice 공백을 workflow로 확인해 3, 7.3, 21, 25절 반영. |
| F-W-07 | Low | 수용 | raw <code>rg kind:</code>는 <code>spec.ts</code> 주석을 포함할 수 있다. 24절을 <code>ALL_TOOL_SPECS</code> import membership과 각 ToolSpec file kind를 결합하는 실행 가능한 PowerShell로 교체했고 112 = local 10 + read 23 + write 79를 재확인. |

기각 finding은 없다. 다만 F-W-01의 browser별 exploit 도달성과 A/F-W-03의 dependency별 notice 의무는 source만으로 끝낼 수 없는 검증 범위라, finding을 기각하지 않고 사실 주장 범위를 25절처럼 제한했다. F-W-02도 결함은 전부 수용했지만, 이미 적용됐을 수 있는 write를 journal 없이 자동 replay하는 처방은 중복 mutation을 만들므로 명시적으로 배제했다.
