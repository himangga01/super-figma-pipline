# figma-mcp-rust 파일 전수 인벤토리

## 1. 조사 기준과 범위

- 대상: `code-kb/figma-mcp-rust`
- 기준 커밋: `6094566436577b29d04393c774d51492c12671e1` (`v0.2.0`, `main`, 2026-08-19)
- 기준 파일 집합: `git -C code-kb/figma-mcp-rust ls-files`가 반환한 **추적 파일 93개**
- 제외: `.git/**`, Git 비추적 파일, 빌드/설치 산출물(`target/`, `plugin/node_modules/`, `plugin/dist/`, 릴리스 때 주입되는 `npm/bin/<platform>/`)
- 전수 판독 결과: 93개 모두 바이트를 읽고 엄격한 UTF-8 디코딩에 성공했다. 서로 다른 SHA-256 해시는 93개였다.
- 라인 정의: 물리 라인은 `.NET [IO.File]::ReadLines()`가 반환한 행 수, 비공백 라인은 `IsNullOrWhiteSpace`가 거짓인 행 수다. 바이트는 파일의 실제 길이다.

조사 시작 시 대상 저장소의 `git status --short`는 비어 있었다. 상위 저장소의 보고서 파일은 대상 오픈소스 파일 집합에 포함하지 않았다.

## 2. 총계

| 지표 | 값 |
|---|---:|
| 추적 파일 | 93 |
| 총 바이트 | 598,008 |
| 물리 라인 | 15,986 |
| 비공백 라인 | 14,200 |
| UTF-8 디코딩 실패 | 0 |

### 최상위 디렉터리별

| 디렉터리 | 파일 | 바이트 | 물리 라인 | 비공백 라인 |
|---|---:|---:|---:|---:|
| `plugin/` | 35 | 255,825 | 6,120 | 5,439 |
| `src/` | 16 | 157,088 | 4,378 | 4,022 |
| `skills/` | 13 | 38,428 | 831 | 666 |
| `prompts/` | 12 | 32,048 | 713 | 576 |
| 루트 | 8 | 92,592 | 3,187 | 2,820 |
| `tests/` | 3 | 12,226 | 419 | 386 |
| `.github/` | 2 | 6,733 | 228 | 189 |
| `npm/` | 2 | 2,068 | 77 | 69 |
| `.claude-plugin/` | 2 | 1,000 | 33 | 33 |

### 확장자별

| 확장자 | 파일 | 바이트 | 물리 라인 | 비공백 라인 |
|---|---:|---:|---:|---:|
| `.ts` | 28 | 212,506 | 5,290 | 4,791 |
| `.md` | 26 | 83,568 | 1,838 | 1,476 |
| `.rs` | 19 | 169,314 | 4,797 | 4,408 |
| `.json` | 8 | 9,233 | 204 | 204 |
| 확장자 없음 | 2 | 2,284 | 55 | 40 |
| `.js` | 2 | 1,252 | 44 | 35 |
| `.lock` | 2 | 97,824 | 2,912 | 2,517 |
| `.yml` | 2 | 6,733 | 228 | 189 |
| `.gitignore` | 1 | 472 | 35 | 29 |
| `.html` | 1 | 194 | 10 | 10 |
| `.svelte` | 1 | 13,058 | 502 | 444 |
| `.toml` | 1 | 1,570 | 71 | 57 |

## 3. 93개 파일 전수 목록

경로는 `code-kb/figma-mcp-rust` 기준 상대경로다.

| 상대경로 | 유형·역할 | 물리 라인 | 비공백 | 바이트 |
|---|---|---:|---:|---:|
| `.claude-plugin/marketplace.json` | Claude Code 마켓플레이스 엔트리 | 16 | 16 | 510 |
| `.claude-plugin/plugin.json` | Claude Code 플러그인 및 stdio MCP 실행 매니페스트 | 17 | 17 | 490 |
| `.github/workflows/ci.yml` | 버전 정합성, Rust 포맷·Clippy·테스트·빌드, 플러그인 테스트·빌드 CI | 73 | 58 | 1,899 |
| `.github/workflows/release.yml` | 6개 플랫폼 바이너리, Figma 플러그인 ZIP, npm·MCP Registry 릴리스 | 155 | 131 | 4,834 |
| `.gitignore` | AI 로컬 파일, Rust/플러그인/릴리스 산출물 제외 규칙 | 35 | 29 | 472 |
| `Cargo.lock` | Rust 의존성 잠금(272 package block) | 2,645 | 2,373 | 69,146 |
| `Cargo.toml` | Rust 패키지·바이너리·라이브러리·의존성·릴리스 프로필 | 71 | 57 | 1,570 |
| `glama.json` | Glama MCP 카탈로그 메타데이터와 58개 도구 목록 | 67 | 67 | 5,444 |
| `LICENSE` | MIT 라이선스(Go 원작자와 Rust 포트 저작권 고지) | 22 | 18 | 1,159 |
| `Makefile` | Rust/플러그인 빌드·테스트·Rust 커버리지·정리 진입점 | 33 | 22 | 1,125 |
| `npm/bin/run.js` | OS/CPU별 Rust 바이너리를 선택·동기 실행하는 Node 런처 | 39 | 31 | 1,131 |
| `npm/package.json` | npm 배포 패키지, bin 및 6개 플랫폼 산출물 선언 | 38 | 38 | 937 |
| `plugin/bun.lock` | 플러그인 Bun 의존성 잠금 | 267 | 144 | 28,678 |
| `plugin/manifest.json` | Figma 플러그인 권한·네트워크·동적 페이지 접근 매니페스트 | 15 | 15 | 479 |
| `plugin/package.json` | Svelte/Vite/TypeScript 플러그인 빌드·테스트 스크립트와 의존성 | 20 | 20 | 572 |
| `plugin/src/global.d.ts` | Figma Plugin API 전역 타입 참조 | 1 | 1 | 49 |
| `plugin/src/main.ts` | 플러그인 메인 샌드박스 진입점, UI 메시지 중계, 읽기/쓰기 디스패치 | 102 | 94 | 3,070 |
| `plugin/src/read-document.ts` | 문서·선택·노드·컨텍스트·검색·폰트·반응 읽기 구현 | 438 | 414 | 17,520 |
| `plugin/src/read-export.ts` | PNG/SVG/JPG/PDF base64 내보내기와 프레임 PDF 페이지 추출 | 91 | 89 | 2,947 |
| `plugin/src/read-handlers.ts` | 세 읽기 핸들러 체인 | 8 | 7 | 377 |
| `plugin/src/read-styles.test.ts` | `export_tokens` JSON/CSS 단위 테스트 10건 | 199 | 178 | 7,191 |
| `plugin/src/read-styles.ts` | 스타일·변수·컴포넌트·주석·토큰 읽기/변환 | 272 | 263 | 10,535 |
| `plugin/src/serializers.test.ts` | 색·효과·스타일·텍스트·노드 직렬화 단위 테스트 70건 | 665 | 597 | 25,562 |
| `plugin/src/serializers.ts` | Figma 노드/스타일/효과/변수 JSON 직렬화 및 중복 색 참조화 | 332 | 292 | 11,271 |
| `plugin/src/ui/App.svelte` | WebSocket 연결·재연결·서버 주소 설정·상태 표시 UI | 502 | 444 | 13,058 |
| `plugin/src/ui/index.html` | 플러그인 UI HTML 셸 | 10 | 10 | 194 |
| `plugin/src/ui/main.ts` | Svelte UI 마운트 진입점 | 4 | 3 | 108 |
| `plugin/src/write-components.test.ts` | 페이지 이동·그룹·그룹 해제 단위 테스트 15건 | 165 | 142 | 6,756 |
| `plugin/src/write-components.ts` | 컴포넌트 교체·분리, 삭제, 이동, 그룹/해제 | 123 | 117 | 5,263 |
| `plugin/src/write-create.test.ts` | 프레임→컴포넌트 변환과 섹션 생성 단위 테스트 11건 | 200 | 176 | 7,458 |
| `plugin/src/write-create.ts` | 프레임·도형·텍스트·이미지·컴포넌트·섹션 생성 | 172 | 161 | 6,919 |
| `plugin/src/write-effects.test.ts` | 효과 설정과 stroke 변수 바인딩 단위 테스트 19건 | 226 | 199 | 9,562 |
| `plugin/src/write-handlers.ts` | 일곱 쓰기 핸들러 체인 | 16 | 15 | 833 |
| `plugin/src/write-helpers.test.ts` | 색·페인트·오토레이아웃·base64·부모 탐색 단위 테스트 28건 | 247 | 210 | 8,801 |
| `plugin/src/write-helpers.ts` | hex/페인트/base64/부모/오토레이아웃 공용 쓰기 유틸리티 | 71 | 66 | 3,281 |
| `plugin/src/write-modify.test.ts` | 노드 속성·재배치·일괄 이름/텍스트 변경 단위 테스트 63건 | 546 | 466 | 26,264 |
| `plugin/src/write-modify.ts` | 텍스트·페인트·위치·크기·가시성·제약·부모 등 노드 수정 | 403 | 383 | 17,955 |
| `plugin/src/write-page.test.ts` | 페이지 추가·삭제·이름 변경 단위 테스트 19건 | 172 | 145 | 7,744 |
| `plugin/src/write-page.ts` | 페이지 추가·삭제·이름 변경 | 78 | 75 | 2,721 |
| `plugin/src/write-prototype.test.ts` | 프로토타입 반응 설정·제거 단위 테스트 13건 | 189 | 156 | 7,533 |
| `plugin/src/write-prototype.ts` | 프로토타입 Reaction 정규화·설정·제거 | 95 | 86 | 3,500 |
| `plugin/src/write-styles.ts` | 스타일 생성·수정·삭제·적용, 효과와 변수 바인딩 | 314 | 304 | 13,554 |
| `plugin/src/write-variables.ts` | 변수 컬렉션·모드·변수 값 생성/설정/삭제 | 126 | 119 | 4,954 |
| `plugin/svelte.config.js` | Svelte Vite 전처리 설정 | 5 | 4 | 121 |
| `plugin/tsconfig.json` | 느슨한(`strict: false`) 플러그인 TypeScript 설정 | 11 | 11 | 217 |
| `plugin/vite.config.main.ts` | Figma 메인 코드를 IIFE `dist/code.js`로 빌드 | 16 | 15 | 313 |
| `plugin/vite.config.ts` | Svelte UI를 단일 HTML로 빌드 | 19 | 18 | 465 |
| `prompts/annotation_conversion_strategy.md` | 수동 주석→네이티브 주석 전환 MCP 프롬프트 | 62 | 45 | 2,501 |
| `prompts/bulk_rename_strategy.md` | 계층적 레이어 일괄 이름 정리 프롬프트 | 53 | 43 | 2,446 |
| `prompts/design_strategy.md` | Figma 화면 생성·수정 기본 전략 프롬프트 | 73 | 64 | 2,767 |
| `prompts/design_token_generation_strategy.md` | 기존 디자인에서 토큰을 추출·생성·연결하는 프롬프트 | 88 | 66 | 4,421 |
| `prompts/generate_color_palette.md` | 컬러 스케일·시맨틱 변수 생성 프롬프트 | 73 | 59 | 2,771 |
| `prompts/generate_component_variants.md` | 컴포넌트 복제 기반 변형 생성 프롬프트 | 77 | 63 | 2,931 |
| `prompts/generate_type_scale.md` | 비율 기반 타이포그래피 스타일 생성 프롬프트 | 56 | 44 | 2,802 |
| `prompts/reaction_to_connector_strategy.md` | 프로토타입 반응을 흐름 맵으로 해석하는 프롬프트 | 57 | 46 | 2,029 |
| `prompts/read_design_strategy.md` | 토큰 효율적인 디자인 읽기 프롬프트 | 28 | 27 | 2,358 |
| `prompts/style_audit_strategy.md` | 하드코딩 스타일 탐지·연결 프롬프트 | 37 | 29 | 1,928 |
| `prompts/swap_overrides_instances.md` | 인스턴스 간 콘텐츠/스타일 오버라이드 이전 프롬프트 | 36 | 29 | 1,830 |
| `prompts/text_replacement_strategy.md` | 청크 단위 대량 텍스트 치환·검증 프롬프트 | 73 | 61 | 3,264 |
| `README.md` | 목적·설치·73개 도구·12개 프롬프트·Rust 포트 설명 | 294 | 234 | 13,092 |
| `server.json` | MCP Registry stdio npm 패키지 메타데이터 | 20 | 20 | 584 |
| `skills/annotation-conversion/SKILL.md` | 주석 전환 Claude Code 스킬(동명 프롬프트 본문 복제) | 67 | 49 | 2,810 |
| `skills/bridge-troubleshooting/SKILL.md` | 설치·연결·타임아웃·다중 클라이언트 진단 스킬 | 58 | 42 | 2,709 |
| `skills/bulk-rename/SKILL.md` | 일괄 이름 정리 스킬 | 58 | 47 | 2,735 |
| `skills/design-strategy/SKILL.md` | 디자인 생성·수정 전략 스킬 | 78 | 68 | 3,071 |
| `skills/design-token-generation/SKILL.md` | 디자인 토큰 추출·생성 스킬 | 93 | 70 | 4,756 |
| `skills/generate-color-palette/SKILL.md` | 컬러 팔레트 생성 스킬 | 78 | 63 | 3,083 |
| `skills/generate-component-variants/SKILL.md` | 컴포넌트 변형 생성 스킬 | 82 | 67 | 3,251 |
| `skills/generate-type-scale/SKILL.md` | 타입 스케일 생성 스킬 | 61 | 48 | 3,091 |
| `skills/prototype-flow-mapping/SKILL.md` | 프로토타입 흐름 매핑 스킬 | 62 | 50 | 2,313 |
| `skills/read-design-strategy/SKILL.md` | 디자인 읽기 전략 스킬 | 33 | 31 | 2,687 |
| `skills/style-audit/SKILL.md` | 스타일 감사 스킬 | 42 | 33 | 2,219 |
| `skills/swap-instance-overrides/SKILL.md` | 인스턴스 오버라이드 이전 스킬 | 41 | 33 | 2,139 |
| `skills/text-replacement/SKILL.md` | 텍스트 치환 스킬 | 78 | 65 | 3,564 |
| `src/bridge.rs` | 단일 WebSocket 연결과 요청 ID/oneshot 상관관계·타임아웃 | 308 | 278 | 10,734 |
| `src/election.rs` | 포트 기반 리더 선출·3~5초 감시·인계 | 105 | 95 | 3,316 |
| `src/error.rs` | 브리지·리더 오류 열거형 | 33 | 26 | 679 |
| `src/follower.rs` | 리더 `/ping` 확인과 `/rpc` HTTP 프록시 클라이언트 | 113 | 104 | 3,444 |
| `src/handler.rs` | rmcp `ServerHandler`, 도구·프롬프트 목록/호출 어댑터 | 183 | 163 | 6,753 |
| `src/leader.rs` | Axum `/ping`, `/rpc`, `/ws` 리더 서버 | 178 | 161 | 5,162 |
| `src/lib.rs` | 라이브러리 모듈 공개 | 12 | 12 | 202 |
| `src/main.rs` | CLI·로깅·선출·stdio MCP 진입점과 입력 필터 | 116 | 101 | 4,126 |
| `src/node.rs` | 역할에 따라 로컬 브리지/리더 HTTP로 라우팅하는 상태 머신 | 131 | 114 | 3,952 |
| `src/pdf.rs` | `lopdf` 기반 다중 단일 페이지 PDF 병합 | 112 | 97 | 4,138 |
| `src/prompts.rs` | 12개 MCP 프롬프트 정적 레지스트리와 `include_str!` | 79 | 75 | 3,308 |
| `src/schema.rs` | 노드 ID 정규화와 도구별 런타임 인자 검증·단위 테스트 | 1,125 | 1,042 | 40,435 |
| `src/tools/definitions.rs` | 73개 MCP 도구 설명·입력 JSON Schema 정적 테이블 | 1,249 | 1,175 | 50,172 |
| `src/tools/mod.rs` | 도구 정의 타입·조회·nodeIds/params 분리 | 97 | 89 | 3,602 |
| `src/tools/special.rs` | 스크린샷 로컬 저장과 PDF 내보내기 특수 서버 핸들러 | 452 | 421 | 14,531 |
| `src/types.rs` | WebSocket 및 follower↔leader JSON 와이어 타입과 역할 | 85 | 69 | 2,534 |
| `tests/node_routing.rs` | 독립 Axum 스텁에 대한 Follower HTTP 프록시 통합 테스트 2건 | 64 | 57 | 2,301 |
| `tests/schema_parity.rs` | Go 원작과의 검증 규칙 정합성 테스트 | 307 | 286 | 8,590 |
| `tests/tools_registry.rs` | 도구 수·이름 유일성·스키마 형태·조회 테스트 4건 | 48 | 43 | 1,335 |

## 4. 재실행 명령

PowerShell에서 워크스페이스 루트를 현재 디렉터리로 두고 실행한다.

```powershell
$repo = (Resolve-Path 'code-kb\figma-mcp-rust').Path
$tracked = git -C $repo ls-files
$rows = foreach ($rel in $tracked) {
  $path = Join-Path $repo $rel
  $physical = 0
  $nonblank = 0
  foreach ($line in [IO.File]::ReadLines($path)) {
    $physical++
    if (-not [string]::IsNullOrWhiteSpace($line)) { $nonblank++ }
  }
  $file = Get-Item -LiteralPath $path
  [pscustomobject]@{
    Path = $rel.Replace('\','/')
    Extension = if ($file.Extension) { $file.Extension.ToLowerInvariant() } else { '(none)' }
    Bytes = $file.Length
    PhysicalLines = $physical
    NonblankLines = $nonblank
  }
}
$rows | Measure-Object Bytes,PhysicalLines,NonblankLines -Sum
$rows | Group-Object Extension | ForEach-Object {
  [pscustomobject]@{
    Extension = $_.Name
    Files = $_.Count
    Bytes = ($_.Group | Measure-Object Bytes -Sum).Sum
    PhysicalLines = ($_.Group | Measure-Object PhysicalLines -Sum).Sum
    NonblankLines = ($_.Group | Measure-Object NonblankLines -Sum).Sum
  }
}
```

도구/플러그인/README 레지스트리 정합성은 다음 개념의 집계로 재검증했다.

```powershell
# Rust ToolDef의 name, plugin/src 비테스트 파일의 case "...",
# README의 Available Tools 표, glama.json의 tools[].name을 각각 추출해 집합 비교
```

결과는 Rust 73개(고유 73), README 73개(완전 일치), 플러그인 직접 case 72개(`save_screenshots`는 Rust 특수 핸들러), Glama 58개(15개 누락)다. 상세 의미는 심층 보고서에 기록했다.
