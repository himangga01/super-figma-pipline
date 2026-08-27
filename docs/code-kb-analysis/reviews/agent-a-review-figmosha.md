# Agent A 교차 리뷰 — figmosha2 분석 보고서

## 1. 리뷰 범위와 판정

- 피리뷰 문서: `docs/code-kb-analysis/02-figmosha2-analysis.md` 586행, `docs/code-kb-analysis/inventories/figmosha2-file-inventory.md` 115행
- 원본 기준: `code-kb/figmosha2`, commit `547cefb4c90abaa1da68db5455b921cbf3f8a5b9`, tag `v2.1.0`
- 원본 전수 대조: Git 추적 15개 전부. 텍스트 14개는 전체 판독했고 `plugin/icon.png`는 원본 128×128 이미지를 직접 확인했다.
- 리뷰 중 원본 저장소 상태: `git status --short` 빈 결과

종합 판정은 **대체로 정확하며 통합 보고서의 기반으로 사용 가능하되, 라이선스 1건은 반드시 수정하고 동시성·실행기·정책 표현 6건은 보강해야 한다**이다. 파일 커버리지, 정량 수치, endpoint/CLI/helper 수, 일반 실행 흐름, 주요 README 불일치와 테스트 실행 상태는 모두 재검증과 일치했다.

## 2. 독립 재검증 결과

| 검증 항목 | 독립 결과 | 피리뷰 문서 판정 |
|---|---:|---|
| Git 추적 파일 | 15 | 일치 |
| 총 bytes | 109,430 | 일치 |
| 텍스트 물리/비공백행 | 2,518 / 2,082 | 일치 |
| PNG | 1개, 5,285 bytes, 128×128 | 일치 |
| HTTP endpoint | `GET /`, `GET /status`, `POST /exec` 3개 | 일치 |
| WebSocket endpoint | `GET /plugin` upgrade 1개 | 일치 |
| CLI subparser 이름 | 12 | 일치 |
| CLI 고유 handler 동작 | 11 (`import-component`/`icomp` alias) | 일치 |
| 공개 `HELPERS` method | 20 | 일치 |
| Python test | 함수 12개, parameter 전개 16 case | 일치 |
| Node helper check | 20개 | 일치; 리뷰 중에도 20/20 exit 0 재확인 |
| Python pytest | 현재 환경 미실행 | 일치; Python 3.14.7, `No module named pytest` 재확인 |
| 원본 Git 상태 | clean | 일치 |

## 3. 수정·보강 필요 finding 요약

| ID | 심각도 | 분류 | 요약 |
|---|---|---|---|
| A-FIG-01 | **High** | 라이선스 | MIT만 기록하고 내장 Solar SVG의 CC BY 4.0 고지·재사용 의무를 누락 |
| A-FIG-02 | **Medium** | 실행/정량 | Unix readiness를 “최대 약 1초”라고 단정했지만 `curl` 자체 timeout이 없어 상한이 아님 |
| A-FIG-03 | **Medium** | 동시성 | silent incumbent를 동시에 교체하려는 두 WS handshake 사이 race와 이중 활성 socket 가능성을 누락 |
| A-FIG-04 | **Medium** | 수명주기 | HTTP handler cancellation/server shutdown 경로에 `PENDING.pop` 보장용 `finally`가 없다는 누수 가능성 누락 |
| A-FIG-05 | **Medium** | 비용 주장 | 공식 MCP 경로 미사용과 실제 금전·token 비용 절감을 동일시할 수 있는 표현에 근거 부족 |
| A-FIG-06 | **Medium** | 구성 | “host/port 단절” 절이 custom port만 결론 내고 fixed `localhost`와 non-loopback/IPv6 bind 단절은 명시하지 않음 |
| A-FIG-07 | **Medium** | 정책 표현 | “승인된 local Plugin API” 표현이 API 제공 여부와 해당 integration의 정책 승인을 혼동시킴 |
| A-FIG-08 | **Low** | README 대조 | Community icon이 manifest에 없다는 이유만으로 “미연결” 판정한 것은 근거 부족 |
| A-FIG-09 | **Low** | undo 표현 | “undo 없는 rm”은 per-request checkpoint 부재와 Figma host의 실제 undo 가능성을 구분해야 함 |

## 4. 상세 finding

### A-FIG-01 — 내장 Solar 아이콘의 CC BY 4.0 누락

**심각도: High**

피리뷰 보고서는 저장소 라이선스를 MIT로만 요약하고 MIT source라 재사용하기 쉽다고 평가한다(`docs/code-kb-analysis/02-figmosha2-analysis.md:26,31,486`). 그러나 UI에 인라인된 세 SVG path는 소스 자체가 “Solar icon set by 480 Design — CC BY 4.0”이라고 명시한다(`code-kb/figmosha2/plugin/ui.html:38-43`). changelog도 동일한 출처와 CC BY 4.0을 명시한다(`code-kb/figmosha2/CHANGELOG.md:72-75`).

이는 통합 재사용의 라이선스 의사결정에 직접 영향을 준다. 저장소 루트 MIT 고지만 보고 SVG를 복사하면 저작자·출처·라이선스 attribution 의무를 놓칠 수 있다. `plugin/icon.png`의 별도 provenance도 원본 파일만으로 확정되지 않으므로 확인 대상으로 분리해야 한다.

**수정 제안**

1. 라이선스 표에 “코드: MIT, UI status SVG: Solar/480 Design CC BY 4.0 고지”를 추가한다.
2. 통합 재사용 표에 attribution 보존 또는 자체 아이콘 교체를 필수 조건으로 넣는다.
3. `plugin/icon.png`는 Solar 자산인지 자체 자산인지 불확실하다고 기록한다.

### A-FIG-02 — `start-bridge.sh` readiness의 1초 상한 표현 오류

**심각도: Medium**

보고서는 Unix launcher readiness를 “최대 약 1초 동안 `/status` 10회”라고 기록한다(`docs/code-kb-analysis/02-figmosha2-analysis.md:135`). loop 자체는 0.1초 sleep을 최대 10회 하지만 각 `curl -sf http://localhost:8787/status`에는 `--connect-timeout`이나 `--max-time`이 없다(`code-kb/figmosha2/start-bridge.sh:11-22`). 포트가 연결만 받고 응답하지 않는 경우 한 번의 probe가 장시간 멈출 수 있으므로 1초는 명목 sleep budget이지 wall-clock 상한이 아니다.

**수정 제안**

- 문구를 “정상적인 connection-refused 상황에서 명목상 약 1초; curl probe 자체 상한 없음”으로 바꾼다.
- 구현 권고에 `curl --connect-timeout 0.2 --max-time 0.5` 같은 명시적 probe deadline을 넣는다.

### A-FIG-03 — 동시 WebSocket handover race 누락

**심각도: Medium**

보고서는 PENDING과 plugin executor의 직렬화 부재는 잘 분석했지만(`docs/code-kb-analysis/02-figmosha2-analysis.md:295-311`), plugin slot 교체 자체도 lock 없이 수행된다는 점은 빠졌다. `plugin_ws_handler`는 `old = PLUGIN_WS`를 잡은 뒤 최대 1초 `_incumbent_answers()`를 await하고, 돌아온 다음 현재 generation을 다시 확인하지 않고 `PLUGIN_WS = ws`로 교체한다(`code-kb/figmosha2/bridge.py:144-174`).

silent incumbent가 있을 때 challenger A와 B가 거의 동시에 접속하면 둘 다 같은 `old`를 probe하고 timeout한 뒤 차례로 자신을 active로 설정할 수 있다. A는 열린 채 stale이 되고 B만 global active가 될 수 있으며, B 종료 뒤 A는 socket이 열려 있어도 자동 승격·재연결되지 않는 장애 상태가 가능하다. 현재 test는 challenger 하나의 순차 handover만 다룬다(`code-kb/figmosha2/tests/test_bridge.py:222-245`).

**수정 제안**

- 보안/동시성 절에 이 race를 추가한다.
- server-side `asyncio.Lock`, connection generation token, await 후 `PLUGIN_WS` 재확인, loser 강제 close를 권고한다.
- 두 challenger를 동시에 연결하는 regression test를 추가한다.

### A-FIG-04 — handler cancellation 시 PENDING 정리 보장 누락

**심각도: Medium**

보고서는 client disconnect가 plugin script를 취소하지 않는다고 적지만(`docs/code-kb-analysis/02-figmosha2-analysis.md:307,433`), Python request task 자체가 취소되는 경로의 registry 정리를 별도로 다루지 않는다. `exec_handler`는 `PENDING[rid]`를 만든 후 send 실패와 `asyncio.TimeoutError`, 정상 결과에서만 pop한다. `asyncio.CancelledError`나 server shutdown cancellation을 포괄하는 `finally`가 없다(`code-kb/figmosha2/bridge.py:249-290`). aiohttp 실행 설정에 따른 client-disconnect cancellation 여부는 별도 실험이 필요하지만, 코드만으로는 모든 exit path의 정리를 보장할 수 없다.

**수정 제안**

- “client disconnect 시 즉시 cancel하지 않음”을 “handler task cancellation 경로에는 pending cleanup 보장도 없음”으로 확장한다.
- `try/finally: PENDING.pop(rid, None)`와 cancel message protocol을 권고한다.
- response body를 읽지 않고 연결을 끊는 client test와 server shutdown test를 추가한다.

### A-FIG-05 — 비용 절감 표현의 증거 경계

**심각도: Medium**

보고서가 증명한 사실은 Figma REST/공식 MCP endpoint를 호출하지 않고 local Plugin API 경로를 쓴다는 것이다(`code-kb/figmosha2/bridge.py:229-327`, `plugin/code.js:319-355`). 그런데 “MCP 호출 단위 비용을 줄일 수 있다”는 문구는 실제 공식 MCP 과금 단위, LLM token 사용량, Figma seat/subscription, Plugin API 운영 제한에 관한 측정 없이 금전 절감까지 암시한다(`docs/code-kb-analysis/02-figmosha2-analysis.md:77`). README latency 수치는 검증 불가라고 잘 표시했지만 비용 수치도 같은 증거 기준을 적용해야 한다.

**수정 제안**

- “공식 Figma REST/MCP 호출이 0이므로 그 경로의 호출 quota 대상이 아니다”까지만 확정한다.
- “금전 절감 폭은 미측정이며 LLM token, Figma seat/plan, local compute와 정책 비용은 남는다”를 추가한다.
- “no rate limit/unlimited”로 일반화하지 않도록 한다.

### A-FIG-06 — fixed localhost와 custom host의 단절 누락

**심각도: Medium**

보고서의 “host/port 설정의 단절” 절은 custom port 실패를 정확히 지적하지만 결론은 port에만 한정된다(`docs/code-kb-analysis/02-figmosha2-analysis.md:140-146`). plugin은 주소 전체를 `ws://localhost:8787/plugin`으로 고정하고 manifest도 localhost 두 scheme만 허용한다(`code-kb/figmosha2/plugin/ui.html:46`, `plugin/manifest.json:9-11`). 따라서 bridge를 특정 LAN IP나 `::1`에만 bind하면 CLI가 그 host를 향해도 plugin은 localhost로 연결해 실패할 수 있다. `0.0.0.0`처럼 loopback도 함께 받는 bind만 예외다(`code-kb/figmosha2/bridge.py:333-356`).

**수정 제안**

- custom host와 IPv4/IPv6 topology도 end-to-end 설정 단절에 포함한다.
- UI/server/client/manifest를 한 설정에서 생성한다는 기존 권고에 bind/connect 주소의 분리를 추가한다.

### A-FIG-07 — “승인된 local Plugin API” 정책 표현

**심각도: Medium**

정책 위험을 전반적으로 신중하게 다뤘으나, 결론 문장 하나는 비용 우회를 “승인된 local Plugin API를 쓰는 아키텍처 대체”라고 표현한다(`docs/code-kb-analysis/02-figmosha2-analysis.md:92`). Figma가 Plugin API를 제공한다는 사실과 이 raw executor integration·배포 형태가 Terms/review에서 승인됐다는 사실은 다르다. 같은 문서의 공개 배포 위험 설명(`docs/code-kb-analysis/02-figmosha2-analysis.md:94-99,363-374`)과도 뉘앙스가 충돌한다.

**수정 제안**

- “사용자가 실행하고 현재 파일 권한 범위에서 동작하는 local Plugin API”로 고친다.
- API availability, 파일 권한, integration 정책 승인 세 층을 별도 표로 유지한다.

### A-FIG-08 — Community icon의 manifest 미참조 판정

**심각도: Low**

README는 `plugin/icon.png`를 “for publishing to Community”라고만 설명한다(`code-kb/figmosha2/README.md:341-355`). 보고서는 manifest가 icon을 참조하지 않는다는 이유로 이 주장을 “미연결”로 판정한다(`docs/code-kb-analysis/02-figmosha2-analysis.md:474`). 원본 manifest에 icon field가 없다는 사실만으로 Community 게시 단계에서 별도 업로드되는 자산인지, 실제로 미연결인지 판단할 수 없다.

**수정 제안**

- 판정을 “파일·규격 확인, 실제 Community publishing workflow 미검증”으로 바꾼다.
- manifest reference 부재를 기능 불일치 근거로 사용하지 않는다.

### A-FIG-09 — undo 부재 표현의 범위

**심각도: Low**

보고서는 CLI write에 undo/confirm이 없고 “undo 없는 `rm`”이라고 표현한다(`docs/code-kb-analysis/02-figmosha2-analysis.md:211-215,525`). 실제 코드 전체에는 `figma.commitUndo()` 호출이 없으므로 **요청별 명시적 undo checkpoint가 없다**는 주장은 확실하다(`code-kb/figmosha2/plugin/code.js:319-355`; 전 저장소 `commitUndo` 검색 0건). 다만 Figma host가 plugin mutation을 최종적으로 어떤 자동 undo 단위로 묶는지는 실환경/공식 계약을 확인하지 않고 “undo 불가능”으로 단정할 수 없다.

**수정 제안**

- “per-request explicit undo boundary/rollback API 없음”으로 정밀화한다.
- long-lived plugin session에서 여러 exec의 실제 Ctrl/Cmd+Z granularity를 불확실성 및 Figma E2E 항목에 넣는다.

## 5. 수정이 필요하지 않은 주요 검증 항목

다음 핵심 내용은 원본과 일치해 유지할 수 있다.

1. **파일 범위와 정량**: 15개·109,430 bytes·2,518/2,082행 및 각 파일 수치가 모두 맞다.
2. **CLI/helper/endpoint 수**: 12 parser 이름/11 고유 동작, helper 20개, HTTP 3+WS 1이 맞다.
3. **실행 흐름**: HTTP UUID/Future → WS → UI postMessage → `new Function` → ID별 result/log/error 설명이 정확하다.
4. **custom port 결함**: 8787 hardcode와 manifest allowlist 때문에 bridge/CLI만 바꾸면 실패한다는 판정이 맞다.
5. **동시 실행 위험**: PENDING이 queue가 아니라 map이고 `CURRENT_PRINT`가 exec 간 섞이는 분석이 정확하다.
6. **timeout 의미**: 504가 plugin execution을 취소하지 않아 뒤늦은 mutation이 가능하다는 분석이 정확하다.
7. **보안**: unauthenticated raw `/exec`, null-Origin WS, LAN bind, 과도한 permission, 누적 result/log cap 부재를 적절히 식별했다.
8. **README drift**: Python/plugin line 수, helper 절감·latency 미검증, mixed-font, `documentAccess`, 2.0/2.1 contract, log UI 표현 지적이 타당하다.
9. **비용 대체의 기본 구조**: REST/공식 MCP endpoint를 속이는 것이 아니라 user-run Plugin API channel로 바꾸는 설명이 정확하다.
10. **정책 경계**: 권한/seat/plan/Terms를 우회하지 않으며 내부 도구와 공개 배포를 분리해야 한다는 결론이 적절하다.
11. **통합 권고**: raw executor를 중앙 API로 재사용하지 않고 local sidecar로 제한하며 semantic IR·typed command·approval/audit 계층을 신설한다는 권고가 타당하다.
12. **테스트 표현**: Node 20개만 실제 통과로, Python 16 case는 정의만 있고 현재 환경 미실행으로 구분한 것이 정확하다.

## 6. 권고 수정 우선순위

1. **필수**: A-FIG-01을 반영해 라이선스·재사용 표에 CC BY 4.0 attribution을 추가한다.
2. **기술 정확성**: A-FIG-02, A-FIG-03, A-FIG-04, A-FIG-06을 실행/동시성/수명주기 절에 반영한다.
3. **제품·정책 정확성**: A-FIG-05와 A-FIG-07의 표현을 좁혀 기술 경로와 비용·정책 승인을 분리한다.
4. **문서 정밀화**: A-FIG-08과 A-FIG-09의 판정을 “미검증” 및 “명시적 checkpoint 부재”로 고친다.

위 수정 후에는 Agent B 보고서의 나머지 구조와 상세 표를 유지해도 된다.
