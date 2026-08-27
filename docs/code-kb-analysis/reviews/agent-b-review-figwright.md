# Agent B 교차 리뷰 — Figwright 분석 보고서

> 리뷰 대상: `docs/code-kb-analysis/03-figwright-analysis.md` 및 `inventories/figwright-file-inventory.md`  
> 원본: `code-kb/figwright` @ `a835e81b575eab2c9265a67f9353c89b848f81ca`  
> 리뷰 시점: 2026-08-27 (Asia/Seoul)  
> 원칙: 원 보고서/원본 저장소는 수정하지 않고, `git ls-files` 612개와 구현·테스트·설정을 독립 대조

## 1. 총평

Agent C의 보고서는 세 프로젝트 중 가장 큰 저장소를 높은 밀도로 잘 정리했다. 612개 inventory, 112 tool의 23 read/79 write/10 local 분류, plugin handler 105와 exception 7, special handler 13, prompt/skill 2+2, grounding projection/dedupe, leader/follower election, version skew, filesystem side effect, idempotency 공백, code→Figma의 비대칭을 대부분 정확하게 설명한다.

필수 수정은 high 3건이다.

1. `Origin: null`은 Figma plugin만의 identity가 아니므로 WebSocket gate가 hostile sandboxed iframe을 구별하지 못한다.
2. plugin WebSocket이 tool 처리 중 끊기면 reconnect가 해당 in-flight request를 재전송·실패 처리하지 않아 timeout과 mutation 결과 불확실성이 생긴다.
3. “공식 MCP의 read-oriented 흐름을 79 write tool로 대체”한다는 비교는 현행 공식 `use_figma`/`generate_figma_design` 기능과 맞지 않는다.

Medium으로 HTTP request body 무제한 축적, selection-scoped component discovery, release plugin ZIP의 MIT notice 누락을 반영해야 한다. Inventory 수치와 개별 612행에는 수정 사항이 없다.

## 2. Finding 요약

| ID | Severity | 영역 | 결론 |
|---|---|---|---|
| F-W-01 | HIGH | WebSocket 보안 | `null` Origin allowlist는 sandboxed hostile iframe도 통과한다. handshake에 secret/peer proof가 없어 fake plugin session이 routing을 탈취할 수 있다. |
| F-W-02 | HIGH | relay/reconnect/idempotency | dispatch된 request는 socket flap 후 queue에 복구되지 않는다. write가 적용됐는지 모르는 채 timeout되고 수동 재시도는 duplicate mutation이 될 수 있다. |
| F-W-03 | HIGH | 비용·공식 MCP 비교 | 공식 MCP를 read-oriented로 표현한 표는 현재 틀리다. 공식 MCP도 Plugin API 기반 `use_figma` write와 live UI→editable layers `generate_figma_design`을 제공한다. |
| F-W-04 | MEDIUM | HTTP/DoS | `/rpc`와 `/abdicate` body를 제한 없이 memory에 concat한다. 같은-user local process가 memory exhaustion을 만들 수 있다. |
| F-W-05 | MEDIUM | code→Figma grounding | `get_local_components`는 file-wide가 아니라 selection/subtree 전용이며 remote library key discovery도 없다. 현재 prompt의 “file existing components” discovery는 불완전하다. |
| F-W-06 | MEDIUM | 라이선스/릴리스 | 보고서는 npm LICENSE만 의심하지만 plugin ZIP은 workflow상 확정적으로 `manifest.json + dist`만 담아 root MIT notice를 제외한다. |
| F-W-07 | LOW | 재현성 | 112 kind 집계 명령은 개별 `kind` grep만 제시해 registry membership과 결합된 23/79/10을 그대로 재현하지 못한다. |

## 3. 상세 Finding

### F-W-01. `Origin: null` allowlist는 plugin identity가 아니다

**현재 보고서**

보안 절은 loopback Host와 absent/null/Figma Origin 검사를 구현된 방어로 평가하고, 남은 impersonation 위험을 “local same-user process”로만 적는다 (`docs/code-kb-analysis/03-figwright-analysis.md:632-658`). 통합 권고도 local-access Host/Origin gate를 거의 그대로 재사용할 후보로 둔다 (`03-figwright-analysis.md:829-843`).

**원본 동작**

- `PLUGIN_ORIGINS`는 literal `null`을 허용한다 (`code-kb/figwright/packages/mcp/src/local-access.ts:18-25`).
- `isAllowedWsOrigin`은 이 값이면 upgrade를 승인한다 (`local-access.ts:60-67`).
- Relay의 `verifyClient`는 Host와 Origin만 보고 승인한다 (`packages/mcp/src/relay/relay.ts:74-96`).
- `$hello`는 protocolVersion, clientVersion, caller-chosen sessionId를 parse하지만 per-launch secret이나 Figma peer proof는 없다 (`relay.ts:362-455`; `packages/shared/src/envelope.ts`).

일반 웹 페이지도 `sandbox="allow-scripts"` iframe/srcdoc을 만들면 serialized Origin이 `null`인 WebSocket client를 실행할 수 있다. 이 client는 localhost Host gate를 정상 통과하고 valid `$hello`/`$activity`를 보내 가장 active한 session이 된 뒤, agent request를 받고 fabricated result를 돌려줄 수 있다. 즉 Origin gate는 일반 cross-site page를 상당 부분 줄이지만 `null`은 Figma 전용 증명이 아니다.

**영향**

- design/tool input 유출.
- fake read result를 통한 code generation poisoning.
- write result 성공 위조.
- 새 fake session이 routing priority를 가져가 real file 대신 응답.

**수정 권고**

1. 이 항목을 high로 올리고 “Origin/Host는 defense-in-depth, authentication이 아님”이라고 명시한다.
2. MCP process가 만든 short-lived pairing secret을 plugin panel에 입력/QR/paste하고 `$hello` challenge-response에 묶는다.
3. request/result에 authenticated session generation을 포함한다.
4. integration reuse table의 local-access gate는 secret과 함께 쓸 때만 높은 가치라고 고친다.

### F-W-02. reconnect grace가 이미 dispatch된 in-flight request를 복구하지 않는다

**원본 동작**

Relay pending entry에는 `dispatched`와 `dispatchedToSessionId`가 있다 (`code-kb/figwright/packages/mcp/src/relay/relay.ts:38-54`). socket close 시 SessionManager는 session을 disconnected로 바꾸고 socket만 null로 만든다. pending은 건드리지 않는다 (`packages/mcp/src/relay/session.ts:84-97`).

같은 sessionId가 reconnect하면 `flushQueue`가 실행되지만, 이 함수는 `entry.dispatched`가 true인 요청을 건너뛴다 (`packages/mcp/src/relay/relay.ts:300-313,415-455`). 따라서 old socket으로 보낸 뒤 reply 전에 connection이 끊긴 request는 새 socket으로 재전송되지 않는다.

plugin UI에서도 request handler는 old `ws` instance를 closure로 들고 있고, 작업 완료 후 그 old socket으로 reply를 보낸다 (`code-kb/figwright/packages/plugin/ui/relay/client.ts:354-435`). reconnect된 current socket으로 결과를 넘기는 journal이 없다.

**결과**

- server pending은 tool timeout까지 남는다.
- mutation이 sandbox에서 이미 적용됐는지 caller가 알 수 없다.
- direct leader path는 relay timeout을 retry하지 않는다 (`packages/mcp/src/dispatch.ts:77-102`).
- 사용자가 새 MCP call을 하면 새로운 requestId라 60초 idempotency cache가 막지 못하고 duplicate create/delete/set이 발생할 수 있다 (`packages/plugin/src/idempotency.ts:21-45`).

보고서는 reconnect grace, completed-result-only idempotency, no-plugin queue는 각각 분석했지만 이 연결을 빠뜨렸다 (`03-figwright-analysis.md:565-600,602-611`).

**수정 권고**

- write request 상태를 `queued / dispatched / acknowledged / completed / outcome-unknown`으로 관리한다.
- disconnect 시 dispatched writes를 즉시 outcome-unknown으로 실패시키거나, same requestId로 resume protocol을 구현한다.
- read는 안전하게 replay하고 write는 plugin-side in-flight Promise+completed cache와 함께 replay한다.
- “socket flap during delayed write” E2E에서 side effect count와 caller result를 검증한다.

### F-W-03. 현행 공식 Figma MCP는 read-oriented 전용이 아니다

보고서 비용 표는 Figwright가 “공식 MCP의 read-oriented 흐름”을 79 write tool로 대체한다고 쓴다 (`docs/code-kb-analysis/03-figwright-analysis.md:109-123`). 2026-08-27 현재 이 비교는 사실과 다르다.

- 공식 remote MCP의 `use_figma`는 Plugin API context에서 JavaScript를 실행해 frame, component, variable, auto-layout 등 native Figma content를 create/edit한다. [Write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/).
- `generate_figma_design`은 browser의 live UI를 editable Figma layer로 capture한다. [Code to canvas](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/).
- 공식 tool catalog에도 `use_figma`, `generate_figma_design`, asset upload/download, design-system search가 있다. [Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/).

Figwright의 기술 차별점은 “write가 존재한다”가 아니라 다음이다.

- local sideloaded execution이라 공식 remote MCP endpoint/OAuth/tool quota를 사용하지 않음.
- 112개 typed primitive와 자체 grounding/join/relay를 제공.
- 반면 code→Figma는 LLM orchestration이고, 공식 `generate_figma_design` 같은 live DOM capture pipeline은 없음.

공식 `use_figma`는 Full seat/edit permission, output/asset/font 등 현재 limitation이 있으므로 비용·제약 비교는 여전히 의미가 있다. 다만 기능 존재 여부와 비용 조건을 분리해야 한다. 이 오류는 사용자 핵심 요구인 비용 우회와 code→Figma 비교를 왜곡하므로 high다.

### F-W-04. leader HTTP body가 unbounded다

`readBody`는 incoming chunk를 array에 계속 push하고 end에서 `Buffer.concat`한다. byte cap, Content-Length check, stream destroy가 없다 (`code-kb/figwright/packages/mcp/src/election/leader-endpoints.ts:38-44`). 이 helper를 `/abdicate`와 `/rpc` 모두 사용한다 (`leader-endpoints.ts:105-155,159-205`).

Host/Origin/content-type gate는 browser CSRF 방어에는 도움이 되지만 same-user process는 `application/msgpack` 또는 JSON으로 arbitrary-size body를 보낼 수 있다. 보고서는 same-user auth 공백과 stdio 10 MiB는 적었지만 leader HTTP memory bound는 누락했다.

**수정 권고**

- endpoint별 최대 bytes를 정하고 stream 수신 중 초과 즉시 `req.destroy()`/413.
- follower가 encode 전에 같은 limit를 검증.
- binary-heavy call은 HTTP relay에 inline하지 않고 file/binary stream capability로 분리.
- body-limit/slowloris/declared-length mismatch test 추가.

### F-W-05. code→Figma의 component discovery는 file-wide가 아니다

보고서는 `scan_components`가 local code AST scanner라는 prompt 오류를 정확히 찾았다 (`03-figwright-analysis.md:757-783`). 그러나 남은 Figma-side 대안도 범위가 좁다.

- `get_local_components` tool 설명은 node subtree 또는 current selection 전용이라고 명시한다 (`code-kb/figwright/packages/mcp/src/tools/get-local-components.ts:7-20`).
- handler도 selection이 없고 nodeId가 없으면 error를 내며 document-wide scan을 의도적으로 하지 않는다 (`packages/plugin/src/handlers/get-local-components.ts:9-28`).
- file 전체를 찾으려면 caller가 pages를 열거하고 pageId별로 반복 scan해야 하지만 `code_to_figma` prompt와 `figma-build` skill은 이 절차를 설명하지 않는다 (`packages/mcp/src/prompts/code-to-figma.ts:14-29`; `skills/figma-build/SKILL.md:29-36`).
- `create_instance(componentKey)`는 published component를 import할 수 있지만 available library component key를 검색하는 Figwright tool은 없다 (`packages/mcp/src/tools/create-instance.ts:7-20`).

따라서 “reuse file's existing components first”는 selection 안에 master가 있거나 caller가 key/ID를 이미 아는 경우에 강하고, arbitrary file/library discovery에는 불완전하다.

**수정 권고**

- report의 code→Figma P1을 `scan_components` 혼동 + selection-scoped Figma discovery + remote library search 부재로 확장.
- prompt가 `get_pages → page별 get_local_components(pageId)`를 수행하도록 수정하거나 bounded file-wide component index tool을 추가.
- policy/plan이 허용하는 library search/import capability를 별도 설계.

### F-W-06. plugin release ZIP은 MIT notice를 포함하지 않는다

보고서는 `packages/mcp/package.json`의 `files:["LICENSE"]`와 실제 package-local LICENSE 부재를 잘 지적했지만 “npm tarball은 pack으로 확인”에서 멈춘다 (`03-figwright-analysis.md:44-60`).

plugin artifact는 정적으로 더 확실하다. release workflow는 plugin directory에서 다음만 ZIP한다.

```text
manifest.json
dist/
```

근거는 `code-kb/figwright/.github/workflows/release.yml:57-63`이다. root `LICENSE`는 포함하지 않는다. MIT는 software의 copy/substantial portion에 copyright와 permission notice 포함을 요구한다 (`code-kb/figwright/LICENSE:5-16`). compiled plugin bundle 배포물에도 notice가 있어야 한다.

**수정 권고**

- release 전에 root LICENSE를 `packages/plugin/LICENSE`와 `packages/mcp/LICENSE`로 sync하거나 package step에서 명시적으로 copy.
- plugin ZIP test로 `manifest.json`, dist 2개, LICENSE 존재를 assert.
- npm `pnpm pack` tarball content도 CI에서 검사.

### F-W-07. tool kind 집계의 재현 명령을 완결할 필요가 있다

보고서의 재실행 절은 `rg "kind: ..." packages/mcp/src/tools`만 제시한다 (`03-figwright-analysis.md:902-931`). 이 grep은 `spec.ts` comment의 예시 `kind: 'local'` 같은 non-tool occurrence도 세므로 실제 실행 시 local 11/total 113으로 보일 수 있다. authority는 `ALL_TOOL_SPECS` membership이다.

실제 23/79/10을 재현하려면 registry import/array와 각 imported ToolSpec의 kind를 결합하거나, dependency 설치 후 registry module을 import해 group해야 한다. 보고서 숫자는 맞지만 제시 command만으로 동일 값이 나오지 않는다는 low reproducibility finding이다.

## 4. 독립 재검증 — 수정 불필요

| 검증 항목 | 결과 | 근거 |
|---|---|---|
| Git 기준점 | `a835e81b575eab2c9265a67f9353c89b848f81ca`, `v0.4.0-33-ga835e81` | local Git |
| inventory 총계 | 612 files, 7,010,446 bytes, text 605/binary 7, 69,469 physical/62,275 nonblank | strict UTF-8 per-file recount |
| inventory 개별 612행 | path/line/bytes mismatch 0 | Markdown table parse vs worktree |
| file hash | unique SHA-256 612 | local hash recount |
| tool 수 | 112 unique | `packages/mcp/src/tools/registry.ts:120-239` |
| kind | read 23, write 79, local 10 | registry member ToolSpec join |
| plugin handler | 105; same-name exception 7 | `packages/plugin/src/handlers/registry.ts`, `test/tool-registry.test.ts:14-27` |
| special handlers | 13 | `packages/mcp/src/index.ts:100-149` |
| destructive | 11 | ToolSpec flags |
| prompts/skills | 2 MCP prompts, 2 distributed skills | prompt/skill registries |
| static test sites | 196 test files, 1,770 `it/test` declarations | tracked test set and regex recount |
| dedupe/guard | full public default, 1,500-node pre-bail, 24k token degradation | design-context guard/plugin handler |
| grounding limits | silent scan caps, partial parsing, internal guard bypass findings confirmed | profile/scan/token/join code |
| idempotency gap | completed-only 60s memory cache; concurrent same ID miss | `packages/plugin/src/idempotency.ts:21-45` |
| local annotation bug | non-write kind → `readOnlyHint:true` while local tools write files | `packages/mcp/src/tools/annotations.ts:14-17` |
| filesystem scope | absolute root/output accepted, overwrite-capable writes | local tool implementations |
| election | newest-build abdication, quiet window, wedge diagnosis, SIGCONT, Windows guard | election/lock/endpoints |
| current environment | Node 24.19 only; pnpm/deps/dist absent, suite not executed | command discovery/worktree |
| source status | clean | `git status --short` |

## 5. 반영 우선순위

1. F-W-01을 security/P0/reuse table에 반영하고 Origin gate를 authentication으로 오인하지 않게 수정.
2. F-W-02를 relay/reconnect/idempotency/test gap에 추가.
3. F-W-03 비용 비교표와 최종 채택 판단에서 현행 official write/code-to-canvas를 반영.
4. F-W-04 HTTP body cap을 security/performance에 추가.
5. F-W-05 code→Figma component discovery 제약을 prompt 오류와 함께 확장.
6. F-W-06 두 release artifact의 LICENSE CI를 권고.
7. F-W-07에 실제 registry-aware count command 추가.

## 6. 최종 판정

인벤토리는 승인 가능하다. 본문도 grounding·registry·election·test·filesystem 분석의 대부분이 정확하다. 다만 F-W-01~F-W-03은 보안 및 공식 대안 비교의 핵심 결론을 바꾸므로 반드시 반영해야 한다. 이 보강 뒤에도 “Figwright는 세 프로젝트 중 가장 성숙한 grounding/local execution 기반이지만, public service에는 authentication·write serialization·workspace sandbox·정책 검토가 선행돼야 한다”는 최종 평가는 유지된다.

