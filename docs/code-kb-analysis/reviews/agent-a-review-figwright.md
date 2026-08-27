# Agent A 교차 리뷰 — Figwright 분석 보고서

## 1. 리뷰 범위와 종합 판정

- 피리뷰 문서: `docs/code-kb-analysis/03-figwright-analysis.md`, `docs/code-kb-analysis/inventories/figwright-file-inventory.md`
- 원본 기준: `code-kb/figwright`, commit `a835e81b575eab2c9265a67f9353c89b848f81ca`, `v0.4.0-33-ga835e81`
- 원본 대조: Git 추적 612개를 모두 바이트 단위로 읽었다. 텍스트 605개는 엄격한 UTF-8 decode와 라인 집계를 다시 수행했고, 바이너리 7개도 원본 bytes를 열었다.
- 원본 저장소 상태: `git status --short` 빈 결과

종합 판정은 **정량·112개 tool 분류·grounding·code→Figma 비대칭·relay/election·filesystem·tests·정책 분석이 매우 정확하지만, multi-file grounding의 두 correctness 결함과 release license artifact 한 건은 반드시 추가해야 한다**이다. 인벤토리 612행은 경로·번호·라인·바이트를 개별 재대조해 오류 0건이었다.

## 2. 독립 재검증 결과

| 검증 항목 | 독립 결과 | 피리뷰 문서 |
|---|---:|---|
| 추적 파일 | 612 | 일치 |
| 총 bytes | 7,010,446 | 일치 |
| 텍스트/바이너리 | 605 / 7 | 일치 |
| 물리/비공백 라인 | 69,469 / 62,275 | 일치 |
| UTF-8 오류 | 0 | 일치 |
| MCP tool | 112 unique | 일치 |
| kind | read 23 / local 10 / write 79 | 일치 |
| 보고서 9.2 tool 이름 집합 | 원본 112개와 exact equality | 일치 |
| destructive | 11 | 일치 |
| plugin handler | 105, server exception 7 | 일치 |
| batch inverse | 30 | 일치 |
| prompt/skill | MCP prompt 2 / skill root 2 | 일치 |
| test files/declaration sites | 196 / 1,770 | 일치 |
| v0.4.0 이후 | 33 commits / 158 changed files | 일치 |
| tag/HEAD tool 수 | 112 / 112 | 일치 |

## 3. Finding 요약

| ID | 심각도 | 분류 | 요약 |
|---|---|---|---|
| A-FW-01 | **High** | grounding/multi-file | `token_map`의 두 plugin read가 session pin 없이 실행돼 follower 경로에서 서로 다른 Figma 파일을 섞을 수 있음 |
| A-FW-02 | **High** | incremental diff | `design_diff` snapshot key/provenance에 Figma file identity가 없어 다른 파일의 동일 nodeId baseline과 충돌 |
| A-FW-03 | **High** | license/release | plugin ZIP이 root LICENSE와 bundled dependency notice를 포함하지 않는데 보고서는 npm tarball만 다룸 |
| A-FW-04 | **Medium** | security/scale | `/rpc`·`/abdicate` body와 no-plugin pending queue에 명시적 size/count limit가 없음 |
| A-FW-05 | **Medium** | election | “newest build”는 source/version이 아니라 wall-clock `Date.now()` build stamp라 clock/source ordering을 보장하지 않음 |
| A-FW-06 | **Medium** | protocol | README는 `/ws` endpoint라 하지만 production client는 path 없는 URL을 쓰고 server는 모든 WS path를 허용 |
| A-FW-07 | **Low** | 정량 | 지원 icon library를 11종이라 썼으나 dependency list는 12종 |
| A-FW-08 | **Low** | README drift | README diagram의 “single plugin connection”은 현재 multi-session relay와 모순인데 대조표에서 누락 |
| A-FW-09 | **Low** | 결론 표현 | live build/test/Figma E2E 미실행 상태에서 최종 절의 “이미 동작 가능한 형태”는 구현 확인으로 좁혀야 함 |

## 4. 상세 Finding

### A-FW-01 — `token_map` multi-file session 혼합

**심각도: High**

보고서는 component/icon map의 multi-call을 한 session에 pin한다고 정확히 설명한다(`docs/code-kb-analysis/03-figwright-analysis.md:312-314`). 그러나 실제로 두 개의 plugin read를 결합하는 `token_map`은 pin되지 않는다.

- `handleTokenMap`은 `get_variable_defs`와 `get_styles`를 `Promise.all`로 별도 dispatch한다(`code-kb/figwright/packages/mcp/src/tools/token-map.ts:131-151`).
- `SPECIAL_HANDLERS`는 component/icon map에만 `routedDispatch()`를 주고 token map에는 일반 `dispatch`를 전달한다(`code-kb/figwright/packages/mcp/src/index.ts:87-94,137-143`).
- 일반 relay dispatch는 각 call마다 그 시점의 active session을 고른다(`code-kb/figwright/packages/mcp/src/relay/relay.ts:162-189`).

Leader process에서 두 call은 같은 JS turn에 시작돼 보통 같은 session을 고르지만, follower process에서는 두 독립 `/rpc`가 leader에 도착하는 사이 foreground activity가 바뀔 수 있다. 그 경우 file A의 variables와 file B의 styles를 하나의 token map으로 합치며, style failure는 empty styles로 degrade돼 오류도 숨길 수 있다. “여러 열린 Figma 파일”을 강점으로 삼는 제품에서 silent cross-file grounding은 코드 생성 정확성을 직접 훼손한다.

**수정 제안**

1. `TOKEN_MAP_TOOL_NAME`도 `await routedDispatch()`를 사용한다.
2. token map 결과에 serving session/file identity를 provenance로 남긴다.
3. follower 경로에서 두 read 사이 `$activity`를 바꾸는 regression test를 추가한다.
4. 보고서 10.4와 P1 목록에 이 결함을 추가한다.

### A-FW-02 — `design_diff` baseline의 cross-file nodeId 충돌

**심각도: High**

보고서는 design diff가 같은 파일에서 node ID가 유지되는 변화에 가장 적합하다고 적지만(`docs/code-kb-analysis/03-figwright-analysis.md:476-487`), 왜 다른 파일에서 위험한지는 충분히 드러내지 않는다.

Snapshot은 `nodeId`, capturedAt, context만 저장하고 file key/name/session identity를 저장하지 않는다. 파일명도 `.figwright/snapshots/{sanitize(nodeId)}.json`이다(`code-kb/figwright/packages/mcp/src/tools/design-diff.ts:61-70,87,107-120,157-171`). Figma node ID는 파일 전역 global identifier가 아니므로 서로 다른 파일에서 같은 `1:2` 같은 ID가 흔히 재사용된다. 다른 파일로 routing한 뒤 같은 root ID를 diff하면 기존 baseline을 읽는다. root name/type까지 같으면 `identityNote`도 경고하지 않는다(`design-diff.ts:89-105`).

이는 단순히 copy/recreate가 add/remove로 보이는 문제보다 크다. 잘못된 파일의 baseline을 정상 diff로 받아 legacy code를 수정할 수 있다.

**수정 제안**

1. Plugin result에 stable file identity를 포함하거나, 최소한 file name + session provenance를 snapshot에 저장한다.
2. snapshot path를 `{file-identity}/{node-id}.json`으로 namespace한다.
3. file identity 불일치는 자동 rebaseline이 아니라 명시적 오류/승인을 요구한다.
4. 보고서의 design_diff 한계와 Grounding Graph 필수 필드에 file identity를 추가한다.

### A-FW-03 — 배포 plugin ZIP의 LICENSE·third-party notices 누락

**심각도: High**

보고서는 npm package의 `files: ["LICENSE"]`와 package-local LICENSE 부재를 잘 지적한다(`docs/code-kb-analysis/03-figwright-analysis.md:44-60,819`). 그러나 실제 GitHub Release plugin ZIP은 `manifest.json`과 `dist`만 넣고 root LICENSE를 포함하지 않는다(`code-kb/figwright/.github/workflows/release.yml:57-63`). 이 ZIP이 사용자가 직접 import하는 배포 단위다.

더욱이 `dist/index.html`은 Vue, VueUse, Zod, `@lucide/vue` 등을 bundle한다(`code-kb/figwright/packages/plugin/package.json:15-19`). root MIT notice뿐 아니라 bundled dependency의 notice 검토도 필요하다. 현재 workflow에는 LICENSE/THIRD_PARTY_NOTICES/SBOM 복사나 asset checksum 단계가 없다.

**수정 제안**

1. plugin ZIP에 root `LICENSE`와 generated `THIRD_PARTY_NOTICES`를 포함한다.
2. npm tarball은 package-local LICENSE를 실제로 복사한 뒤 pack contents test를 둔다.
3. release asset checksum 또는 provenance/attestation을 추가한다.
4. 보고서 3절·7.3절·P2 license risk를 npm과 plugin ZIP 두 배포 단위로 확장한다.

### A-FW-04 — unbounded leader body와 pending queue

**심각도: Medium**

보고서는 same-user impersonation, stdio 10MB, memory risk를 다루지만(`docs/code-kb-analysis/03-figwright-analysis.md:632-665,727-739`), leader HTTP ingress와 relay queue의 구체적 상한 부재는 빠졌다.

- `readBody`는 모든 chunk를 배열에 모아 `Buffer.concat`하며 Content-Length/누적 bytes 상한이 없다. `/rpc`와 `/abdicate`가 이를 공유한다(`code-kb/figwright/packages/mcp/src/election/leader-endpoints.ts:38-44,105-120,159-195`).
- plugin이 없을 때 `Relay.sendRequest`는 call마다 pending entry와 timer를 만들고 timeout까지 유지하며 queue count cap이 없다(`code-kb/figwright/packages/mcp/src/relay/relay.ts:112-190`).
- follower response도 전체 `arrayBuffer()`를 한 번에 읽는다(`code-kb/figwright/packages/mcp/src/election/follower.ts:145-211`).

Origin/Host/content-type gate는 browser 공격을 줄이지만 인증되지 않은 same-user process나 오작동 client의 memory exhaustion을 막지 않는다. 정상적인 대형 screenshot/video도 whole-buffer 경로를 탄다.

**수정 제안**

- Content-Length 선검사 + streaming byte ceiling, pending count/bytes cap, per-session backpressure, media streaming을 추가한다.
- 보안 표와 성능 표에 구체적인 ingress/queue 한계를 추가한다.

### A-FW-05 — build timestamp를 source freshness로 간주

**심각도: Medium**

보고서는 “newest build wins” election을 상세히 설명하지만(`docs/code-kb-analysis/03-figwright-analysis.md:613-630,765`), ordering key가 semantic version이나 commit이 아니라 build 시점 wall clock이라는 한계는 누락했다. `BUILD_ID`는 tsdown이 `Date.now()`를 주입한 epoch milliseconds다(`code-kb/figwright/packages/mcp/src/build-id.ts:1-16`, `packages/mcp/tsdown.config.ts:15-19`).

따라서 오래된 source를 나중에 rebuild하면 새 source leader를 밀어낼 수 있고, clock skew/rollback이 있으면 실제 최신 source가 더 작은 ID를 가질 수 있다. 이름 그대로 “가장 최근에 compile된 bundle”은 고르지만 “가장 최신 코드/버전”은 보장하지 않는다.

**수정 제안**

- 보고서에서 newest **source**가 아니라 newest **build timestamp**라고 명시한다.
- release version/commit identity와 build stamp를 함께 비교하거나, handoff 정책을 capability/semver 기반으로 보강한다.

### A-FW-06 — WebSocket `/ws` 문서와 실제 path 정책

**심각도: Medium**

README diagram은 relay endpoint를 `/ws`라고 적는다(`code-kb/figwright/README.md:57-69`). Production plugin client는 `ws://host:port`처럼 path 없는 root URL로 연결한다(`code-kb/figwright/packages/plugin/ui/relay/client.ts:246-250`). `WebSocketServer`도 `path`를 지정하거나 `req.url`을 검사하지 않아 Host/Origin만 맞으면 `/`, `/ws`, 임의 path 모두 upgrade한다(`code-kb/figwright/packages/mcp/src/relay/relay.ts:66-96`).

현재는 `/ws`도 우연히 허용돼 README 예시가 실패하지 않지만 protocol endpoint가 명확하지 않고 공격·관측 surface가 불필요하게 넓다. 피리뷰 보고서는 client URL은 정확히 적었으나 이 문서/구현 drift는 대조표에서 다루지 않았다.

**수정 제안**

- canonical path를 `/ws`로 정하고 server/client 양쪽에서 강제하거나 README를 root WS로 고친다.
- 잘못된 upgrade path가 거절되는 test를 추가한다.

### A-FW-07 — icon library 11종→12종

**심각도: Low**

보고서 10.5는 installed icon library를 11종 탐지한다고 적는다(`docs/code-kb-analysis/03-figwright-analysis.md:457-468`). 실제 `ICON_LIBRARY_DEPS`는 lucide 2, tabler 2, heroicons 2, phosphor 2, react-icons, react-feather, radix, unplugin-icons로 **12개**다(`code-kb/figwright/packages/mcp/src/icons/repo-icons.ts:82-100`).

**수정 제안**: 12종으로 정정하거나 숫자를 제거하고 목록을 authority로 링크한다.

### A-FW-08 — README “single plugin connection” drift 누락

**심각도: Low**

현재 relay는 여러 plugin session과 most-recently-active routing을 지원하고 보고서도 이를 정확히 분석한다(`docs/code-kb-analysis/03-figwright-analysis.md:312-314`). 그러나 README architecture에는 leader가 “owns the single plugin connection”이라고 남아 있으면서 바로 다음 줄은 most-recently-active file routing을 말한다(`code-kb/figwright/README.md:57-68`). 현 source의 `SessionManager`와 `connectedCount` 의미에 맞지 않는 문서 내부 모순이다.

**수정 제안**: 문서 주장 대조표에 추가하고 “owns the relay and multiple plugin sessions”로 README 수정 권고를 넣는다.

### A-FW-09 — live 검증 전 “이미 동작 가능한 형태” 표현

**심각도: Low**

보고서는 node_modules/pnpm/dist가 없어 build/test와 Figma live E2E를 실행하지 못했다고 명확히 적는다(`docs/code-kb-analysis/03-figwright-analysis.md:38-42,933-940`). 그럼에도 최종 절은 비용 대체 경로가 “이미 동작 가능한 형태”라고 단정한다(`docs/code-kb-analysis/03-figwright-analysis.md:885-900`). Source와 test가 구현을 강하게 뒷받침하지만 이번 조사 증거는 runtime 성공까지 포함하지 않는다.

**수정 제안**: “source와 test에 구현돼 있으나 이 환경에서 build/live round-trip은 재검증하지 못했다”로 좁힌다.

## 5. 수정 없이 유지 가능한 핵심 검증

1. **파일/정량**: 612행 inventory의 번호·path·line·bytes가 모두 맞다.
2. **112 surface**: 이름 집합, read/local/write 23/10/79, destructive 11, handler 105/exception 7, batch 30이 맞다.
3. **Grounding**: full projection, component/style dedupe, token name resolution, 1,500-node pre-bail, 24k estimated-token degradation 순서가 코드와 일치한다.
4. **Code→Figma**: 79 write surface는 넓지만 deterministic parser/reverse compiler가 아니라 prompt/skill orchestration이라는 평가가 정확하다.
5. **`scan_components` 혼동**: local code AST scanner를 Figma component discovery처럼 설명한 prompt/skill 오류 지적이 타당하다.
6. **Relay/election**: leader/follower/conflicted, follower validation, abdication, quiet/yield/backoff, wedge diagnosis, session activity routing 설명이 정확하다.
7. **Idempotency/batch**: completed-result-only cache의 concurrent miss와 60초/plugin-memory 한계, capture/apply/rollback 설명이 정확하다.
8. **Security/filesystem**: same-user auth 부재, arbitrary root/output path, wildcard network, prompt injection, diagnostics, local write의 readOnlyHint 오류를 적절히 식별했다.
9. **Tests/CI**: test 수, contract/projection gates, no live Figma, Node 24-only CI, coverage threshold 0, direct tag gate 공백이 정확하다.
10. **정책·비용**: REST/official MCP를 호출하지 않는 기술 경로와 seat/edit/plan/Community 정책 경계를 분리한 표현이 적절하다. 현재 제한 숫자를 단정하지 않은 점도 좋다.
11. **통합 권고**: serializer/shared/relay/join core를 재사용하고 auth, workspace sandbox, output parsing, per-file queue, provenance graph를 추가한다는 우선순위가 타당하다.

## 6. 수정 우선순위

1. A-FW-01, A-FW-02의 silent cross-file grounding을 P0/P1 correctness 항목으로 승격한다.
2. A-FW-03의 두 배포 artifact license/notice를 release gate로 고친다.
3. A-FW-04~06을 relay/election/security 및 protocol drift에 반영한다.
4. A-FW-07~09의 수치·README·증거 표현을 정밀화한다.

이 수정 뒤에는 피리뷰 보고서의 나머지 상세 분석과 통합 채택 결론을 유지해도 된다.
