# Agent C 교차 리뷰 — figma-mcp-rust / figmosha2

> 리뷰어: Agent C (원 Figwright 담당)  
> 리뷰 기준: 2026-08-27, 각 보고서가 고정한 commit  
> 대상 문서:
>
> - <code>docs/code-kb-analysis/01-figma-mcp-rust-analysis.md</code>
> - <code>docs/code-kb-analysis/inventories/figma-mcp-rust-file-inventory.md</code>
> - <code>docs/code-kb-analysis/02-figmosha2-analysis.md</code>
> - <code>docs/code-kb-analysis/inventories/figmosha2-file-inventory.md</code>

## 1. 리뷰 방법과 severity

두 보고서와 두 inventory를 전부 읽고, 각 원본 저장소의 Git 추적 파일·commit·라인·바이트를 독립 재계산했다. 기능 목록은 문서 표를 믿지 않고 Rust <code>ToolDef</code>, TypeScript handler <code>case</code>, Python argparse, JavaScript <code>HELPERS</code>에서 다시 추출했다. 실행 흐름·보안·동시성 finding은 실제 branch와 await 경계를 따라 검증했다.

Severity 정의는 다음과 같다.

| 등급 | 의미 |
|---|---|
| Critical | 보고서 판단을 뒤집거나 즉시 악용 가능한 중대한 사실 오류 |
| High | 서비스 통합·보안·정확성 결정을 바꾸는 누락/오판 |
| Medium | 출시·운영·법적 고지·client UX에 영향을 주는 보완 필요 |
| Low | 표현 정밀도, 재현성, 유지보수 개선 |

이번 리뷰에서 inventory 누락이나 기능 수 오계수 같은 Critical finding은 없었다.

---

## 2. figma-mcp-rust 리뷰

### 2.1 독립 재검증 결과

| 항목 | 보고서 | 독립 검증 | 판정 |
|---|---:|---:|---|
| commit | 6094566436577b29d04393c774d51492c12671e1 | 동일 | PASS |
| tag | v0.2.0 | 동일 | PASS |
| 추적 파일 | 93 | 93 | PASS |
| bytes | 598,008 | 598,008 | PASS |
| 물리/비공백 라인 | 15,986 / 14,200 | 동일 | PASS |
| inventory path 집합 | 93행 | Git 93개와 delta 0, duplicate 0 | PASS |
| Rust tools | 73 | 73, unique 73 | PASS |
| 보고서 tool 표 | 73 | registry와 delta 0 | PASS |
| plugin direct case | 72 | 72 | PASS |
| Rust special handler | 2 | save_screenshots, export_frames_to_pdf | PASS |
| plugin에 없는 registry tool | save_screenshots 1개 | 동일 | PASS |
| prompt/skill | 12 prompts / 13 skills | 동일 | PASS |
| Glama | 58, 15개 누락 | 동일 | PASS |

파일 coverage, 정량, tool 전수 표, 기본 데이터 흐름, dedupe snake/camel drift, stale WebSocket, 특수 handler validation bypass, filesystem symlink 위험, test gap, 비용·정책 경계는 매우 잘 조사됐다. 아래 finding은 그 결론을 보강해야 하는 부분이다.

### 2.2 Finding 요약

| ID | Severity | 유형 | 요약 |
|---|---|---|---|
| R-C-01 | High | 보안·실행 흐름 누락 | foreign/unhealthy port owner에게도 <code>/rpc</code>를 보내는 Unknown/follower 경로 |
| R-C-02 | High | 내부 모순·동시성 | “request-scoped” fast traversal flag가 queue 없는 병렬 handler에서 race |
| R-C-03 | High | 기능 범위 누락 | manifest가 Dev Mode를 허용하지만 52개 write의 read-only 제약 분석 없음 |
| R-C-04 | Medium | MCP 계약·보안 누락 | readOnly/destructive/idempotent tool annotations를 전혀 광고하지 않음 |
| R-C-05 | Medium | CI·공급망 누락 | release의 unpinned actions, latest curl pipe, direct-tag gate 부재 |
| R-C-06 | Medium | 라이선스·배포 누락 | npm package/plugin zip에 MIT LICENSE 포함 경로가 보이지 않음 |
| R-C-07 | Low | 비용 표현 | Figma API/MCP 비용과 LLM·local compute 비용을 더 분명히 분리할 필요 |

### 2.3 R-C-01 — Unknown 상태도 foreign port에 tool payload를 전송한다

**Severity: High / 보고서 누락 및 위험도 과소평가**

보고서 <code>01-figma-mcp-rust-analysis.md:163</code>은 port owner가 건강한 leader가 아니면 role이 <code>Unknown</code>으로 남는다는 점을 정확히 찾았다. 그러나 그 다음 tool call이 어떻게 되는지를 보안 finding으로 연결하지 않았다.

실제 흐름은 다음과 같다.

1. <code>Election::determine_role</code>은 bind 실패 후 <code>Follower::ping</code>이 false면 role을 Unknown으로 둔 채 성공 반환한다.  
   근거: <code>code-kb/figma-mcp-rust/src/election.rs:52-64</code>.
2. <code>Follower::ping</code>은 response body의 <code>status/version</code>이나 Figwright magic을 검사하지 않고 HTTP 2xx 여부만 본다. 임의 process가 <code>GET /ping</code>에 200을 주면 genuine leader로 오인한다.  
   근거: <code>code-kb/figma-mcp-rust/src/follower.rs:93-111</code>.
3. 더 나쁘게, <code>Node::send</code>는 role이 Leader가 아니면 Follower로 보낸다. Unknown도 예외가 아니다. 따라서 ping에 실패한 foreign/unresponsive port owner에도 <code>POST /rpc</code>로 tool name, node IDs, params를 전송한다. write text, token value, imageData 등 민감한 argument가 foreign process에 노출될 수 있다.  
   근거: <code>code-kb/figma-mcp-rust/src/node.rs:67-82</code>.

보고서의 보안 표는 인증 없는 genuine leader/plugin 경계를 자세히 다루지만 이 foreign-port exfiltration/confused-deputy path를 별도 위험으로 올리지 않았다. <code>src/follower.rs</code> 설명도 “HTTP status를 별도 검사하지 않는다”에 머물러 leader identity 문제를 명시하지 않는다(<code>보고서:368</code>).

**권고 수정**

- Unknown/Conflicted role에서는 tool dispatch를 fail-fast한다.
- <code>/ping</code> body에 product magic, protocol version, nonce를 넣고 엄격 parse한다.
- follower <code>/rpc</code>에 ephemeral secret을 요구한다.
- startup race와 foreign owner를 별도 state/error로 표면화한다.
- 보안 우선순위 표에 High로 추가한다.

### 2.4 R-C-02 — fast traversal flag는 request-scoped가 아니다

**Severity: High / 내부 모순**

보고서 <code>325</code>행은 큰 read 동안 <code>figma.skipInvisibleInstanceChildren</code>를 “일시 활성화하고 원래 값으로 복원한다”는 것을 장점으로 든다. 동시에 <code>376</code>행과 <code>504</code>행은 plugin main에 request queue가 없어 async handler가 겹칠 수 있다고 정확히 쓴다. 두 사실을 합치면 해당 장점은 concurrency에서 성립하지 않는다.

<code>plugin/src/main.ts</code>는 process-global Figma property를 다음처럼 바꾼다.

- request A: previous=false를 저장하고 true로 변경.
- request B: A가 await 중일 때 previous=true를 저장.
- A 완료: false로 복원.
- B 완료: true로 복원.

최종 flag가 원래 false가 아니라 true가 될 수 있다. A가 flag를 false로 되돌린 뒤 B의 traversal 결과가 달라질 수도 있고, fast read와 hidden instance layer write가 겹치면 write lookup이 null이 될 수 있다. 실제 handler는 <code>figma.ui.onmessage = async</code>일 뿐 이전 Promise 완료를 기다리는 chain/mutex가 없다.

근거:

- global flag와 prev/restore: <code>code-kb/figma-mcp-rust/plugin/src/main.ts:7-22,35-55</code>.
- queue 없는 async dispatch: <code>code-kb/figma-mcp-rust/plugin/src/main.ts:69-101</code>.
- 보고서의 서로 충돌하는 평가: <code>01-figma-mcp-rust-analysis.md:325,376,504</code>.

**권고 수정**

- read/write 모두 plugin-side FIFO 또는 최소한 fast traversal mutex를 둔다.
- flag mutation은 generation/ref-count 기반으로 복원한다.
- report의 strength 문장을 “single-request에서만 안전”으로 제한한다.
- concurrent fast+fast, fast+hidden-write regression test를 추가한다.

### 2.5 R-C-03 — Dev Mode에서 write surface가 작동하지 않는 점이 빠졌다

**Severity: High / 기능 범위 누락**

Manifest는 <code>editorType: ["figma", "dev"]</code>와 <code>capabilities:["inspect"]</code>를 선언한다. 그러나 plugin source에는 <code>figma.editorType</code> 또는 read-only preflight가 없다. Figma Dev Mode는 plugin write를 read-only로 거부하므로 보고서가 분류한 52개 생성·수정·style·variable·page/component/prototype tool 대부분은 Dev Mode에서 실패한다.

근거:

- <code>code-kb/figma-mcp-rust/plugin/manifest.json:12-14</code>.
- editor-aware branch 부재: <code>rg "figma.editorType" plugin/src</code> 결과 0.
- report tool 분류: read/export 21개와 나머지 write 52개, <code>01-figma-mcp-rust-analysis.md:200-295</code>.

보고서는 official Dev Mode MCP 비용 경로를 자세히 설명하지만, 정작 manifest가 Dev Mode에서 plugin을 실행하게 하는 기능·제약 matrix를 만들지 않았다. 통합 서비스가 “Dev Mode에서도 73 tools”로 오해할 수 있다.

**권고 수정**

- Figma Design / Dev Mode editor matrix를 별도 절로 추가한다.
- <code>get_metadata</code> 또는 status에 editor type/mode를 반환한다.
- write를 server/plugin에서 preflight하고 “Design mode로 전환” error를 준다.
- Dev Mode live acceptance를 남은 불확실성에 명시한다.

### 2.6 R-C-04 — MCP tool annotations 부재를 구체화해야 한다

**Severity: Medium / MCP 계약·승인 UX 누락**

보고서 보안 표 <code>445</code>행은 destructive confirmation/idempotency/transaction 부재를 넓게 지적한다. 여기에 더 구체적인 MCP contract fact가 필요하다. <code>tool_list()</code>는 <code>Tool::new(name, description, inputSchema)</code>만 호출하고 readOnly/destructive/idempotent/openWorld annotation을 설정하지 않는다. <code>ToolDef</code>에도 side-effect metadata가 없다.

근거:

- <code>code-kb/figma-mcp-rust/src/handler.rs:155-173</code>.
- <code>code-kb/figma-mcp-rust/src/tools/mod.rs:34-49</code>.
- delete_nodes, delete_style, delete_variable/collection, delete_page, detach/ungroup 등의 destructive surface.

MCP client가 annotation으로 auto-approval/confirmation UI를 결정한다면 읽기와 파괴적 쓰기를 구분할 신호가 없다.

**권고 수정**

<code>ToolDef</code>에 execution location과 별개로 <code>readOnly</code>, <code>destructive</code>, <code>idempotent</code>, <code>filesystemWrite</code> metadata를 추가하고 MCP annotation과 정책 gate를 생성한다.

### 2.7 R-C-05 — release supply-chain과 direct-tag gate가 빠졌다

**Severity: Medium / CI·공급망 누락**

보고서 release 절은 tag↔Cargo version mismatch를 잘 찾았지만 다음 위험은 빠졌다.

- CI/release action이 commit SHA가 아니라 mutable major tag를 사용한다: <code>actions/checkout@v5</code>, <code>setup-bun@v2</code>, <code>action-gh-release@v2</code>, <code>setup-node@v5</code>.  
  근거: <code>code-kb/figma-mcp-rust/.github/workflows/ci.yml:14,35,59-61</code>, <code>release.yml:48,90,111,121,126</code>.
- MCP publisher를 <code>releases/latest</code>에서 checksum/signature 검증 없이 <code>curl | tar</code>로 받아 즉시 실행한다.  
  근거: <code>code-kb/figma-mcp-rust/.github/workflows/release.yml:147-155</code>.
- release workflow 자체는 Rust/plugin test, fmt, Clippy, version sync를 재실행하지 않는다. 보호되지 않은 direct tag라면 CI를 우회한 artifact publish가 가능하다.
- npm은 long-lived <code>NPM_TOKEN</code>을 사용하며 provenance/OIDC가 보이지 않는다.  
  근거: <code>release.yml:126-139</code>.

**권고 수정**

Actions SHA pin, publisher version+checksum pin, full release gate 또는 protected environment, npm trusted publishing/provenance를 권고한다.

### 2.8 R-C-06 — 배포 artifact의 MIT 고지 포함 여부가 빠졌다

**Severity: Medium / 라이선스 누락**

보고서 라이선스 절은 MIT 고지를 포함해야 한다고 정확히 썼지만 실제 배포 workflow에 그 고지가 들어가는지 확인하지 않았다.

- <code>npm/package.json</code>의 <code>files</code>는 launcher와 platform binaries뿐이고 package-local LICENSE가 없다.  
  근거: <code>code-kb/figma-mcp-rust/npm/package.json:9-17</code>, inventory.
- release는 npm cwd에 README만 복사하고 LICENSE는 복사하지 않는다.  
  근거: <code>code-kb/figma-mcp-rust/.github/workflows/release.yml:131-139</code>.
- plugin zip은 manifest와 dist만 포함한다.  
  근거: <code>release.yml:116-123</code>.

npm이 parent repository의 LICENSE를 자동으로 끌어올리지는 않으므로 실제 tarball/zip에 license notice가 없을 가능성이 높다. 빌드 artifact에 embedded notice가 있는지는 별도 확인이 필요하다.

**권고 수정**

package-local LICENSE/THIRD_PARTY_NOTICES를 명시적으로 copy하고, <code>npm pack --dry-run</code>과 zip contents를 CI에서 assert한다.

### 2.9 R-C-07 — 비용 모델의 범위를 한 문장 더 제한하면 좋다

**Severity: Low / 표현 정밀도**

비용 절은 Figma REST/official Dev Mode MCP 호출량을 벗어난다는 기술 사실과 권한·plan·정책을 잘 분리한다. 다만 “무료/no rate limits”를 평가할 때 AI agent/LLM inference token, local CPU/memory, support·distribution 비용이 사라지는 것은 아니다. Figma API/MCP transport 비용만 대체한다는 문장을 결론과 비교 표에 추가하면 통합 비용 모델이 더 정확해진다.

### 2.10 Rust 보고서 영역별 판정

| 영역 | 판정 | 리뷰 |
|---|---|---|
| 파일 coverage/정량 | PASS | inventory 93/93, 모든 합계 정확 |
| 기능 수/표 | PASS | 73 tool 전수, plugin/special 집합 정확 |
| 실행 흐름 | 보완 | Unknown→foreign /rpc를 추가 |
| 보안 | 보완 | leader identity, MCP annotations, supply chain |
| 동시성 | 수정 필요 | fast traversal scope 평가는 concurrency와 모순 |
| 문서 불일치 | PASS+ | dedupe, prompt, Glama, connection replacement를 잘 찾음 |
| 비용 제약 대체 | PASS, Low 보완 | Figma 경계는 정확; AI/local 비용 분리 |
| 정책 표현 | PASS | 회피 은폐를 권하지 않고 기술/정책을 분리 |
| 통합 후보 | 보완 | election/fast traversal을 수정 전 재사용 금지로 더 강하게 표시 |

---

## 3. figmosha2 리뷰

### 3.1 독립 재검증 결과

| 항목 | 보고서 | 독립 검증 | 판정 |
|---|---:|---:|---|
| commit | 547cefb4c90abaa1da68db5455b921cbf3f8a5b9 | 동일 | PASS |
| tag | v2.1.0 | 동일 | PASS |
| 추적 파일 | 15 | 15 | PASS |
| bytes | 109,430 | 동일 | PASS |
| text physical/nonblank | 2,518 / 2,082 | 동일 | PASS |
| binary | PNG 1 | 동일 | PASS |
| inventory path 집합 | 15행 | delta 0, duplicate 0 | PASS |
| argparse names | 12 | 12 | PASS |
| 고유 CLI 동작 | 11 | alias를 합치면 11 | PASS |
| public helpers | 20 | 20 | PASS |
| Python tests | 12 functions / 16 expanded cases | 동일 | PASS |
| Node helper checks | 20 | fresh 실행 20/20 exit 0 | PASS |

보고서는 raw exec의 위험, Host/Origin 방어와 빈틈, PENDING이 queue가 아니라는 점, <code>CURRENT_PRINT</code> race, 504 이후 mutation, custom port 단절, 문서 수치/버전 drift, Figma Web·multi-file 한계, 비용·정책 경계를 매우 잘 다뤘다.

### 3.2 Finding 요약

| ID | Severity | 유형 | 요약 |
|---|---|---|---|
| F-C-01 | Medium | 보안·재사용 누락 | Host gate가 <code>main()</code> 초기화에 결합되어 <code>build_app()</code> reuse 시 silently disabled |
| F-C-02 | Medium | 라이선스 누락 | UI에 CC BY 4.0 Solar SVG가 있지만 보고서는 MIT만 평가 |
| F-C-03 | Medium | undo 의미 정밀도 | 장기 실행 plugin에 <code>figma.commitUndo()</code>가 전혀 없어 per-command undo boundary 미정 |
| F-C-04 | Low | 비용 표현 | official MCP/Figma API token과 AI agent token 비용을 혼동할 여지 |
| F-C-05 | Low | launcher/health 누락 | status/readiness가 service identity와 version을 검증하지 않음 |

### 3.3 F-C-01 — Host/DNS-rebinding gate는 main 초기화 없이는 꺼진다

**Severity: Medium / 보안·통합 후보 누락**

보고서 <code>344-348</code>행은 Host/Origin 방어를 구현된 강점으로, <code>484</code>와 <code>518</code>행은 재사용 후보로 평가한다. 정상 CLI entry인 <code>bridge.py main()</code>으로 시작하면 맞다. 그러나 guard의 안전성은 전역 <code>ALLOWED_HOSTS</code>를 main에서 채운다는 숨은 전제에 묶여 있다.

- module default는 빈 set이고 빈 set은 “don't check”다.  
  <code>code-kb/figmosha2/bridge.py:29-32</code>.
- <code>_guard</code>는 set이 nonempty일 때만 Host를 검사한다.  
  <code>bridge.py:51-56</code>.
- <code>build_app()</code>은 Host configuration을 하지 않는다.  
  <code>bridge.py:321-327</code>.
- loopback allowlist는 <code>main()</code>에서만 설정된다.  
  <code>bridge.py:330-348</code>.
- tests의 autouse fixture는 매번 allowlist를 빈 set으로 만들고, Host test 한 개만 수동 값을 넣는다. production initialization path는 test하지 않는다.  
  <code>tests/test_bridge.py:29-39,118-125</code>.

따라서 통합 서비스가 보고서 권고대로 <code>build_app()</code>를 import/reuse하면 DNS-rebinding Host gate가 조용히 사라진다.

**권고 수정**

<code>build_app(host, port, allow_remote)</code>가 immutable security config를 받아야 한다. empty set을 “disable” 의미로 쓰지 말고 explicit unsafe flag를 요구한다. production factory test를 추가하고, 통합 후보 표에 이 초기화 결합을 명시한다.

### 3.4 F-C-02 — 저장소는 순수 MIT만이 아니다

**Severity: Medium / third-party license 누락**

보고서 <code>22-31</code>행은 저장소 라이선스를 MIT로만 요약하고 <code>486</code>행은 “재사용 쉬운 MIT source”를 강점으로 든다. 그러나 plugin UI에는 Solar icon set의 SVG path가 직접 embedded되어 있고 source comment/changelog가 CC BY 4.0이라고 명시한다.

근거:

- <code>code-kb/figmosha2/plugin/ui.html:38-44</code>.
- <code>code-kb/figmosha2/CHANGELOG.md:72-75</code>.
- root <code>LICENSE</code>에는 MIT만 있고 THIRD_PARTY_NOTICES는 없다.

CC BY 4.0은 사용 가능하지만 적절한 attribution, license link, 변경 표시 등의 별도 의무가 생긴다. source comment가 보존돼도 minify/bundle/distribution에서 없어질 수 있다. 통합 서비스의 UI 또는 derived icon을 가져갈 때 MIT만 따른다고 보면 안 된다.

**권고 수정**

라이선스 절과 inventory role에 third-party asset을 명시하고, 배포 artifact에 THIRD_PARTY_NOTICES와 attribution UI/문서를 보존하도록 한다.

### 3.5 F-C-03 — generic “undo 없음”을 per-command undo boundary 문제로 구체화해야 한다

**Severity: Medium / 동작 의미 보완**

보고서는 <code>211,267,311,359,494,525</code>행에서 undo/rollback/transaction 부재를 반복해 지적한다. 방향은 맞지만 구현 사실을 더 정확히 써야 한다.

- repository 전체에 <code>figma.commitUndo()</code> 호출이 0개다.
- plugin은 <code>figma.closePlugin()</code>을 호출하지 않고 장시간 열린 상태다.
- CLI의 text/variant/clone/rm/import와 helper mutation은 성공 후 undo boundary를 commit하지 않는다.
- raw user script가 직접 commit할 수는 있지만 built-in command는 그 책임을 안내하지 않는다.

근거: <code>code-kb/figmosha2/plugin/code.js:1,319-355</code>, <code>figmosha.py:256-334</code>.

실제 Figma host가 이 long-running plugin의 여러 request를 UI undo history에 어떻게 group하는지는 live test가 필요하다. 따라서 “undo가 전혀 불가능”이라고 단정할 것이 아니라 “per-command undo boundary가 구현·검증되지 않았고 rollback API도 없다”가 정확하다.

**권고 수정**

mutation command 성공 뒤 <code>figma.commitUndo()</code> 정책, batch boundary, destructive confirm을 설계하고 real Figma undo acceptance test를 추가한다.

### 3.6 F-C-04 — 비용에서 사라지는 “token”의 종류를 제한해야 한다

**Severity: Low / 표현 정밀도**

보고서 <code>74,77</code>행은 “MCP별 호출량/과금·토큰”을 비용에서 제외할 수 있다고 쓴다. 여기서 사라지는 것은 Figma REST/official MCP transport의 token/quota 경로다. Claude/Codex 등 caller가 코드를 생성하고 결과를 해석하는 LLM inference token, local compute, Figma eligible seat, support cost는 그대로다. Seat는 이후 절에서 잘 설명하므로 AI model token만 명시적으로 분리하면 된다.

### 3.7 F-C-05 — health/readiness가 Figmosha identity를 검증하지 않는다

**Severity: Low / launcher·진단 보완**

보고서 launcher risk는 Windows wrong PID kill과 readiness timing을 다루지만 service identity는 빠졌다.

- Unix launcher는 <code>curl -sf /status</code>가 2xx이면 어떤 service든 Figmosha가 떴다고 본다.  
  <code>code-kb/figmosha2/start-bridge.sh:11-20</code>.
- PowerShell은 port LISTENING만 본다.  
  <code>start-bridge.ps1:33-36,67-74</code>.
- CLI <code>status</code>도 HTTP 200이면 exit 0이고 service/version magic을 검사하지 않는다.  
  <code>figmosha.py:127-130</code>.
- root endpoint에는 service/version이 있지만 health path가 사용하지 않는다.  
  <code>bridge.py:305-318</code>.

통합에서는 <code>/status</code>에 service/protocol version/instance ID를 넣고 launcher와 doctor가 엄격 검사해야 한다.

### 3.9 figmosha2 보고서 영역별 판정

| 영역 | 판정 | 리뷰 |
|---|---|---|
| 파일 coverage/정량 | PASS | inventory 15/15, 합계 정확 |
| 기능 수/표 | PASS | 12 parser/11 동작/20 helpers 정확 |
| 실행 흐름 | PASS | HTTP→WS→UI→sandbox correlation 정확 |
| 보안 | 강함, 보완 | raw exec/null Origin/LAN은 잘 다룸; factory Host config 추가 |
| 동시성 | PASS+ | PENDING registry, CURRENT_PRINT, timeout 후 mutation을 정확히 분석 |
| 문서 불일치 | PASS+ | line 수, version, port, print, fonts, manifest drift를 잘 찾음 |
| 비용 제약 대체 | PASS, Low 보완 | permission/policy는 정확; AI token 비용 구분 |
| 정책 표현 | PASS | 공개 raw exec의 부적합 위험을 숨기지 않음 |
| 라이선스 | 보완 | Solar CC BY 4.0 고지 누락 |
| 통합 후보 | 보완 | Host config factory와 connection generation을 필수 조건으로 승격 |

---

## 4. 두 보고서에 공통으로 권고할 수정

1. **비용 용어를 세분화한다.** Figma REST/API quota, official MCP seat/call, Figma plan/seat, LLM inference token, local compute/ops를 같은 “token/무료” 문장에 넣지 않는다.
2. **editor capability matrix를 공통 형식으로 둔다.** Figma Design, Dev Mode, FigJam, Web, Desktop별 read/write/import/distribution 조건을 표로 맞춘다.
3. **MCP/HTTP endpoint health에 product identity와 protocol version을 요구한다.** 단순 port/2xx는 leader/service 증명이 아니다.
4. **재사용 후보는 숨은 초기화 조건까지 기록한다.** security primitive는 factory/default가 안전할 때만 “작은 수정” 후보로 분류한다.
5. **코드 라이선스와 bundled third-party asset/license를 분리한다.** 실제 npm/zip/plugin artifact contents를 검증한다.
6. **동시성은 request correlation과 shared mutable Figma state를 별도로 평가한다.** ID correlation이 정확해도 global editor flag, CURRENT_PRINT, connection slot, writes는 race할 수 있다.
7. **정책 표현은 현재 수준을 유지한다.** 두 보고서 모두 인증·결제 통제 침해나 위반 은폐를 제안하지 않고 기술 가능성과 배포 위험을 적절히 분리했다.

## 5. 최종 리뷰 판정

두 inventory와 두 보고서의 핵심 정량·기능 수는 신뢰할 수 있다. Rust 보고서는 breadth와 MCP/plugin contract 분석이 강하고, figmosha 보고서는 작은 코드베이스의 보안·동시성·문서 drift를 매우 정밀하게 잡았다.

수정 우선순위는 다음과 같다.

1. Rust R-C-01 foreign-port forwarding.
2. Rust R-C-02 fast traversal global race.
3. Rust R-C-03 Dev Mode write constraint.
4. figmosha F-C-01 Host gate factory coupling.
5. figmosha F-C-02 third-party CC BY notice.
6. 나머지 MCP metadata, release supply chain, undo boundary, health identity.

이 finding을 반영하면 두 보고서는 통합 아키텍처와 최종 비교표의 근거 문서로 사용하기에 충분하다.
